// htmx 4.0-beta — Kernel Draft
// Based on REFACTOR.md architecture. Events-only extension system.

// ─── RELAXED JSON ──────────────────────────────────────────────────────
// Default syntax format for htmx attributes.
// "value mod:x mod:y flag" ↔ { value, mod: "x", flag: true }
// Swappable: set config.syntax.format to any object with parse/stringify.

function duration(str) {
    const [, n, unit] = str?.match(/^(\d+)(ms|s|m)?$/) || []
    return n ? (unit === 's' ? n * 1000 : unit === 'm' ? n * 60000 : +n) : null
}

const RelaxedJSON = {
    parse(raw) {
        if (!raw) return {value: null}
        const parts = raw.trim().split(/\s+/)
        const result = {value: parts[0]}
        for (const part of parts.slice(1)) {
            const i = part.indexOf(':')
            if (i > 0) {
                const v = part.slice(i + 1)
                result[part.slice(0, i)] = duration(v) ?? v
            } else result[part] = true
        }
        return result
    },

    stringify(obj) {
        if (!obj || obj.value == null) return ''
        let out = obj.value
        for (const [k, v] of Object.entries(obj)) {
            if (k === 'value') continue
            out += v === true ? ` ${k}` : ` ${k}:${v}`
        }
        return out
    },
}

var htmx = (function () {
    'use strict'

    // ─── CONFIG ──────────────────────────────────────────────────────────────
    // Ordered by pipeline: trigger → request → swap → syntax
    // Each namespace has scalar defaults + optional registry
    // Headers can be strings or functions (evaluated at request time)

    const config = {
        trigger: {
            event: 'click',                    // default trigger event
            delay: 0,                          // default delay (ms)
            throttle: 0,                       // default throttle (ms)
            // Registry: non-DOM triggers (event sources). Anything not here is a DOM event name.
            registry: {},                      // populated below: { load, revealed, intersect, every }
            // Modifiers: handler wrappers, applied in object key order (inner-to-outer)
            modifiers: {},                     // populated below: { filter, target, changed, delay, throttle, consume }
        },
        request: {
            timeout: 60000,
            credentials: 'same-origin',
            mode: 'same-origin',
            // Static strings or functions. Functions called with { source, url, method } before htmx:before:request.
            headers: {
                'HX-Request': 'true',
                'HX-Current-URL': () => location.href,
            },
        },
        swap: {
            method: 'innerHTML',               // default swap method
            target: 'this',                    // default swap target
            settle: 20,                        // default settle delay (ms)
            transition: false,                 // default view transition
            // Registry: swap methods. Key is method name, value is fn(target, content).
            registry: {},                      // populated by kernel: { innerHTML, outerHTML, ... }
        },
        syntax: {
            prefix: 'hx-',
            delimiter: ':',
            format: RelaxedJSON,
        },
        debug: false,
    }

    // ─── STATE (WeakMap) ─────────────────────────────────────────────────────

    const _state = new WeakMap()

    function state(element) {
        let s = _state.get(element)
        if (!s) {
            s = {}
            _state.set(element, s)
        }
        return s
    }

    // ─── EXTENSIONS ──────────────────────────────────────────────────────────

    const extensions = []
    let initialized = false

    function register(name, extension) {
        if (extensions.find(e => e.name === name)) {
            throw new Error(`htmx: extension "${name}" already registered`)
        }
        for (const dep of extension.requires || []) {
            if (!extensions.find(e => e.name === dep)) {
                throw new Error(`htmx: extension "${name}" requires "${dep}" which is not registered`)
            }
        }
        extensions.push({name, ...extension})
        if (initialized && extension.on?.['htmx:ready']) {
            extension.on['htmx:ready']({})
        }
    }

    // ─── WRAPPED ELEMENTS ────────────────────────────────────────────────────

    const WRAPPED = Symbol('htmx.wrapped')

    function wrap(element) {
        if (!element) return null
        if (element[WRAPPED]) return element
        return new Proxy(element, {
            get(target, prop) {
                if (prop === WRAPPED) return true
                if (prop === 'native') return target
                if (prop === 'attr') return (name, opts) => attr(target, name, opts)
                if (prop === 'find') return (sel) => wrap(target.querySelector(sel))
                if (prop === 'findAll') return (sel) => [...target.querySelectorAll(sel)].map(wrap)
                if (prop === 'emit') return (name, detail) => emit(target, name, detail)
                if (prop === 'on') return (event, handler, options) => on(target, event, handler, options)
                if (prop === 'state') return state(target)
                const value = target[prop]
                return typeof value === 'function' ? value.bind(target) : value
            }
        })
    }

    function attr(element, canonicalName, {inherit = true} = {}) {
        const {prefix, delimiter} = config.syntax
        const name = canonicalName.replace(/^hx-/, prefix).replace(/:/g, delimiter)
        const direct = element.getAttribute(name)
        if (direct !== null) return direct
        if (!inherit) return null
        let current = element.parentElement
        while (current) {
            const value = current.getAttribute(name)
            if (value !== null) return value
            current = current.parentElement
        }
        return null
    }

    function find(element, selector) {
        return wrap(element.querySelector(selector))
    }

    function findAll(element, selector) {
        return [...element.querySelectorAll(selector)].map(wrap)
    }

    // ─── EVENT BINDING ────────────────────────────────────────────────────────
    // Binds listener and tracks cleanup function in element.state["cleanup"]
    // Returns off() function to remove the listener

    function on(element, event, handler, options) {
        const target = element.native || element
        target.addEventListener(event, handler, options)

        const off = () => target.removeEventListener(event, handler, options)

        // Track for automatic cleanup
        state(target)["cleanup"] ||= []
        state(target)["cleanup"].push(off)

        return off
    }

    // ─── PARSE / STRINGIFY ─────────────────────────────────────────────────
    // Delegates to config.syntax.format (default: RelaxedJSON, defined above IIFE)

    function parse(raw) {
        return config.syntax.format.parse(raw)
    }

    function stringify(obj) {
        return config.syntax.format.stringify(obj)
    }

    // ─── EVENT EMISSION ─────────────────────────────────────────────────────

    // Recursively unwrap proxied elements for DOM events
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

    function emit(element, eventName, detail = {}) {
        // Extensions receive wrapped elements (convenience)
        for (const ext of extensions) {
            const handler = ext.on?.[eventName]
            if (handler && handler(detail) === false) return false
        }
        // DOM events receive unwrapped elements (standard DOM)
        const target = (element?.native || element)?.isConnected !== false
            ? (element?.native || element)
            : document
        return target.dispatchEvent(new CustomEvent(eventName, {
            detail: unwrap(detail), bubbles: true, cancelable: true, composed: true,
        }))
    }

    // ─── TARGET RESOLUTION ──────────────────────────────────────────────────

    function resolveTarget(element, selector) {
        if (!selector || selector === 'this') return element
        if (selector === 'body') return document.body
        if (selector.startsWith('closest ')) return element.closest(selector.slice(8))
        if (selector.startsWith('find ')) return element.querySelector(selector.slice(5))
        return document.querySelector(selector)
    }

    // ─── FRAGMENT PARSING ───────────────────────────────────────────────────

    function makeFragment(html) {
        const template = document.createElement('template')
        template.innerHTML = html
        return template.content
    }

    // ─── TRIGGER PARSING ────────────────────────────────────────────────────

    function parseTrigger(raw) {
        // Normalize exotic syntax: "every 2s" → "every interval:2s"
        const normalized = raw.replace(/^every\s+(\d+(?:ms|s|m)?)/, 'every interval:$1')

        // "click[key=='Enter'] delay:500ms" → {value: "click[key=='Enter']", delay: 500}
        const {value: eventWithFilter, ...modifiers} = parse(normalized) || {}

        // "click[key=='Enter']" → event: "click", filter: "key=='Enter'"
        const [, event, filter] = eventWithFilter?.match(/^([^\[]+?)(?:\[(.+)])?$/) || []

        // Filter becomes a modifier (handled by filter modifier if registered)
        if (filter) modifiers.filter = filter

        return {event, modifiers}
    }

    // ─── DOM PROCESSING ─────────────────────────────────────────────────────

    function setupTriggers(element) {
        // Base handler: emit before/after trigger events
        const fire = (event) => {
            event.preventDefault?.()
            const source = {element, event}
            if (element.emit('htmx:before:trigger', {source}) === false) return
            element.emit('htmx:after:trigger', {source})
        }

        // Default trigger based on element type
        const node = element.native
        const defaultEvent = node.matches('form') ? 'submit'
            : node.matches('input:not([type=button]),select,textarea') ? 'change'
            : config.trigger.event

        const triggers = element.attr('hx-trigger')?.split(/,(?![^\[]*\])/).map(s => s.trim())
            ?? [defaultEvent]

        for (const trigger of triggers) {
            const {event: eventName, modifiers} = parseTrigger(trigger)

            // Apply modifiers from registry (order is object key order)
            let handler = fire
            for (const [name, fn] of Object.entries(config.trigger.modifiers)) {
                const value = modifiers[name]
                if (value !== undefined && fn) {
                    handler = fn(handler, value, element)
                }
            }

            // Check synthetic trigger registry (load, revealed, intersect, every)
            const synthetic = config.trigger.registry[eventName]
            if (synthetic) {
                const cleanup = synthetic(element, modifiers, handler)
                if (cleanup) {
                    element.state.cleanup ||= []
                    element.state.cleanup.push(cleanup)
                }
                continue
            }

            // Standard DOM event binding
            bindTriggerEvent(element, eventName || defaultEvent, handler, modifiers)
        }
    }

    function bindTriggerEvent(element, eventName, handler, modifiers) {
        // from: modifier changes which element(s) listen
        const targets = modifiers.from
            ? [...document.querySelectorAll(modifiers.from)]
            : [element.native]

        for (const target of targets) {
            target.addEventListener(eventName, handler, {once: modifiers.once})
            element.state.cleanup ||= []
            element.state.cleanup.push(() => target.removeEventListener(eventName, handler))
        }
    }

    function init(root = document.body) {
        const selector = config.selectors?.init?.join(',')
        if (!selector) return

        const nodes = root.matches?.(selector)
            ? [root, ...root.querySelectorAll(selector)]
            : root.querySelectorAll(selector)

        for (const node of nodes) {
            if (_state.has(node)) continue

            const element = wrap(node)

            element.emit('htmx:before:init', {element, root: wrap(root)})

            setupTriggers(element)

            element.emit('htmx:after:init', {element, root: wrap(root)})
        }
    }

    function cleanup(node) {
        if (!_state.has(node)) return
        const element = wrap(node)

        element.emit('htmx:before:cleanup', {element})

        // Run all cleanup functions (listeners, intervals, observers, etc.)
        for (const fn of element.state["cleanup"] || []) fn()

        _state.delete(node)

        element.emit('htmx:after:cleanup', {element})
    }

    // ─── FETCH ──────────────────────────────────────────────────────────────

    // Resolve headers: static strings pass through, functions called with { source, url, method }
    function buildHeaders(headers, context) {
        const resolved = {}
        for (const [key, value] of Object.entries(headers)) {
            resolved[key] = typeof value === 'function' ? value(context) : value
        }
        return resolved
    }

    async function fetch(url, options = {}) {
        // source = what initiated this request (element + event)
        // Distinct from config.trigger which configures the trigger system
        const source = {
            element: options.source?.element || wrap(document.body),
            event: options.source?.event ?? null,
        }
        const method = options.method || 'GET'

        const detail = {
            source,
            request: {
                url,
                method,
                headers: {
                    ...buildHeaders(config.request.headers, {source, url, method}),
                    ...options.headers,
                },
                body: options.body ?? null,
            },
            response: null,
            swap: null,
            error: null,
        }

        try {
            if (emit(source.element, 'htmx:before:request', detail) === false) return

            const response = await window.fetch(detail.request.url, {
                method: detail.request.method,
                headers: detail.request.headers,
                body: detail.request.body,
                credentials: config.request.credentials,
                mode: config.request.mode,
            })

            await emit(source.element, 'htmx:after:request', detail)

            // Response received - status/headers available, body not yet read
            detail.response = {
                status: response.status,
                url: response.url,
                headers: Object.fromEntries(response.headers),
                text: null,
            }

            if (await emit(source.element, 'htmx:before:response', detail) === false) return

            // Read response body
            detail.response.text = await response.text()

            if (await emit(source.element, 'htmx:after:response', detail) === false) return

            const targetSelector = options.swap?.target || config.swap.target
            const target = resolveTarget(source.element.native || source.element, targetSelector)

            if (!target) {
                detail.error = {type: 'target', message: `Target not found: ${targetSelector}`}
                await emit(source.element, 'htmx:error', detail)
                return
            }

            detail.swap = {
                ...options.swap,
                content: makeFragment(detail.response.text),
                target: wrap(target),
                method: options.swap?.method || config.swap.method,
            }

            if (await emit(source.element, 'htmx:before:swap', detail) === false) return

            performSwap(target, detail.swap.method, detail.swap.content)
            init(target)

            await emit(source.element, 'htmx:after:swap', detail)

            if (await emit(source.element, 'htmx:before:settle', detail) === false) return

            // CSS settle phase would happen here

            await emit(source.element, 'htmx:after:settle', detail)
            return detail.response

        } catch (error) {
            detail.error = {
                type: error.name === 'AbortError' ? 'abort' : 'network',
                message: error.message,
                cause: error,
            }
            await emit(source.element, 'htmx:error', detail)
        } finally {
            await emit(source.element, 'htmx:done', detail)
        }
    }

    function performSwap(target, method, fragment) {
        const handler = config.swap.registry[method]
        if (handler) {
            handler(target, fragment)
        } else {
            // Fallback to innerHTML if method not in registry
            config.swap.registry.innerHTML(target, fragment)
        }
    }

    // ─── POPULATE REGISTRIES ───────────────────────────────────────────────────

    // Swap methods: fn(target, content)
    Object.assign(config.swap.registry, {
        innerHTML: (target, content) => target.replaceChildren(content),
        outerHTML: (target, content) => target.replaceWith(content),
        textContent: (target, content) => {
            target.textContent = content.textContent
        },
        beforebegin: (target, content) => target.before(content),
        afterbegin: (target, content) => target.prepend(content),
        beforeend: (target, content) => target.append(content),
        afterend: (target, content) => target.after(content),
        delete: (target) => target.remove(),
        none: () => {
        },
    })

    // Trigger registry: non-DOM triggers
    // Each entry is fn(element, modifiers, fire) where fire() triggers the request
    // Returns cleanup function (or nothing)
    Object.assign(config.trigger.registry, {
        load: (element, modifiers, fire) => {
            queueMicrotask(() => fire(new Event('load')))
        },
        revealed: (element, modifiers, fire) => {
            const observer = new IntersectionObserver((entries) => {
                for (const entry of entries) {
                    if (!entry.isIntersecting) continue
                    fire(new Event('revealed'))
                    observer.disconnect()
                }
            })
            observer.observe(element.native || element)
            return () => observer.disconnect()
        },
        intersect: (element, modifiers, fire) => {
            const observer = new IntersectionObserver((entries) => {
                for (const entry of entries) {
                    if (!entry.isIntersecting) continue
                    fire(new Event('intersect'))
                    if (modifiers.once) observer.disconnect()
                }
            })
            observer.observe(element.native || element)
            return () => observer.disconnect()
        },
        every: (element, modifiers, fire) => {
            const interval = modifiers.interval || 1000
            const id = setInterval(() => fire(new Event('poll')), interval)
            return () => clearInterval(id)
        },
    })

    // Trigger modifiers: handler wrappers, applied in object key order
    // Each entry is fn(handler, value, element) → wrappedHandler
    // Order matters: later entries wrap earlier ones (run first when event fires)
    Object.assign(config.trigger.modifiers, {
        // Filter: gate on expression (requires allowEval)
        filter: (handler, expr, element) => {
            if (!config.security?.allowEval) {
                console.warn('htmx: filter expressions require security.allowEval')
                return handler
            }
            return (event) => {
                const args = {}
                for (const key in event) args[key] = event[key]
                for (const key of Object.keys(event)) args[key] = event[key]
                const keys = Object.keys(args)
                const values = Object.values(args)
                try {
                    const test = new Function(...keys, `return (${expr})`)
                    if (test(...values)) handler(event)
                } catch (e) {
                    console.warn('htmx: filter expression error:', e.message)
                }
            }
        },

        // Target: gate on event.target matching selector
        target: (handler, selector) => (event) => {
            if (event.target.matches(selector)) handler(event)
        },

        // Changed: gate on value change (for inputs)
        changed: (handler, _, element) => {
            let lastValue = element.native.value
            return (event) => {
                if (element.native.value === lastValue) return
                lastValue = element.native.value
                handler(event)
            }
        },

        // Delay: debounce (resets on each event)
        delay: (handler, ms, element) => {
            const delay = ms || config.trigger.delay
            if (!delay) return handler
            let timeout
            return (event) => {
                clearTimeout(timeout)
                timeout = setTimeout(() => handler(event), delay)
            }
        },

        // Throttle: rate limit (fires at most once per interval)
        throttle: (handler, ms, element) => {
            const throttle = ms || config.trigger.throttle
            if (!throttle) return handler
            let last = 0
            return (event) => {
                if (Date.now() - last < throttle) return
                last = Date.now()
                handler(event)
            }
        },

        // Consume: stop propagation
        consume: (handler) => (event) => {
            event.stopPropagation()
            handler(event)
        },
    })

    // ─── BUILT-IN EXTENSIONS ────────────────────────────────────────────────
    // Core htmx behaviors as extensions. Dogfoods the extension system.

    // -- Init Phase --

    register('hx-request', {
        on: {
            'htmx:ready': () => {
                config.selectors ||= {}
                config.selectors.init ||= []
                config.selectors.init.push('[hx-get]', '[hx-post]', '[hx-put]', '[hx-patch]', '[hx-delete]')
            },
            'htmx:after:trigger': ({source}) => {
                // JIT: read request config
                for (const method of ['get', 'post', 'put', 'patch', 'delete']) {
                    const url = source.element.attr(`hx-${method}`)
                    if (url) {
                        const {value: swapMethod, ...swapMods} = parse(source.element.attr('hx-swap')) || {}
                        fetch(url, {
                            method: method.toUpperCase(),
                            source,
                            swap: {
                                method: swapMethod || config.swap.method,
                                target: source.element.attr('hx-target') || config.swap.target,
                                ...swapMods,
                            },
                        })
                        return
                    }
                }
            },
        },
    })

    register('dom-marker', {
        on: {
            'htmx:after:init': ({element}) => {
                element.native.toggleAttribute('data-htmx', true)
            },
            'htmx:after:cleanup': ({element}) => {
                element.native.removeAttribute('data-htmx')
            },
        },
    })

    const HTMX = 'color:#3d72d7;font-weight:600'
    const BADGE = 'background:#3d72d7;color:white;padding:2px 6px;border-radius:3px;font-weight:600'
    const DIM = 'color:#999;font-weight:normal'
    const LABEL = 'color:#666;font-weight:normal'

    function logField(name, value) {
        console.log('%c' + name, 'font-weight:bold', value)
    }

    const pendingInits = []
    let initLogScheduled = false

    function flushInits() {
        if (pendingInits.length === 0) return
        // Group by element (before/after pairs)
        const byElement = []
        for (let i = 0; i < pendingInits.length; i += 2) {
            const before = pendingInits[i]
            const after = pendingInits[i + 1]
            byElement.push({element: before.detail.source.element, events: [before, after].filter(Boolean)})
        }

        console.groupCollapsed('%chtmx %cinit%c  ' + byElement.length + ' elements', HTMX, BADGE, DIM)
        for (const {element, events} of byElement) {
            console.groupCollapsed(element)
            for (const {name, detail} of events) {
                const padded = ('htmx:' + name).padEnd(20)
                console.log(padded, detail)
            }
            console.groupEnd()
        }
        console.groupEnd()
        pendingInits.length = 0
        initLogScheduled = false
    }

    register('debug', {
        on: {
            'htmx:ready': () => {
                if (!config.debug) return
                console.groupCollapsed('%chtmx %cready', HTMX, BADGE)
                console.log('%chtmx:ready', LABEL)
                console.groupEnd()
            },
            'htmx:before:init': ({element, root}) => {
                if (!config.debug) return
                element.state._debug = {}
                pendingInits.push({
                    name: 'before:init',
                    detail: {source: {element: element.native, root: root?.native}}
                })
                if (!initLogScheduled) {
                    initLogScheduled = true
                    queueMicrotask(flushInits)
                }
            },
            'htmx:after:init': ({element, root}) => {
                if (!config.debug) return
                pendingInits.push({name: 'after:init', detail: {source: {element: element.native, root: root?.native}}})
            },
            'htmx:before:trigger': ({source}) => {
                if (!config.debug) return
                source.element.state._debug = {start: performance.now(), events: []}
                source.element.state._debug.events.push({name: 'before:trigger', detail: {source: unwrap(source)}})
            },
            'htmx:after:trigger': ({source}) => {
                if (!config.debug) return
                source.element.state._debug.events.push({name: 'after:trigger', detail: {source: unwrap(source)}})
            },
            'htmx:before:request': ({source, request}) => {
                if (!config.debug) return
                source.element.state._debug.requestStart = performance.now()
                source.element.state._debug.events.push({
                    name: 'before:request',
                    detail: {source: unwrap(source), request}
                })
            },
            'htmx:after:request': ({source, request}) => {
                if (!config.debug) return
                source.element.state._debug.events.push({
                    name: 'after:request',
                    detail: {source: unwrap(source), request}
                })
            },
            'htmx:before:response': ({source, request, response}) => {
                if (!config.debug) return
                source.element.state._debug.events.push({
                    name: 'before:response',
                    detail: {source: unwrap(source), request, response}
                })
            },
            'htmx:after:response': ({source, request, response}) => {
                if (!config.debug) return
                source.element.state._debug.events.push({
                    name: 'after:response',
                    detail: {source: unwrap(source), request, response}
                })
            },
            'htmx:before:swap': ({source, request, response, swap}) => {
                if (!config.debug) return
                source.element.state._debug.events.push({
                    name: 'before:swap',
                    detail: {source: unwrap(source), request, response, swap: unwrap(swap)}
                })
            },
            'htmx:after:swap': ({source, request, response, swap}) => {
                if (!config.debug) return
                source.element.state._debug.events.push({
                    name: 'after:swap',
                    detail: {source: unwrap(source), request, response, swap: unwrap(swap)}
                })
            },
            'htmx:before:settle': ({source, request, response, swap}) => {
                if (!config.debug) return
                source.element.state._debug.events.push({
                    name: 'before:settle',
                    detail: {source: unwrap(source), request, response, swap: unwrap(swap)}
                })
            },
            'htmx:after:settle': ({source, request, response, swap}) => {
                if (!config.debug) return
                source.element.state._debug.events.push({
                    name: 'after:settle',
                    detail: {source: unwrap(source), request, response, swap: unwrap(swap)}
                })
            },
            'htmx:error': ({source, request, response, swap, error}) => {
                if (!config.debug) return
                source.element.state._debug.events.push({
                    name: 'error',
                    detail: {source: unwrap(source), request, response, swap: unwrap(swap), error}
                })
            },
            'htmx:done': ({source, request, response, error}) => {
                if (!config.debug) return
                const debug = source.element.state._debug || {}
                const ms = debug.requestStart ? Math.round(performance.now() - debug.requestStart) : '?'

                const status = error ? 'ERR' : response?.status
                const statusColor = error || (response?.status >= 400) ? 'color:#c00' : 'color:#080'

                console.groupCollapsed('%chtmx %c' + request.method + '%c ' + request.url + ' %c' + status + '%c %c' + ms + 'ms',
                    HTMX, BADGE, '', statusColor, '', DIM)

                for (const {name, detail} of debug.events || []) {
                    const padded = ('htmx:' + name).padEnd(20)
                    console.log(padded, detail)
                }
                console.groupEnd()
            },
            'htmx:before:cleanup': ({element}) => {
                if (!config.debug) return
                const el = element.native
                const tag = el.tagName.toLowerCase()
                const id = el.id ? '#' + el.id : ''
                console.groupCollapsed('%chtmx %ccleanup%c  ' + tag + id, HTMX, BADGE, DIM)
                console.log('%chtmx:before:cleanup', LABEL)
                logField('element', el)
                console.groupEnd()
            },
        },
    })

    function labelFor(el) {
        if (!el) return '?'
        let s = el.tagName.toLowerCase()
        if (el.id) s += '#' + el.id
        else if (el.className) s += '.' + el.className.split(' ')[0]
        return s
    }

    function snippetFor(el) {
        if (!el) return '<?>'
        const tag = el.tagName.toLowerCase()
        const id = el.id ? `#${el.id}` : ''
        const hx = [...el.attributes]
            .filter(a => a.name.startsWith('hx-'))
            .map(a => `${a.name}="${a.value}"`)
            .join(' ')
        return `<${tag}${id}${hx ? ' ' + hx : ''}>`
    }

    register('hx-boost', {
        on: {
            'htmx:after:init': ({element}) => {
                // TODO: If hx-boost="true", intercept links/forms and add htmx behavior
            },
        },
    })

    register('hx-on', {
        on: {
            'htmx:after:init': ({element}) => {
                // TODO: Find hx-on:* attributes, bind event handlers
                // Support hx-on::request shorthand for htmx:request
            },
            'htmx:before:cleanup': ({element}) => {
                // TODO: Remove hx-on:* event handlers
            },
        },
    })

    // NOTE: exotic triggers (polling, load, intersect) are now handled directly in kernel init()

    // -- Request Phase --

    register('hx-confirm', {
        on: {
            'htmx:before:request': async ({source}) => {
                const message = source.element.attr('hx-confirm')
                if (message) {
                    // TODO: Support custom confirm dialog via htmx:confirm event
                    if (!window.confirm(message)) return false
                }
            },
        },
    })

    register('hx-headers', {
        on: {
            'htmx:before:request': ({source, request}) => {
                const raw = source.element.attr('hx-headers')
                if (raw) {
                    // TODO: Parse JSON (or js: expression), merge into request.headers
                }
            },
        },
    })

    register('hx-validate', {
        on: {
            'htmx:before:request': ({source}) => {
                if (source.element.attr('hx-validate') === 'true') {
                    // TODO: Find enclosing form, call reportValidity()
                    // Return false if validation fails
                }
            },
        },
    })

    register('hx-encoding', {
        on: {
            'htmx:before:request': ({source, request}) => {
                if (source.element.attr('hx-encoding') === 'multipart/form-data') {
                    // TODO: Ensure request.body is FormData (not URLSearchParams)
                    // Don't set Content-Type header (browser sets it with boundary)
                }
            },
        },
    })

    register('formData', {
        on: {
            'htmx:before:request': ({source, request}) => {
                const el = source.element.native
                const form = el.tagName === 'FORM' ? el : el.closest('form')
                if (!form && !el.name) return

                const data = form ? new FormData(form) : new FormData()

                // If source is an input/button with name, include it
                if (el.name && el !== form) {
                    data.set(el.name, el.value || '')
                }

                if (request.method === 'GET') {
                    const url = new URL(request.url, location.origin)
                    for (const [k, v] of data) url.searchParams.append(k, v)
                    request.url = url.pathname + url.search
                } else {
                    request.body = new URLSearchParams(data)
                    request.headers['Content-Type'] = 'application/x-www-form-urlencoded'
                }
            },
        },
    })


    register('jsEval', {
        on: {
            'htmx:ready': () => {
                config.security = {
                    allowEval: true,
                    nonce: null,
                    ...config.security,
                }
            },
            'htmx:before:request': ({source, request}) => {
                // TODO: Check for js: or javascript: prefix in hx-vals, hx-headers
            },
        },
    })

    register('hx-vals', {
        requires: ['formData'],
        on: {
            'htmx:before:request': ({source, request}) => {
                const raw = source.element.attr('hx-vals')
                if (!raw) return

                let vals
                try {
                    vals = JSON.parse(raw)
                } catch {
                    console.warn('htmx: invalid JSON in hx-vals:', raw)
                    return
                }

                if (request.method === 'GET') {
                    const url = new URL(request.url, location.origin)
                    for (const [k, v] of Object.entries(vals)) url.searchParams.set(k, v)
                    request.url = url.pathname + url.search
                } else {
                    const params = request.body instanceof URLSearchParams
                        ? request.body
                        : new URLSearchParams()
                    for (const [k, v] of Object.entries(vals)) params.set(k, v)
                    request.body = params
                    request.headers['Content-Type'] = 'application/x-www-form-urlencoded'
                }
            },
        },
    })

    register('hx-include', {
        requires: ['formData'],
        on: {
            'htmx:before:request': ({source, request}) => {
                const sel = source.element.attr('hx-include')
                if (!sel) return

                const elements = sel === 'this'
                    ? [source.element.native]
                    : [...document.querySelectorAll(sel)]

                const params = request.body instanceof URLSearchParams
                    ? request.body
                    : new URLSearchParams()

                for (const el of elements) {
                    if (el.name) {
                        params.set(el.name, el.value || '')
                    } else if (el.tagName === 'FORM') {
                        for (const [k, v] of new FormData(el)) params.set(k, v)
                    }
                }

                if (request.method === 'GET') {
                    const url = new URL(request.url, location.origin)
                    for (const [k, v] of params) url.searchParams.append(k, v)
                    request.url = url.pathname + url.search
                } else {
                    request.body = params
                    request.headers['Content-Type'] = 'application/x-www-form-urlencoded'
                }
            },
        },
    })

    register('hx-indicator', {
        on: {
            'htmx:before:request': ({source}) => {
                // TODO: Find indicator elements, add htmx-request class
                // Store refs on source.element.state.indicator
            },
            'htmx:done': ({source}) => {
                // TODO: Remove htmx-request class from stored indicators
            },
        },
    })

    register('hx-disable', {
        on: {
            'htmx:before:request': ({source}) => {
                // TODO: Find elements, set disabled attribute
                // Store refs on source.element.state.disable
            },
            'htmx:done': ({source}) => {
                // TODO: Remove disabled attribute
            },
        },
    })

    register('hx-sync', {
        on: {
            'htmx:after:init': ({element}) => {
                element.state["sync"] = {
                    inflight: null,
                    controller: null,
                    queue: [],
                }
            },
            'htmx:before:request': ({source, request}) => {
                // Normalize hx-sync syntax before parsing:
                // "closest form:drop" → "closest form strategy:drop"
                // "#target:abort" → "#target strategy:abort"
                const raw = source.element.attr('hx-sync')
                if (!raw) return
                const normalized = raw.replace(/:(?=drop|abort|replace|queue)/, ' strategy:')
                const {value: targetSelector, strategy = 'drop'} = parse(normalized)

                const syncTarget = targetSelector === 'this'
                    ? source.element
                    : wrap(resolveTarget(source.element.native, targetSelector))
                if (!syncTarget) return

                const sync = syncTarget.state["sync"]
                if (!sync) return

                if (!sync.inflight) {
                    sync.controller = new AbortController()
                    request.signal = sync.controller.signal
                    sync.inflight = request._promise
                    return
                }

                switch (strategy) {
                    case 'drop':
                        return false
                    case 'abort':
                    case 'replace':
                        if (sync.controller) sync.controller.abort()
                        sync.controller = new AbortController()
                        request.signal = sync.controller.signal
                        return
                    case 'queue':
                    case 'queue last':
                        sync.queue = [{request, source}]
                        return false
                    case 'queue first':
                        if (sync.queue.length === 0) sync.queue.push({request, source})
                        return false
                    case 'queue all':
                        sync.queue.push({request, source})
                        return false
                    default:
                        return false
                }
            },
            'htmx:done': ({source}) => {
                // Normalize hx-sync syntax before parsing:
                // "closest form:drop" → "closest form strategy:drop"
                const raw = source.element.attr('hx-sync')
                if (!raw) return
                const normalized = raw.replace(/:(?=drop|abort|replace|queue)/, ' strategy:')
                const {value: targetSelector} = parse(normalized)

                const syncTarget = targetSelector === 'this'
                    ? source.element
                    : wrap(resolveTarget(source.element.native, targetSelector))
                if (!syncTarget) return

                const sync = syncTarget.state["sync"]
                if (!sync) return

                sync.inflight = null
                sync.controller = null

                if (sync.queue.length > 0) {
                    const next = sync.queue.shift()
                    queueMicrotask(() => {
                        fetch(next.request.url, {
                            method: next.request.method,
                            headers: next.request.headers,
                            body: next.request.body,
                            source: next.source,
                        })
                    })
                }
            },
            'htmx:before:cleanup': ({element}) => {
                const sync = element.state["sync"]
                if (sync) {
                    if (sync.controller) sync.controller.abort()
                    sync.queue = []
                    sync.inflight = null
                }
            },
        },
    })

    register('timeout', {
        on: {
            'htmx:ready': () => {
                config.timeout = {default: 60000, ...config.timeout}
            },
            'htmx:before:request': ({source, request}) => {
                // TODO: Set up AbortController with timeout
            },
            'htmx:done': ({source}) => {
                // TODO: Clear timeout
            },
        },
    })

    register('etag', {
        on: {
            'htmx:before:request': ({source, request}) => {
                // TODO: Check ETag cache, add If-None-Match header
            },
            'htmx:before:response': ({source, response}) => {
                // TODO: Cache ETag from response headers
            },
        },
    })

    // -- Response Phase --

    register('noSwap', {
        on: {
            'htmx:ready': () => {
                config.noSwap = {statusCodes: [204, 304], ...config.noSwap}
            },
            'htmx:after:response': ({response}) => {
                if (config.noSwap.statusCodes.includes(response.status)) return false
            },
        },
    })

    register('responseHeaders', {
        on: {
            'htmx:before:response': ({source, response}) => {
                // TODO: Handle HX-Trigger, HX-Redirect, HX-Refresh, HX-Location
            },
            'htmx:before:swap': ({source, response, swap}) => {
                // TODO: Handle HX-Retarget, HX-Reswap, HX-Reselect
            },
        },
    })

    register('hx-status', {
        on: {
            'htmx:before:swap': ({source, response, swap}) => {
                // TODO: Route to alternate targets by status code
            },
        },
    })

    register('sse', {
        on: {
            'htmx:ready': () => {
                config.sse = {
                    reconnect: {enable: false, delay: 500, maxDelay: 60000, maxAttempts: 10, jitter: 0.3},
                    pauseInBackground: false,
                    ...config.sse,
                }
            },
            // Check content-type BEFORE reading body (SSE streams need special handling)
            'htmx:before:response': async ({response}) => {
                const contentType = response.headers['content-type'] || ''
                if (contentType.includes('text/event-stream')) {
                    // TODO: Handle SSE — parse stream, emit htmx:sse:message, reconnect
                    return false
                }
            },
        },
    })

    register('fullDocParsing', {
        on: {
            'htmx:after:response': ({response}) => {
                // TODO: Detect <html>/<head>/<body>, extract appropriate section
            },
        },
    })

    // -- Swap Phase --

    register('select', {
        on: {
            'htmx:before:swap': ({source, swap}) => {
                const sel = source.element.attr('hx-select')
                if (sel && swap.content) {
                    // TODO: Filter swap.content to only matching elements
                }
            },
        },
    })

    register('oob', {
        requires: ['select'],
        on: {
            'htmx:before:swap': ({source, swap}) => {
                // TODO: Process hx-select-oob and hx-swap-oob
            },
        },
    })

    register('hx-preserve', {
        on: {
            'htmx:before:swap': ({swap}) => {
                // TODO: Save/restore elements with hx-preserve across swaps
            },
        },
    })

    register('morph', {
        on: {
            'htmx:ready': () => {
                config.morph = {
                    scanLimit: 10,
                    morphIgnore: ['data-htmx-powered'],
                    morphSkip: [],
                    morphSkipChildren: [],
                    ...config.morph,
                }
            },
            'htmx:before:swap': ({swap}) => {
                if (swap.method === 'innerMorph' || swap.method === 'outerMorph') {
                    // TODO: DOM diffing algorithm
                    return false
                }
            },
        },
    })

    register('partials', {
        on: {
            'htmx:before:swap': ({swap}) => {
                // TODO: Process <template hx-type="partial"> in response
            },
        },
    })

    // -- Settle Phase --

    register('executeScripts', {
        on: {
            'htmx:after:settle': ({swap}) => {
                // TODO: Execute <script> tags in swapped content
            },
        },
    })

    register('autofocus', {
        on: {
            'htmx:after:settle': ({swap}) => {
                // TODO: Focus first [autofocus] in swapped content
            },
        },
    })

    register('anchorScroll', {
        on: {
            'htmx:after:settle': ({response}) => {
                // TODO: Scroll to hash fragment from response URL
            },
        },
    })

    register('cssTransitions', {
        on: {
            'htmx:ready': () => {
                config.cssTransitions = {swapDelay: 0, settleDelay: 20, ...config.cssTransitions}
            },
            'htmx:before:swap': ({swap}) => {
                // TODO: Add htmx-swapping class to target
            },
            'htmx:after:settle': ({swap}) => {
                // TODO: Add htmx-settling class, then htmx-added to new elements
            },
        },
    })

    register('viewTransitions', {
        on: {
            'htmx:ready': () => {
                config.viewTransitions = {enable: false, ...config.viewTransitions}
            },
            'htmx:before:swap': async ({swap}) => {
                if ((swap.method?.includes('transition') || config.viewTransitions.enable) && document.startViewTransition) {
                    // TODO: Wrap swap in document.startViewTransition()
                }
            },
        },
    })

    // -- Done Phase --

    register('title', {
        on: {
            'htmx:done': ({response}) => {
                if (!response?.text) return
                // TODO: Extract <title> from response, update document.title
            },
        },
    })

    register('history', {
        on: {
            'htmx:ready': () => {
                window.addEventListener('popstate', (event) => {
                    // TODO: Restore page state from event.state
                })
            },
            'htmx:before:request': ({source}) => {
                // TODO: Capture hx-push-url, hx-replace-url values
            },
            'htmx:done': ({source, request, response}) => {
                // TODO: Push or replace history state
            },
        },
    })

    // -- Ready Phase --

    register('injectStyles', {
        on: {
            'htmx:ready': () => {
                if (config.includeIndicatorCSS === false) return
                // TODO: Inject indicator CSS
            },
        },
    })

    register('compat', {
        on: {
            'htmx:ready': () => {
                // TODO: htmx.process = htmx.init, htmx.ajax = htmx.fetch, etc.
            },
        },
    })

    // ─── BOOT ───────────────────────────────────────────────────────────────

    function boot() {
        initialized = true
        emit(document, 'htmx:ready')
        init(document.body)

        // Observe DOM for added/removed elements
        new MutationObserver((mutations) => {
            const isElement = n => n.nodeType === 1
            const added = mutations.flatMap(m => [...m.addedNodes]).filter(isElement)
            const removed = mutations.flatMap(m => [...m.removedNodes]).filter(isElement)

            added.forEach(init)
            removed.forEach(node => {
                cleanup(node)
                node.querySelectorAll('*').forEach(el => {
                    if (_state.has(el)) cleanup(el)
                })
            })
        }).observe(document.body, {childList: true, subtree: true})
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', boot)
    } else {
        queueMicrotask(boot)
    }

    // ─── PUBLIC API ─────────────────────────────────────────────────────────

    return {
        version: '4.0.0-beta-draft',
        config,

        // Kernel
        init,
        fetch,
        emit,
        on,
        register,

        // Element helpers
        wrap,
        attr,
        find,
        findAll,
        state,

        // Utilities
        parse,
        stringify,
        resolveTarget,
        makeFragment,
    }
})()
