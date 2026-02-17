use std::collections::HashSet;
use std::fs;
use std::path::{Path, PathBuf};

use axum::extract::State;
use axum::http::StatusCode;
use axum::response::{Html, IntoResponse};
use axum::routing::{get, post};
use axum::{Json, Router};
use htmx::assembly;
use minijinja::{Environment, context};
use serde::{Deserialize, Serialize};
use serde_json::json;

const DEFAULT_UI_PATH: &str = "/tools/assembler/demo/";

const PAGE_TEMPLATE: &str = r##"<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>htmx Assembler UI</title>
  <script src="https://unpkg.com/htmx.org@2.0.3"></script>
  <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/prism/1.29.0/themes/prism-tomorrow.min.css">
  <script src="https://cdnjs.cloudflare.com/ajax/libs/prism/1.29.0/prism.min.js"></script>
  <script src="https://cdnjs.cloudflare.com/ajax/libs/prism/1.29.0/components/prism-javascript.min.js"></script>
  <style>
    :root { color-scheme: dark; }
    body { margin: 0; font-family: ui-sans-serif, system-ui, sans-serif; background: #09090b; color: #e4e4e7; }
    .layout { display: grid; grid-template-columns: 320px 1fr; height: 100vh; }
    .sidebar { border-right: 1px solid #27272a; overflow: auto; padding: 16px; background: #111113; }
    .main { overflow: auto; padding: 20px; }
    h1 { margin: 0 0 12px 0; font-size: 16px; }
    .controls { display: flex; flex-direction: column; gap: 8px; margin-bottom: 14px; }
    .ext { display: flex; align-items: center; gap: 8px; padding: 4px 0; font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 13px; }
    .result-wrap { border: 1px solid #27272a; border-radius: 8px; overflow: hidden; background: #111113; }
    .stats { display: flex; gap: 14px; font-size: 12px; padding: 10px 12px; border-bottom: 1px solid #27272a; color: #a1a1aa; }
    pre { margin: 0; padding: 14px; overflow: auto; }
    code[class*="language-"] { font-size: 12px; }
    .jump-hit { background: rgba(59,130,246,0.22); border-radius: 4px; transition: background 1.2s ease; }
    button { background: #18181b; color: #e4e4e7; border: 1px solid #27272a; border-radius: 6px; padding: 6px 10px; cursor: pointer; }
    button:hover { background: #1f1f23; }
    .row { display: flex; gap: 8px; align-items: center; }
  </style>
</head>
<body>
  <div class="layout">
    <aside class="sidebar">
      <h1>htmx assembler</h1>
      <form id="build-form"
            hx-post="/assemble"
            hx-target="#result"
            hx-swap="innerHTML"
            hx-trigger="change from:input delay:120ms, submit">
        <div class="controls">
          <label class="row"><input type="checkbox" name="inline" {% if inline %}checked{% endif %}> Inline</label>
          <div class="row">
            <button type="button" id="all-btn">All</button>
            <button type="button" id="none-btn">None</button>
            <button type="submit">Build</button>
          </div>
        </div>
        {% for ext in exts %}
          <label class="ext">
            <input type="checkbox" name="ext" value="{{ ext.name }}" {% if ext.checked %}checked{% endif %}>
            <span>{{ ext.name }}</span>
          </label>
        {% endfor %}
      </form>
    </aside>
    <main class="main">
      <div id="result">{{ result_html|safe }}</div>
    </main>
  </div>
  <script>
    let pendingExtJump = null;

    function jumpToExtensionMarker(extName) {
      if (!extName) return;
      const marker = '[' + extName + ']';
      const comments = Array.from(document.querySelectorAll('#result code .token.comment'));
      const hit = comments.find(function (el) {
        return (el.textContent || '').includes(marker);
      });
      if (!hit) return;
      hit.scrollIntoView({ behavior: 'smooth', block: 'center' });
      hit.classList.add('jump-hit');
      setTimeout(function () { hit.classList.remove('jump-hit'); }, 1200);
    }

    function rehighlight(root) {
      if (!window.Prism) return;
      root.querySelectorAll('code.language-javascript').forEach(function (el) {
        Prism.highlightElement(el);
      });
    }
    document.body.addEventListener('htmx:afterSwap', function (evt) {
      rehighlight(evt.target);
      if (pendingExtJump) {
        jumpToExtensionMarker(pendingExtJump);
        pendingExtJump = null;
      }
    });
    rehighlight(document);

    document.querySelectorAll('input[name="ext"]').forEach(function (cb) {
      cb.addEventListener('change', function () {
        pendingExtJump = cb.checked ? cb.value : null;
      });
    });

    document.getElementById('all-btn').addEventListener('click', function () {
      document.querySelectorAll('input[name="ext"]').forEach(function (cb) { cb.checked = true; });
      pendingExtJump = null;
      htmx.trigger('#build-form', 'submit');
    });
    document.getElementById('none-btn').addEventListener('click', function () {
      document.querySelectorAll('input[name="ext"]').forEach(function (cb) { cb.checked = false; });
      pendingExtJump = null;
      htmx.trigger('#build-form', 'submit');
    });
  </script>
</body>
</html>
"##;

const RESULT_TEMPLATE: &str = r##"<div class="result-wrap">
  <div class="stats">
    <span>Extensions: {{ ext_count }}</span>
    <span>Lines: {{ line_count }}</span>
    <span>Bytes: {{ byte_count }}</span>
    <span>Mode: {% if inline %}inline{% else %}simple{% endif %}</span>
  </div>
  <pre><code class="language-javascript">{{ output }}</code></pre>
</div>"##;

const ERROR_TEMPLATE: &str = r##"<div class="result-wrap">
  <div class="stats">
    <span>Error</span>
    <span>Extensions: {{ ext_count }}</span>
    <span>Mode: {% if inline %}inline{% else %}simple{% endif %}</span>
  </div>
  <pre><code class="language-javascript">{{ error }}</code></pre>
</div>"##;

#[derive(Clone)]
struct AppState {
    root: PathBuf,
}

#[derive(Serialize, Clone)]
struct ExtOption {
    name: String,
    checked: bool,
}

#[derive(Clone)]
struct InstallEntry {
    name: String,
    arg_expr: String,
}

#[derive(Deserialize)]
pub struct ApiAssembleBody {
    selected: Vec<String>,
    inline: Option<bool>,
}

struct AssembleResult {
    output: String,
    selected_count: usize,
}

pub fn run(port: u16) -> Result<(), String> {
    let root = project_root();
    let state = AppState { root: root.clone() };
    let addr = format!("127.0.0.1:{port}");
    let listener = std::net::TcpListener::bind(&addr)
        .map_err(|e| format!("failed to bind {addr}: {e}"))?;
    listener.set_nonblocking(true).map_err(|e| e.to_string())?;

    eprintln!("htmx assembler demo: http://localhost:{port}{DEFAULT_UI_PATH}");
    eprintln!("  Root: {}", root.display());

    let rt = tokio::runtime::Builder::new_multi_thread()
        .enable_all()
        .build()
        .map_err(|e| format!("failed to init tokio runtime: {e}"))?;

    rt.block_on(async move {
        let listener = tokio::net::TcpListener::from_std(listener)
            .map_err(|e| format!("failed to attach tokio listener: {e}"))?;

        let app = Router::new()
            .route("/", get(page))
            .route("/tools/assembler/demo/", get(page))
            .route("/tools/assembler/demo/index.html", get(page))
            .route("/assemble", post(ui_assemble))
            .route("/api/extensions", get(api_extensions))
            .route("/api/assemble", post(api_assemble))
            .with_state(state);

        axum::serve(listener, app)
            .await
            .map_err(|e| format!("server error: {e}"))
    })
}

async fn page(State(state): State<AppState>) -> impl IntoResponse {
    match render_page_response(&state) {
        Ok(html) => Html(html).into_response(),
        Err(err) => (StatusCode::INTERNAL_SERVER_ERROR, err).into_response(),
    }
}

async fn ui_assemble(
    State(state): State<AppState>,
    body: axum::body::Bytes,
) -> impl IntoResponse {
    let pairs: Vec<(String, String)> = match serde_urlencoded::from_bytes(&body) {
        Ok(v) => v,
        Err(e) => return (StatusCode::UNPROCESSABLE_ENTITY, format!("Failed to parse form body: {e}")).into_response(),
    };
    let mut selected: HashSet<String> = HashSet::new();
    let mut inline = false;
    for (key, value) in pairs {
        if key == "ext" {
            selected.insert(value);
        } else if key == "inline" {
            inline = true;
        }
    }
    match assemble_selected(&state.root, &selected, inline)
        .and_then(|r| render_result(&r.output, r.selected_count, inline)) {
        Ok(html) => Html(html).into_response(),
        Err(err) => {
            match render_error(&err, selected.len(), inline) {
                Ok(html) => Html(html).into_response(),
                Err(render_err) => (StatusCode::INTERNAL_SERVER_ERROR, render_err).into_response(),
            }
        }
    }
}

async fn api_extensions(State(state): State<AppState>) -> impl IntoResponse {
    match read_install_entries(&state.root) {
        Ok(entries) => {
            let names: Vec<String> = entries.into_iter().map(|e| e.name).collect();
            Json(json!(names)).into_response()
        }
        Err(err) => (StatusCode::INTERNAL_SERVER_ERROR, Json(json!({ "error": err }))).into_response(),
    }
}

async fn api_assemble(
    State(state): State<AppState>,
    Json(body): Json<ApiAssembleBody>,
) -> impl IntoResponse {
    let selected: HashSet<String> = body.selected.into_iter().collect();
    match assemble_selected(
        &state.root,
        &selected,
        body.inline.unwrap_or(false),
    ) {
        Ok(r) => Json(json!({ "ok": r.output })).into_response(),
        Err(err) => Json(json!({ "error": err })).into_response(),
    }
}

fn render_page_response(state: &AppState) -> Result<String, String> {
    let entries = read_install_entries(&state.root)?;
    let selected: HashSet<String> = HashSet::new();
    let initial = assemble_selected(&state.root, &selected, false)?;

    let exts: Vec<ExtOption> = entries.into_iter()
        .map(|e| ExtOption { name: e.name, checked: false })
        .collect();
    let result_html = render_result(&initial.output, initial.selected_count, false)?;

    let env = templates()?;
    let tpl = env.get_template("page.html").map_err(|e| e.to_string())?;
    tpl.render(context! {
        exts => exts,
        inline => false,
        result_html => result_html,
    }).map_err(|e| e.to_string())
}

fn render_result(output: &str, ext_count: usize, inline: bool) -> Result<String, String> {
    let env = templates()?;
    let tpl = env.get_template("result.html").map_err(|e| e.to_string())?;
    tpl.render(context! {
        output => output,
        ext_count => ext_count,
        line_count => output.lines().count(),
        byte_count => output.as_bytes().len(),
        inline => inline,
    }).map_err(|e| e.to_string())
}

fn render_error(error: &str, ext_count: usize, inline: bool) -> Result<String, String> {
    let env = templates()?;
    let tpl = env.get_template("error.html").map_err(|e| e.to_string())?;
    tpl.render(context! {
        error => error,
        ext_count => ext_count,
        inline => inline,
    }).map_err(|e| e.to_string())
}

fn templates() -> Result<Environment<'static>, String> {
    let mut env = Environment::new();
    env.add_template("page.html", PAGE_TEMPLATE).map_err(|e| e.to_string())?;
    env.add_template("result.html", RESULT_TEMPLATE).map_err(|e| e.to_string())?;
    env.add_template("error.html", ERROR_TEMPLATE).map_err(|e| e.to_string())?;
    Ok(env)
}

fn read_install_entries(root: &Path) -> Result<Vec<InstallEntry>, String> {
    let core_path = root.join("src/htmx.core.js");
    let core = fs::read_to_string(&core_path).map_err(|e| format!("read {}: {e}", core_path.display()))?;
    Ok(extract_install_entries(&core))
}

fn assemble_selected(root: &Path, selected: &HashSet<String>, inline: bool) -> Result<AssembleResult, String> {
    let kernel_path = root.join("src/htmx.kernel.js");
    let core_path = root.join("src/htmx.core.js");

    let kernel = fs::read_to_string(&kernel_path)
        .map_err(|e| format!("read {}: {e}", kernel_path.display()))?;
    let core = fs::read_to_string(&core_path)
        .map_err(|e| format!("read {}: {e}", core_path.display()))?;

    let install_entries = extract_install_entries(&core);
    let mut filtered_lines: Vec<String> = core
        .lines()
        .filter(|line| !line.contains("htmx.install("))
        .map(|line| line.to_string())
        .collect();
    filtered_lines.push(String::new());
    filtered_lines.push("// Generated by demo UI selection".to_string());
    for entry in &install_entries {
        if selected.contains(&entry.name) {
            filtered_lines.push(format!("htmx.install('{}', {})", entry.name, entry.arg_expr));
        }
    }
    let filtered_core = filtered_lines.join("\n");

    let extensions = assembly::parse_extensions(&filtered_core, "<demo-core>");
    if let Err(e) = assembly::validate_params(&extensions) {
        return Err(e.messages.join("\n"));
    }
    let order = assembly::toposort(&extensions).map_err(|e| e.messages.join("\n"))?;
    let output = if inline {
        assembly::assemble(&kernel, &extensions, &order)
    } else {
        assembly::assemble_simple(&kernel, &extensions, &order)
    }
    .map_err(|e| e.messages.join("\n"))?;
    Ok(AssembleResult { output, selected_count: selected.len() })
}

fn extract_install_entries(core_source: &str) -> Vec<InstallEntry> {
    core_source
        .lines()
        .filter_map(parse_install_line)
        .collect()
}

fn parse_install_line(line: &str) -> Option<InstallEntry> {
    let trimmed = line.trim_start();
    if trimmed.starts_with("//") {
        return None;
    }
    let rest = trimmed.strip_prefix("htmx.install(")?;
    let quote = rest.as_bytes().first().copied()?;
    if quote != b'\'' && quote != b'"' {
        return None;
    }

    let name_end_rel = rest[1..].find(quote as char)?;
    let name = rest[1..1 + name_end_rel].to_string();
    let after_name = &rest[1 + name_end_rel + 1..];
    let comma = after_name.find(',')?;
    let after_comma = after_name[comma + 1..].trim_start();
    let close = after_comma.rfind(')')?;
    let arg_expr = after_comma[..close].trim().to_string();
    if arg_expr.is_empty() {
        return None;
    }
    Some(InstallEntry { name, arg_expr })
}

fn project_root() -> PathBuf {
    let assembler_dir = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
    assembler_dir
        .parent()
        .and_then(|p| p.parent())
        .unwrap_or(&assembler_dir)
        .to_path_buf()
}
