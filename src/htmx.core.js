// htmx 4.0 — Core Extensions
//
// Extension definitions ordered by importance. Installation order at the bottom.
//
// api is always the last argument:
//   Event handlers: (detail, api) => { ... }
//   Wraps: (original, ...kernelArgs, api) => { ... }


// ── Capabilities ────────────────────────────────────────────────────────

/**
 * HTTP transport — fetch pipeline with request/response/swap phases.
 */
const ajax = {
    requires: ['swaps'],
    define: {
        /**
         * Execute an HTTP request through the htmx request pipeline.
         *
         * Pipeline:
         * - `htmx:before:request` -> `request.execute()` -> `htmx:after:request`
         * - `htmx:before:response` -> `response.execute()` -> `htmx:after:response`
         * - `api.swap(...)` when response text is available (which emits `htmx:before:swap` / `htmx:after:swap`)
         * - `htmx:done`, `htmx:error`, `htmx:finally`
         *
         * Detail shape shared across request/response events:
         * - `detail.element`
         * - `detail.request` (url/method/headers/body plus `execute()`)
         * - `detail.response` (status/ok/url/headers/text plus `execute()`)
         * - `detail.swap` (swap options passed to `api.swap`)
         * - `detail.error` (set on failures)
         *
         * @param {{element?: Element, request: Object, swap?: Object}} [options]
         *
         * @returns {Promise<void>}
         */
        ajax: (api) => async function ajax(options = {}) {
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

                if (api.emit(element, 'htmx:before:request', detail) === false) return

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

                if (api.emit(element, 'htmx:before:response', detail) === false) return

                await detail.response.execute()

                // ── Swap phase ───────────────────────────────────────
                if (detail.response.text != null) {
                    detail.swap ??= {}
                    detail.swap.content = detail.response.text
                    api.swap(detail.swap, {
                        element: detail.element,
                        request: detail.request,
                        response: detail.response,
                    })
                }

                api.emit(element, 'htmx:done', detail)

            } catch (error) {
                detail.error = error
                console.error(error)
                api.emit(element, 'htmx:error', detail)
            } finally {
                api.emit(element, 'htmx:finally', detail)
            }
        },
    },
    wrap: {
        /**
         * HTTP context adapter for `api.swap`.
         *
         * Maps HTTP-specific options (`request`, `response`, `error`) into
         * `options.context` before calling the original swap function.
         * Result: swap lifecycle event detail includes `swap` plus
         * `request` / `response` / `error` when present.
         */
        swap: (original, swap, options = {}) => {
            const context = {...options.context}
            if (options.request !== undefined) context.request = options.request
            if (options.response !== undefined) context.response = options.response
            if (options.error !== undefined) context.error = options.error
            return original(swap, {...options, context})
        },
    },
}

/**
 * DOM swaps — resolve target, parse content, dispatch on style.
 */
const swaps = {
    define: {
        /**
         * Execute a DOM swap.
         *
         * Signature:
         *   api.swap(swap, options)
         *
         * `swap` fields:
         * - `content`: string HTML or DocumentFragment
         * - `style`: swap style string (built-ins plus extension-defined styles)
         * - `target`: selector string or resolved Element
         *
         * `options` fields:
         * - `element`: event emission/default-target element
         * - `context`: extra context merged into swap event detail
         *
         * Emits `htmx:before:swap` / `htmx:after:swap` with:
         *   { element, swap, ...context }
         *
         * @param {{content?: string|DocumentFragment, style?: string, target?: string|Element}} [swap]
         * @param {{element?: Element|null, context?: Object<string, any>}} [options]
         */
        swap: (api) => function swap(swap, options) {
            const detail = {
                element: options?.element || null,
                swap: swap || {},
                ...(options?.context || {}),
            }
            const emitOn = detail.element || document.body

            detail.swap.execute = () => {
                // Resolve target: string selector → element
                if (typeof detail.swap.target === 'string') {
                    detail.swap.target = api.find(detail.swap.target)
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

            if (api.emit(emitOn, 'htmx:before:swap', detail) === false) return
            detail.swap.execute()
            api.emit(emitOn, 'htmx:after:swap', detail)
        },
    }
}

/**
 * RelaxedJSON parser — string to object transformation.
 */
const parser = {
    define: {
        /**
         * Parse relaxed key/value text into an object.
         *
         * Supports bare values, `key:value` pairs, boolean flags, duration
         * coercion (`150`, `150ms`, `2s`, `1m`), and dot-key expansion.
         *
         * @param {string|null|undefined} text
         * @param {{as?: string}} [options]
         *
         * @returns {Object<string, any>|null}
         *
         * @example
         * api.parse('click')
         * // => { value: 'click' }
         *
         * @example
         * api.parse('delay:500ms once')
         * // => { delay: 500, once: true }
         *
         * @example
         * api.parse('click', { as: 'trigger' })
         * // => { trigger: 'click' }
         *
         * @example
         * api.parse('headers.X-CSRF:abc123')
         * // => { headers: { 'X-CSRF': 'abc123' } }
         */
        parse: () => {
            return function parse(text, options) {
                /** Tokenizer for relaxed `key:value` and flag-like option strings. */
                const tokenPattern = /(?:"([^"]*)"|'([^']*)'|([^\s,:]+))(?:\s*:\s*(?:"([^"]*)"|'([^']*)'|([^\s,]*)))?/g

                /** Coerce parsed token text into booleans/durations when applicable. */
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

                // Expand dot-notation keys into nested objects
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
            }
        },
    },
}


// ── Attributes ──────────────────────────────────────────────────────────

/**
 * Issue GET request to hx-get URL on trigger.
 */
const hxGet = {
    requires: ['ajax'],
    config: {attributeFilter: ['hx-get']},
    on: {
        'htmx:before:trigger': (detail, api) => {
            const url = api.attr(detail.element, 'hx-get')
            if (url) api.ajax({element: detail.element, request: {url, method: 'GET'}})
        }
    }
}

/**
 * Issue POST request to hx-post URL on trigger.
 */
const hxPost = {
    requires: ['ajax'],
    config: {attributeFilter: ['hx-post']},
    on: {
        'htmx:before:trigger': (detail, api) => {
            const url = api.attr(detail.element, 'hx-post')
            if (url) api.ajax({element: detail.element, request: {url, method: 'POST'}})
        }
    }
}

/**
 * Issue PUT request to hx-put URL on trigger.
 */
const hxPut = {
    requires: ['ajax'],
    config: {attributeFilter: ['hx-put']},
    on: {
        'htmx:before:trigger': (detail, api) => {
            const url = api.attr(detail.element, 'hx-put')
            if (url) api.ajax({element: detail.element, request: {url, method: 'PUT'}})
        }
    }
}

/**
 * Issue PATCH request to hx-patch URL on trigger.
 */
const hxPatch = {
    requires: ['ajax'],
    config: {attributeFilter: ['hx-patch']},
    on: {
        'htmx:before:trigger': (detail, api) => {
            const url = api.attr(detail.element, 'hx-patch')
            if (url) api.ajax({element: detail.element, request: {url, method: 'PATCH'}})
        }
    }
}

/**
 * Issue DELETE request to hx-delete URL on trigger.
 */
const hxDelete = {
    requires: ['ajax'],
    config: {attributeFilter: ['hx-delete']},
    on: {
        'htmx:before:trigger': (detail, api) => {
            const url = api.attr(detail.element, 'hx-delete')
            if (url) api.ajax({element: detail.element, request: {url, method: 'DELETE'}})
        }
    }
}

/**
 * Set swap style and modifiers from hx-swap attribute.
 */
const hxSwap = {
    requires: ['swaps', 'parser'],
    config: {attributeFilter: ['hx-swap']},
    on: {
        'htmx:before:swap': (detail, api) => {
            const swapAttr = api.parse(api.attr(detail.element, 'hx-swap'), {as: 'style'})
            if (swapAttr) Object.assign(detail.swap, swapAttr)
        }
    }
}

/**
 * Resolve swap target from hx-target attribute.
 */
const hxTarget = {
    requires: ['swaps'],
    config: {attributeFilter: ['hx-target']},
    on: {
        'htmx:before:swap': (detail, api) => {
            const target = api.attr(detail.element, 'hx-target')
            if (target) {
                detail.swap.target = api.find(target, {from: detail.element})
            }
        }
    }
}

/**
 * Parse hx-trigger for multi-trigger, load, every, from.
 */
const hxTrigger = {
    requires: ['parser'],
    config: {attributeFilter: ['hx-trigger']},
    on: {
        'htmx:before:init': (detail, api) => {
            const raw = detail.element.getAttribute('hx-trigger')
            if (!raw) return

            const triggers = raw.split(',').map(part => api.parse(part.trim(), {as: 'eventName'}))

            // Save defaults from smart-defaults (if loaded)
            const defaultEventName = detail.trigger?.eventName

            // Build trigger execute (use smart-defaults' if available, else create our own)
            const el = detail.element
            const execute = detail.trigger?.execute || ((event) => {
                event?.preventDefault()
                if (api.emit(el, 'htmx:before:trigger', {element: el, event}) === false) return
                api.emit(el, 'htmx:after:trigger', {element: el, event})
            })

            // Replace init.execute to handle multi-trigger wiring
            const originalInit = detail.init.execute
            detail.init.execute = () => {
                originalInit()

                const element = detail.element

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
                            api.state.elements(element).cleanup.push(() => clearInterval(id))
                        }
                        continue
                    }

                    if (!eventName) continue

                    // Resolve listen target (from modifier)
                    if (t.from) {
                        for (const target of api.find(t.from, {from: element, multiple: true})) {
                            const off = api.on(target, eventName, execute, options)
                            api.state.elements(element).cleanup.push(off)
                        }
                    } else {
                        api.on(element, eventName, execute, options)
                    }
                }
            }

            // Prevent smart-defaults from also wiring its single listener
            if (detail.trigger) detail.trigger.eventName = null
        }
    }
}

/**
 * Boost <a> and <form> inside hx-boost containers.
 */
const hxBoost = {
    requires: ['ajax'],
    config: {attributeFilter: ['hx-boost']},
    on: {
        'htmx:after:walk:init': (detail, api) => {
            const root = detail.element
            const containers = [
                ...(root.matches?.('[hx-boost]') ? [root] : []),
                ...root.querySelectorAll('[hx-boost]')
            ]
            for (const container of containers) {
                const boost = api.attr(container, 'hx-boost')
                if (!boost || boost === 'false') continue
                for (const el of container.querySelectorAll('a[href], form')) {
                    api.initElement(el)
                }
            }
        },

        'htmx:before:trigger': (detail, api) => {
            const el = detail.element
            if (!el.matches('a[href], form')) return

            const boosted = el.closest('[hx-boost]')
            if (!boosted) return
            const boost = api.attr(boosted, 'hx-boost')
            if (!boost || boost === 'false') return

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
}


// ── Defaults & Policies ─────────────────────────────────────────────────

/**
 * Default trigger — wire click/change/submit based on element type.
 */
const defaultTrigger = {
    on: {
        'htmx:before:init': (detail, api) => {
            // Don't override if another extension already set up trigger
            if (detail.trigger) return

            // Default trigger based on element type
            const el = detail.element
            let eventName
            if (el.matches('form')) eventName = 'submit'
            else if (el.matches('input:not([type=button]), select, textarea')) eventName = 'change'
            else eventName = 'click'

            detail.trigger = {
                eventName,
                execute: (event) => {
                    event?.preventDefault()
                    if (api.emit(el, 'htmx:before:trigger', {element: el, event}) === false) return
                    api.emit(el, 'htmx:after:trigger', {element: el, event})
                },
            }

            // Wrap init.execute to wire trigger listener
            const originalInit = detail.init.execute
            detail.init.execute = () => {
                originalInit()
                if (detail.trigger.eventName) {
                    api.on(el, detail.trigger.eventName, detail.trigger.execute)
                }
            }
        },
    }
}

/**
 * Default swap style — apply config.defaultSwap when none is specified.
 */
const defaultSwap = {
    requires: ['swaps'],
    config: {
        /** @type {string} Apply this swap style when none is specified. */
        defaultSwap: 'innerHTML',
    },
    on: {
        'htmx:before:swap': (detail, api) => {
            detail.swap.style ??= api.config.defaultSwap
        },
    }
}

/**
 * Default headers — merge config.defaultHeaders into every request.
 */
const defaultHeaders = {
    requires: ['ajax'],
    config: {
        /** @type {Object<string, string>} Include these headers on every request. */
        defaultHeaders: {'HX-Request': 'true'},
    },
    on: {
        'htmx:before:request': (detail, api) => {
            detail.request.headers = {...api.config.defaultHeaders, ...detail.request.headers}
            detail.request.headers['HX-Current-URL'] ??= location.href
        },
    }
}

/**
 * Friendly swap names — before, prepend, append, after, remove.
 */
const swapAliases = {
    requires: ['swaps'],
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
}

/**
 * Request timeout via AbortSignal (default 60s).
 */
const requestTimeout = {
    requires: ['ajax'],
    config: {
        /** @type {number} Abort requests after this many milliseconds (0 = no timeout). */
        requestTimeout: 60000,
    },
    on: {
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
}


// ── Primitive Enhancers ─────────────────────────────────────────────────

/**
 * Extended selector syntax — closest, next, previous, this, find.
 */
const extendedSelectors = {
    wrap: {
        find: (original, selector, options) => {
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
            if (selector.startsWith('next ')) {
                for (const candidate of (el.getRootNode() || document).querySelectorAll(selector.slice(5))) {
                    if (candidate.compareDocumentPosition(el) & Node.DOCUMENT_POSITION_PRECEDING) return match(candidate)
                }
                return match(null)
            }
            if (selector.startsWith('previous ')) {
                const all = (el.getRootNode() || document).querySelectorAll(selector.slice(9))
                for (let i = all.length - 1; i >= 0; i--) {
                    if (all[i].compareDocumentPosition(el) & Node.DOCUMENT_POSITION_FOLLOWING) return match(all[i])
                }
                return match(null)
            }

            // Scoped search: search within the context element
            if (selector.startsWith('find ')) {
                const sel = selector.slice(5)
                return multiple
                    ? [...el.querySelectorAll(sel)]
                    : el.querySelector(sel)
            }

            return original(selector, options)
        }
    }
}

/**
 * Attribute inheritance — walk up DOM via :inherited/:append.
 */
const inheritance = {
    config: {
        /** Control how `attr()` walks up the DOM to resolve inherited values. */
        inheritance: {
            /** @type {'explicit'|'implicit'} Require `:inherited` suffix, or also match bare attributes. */
            mode: 'explicit',
            /** @type {string} Suffix marking an attribute as inheritable (e.g. `hx-get:inherited`). */
            inheritSuffix: 'inherited',
            /** @type {string} Suffix marking an attribute as appendable (e.g. `hx-swap:append`). */
            appendSuffix: 'append',
        },
    },
    wrap: {
        attr: (original, element, name, options) => {
            if (options?.inherit === false) return original(element, name, options)

            const {mode, inheritSuffix, appendSuffix} = htmx.config.inheritance
            const inherited = `${name}:${inheritSuffix}`
            const append = `${name}:${appendSuffix}`
            const inheritedAppend = `${name}:${inheritSuffix}:${appendSuffix}`

            // Direct attribute on element
            if (element.hasAttribute(name)) return original(element, name, options)
            if (element.hasAttribute(inherited)) return original(element, inherited, options)

            // Build ancestor selector
            const parts = [`[${CSS.escape(inherited)}]`, `[${CSS.escape(inheritedAppend)}]`]
            if (mode === 'implicit') parts.unshift(`[${CSS.escape(name)}]`)
            const selector = parts.join(',')

            // Collect :append chain + base, walking up
            const chain = []

            const selfAppend = original(element, append, options)
                ?? original(element, inheritedAppend, options)
            if (selfAppend !== null) chain.push(selfAppend)

            let ancestor = element.parentElement?.closest(selector)
            while (ancestor) {
                const base = original(ancestor, inherited, options)
                    ?? (mode === 'implicit' ? original(ancestor, name, options) : null)
                if (base !== null) {
                    chain.push(base)
                    break
                }

                const ancestorAppend = original(ancestor, inheritedAppend, options)
                if (ancestorAppend !== null) {
                    chain.push(ancestorAppend)
                    ancestor = ancestor.parentElement?.closest(selector)
                    continue
                }

                break
            }

            if (!chain.length) return null
            return chain.reverse().join(',')
        }
    },
}

/**
 * Debounce via options.delay on api.on().
 */
const delayEvents = {
    wrap: {
        on: (original, element, eventName, handler, options) => {
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
        }
    }
}

/**
 * Rate-limit via options.throttle on api.on().
 */
const throttleEvents = {
    wrap: {
        on: (original, element, eventName, handler, options) => {
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
        }
    }
}


// ── Public API ──────────────────────────────────────────────────────────

/**
 * Ergonomic htmx.swap(), htmx.ajax(), htmx.parse() wrappers.
 */
const publicApi = {
    requires: ['swaps', 'ajax'],
    on: {
        'htmx:boot': (detail, api) => {
            htmx.swap = (options) => {
                const {element, content, target, style, ...modifiers} = options
                return api.swap(
                    {content, target, style: style || null, ...modifiers},
                    {element: element || null},
                )
            }
            htmx.ajax = (options) => {
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
            }
            htmx.parse = (text, options) => api.parse(text, options)
        }
    }
}


// ── Installation ────────────────────────────────────────────────────────
// Order matters: dependencies must be installed before dependents.

htmx.install('parser', parser)
htmx.install('swaps', swaps)
htmx.install('extended-selectors', extendedSelectors)
htmx.install('inheritance', inheritance)
htmx.install('delay-events', delayEvents)
htmx.install('throttle-events', throttleEvents)
htmx.install('ajax', ajax)
htmx.install('default-trigger', defaultTrigger)
htmx.install('default-swap', defaultSwap)
htmx.install('default-headers', defaultHeaders)
// htmx.install('hx-trigger', hxTrigger)
htmx.install('hx-get', hxGet)
// htmx.install('hx-post', hxPost)
// htmx.install('hx-put', hxPut)
// htmx.install('hx-patch', hxPatch)
// htmx.install('hx-delete', hxDelete)
htmx.install('hx-swap', hxSwap)
htmx.install('hx-target', hxTarget)
htmx.install('swap-aliases', swapAliases)
htmx.install('request-timeout', requestTimeout)
// htmx.install('hx-boost', hxBoost)
