// htmx 4.0 — Kernel
//
// Pipeline: init → [event fires] → request → response → swap
// Each phase emits before:* → execute() → after:*
// Extensions modify detail or replace execute during before:*.
//
// Errors:
//
//   throw HtmxError — Programmer error. You passed bad arguments, called
//   something wrong, or misconfigured an extension. Crashes immediately so
//   you fix your code. (Inside the ajax pipeline, these are caught and
//   converted to htmx:error events — see below.)
//
//   htmx:error event — Runtime error. Something failed during the ajax
//   pipeline (network down, target removed from DOM, etc.). Logged to
//   console, available on detail.error, and always followed by htmx:finally.

class HtmxError extends Error {
    constructor(message, options) {
        super(message, options)
        this.type = options?.type
    }
}

var htmx = (function () {
    'use strict'

    // ── State ────────────────────────────────────────────────────────────────
    /**
     * @typedef {Object} ElementState
     * @property {Function[]} cleanup - Teardown callbacks, run on element removal.
     * Other properties are extensions' prerogative (e.g., trigger handles, timers).
     */

    /** @type {WeakMap<Element, ElementState>} */
    const state = new WeakMap()

    /** @param {boolean} result - Return value of api.emit(). */
    const canceled = (result) => result === false

    // ── Config ──────────────────────────────────────────────────────────────
    // Extensions populate this at boot (e.g., defaultSwap, requestTimeout).
    const config = {}

    // ── Extensions ──────────────────────────────────────────────────────────

    const extensions = []
    let booted = false

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
        if (booted && extension.on?.['htmx:boot']) {
            extension.on['htmx:boot']({}, api)
        }
    }

    // ── Events ──────────────────────────────────────────────────────────────

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
        if (!eventName) throw new HtmxError(`Cannot add listener without an event name`, {type: 'EVENT_NAME_MISSING'})
        element.addEventListener(eventName, handler, options)

        const off = () => element.removeEventListener(eventName, handler, options)

        // Auto-cleanup: if this element is managed, unsubscribe on removal
        if (state.has(element)) state.get(element).cleanup.push(off)

        return off
    }

    // ── DOM ─────────────────────────────────────────────────────────────────

    /**
     * Resolve an element reference.
     *
     * Supports CSS selectors and direct Element references.
     * Pass {multiple: true} to get an array of matches.
     * Extended selectors (named targets, traversal keywords) are added
     * by the extended-selectors extension wrapping api.find.
     *
     * @param {Element}  [element=document] - Context element.
     * @param {string|Element|null} selector - What to resolve.
     * @param {{multiple?: boolean}} [options] - Options.
     * @returns {Element|Element[]|null}
     *
     * @example find('#target')                         // → Element
     * @example find('.items', {multiple: true})         // → Element[]
     */
    function find(element, selector, options) {
        // find(selector[, options]) — string as first arg
        if (typeof element === 'string') {
            options = selector
            selector = element
            element = document
        }
        // find(element[, options]) — element passthrough, or find(null)
        else if (selector === undefined || (selector !== null && typeof selector === 'object' && !(selector instanceof Node))) {
            options = selector
            selector = element
            element = document
        }
        const multiple = options?.multiple
        if (selector instanceof Element) return multiple ? [selector] : selector
        if (!selector) return multiple ? [] : null
        return multiple
            ? [...element.querySelectorAll(selector)]
            : element.querySelector(selector)
    }

    // ── Boot ────────────────────────────────────────────────────────────────

    /**
     * Emit htmx:boot, init the document body, and observe DOM mutations
     * (added nodes → init, removed nodes → cleanup).
     */
    function boot() {
        booted = true
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

    // ── Init & Cleanup ──────────────────────────────────────────────────────

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
     * Initialize a single element: set up state, let extensions configure it,
     * then wire it to the pipeline.
     *
     * Sequence:
     *   before:init → init.execute() → after:init
     *   ···later, on trigger event···
     *   before:trigger → ajax(request → response → swap) → after:trigger
     *
     * detail.trigger.execute — what runs each time the trigger event fires.
     *   Default: preventDefault + ajax pipeline. Replaceable during before:init.
     *
     * detail.init.execute — what runs at init time.
     *   Default: commit state + wire trigger listener. Replaceable during before:init.
     *
     * detail.trigger.eventName — which DOM event to listen for.
     *   Set by default-trigger or trigger-attrs during before:init.
     *   Null means "don't wire a default listener" — used by extensions that
     *   handle their own wiring (multi-trigger) or connection (SSE, WebSockets).
     *
     * @param {Element} element
     */
    function initElement(element) {
        if (state.has(element)) return // already initialized

        const detail = {
            element,
            trigger: {
                eventName: null, // set by default-trigger or trigger-attrs
                execute: null,   // per-fire: preventDefault + ajax pipeline
            },
            init: {
                execute: null,   // init-time: commit state + wire trigger
            },
            request: null,       // set by method-attrs: {url, method}
            swap: null,          // set by method-attrs: {style, target}
        }

        // Default trigger execute: fire the ajax pipeline
        detail.trigger.execute = (event) => {
            event?.preventDefault()
            if (canceled(api.emit(element, 'htmx:before:trigger', {element, event}))) return
            api.ajax({element, request: detail.request, swap: detail.swap})
            api.emit(element, 'htmx:after:trigger', {element, event})
        }

        // Default init execute: commit state + wire trigger
        detail.init.execute = () => {
            state.set(element, {cleanup: []})
            if (detail.trigger.eventName) {
                api.on(element, detail.trigger.eventName, detail.trigger.execute)
            }
        }

        // ── Init sequence ────────────────────────────────────────────────

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
                if (state.has(node)) api.cleanupElement(node)
                node = walker.nextNode()
            }
        }

        if (canceled(api.emit(root, 'htmx:before:walk:cleanup', detail))) return
        detail.walk.execute()
        api.emit(root, 'htmx:after:walk:cleanup', {element: root})
    }

    /**
     * Tear down listeners and delete state for a single element.
     * Emits htmx:before:cleanup / htmx:after:cleanup.
     * @param {Element} element - The element to clean up.
     */
    function cleanupElement(element) {
        if (!state.has(element)) return

        api.emit(element, 'htmx:before:cleanup', {element})

        for (const teardown of state.get(element).cleanup) teardown()
        state.delete(element)

        api.emit(element, 'htmx:after:cleanup', {element})
    }

    // ── Attributes ─────────────────────────────────────────────────────────

    /**
     * Read and parse an attribute from an element.
     *
     * Calls getAttribute then api.parse (so exotic syntax extensions apply).
     * Extensions wrap `api.attr` for inheritance.
     *
     * @param {Element} element - Element to read from.
     * @param {string} name - Attribute name.
     * @param {{as?: string}} [options] - Passed to api.parse. `as` renames the first bare token.
     * @returns {Object|null} Parsed object, or null if attribute is absent.
     * @example attr(element, 'hx-trigger', {as: 'eventName'})  // {eventName: 'click', delay: 300}
     * @example attr(element, 'hx-swap', {as: 'style'})         // {style: 'innerHTML'}
     * @example attr(element, 'hx-target', {as: 'selector'})    // {selector: '#foo'}
     */
    function attr(element, name, options) {
        return api.parse(element.getAttribute(name), options)
    }

    // ── Swap ────────────────────────────────────────────────────────────────

    /**
     * Swap content into the DOM.
     *
     * Expects a pipeline detail object with at least detail.swap.
     * Called internally by ajax() after the response phase.
     *
     * detail.swap.execute — the function that performs the DOM manipulation.
     * Default: look up style in api.swaps and call it. Replaceable during before:swap.
     *
     * @param {Object} detail - Pipeline detail with detail.swap.{content, target, style}.
     */
    function swap(detail) {

        // Resolve target: string → element, fallback to element
        const targetSelector = detail.swap.target
        if (typeof detail.swap.target === 'string') {
            detail.swap.target = api.find(detail.element || document, detail.swap.target)
        }
        detail.swap.target ??= detail.element

        if (!detail.swap.target) {
            throw new HtmxError(`Swap target "${targetSelector}" not found`, {type: 'SWAP_TARGET_MISSING'})
        }

        // Parse content: string → DocumentFragment
        if (typeof detail.swap.content === 'string') {
            const template = document.createElement('template')
            template.innerHTML = detail.swap.content
            detail.swap.content = template.content
        }

        const emitOn = detail.element || detail.swap.target

        // Default execute: look up swap style in api.swaps and apply
        detail.swap.execute = () => {
            if (!api.swaps[detail.swap.style]) {
                throw new HtmxError(`Swap style "${detail.swap.style}" is not registered`, {type: 'SWAP_STYLE_UNKNOWN'})
            }
            api.swaps[detail.swap.style](detail.swap.target, detail.swap.content)
        }

        if (canceled(api.emit(emitOn, 'htmx:before:swap', detail))) return

        detail.swap.execute()

        api.emit(emitOn, 'htmx:after:swap', detail)
    }

    // ── Request ─────────────────────────────────────────────────────────────

    /**
     * Issue an HTTP request and swap the response into the DOM.
     *
     * Builds a pipeline detail from options, then runs three phases:
     *
     * 1. **Request** — before:request → request.execute() (=fetch) → after:request
     * 2. **Response** — before:response → response.execute() (=read body)
     * 3. **Swap** — delegated to {@link swap} (has its own before/execute/after)
     *
     * Extensions modify detail or replace execute during before:*.
     *
     * @param {Object} options - Pipeline options with request, swap, etc.
     * @returns {Promise<void>}
     */
    async function ajax(options = {}) {
        if (!options.request?.url) throw new HtmxError(`Cannot issue request without a URL`, {type: 'REQUEST_URL_MISSING'})
        const element = options.element || document.body

        const detail = {
            element,
            request: {...options.request, execute: null},
            swap: options.swap || null,
            response: null,
            error: null,
        }

        try {
            // ── Request phase ───────────────────────────────────────────
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

            // ── Response phase ──────────────────────────────────────────
            detail.response.execute = async () => {
                detail.response.text = await detail.response.raw.text()
            }

            if (canceled(api.emit(element, 'htmx:before:response', detail))) return

            await detail.response.execute()

            // ── Swap phase ──────────────────────────────────────────────
            if (detail.response.text != null) {
                detail.swap ??= {}
                detail.swap.content = detail.response.text
                api.swap(detail)
            }

            api.emit(element, 'htmx:done', detail)

        } catch (error) {  // catches fetch failures, swap errors, extension throws, etc.
            detail.error = error
            console.error(error)
            api.emit(element, 'htmx:error', detail)
        } finally {
            api.emit(element, 'htmx:finally', detail)
        }
    }

    // ── Parsing ─────────────────────────────────────────────────────────────

    /**
     * Token regex — matches one property in a RelaxedJSON segment.
     *
     * Grammar: `key:value` or bare `value`. Keys and values may be quoted.
     * Groups: 1=dq key, 2=sq key, 3=bare key, 4=dq val, 5=sq val, 6=bare val.
     * @type {RegExp}
     */
    const tokenPattern = /(?:"([^"]*)"|'([^']*)'|([^\s,:]+))(?:\s*:\s*(?:"([^"]*)"|'([^']*)'|([^\s,]*)))?/g

    /**
     * Coerce a string to a native type.
     * @param {string} text - Raw string value.
     * @returns {string|boolean|number} Coerced value.
     * @example coerce("true")   // true
     * @example coerce("300ms")  // 300
     * @example coerce("2s")     // 2000
     * @example coerce("1m")     // 60000
     */
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

    /**
     * Parse a RelaxedJSON segment into an object (ADR-054).
     * Extensions wrap `api.parse` for exotic syntax (protect-and-restore).
     * @param {string|null|undefined} text - One segment (caller splits on commas).
     * @param {{as?: string}} [options] - Options. `as` renames the first bare token.
     * @returns {?Object} Parsed object, or null if empty.
     * @example parse("click delay:300ms once")           // {value: "click", delay: 300, once: true}
     * @example parse("innerHTML")                        // {value: "innerHTML"}
     * @example parse("innerHTML", {as: 'style'})         // {style: "innerHTML"}
     * @example parse("click delay:300ms", {as: 'event'}) // {event: "click", delay: 300}
     */
    function parse(text, options) {
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

    // ── Start ───────────────────────────────────────────────────────────────

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', boot)
    } else {
        queueMicrotask(boot)
    }

    // ── Internal API ────────────────────────────────────────────────────────
    // Extensions receive this as the second argument in event handlers.
    // They can wrap/replace functions here; internal code calls through api.

    // ── Swap Styles ────────────────────────────────────────────────────────
    // Plain object — extensions add styles via direct assignment:
    //   api.swaps.morph = (target, content) => { ... }

    const swaps = {
        innerHTML: (target, content) => {
            target.innerHTML = '';
            target.append(content)
        },
        outerHTML: (target, content) => target.replaceWith(content),
        beforebegin: (target, content) => target.before(content),
        afterbegin: (target, content) => target.prepend(content),
        beforeend: (target, content) => target.append(content),
        afterend: (target, content) => target.after(content),
        delete: (target) => target.remove(),
        none: () => {
        },
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

    const api = {
        config,
        register,
        init,
        initElement,
        cleanup,
        cleanupElement,
        swap,
        ajax,
        emit,
        on,
        attr,
        find,

        swaps,  // swaps registry
        parse,  // attribute parser
        state,  // element state
        wrap,   // function wrapper (for extensions)
    }

    // ── Public API ──────────────────────────────────────────────────────────
    // Small surface. Getters delegate to api so extension wraps take effect.

    return {
        version: '4.0.0',
        config,
        register,
        get init() {
            return api.init
        },
        /**
         * Public swap — accepts flat options, normalizes to a pipeline detail
         * (the object that becomes event.detail on htmx:before:swap etc.).
         *
         * Extra keys become modifiers on detail.swap for extensions to read.
         *
         * @example htmx.swap({content: '<p>hi</p>', style: 'innerHTML', target: '#foo'})
         * @example htmx.swap({content: '<p>hi</p>', style: 'innerHTML', target: '#foo', transition: true})
         */
        swap(options) {
            const {element, content, target, style, ...modifiers} = options
            return api.swap({
                element: element || null,
                swap: {content, target, style: style || null, ...modifiers},
            })
        },
        /**
         * Public ajax — accepts flat options, normalizes to a pipeline detail
         * (the object that becomes event.detail on htmx:before:request etc.).
         *
         * Extra keys become modifiers on detail.request for extensions to read.
         * swap accepts a string (style shorthand) or object (with modifiers).
         *
         * @example htmx.ajax({url: '/api/data', method: 'POST', target: '#results'})
         * @example htmx.ajax({url: '/api', swap: {style: 'innerHTML', transition: true}})
         */
        ajax(options) {
            const {element, url, method, headers, body, target, swap, ...requestModifiers} = options
            const swapObj = typeof swap === 'string' ? {style: swap} : (swap || {})
            return api.ajax({
                element: element || null,
                request: {
                    url,
                    method: method || 'GET',
                    headers: headers || {},
                    body: body ?? null, ...requestModifiers
                },
                swap: {style: null, target: target || null, ...swapObj},
            })
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
            return api.parse
        },
        swaps,   // swap style registry
    }
})()
