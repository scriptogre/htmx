// htmx assembler — core logic
//
// Parses htmx.install() calls from extension files.
// Boot handlers are inlined between Extensions: Start/End markers.
// Non-boot handlers are inlined at matching api.emit() call sites.
// api.wrap() calls are parsed from boot handlers and inlined directly
// into kernel function definitions — no closures in the output.
// No install() calls appear in the assembled output.

use std::collections::{HashMap, HashSet, VecDeque};
use tree_sitter::{Node, Parser};

// ── Data ─────────────────────────────────────────────────────────────────

pub struct Handler {
    pub event: String,
    pub params: (String, String),
    pub body: String,
}

pub struct Define {
    pub fn_name: String,
    pub fn_text: String,
    pub doc: String,
    pub params: Vec<String>,
    pub body: String,
    pub extension_name: String,
}

pub struct ConfigEntry {
    pub key: String,
    pub value_text: String,
}

pub struct Extension {
    pub name: String,
    pub requires: Vec<String>,
    pub handlers: Vec<Handler>,
    pub defines: Vec<Define>,
    pub configs: Vec<ConfigEntry>,
    pub define_errors: Vec<String>,
    pub source_path: String,
    pub source_text: String,
    pub description: String,
}

struct EmitSite {
    event_name: String,
    line_start: usize,
    indent: String,
}

struct Wrap {
    target_fn: String,
    params: Vec<String>,
    body: String,
    extension_name: String,
    doc: String,
}

/// A wrap that couldn't be parsed for inlining (e.g., IIFE pattern).
/// Kept as-is for runtime install() emission.
struct RuntimeWrap {
    extension_name: String,
    wrap_source: String,  // "wrap: { ajax: (() => { ... })() }"
}

struct KernelFn {
    params: Vec<String>,
    body_start: usize,
    body_end: usize,
}

enum InjectKind {
    ConfigReplace { end_pos: usize, new_text: String },
    ConfigNewProps { entries: Vec<(String, String)> },  // (extension_name, entry_text)
    DefineFns,
    ApiMembers,
    Boot,
    EmitSite { event_name: String, indent: String },
    FnRewrite { body_start: usize },
}

// ── Errors ───────────────────────────────────────────────────────────────

#[derive(Debug)]
pub struct AssemblyError {
    pub messages: Vec<String>,
}

impl std::fmt::Display for AssemblyError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        for msg in &self.messages {
            writeln!(f, "{}", msg)?;
        }
        Ok(())
    }
}

impl std::error::Error for AssemblyError {}

// ── Tree-sitter utilities ────────────────────────────────────────────────

fn js_parser() -> Parser {
    let mut parser = Parser::new();
    parser
        .set_language(&tree_sitter_javascript::LANGUAGE.into())
        .unwrap();
    parser
}

fn parse_js(source: &str) -> tree_sitter::Tree {
    js_parser().parse(source, None).unwrap()
}

/// Parse a code fragment as a function body.
fn parse_as_body(body: &str) -> (String, tree_sitter::Tree) {
    let wrapped = format!("function _() {{\n{}\n}}", body);
    let tree = parse_js(&wrapped);
    (wrapped, tree)
}

/// Get the statement_block (function body) from a parsed wrapper.
fn get_body_node(tree: &tree_sitter::Tree) -> Option<Node<'_>> {
    let root = tree.root_node();
    let func = root.child(0)?;
    func.child_by_field_name("body")
}

/// Check if a node is at the top level of the given body
/// (not nested inside another function/arrow).
fn is_top_level(node: Node, body: Node) -> bool {
    let mut current = node;
    loop {
        let parent = match current.parent() {
            Some(p) => p,
            None => return false,
        };
        if parent.id() == body.id() {
            return true;
        }
        match parent.kind() {
            "function_declaration" | "function_expression" | "arrow_function"
            | "generator_function" | "generator_function_declaration" => return false,
            _ => current = parent,
        }
    }
}

/// Get the expression node from a return_statement (the part after `return`).
fn return_expr(node: Node) -> Option<Node> {
    let mut cursor = node.walk();
    for child in node.children(&mut cursor) {
        if child.kind() != "return" && child.kind() != ";" {
            return Some(child);
        }
    }
    None
}

// ── Tree-sitter parsing helpers ──────────────────────────────────────────

/// Find all `htmx.install(...)` call expressions in a tree.
fn find_install_calls<'a>(node: Node<'a>, src: &[u8]) -> Vec<Node<'a>> {
    let mut calls = Vec::new();
    find_install_calls_recursive(node, src, &mut calls);
    calls
}

fn find_install_calls_recursive<'a>(node: Node<'a>, src: &[u8], out: &mut Vec<Node<'a>>) {
    if node.kind() == "call_expression" {
        if let Some(func) = node.child_by_field_name("function") {
            if func.kind() == "member_expression" {
                if let (Some(obj), Some(prop)) = (
                    func.child_by_field_name("object"),
                    func.child_by_field_name("property"),
                ) {
                    if obj.utf8_text(src).unwrap() == "htmx"
                        && prop.utf8_text(src).unwrap() == "install"
                    {
                        out.push(node);
                        return;
                    }
                }
            }
        }
    }
    let mut cursor = node.walk();
    for child in node.children(&mut cursor) {
        find_install_calls_recursive(child, src, out);
    }
}

/// Strip surrounding quotes from a string node's text.
fn extract_string_value(node: Node, src: &[u8]) -> String {
    let text = node.utf8_text(src).unwrap();
    if text.len() >= 2 {
        text[1..text.len() - 1].to_string()
    } else {
        text.to_string()
    }
}

/// Find a property value by key name in an object node.
fn find_property<'a>(obj_node: Node<'a>, key: &str, src: &[u8]) -> Option<Node<'a>> {
    let mut cursor = obj_node.walk();
    for child in obj_node.children(&mut cursor) {
        if child.kind() == "pair" {
            if let Some(key_node) = child.child_by_field_name("key") {
                let key_text = if key_node.kind() == "string" {
                    extract_string_value(key_node, src)
                } else {
                    key_node.utf8_text(src).unwrap().to_string()
                };
                if key_text == key {
                    return child.child_by_field_name("value");
                }
            }
        }
    }
    None
}

/// Get argument nodes from an arguments node (skip parens and commas).
fn iter_args<'a>(args_node: Node<'a>) -> Vec<Node<'a>> {
    let mut cursor = args_node.walk();
    args_node.children(&mut cursor)
        .filter(|n| n.kind() != "(" && n.kind() != ")" && n.kind() != ",")
        .collect()
}

/// Find a variable_declarator by name in the tree (DFS, first match).
fn find_variable_declarator<'a>(node: Node<'a>, name: &str, src: &[u8]) -> Option<Node<'a>> {
    if node.kind() == "variable_declarator" {
        if let Some(name_node) = node.child_by_field_name("name") {
            if name_node.utf8_text(src).unwrap() == name {
                return Some(node);
            }
        }
    }
    let mut cursor = node.walk();
    for child in node.children(&mut cursor) {
        if let Some(found) = find_variable_declarator(child, name, src) {
            return Some(found);
        }
    }
    None
}

/// Extract JSDoc description from the comment preceding a variable_declarator's parent declaration.
fn extract_declaration_description(decl_node: Node, src: &[u8]) -> String {
    let Some(parent) = decl_node.parent() else { return String::new() };
    let Some(prev) = parent.prev_sibling() else { return String::new() };
    if prev.kind() != "comment" { return String::new(); }
    let text = prev.utf8_text(src).unwrap();
    if !text.starts_with("/**") { return String::new(); }
    let inner = parse_jsdoc_inner(text);
    inner.lines()
        .find(|l| !l.trim().is_empty() && !l.trim().starts_with('@'))
        .unwrap_or("")
        .trim()
        .to_string()
}

/// Extract formal parameter names from a formal_parameters or single parameter node.
/// Strips default values: `options = {}` → `options`.
fn extract_params(node: Node, src: &[u8]) -> Vec<String> {
    if node.kind() == "formal_parameters" {
        let mut cursor = node.walk();
        node.children(&mut cursor)
            .filter(|n| n.kind() != "(" && n.kind() != ")" && n.kind() != ",")
            .map(|n| {
                if n.kind() == "assignment_pattern" {
                    n.child_by_field_name("left")
                        .map(|l| l.utf8_text(src).unwrap().to_string())
                        .unwrap_or_else(|| n.utf8_text(src).unwrap().to_string())
                } else {
                    n.utf8_text(src).unwrap().to_string()
                }
            })
            .collect()
    } else {
        vec![node.utf8_text(src).unwrap().to_string()]
    }
}

/// Extract inner text of a statement_block (between { and }).
fn extract_block_inner(node: Node, src: &[u8]) -> String {
    std::str::from_utf8(&src[node.start_byte() + 1..node.end_byte() - 1])
        .unwrap()
        .to_string()
}

// ── Extension parsing ────────────────────────────────────────────────────

pub fn parse_extensions(source: &str, path: &str) -> Vec<Extension> {
    let tree = parse_js(source);
    let root = tree.root_node();
    let src = source.as_bytes();
    let mut extensions = Vec::new();

    let install_calls = find_install_calls(root, src);

    for call_node in install_calls {
        let Some(args_node) = call_node.child_by_field_name("arguments") else { continue };
        let args = iter_args(args_node);
        if args.len() < 2 { continue; }

        // First arg: extension name (string)
        let name_node = args[0];
        if name_node.kind() != "string" { continue; }
        let name = extract_string_value(name_node, src);

        // Second arg: extension body (object literal or variable reference)
        let body_node = args[1];
        let (obj_node, description) = if body_node.kind() == "object" {
            (body_node, String::new())
        } else if body_node.kind() == "identifier" {
            let var_name = body_node.utf8_text(src).unwrap();
            let Some(decl) = find_variable_declarator(root, var_name, src) else { continue };
            let Some(value) = decl.child_by_field_name("value") else { continue };
            if value.kind() != "object" { continue; }
            let desc = extract_declaration_description(decl, src);
            (value, desc)
        } else {
            continue;
        };

        let ext_source = obj_node.utf8_text(src).unwrap().to_string();
        let requires = parse_requires(obj_node, src);
        let handlers = parse_handlers(obj_node, src);
        let (defines, define_errors) = parse_defines(obj_node, src, &name, path);
        let configs = parse_configs(obj_node, src);
        let source_text = format!("htmx.install('{}', {})", name, ext_source.trim());

        extensions.push(Extension { name, requires, handlers, defines, configs, define_errors, source_path: path.to_string(), source_text, description });
    }
    extensions
}

fn parse_handlers(obj_node: Node, src: &[u8]) -> Vec<Handler> {
    let Some(on_node) = find_property(obj_node, "on", src) else { return vec![] };
    if on_node.kind() != "object" { return vec![]; }

    let mut handlers = Vec::new();
    let mut cursor = on_node.walk();
    for child in on_node.children(&mut cursor) {
        if child.kind() != "pair" { continue; }
        let Some(key_node) = child.child_by_field_name("key") else { continue };
        let Some(value_node) = child.child_by_field_name("value") else { continue };

        let event = if key_node.kind() == "string" {
            extract_string_value(key_node, src)
        } else {
            key_node.utf8_text(src).unwrap().to_string()
        };

        if value_node.kind() != "arrow_function" { continue; }

        let params = value_node.child_by_field_name("parameters")
            .or_else(|| value_node.child_by_field_name("parameter"))
            .map(|pn| extract_params(pn, src))
            .unwrap_or_default();
        let param1 = params.first().cloned().unwrap_or_else(|| "_".into());
        let param2 = params.get(1).cloned().unwrap_or_else(|| "_".into());

        let Some(body_node) = value_node.child_by_field_name("body") else { continue };
        if body_node.kind() != "statement_block" { continue; }
        let body = extract_block_inner(body_node, src);

        handlers.push(Handler { event, params: (param1, param2), body });
    }
    handlers
}

fn parse_requires(obj_node: Node, src: &[u8]) -> Vec<String> {
    let Some(arr_node) = find_property(obj_node, "requires", src) else { return vec![] };
    if arr_node.kind() != "array" { return vec![]; }
    let mut cursor = arr_node.walk();
    arr_node.children(&mut cursor)
        .filter(|n| n.kind() == "string")
        .map(|n| extract_string_value(n, src))
        .collect()
}

fn parse_defines(obj_node: Node, src: &[u8], extension_name: &str, source_path: &str) -> (Vec<Define>, Vec<String>) {
    let Some(define_node) = find_property(obj_node, "define", src) else { return (vec![], vec![]) };
    if define_node.kind() != "object" { return (vec![], vec![]); }

    let mut defines = Vec::new();
    let mut errors = Vec::new();
    let mut cursor = define_node.walk();
    for child in define_node.children(&mut cursor) {
        if child.kind() != "pair" { continue; }
        let Some(key_node) = child.child_by_field_name("key") else { continue };
        let Some(value_node) = child.child_by_field_name("value") else { continue };

        let fn_name = key_node.utf8_text(src).unwrap().to_string();
        let Some(factory) = validate_define_factory(value_node, &fn_name, source_path, src, extension_name, &mut errors) else { continue };
        let Some(factory_body) = factory.child_by_field_name("body") else { continue };
        let Some(fn_node) = extract_factory_returned_fn(factory_body) else { continue };

        let params = fn_node
            .child_by_field_name("parameters")
            .map(|pn| extract_params(pn, src))
            .unwrap_or_default();

        let Some(body_node) = fn_node.child_by_field_name("body") else { continue };
        if body_node.kind() != "statement_block" { continue; }
        let body = dedent(&extract_block_inner(body_node, src));

        let is_async = fn_node.utf8_text(src).unwrap().trim_start().starts_with("async");
        let fn_text = format!("{}function {}({}) {{\n{}\n}}",
            if is_async { "async " } else { "" },
            fn_name,
            params.join(", "),
            indent(&body, "    "));

        // Extract JSDoc from preceding comment sibling within the define object.
        // Normalize indentation: tree-sitter starts at `/**` so continuation lines
        // carry the original source indent. Rebuild via parse_jsdoc_inner.
        let doc = child.prev_sibling()
            .filter(|n| n.kind() == "comment")
            .map(|n| n.utf8_text(src).unwrap())
            .filter(|t| t.starts_with("/**"))
            .map(|t| {
                let inner = parse_jsdoc_inner(t);
                let mut out = String::from("/**\n");
                for line in inner.lines() {
                    if line.is_empty() {
                        out.push_str(" *\n");
                    } else {
                        out.push_str(&format!(" * {}\n", line));
                    }
                }
                out.push_str(" */");
                out
            })
            .unwrap_or_default();

        defines.push(Define {
            fn_name,
            fn_text,
            doc,
            params,
            body,
            extension_name: extension_name.to_string(),
        });
    }
    (defines, errors)
}

fn validate_define_factory<'a>(
    value_node: Node<'a>,
    fn_name: &str,
    source_path: &str,
    src: &[u8],
    extension_name: &str,
    errors: &mut Vec<String>,
) -> Option<Node<'a>> {
    if value_node.kind() != "arrow_function" {
        errors.push(format_define_error(
            source_path,
            src,
            value_node,
            extension_name,
            fn_name,
            "define value must be an arrow factory",
            "use `define: { foo: (api) => function foo(...) { ... } }`",
        ));
        return None;
    }

    let params = value_node
        .child_by_field_name("parameters")
        .or_else(|| value_node.child_by_field_name("parameter"))
        .map(|pn| extract_params(pn, src))
        .unwrap_or_default();
    if params.len() > 1 {
        errors.push(format_define_error(
            source_path,
            src,
            value_node,
            extension_name,
            fn_name,
            "factory must take 0 or 1 parameter",
            "use `() => ...` or `(api) => ...`",
        ));
        return None;
    }
    if params.len() == 1 && params[0] != "api" {
        errors.push(format_define_error(
            source_path,
            src,
            value_node,
            extension_name,
            fn_name,
            "single factory parameter must be named `api`",
            "rename the parameter to `api`, or remove it if unused",
        ));
        return None;
    }

    let Some(body) = value_node.child_by_field_name("body") else { return None };
    let Some(returned) = extract_factory_returned_fn(body) else {
        errors.push(format_define_error(
            source_path,
            src,
            body,
            extension_name,
            fn_name,
            "factory must return a named function",
            "for block bodies, end with `return function foo(...) { ... }`",
        ));
        return None;
    };

    if !matches!(returned.kind(), "function_expression" | "function") {
        errors.push(format_define_error(
            source_path,
            src,
            returned,
            extension_name,
            fn_name,
            "factory must return a function expression",
            "return `function foo(...) { ... }`, not an arrow/call expression",
        ));
        return None;
    }

    let Some(name_node) = returned.child_by_field_name("name") else {
        errors.push(format_define_error(
            source_path,
            src,
            returned,
            extension_name,
            fn_name,
            "returned function must be named",
            &format!("use `return function {}(...) {{ ... }}`", fn_name),
        ));
        return None;
    };
    let returned_name = name_node.utf8_text(src).unwrap_or("");
    if returned_name != fn_name {
        errors.push(format_define_error(
            source_path,
            src,
            name_node,
            extension_name,
            fn_name,
            &format!("returned function name '{}' must match define key '{}'", returned_name, fn_name),
            &format!("rename function to `{}`", fn_name),
        ));
        return None;
    }

    Some(value_node)
}

fn extract_factory_returned_fn<'a>(body_node: Node<'a>) -> Option<Node<'a>> {
    if matches!(body_node.kind(), "function_expression" | "function" | "arrow_function") {
        return Some(body_node);
    }
    if body_node.kind() != "statement_block" {
        return None;
    }
    let mut cursor = body_node.walk();
    let last_stmt = body_node.children(&mut cursor)
        .filter(|n| n.kind() != "{" && n.kind() != "}")
        .last()?;
    if last_stmt.kind() != "return_statement" {
        return None;
    }
    let expr = return_expr(last_stmt)?;
    Some(unwrap_parens(expr))
}

fn unwrap_parens(mut node: Node<'_>) -> Node<'_> {
    loop {
        if node.kind() != "parenthesized_expression" {
            return node;
        }
        let mut cursor = node.walk();
        let next = node
            .children(&mut cursor)
            .find(|n| n.kind() != "(" && n.kind() != ")");
        match next {
            Some(n) => node = n,
            None => return node,
        }
    }
}

fn format_define_error(
    source_path: &str,
    src: &[u8],
    node: Node<'_>,
    extension_name: &str,
    fn_name: &str,
    message: &str,
    help: &str,
) -> String {
    let (line, col, text) = node_line_col(src, node);
    let width = node.utf8_text(src).unwrap_or("").lines().next().map(|s| s.len()).unwrap_or(1).max(1);
    format!(
        "error: extension '{}' has invalid define.{} contract\n  --> {}:{}:{}\n   |\n{:>3} | {}\n   | {}{}\n   = help: {}\n   = note: {}\n",
        extension_name,
        fn_name,
        source_path,
        line,
        col,
        line,
        text,
        " ".repeat(col.saturating_sub(1)),
        "^".repeat(width.min(80)),
        message,
        help
    )
}

fn node_line_col(src: &[u8], node: Node<'_>) -> (usize, usize, String) {
    let start = node.start_byte();
    let text = std::str::from_utf8(src).unwrap_or("");
    let before = &text[..start.min(text.len())];
    let line = before.matches('\n').count() + 1;
    let line_start = before.rfind('\n').map(|p| p + 1).unwrap_or(0);
    let col = start.saturating_sub(line_start) + 1;
    let line_end = text[start..].find('\n').map(|p| start + p).unwrap_or(text.len());
    (line, col, text[line_start..line_end].to_string())
}

/// Extract individual element texts from a JS array literal string like `['a', 'b']`.
fn extract_array_item_texts(text: &str) -> Vec<String> {
    let wrapped = format!("var _ = {}", text);
    let tree = parse_js(&wrapped);
    let root = tree.root_node();
    let src = wrapped.as_bytes();
    // program → variable_declaration → variable_declarator → value
    let Some(decl) = root.child(0) else { return vec![] };
    let Some(declarator) = decl.child_by_field_name("declarator")
        .or_else(|| { let mut c = decl.walk(); decl.children(&mut c).find(|n| n.kind() == "variable_declarator") })
        else { return vec![] };
    let Some(value) = declarator.child_by_field_name("value") else { return vec![] };
    if value.kind() != "array" { return vec![] }

    let mut cursor = value.walk();
    value.children(&mut cursor)
        .filter(|n| n.kind() != "[" && n.kind() != "]" && n.kind() != ",")
        .map(|n| n.utf8_text(src).unwrap().trim().to_string())
        .collect()
}

/// Extract individual property (key, value) texts from a JS object literal string like `{a: 1}`.
fn extract_object_prop_texts(text: &str) -> Vec<(String, String)> {
    let wrapped = format!("var _ = {}", text);
    let tree = parse_js(&wrapped);
    let root = tree.root_node();
    let src = wrapped.as_bytes();
    let Some(decl) = root.child(0) else { return vec![] };
    let Some(declarator) = decl.child_by_field_name("declarator")
        .or_else(|| { let mut c = decl.walk(); decl.children(&mut c).find(|n| n.kind() == "variable_declarator") })
        else { return vec![] };
    let Some(value) = declarator.child_by_field_name("value") else { return vec![] };
    if value.kind() != "object" { return vec![] }

    let mut props = Vec::new();
    let mut cursor = value.walk();
    for child in value.children(&mut cursor) {
        if child.kind() == "pair" {
            if let (Some(key_node), Some(val_node)) = (
                child.child_by_field_name("key"),
                child.child_by_field_name("value"),
            ) {
                let key = key_node.utf8_text(src).unwrap().trim().to_string();
                let val = val_node.utf8_text(src).unwrap().trim().to_string();
                props.push((key, val));
            }
        }
    }
    props
}

fn parse_configs(obj_node: Node, src: &[u8]) -> Vec<ConfigEntry> {
    let Some(config_node) = find_property(obj_node, "config", src) else { return vec![] };
    if config_node.kind() != "object" { return vec![]; }

    let mut configs = Vec::new();
    let mut cursor = config_node.walk();
    for child in config_node.children(&mut cursor) {
        if child.kind() != "pair" { continue; }
        let Some(key_node) = child.child_by_field_name("key") else { continue };
        let Some(value_node) = child.child_by_field_name("value") else { continue };

        let key = if key_node.kind() == "string" {
            extract_string_value(key_node, src)
        } else {
            key_node.utf8_text(src).unwrap().to_string()
        };

        let value_text = dedent(value_node.utf8_text(src).unwrap());

        configs.push(ConfigEntry { key, value_text });
    }
    configs
}

// ── Parameter validation ─────────────────────────────────────────────────

pub fn validate_params(extensions: &[Extension]) -> Result<(), AssemblyError> {
    let mut errors = Vec::new();
    for ext in extensions {
        for handler in &ext.handlers {
            let (ref p1, ref p2) = handler.params;
            let mut param_errors = Vec::new();
            if !["detail", "_"].contains(&p1.as_str()) {
                param_errors.push(format!("first parameter '{}' — expected 'detail' (or '_' if unused)", p1));
            }
            if !["api", "_"].contains(&p2.as_str()) {
                param_errors.push(format!("second parameter '{}' — expected 'api' (or '_' if unused)", p2));
            }
            if !param_errors.is_empty() {
                let handler_sig = format!("({}, {})", p1, p2);
                let (line_num, col, line_content) = find_source_location(&ext.source_text, &handler_sig);
                let mut msg = String::new();
                msg.push_str(&format!("error: extension '{}' handler for '{}' has invalid parameter names\n", ext.name, handler.event));
                msg.push_str(&format!("  --> {}:{}:{}\n", ext.source_path, line_num, col));
                msg.push_str(&format!("   |\n"));
                msg.push_str(&format!("{:>3} | {}\n", line_num, line_content));
                msg.push_str(&format!("   | {}{}\n", " ".repeat(col.saturating_sub(1)), "^".repeat(handler_sig.len())));
                for e in &param_errors { msg.push_str(&format!("   = help: {}\n", e)); }
                errors.push(msg);
            }
        }
    }
    if errors.is_empty() { Ok(()) } else { Err(AssemblyError { messages: errors }) }
}

pub fn lint_extensions(extensions: &[Extension]) -> Vec<String> {
    let mut warnings = Vec::new();

    for ext in extensions {
        let defined: std::collections::HashSet<&str> = ext.defines.iter()
            .map(|d| d.fn_name.as_str())
            .collect();

        for handler in &ext.handlers {
            if handler.event != "htmx:boot" {
                continue;
            }
            for line in handler.body.lines() {
                let Some((fn_name, col_in_line)) = parse_api_assignment(line) else { continue };
                if defined.contains(fn_name.as_str()) {
                    continue;
                }

                let assignment_line = line.trim();
                let needle = if assignment_line.is_empty() {
                    format!("api.{fn_name} =")
                } else {
                    assignment_line.to_string()
                };
                let (line_num, col, line_text) = find_source_location(&ext.source_text, &needle);
                let caret_col = if assignment_line.is_empty() {
                    if col > 0 { col + col_in_line.saturating_sub(1) } else { col_in_line }
                } else {
                    col
                };
                let mut msg = String::new();
                msg.push_str(&format!(
                    "warning: extension '{}' assigns 'api.{}' in 'htmx:boot'; prefer declarative define\n",
                    ext.name, fn_name
                ));
                msg.push_str(&format!("  --> {}:{}:{}\n", ext.source_path, line_num, caret_col.max(1)));
                msg.push_str("   |\n");
                msg.push_str(&format!("{:>3} | {}\n", line_num, line_text));
                msg.push_str(&format!("   | {}{}\n", " ".repeat(caret_col.saturating_sub(1)), "^".repeat(format!("api.{fn_name}").len())));
                msg.push_str(&format!(
                    "   = help: move this to `define: {{ {}: ... }}` and keep `htmx:boot` for runtime setup only\n",
                    fn_name
                ));
                warnings.push(msg);
            }
        }
    }

    warnings
}

fn parse_api_assignment(line: &str) -> Option<(String, usize)> {
    let api_pos = line.find("api.")?;
    let after = &line[api_pos + 4..];
    let name_len = after
        .chars()
        .take_while(|c| c.is_ascii_alphanumeric() || *c == '_' || *c == '$')
        .count();
    if name_len == 0 {
        return None;
    }
    let fn_name = after[..name_len].to_string();
    let rest = after[name_len..].trim_start();
    if !rest.starts_with('=') || rest.starts_with("==") {
        return None;
    }
    Some((fn_name, api_pos + 5))
}

fn find_source_location(source: &str, needle: &str) -> (usize, usize, String) {
    if let Some(pos) = source.find(needle) {
        let before = &source[..pos];
        let line_num = before.matches('\n').count() + 1;
        let line_start = before.rfind('\n').map(|p| p + 1).unwrap_or(0);
        let col = pos - line_start + 1;
        let line_end = source[pos..].find('\n').map(|p| pos + p).unwrap_or(source.len());
        (line_num, col, source[line_start..line_end].to_string())
    } else {
        (1, 1, String::new())
    }
}

// ── Emit site detection ─────────────────────────────────────────────────

fn find_emit_sites(source: &str) -> Vec<EmitSite> {
    let tree = parse_js(source);
    let root = tree.root_node();
    let src = source.as_bytes();
    let mut sites = Vec::new();
    find_emit_calls_recursive(root, src, source, &mut sites);
    sites
}

fn find_emit_calls_recursive(node: Node, src: &[u8], source: &str, out: &mut Vec<EmitSite>) {
    if node.kind() == "call_expression" {
        if let Some(func) = node.child_by_field_name("function") {
            if func.kind() == "member_expression" {
                if let (Some(obj), Some(prop)) = (
                    func.child_by_field_name("object"),
                    func.child_by_field_name("property"),
                ) {
                    if obj.utf8_text(src).unwrap() == "api"
                        && prop.utf8_text(src).unwrap() == "emit"
                    {
                        if let Some(args_node) = node.child_by_field_name("arguments") {
                            let args = iter_args(args_node);
                            // Second arg is the event name string
                            if args.len() >= 2 && args[1].kind() == "string" {
                                let event_name = extract_string_value(args[1], src);
                                let emit_pos = node.start_byte();
                                let line_start = source[..emit_pos].rfind('\n').map(|p| p + 1).unwrap_or(0);
                                let indent = source[line_start..emit_pos].chars().take_while(|c| c.is_whitespace()).collect();
                                out.push(EmitSite { event_name, line_start, indent });
                            }
                        }
                        // Don't return — still recurse into children in case there are
                        // nested emit calls (e.g. inside arrow functions passed to emit)
                    }
                }
            }
        }
    }
    let mut cursor = node.walk();
    for child in node.children(&mut cursor) {
        find_emit_calls_recursive(child, src, source, out);
    }
}

/// Inject event handlers at `api.emit()` call sites within a text string.
/// Used for define function bodies and on-handler bodies where emit sites
/// aren't in the kernel source. Recursively processes handler bodies so that
/// nested emit sites (e.g. an on-handler that emits htmx:before:trigger)
/// also get their handlers inlined.
/// Returns the text with handler blocks inserted before each matching emit line.
fn inject_handlers_in_text(
    text: &str,
    event_handlers: &HashMap<String, Vec<(usize, usize)>>,
    extensions: &[Extension],
    dash: &dyn Fn(&str) -> String,
) -> String {
    inject_handlers_in_text_recursive(text, event_handlers, extensions, dash, 0)
}

fn inject_handlers_in_text_recursive(
    text: &str,
    event_handlers: &HashMap<String, Vec<(usize, usize)>>,
    extensions: &[Extension],
    dash: &dyn Fn(&str) -> String,
    depth: usize,
) -> String {
    if depth > 4 { return text.to_string(); } // guard against infinite recursion

    let sites = find_emit_sites(text);
    if sites.is_empty() { return text.to_string(); }

    // Filter to sites that have handlers
    let matched_sites: Vec<&EmitSite> = sites.iter()
        .filter(|s| event_handlers.contains_key(&s.event_name))
        .collect();
    if matched_sites.is_empty() { return text.to_string(); }

    // Detect extension name collisions across all handlers in this text.
    // If the same extension has handlers at multiple emit sites, disambiguate
    // with an event-action suffix to avoid duplicate function names.
    let mut ext_counts: HashMap<&str, usize> = HashMap::new();
    for site in &matched_sites {
        if let Some(handlers) = event_handlers.get(&site.event_name) {
            for &(ext_idx, _) in handlers {
                *ext_counts.entry(extensions[ext_idx].name.as_str()).or_default() += 1;
            }
        }
    }
    let needs_suffix: HashSet<&str> = ext_counts.iter()
        .filter(|&(_, count)| *count > 1)
        .map(|(&name, _)| name)
        .collect();

    // Build output by splicing handler functions before each emit site's line
    let mut out = String::with_capacity(text.len() * 2);
    let mut cursor = 0;

    for site in &matched_sites {
        let Some(handlers) = event_handlers.get(&site.event_name) else { continue };

        // Copy text up to the emit site's line start
        if site.line_start > cursor {
            out.push_str(&text[cursor..site.line_start]);
        }

        // Inject named handler functions before the emit line
        out.push('\n');
        for &(ext_idx, h_idx) in handlers {
            let ext = &extensions[ext_idx];
            let handler = &ext.handlers[h_idx];
            let tag = format!("[{}]", ext.name);
            let close_tag = format!("[/{}]", ext.name);
            let fn_name = handler_fn_name(&ext.name, &site.event_name,
                needs_suffix.contains(ext.name.as_str()));

            // Recursively inject handlers into this handler's body in case it
            // contains api.emit() calls (e.g. hx-trigger emits htmx:before:trigger)
            let dedented = dedent(&handler.body);
            let processed = inject_handlers_in_text_recursive(
                &dedented, event_handlers, extensions, dash, depth + 1,
            );

            out.push_str(&format!("{}// ── {} {}\n", site.indent, tag, dash(&tag)));
            out.push_str(&format!("{}function {}({}, {}) {{\n",
                site.indent, fn_name, handler.params.0, handler.params.1));
            let extra_indent = format!("{}    ", site.indent);
            out.push_str(&indent(&processed, &extra_indent));
            out.push('\n');
            out.push_str(&format!("{}}}\n", site.indent));
            out.push_str(&format!("{}if ({}({}, {}) === false) return false\n",
                site.indent, fn_name, handler.params.0, handler.params.1));
            out.push_str(&format!("{}// ── {} {}\n\n", site.indent, close_tag, dash(&close_tag)));
        }

        // cursor stays at line_start so the original emit line is still emitted
        cursor = site.line_start;
    }

    if cursor < text.len() {
        out.push_str(&text[cursor..]);
    }

    out
}

// ── Text manipulation ────────────────────────────────────────────────────

fn trim_empty_lines(text: &str) -> &str {
    let start = text
        .char_indices()
        .find(|(_, c)| !c.is_whitespace())
        .map(|(i, _)| i)
        .unwrap_or(0);
    let start = text[..start].rfind('\n').map(|p| p + 1).unwrap_or(0);
    let end = text.trim_end().len();
    &text[start..end.max(start)]
}

fn dedent(text: &str) -> String {
    let text = trim_empty_lines(text);
    let min_indent = text
        .lines()
        .filter(|l| !l.trim().is_empty())
        .map(|l| l.len() - l.trim_start().len())
        .min()
        .unwrap_or(0);
    if min_indent == 0 { return text.to_string(); }
    text.lines()
        .map(|l| {
            if l.trim().is_empty() { "" }
            else if l.len() >= min_indent { &l[min_indent..] }
            else { l }
        })
        .collect::<Vec<_>>()
        .join("\n")
}

/// Indent every non-empty line of text by `indent` string.
fn indent(text: &str, indent: &str) -> String {
    text.lines()
        .map(|l| {
            if l.trim().is_empty() { String::new() }
            else { format!("{}{}", indent, l.trim_end()) }
        })
        .collect::<Vec<_>>()
        .join("\n")
}

fn make_label(name: &str) -> String {
    name.replace('-', "_")
}

// ── JSDoc utilities ──────────────────────────────────────────────────

/// Extract a leading `/** ... */` doc block from a wrap body.
fn extract_wrap_doc(body: &str) -> (String, String) {
    let trimmed = body.trim_start();
    if !trimmed.starts_with("/**") {
        return (String::new(), body.to_string());
    }
    if let Some(end_pos) = trimmed.find("*/") {
        let doc_text = &trimmed[..end_pos + 2];
        let remaining = &trimmed[end_pos + 2..];
        let inner = parse_jsdoc_inner(doc_text);
        (inner, remaining.to_string())
    } else {
        (String::new(), body.to_string())
    }
}

/// Strip JSDoc markers from a `/** ... */` block, returning the inner lines.
fn parse_jsdoc_inner(doc: &str) -> String {
    let inner = doc.trim_start_matches("/**").trim_end_matches("*/");
    inner.lines()
        .map(|l| {
            let trimmed = l.trim();
            if trimmed.starts_with("* ") { &trimmed[2..] }
            else if trimmed == "*" { "" }
            else { trimmed }
        })
        .collect::<Vec<_>>()
        .join("\n")
        .trim()
        .to_string()
}

/// Find the `/** ... */` JSDoc block immediately preceding a position in source.
fn find_preceding_jsdoc(source: &str, fn_pos: usize) -> Option<(usize, usize)> {
    let before = &source[..fn_pos];
    let close_pos = before.rfind("*/")?;
    let between = &source[close_pos + 2..fn_pos];
    if !between.trim().is_empty() { return None; }
    let doc_start = source[..close_pos].rfind("/**")?;
    Some((doc_start, close_pos + 2))
}

/// Build an assembled JSDoc block from kernel doc + extension wrap docs.
fn build_assembled_jsdoc(kernel_doc: &str, wrap_docs: &[(String, String)], indent_str: &str) -> String {
    let kernel_inner = parse_jsdoc_inner(kernel_doc);
    let kernel_lines: Vec<&str> = kernel_inner.lines().collect();

    let returns_idx = kernel_lines.iter().position(|l| l.starts_with("@returns"));
    let (kernel_pre, kernel_returns) = match returns_idx {
        Some(idx) => {
            let mut pre: Vec<&str> = kernel_lines[..idx].to_vec();
            while pre.last().map(|l| l.is_empty()).unwrap_or(false) { pre.pop(); }
            (pre, kernel_lines[idx..].to_vec())
        }
        None => (kernel_lines, vec![])
    };

    let mut ext_sections: Vec<Vec<&str>> = Vec::new();
    let mut last_ext_returns: Option<Vec<&str>> = None;

    for (ext_name, doc) in wrap_docs {
        if doc.is_empty() { continue; }
        let lines: Vec<&str> = doc.lines().collect();
        let returns_idx = lines.iter().position(|l| l.starts_with("@returns"));
        match returns_idx {
            Some(idx) => {
                let mut section: Vec<&str> = lines[..idx].to_vec();
                while section.last().map(|l| l.is_empty()).unwrap_or(false) { section.pop(); }
                ext_sections.push(section);
                last_ext_returns = Some(lines[idx..].to_vec());
            }
            None => {
                ext_sections.push(lines);
            }
        }
        let _ = ext_name;
    }

    let mut out = format!("{}/**\n", indent_str);

    for line in &kernel_pre {
        if line.is_empty() {
            out.push_str(&format!("{} *\n", indent_str));
        } else {
            out.push_str(&format!("{} * {}\n", indent_str, line));
        }
    }

    for section in &ext_sections {
        out.push_str(&format!("{} *\n", indent_str));
        for line in section {
            if line.is_empty() {
                out.push_str(&format!("{} *\n", indent_str));
            } else {
                out.push_str(&format!("{} * {}\n", indent_str, line));
            }
        }
    }

    let final_returns = last_ext_returns.as_ref()
        .map(|v| v.iter().map(|s| *s).collect::<Vec<_>>())
        .unwrap_or_else(|| kernel_returns.to_vec());

    if !final_returns.is_empty() {
        out.push_str(&format!("{} *\n", indent_str));
        for line in &final_returns {
            if line.is_empty() {
                out.push_str(&format!("{} *\n", indent_str));
            } else {
                out.push_str(&format!("{} * {}\n", indent_str, line));
            }
        }
    }

    out.push_str(&format!("{} */", indent_str));
    out
}

/// Post-process assembled output: inject extension docs into kernel function JSDoc blocks.
fn inject_wrap_docs(output: &str, fn_wrap_docs: &HashMap<String, Vec<(String, String)>>) -> String {
    if fn_wrap_docs.is_empty() { return output.to_string(); }

    let mut result = output.to_string();
    let mut replacements: Vec<(usize, usize, String)> = Vec::new();

    for (fn_name, docs) in fn_wrap_docs {
        if docs.iter().all(|(_, d)| d.is_empty()) { continue; }

        let fn_sig = format!("function {}(", fn_name);
        let Some(fn_pos) = result.find(&fn_sig) else { continue };
        let Some((doc_start, doc_end)) = find_preceding_jsdoc(&result, fn_pos) else { continue };

        let existing_doc = &result[doc_start..doc_end];
        let line_start = result[..doc_start].rfind('\n').map(|p| p + 1).unwrap_or(0);
        let indent_str = &result[line_start..doc_start];

        let new_doc = build_assembled_jsdoc(existing_doc, docs, indent_str);
        replacements.push((line_start, doc_end, new_doc));
    }

    replacements.sort_by(|a, b| b.0.cmp(&a.0));
    for (start, end, new_doc) in replacements {
        result.replace_range(start..end, &new_doc);
    }

    result
}

// ── Wrap parsing ─────────────────────────────────────────────────────────

/// Parse declarative wrap: { fn: (original, ...args) => { ... } } from an install() call.
/// Returns (inlinable_wraps, runtime_wraps) where runtime_wraps are wraps that couldn't
/// be parsed for inlining (e.g., IIFE patterns) and need runtime install() emission.
fn parse_declarative_wraps(source: &str, extension_name: &str) -> (Vec<Wrap>, Vec<RuntimeWrap>) {
    let tree = parse_js(source);
    let root = tree.root_node();
    let src = source.as_bytes();

    // source is "htmx.install('name', { ... })" — find the object arg
    let obj_node = {
        let calls = find_install_calls(root, src);
        calls.first().and_then(|call| {
            let args_node = call.child_by_field_name("arguments")?;
            let args = iter_args(args_node);
            args.get(1).copied()
        })
    };

    let Some(obj_node) = obj_node else { return (vec![], vec![]) };
    if obj_node.kind() != "object" { return (vec![], vec![]); }

    let Some(wrap_node) = find_property(obj_node, "wrap", src) else { return (vec![], vec![]) };
    if wrap_node.kind() != "object" { return (vec![], vec![]); }

    let mut wraps = Vec::new();
    let mut runtime_wraps = Vec::new();
    let mut cursor = wrap_node.walk();
    for child in wrap_node.children(&mut cursor) {
        if child.kind() != "pair" { continue; }
        let Some(key_node) = child.child_by_field_name("key") else { continue };
        let Some(value_node) = child.child_by_field_name("value") else { continue };

        let fn_name = key_node.utf8_text(src).unwrap().to_string();

        if value_node.kind() != "arrow_function" {
            // Non-inlinable wrap (e.g., IIFE) — keep for runtime emission
            let wrap_text = child.utf8_text(src).unwrap_or("").to_string();
            runtime_wraps.push(RuntimeWrap {
                extension_name: extension_name.to_string(),
                wrap_source: format!("wrap: {{ {} }}", wrap_text),
            });
            continue;
        }

        let Some(params_node) = value_node.child_by_field_name("parameters") else { continue };
        let all_params = extract_params(params_node, src);
        // Skip first param ("original") and strip trailing "api" if present
        let mut params: Vec<String> = all_params.into_iter().skip(1).collect();
        if params.last().map(|s| s.as_str()) == Some("api") {
            params.pop();
        }

        let Some(body_node) = value_node.child_by_field_name("body") else { continue };
        if body_node.kind() != "statement_block" { continue; }
        let body_text = extract_block_inner(body_node, src);
        let (doc, body) = extract_wrap_doc(&body_text);

        wraps.push(Wrap {
            target_fn: fn_name,
            params,
            body,
            extension_name: extension_name.to_string(),
            doc,
        });
    }

    (wraps, runtime_wraps)
}

// ── Kernel function detection ────────────────────────────────────────────

fn find_kernel_functions(source: &str, target_names: &[&str]) -> HashMap<String, KernelFn> {
    let tree = parse_js(source);
    let root = tree.root_node();
    let src = source.as_bytes();
    let mut result = HashMap::new();

    find_functions_recursive(root, src, target_names, &mut result);

    result
}

fn find_functions_recursive(
    node: Node,
    src: &[u8],
    names: &[&str],
    out: &mut HashMap<String, KernelFn>,
) {
    let mut cursor = node.walk();
    for child in node.children(&mut cursor) {
        if child.kind() == "function_declaration" || child.kind() == "function" {
            if let Some(name_node) = child.child_by_field_name("name") {
                let name = name_node.utf8_text(src).unwrap();
                if names.contains(&name) && !out.contains_key(name) {
                    if let Some(params_node) = child.child_by_field_name("parameters") {
                        let mut pc = params_node.walk();
                        let params: Vec<String> = params_node.children(&mut pc)
                            .filter(|n| n.kind() != "(" && n.kind() != ")" && n.kind() != ",")
                            .map(|n| {
                                if n.kind() == "assignment_pattern" {
                                    n.child_by_field_name("left")
                                        .map(|l| l.utf8_text(src).unwrap().to_string())
                                        .unwrap_or_else(|| n.utf8_text(src).unwrap().to_string())
                                } else {
                                    n.utf8_text(src).unwrap().to_string()
                                }
                            })
                            .collect();

                        if let Some(body_node) = child.child_by_field_name("body") {
                            out.insert(name.to_string(), KernelFn {
                                params,
                                body_start: body_node.start_byte() + 1,
                                body_end: body_node.end_byte() - 1,
                            });
                        }
                    }
                }
            }
        }
        find_functions_recursive(child, src, names, out);
    }
}


fn find_identifiers<'a>(node: Node<'a>, name: &str, src: &[u8], out: &mut Vec<Node<'a>>) {
    if node.kind() == "identifier" && node.utf8_text(src).unwrap() == name {
        out.push(node);
    }
    let mut cursor = node.walk();
    for child in node.children(&mut cursor) {
        find_identifiers(child, name, src, out);
    }
}

// ── Named function inlining ──────────────────────────────────────────────

/// Rename top-level `original` identifiers in a body to `replacement`.
/// Identifiers inside nested functions (function declarations, function
/// expressions, arrow functions) are left untouched.
fn rename_original(body: &str, replacement: &str) -> String {
    let (wrapped, tree) = parse_as_body(body);
    let src = wrapped.as_bytes();
    let Some(body_node) = get_body_node(&tree) else { return body.to_string() };

    let mut idents = Vec::new();
    find_identifiers(body_node, "original", src, &mut idents);

    // Keep only identifiers at the top level of the body
    let mut top_level: Vec<Node> = idents.into_iter()
        .filter(|n| is_top_level(*n, body_node))
        .collect();

    if top_level.is_empty() { return body.to_string(); }

    top_level.sort_by(|a, b| b.start_byte().cmp(&a.start_byte()));

    let mut result = wrapped;
    for ident in &top_level {
        result.replace_range(ident.byte_range(), replacement);
    }

    let prefix = "function _() {\n";
    let suffix = "\n}";
    let inner = &result[prefix.len()..result.len() - suffix.len()];
    dedent(inner)
}

/// Build a chain of named functions from kernel body + wraps.
///
/// Given kernel function `fn_name` with body `kernel_body`, and wraps in
/// inner→outer order, produces:
///   1. `function __fnName_kernel(params) { kernel body }`
///   2. For each inner wrap: `function __fnName_extName(params) { wrap body with original→prev }`
///   3. Outermost wrap body emitted directly (not in a function) with original→prev
fn build_wrap_chain(
    fn_name: &str,
    kernel_body: &str,
    kernel_params: &[String],
    wraps: &[&Wrap],
    indent_str: &str,
    dash: &dyn Fn(&str) -> String,
) -> String {
    let params_str = kernel_params.join(", ");
    let mut body = String::new();
    body.push('\n');

    // Build chain of function names: kernel, wrap0, wrap1, ..., wrapN
    let kernel_chain_name = format!("__{}_kernel", fn_name);
    let mut chain_names: Vec<String> = vec![kernel_chain_name.clone()];
    for wrap in wraps {
        chain_names.push(format!("__{}_{}", fn_name, make_label(&wrap.extension_name)));
    }

    // Emit kernel body as a named function
    body.push_str(&format!("{}function {}({}) {{\n", indent_str, kernel_chain_name, params_str));
    let kernel_dedented = dedent(kernel_body);
    body.push_str(&indent(kernel_dedented.trim(), &format!("{}    ", indent_str)));
    body.push('\n');
    body.push_str(&format!("{}}}\n", indent_str));

    // Emit inner wraps as named functions (all except outermost)
    for (i, wrap) in wraps.iter().enumerate() {
        if i == wraps.len() - 1 { break; } // outermost is emitted inline below

        let this_name = &chain_names[i + 1];
        let prev_name = &chain_names[i];
        let tag = format!("[{}]", wrap.extension_name);
        let close_tag = format!("[/{}]", wrap.extension_name);

        let renamed = rename_original(&wrap.body, prev_name);

        body.push('\n');
        body.push_str(&format!("{}// ── {} {}\n", indent_str, tag, dash(&tag)));
        body.push_str(&format!("{}function {}({}) {{\n", indent_str, this_name, params_str));
        body.push_str(&indent(renamed.trim(), &format!("{}    ", indent_str)));
        body.push('\n');
        body.push_str(&format!("{}}}\n", indent_str));
        body.push_str(&format!("{}// ── {} {}\n", indent_str, close_tag, dash(&close_tag)));
    }

    // Emit outermost wrap body directly (not in a function)
    if let Some(outermost) = wraps.last() {
        let prev_name = &chain_names[chain_names.len() - 2];
        let tag = format!("[{}]", outermost.extension_name);
        let close_tag = format!("[/{}]", outermost.extension_name);

        let renamed = rename_original(&outermost.body, prev_name);

        body.push('\n');
        body.push_str(&format!("{}// ── {} {}\n", indent_str, tag, dash(&tag)));
        body.push_str(&indent(renamed.trim(), indent_str));
        body.push('\n');
        body.push_str(&format!("{}// ── {} {}\n", indent_str, close_tag, dash(&close_tag)));
    }

    body
}

/// Extract event action suffix from an event name for disambiguation.
/// `htmx:before:trigger` → `_before_trigger`
fn event_action_suffix(event_name: &str) -> String {
    let stripped = event_name.strip_prefix("htmx:").unwrap_or(event_name);
    format!("_{}", stripped.replace(':', "_"))
}

/// Generate a handler function name from extension name and (optionally) event name.
fn handler_fn_name(ext_name: &str, event_name: &str, needs_suffix: bool) -> String {
    if needs_suffix {
        format!("__{}{}", make_label(ext_name), event_action_suffix(event_name))
    } else {
        format!("__{}", make_label(ext_name))
    }
}

// ── Topological Sort ─────────────────────────────────────────────────────

pub fn toposort(extensions: &[Extension]) -> Result<Vec<usize>, AssemblyError> {
    let n = extensions.len();
    if n == 0 { return Ok(vec![]); }
    let name_to_idx: HashMap<&str, usize> = extensions.iter().enumerate().map(|(i, e)| (e.name.as_str(), i)).collect();
    let mut missing = Vec::new();
    let mut in_degree = vec![0usize; n];
    let mut dependents: Vec<Vec<usize>> = vec![vec![]; n];
    for (i, ext) in extensions.iter().enumerate() {
        for req in &ext.requires {
            if let Some(&dep_idx) = name_to_idx.get(req.as_str()) {
                dependents[dep_idx].push(i);
                in_degree[i] += 1;
            } else {
                missing.push(format!("missing dependency: extension '{}' requires '{}' to be included", ext.name, req));
            }
        }
    }
    if !missing.is_empty() {
        return Err(AssemblyError { messages: missing });
    }
    let mut queue: VecDeque<usize> = (0..n).filter(|&i| in_degree[i] == 0).collect();
    let mut order = Vec::with_capacity(n);
    while let Some(idx) = queue.pop_front() {
        order.push(idx);
        for &dep in &dependents[idx] {
            in_degree[dep] -= 1;
            if in_degree[dep] == 0 { queue.push_back(dep); }
        }
    }
    if order.len() != n {
        let stuck: Vec<&str> = extensions.iter().enumerate()
            .filter(|(i, _)| !order.contains(i))
            .map(|(_, e)| e.name.as_str())
            .collect();
        return Err(AssemblyError {
            messages: vec![format!("circular dependency: {}", stuck.join(", "))],
        });
    }
    Ok(order)
}

// ── Assembly ─────────────────────────────────────────────────────────────

fn build_header(extensions: &[&Extension]) -> String {
    let timestamp = {
        let d = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap_or_default();
        let secs = d.as_secs();
        // Manual UTC breakdown — avoids chrono dependency
        let days = secs / 86400;
        let time_secs = secs % 86400;
        let h = time_secs / 3600;
        let m = (time_secs % 3600) / 60;
        let s = time_secs % 60;
        // Days since epoch → year/month/day (civil calendar)
        let (y, mo, da) = {
            let z = days as i64 + 719468;
            let era = z / 146097;
            let doe = z - era * 146097;
            let yoe = (doe - doe / 1460 + doe / 36524 - doe / 146096) / 365;
            let y = yoe + era * 400;
            let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
            let mp = (5 * doy + 2) / 153;
            let d = doy - (153 * mp + 2) / 5 + 1;
            let m = if mp < 10 { mp + 3 } else { mp - 9 };
            let y = if m <= 2 { y + 1 } else { y };
            (y, m, d)
        };
        format!("{:04}-{:02}-{:02}T{:02}:{:02}:{:02}Z", y, mo, da, h, m, s)
    };
    // Compute column alignment width
    let max_name = extensions.iter().map(|e| e.name.len()).max().unwrap_or(0);
    let pad = max_name + 2;

    let mut header = String::new();
    header.push_str("/**\n");
    header.push_str(" * htmx 4.0\n");
    header.push_str(&format!(" * Generated: {}\n", timestamp));
    header.push_str(" *\n");
    header.push_str(" * Modules:\n");
    for ext in extensions {
        if ext.description.is_empty() {
            header.push_str(&format!(" * - {}\n", ext.name));
        } else {
            header.push_str(&format!(" * - {:width$}{}\n", ext.name, ext.description, width = pad));
        }
    }
    header.push_str(" */\n");
    header
}

/// Find the end of leading comments (line comments, block comments, blank lines).
/// This is the position where the generated header replaces everything before it.
fn find_header_end(source: &str) -> usize {
    let mut pos = 0;
    let bytes = source.as_bytes();
    let len = bytes.len();

    while pos < len {
        // Skip whitespace/newlines
        if bytes[pos] == b' ' || bytes[pos] == b'\t' || bytes[pos] == b'\n' || bytes[pos] == b'\r' {
            pos += 1;
            continue;
        }

        // Skip line comments: // ...
        if pos + 1 < len && bytes[pos] == b'/' && bytes[pos + 1] == b'/' {
            while pos < len && bytes[pos] != b'\n' { pos += 1; }
            if pos < len { pos += 1; } // skip the newline
            continue;
        }

        // Skip block comments: /** ... */ or /* ... */
        if pos + 1 < len && bytes[pos] == b'/' && bytes[pos + 1] == b'*' {
            if let Some(end) = source[pos + 2..].find("*/") {
                pos = pos + 2 + end + 2; // skip past */
                // Skip trailing newline after block comment
                if pos < len && bytes[pos] == b'\n' { pos += 1; }
                continue;
            }
        }

        // Non-comment, non-whitespace — this is where real code starts
        break;
    }

    pos
}

pub fn assemble_simple(source: &str, extensions: &[Extension], order: &[usize]) -> Result<String, AssemblyError> {
    let start_marker = "    // ── Extensions: Start";
    let end_marker = "    // ── Extensions: End";

    let start_pos = source.find(start_marker).ok_or_else(|| AssemblyError {
        messages: vec!["'// ── Extensions: Start' marker not found in kernel".into()],
    })?;
    let end_pos = source.find(end_marker).ok_or_else(|| AssemblyError {
        messages: vec!["'// ── Extensions: End' marker not found in kernel".into()],
    })?;

    let start_line_end = source[start_pos..].find('\n').map(|p| start_pos + p + 1).unwrap_or(source.len());

    let ordered_exts: Vec<&Extension> = order.iter().map(|&i| &extensions[i]).collect();

    let dash = |tag: &str| "─".repeat(72usize.saturating_sub(6 + tag.len()));

    let mut out = String::with_capacity(source.len() * 2);

    let hdr_end = find_header_end(source);
    out.push_str(&build_header(&ordered_exts));

    out.push_str(&source[hdr_end..start_line_end]);
    out.push('\n');

    for &idx in order {
        let ext = &extensions[idx];
        let tag = format!("[{}]", ext.name);
        let close_tag = format!("[/{}]", ext.name);
        let label = make_label(&ext.name);

        out.push_str(&format!("    // ── {} {}\n", tag, dash(&tag)));
        out.push_str(&format!("    {}: {{\n", label));

        let install_text = ext.source_text.replacen("htmx.install(", "install(", 1);
        for line in install_text.lines() {
            if line.trim().is_empty() {
                out.push('\n');
            } else {
                out.push_str(&format!("        {}\n", line));
            }
        }

        out.push_str("    }\n");
        out.push_str(&format!("    // ── {} {}\n\n", close_tag, dash(&close_tag)));
    }

    out.push_str(&source[end_pos..]);

    Ok(out)
}

pub fn assemble(source: &str, extensions: &[Extension], order: &[usize]) -> Result<String, AssemblyError> {
    let start_marker = "    // ── Extensions: Start";
    let end_marker = "    // ── Extensions: End";

    let start_pos = source.find(start_marker).ok_or_else(|| AssemblyError {
        messages: vec!["'// ── Extensions: Start' marker not found in kernel".into()],
    })?;
    let end_pos = source.find(end_marker).ok_or_else(|| AssemblyError {
        messages: vec!["'// ── Extensions: End' marker not found in kernel".into()],
    })?;
    let end_line_end = source[end_pos..].find('\n').map(|p| end_pos + p + 1).unwrap_or(source.len());

    let emit_sites = find_emit_sites(source);

    // ── Collect defines ─────────────────────────────────────────────────
    let mut all_defines: Vec<&Define> = Vec::new();
    let mut define_map: HashMap<String, &Define> = HashMap::new();
    let mut diagnostics: Vec<String> = Vec::new();
    let mut errors: Vec<String> = Vec::new();

    for &idx in order {
        let ext = &extensions[idx];
        for def in &ext.defines {
            if let Some(existing) = define_map.get(&def.fn_name) {
                errors.push(format!(
                    "error: extension '{}' defines '{}' — already defined by '{}'",
                    def.extension_name, def.fn_name, existing.extension_name
                ));
            } else {
                define_map.insert(def.fn_name.clone(), def);
                all_defines.push(def);
            }
        }
        if !ext.defines.is_empty() {
            diagnostics.push(format!("  defines from '{}': {}",
                ext.name,
                ext.defines.iter().map(|d| d.fn_name.as_str()).collect::<Vec<_>>().join(", ")));
        }
    }

    // ── Find api object location ────────────────────────────────────────
    let (api_decl_pos, api_close_pos) = {
        let tree = parse_js(source);
        let root = tree.root_node();
        let src = source.as_bytes();
        let decl = find_variable_declarator(root, "api", src)
            .ok_or_else(|| AssemblyError { messages: vec!["'const api = { ... }' not found in kernel".into()] })?;
        let value = decl.child_by_field_name("value")
            .ok_or_else(|| AssemblyError { messages: vec!["'const api' has no value".into()] })?;
        if value.kind() != "object" {
            return Err(AssemblyError { messages: vec!["'const api' value is not an object".into()] });
        }
        let parent = decl.parent()
            .ok_or_else(|| AssemblyError { messages: vec!["'const api' has no parent declaration".into()] })?;

        // Validate defines don't shadow existing kernel api members
        let mut cursor = value.walk();
        for child in value.children(&mut cursor) {
            if child.kind() == "shorthand_property_identifier" || child.kind() == "shorthand_property_identifier_pattern" {
                let name = child.utf8_text(src).unwrap();
                if define_map.contains_key(name) {
                    errors.push(format!(
                        "error: extension '{}' defines '{}' — already exists as a kernel function",
                        define_map[name].extension_name, name
                    ));
                }
            }
        }

        // Find start of the line containing `const api` (include leading whitespace)
        let decl_start = parent.start_byte();
        let line_start = source[..decl_start].rfind('\n').map(|p| p + 1).unwrap_or(0);

        (line_start, value.end_byte() - 1)
    };

    if !errors.is_empty() {
        return Err(AssemblyError { messages: errors });
    }

    // ── Collect and merge config entries ─────────────────────────────────
    struct KernelConfigProp {
        value_start: usize,
        value_end: usize,
        kind: String, // "array", "object", "scalar"
    }

    let (config_close_pos, kernel_config_props) = {
        let tree = parse_js(source);
        let root = tree.root_node();
        let src = source.as_bytes();

        let decl = find_variable_declarator(root, "config", src)
            .ok_or_else(|| AssemblyError { messages: vec!["'const config = { ... }' not found in kernel".into()] })?;
        let value = decl.child_by_field_name("value")
            .ok_or_else(|| AssemblyError { messages: vec!["'const config' has no value".into()] })?;
        if value.kind() != "object" {
            return Err(AssemblyError { messages: vec!["'const config' value is not an object".into()] });
        }

        let mut props: HashMap<String, KernelConfigProp> = HashMap::new();
        let mut cursor = value.walk();
        for child in value.children(&mut cursor) {
            if child.kind() != "pair" { continue; }
            let Some(key_node) = child.child_by_field_name("key") else { continue };
            let Some(val_node) = child.child_by_field_name("value") else { continue };

            let key = key_node.utf8_text(src).unwrap().to_string();
            let kind = match val_node.kind() {
                "array" => "array",
                "object" => "object",
                _ => "scalar",
            }.to_string();

            props.insert(key, KernelConfigProp {
                value_start: val_node.start_byte(),
                value_end: val_node.end_byte(),
                kind,
            });
        }

        (value.end_byte() - 1, props)
    };

    // Merge extension config entries in topological order
    let mut config_replacements: Vec<(usize, usize, String)> = Vec::new(); // (start, end, new_text)
    let mut config_new_entries: Vec<(String, String)> = Vec::new();  // (extension_name, entry_text)
    let mut claimed_keys: HashMap<String, String> = HashMap::new(); // key -> first extension name

    // Track items/properties accumulated for existing kernel config values
    // Each item carries provenance (extension name) for attribution in output
    let mut array_items: HashMap<String, Vec<(String, String)>> = HashMap::new(); // key -> [(ext_name, item_text)]
    let mut object_props: HashMap<String, Vec<(String, String, String)>> = HashMap::new(); // key -> [(ext_name, prop_key, prop_val)]

    for &idx in order {
        let ext = &extensions[idx];
        for entry in &ext.configs {
            if let Some(kprop) = kernel_config_props.get(&entry.key) {
                // Key exists in kernel config — merge based on type
                match kprop.kind.as_str() {
                    "array" => {
                        // Parse extension value as array, extract items
                        let items = extract_array_item_texts(&entry.value_text);
                        let tagged: Vec<(String, String)> = items.into_iter()
                            .map(|item| (ext.name.clone(), item))
                            .collect();
                        array_items.entry(entry.key.clone()).or_default().extend(tagged);
                    }
                    "object" => {
                        // Parse extension value as object, extract properties
                        let props = extract_object_prop_texts(&entry.value_text);
                        let tagged: Vec<(String, String, String)> = props.into_iter()
                            .map(|(k, v)| (ext.name.clone(), k, v))
                            .collect();
                        object_props.entry(entry.key.clone()).or_default().extend(tagged);
                    }
                    _ => {
                        // Scalar: first writer wins, skip
                    }
                }
            } else if !claimed_keys.contains_key(&entry.key) {
                // New key — add it
                claimed_keys.insert(entry.key.clone(), ext.name.clone());
                config_new_entries.push((ext.name.clone(), format!("{}: {},", entry.key, entry.value_text)));
            }
            // else: key already claimed by earlier extension, skip (scalars)
            // For arrays/objects on claimed (non-kernel) keys, we'd need more logic,
            // but in practice new keys are scalars or set once.
        }
        if !ext.configs.is_empty() {
            diagnostics.push(format!("  config from '{}': {}",
                ext.name,
                ext.configs.iter().map(|c| c.key.as_str()).collect::<Vec<_>>().join(", ")));
        }
    }

    // Build replacements for kernel config values that got extended
    for (key, items) in &array_items {
        if let Some(kprop) = kernel_config_props.get(key) {
            // Parse the kernel's existing array to get its items (no provenance)
            let kernel_text = &source[kprop.value_start..kprop.value_end];
            let kernel_items: Vec<(String, String)> = extract_array_item_texts(kernel_text)
                .into_iter().map(|item| (String::new(), item)).collect();
            let mut all_items: Vec<(String, String)> = kernel_items;
            all_items.extend(items.iter().cloned());
            // Format as single-line or multi-line based on item count
            let new_text = if all_items.len() <= 3 {
                // Single-line: add /* [ext] */ after extension-contributed items
                let parts: Vec<String> = all_items.iter().map(|(ext, item)| {
                    if ext.is_empty() { item.clone() }
                    else { format!("{} /* [{}] */", item, ext) }
                }).collect();
                format!("[{}]", parts.join(", "))
            } else {
                let item_indent = "            ";
                let mut out = String::from("[\n");
                for (ext, item) in &all_items {
                    if ext.is_empty() {
                        out.push_str(&format!("{}{},\n", item_indent, item));
                    } else {
                        out.push_str(&format!("{}{}, // [{}]\n", item_indent, item, ext));
                    }
                }
                out.push_str("        ]");
                out
            };
            config_replacements.push((kprop.value_start, kprop.value_end, new_text));
        }
    }

    for (key, props) in &object_props {
        if let Some(kprop) = kernel_config_props.get(key) {
            let kernel_text = &source[kprop.value_start..kprop.value_end];
            let kernel_props: Vec<(String, String, String)> = extract_object_prop_texts(kernel_text)
                .into_iter().map(|(k, v)| (String::new(), k, v)).collect();
            let mut all_props = kernel_props;
            // Per-key ??= — only add if not already present
            let existing_keys: Vec<String> = all_props.iter().map(|(_, k, _)| k.clone()).collect();
            for (ext, k, v) in props {
                if !existing_keys.contains(k) {
                    all_props.push((ext.clone(), k.clone(), v.clone()));
                }
            }
            let parts: Vec<String> = all_props.iter().map(|(ext, k, v)| {
                if ext.is_empty() { format!("{}: {}", k, v) }
                else { format!("{}: {} /* [{}] */", k, v, ext) }
            }).collect();
            let new_text = format!("{{{}}}", parts.join(", "));
            config_replacements.push((kprop.value_start, kprop.value_end, new_text));
        }
    }

    // ── Extract declarative wraps from install() wrap: key ─────────────
    let mut all_wraps: Vec<Wrap> = Vec::new();
    let mut all_runtime_wraps: Vec<RuntimeWrap> = Vec::new();

    for &idx in order {
        let ext = &extensions[idx];
        let (decl_wraps, rt_wraps) = parse_declarative_wraps(&ext.source_text, &ext.name);
        if !decl_wraps.is_empty() {
            diagnostics.push(format!("  wraps from '{}': {}",
                ext.name,
                decl_wraps.iter().map(|w| w.target_fn.as_str()).collect::<Vec<_>>().join(", ")));
        }
        if !rt_wraps.is_empty() {
            diagnostics.push(format!("  runtime wraps from '{}' (not inlined): {}",
                ext.name,
                rt_wraps.iter().map(|w| w.extension_name.as_str()).collect::<Vec<_>>().join(", ")));
        }
        all_wraps.extend(decl_wraps);
        all_runtime_wraps.extend(rt_wraps);
    }

    // ── Find kernel functions ───────────────────────────────────────────
    let target_names: Vec<&str> = all_wraps.iter().map(|w| w.target_fn.as_str()).collect();
    let kernel_fns = find_kernel_functions(source, &target_names);

    // ── Group wraps by target function ──────────────────────────────────
    let mut wraps_by_fn: HashMap<String, Vec<usize>> = HashMap::new();
    let mut wraps_on_defines: HashMap<String, Vec<usize>> = HashMap::new();

    for (i, wrap) in all_wraps.iter().enumerate() {
        if let Some(kfn) = kernel_fns.get(&wrap.target_fn) {
            if wrap.params != kfn.params {
                errors.push(format!(
                    "error: extension '{}' wraps '{}' with mismatched params: {:?} vs {:?}",
                    wrap.extension_name, wrap.target_fn, wrap.params, kfn.params
                ));
            } else {
                wraps_by_fn.entry(wrap.target_fn.clone()).or_default().push(i);
            }
        } else if let Some(def) = define_map.get(&wrap.target_fn) {
            if wrap.params != def.params {
                errors.push(format!(
                    "error: extension '{}' wraps '{}' with mismatched params: {:?} vs {:?}",
                    wrap.extension_name, wrap.target_fn, wrap.params, def.params
                ));
            } else {
                wraps_on_defines.entry(wrap.target_fn.clone()).or_default().push(i);
            }
        } else {
            // Extension wraps a non-kernel function (e.g., api.parse installed by
            // another extension at boot). Skip — these stay as runtime api.wrap() calls.
            eprintln!("  skip: extension '{}' wraps '{}' (not a kernel function, stays as runtime wrap)",
                wrap.extension_name, wrap.target_fn);
        }
    }

    if !errors.is_empty() {
        return Err(AssemblyError { messages: errors });
    }

    // ── Build rewritten function bodies (named function chains) ────────
    let mut fn_rewrites: HashMap<usize, String> = HashMap::new();
    let fn_indent = "        ";

    let dash = |tag: &str| "─".repeat(72usize.saturating_sub(6 + tag.len()));

    for (fn_name, wrap_indices) in &wraps_by_fn {
        let kfn = &kernel_fns[fn_name];
        let original_body = &source[kfn.body_start..kfn.body_end];

        let wraps: Vec<&Wrap> = wrap_indices.iter().map(|&i| &all_wraps[i]).collect();
        let new_body = build_wrap_chain(fn_name, original_body, &kfn.params, &wraps, fn_indent, &dash);

        fn_rewrites.insert(kfn.body_start, new_body);
    }

    // ── Build rewritten define function texts ──────────────────────────
    let mut define_fn_texts: HashMap<String, String> = HashMap::new();

    let def_indent = "    ";
    for def in &all_defines {
        if let Some(wrap_indices) = wraps_on_defines.get(&def.fn_name) {
            let wraps: Vec<&Wrap> = wrap_indices.iter().map(|&i| &all_wraps[i]).collect();
            let new_body = build_wrap_chain(&def.fn_name, &def.body, &def.params, &wraps, def_indent, &dash);

            // Reconstruct the function declaration with the rewritten body
            let params_text: Vec<&str> = def.params.iter().map(|s| s.as_str()).collect();
            let is_async = def.fn_text.starts_with("async");
            define_fn_texts.insert(def.fn_name.clone(),
                format!("{}function {}({}) {{{}\n}}", if is_async { "async " } else { "" },
                    def.fn_name, params_text.join(", "), new_body));
        }
    }

    // ── Build event → handlers map ──────────────────────────────────────
    let mut event_handlers: HashMap<String, Vec<(usize, usize)>> = HashMap::new();
    for &idx in order {
        for (h_idx, handler) in extensions[idx].handlers.iter().enumerate() {
            if handler.event != "htmx:boot" {
                event_handlers.entry(handler.event.clone()).or_default().push((idx, h_idx));
            }
        }
    }

    // ── Check for orphan handlers (no matching emit site) ─────────────
    // Collect all known emit sites: kernel source + define function bodies + on handler bodies
    let mut all_emit_events: HashSet<String> = HashSet::new();
    for site in &emit_sites {
        all_emit_events.insert(site.event_name.clone());
    }
    for def in &all_defines {
        let fn_text = define_fn_texts.get(&def.fn_name)
            .map(|s| s.as_str())
            .unwrap_or(&def.fn_text);
        for site in find_emit_sites(fn_text) {
            all_emit_events.insert(site.event_name);
        }
    }
    // Also scan on-handler bodies for emit sites (handles recursive inlining)
    for ext in extensions {
        for handler in &ext.handlers {
            for site in find_emit_sites(&handler.body) {
                all_emit_events.insert(site.event_name);
            }
        }
    }
    // Error on any handler event that has no emit site
    let mut orphan_errors: Vec<String> = Vec::new();
    for (event, handlers) in &event_handlers {
        if !all_emit_events.contains(event.as_str()) {
            let ext_names: Vec<&str> = handlers.iter()
                .map(|&(ext_idx, _)| extensions[ext_idx].name.as_str())
                .collect();
            orphan_errors.push(format!(
                "error: no emit site for '{}' — handler(s) from [{}] would be silently dropped\n\
                 \n\
                    = help: '{}' is not emitted by the kernel or any define function.\n\
                    In --inline mode, these handlers have nowhere to be injected.\n\
                    Either add an api.emit() call for this event in the kernel/define,\n\
                    or keep these extensions as runtime install() calls.",
                event, ext_names.join(", "), event,
            ));
        }
    }
    if !orphan_errors.is_empty() {
        return Err(AssemblyError { messages: orphan_errors });
    }

    let ordered_exts: Vec<&Extension> = order.iter().map(|&i| &extensions[i]).collect();

    let mut out = String::with_capacity(source.len() * 2);

    // ── Header ──────────────────────────────────────────────────────────
    let hdr_end = find_header_end(source);
    out.push_str(&build_header(&ordered_exts));

    let mut cursor = hdr_end;

    let mut inject_points: Vec<(usize, InjectKind)> = Vec::new();
    // Config: replacements for existing values (array extend, object merge)
    for (start, end, new_text) in config_replacements {
        inject_points.push((start, InjectKind::ConfigReplace { end_pos: end, new_text }));
    }
    // Config: new properties at end of config object
    if !config_new_entries.is_empty() {
        inject_points.push((config_close_pos, InjectKind::ConfigNewProps { entries: config_new_entries }));
    }
    if !all_defines.is_empty() {
        inject_points.push((api_decl_pos, InjectKind::DefineFns));
        inject_points.push((api_close_pos, InjectKind::ApiMembers));
    }
    inject_points.push((start_pos, InjectKind::Boot));
    for site in &emit_sites {
        if event_handlers.contains_key(&site.event_name) {
            inject_points.push((site.line_start, InjectKind::EmitSite {
                event_name: site.event_name.clone(),
                indent: site.indent.clone(),
            }));
        }
    }
    for (&body_start, _) in &fn_rewrites {
        inject_points.push((body_start, InjectKind::FnRewrite { body_start }));
    }
    inject_points.sort_by_key(|&(pos, _)| pos);

    // Pre-compute handler function name collision detection for kernel emit sites
    let kernel_needs_suffix: HashSet<&str> = {
        let mut ext_counts: HashMap<&str, usize> = HashMap::new();
        for site in &emit_sites {
            if let Some(handlers) = event_handlers.get(&site.event_name) {
                for &(ext_idx, _) in handlers {
                    *ext_counts.entry(extensions[ext_idx].name.as_str()).or_default() += 1;
                }
            }
        }
        ext_counts.into_iter()
            .filter(|(_, count)| *count > 1)
            .map(|(name, _)| name)
            .collect()
    };

    for (pos, kind) in &inject_points {
        if *pos > cursor {
            out.push_str(&source[cursor..*pos]);
        }

        match kind {
            InjectKind::ConfigReplace { end_pos, new_text } => {
                out.push_str(new_text);
                cursor = *end_pos;
            }
            InjectKind::ConfigNewProps { entries } => {
                // Group consecutive entries by extension for cleaner output
                let mut i = 0;
                while i < entries.len() {
                    let (ext_name, _) = &entries[i];
                    out.push_str(&format!("\n        // [{}]\n", ext_name));
                    while i < entries.len() && entries[i].0 == *ext_name {
                        out.push_str(&format!("        {}\n", entries[i].1));
                        i += 1;
                    }
                }
                out.push_str("    ");
                cursor = *pos;
            }
            InjectKind::DefineFns => {
                for def in &all_defines {
                    let tag = format!("[{}]", def.extension_name);
                    let close_tag = format!("[/{}]", def.extension_name);

                    out.push_str(&format!("\n    // ── {} {}\n", tag, dash(&tag)));
                    if !def.doc.is_empty() {
                        out.push_str(&indent(&def.doc, "    "));
                        out.push('\n');
                    }
                    // Use rewritten text if wraps were applied, otherwise original
                    let fn_text = define_fn_texts.get(&def.fn_name)
                        .map(|s| s.as_str())
                        .unwrap_or(&def.fn_text);
                    // Inject event handlers at api.emit() sites within define bodies
                    let fn_text_with_handlers = inject_handlers_in_text(
                        fn_text, &event_handlers, extensions, &dash,
                    );
                    out.push_str(&indent(&fn_text_with_handlers, "    "));
                    out.push('\n');
                    out.push_str(&format!("    // ── {} {}\n", close_tag, dash(&close_tag)));
                }
                cursor = *pos;
            }
            InjectKind::ApiMembers => {
                for def in &all_defines {
                    out.push_str(&format!("    {},\n    ", def.fn_name));
                }
                cursor = *pos;
            }
            InjectKind::Boot => {
                let marker_line_end = source[start_pos..]
                    .find('\n').map(|p| start_pos + p + 1).unwrap_or(source.len());
                out.push_str(&source[start_pos..marker_line_end]);
                out.push('\n');

                for &idx in order {
                    let ext = &extensions[idx];
                    let Some(boot) = ext.handlers.iter().find(|h| h.event == "htmx:boot") else { continue; };

                    let body_dedented = dedent(&boot.body);
                    if body_dedented.trim().is_empty() { continue; }

                    let tag = format!("[{}]", ext.name);
                    let close_tag = format!("[/{}]", ext.name);
                    let fn_name = format!("__{}_boot", make_label(&ext.name));

                    out.push_str(&format!("    // ── {} {}\n", tag, dash(&tag)));
                    out.push_str(&format!("    function {}({}, {}) {{\n",
                        fn_name, boot.params.0, boot.params.1));

                    let processed = inject_handlers_in_text(
                        &body_dedented, &event_handlers, extensions, &dash,
                    );
                    out.push_str(&indent(&processed, "        "));
                    out.push('\n');

                    out.push_str("    }\n");
                    out.push_str(&format!("    {}({{}}, api)\n", fn_name));
                    out.push_str(&format!("    // ── {} {}\n\n", close_tag, dash(&close_tag)));
                }

                // Emit runtime install() calls for non-inlinable wraps (e.g., IIFE patterns).
                // Note: requires is omitted because dependencies are already inlined.
                for rt_wrap in &all_runtime_wraps {
                    let tag = format!("[{}]", rt_wrap.extension_name);
                    let close_tag = format!("[/{}]", rt_wrap.extension_name);

                    out.push_str(&format!("    // ── {} {} (runtime)\n", tag, dash(&tag)));
                    out.push_str(&format!("    htmx.install('{}', {{{}}});\n", rt_wrap.extension_name, rt_wrap.wrap_source));
                    out.push_str(&format!("    // ── {} {}\n\n", close_tag, dash(&close_tag)));
                }

                cursor = end_line_end;
            }
            InjectKind::EmitSite { event_name, indent: site_indent } => {
                if let Some(handlers) = event_handlers.get(event_name.as_str()) {
                    out.push('\n');
                    for &(ext_idx, h_idx) in handlers {
                        let ext = &extensions[ext_idx];
                        let handler = &ext.handlers[h_idx];
                        let tag = format!("[{}]", ext.name);
                        let close_tag = format!("[/{}]", ext.name);
                        let fn_name = handler_fn_name(&ext.name, event_name,
                            kernel_needs_suffix.contains(ext.name.as_str()));

                        // Recursively inject handlers into this handler's body
                        let dedented = dedent(&handler.body);
                        let processed = inject_handlers_in_text(
                            &dedented, &event_handlers, extensions, &dash,
                        );

                        out.push_str(&format!("{}// ── {} {}\n", site_indent, tag, dash(&tag)));
                        out.push_str(&format!("{}function {}({}, {}) {{\n",
                            site_indent, fn_name, handler.params.0, handler.params.1));
                        let extra_indent = format!("{}    ", site_indent);
                        out.push_str(&indent(&processed, &extra_indent));
                        out.push('\n');
                        out.push_str(&format!("{}}}\n", site_indent));
                        out.push_str(&format!("{}if ({}({}, {}) === false) return false\n",
                            site_indent, fn_name, handler.params.0, handler.params.1));
                        out.push_str(&format!("{}// ── {} {}\n\n", site_indent, close_tag, dash(&close_tag)));
                    }
                }
                cursor = *pos;
            }
            InjectKind::FnRewrite { body_start } => {
                let kfn = kernel_fns.values().find(|f| f.body_start == *body_start).unwrap();
                out.push_str(&fn_rewrites[body_start]);
                cursor = kfn.body_end;
            }
        }
    }

    if cursor < source.len() {
        out.push_str(&source[cursor..]);
    }

    // ── Inject extension docs into kernel function JSDoc blocks ──────
    let mut fn_wrap_docs: HashMap<String, Vec<(String, String)>> = HashMap::new();
    for wrap in &all_wraps {
        fn_wrap_docs.entry(wrap.target_fn.clone())
            .or_default()
            .push((wrap.extension_name.clone(), wrap.doc.clone()));
    }
    let out = inject_wrap_docs(&out, &fn_wrap_docs);

    // Print diagnostics to stderr
    for d in &diagnostics {
        eprintln!("{}", d);
    }

    Ok(out)
}

// ── Tests ────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;

    // ── rename_original tests ────────────────────────────────────────────

    #[test]
    fn test_rename_original_simple() {
        let body = "let x = original(a, b)";
        let result = rename_original(body, "__attr_kernel");
        assert_eq!(result, "let x = __attr_kernel(a, b)");
    }

    #[test]
    fn test_rename_original_no_match() {
        let body = "let x = foo(a, b)";
        let result = rename_original(body, "__attr_kernel");
        assert_eq!(result, "let x = foo(a, b)");
    }

    #[test]
    fn test_rename_original_multiple() {
        let body = "if (x) return original(a)\nreturn original(b)";
        let result = rename_original(body, "__fn_ext");
        assert!(result.contains("__fn_ext(a)"));
        assert!(result.contains("__fn_ext(b)"));
        assert!(!result.contains("original"));
    }

    #[test]
    fn test_rename_original_in_conditional() {
        let body = "if (cond) {\n    return original(a, b)\n}\nreturn original(c)";
        let result = rename_original(body, "__f");
        assert!(result.contains("__f(a, b)"));
        assert!(result.contains("__f(c)"));
        assert!(!result.contains("original"));
    }

    #[test]
    fn test_rename_original_skips_nested_functions() {
        let body = "const fn = () => original()\nreturn original(x)";
        let result = rename_original(body, "__replaced");
        // The top-level original(x) should be renamed
        assert!(result.contains("__replaced(x)"));
        // The nested arrow function's original() should be left alone
        assert!(result.contains("() => original()"));
    }

    #[test]
    fn test_rename_original_skips_strings() {
        let body = "let s = \"original\"\nreturn original(x)";
        let result = rename_original(body, "__r");
        assert!(result.contains("\"original\""));
        assert!(result.contains("__r(x)"));
    }

    // ── build_wrap_chain tests ───────────────────────────────────────────

    #[test]
    fn test_chain_single_wrap() {
        let wrap = Wrap {
            target_fn: "attr".into(),
            params: vec!["element".into(), "name".into()],
            body: "if (x) return original(element, name)\nreturn original(element, name)".into(),
            extension_name: "my-ext".into(),
            doc: String::new(),
        };
        let dash = |tag: &str| "─".repeat(72usize.saturating_sub(6 + tag.len()));
        let result = build_wrap_chain(
            "attr",
            "\nreturn element.getAttribute(name)\n",
            &["element".into(), "name".into()],
            &[&wrap],
            "    ",
            &dash,
        );
        // Should contain kernel function
        assert!(result.contains("function __attr_kernel(element, name)"));
        assert!(result.contains("element.getAttribute(name)"));
        // Outermost wrap body should be emitted directly (not in a function)
        assert!(!result.contains("function __attr_my_ext"));
        // original should be renamed to __attr_kernel
        assert!(result.contains("__attr_kernel(element, name)"));
        assert!(!result.contains("original("));
    }

    #[test]
    fn test_chain_multiple_wraps() {
        let inner = Wrap {
            target_fn: "f".into(),
            params: vec!["x".into()],
            body: "return original(x + 1)".into(),
            extension_name: "inner".into(),
            doc: String::new(),
        };
        let outer = Wrap {
            target_fn: "f".into(),
            params: vec!["x".into()],
            body: "return original(x * 2)".into(),
            extension_name: "outer".into(),
            doc: String::new(),
        };
        let dash = |tag: &str| "─".repeat(72usize.saturating_sub(6 + tag.len()));
        let result = build_wrap_chain(
            "f",
            "\nreturn x\n",
            &["x".into()],
            &[&inner, &outer],
            "    ",
            &dash,
        );
        // Should have kernel function
        assert!(result.contains("function __f_kernel(x)"));
        // Inner wrap should be a named function calling kernel
        assert!(result.contains("function __f_inner(x)"));
        assert!(result.contains("__f_kernel(x + 1)"));
        // Outer wrap body should be inline, calling inner
        assert!(!result.contains("function __f_outer"));
        assert!(result.contains("__f_inner(x * 2)"));
    }

    #[test]
    fn test_chain_preserves_wrap_body() {
        let wrap = Wrap {
            target_fn: "attr".into(),
            params: vec!["el".into(), "name".into()],
            body: "if (cond) {\n    let r = original(el, name)\n    if (r) return r\n}\nreturn original(el, name)".into(),
            extension_name: "complex".into(),
            doc: String::new(),
        };
        let dash = |_: &str| String::new();
        let result = build_wrap_chain(
            "attr",
            "\nreturn el.getAttribute(name)\n",
            &["el".into(), "name".into()],
            &[&wrap],
            "",
            &dash,
        );
        // Both original() calls should be renamed
        assert!(!result.contains("original("));
        // Complex logic preserved
        assert!(result.contains("if (cond)"));
        assert!(result.contains("if (r) return r"));
    }

    // ── handler injection tests ──────────────────────────────────────────

    #[test]
    fn test_handler_named_function() {
        let ext = Extension {
            name: "my-ext".into(),
            requires: vec![],
            handlers: vec![Handler {
                event: "htmx:before:trigger".into(),
                params: ("detail".into(), "api".into()),
                body: "if (!detail.ok) return false".into(),
            }],
            defines: vec![],
            configs: vec![],
            define_errors: vec![],
            source_path: String::new(),
            source_text: String::new(),
            description: String::new(),
        };
        let mut event_handlers: HashMap<String, Vec<(usize, usize)>> = HashMap::new();
        event_handlers.insert("htmx:before:trigger".into(), vec![(0, 0)]);
        let dash = |_: &str| String::new();

        let text = "    if (canceled(api.emit(el, 'htmx:before:trigger', detail))) return";
        let result = inject_handlers_in_text(text, &event_handlers, &[ext], &dash);

        assert!(result.contains("function __my_ext(detail, api)"));
        assert!(result.contains("if (__my_ext(detail, api) === false) return false"));
        assert!(result.contains("if (!detail.ok) return false"));
    }

    #[test]
    fn test_handler_collision_disambiguation() {
        let ext = Extension {
            name: "my-ext".into(),
            requires: vec![],
            handlers: vec![
                Handler {
                    event: "htmx:before:trigger".into(),
                    params: ("detail".into(), "api".into()),
                    body: "// handler 1".into(),
                },
                Handler {
                    event: "htmx:after:trigger".into(),
                    params: ("detail".into(), "api".into()),
                    body: "// handler 2".into(),
                },
            ],
            defines: vec![],
            configs: vec![],
            define_errors: vec![],
            source_path: String::new(),
            source_text: String::new(),
            description: String::new(),
        };
        let mut event_handlers: HashMap<String, Vec<(usize, usize)>> = HashMap::new();
        event_handlers.insert("htmx:before:trigger".into(), vec![(0, 0)]);
        event_handlers.insert("htmx:after:trigger".into(), vec![(0, 1)]);
        let dash = |_: &str| String::new();

        let text = "api.emit(el, 'htmx:before:trigger', d)\napi.emit(el, 'htmx:after:trigger', d)";
        let result = inject_handlers_in_text(text, &event_handlers, &[ext], &dash);

        // Same extension at two emit sites → suffixed names
        assert!(result.contains("__my_ext_before_trigger"));
        assert!(result.contains("__my_ext_after_trigger"));
    }

    // ── event_action_suffix tests ────────────────────────────────────────

    #[test]
    fn test_event_action_suffix() {
        assert_eq!(event_action_suffix("htmx:before:trigger"), "_before_trigger");
        assert_eq!(event_action_suffix("htmx:after:walk:init"), "_after_walk_init");
        assert_eq!(event_action_suffix("custom:event"), "_custom_event");
    }

    // ── integration tests ────────────────────────────────────────────────

    #[test]
    fn test_full_wrap_chain_assembly() {
        let kernel = r#"(function() {
    // ── Extensions: Start
    // ── Extensions: End

    const config = {
        x: 1,
    }

    function attr(element, name) {
        return element.getAttribute(name)
    }

    const api = {
        attr,
    }
})()"#;

        let ext_source = r#"htmx.install('prefix', {
    wrap: {
        attr: (original, element, name) => {
            let prefixed = 'data-' + name
            let result = original(element, prefixed)
            if (result !== null) return result
            return original(element, name)
        }
    }
})"#;
        let extensions = parse_extensions(ext_source, "test.js");
        let order = vec![0];
        let result = assemble(kernel, &extensions, &order).unwrap();

        assert!(result.contains("function __attr_kernel(element, name)"));
        assert!(result.contains("__attr_kernel(element, prefixed)"));
        assert!(result.contains("__attr_kernel(element, name)"));
        assert!(!result.contains("original("));
    }

    #[test]
    fn test_full_handler_assembly() {
        let kernel = r#"(function() {
    // ── Extensions: Start
    // ── Extensions: End

    const config = {
        x: 1,
    }

    function trigger(element) {
        if (canceled(api.emit(element, 'htmx:before:trigger', {}))) return
        element.click()
    }

    const api = {
        trigger,
    }
})()"#;

        let ext_source = r#"htmx.install('hx-confirm', {
    on: {
        'htmx:before:trigger': (detail, api) => {
            if (!detail.confirm) return false
        }
    }
})"#;
        let extensions = parse_extensions(ext_source, "test.js");
        let order = vec![0];
        let result = assemble(kernel, &extensions, &order).unwrap();

        assert!(result.contains("function __hx_confirm(detail, api)"));
        assert!(result.contains("if (__hx_confirm(detail, api) === false) return false"));
        assert!(result.contains("if (!detail.confirm) return false"));
    }

    #[test]
    fn test_runtime_wrap_preserved() {
        let kernel = r#"(function() {
    // ── Extensions: Start
    // ── Extensions: End

    const config = {
        x: 1,
    }

    const api = {
    }
})()"#;

        let ext_source = r#"htmx.install('request-queue', {
    wrap: {
        ajax: (() => {
            class Queue {}
            return (original, options) => original(options)
        })()
    }
})"#;
        let extensions = parse_extensions(ext_source, "test.js");
        let order = vec![0];
        let result = assemble(kernel, &extensions, &order).unwrap();

        // Runtime wrap should be emitted as install() call
        assert!(result.contains("htmx.install('request-queue'"));
    }
}
