// htmx 4.0 — Core Extensions
//
// Everything that makes hx-* attributes work, plus standard extensions.
// Each behavior is a separate htmx.register() call — self-documenting,
// individually replaceable. The assembler inlines them at emit sites.

// ── parse ────────────────────────────────────────────────────────────────
// Install the RelaxedJSON parser and wrap attr to parse attribute values.
// Must be first — everything downstream depends on api.parse and api.attr.

htmx.register('parse', {
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

// ── http ─────────────────────────────────────────────────────────────────
// HTTP transport. Installs api.ajax at boot. The kernel is transport-agnostic;
// this extension adds the HTTP request/response/swap pipeline.

htmx.register('http', {
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

// ── public-api ──────────────────────────────────────────────────────────
// Ergonomic htmx.swap() and htmx.ajax() signatures that reshape flat
// options into the pipeline detail format the kernel expects.

htmx.register('public-api', {
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

// ── HTTP method attributes ───────────────────────────────────────────────
// Read hx-get/post/put/patch/delete at trigger time (JIT), call api.ajax()

htmx.register('hx-get', {
    on: {
        'htmx:before:trigger': (detail, api) => {
            const val = api.attr(detail.element, 'hx-get', {as: 'url'})
            if (val) api.ajax({element: detail.element, request: {url: val.url, method: 'GET'}})
        }
    }
})

htmx.register('hx-post', {
    on: {
        'htmx:before:trigger': (detail, api) => {
            const val = api.attr(detail.element, 'hx-post', {as: 'url'})
            if (val) api.ajax({element: detail.element, request: {url: val.url, method: 'POST'}})
        }
    }
})

htmx.register('hx-put', {
    on: {
        'htmx:before:trigger': (detail, api) => {
            const val = api.attr(detail.element, 'hx-put', {as: 'url'})
            if (val) api.ajax({element: detail.element, request: {url: val.url, method: 'PUT'}})
        }
    }
})

htmx.register('hx-patch', {
    on: {
        'htmx:before:trigger': (detail, api) => {
            const val = api.attr(detail.element, 'hx-patch', {as: 'url'})
            if (val) api.ajax({element: detail.element, request: {url: val.url, method: 'PATCH'}})
        }
    }
})

htmx.register('hx-delete', {
    on: {
        'htmx:before:trigger': (detail, api) => {
            const val = api.attr(detail.element, 'hx-delete', {as: 'url'})
            if (val) api.ajax({element: detail.element, request: {url: val.url, method: 'DELETE'}})
        }
    }
})

// ── hx-swap ──────────────────────────────────────────────────────────────
// Read swap style and modifiers from the attribute at swap time (JIT)

htmx.register('hx-swap', {
    on: {
        'htmx:before:swap': (detail, api) => {
            const swapAttr = api.attr(detail.element, 'hx-swap', {as: 'style'})
            if (swapAttr) Object.assign(detail.swap, swapAttr)
        }
    }
})

// ── hx-target ────────────────────────────────────────────────────────────
// Read swap target selector from the attribute at swap time (JIT)

htmx.register('hx-target', {
    on: {
        'htmx:before:swap': (detail, api) => {
            const targetAttr = api.attr(detail.element, 'hx-target', {as: 'selector'})
            if (targetAttr) detail.swap.target = targetAttr.selector
        }
    }
})

// ── smart-defaults ──────────────────────────────────────────────────────
// Config values, default trigger assignment, default swap style, default headers

htmx.register('smart-defaults', {
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

// ── swap-aliases ────────────────────────────────────────────────────────
// Friendly swap name mapping → insertAdjacentHTML position names

htmx.register('swap-aliases', {
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

// ── timeout ─────────────────────────────────────────────────────────────
// Request timeout via AbortSignal

htmx.register('timeout', {
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

// ── hx-trigger ──────────────────────────────────────────────────────────
// Parse trigger attribute for multi-trigger, load, every, from

htmx.register('hx-trigger', {
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

// ── trigger-delay ───────────────────────────────────────────────────────
// Debounce handler when options.delay is set on api.on()

htmx.register('trigger-delay', {
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

// ── trigger-throttle ────────────────────────────────────────────────────
// Throttle handler when options.throttle is set on api.on()

htmx.register('trigger-throttle', {
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

// ── extended-selectors ──────────────────────────────────────────────────
// Named targets (this, body, document, window), traversal (closest, next,
// previous), and scoped search (find <sel>).
// Uses options.from as the context element for relative selectors.

htmx.register('extended-selectors', {
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

// ── inheritance ─────────────────────────────────────────────────────────
// Walk up the DOM for inherited attributes
// hx-target:inherited, hx-target:append, hx-target:inherited:append

htmx.register('inheritance', {
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

// ── parse-dot-path ──────────────────────────────────────────────────────
// Expand dot-notation keys into nested objects
// user.name:John → {user: {name: "John"}}

htmx.register('parse-dot-path', {
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

// ── hx-boost ────────────────────────────────────────────────────────────
// Convert <a> and <form> inside hx-boost containers into htmx requests

htmx.register('hx-boost', {
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
