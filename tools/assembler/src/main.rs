// htmx CLI — build tool for assembling htmx.js
//
// Usage: htmx build <file.js>... [-o output.js]

use std::env;
use std::fs;
use std::process;

use htmx::assembly;
mod demo_ui;

// ── CLI ──────────────────────────────────────────────────────────────────

fn main() {
    let args: Vec<String> = env::args().collect();

    if args.len() < 2 || args[1] == "-h" || args[1] == "--help" {
        eprintln!("Usage: htmx <command> [options]");
        eprintln!();
        eprintln!("Commands:");
        eprintln!("  build  -i <file.js>... [-o output.js] [--watch] [--inline] [--ui]");
        eprintln!();
        eprintln!("Build assembles kernel + extensions into a single file.");
        eprintln!("Default: simple concat with register() calls.");
        eprintln!("--inline: inline wraps and event handlers at call sites.");
        process::exit(if args.len() < 2 { 1 } else { 0 });
    }

    match args[1].as_str() {
        "build" => cmd_build(&args[2..]),
        other => {
            eprintln!("Error: unknown command '{other}'");
            eprintln!("Run 'htmx --help' for usage.");
            process::exit(1);
        }
    }
}

struct BuildOpts {
    input_files: Vec<String>,
    output_path: Option<String>,
    watch: bool,
    inline: bool,
    ui_port: Option<u16>,
}

fn parse_build_args(args: &[String]) -> BuildOpts {
    let mut input_files = Vec::new();
    let mut output_path = None;
    let mut watch = false;
    let mut inline = false;
    let mut ui_port = None;
    let mut i = 0;

    while i < args.len() {
        match args[i].as_str() {
            "-i" | "--input" => { /* visual separator, all positional args are inputs */ }
            "-o" | "--output" => {
                i += 1;
                if i >= args.len() { eprintln!("Error: -o requires a file path"); process::exit(1); }
                output_path = Some(args[i].clone());
            }
            "-w" | "--watch" => { watch = true; }
            "--inline" => { inline = true; }
            "--ui" => {
                ui_port = Some(8765);
                if i + 1 < args.len() && args[i + 1].chars().all(|c| c.is_ascii_digit()) {
                    i += 1;
                    ui_port = Some(args[i].parse::<u16>().unwrap_or(8765));
                }
            }
            "-h" | "--help" => {
                eprintln!("Usage: htmx build -i <file.js>... [-o output.js] [--watch] [--inline] [--ui [port]]");
                eprintln!();
                eprintln!("Assembles kernel + extensions into a single file.");
                eprintln!("The kernel is auto-detected as the *.kernel.js file.");
                eprintln!();
                eprintln!("Options:");
                eprintln!("  -i, --input <file>...  Input files (kernel + extensions)");
                eprintln!("  -o, --output <file>    Output file (default: stdout)");
                eprintln!("  -w, --watch            Rebuild on file changes");
                eprintln!("  --inline               Inline wraps and event handlers at call sites");
                eprintln!("  --ui [port]            Start demo UI/API server (default port: 8765)");
                process::exit(0);
            }
            _ => {
                input_files.push(args[i].clone());
            }
        }
        i += 1;
    }

    if ui_port.is_none() && input_files.is_empty() {
        eprintln!("Usage: htmx build -i <file.js>... [-o output.js] [--watch] [--inline]");
        process::exit(1);
    }

    BuildOpts { input_files, output_path, watch, inline, ui_port }
}

/// Resolve kernel and extension paths from a list of input files.
fn resolve_inputs(files: &mut Vec<String>) -> (String, Vec<String>) {
    let kernel_indices: Vec<usize> = files.iter().enumerate()
        .filter(|(_, f)| f.ends_with(".kernel.js"))
        .map(|(i, _)| i)
        .collect();

    let source_path = match kernel_indices.len() {
        0 => {
            eprintln!("Error: no *.kernel.js file found in input files");
            eprintln!("  hint: the kernel file must be named e.g. htmx.kernel.js");
            process::exit(1);
        }
        1 => files.remove(kernel_indices[0]),
        _ => {
            eprintln!("Error: multiple *.kernel.js files found:");
            for &i in &kernel_indices { eprintln!("  {}", files[i]); }
            process::exit(1);
        }
    };

    (source_path, std::mem::take(files))
}

/// Run a single build. Returns true on success, false on error.
fn run_build(source_path: &str, ext_paths: &[String], output_path: &Option<String>, inline: bool) -> bool {
    let source = match fs::read_to_string(source_path) {
        Ok(s) => s,
        Err(e) => { eprintln!("Error reading {source_path}: {e}"); return false; }
    };

    let mut extensions = Vec::new();
    for path in ext_paths {
        let ext_source = match fs::read_to_string(path) {
            Ok(s) => s,
            Err(e) => { eprintln!("Error reading {path}: {e}"); return false; }
        };
        let parsed = assembly::parse_extensions(&ext_source, path);
        if parsed.is_empty() { eprintln!("Warning: no htmx.register() found in {path}"); }
        for ext in &parsed {
            let handler_names: Vec<&str> = ext.handlers.iter().map(|h| h.event.as_str()).collect();
            let define_names: Vec<&str> = ext.defines.iter().map(|d| d.fn_name.as_str()).collect();
            let config_keys: Vec<&str> = ext.configs.iter().map(|c| c.key.as_str()).collect();
            let mut parts = Vec::new();
            if !handler_names.is_empty() { parts.push(format!("[{}]", handler_names.join(", "))); }
            if !define_names.is_empty() { parts.push(format!("defines: {}", define_names.join(", "))); }
            if !config_keys.is_empty() { parts.push(format!("config: {}", config_keys.join(", "))); }
            eprintln!("  found: {} {}{}", ext.name, parts.join(" "),
                if ext.requires.is_empty() { String::new() }
                else { format!(" (requires: {})", ext.requires.join(", ")) });
        }
        extensions.extend(parsed);
    }

    if let Err(e) = assembly::validate_params(&extensions) {
        for msg in &e.messages { eprint!("{}", msg); }
        eprintln!("\nerror: aborting due to parameter validation errors");
        return false;
    }

    let define_errors: Vec<&String> = extensions.iter()
        .flat_map(|ext| ext.define_errors.iter())
        .collect();
    if !define_errors.is_empty() {
        for msg in define_errors { eprint!("{}", msg); }
        eprintln!("\nerror: aborting due to define contract errors");
        return false;
    }

    for warning in assembly::lint_extensions(&extensions) {
        eprint!("{}", warning);
    }

    let order = match assembly::toposort(&extensions) {
        Ok(o) => o,
        Err(e) => {
            for msg in &e.messages { eprintln!("Error: {}", msg); }
            return false;
        }
    };
    let names: Vec<&str> = order.iter().map(|&i| extensions[i].name.as_str()).collect();
    eprintln!("Order: {}", names.join(" → "));

    let output = if inline {
        assembly::assemble(&source, &extensions, &order)
    } else {
        assembly::assemble_simple(&source, &extensions, &order)
    };

    let output = match output {
        Ok(o) => o,
        Err(e) => {
            for msg in &e.messages { eprintln!("{}", msg); }
            eprintln!("\nerror: aborting due to assembly errors");
            return false;
        }
    };

    match output_path {
        Some(path) => {
            if let Err(e) = fs::write(path, &output) {
                eprintln!("Error writing {path}: {e}");
                return false;
            }
            eprintln!("Assembled {} extension(s) → {} ({} bytes)", extensions.len(), path, output.len());
        }
        None => { print!("{output}"); }
    }

    true
}

fn cmd_build(args: &[String]) {
    let opts = parse_build_args(args);

    if let Some(port) = opts.ui_port {
        if let Err(e) = demo_ui::run(port) {
            eprintln!("Error: {e}");
            process::exit(1);
        }
        return;
    }

    let mut files = opts.input_files;
    let (source_path, ext_paths) = resolve_inputs(&mut files);

    if !run_build(&source_path, &ext_paths, &opts.output_path, opts.inline) {
        if !opts.watch { process::exit(1); }
    }

    if !opts.watch { return; }

    // ── Watch mode ───────────────────────────────────────────────────────
    #[cfg(feature = "watch")]
    {
        use notify_debouncer_mini::{new_debouncer, DebouncedEventKind};
        use std::sync::mpsc;
        use std::time::Duration;

        let (tx, rx) = mpsc::channel();
        let mut debouncer = new_debouncer(Duration::from_millis(200), tx)
            .unwrap_or_else(|e| { eprintln!("Error starting watcher: {e}"); process::exit(1); });

        let all_paths: Vec<&str> = std::iter::once(source_path.as_str())
            .chain(ext_paths.iter().map(|s| s.as_str()))
            .collect();

        for path in &all_paths {
            debouncer.watcher()
                .watch(std::path::Path::new(path), notify::RecursiveMode::NonRecursive)
                .unwrap_or_else(|e| { eprintln!("Error watching {path}: {e}"); process::exit(1); });
        }

        eprintln!("\nWatching {} file(s) for changes...", all_paths.len());

        loop {
            match rx.recv() {
                Ok(Ok(events)) => {
                    if events.iter().any(|e| e.kind == DebouncedEventKind::Any) {
                        eprintln!("\n── Rebuilding ──────────────────────────────────────────────");
                        run_build(&source_path, &ext_paths, &opts.output_path, opts.inline);
                    }
                }
                Ok(Err(e)) => { eprintln!("Watch error: {e}"); }
                Err(e) => { eprintln!("Channel error: {e}"); break; }
            }
        }
    }

    #[cfg(not(feature = "watch"))]
    {
        eprintln!("Error: --watch requires the 'watch' feature (not available in this build)");
        process::exit(1);
    }
}
