// htmx 4.0 — Kernel
//
// Pipeline: boot → init → trigger → fetch → swap → settle → done
//
// The kernel provides:
//   - Config (values: static or functions)
//   - Registry (implementations: always functions)
//   - Extension system (register, emit)
//   - Element wrapper with convenience methods
//   - The init/trigger/fetch/swap pipeline
//
// The kernel does nothing alone — extensions populate the registries.

var htmx = (function () {
    'use strict'

    // ╔═══════════════════════════════════════════════════════════════════════╗
    // ║ CONFIG (values: static or functions)                                   ║
    // ╚═══════════════════════════════════════════════════════════════════════╝

    const config = {
        // Trigger
        triggerEvent: node => {
            if (node.matches('form')) return 'submit'
            if (node.matches('input:not([type=button]), select, textarea')) return 'change'
            return 'click'
        },

        // Swap
        swapMethod: 'innerHTML',
        swapTarget: 'this',

        // Request
        requestTimeout: 60000,
        requestCredentials: 'same-origin',
        requestMode: 'same-origin',
        requestHeaders: {
            'HX-Request': 'true',
            'HX-Current-URL': () => location.href,
        },

        // Syntax
        syntaxPrefix: 'hx-',
        syntaxDelimiter: ':',

        // Init
        selectors: [],
    }

    // ╔═══════════════════════════════════════════════════════════════════════╗
    // ║ REGISTRY (implementations: always functions)                           ║
    // ╚═══════════════════════════════════════════════════════════════════════╝

    const registry = {
        triggers: {},       // synthetic triggers: fn(element, eventName, modifiers, handler) → cleanup?
        swaps: {},          // swap methods: fn(target, content) → void
        modifiers: {
            trigger: {},    // handler wrappers: fn(handler, value, element) → handler
            swap: {},       // option mutators: fn(options, value, element) → options
        },
    }

    // ╔═══════════════════════════════════════════════════════════════════════╗
    // ║ RESOLVE (helper for config values)                                     ║
    // ╚═══════════════════════════════════════════════════════════════════════╝

    function resolve(value, context) {
        return typeof value === 'function' ? value(context) : value
    }

    // ╔═══════════════════════════════════════════════════════════════════════╗
    // ║ EXTENSIONS                                                             ║
    // ╚═══════════════════════════════════════════════════════════════════════╝

    const extensions = []
    let booted = false

    function register(name, extension) {
        const exists = extensions.some(e => e.name === name)
        if (exists) throw new Error(`htmx: extension "${name}" already registered`)

        for (const dependency of extension.requires || []) {
            const satisfied = extensions.some(e => e.name === dependency)
            if (!satisfied) throw new Error(`htmx: extension "${name}" requires "${dependency}"`)
        }

        extensions.push({name, ...extension})

        // Late registration: fire ready handler immediately
        if (booted && extension.on?.['htmx:ready']) {
            extension.on['htmx:ready']({})
        }
    }

    // ╔═══════════════════════════════════════════════════════════════════════╗
    // ║ BOOT                                                                   ║
    // ╚═══════════════════════════════════════════════════════════════════════╝

    function boot() {
        booted = true
        emit(document, 'htmx:ready')
        init(document.body)
        observeDOM()
    }

    function observeDOM() {
        const observer = new MutationObserver(mutations => {
            for (const mutation of mutations) {
                for (const node of mutation.addedNodes) {
                    if (node.nodeType === 1) init(node)
                }
                for (const node of mutation.removedNodes) {
                    if (node.nodeType === 1) cleanupTree(node)
                }
            }
        })
        observer.observe(document.body, {childList: true, subtree: true})
    }

    function cleanupTree(root) {
        cleanup(root)
        for (const element of root.querySelectorAll('*')) {
            if (_state.has(element)) cleanup(element)
        }
    }

    // ╔═══════════════════════════════════════════════════════════════════════╗
    // ║ INIT                                                                   ║
    // ╚═══════════════════════════════════════════════════════════════════════╝

    function init(root = document.body) {
        const selector = config.selectors?.join(',')
        if (!selector) return

        const nodes = findMatchingNodes(root, selector)
        for (const node of nodes) {
            if (_state.has(node)) continue
            initElement(node, root)
        }
    }

    function findMatchingNodes(root, selector) {
        const descendants = root.querySelectorAll(selector)
        const rootMatches = root.matches?.(selector)
        return rootMatches ? [root, ...descendants] : [...descendants]
    }

    function initElement(node, root) {
        const element = wrap(node)
        const detail = {element, root: wrap(root)}

        emit(element, 'htmx:before:init', detail)
        setupTriggers(element)
        emit(element, 'htmx:after:init', detail)
    }

    function cleanup(node) {
        if (!_state.has(node)) return

        const element = wrap(node)
        emit(element, 'htmx:before:cleanup', {element})

        const cleanupFns = state(node)["cleanup"] || []
        for (const fn of cleanupFns) fn()
        _state.delete(node)

        emit(element, 'htmx:after:cleanup', {element})
    }

    // ╔═══════════════════════════════════════════════════════════════════════╗
    // ║ TRIGGER                                                                ║
    // ╚═══════════════════════════════════════════════════════════════════════╝

    function setupTriggers(element) {
        const node = element.native
        const defaultEvent = resolve(config.triggerEvent, node)
        const triggers = parseTriggerAttr(element.attr('hx-trigger'), defaultEvent)

        for (const trigger of triggers) {
            const {event: eventName, modifiers} = parseTrigger(trigger)
            const handler = buildHandler(element, modifiers)

            // Synthetic trigger (load, revealed, every, etc.)
            const synthetic = registry.triggers[eventName]
            if (synthetic) {
                const off = synthetic(element, eventName, modifiers, handler)
                if (off) addCleanup(node, off)
                continue
            }

            // DOM event
            bindEvent(node, eventName || defaultEvent, handler, modifiers)
        }
    }

    function parseTriggerAttr(raw, defaultEvent) {
        if (!raw) return [defaultEvent]
        // Split on commas, but not commas inside brackets
        return raw.split(/,(?![^\[]*\])/).map(s => s.trim())
    }

    function buildHandler(element, modifiers) {
        // Base handler: emit trigger events
        let handler = event => {
            event.preventDefault?.()
            const source = {element, event}
            if (emit(element, 'htmx:before:trigger', {source}) === false) return
            emit(element, 'htmx:after:trigger', {source})
        }

        // Wrap with modifiers
        for (const [name, fn] of Object.entries(registry.modifiers.trigger)) {
            if (modifiers[name] !== undefined && fn) {
                handler = fn(handler, modifiers[name], element)
            }
        }

        return handler
    }

    function bindEvent(node, eventName, handler, modifiers) {
        const targets = modifiers.from
            ? document.querySelectorAll(modifiers.from)
            : [node]

        for (const target of targets) {
            target.addEventListener(eventName, handler, {once: modifiers.once})
            addCleanup(node, () => target.removeEventListener(eventName, handler))
        }
    }

    function addCleanup(node, fn) {
        state(node)["cleanup"] ||= []
        state(node)["cleanup"].push(fn)
    }

    function parseTrigger(raw) {
        // Normalize "every 2s" → "every interval:2s"
        const normalized = raw.replace(/^every\s+(\d+(?:ms|s|m)?)/, 'every interval:$1')
        const {value: eventAndFilter, ...modifiers} = parse(normalized) || {}

        // Extract filter: "click[key=='Enter']" → event="click", filter="key=='Enter'"
        const match = eventAndFilter?.match(/^([^\[]+?)(?:\[(.+)])?$/)
        const [, event, filter] = match || []
        if (filter) modifiers.filter = filter

        return {event, modifiers}
    }

    // ╔═══════════════════════════════════════════════════════════════════════╗
    // ║ FETCH                                                                  ║
    // ╚═══════════════════════════════════════════════════════════════════════╝

    async function fetch(url, options = {}) {
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

        // Build headers (static values + functions)
        detail.request.headers = {
            ...resolveHeaders(config.requestHeaders, {source, url, method}),
            ...options.headers,
        }

        try {
            // ── Request ──
            if (emit(source.element, 'htmx:before:request', detail) === false) return

            const response = await window.fetch(url, {
                method: detail.request.method,
                headers: detail.request.headers,
                body: detail.request.body,
                credentials: resolve(config.requestCredentials, {source, url, method}),
                mode: resolve(config.requestMode, {source, url, method}),
            })

            emit(source.element, 'htmx:after:request', detail)

            // ── Response ──
            detail.response = {
                status: response.status,
                url: response.url,
                headers: Object.fromEntries(response.headers),
                text: null,
            }

            if (emit(source.element, 'htmx:before:response', detail) === false) return
            detail.response.text = await response.text()
            if (emit(source.element, 'htmx:after:response', detail) === false) return

            // ── Swap ──
            const targetSelector = options.swap?.target || resolve(config.swapTarget, source.element.native)
            const targetElement = resolveTarget(source.element.native || source.element, targetSelector)

            if (!targetElement) {
                detail.error = {type: 'target', message: `Target not found: ${targetSelector}`}
                emit(source.element, 'htmx:error', detail)
                return
            }

            detail.swap = {
                ...options.swap,
                content: makeFragment(detail.response.text),
                target: wrap(targetElement),
                method: options.swap?.method || resolve(config.swapMethod, source.element.native),
            }

            if (emit(source.element, 'htmx:before:swap', detail) === false) return
            swap(targetElement, detail.swap.method, detail.swap.content)
            init(targetElement)
            emit(source.element, 'htmx:after:swap', detail)

            // ── Settle ──
            if (emit(source.element, 'htmx:before:settle', detail) === false) return
            emit(source.element, 'htmx:after:settle', detail)

            return detail.response

        } catch (error) {
            detail.error = {
                type: error.name === 'AbortError' ? 'abort' : 'network',
                message: error.message,
                cause: error,
            }
            emit(source.element, 'htmx:error', detail)

        } finally {
            emit(source.element, 'htmx:done', detail)
        }
    }

    function swap(target, method, content) {
        const fn = registry.swaps[method]
        if (fn) {
            fn(target, content)
        } else {
            console.warn(`htmx: unknown swap method "${method}"`)
        }
    }

    function resolveHeaders(headers, context) {
        const result = {}
        for (const [key, value] of Object.entries(headers)) {
            result[key] = resolve(value, context)
        }
        return result
    }

    // ╔═══════════════════════════════════════════════════════════════════════╗
    // ║ PRIMITIVES                                                             ║
    // ╚═══════════════════════════════════════════════════════════════════════╝

    // ─── State ───────────────────────────────────────────────────────────────

    const _state = new WeakMap()

    function state(element) {
        let s = _state.get(element)
        if (!s) {
            s = {}
            _state.set(element, s)
        }
        return s
    }

    // ─── Element wrapper ─────────────────────────────────────────────────────

    const WRAPPED = Symbol('htmx.wrapped')

    const wrapMethods = {
        native: element => element,
        attr: element => (name, opts) => attr(element, name, opts),
        find: element => selector => wrap(element.querySelector(selector)),
        findAll: element => selector => [...element.querySelectorAll(selector)].map(wrap),
        emit: element => (name, detail) => emit(element, name, detail),
        on: element => (event, handler, opts) => on(element, event, handler, opts),
        state: element => state(element),
    }

    function wrap(element) {
        if (!element) return null
        if (element[WRAPPED]) return element

        return new Proxy(element, {
            get(target, prop) {
                if (prop === WRAPPED) return true
                if (prop in wrapMethods) return wrapMethods[prop](target)

                const value = target[prop]
                return typeof value === 'function' ? value.bind(target) : value
            }
        })
    }

    function attr(element, name, {inherit = true} = {}) {
        const prefix = config.syntaxPrefix
        const delimiter = config.syntaxDelimiter
        const attrName = name.replace(/^hx-/, prefix).replace(/:/g, delimiter)

        // Check element directly
        const direct = element.getAttribute(attrName)
        if (direct !== null) return direct
        if (!inherit) return null

        // Walk up the tree
        let current = element.parentElement
        while (current) {
            const value = current.getAttribute(attrName)
            if (value !== null) return value
            current = current.parentElement
        }

        return null
    }

    // ─── Events ──────────────────────────────────────────────────────────────

    function emit(element, name, detail = {}) {
        // First: call extension handlers (can cancel by returning false)
        for (const ext of extensions) {
            const handler = ext.on?.[name]
            if (handler && handler(detail) === false) return false
        }

        // Then: dispatch DOM event
        const target = getEventTarget(element)
        return target.dispatchEvent(new CustomEvent(name, {
            detail: unwrap(detail),
            bubbles: true,
            cancelable: true,
            composed: true,
        }))
    }

    function getEventTarget(element) {
        const node = element?.native || element
        const connected = node?.isConnected !== false
        return connected ? node : document
    }

    function on(element, event, handler, options) {
        const target = element.native || element
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

    // ─── Parsing ─────────────────────────────────────────────────────────────

    function parse(raw) {
        if (!raw) return {value: null}

        const parts = raw.trim().split(/\s+/)
        const result = {value: parts[0]}

        for (const part of parts.slice(1)) {
            const colonIndex = part.indexOf(':')
            if (colonIndex > 0) {
                const key = part.slice(0, colonIndex)
                const val = part.slice(colonIndex + 1)
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

        const [, num, unit] = match
        if (unit === 's') return num * 1000
        if (unit === 'm') return num * 60000
        return +num
    }

    // ─── DOM helpers ─────────────────────────────────────────────────────────

    function resolveTarget(element, selector) {
        if (!selector || selector === 'this') return element
        if (selector === 'body') return document.body
        if (selector.startsWith('closest ')) return element.closest(selector.slice(8))
        if (selector.startsWith('find ')) return element.querySelector(selector.slice(5))
        return document.querySelector(selector)
    }

    function makeFragment(html) {
        const template = document.createElement('template')
        template.innerHTML = html
        return template.content
    }

    // ╔═══════════════════════════════════════════════════════════════════════╗
    // ║ START                                                                  ║
    // ╚═══════════════════════════════════════════════════════════════════════╝

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', boot)
    } else {
        queueMicrotask(boot)
    }

    // ╔═══════════════════════════════════════════════════════════════════════╗
    // ║ PUBLIC API                                                             ║
    // ╚═══════════════════════════════════════════════════════════════════════╝

    return {
        version: '4.0.0-kernel',

        // Config & Registry
        config,
        registry,

        // Core
        register,
        init,
        fetch,

        // Events
        emit,
        on,

        // Elements
        wrap,
        attr,
        state,

        // Utilities
        resolve,
        parse,
        resolveTarget,
        makeFragment,
    }
})()
