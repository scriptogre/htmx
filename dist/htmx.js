// htmx 4.0.0 — assembled build
// Extensions: parse, http, public-api, hx-get, hx-post, hx-put, hx-patch, hx-delete, hx-swap, hx-target, smart-defaults, swap-aliases, timeout, hx-trigger, trigger-delay, trigger-throttle, extended-selectors, inheritance, parse-dot-path, hx-boost
class HtmxError extends Error {
    constructor(message, options) {
        super(message, options)
        this.type = options?.type
    }
}

var htmx = (function () {
    'use strict'

    // ── State ────────────────────────────────────────────────────────────────
    // Namespace for managed state. Kernel owns state.elements (per-element
    // lifecycle). Extensions may add their own domains (e.g., state.connections).

    const state = {
        booted: false,
        elements: new WeakMap(),
    }

    // ── Config ───────────────────────────────────────────────────────────────
    // Extensions populate this at boot (e.g., defaultSwap, requestTimeout).
    const config = {}

    // ── Extensions ───────────────────────────────────────────────────────────

    const extensions = []

    /**
     * Register an extension. Extensions run in registration order.
     * @param {string} name - Unique extension name.
     * @param {{requires?: string[], on?: Object<string, function>}} extension
     */
    function register(name, extension) {
        if (extensions.some(registered => registered.name === name)) {
            throw new HtmxError(`Extension "${name}" is already registered`, {type: 'EXTENSION_ALREADY_REGISTERED'})
        }
        for (const dependency of extension.requires || []) {
            if (!extensions.some(registered => registered.name === dependency)) {
                throw new HtmxError(`Extension "${name}" requires "${dependency}" to be registered first`, {type: 'EXTENSION_DEPENDENCY_MISSING'})
            }
        }
        extensions.push({name, ...extension})
        // Late-registered extensions still get a boot event
        if (state.booted && extension.on?.['htmx:boot']) {
            extension.on['htmx:boot']({}, api)
        }
    }

    // ── Events ───────────────────────────────────────────────────────────────

    /**
     * Emit an event: extensions see it first, then it dispatches as a DOM CustomEvent.
     * Any extension returning false (or preventDefault) cancels the event.
     * @param {Element} element
     * @param {string} eventName
     * @param {Object} [detail={}]
     * @returns {boolean} false if canceled
     */
    function emit(element, eventName, detail = {}) {
        // Extensions get first crack — can inspect/modify detail or cancel
        for (const extension of extensions) {
            if (extension.on?.[eventName]?.(detail, api) === false) return false
        }

        // Fall back to body for disconnected elements (e.g., during cleanup)
        const dispatchTarget = element?.isConnected ? element : document.body

        return dispatchTarget.dispatchEvent(
            new CustomEvent(eventName, {
                detail,
                bubbles: true,
                cancelable: true,
                composed: true,
            }))
    }

    // ── Utilities ────────────────────────────────────────────────────────────

    /** @param {boolean} result - Return value of api.emit(). */
    const canceled = (result) => result === false

    /**
     * Listen for a DOM event. Auto-registers a cleanup callback if the element
     * has state, so listeners are removed when the element is cleaned up.
     * @param {EventTarget} element
     * @param {string} eventName
     * @param {EventListener} handler
     * @param {AddEventListenerOptions} [options]
     * @returns {function} unsubscribe callback
     */
    function on(element, eventName, handler, options) {
        if (!eventName) throw new HtmxError('Cannot add listener without an event name', {type: 'EVENT_NAME_MISSING'})

        element.addEventListener(eventName, handler, options)

        const off = () => element.removeEventListener(eventName, handler, options)

        // Auto-cleanup: if this element is managed, unsubscribe on removal
        if (state.elements.has(element)) state.elements.get(element).cleanup.push(off)

        return off
    }

    /**
     * Resolve an element reference. Always searches from document.
     *
     * Supports CSS selectors and direct Element references.
     * Pass {multiple: true} to get an array of matches.
     * Pass {from: element} for element-relative selectors — ignored by the
     * kernel, used by the extended-selectors extension (closest, next, etc.).
     *
     * @param {string|Element|null} selector - What to resolve.
     * @param {{multiple?: boolean, from?: Element}} [options] - Options.
     * @returns {Element|Element[]|null} Resolved element(s), or null/[] if not found.
     */
    function find(selector, options) {
        const multiple = options?.multiple
        if (selector instanceof Element) return multiple ? [selector] : selector
        if (!selector) return multiple ? [] : null
        return multiple
            ? [...document.querySelectorAll(selector)]
            : document.querySelector(selector)
    }

    /**
     * Read a raw attribute from an element.
     * Core wraps this to add parsing and inheritance.
     * @param {Element} element - Element to read from.
     * @param {string} name - Attribute name.
     * @param {Object} [options] - Ignored by kernel. Extensions that wrap attr
     *   use this for parsing hints (e.g. inheritance control).
     */
    function attr(element, name, options) {
        return element.getAttribute(name)
    }

    /**
     * Wrap an api function with a decorator. The wrapper receives the original
     * function as its first argument, followed by the caller's arguments.
     * @param {string} name - Property name on api to wrap.
     * @param {Function} wrapper - (original, ...args) => result
     */
    function wrap(name, wrapper) {
        if (!api[name]) throw new HtmxError(`Cannot wrap "${name}" — not found on api`, {type: 'WRAP_TARGET_MISSING'})
        const original = api[name]
        api[name] = (...args) => wrapper(original, ...args)
    }

    // ── Init & Cleanup ───────────────────────────────────────────────────────

    /**
     * Initialize a subtree — discover hx-* elements and init each one.
     *
     * Default execute walks the subtree with a TreeWalker, calling initElement
     * on any element with an hx-* attribute. Extensions can replace
     * detail.walk.execute during htmx:before:walk:init for custom discovery.
     *
     * @param {Element} [root=document.body] - Subtree root to initialize.
     */
    function init(root = document.body) {
        const detail = {element: root, walk: {execute: null}}

        // Default execute: walk the subtree, initElement anything with hx-*
        detail.walk.execute = () => {
            const walker = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT)
            let node = root
            while (node) {
                const attrs = node.attributes
                for (let i = 0; i < attrs.length; i++) {
                    if (attrs[i].name.startsWith('hx-')) {
                        api.initElement(node)
                        break
                    }
                }
                node = walker.nextNode()
            }
        }

        if (canceled(api.emit(root, 'htmx:before:walk:init', detail))) return
        detail.walk.execute()
        api.emit(root, 'htmx:after:walk:init', {element: root})
    }

    /**
     * Initialize a single element: set up state, let extensions configure the
     * trigger, then wire it to the lifecycle.
     *
     * Sequence:
     *   before:init → init.execute() → after:init
     *   ···later, on trigger event···
     *   before:trigger → [extensions do work] → after:trigger
     *
     * detail.trigger.execute — what runs each time the trigger event fires.
     *   Default: preventDefault + emit before:trigger / after:trigger.
     *   Extensions do their work during before:trigger (read attrs JIT, call
     *   api.ajax, send WebSocket message, etc.). Replaceable during before:init.
     *
     * detail.init.execute — what runs at init time.
     *   Default: commit state + wire trigger listener. Replaceable during before:init.
     *
     * detail.trigger.eventName — which DOM event to listen for.
     *   Set by smart-defaults or hx-trigger during before:init.
     *   Null means "don't wire a default listener" — used by extensions that
     *   handle their own wiring (multi-trigger) or connection (SSE, WebSockets).
     *
     * @param {Element} element
     */
    function initElement(element) {
        if (state.elements.has(element)) return // already initialized

        const detail = {
            element,
            trigger: {
                eventName: null, // set by smart-defaults or hx-trigger
                execute: null,   // per-fire: preventDefault + emit trigger events
            },
            init: {
                execute: null,   // init-time: commit state + wire trigger
            },
        }

        // Default trigger execute: emit lifecycle events, extensions do work during before:trigger
        detail.trigger.execute = (event) => {
            event?.preventDefault()
            if (canceled(api.emit(element, 'htmx:before:trigger', {element, event}))) return
            api.emit(element, 'htmx:after:trigger', {element, event})
        }

        // Default init execute: commit state + wire trigger
        detail.init.execute = () => {
            state.elements.set(element, {cleanup: []})
            if (detail.trigger.eventName) {
                api.on(element, detail.trigger.eventName, detail.trigger.execute)
            }
        }

        if (canceled(api.emit(element, 'htmx:before:init', detail))) return
        detail.init.execute()
        api.emit(element, 'htmx:after:init', detail)
    }

    /**
     * Clean up a subtree — tear down root and all stateful descendants.
     *
     * Default execute walks the subtree, calling cleanupElement on any
     * element with state. Extensions can replace detail.walk.execute
     * during htmx:before:walk:cleanup for custom discovery (e.g., shadow DOM).
     *
     * @param {Element} root - Subtree root to clean up.
     */
    function cleanup(root) {
        const detail = {element: root, walk: {execute: null}}

        // Default execute: cleanupElement on root + all stateful descendants
        detail.walk.execute = () => {
            const walker = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT)
            let node = root
            while (node) {
                if (state.elements.has(node)) api.cleanupElement(node)
                node = walker.nextNode()
            }
        }

        if (canceled(api.emit(root, 'htmx:before:walk:cleanup', detail))) return
        detail.walk.execute()
        api.emit(root, 'htmx:after:walk:cleanup', {element: root})
    }

    /**
     * Tear down listeners and delete state for a single element.
     *
     * Follows the standard before:* → execute() → after:* pattern.
     * Extensions can replace detail.cleanup.execute during before:cleanup
     * (e.g., to add exit animations before teardown).
     *
     * @param {Element} element - The element to clean up.
     */
    function cleanupElement(element) {
        if (!state.elements.has(element)) return

        const detail = {element, cleanup: {execute: null}}

        detail.cleanup.execute = () => {
            for (const teardown of state.elements.get(element).cleanup) teardown()
            state.elements.delete(element)
        }

        if (canceled(api.emit(element, 'htmx:before:cleanup', detail))) return
        detail.cleanup.execute()
        api.emit(element, 'htmx:after:cleanup', detail)
    }

    // ── Swap ─────────────────────────────────────────────────────────────────

    /**
     * Swap content into the DOM.
     *
     * Takes a pipeline context (detail) — a shared object that flows through
     * the entire pipeline for a given action. Each transport adds its own
     * namespace; the kernel only reads `detail.element` and `detail.swap`:
     *
     *   HTTP:          {element, request, response, swap: {content, target, style}}
     *   WebSocket:     {element, connection, message, swap: {content, target, style}}
     *   Programmatic:  {element, swap: {content, target, style}}
     *
     * The kernel ignores transport-specific fields (request, response,
     * connection, etc.) — they're pass-through context for extensions.
     * A morph extension can read detail.response.headers during before:swap;
     * a logging extension can read detail.connection. The kernel doesn't care.
     *
     * All preprocessing (target resolution string→element, content parsing
     * string→fragment) happens inside execute, so extensions can modify
     * detail.swap.target or detail.swap.content during before:swap and have
     * their changes take effect.
     *
     * detail.swap.execute — the function that performs the DOM manipulation.
     * Default: resolve target, parse content, dispatch on style. Replaceable
     * during before:swap (e.g., for morphing).
     *
     * @param {Object} detail - Pipeline context. Kernel reads detail.element
     *   and detail.swap.{content, target, style}. Everything else is pass-through.
     */
    function swap(detail) {
        const emitOn = detail.element || document.body

        detail.swap.execute = () => {
            // Resolve target: string selector → element, fallback to triggering element
            if (typeof detail.swap.target === 'string') {
                detail.swap.target = api.find(detail.swap.target, {from: detail.element})
            }
            detail.swap.target ??= detail.element

            if (!detail.swap.target) {
                throw new HtmxError('Swap target not found', {type: 'SWAP_TARGET_MISSING'})
            }

            // Parse content: string → DocumentFragment
            if (typeof detail.swap.content === 'string') {
                const template = document.createElement('template')
                template.innerHTML = detail.swap.content
                detail.swap.content = template.content
            }

            // Dispatch on swap style
            const target = detail.swap.target
            const content = detail.swap.content
            switch (detail.swap.style) {
                case 'innerHTML':
                    target.innerHTML = '';
                    target.append(content);
                    break
                case 'outerHTML':
                    target.replaceWith(content);
                    break
                case 'beforebegin':
                    target.before(content);
                    break
                case 'afterbegin':
                    target.prepend(content);
                    break
                case 'beforeend':
                    target.append(content);
                    break
                case 'afterend':
                    target.after(content);
                    break
                case 'delete':
                    target.remove();
                    break
                case 'none':
                    break
                default:
                    throw new HtmxError(`Unknown swap style "${detail.swap.style}"`, {type: 'SWAP_STYLE_UNKNOWN'})
            }
        }

        if (canceled(api.emit(emitOn, 'htmx:before:swap', detail))) return
        detail.swap.execute()
        api.emit(emitOn, 'htmx:after:swap', detail)
    }

    // ── API ──────────────────────────────────────────────────────────────────
    // Extensions receive this as the second argument in event handlers.
    // They can wrap/replace functions here; internal code calls through api.

    const api = {
        config, register,
        init, initElement, cleanup, cleanupElement,
        swap, emit, on, attr, find,
        state, wrap,
    }

    // ── Extensions: Start ────────────────────────────────────────────────────

    // ── [parse] ───────────────────────────────────────────────────────────
    {
        register('parse', {
            on: {
                'htmx:boot': (detail, api) => {
                    const tokenPattern = /(?:"([^"]*)"|'([^']*)'|([^\s,:]+))(?:\s*:\s*(?:"([^"]*)"|'([^']*)'|([^\s,]*)))?/g

                    function coerce(text) {
                        if (text === 'true') return true
                        if (text === 'false') return false
                        const duration = text.match(/^(\d+)(ms|s|m)?$/)
                        if (duration) {
                            const [, n, unit] = duration
                            return unit === 's' ? n * 1000 : unit === 'm' ? n * 60000 : +n
                        }
                        return text
                    }

                    api.parse = function parse(text, options) {
                        if (!text) return null

                        const matches = [...text.trim().matchAll(tokenPattern)]
                        if (!matches.length) return null

                        const result = {}

                        for (let i = 0; i < matches.length; i++) {
                            const m = matches[i]
                            const key = m[1] ?? m[2] ?? m[3]
                            const val = m[4] ?? m[5] ?? m[6]
                            const hasVal = val !== undefined

                            if (i === 0 && !hasVal) {
                                result.value = key
                            } else if (hasVal) {
                                result[key] = coerce(val)
                            } else {
                                result[key] = true
                            }
                        }

                        if (options?.as && result.value !== undefined) {
                            result[options.as] = result.value
                            delete result.value
                        }

                        return result
                    }

                    // Wrap attr to parse attribute values
                    api.wrap('attr', (original, element, name, options) => {
                        return api.parse(original(element, name), options)
                    })
                }
            }
        })
    }
    // ── [/parse] ──────────────────────────────────────────────────────────

    // ── [http] ────────────────────────────────────────────────────────────
    {
        register('http', {
            on: {
                'htmx:boot': (detail, api) => {
                    /**
                     * Issue an HTTP request and swap the response into the DOM.
                     *
                     * Builds a pipeline detail from options, then runs three phases:
                     *
                     * 1. **Request** — before:request → request.execute() (=fetch) → after:request
                     * 2. **Response** — before:response → response.execute() (=read body)
                     * 3. **Swap** — delegated to api.swap() (has its own before/execute/after)
                     *
                     * Extensions modify detail or replace execute during before:*.
                     *
                     * @param {Object} options - {element, request: {url, method, ...}, swap: {style, target}}
                     * @returns {Promise<void>}
                     */
                    api.ajax = async function ajax(options = {}) {
                        if (!options.request?.url) throw new HtmxError('Cannot issue request without a URL', {type: 'REQUEST_URL_MISSING'})
                        const element = options.element || document.body

                        const detail = {
                            element,
                            request: {...options.request, execute: null},
                            swap: options.swap || null,
                            response: null,
                            error: null,
                        }

                        try {
                            // ── Request phase ────────────────────────────────────
                            detail.request.execute = async () => {
                                const {url, execute, ...fetchOptions} = detail.request
                                return await fetch(url, fetchOptions)
                            }

                            if (canceled(api.emit(element, 'htmx:before:request', detail))) return

                            const response = await detail.request.execute()

                            detail.response = {
                                raw: response,
                                status: response.status,
                                ok: response.ok,
                                url: response.url,
                                headers: Object.fromEntries(response.headers),
                                execute: null,
                            }

                            api.emit(element, 'htmx:after:request', detail)

                            // ── Response phase ───────────────────────────────────
                            detail.response.execute = async () => {
                                detail.response.text = await detail.response.raw.text()
                            }

                            if (canceled(api.emit(element, 'htmx:before:response', detail))) return

                            await detail.response.execute()

                            // ── Swap phase ───────────────────────────────────────
                            if (detail.response.text != null) {
                                detail.swap ??= {}
                                detail.swap.content = detail.response.text
                                api.swap(detail)
                            }

                            api.emit(element, 'htmx:done', detail)

                        } catch (error) {
                            detail.error = error
                            console.error(error)
                            api.emit(element, 'htmx:error', detail)
                        } finally {
                            api.emit(element, 'htmx:finally', detail)
                        }
                    }

                    // Make canceled() available to ajax internals
                    const canceled = (result) => result === false
                }
            }
        })
    }
    // ── [/http] ───────────────────────────────────────────────────────────

    // ── [public-api] ──────────────────────────────────────────────────────
    {
        register('public-api', {
            on: {
                'htmx:boot': (detail, api) => {
                    htmx.swap = (options) => {
                        const {element, content, target, style, ...modifiers} = options
                        return api.swap({
                            element: element || null,
                            swap: {content, target, style: style || null, ...modifiers},
                        })
                    }
                    htmx.ajax = (options) => {
                        const {element, url, method, headers, body, target, swap, ...requestModifiers} = options
                        const swapObj = typeof swap === 'string' ? {style: swap} : (swap || {})
                        return api.ajax({
                            element: element || null,
                            request: {url, method: method || 'GET', headers: headers || {}, body: body ?? null, ...requestModifiers},
                            swap: {style: null, target: target || null, ...swapObj},
                        })
                    }
                }
            }
        })
    }
    // ── [/public-api] ─────────────────────────────────────────────────────

    // ── [hx-get] ──────────────────────────────────────────────────────────
    {
        register('hx-get', {
            on: {
                'htmx:before:trigger': (detail, api) => {
                    const val = api.attr(detail.element, 'hx-get', {as: 'url'})
                    if (val) api.ajax({element: detail.element, request: {url: val.url, method: 'GET'}})
                }
            }
        })
    }
    // ── [/hx-get] ─────────────────────────────────────────────────────────

    // ── [hx-post] ─────────────────────────────────────────────────────────
    {
        register('hx-post', {
            on: {
                'htmx:before:trigger': (detail, api) => {
                    const val = api.attr(detail.element, 'hx-post', {as: 'url'})
                    if (val) api.ajax({element: detail.element, request: {url: val.url, method: 'POST'}})
                }
            }
        })
    }
    // ── [/hx-post] ────────────────────────────────────────────────────────

    // ── [hx-put] ──────────────────────────────────────────────────────────
    {
        register('hx-put', {
            on: {
                'htmx:before:trigger': (detail, api) => {
                    const val = api.attr(detail.element, 'hx-put', {as: 'url'})
                    if (val) api.ajax({element: detail.element, request: {url: val.url, method: 'PUT'}})
                }
            }
        })
    }
    // ── [/hx-put] ─────────────────────────────────────────────────────────

    // ── [hx-patch] ────────────────────────────────────────────────────────
    {
        register('hx-patch', {
            on: {
                'htmx:before:trigger': (detail, api) => {
                    const val = api.attr(detail.element, 'hx-patch', {as: 'url'})
                    if (val) api.ajax({element: detail.element, request: {url: val.url, method: 'PATCH'}})
                }
            }
        })
    }
    // ── [/hx-patch] ───────────────────────────────────────────────────────

    // ── [hx-delete] ───────────────────────────────────────────────────────
    {
        register('hx-delete', {
            on: {
                'htmx:before:trigger': (detail, api) => {
                    const val = api.attr(detail.element, 'hx-delete', {as: 'url'})
                    if (val) api.ajax({element: detail.element, request: {url: val.url, method: 'DELETE'}})
                }
            }
        })
    }
    // ── [/hx-delete] ──────────────────────────────────────────────────────

    // ── [hx-swap] ─────────────────────────────────────────────────────────
    {
        register('hx-swap', {
            on: {
                'htmx:before:swap': (detail, api) => {
                    const swapAttr = api.attr(detail.element, 'hx-swap', {as: 'style'})
                    if (swapAttr) Object.assign(detail.swap, swapAttr)
                }
            }
        })
    }
    // ── [/hx-swap] ────────────────────────────────────────────────────────

    // ── [hx-target] ───────────────────────────────────────────────────────
    {
        register('hx-target', {
            on: {
                'htmx:before:swap': (detail, api) => {
                    const targetAttr = api.attr(detail.element, 'hx-target', {as: 'selector'})
                    if (targetAttr) detail.swap.target = targetAttr.selector
                }
            }
        })
    }
    // ── [/hx-target] ──────────────────────────────────────────────────────

    // ── [smart-defaults] ──────────────────────────────────────────────────
    {
        register('smart-defaults', {
            on: {
                'htmx:boot': (detail, api) => {
                    api.config.defaultSwap ??= 'innerHTML'
                    api.config.defaultHeaders ??= {'HX-Request': 'true'}
                },

                'htmx:before:init': (detail, api) => {
                    // Default trigger based on element type
                    if (!detail.trigger.eventName) {
                        if (detail.element.matches('form')) detail.trigger.eventName = 'submit'
                        else if (detail.element.matches('input:not([type=button]), select, textarea')) detail.trigger.eventName = 'change'
                        else detail.trigger.eventName = 'click'
                    }
                },

                'htmx:before:swap': (detail, api) => {
                    detail.swap.style ??= api.config.defaultSwap
                },

                'htmx:before:request': (detail, api) => {
                    detail.request.headers = {...api.config.defaultHeaders, ...detail.request.headers}
                    detail.request.headers['HX-Current-URL'] ??= location.href
                },
            }
        })
    }
    // ── [/smart-defaults] ─────────────────────────────────────────────────

    // ── [swap-aliases] ────────────────────────────────────────────────────
    {
        register('swap-aliases', {
            on: {
                'htmx:before:swap': (detail, api) => {
                    const aliases = {
                        before: 'beforebegin',
                        prepend: 'afterbegin',
                        append: 'beforeend',
                        after: 'afterend',
                        remove: 'delete',
                    }
                    if (detail.swap.style in aliases) detail.swap.style = aliases[detail.swap.style]
                }
            }
        })
    }
    // ── [/swap-aliases] ───────────────────────────────────────────────────

    // ── [timeout] ─────────────────────────────────────────────────────────
    {
        register('timeout', {
            on: {
                'htmx:boot': (detail, api) => {
                    api.config.requestTimeout ??= 60000
                },

                'htmx:before:request': (detail, api) => {
                    const timeout = api.config.requestTimeout
                    if (timeout) {
                        const timeoutSignal = AbortSignal.timeout(timeout)
                        detail.request.signal = detail.request.signal
                            ? AbortSignal.any([detail.request.signal, timeoutSignal])
                            : timeoutSignal
                    }
                },
            }
        })
    }
    // ── [/timeout] ────────────────────────────────────────────────────────

    // ── [hx-trigger] ──────────────────────────────────────────────────────
    {
        register('hx-trigger', {
            on: {
                'htmx:before:init': (detail, api) => {
                    const raw = detail.element.getAttribute('hx-trigger')
                    if (!raw) return

                    const triggers = raw.split(',').map(part => api.parse(part.trim(), {as: 'eventName'}))
                    const defaultEventName = detail.trigger.eventName
                    detail.trigger.eventName = null

                    const defaultExecute = detail.init.execute
                    detail.init.execute = () => {
                        defaultExecute()

                        const element = detail.element
                        const execute = detail.trigger.execute

                        for (const t of triggers) {
                            const eventName = t.eventName || defaultEventName

                            const options = {}
                            if (t.delay !== undefined) options.delay = t.delay
                            if (t.throttle !== undefined) options.throttle = t.throttle
                            if (t.once) options.once = true

                            // Special: load — fire immediately
                            if (eventName === 'load') {
                                queueMicrotask(() => execute())
                                continue
                            }

                            // Special: every — fire on interval
                            if (eventName === 'every') {
                                let ms
                                for (const [key, val] of Object.entries(t)) {
                                    if (val !== true) continue
                                    const m = key.match(/^(\d+)(ms|s|m)?$/)
                                    if (m) {
                                        ms = m[2] === 's' ? m[1] * 1000 : m[2] === 'm' ? m[1] * 60000 : +m[1]
                                        break
                                    }
                                }
                                if (ms) {
                                    const id = setInterval(() => execute(), ms)
                                    api.state.get(element).cleanup.push(() => clearInterval(id))
                                }
                                continue
                            }

                            if (!eventName) continue

                            // Resolve listen target (from modifier)
                            if (t.from) {
                                for (const target of api.find(t.from, {from: element, multiple: true})) {
                                    const off = api.on(target, eventName, execute, options)
                                    api.state.get(element).cleanup.push(off)
                                }
                            } else {
                                api.on(element, eventName, execute, options)
                            }
                        }
                    }
                }
            }
        })
    }
    // ── [/hx-trigger] ─────────────────────────────────────────────────────

    // ── [trigger-delay] ───────────────────────────────────────────────────
    {
        register('trigger-delay', {
            on: {
                'htmx:boot': (detail, api) => {
                    api.wrap('on', (original, element, eventName, handler, options) => {
                        /**
                         * [trigger-delay] Debounce: when `options.delay` is set, the handler
                         * only fires once after the specified quiet period elapses.
                         *
                         * @param {number} [options.delay] - Debounce delay in ms.
                         * @example on(el, 'click', handler, {delay: 500})
                         */
                        if (options?.delay !== undefined) {
                            const ms = options.delay
                            let timeout
                            const orig = handler
                            handler = (event) => {
                                clearTimeout(timeout)
                                timeout = setTimeout(() => orig(event), ms)
                            }
                        }
                        return original(element, eventName, handler, options)
                    })
                }
            }
        })
    }
    // ── [/trigger-delay] ──────────────────────────────────────────────────

    // ── [trigger-throttle] ────────────────────────────────────────────────
    {
        register('trigger-throttle', {
            on: {
                'htmx:boot': (detail, api) => {
                    api.wrap('on', (original, element, eventName, handler, options) => {
                        /**
                         * [trigger-throttle] Rate-limit: when `options.throttle` is set, the
                         * handler fires at most once per the specified interval.
                         *
                         * @param {number} [options.throttle] - Minimum ms between invocations.
                         * @example on(el, 'click', handler, {throttle: 200})
                         */
                        if (options?.throttle !== undefined) {
                            const ms = options.throttle
                            let last = 0
                            const orig = handler
                            handler = (event) => {
                                const now = Date.now()
                                if (now - last >= ms) {
                                    last = now
                                    orig(event)
                                }
                            }
                        }
                        return original(element, eventName, handler, options)
                    })
                }
            }
        })
    }
    // ── [/trigger-throttle] ───────────────────────────────────────────────

    // ── [extended-selectors] ──────────────────────────────────────────────
    {
        register('extended-selectors', {
            on: {
                'htmx:boot': (detail, api) => {
                    function scanForward(element, selector) {
                        for (const candidate of (element.getRootNode() || document).querySelectorAll(selector)) {
                            if (candidate.compareDocumentPosition(element) & Node.DOCUMENT_POSITION_PRECEDING) return candidate
                        }
                        return null
                    }

                    function scanBackward(element, selector) {
                        const all = (element.getRootNode() || document).querySelectorAll(selector)
                        for (let i = all.length - 1; i >= 0; i--) {
                            if (all[i].compareDocumentPosition(element) & Node.DOCUMENT_POSITION_FOLLOWING) return all[i]
                        }
                        return null
                    }

                    api.wrap('find', (original, selector, options) => {
                        /**
                         * [extended-selectors] Named targets (`this`, `body`,
                         * `document`, `window`), traversal (`closest`, `next`,
                         * `previous`), and scoped search (`find <sel>`) when
                         * `options.from` is set as context element.
                         *
                         * @param {string} selector - Extended selector syntax.
                         * @returns {Element|Element[]|Window|Document|null}
                         * @example find('closest .container', {from: el})
                         * @example find('this', {from: el})
                         * @example find('window')
                         */
                        const el = options?.from
                        const multiple = options?.multiple
                        const match = (result) => multiple ? (result ? [result] : []) : result ?? null

                        if (typeof selector !== 'string') return original(selector, options)

                        // Named targets
                        if (selector === 'this') return match(el)
                        if (selector === 'body') return match(document.body)
                        if (selector === 'document') return multiple ? [document] : document
                        if (selector === 'window') return multiple ? [window] : window

                        if (!el) return original(selector, options)

                        // Immediate relatives (require context element)
                        if (selector === 'next') return match(el.nextElementSibling)
                        if (selector === 'previous') return match(el.previousElementSibling)
                        if (selector === 'host') return match(el.getRootNode()?.host)

                        // Traversal
                        if (selector.startsWith('closest ')) return match(el.closest(selector.slice(8)))
                        if (selector.startsWith('next ')) return match(scanForward(el, selector.slice(5)))
                        if (selector.startsWith('previous ')) return match(scanBackward(el, selector.slice(9)))

                        // Scoped search: search within the context element
                        if (selector.startsWith('find ')) {
                            const sel = selector.slice(5)
                            return multiple
                                ? [...el.querySelectorAll(sel)]
                                : el.querySelector(sel)
                        }

                        return original(selector, options)
                    })
                }
            }
        })
    }
    // ── [/extended-selectors] ─────────────────────────────────────────────

    // ── [inheritance] ─────────────────────────────────────────────────────
    {
        register('inheritance', {
            on: {
                'htmx:boot': (detail, api) => {
                    api.config.inheritance ??= {}
                    api.config.inheritance.mode ??= 'explicit'
                    api.config.inheritance.inheritSuffix ??= 'inherited'
                    api.config.inheritance.appendSuffix ??= 'append'

                    api.wrap('attr', (original, element, name, options) => {
                        /**
                         * [inheritance] Walk up the DOM for inherited attributes.
                         * Supports `:inherited` and `:append` suffixes for explicit
                         * inheritance chains. Set `options.inherit` to `false` to skip.
                         *
                         * @param {boolean} [options.inherit=true] - Set false to skip inheritance.
                         * @example <div hx-target:inherited="#main">
                         */
                        if (options?.inherit === false) return original(element, name, options)

                        const {mode, inheritSuffix, appendSuffix} = api.config.inheritance
                        const inherited = `${name}:${inheritSuffix}`
                        const append = `${name}:${appendSuffix}`
                        const inheritedAppend = `${name}:${inheritSuffix}:${appendSuffix}`

                        // Direct attribute on element
                        if (element.hasAttribute(name)) return original(element, name, options)
                        if (element.hasAttribute(inherited)) {
                            name = inherited
                            return original(element, name, options)
                        }

                        // Build ancestor selector
                        const parts = [`[${CSS.escape(inherited)}]`, `[${CSS.escape(inheritedAppend)}]`]
                        if (mode === 'implicit') parts.unshift(`[${CSS.escape(name)}]`)
                        const selector = parts.join(',')

                        // Collect :append chain + base, walking up
                        const chain = []

                        const selfAppend = element.getAttribute(append)
                            ?? element.getAttribute(inheritedAppend)
                        if (selfAppend !== null) chain.push(selfAppend)

                        let ancestor = element.parentElement?.closest(selector)
                        while (ancestor) {
                            const base = ancestor.getAttribute(inherited)
                                ?? (mode === 'implicit' ? ancestor.getAttribute(name) : null)
                            if (base !== null) {
                                chain.push(base)
                                break
                            }

                            const ancestorAppend = ancestor.getAttribute(inheritedAppend)
                            if (ancestorAppend !== null) {
                                chain.push(ancestorAppend)
                                ancestor = ancestor.parentElement?.closest(selector)
                                continue
                            }

                            break
                        }

                        if (!chain.length) return null
                        return api.parse(chain.reverse().join(','), options)
                    })
                }
            }
        })
    }
    // ── [/inheritance] ────────────────────────────────────────────────────

    // ── [parse-dot-path] ──────────────────────────────────────────────────
    {
        register('parse-dot-path', {
            on: {
                'htmx:boot': (detail, api) => {
                    api.wrap('parse', (original, text, options) => {
                        /**
                         * [parse-dot-path] Expands dot-notation keys into nested
                         * objects. `"user.name:John"` → `{user: {name: "John"}}`.
                         *
                         * @returns {Object|null} Parsed object with dot-paths expanded.
                         */
                        const result = original(text, options)
                        if (!result) return result

                        const expanded = {}
                        for (const [k, v] of Object.entries(result)) {
                            if (k.includes('.')) {
                                const keys = k.split('.')
                                keys.slice(0, -1).reduce((o, key) => o[key] ??= {}, expanded)[keys.at(-1)] = v
                            } else {
                                expanded[k] = v
                            }
                        }
                        return expanded
                    })
                }
            }
        })
    }
    // ── [/parse-dot-path] ─────────────────────────────────────────────────

    // ── [hx-boost] ────────────────────────────────────────────────────────
    {
        register('hx-boost', {
            on: {
                // After a subtree is init'd, find links/forms inside boosted containers
                'htmx:after:walk:init': (detail, api) => {
                    const root = detail.element
                    const containers = [
                        ...(root.matches?.('[hx-boost]') ? [root] : []),
                        ...root.querySelectorAll('[hx-boost]')
                    ]
                    for (const container of containers) {
                        const boost = api.attr(container, 'hx-boost')
                        if (!boost || boost.value === 'false') continue
                        for (const el of container.querySelectorAll('a[href], form')) {
                            api.initElement(el)
                        }
                    }
                },

                // At trigger time, if this is a boosted link/form, fire ajax
                'htmx:before:trigger': (detail, api) => {
                    const el = detail.element
                    if (!el.matches('a[href], form')) return

                    const boosted = el.closest('[hx-boost]')
                    if (!boosted) return
                    const boost = api.attr(boosted, 'hx-boost')
                    if (!boost || boost.value === 'false') return

                    if (el.matches('a[href]')) {
                        api.ajax({element: el, request: {url: el.getAttribute('href'), method: 'GET'}})
                    } else {
                        api.ajax({
                            element: el,
                            request: {
                                url: el.getAttribute('action') || '',
                                method: (el.getAttribute('method') || 'GET').toUpperCase(),
                            },
                        })
                    }
                },
            }
        })
    }
    // ── [/hx-boost] ───────────────────────────────────────────────────────

    // ── Extensions: End ──────────────────────────────────────────────────────

    // ── Boot ─────────────────────────────────────────────────────────────────

    /**
     * Emit htmx:boot, init the document body, and observe DOM mutations
     * (added nodes → init, removed nodes → cleanup).
     */
    function boot() {
        state.booted = true
        api.emit(document.body, 'htmx:boot')
        api.init(document.body)

        new MutationObserver(mutations => {
            for (const mutation of mutations) {
                for (const node of mutation.addedNodes) {
                    if (node instanceof Element) api.init(node)
                }
                for (const node of mutation.removedNodes) {
                    if (node instanceof Element) api.cleanup(node)
                }
            }
        }).observe(document.body, {childList: true, subtree: true})
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', boot)
    } else {
        queueMicrotask(boot)
    }

    // ── Public API ───────────────────────────────────────────────────────────
    // Getters delegate to api so extension wraps take effect.

    return {
        version: '4.0.0',
        config,
        register,
        get init() {
            return api.init
        },
        get emit() {
            return api.emit
        },
        get on() {
            return api.on
        },
        get attr() {
            return api.attr
        },
        get find() {
            return api.find
        },
        get parse() {
            return api.parse ?? (() => {
                throw new HtmxError('No parser installed — include htmx.core.js or register a parse extension', {type: 'PARSER_MISSING'})
            })
        },
        get ajax() {
            return api.ajax ?? (() => {
                throw new HtmxError('No ajax transport installed — include htmx.core.js or register an ajax extension', {type: 'AJAX_MISSING'})
            })
        },
        swap(...args) {
            return api.swap(...args)
        },
        state,
    }
})()
