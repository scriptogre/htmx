// htmx 4.0
//
// Lifecycle: init → trigger → request → response → swap → settle
//
// The core handles the pipeline, syntax, and conventions.
// Extensions add capabilities (triggers, modifiers, behaviors).

var htmx = (function () {
    'use strict'

    // ── Config ───────────────────────────────────────────────────────────────

    const config = {
        syntaxDelimiter: ':',
        initSelectors: ['[hx-get]', '[hx-post]', '[hx-put]', '[hx-patch]', '[hx-delete]'],
    }

    // ── Extensions ───────────────────────────────────────────────────────────

    const extensions = []
    let booted = false

    function register(name, extension) {
        if (extensions.some(registered => registered.name === name)) {
            throw new Error(`htmx: extension "${name}" already registered`)
        }
        for (const dependency of extension.requires || []) {
            if (!extensions.some(registered => registered.name === dependency)) {
                throw new Error(`htmx: extension "${name}" requires "${dependency}"`)
            }
        }
        extensions.push({name, ...extension})
        if (booted && extension.on?.['htmx:boot']) {
            extension.on['htmx:boot']({}, api)
        }
    }

    // ── Boot ─────────────────────────────────────────────────────────────────

    function boot() {
        booted = true
        api.emit(document, 'htmx:boot')

        // Extensions have wrapped api — safe to destructure
        const {init} = api
        init(document.body)

        new MutationObserver(mutations => {
            const {init} = api
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
        for (const child of root.querySelectorAll('*')) {
            if (state.has(child)) cleanup(child)
        }
    }

    // ── Init ─────────────────────────────────────────────────────────────────

    function init(root = document.body) {
        const {attr, emit, on} = api
        const selector = config.initSelectors.join(',')
        if (!selector) return

        const elements = root.matches?.(selector)
            ? [root, ...root.querySelectorAll(selector)]
            : [...root.querySelectorAll(selector)]

        for (const element of elements) {
            if (state.has(element)) continue
            const s = {handler: createHandler(element), cleanup: []}
            state.set(element, s)

            emit(element, 'htmx:before:init', {element})

            for (const each of (attr(element, 'hx-trigger') ?? '').split(/,(?![^\[]*\])/)) {
                const trigger = parse(each.trim())
                trigger.event = trigger.value
                const setup = {element, trigger, handler: s.handler, cleanup: []}
                if (emit(element, 'htmx:setup:trigger', setup) === false) continue
                if (!trigger.event) continue

                const targets = trigger.from
                    ? document.querySelectorAll(trigger.from)
                    : [element]
                for (const target of targets) {
                    const off = on(target, trigger.event, setup.handler, {once: trigger.once})
                    if (target !== element) s.cleanup.push(off)
                }

                for (const fn of setup.cleanup) s.cleanup.push(fn)
            }

            emit(element, 'htmx:after:init', {element})
        }
    }

    function cleanup(element) {
        if (!state.has(element)) return

        const {emit} = api
        emit(element, 'htmx:before:cleanup', {element})

        for (const callback of state.get(element).cleanup || []) callback()
        state.delete(element)

        emit(element, 'htmx:after:cleanup', {element})
    }

    // ── Handler ──────────────────────────────────────────────────────────────

    function createHandler(element) {
        return event => {
            const {attr, emit, ajax} = api
            event.preventDefault?.()
            const source = {element, event}
            if (emit(element, 'htmx:before:trigger', {source}) === false) return
            emit(element, 'htmx:after:trigger', {source})

            // Read verb + URL at trigger time (JIT — supports dynamic attributes)
            let url, method
            if ((url = attr(element, 'hx-get'))) method = 'GET'
            else if ((url = attr(element, 'hx-post'))) method = 'POST'
            else if ((url = attr(element, 'hx-put'))) method = 'PUT'
            else if ((url = attr(element, 'hx-patch'))) method = 'PATCH'
            else if ((url = attr(element, 'hx-delete'))) method = 'DELETE'
            else return

            ajax(url, {
                method,
                source,
                target: attr(element, 'hx-target'),
                swap: attr(element, 'hx-swap')?.split(/\s+/)[0],
            })
        }
    }

    function parse(raw) {
        if (!raw) return {value: null}

        const [value, ...parts] = raw.trim().split(/\s+/)
        const result = {value}

        for (const part of parts) {
            const index = part.indexOf(config.syntaxDelimiter)
            if (index > 0) {
                const key = part.slice(0, index)
                const rawValue = part.slice(index + 1)
                result[key] = parseDuration(rawValue) ?? rawValue
            } else {
                result[part] = true
            }
        }

        return result
    }

    function parseDuration(str) {
        const match = str?.match(/^(\d+)(ms|s|m)?$/)
        if (!match) return null
        const [, amount, unit] = match
        return unit === 's' ? amount * 1000 : unit === 'm' ? amount * 60000 : +amount
    }

    // ── Swap ───────────────────────────────────────────────────────────────

    function swap(content, target, options = {}) {
        const {emit, find, init} = api

        // Resolve target selector
        if (typeof target === 'string') target = find(target)
        if (!target) return

        // Parse HTML string to fragment
        if (typeof content === 'string') {
            const template = document.createElement('template')
            template.innerHTML = content
            content = template.content
        }

        const detail = {
            target,
            content,
            method: options.swap || null,
            fn: null,
            context: options.context || null,
        }

        if (emit(target, 'htmx:before:swap', detail) === false) return

        if (typeof detail.fn !== 'function') return

        const inserted = detail.fn(detail.target, detail.content)
        init(inserted || detail.target)

        emit(target, 'htmx:after:swap', detail)
    }

    // ── Request ──────────────────────────────────────────────────────────────

    async function ajax(url, options = {}) {
        const {emit, find, swap} = api
        const source = options.source || {element: document.body, event: null}

        // detail.request is a RequestInit (+ url) — extensions modify it in htmx:before:request
        const detail = {
            source,
            phase: 'request',
            request: {
                url,
                method: options.method || 'GET',
                headers: options.headers || {},
                body: options.body ?? null,
            },
            response: null,
            error: null,
        }

        const fail = (type, message, cause) => {
            detail.error = {type, message}
            if (cause) detail.error.cause = cause
            emit(source.element, 'htmx:error', detail)
        }

        try {
            // ── Request ──
            if (emit(source.element, 'htmx:before:request', detail) === false) return

            const {url: requestUrl, ...fetchOptions} = detail.request
            const response = await fetch(requestUrl, fetchOptions)

            emit(source.element, 'htmx:after:request', detail)

            // ── Response ──
            detail.phase = 'response'
            detail.response = {
                status: response.status,
                ok: response.ok,
                url: response.url,
                headers: Object.fromEntries(response.headers),
            }

            if (emit(source.element, 'htmx:before:response', detail) === false) return
            detail.response.text = await response.text()
            if (emit(source.element, 'htmx:after:response', detail) === false) return

            // ── Swap ──
            detail.phase = 'swap'
            const target = options.target
                ? find(source.element, options.target)
                : source.element
            if (!target) return fail('swap:target', `Target not found: ${options.target}`)

            swap(detail.response.text, target, {
                swap: options.swap,
                context: {source, response: detail.response},
            })

            // ── Settle ──
            detail.phase = 'settle'
            if (emit(source.element, 'htmx:before:settle', detail) === false) return
            emit(source.element, 'htmx:after:settle', detail)

            return detail.response

        } catch (error) {
            fail(detail.phase, error.message, error)
        } finally {
            emit(source.element, 'htmx:done', detail)
        }
    }

    // ── State ────────────────────────────────────────────────────────────────

    const state = new WeakMap()

    // ── DOM ──────────────────────────────────────────────────────────────────

    function find(element, selector) {
        if (selector === undefined) {
            selector = element;
            element = document
        }
        return element.querySelector(selector)
    }

    function findAll(element, selector) {
        if (selector === undefined) {
            selector = element;
            element = document
        }
        return [...element.querySelectorAll(selector)]
    }

    // ── Events ───────────────────────────────────────────────────────────────

    function emit(target, name, detail = {}) {
        for (const extension of extensions) {
            if (extension.on?.[name]?.(detail, api) === false) return false
        }

        const dispatchTarget = target?.isConnected ? target : document

        return dispatchTarget.dispatchEvent(new CustomEvent(name, {
            detail,
            bubbles: true,
            cancelable: true,
            composed: true,
        }))
    }

    function on(element, event, handler, options) {
        element.addEventListener(event, handler, options)
        const off = () => element.removeEventListener(event, handler, options)
        if (state.has(element)) {
            state.get(element).cleanup ||= []
            state.get(element).cleanup.push(off)
        }
        return off
    }

    // ── Start ────────────────────────────────────────────────────────────────

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', boot)
    } else {
        queueMicrotask(boot)
    }

    // ── Internal API ────────────────────────────────────────────────────────
    // Extensions receive this as the second argument in event handlers.
    // They can wrap/replace functions here; internal code calls through api.

    const api = {
        config,
        register,
        init,
        swap,
        ajax,
        emit,
        on,

        // Extensible internals
        attr: (element, name) => element.getAttribute(name),
        find,
        findAll,

        // Utilities
        state,
        parse,
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
        get swap() {
            return api.swap
        },
        get ajax() {
            return api.ajax
        },
        get emit() {
            return api.emit
        },
        get on() {
            return api.on
        },
        get find() {
            return api.find
        },
        get findAll() {
            return api.findAll
        },
    }
})()
