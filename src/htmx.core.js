// htmx 4.0
//
// Lifecycle: init → trigger → request → response → swap → settle
//
// Extensions add capabilities via the registry (swap methods, triggers, modifiers).
// The core handles the pipeline, syntax, and conventions.

var htmx = (function () {
    'use strict'

    // ── Config ───────────────────────────────────────────────────────────────
    //
    // Values can be static or functions: (context) => value
    // Use resolve(config.X, context) to get the final value.

    const config = {
        requestTimeout: 60000,
        requestCredentials: 'same-origin',
        requestMode: 'same-origin',
        requestHeaders: {
            'HX-Request': 'true',
            'HX-Current-URL': () => location.href,
        },

        defaultTrigger: node => {
            if (node.matches('form')) return 'submit'
            if (node.matches('input:not([type=button]), select, textarea')) return 'change'
            return 'click'
        },
        defaultSwap: 'innerHTML',
        defaultTarget: 'this',

        // Escape hatches for environments where hx-* causes issues
        attributePrefix: 'hx-',
        modifierDelimiter: ':',

        // Selectors that trigger init (extensions add to this)
        selectors: [],
    }

    // ── Registry ─────────────────────────────────────────────────────────────
    //
    // Extensions populate these to add capabilities.

    const registry = {
        swaps: {},              // method → fn(target, content)
        triggers: {},           // name → fn(element, modifiers, handler) → cleanup?
        modifiers: {
            trigger: {},        // name → fn(handler, value, element) → handler
        },
    }

    // ── Helpers ──────────────────────────────────────────────────────────────

    function resolve(value, context) {
        return typeof value === 'function' ? value(context) : value
    }

    // ── Extensions ───────────────────────────────────────────────────────────

    const extensions = []
    let booted = false

    function register(name, extension) {
        if (extensions.some(e => e.name === name)) {
            throw new Error(`htmx: extension "${name}" already registered`)
        }

        for (const dep of extension.requires || []) {
            if (!extensions.some(e => e.name === dep)) {
                throw new Error(`htmx: extension "${name}" requires "${dep}"`)
            }
        }

        extensions.push({name, ...extension})

        if (booted && extension.on?.['htmx:ready']) {
            extension.on['htmx:ready']({})
        }
    }

    // ── Boot ─────────────────────────────────────────────────────────────────

    function boot() {
        booted = true
        emit(document, 'htmx:ready')
        init(document.body)

        new MutationObserver(mutations => {
            for (const mutation of mutations) {
                for (const node of mutation.addedNodes) {
                    if (node.nodeType === 1) init(node)
                }
                for (const node of mutation.removedNodes) {
                    if (node.nodeType === 1) cleanupTree(node)
                }
            }
        }).observe(document.body, {childList: true, subtree: true})
    }

    function cleanupTree(root) {
        cleanup(root)
        for (const node of root.querySelectorAll('*')) {
            if (_state.has(node)) cleanup(node)
        }
    }

    // ── Init ─────────────────────────────────────────────────────────────────

    function init(root = document.body) {
        const selector = config.selectors.join(',')
        if (!selector) return

        const nodes = root.matches?.(selector)
            ? [root, ...root.querySelectorAll(selector)]
            : [...root.querySelectorAll(selector)]

        for (const node of nodes) {
            if (_state.has(node)) continue

            const element = wrap(node)
            emit(element, 'htmx:before:init', {element})
            setupTriggers(element)
            emit(element, 'htmx:after:init', {element})
        }
    }

    function cleanup(node) {
        if (!_state.has(node)) return

        const element = wrap(node)
        emit(element, 'htmx:before:cleanup', {element})

        for (const fn of state(node).cleanup || []) fn()
        _state.delete(node)

        emit(element, 'htmx:after:cleanup', {element})
    }

    // ── Trigger ──────────────────────────────────────────────────────────────

    function setupTriggers(element) {
        const node = element.native
        const defaultEvent = resolve(config.defaultTrigger, node)
        const raw = element.attr('hx-trigger')
        const specs = raw ? raw.split(/,(?![^\[]*\])/).map(s => s.trim()) : [defaultEvent]

        for (const spec of specs) {
            const {event, modifiers} = parseTriggerSpec(spec)
            const handler = wrapHandler(baseHandler(element), modifiers, element)

            // Synthetic trigger (load, revealed, every, intersect...)
            if (event in registry.triggers) {
                const off = registry.triggers[event](element, modifiers, handler)
                if (off) addCleanup(node, off)
                continue
            }

            // DOM event
            const targets = modifiers.from ? document.querySelectorAll(modifiers.from) : [node]
            for (const target of targets) {
                target.addEventListener(event || defaultEvent, handler, {once: modifiers.once})
                addCleanup(node, () => target.removeEventListener(event || defaultEvent, handler))
            }
        }
    }

    function baseHandler(element) {
        return event => {
            event.preventDefault?.()
            const source = {element, event}
            if (emit(element, 'htmx:before:trigger', {source}) === false) return
            emit(element, 'htmx:after:trigger', {source})
        }
    }

    function wrapHandler(handler, modifiers, element) {
        for (const [name, fn] of Object.entries(registry.modifiers.trigger)) {
            if (modifiers[name] !== undefined) {
                handler = fn(handler, modifiers[name], element)
            }
        }
        return handler
    }

    function parseTriggerSpec(spec) {
        // "every 2s" → "every interval:2s"
        const normalized = spec.replace(/^every\s+(\d+(?:ms|s|m)?)/, 'every interval:$1')
        const {value, ...modifiers} = parseModifiers(normalized)

        // "click[key=='Enter']" → event="click", filter="key=='Enter'"
        const match = value?.match(/^([^\[]+?)(?:\[(.+)])?$/)
        if (match?.[2]) modifiers.filter = match[2]

        return {event: match?.[1], modifiers}
    }

    function parseModifiers(raw) {
        if (!raw) return {value: null}

        const [value, ...parts] = raw.trim().split(/\s+/)
        const result = {value}

        for (const part of parts) {
            const i = part.indexOf(config.modifierDelimiter)
            if (i > 0) {
                const key = part.slice(0, i)
                const val = part.slice(i + 1)
                result[key] = parseDuration(val) ?? val
            } else {
                result[part] = true
            }
        }

        return result
    }

    function parseDuration(str) {
        const match = str?.match(/^(\d+)(ms|s|m)?$/)
        if (!match) return null
        const [, n, unit] = match
        return unit === 's' ? n * 1000 : unit === 'm' ? n * 60000 : +n
    }

    function addCleanup(node, fn) {
        const s = state(node)
        s.cleanup ||= []
        s.cleanup.push(fn)
    }

    // ── Fetch ────────────────────────────────────────────────────────────────

    async function request(url, options = {}) {
        const method = options.method || 'GET'
        const source = {
            element: options.source?.element || wrap(document.body),
            event: options.source?.event ?? null,
        }

        const detail = {
            source,
            request: {url, method, body: options.body ?? null, headers: {}},
            response: null,
            swap: null,
            error: null,
        }

        // Headers
        for (const [key, value] of Object.entries(config.requestHeaders)) {
            detail.request.headers[key] = resolve(value, {source, url, method})
        }
        Object.assign(detail.request.headers, options.headers)

        const controller = new AbortController()
        const timeout = setTimeout(() => controller.abort(), resolve(config.requestTimeout, source))

        try {
            // ── Request ──
            if (emit(source.element, 'htmx:before:request', detail) === false) return

            const response = await fetch(url, {
                method,
                headers: detail.request.headers,
                body: detail.request.body,
                credentials: resolve(config.requestCredentials, source),
                mode: resolve(config.requestMode, source),
                signal: controller.signal,
            })

            emit(source.element, 'htmx:after:request', detail)

            // ── Response ──
            detail.response = {
                status: response.status,
                ok: response.ok,
                url: response.url,
                headers: Object.fromEntries(response.headers),
                text: null,
            }

            if (emit(source.element, 'htmx:before:response', detail) === false) return
            detail.response.text = await response.text()
            if (emit(source.element, 'htmx:after:response', detail) === false) return

            // ── Swap ──
            const targetSelector = options.target || resolve(config.defaultTarget, source.element.native)
            const targetNode = resolveTarget(source.element.native, targetSelector)

            if (!targetNode) {
                detail.error = {type: 'target', message: `Target not found: ${targetSelector}`}
                emit(source.element, 'htmx:error', detail)
                return
            }

            const swapMethod = options.swap || resolve(config.defaultSwap, source.element.native)
            const swapFn = registry.swaps[swapMethod]

            if (!swapFn) {
                detail.error = {type: 'swap', message: `Unknown swap method: ${swapMethod}`}
                emit(source.element, 'htmx:error', detail)
                return
            }

            detail.swap = {
                target: wrap(targetNode),
                method: swapMethod,
                content: null,  // created after before:swap
            }

            if (emit(source.element, 'htmx:before:swap', detail) === false) return

            detail.swap.content = makeFragment(detail.response.text)
            const inserted = swapFn(targetNode, detail.swap.content)
            init(inserted || targetNode)

            emit(source.element, 'htmx:after:swap', detail)

            // ── Settle ──
            if (emit(source.element, 'htmx:before:settle', detail) === false) return
            emit(source.element, 'htmx:after:settle', detail)

            return detail.response

        } catch (error) {
            detail.error = {
                type: error.name === 'AbortError' ? 'timeout' : 'network',
                message: error.message,
                cause: error,
            }
            emit(source.element, 'htmx:error', detail)

        } finally {
            clearTimeout(timeout)
            emit(source.element, 'htmx:done', detail)
        }
    }

    // ── State ────────────────────────────────────────────────────────────────

    const _state = new WeakMap()

    function state(node) {
        let s = _state.get(node)
        if (!s) _state.set(node, s = {})
        return s
    }

    // ── Element Wrapper ──────────────────────────────────────────────────────

    const WRAPPED = Symbol('htmx.wrapped')

    function wrap(node) {
        if (!node) return null
        if (node[WRAPPED]) return node

        return new Proxy(node, {
            get(target, prop) {
                if (prop === WRAPPED) return true
                if (prop === 'native') return target
                if (prop === 'attr') return (name, opts) => attr(target, name, opts)
                if (prop === 'state') return state(target)
                if (prop === 'find') return sel => wrap(target.querySelector(sel))
                if (prop === 'findAll') return sel => [...target.querySelectorAll(sel)].map(wrap)
                if (prop === 'emit') return (name, detail) => emit(target, name, detail)
                if (prop === 'on') return (evt, fn, opts) => on(target, evt, fn, opts)

                const value = target[prop]
                return typeof value === 'function' ? value.bind(target) : value
            }
        })
    }

    function attr(node, name, {inherit = true} = {}) {
        const attrName = name.startsWith('hx-')
            ? config.attributePrefix + name.slice(3)
            : name

        let current = node
        while (current) {
            const value = current.getAttribute(attrName)
            if (value !== null) return value
            if (!inherit) return null
            current = current.parentElement
        }
        return null
    }

    // ── Events ───────────────────────────────────────────────────────────────

    function emit(target, name, detail = {}) {
        // Extension handlers first (can cancel)
        for (const ext of extensions) {
            if (ext.on?.[name]?.(detail) === false) return false
        }

        // DOM event
        const node = target?.native || target
        const el = node?.isConnected !== false ? node : document

        return el.dispatchEvent(new CustomEvent(name, {
            detail: unwrap(detail),
            bubbles: true,
            cancelable: true,
            composed: true,
        }))
    }

    function on(node, event, handler, options) {
        const target = node.native || node
        target.addEventListener(event, handler, options)
        const off = () => target.removeEventListener(event, handler, options)
        addCleanup(target, off)
        return off
    }

    function unwrap(obj) {
        if (!obj || typeof obj !== 'object') return obj
        if (obj[WRAPPED]) return obj.native
        if (Array.isArray(obj)) return obj.map(unwrap)

        const result = {}
        for (const [k, v] of Object.entries(obj)) {
            result[k] = unwrap(v)
        }
        return result
    }

    // ── DOM Helpers ──────────────────────────────────────────────────────────

    function resolveTarget(node, selector) {
        if (!selector || selector === 'this') return node
        if (selector === 'body') return document.body
        if (selector.startsWith('closest ')) return node.closest(selector.slice(8))
        if (selector.startsWith('find ')) return node.querySelector(selector.slice(5))
        return document.querySelector(selector)
    }

    function makeFragment(html) {
        const tpl = document.createElement('template')
        tpl.innerHTML = html
        return tpl.content
    }

    // ── Start ────────────────────────────────────────────────────────────────

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', boot)
    } else {
        queueMicrotask(boot)
    }

    // ── Public API ───────────────────────────────────────────────────────────

    return {
        version: '4.0.0',
        config,
        registry,

        register,
        init,
        request,

        emit,
        on,

        wrap,
        attr,
        state,

        resolve,
        resolveTarget,
        makeFragment,
    }
})()
