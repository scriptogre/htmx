import { WASI } from '@cloudflare/workers-wasi'
import assemblerWasm from '../assembler.wasm'
import sources from './sources.json'

export default {
    async fetch(request, env, ctx) {
        const url = new URL(request.url)
        const path = url.pathname

        // ── Route ────────────────────────────────────────────────────
        const match = path.match(/^\/(\d+\.\d+)\/(.+)$/)
        if (!match) {
            return new Response('htmx CDN\n\nUsage:\n  /4.0/htmx.js                standard build\n  /4.0/htmx.kernel.js         kernel only\n  /4.0/htmx.js?include=sse     standard + extras\n  /4.0/htmx.js?exclude=boost   standard minus\n  /4.0/htmx.js?only=ajax       kernel + specific\n  /4.0/htmx.js?inline          inline wraps at call sites (no runtime dispatch)\n\nFlags can be combined: /4.0/htmx.js?include=sse&inline\n', {
                status: 200,
                headers: { 'content-type': 'text/plain' }
            })
        }

        const version = match[1]
        const file = match[2]

        if (version !== '4.0') {
            return new Response(`Unknown version: ${version}`, { status: 404 })
        }

        if (file === 'htmx.kernel.js') {
            return respond(sources.kernel, 'kernel-only')
        }

        if (file !== 'htmx.js') {
            return new Response(`Not found: ${file}`, { status: 404 })
        }

        // ── Determine which extensions to include ────────────────────

        let extensionSources = [sources.extensions.core.source]
        let cacheKey = 'standard'

        const include = url.searchParams.get('include')
        const exclude = url.searchParams.get('exclude')
        const only = url.searchParams.get('only')
        const inline = url.searchParams.has('inline')

        if (only) {
            const requested = only.split(',').map(s => s.trim()).sort()
            const unknown = requested.filter(n => !sources.standard.includes(n))
            if (unknown.length) {
                return new Response(`Unknown extensions: ${unknown.join(', ')}\nAvailable: ${sources.standard.join(', ')}`, { status: 400 })
            }
            cacheKey = `only=${requested.join(',')}`
        } else if (exclude) {
            cacheKey = `exclude=${exclude.split(',').map(s => s.trim()).sort().join(',')}`
        } else if (include) {
            cacheKey = `include=${include.split(',').map(s => s.trim()).sort().join(',')}`
        }

        if (inline) cacheKey += '+inline'

        // ── Assemble via WASM ────────────────────────────────────────

        try {
            const input = JSON.stringify({
                kernel: sources.kernel,
                extensions: extensionSources,
                inline
            })

            const stdin = new ReadableStream({
                start(controller) {
                    controller.enqueue(new TextEncoder().encode(input))
                    controller.close()
                }
            })

            const stdout = new TransformStream()

            const wasi = new WASI({
                args: ['htmx-wasi'],
                stdin,
                stdout: stdout.writable,
            })

            const instance = new WebAssembly.Instance(assemblerWasm, {
                wasi_snapshot_preview1: wasi.wasiImport,
            })

            // Run WASM in background — proc_exit(0) throws, which is normal
            ctx.waitUntil(
                wasi.start(instance).catch(() => {})
            )

            return new Response(stdout.readable, {
                headers: {
                    'content-type': 'application/javascript; charset=utf-8',
                    'cache-control': 'public, max-age=31536000, immutable',
                    'x-htmx-version': sources.version,
                    'x-htmx-build': cacheKey,
                    'access-control-allow-origin': '*',
                }
            })
        } catch (e) {
            return new Response(`WASM error: ${e.message}\n${e.stack}`, {
                status: 500,
                headers: { 'content-type': 'text/plain' }
            })
        }
    }
}

function respond(js, buildType) {
    return new Response(js, {
        headers: {
            'content-type': 'application/javascript; charset=utf-8',
            'cache-control': 'public, max-age=31536000, immutable',
            'x-htmx-version': sources.version,
            'x-htmx-build': buildType,
            'access-control-allow-origin': '*',
        }
    })
}
