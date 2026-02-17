// WASI entry point for Cloudflare Workers
//
// Protocol: reads JSON from stdin, writes assembled JS to stdout.
//
// Input JSON:
//   { "kernel": "...", "extensions": ["...", "..."], "inline": false }
//
// Output: assembled JavaScript string (raw, not JSON-wrapped)

use crate::assembly;
use serde::Deserialize;
use std::io::{self, Read, Write};

#[derive(Deserialize)]
struct Input {
    kernel: String,
    extensions: Vec<String>,
    #[serde(default)]
    inline: bool,
}

pub fn run() -> Result<(), String> {
    let mut input = String::new();
    io::stdin().read_to_string(&mut input).map_err(|e| format!("stdin read error: {e}"))?;

    let input: Input = serde_json::from_str(&input).map_err(|e| format!("JSON parse error: {e}"))?;

    let mut extensions = Vec::new();
    for (i, source) in input.extensions.iter().enumerate() {
        let parsed = assembly::parse_extensions(source, &format!("<ext-{}>", i));
        extensions.extend(parsed);
    }

    assembly::validate_params(&extensions).map_err(|e| e.to_string())?;

    let order = assembly::toposort(&extensions).map_err(|e| e.to_string())?;

    let output = if input.inline {
        assembly::assemble(&input.kernel, &extensions, &order)
    } else {
        assembly::assemble_simple(&input.kernel, &extensions, &order)
    };

    let output = output.map_err(|e| e.to_string())?;

    io::stdout().write_all(output.as_bytes()).map_err(|e| format!("stdout write error: {e}"))?;

    Ok(())
}
