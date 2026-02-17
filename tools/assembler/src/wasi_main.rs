// WASI entry point — reads JSON from stdin, writes assembled JS to stdout.
// Used by Cloudflare Workers via @cloudflare/workers-wasi.

fn main() {
    if let Err(e) = htmx::wasm::run() {
        eprintln!("{}", e);
        std::process::exit(1);
    }
}
