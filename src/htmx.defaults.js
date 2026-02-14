// htmx 4.0 — Default extensions
//
// These are conventions and conveniences that ship with htmx but live outside the core.
// The core is minimal; these defaults make htmx feel like htmx.
//
// ═══════════════════════════════════════════════════════════════════════════
// Registration order matters for extensions that hook the same event.
// At boot (api wraps):        extended-selectors → inheritance → parse-dot-path → delay → throttle
//   delay/throttle wrap api.on to process custom options ({delay, throttle}).
// Within htmx:before:init:    method-attrs → default-trigger → trigger-attrs → boost
//   method-attrs reads hx-get/post/etc → detail.request, hx-swap/hx-target → detail.swap.
//   default-trigger sets detail.trigger.eventName (fallback for elements without hx-trigger).
//   trigger-attrs wraps detail.init.execute to do its own wiring; nulls eventName.
// Within htmx:before:swap:    default-swap → swap-style-aliases
// Within htmx:before:request: default-headers → timeout
// ═══════════════════════════════════════════════════════════════════════════

// ── Extended selectors ────────────────────────────────────────────────────
// Wraps api.find with named targets (this, body, document, window),
// immediate relatives (next, previous, host), traversal (closest, next <sel>,
// previous <sel>), and scoped search (find <sel>). Falls through to the
// original find() for plain CSS selectors.

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

            api.wrap('find', (original, element, selector, options) => {
                if (typeof element === 'string') {
                    options = selector
                    selector = element
                    element = document
                }

                const multiple = options?.multiple
                const match = (el) => multiple ? (el ? [el] : []) : el ?? null

                if (typeof selector !== 'string') return original(element, selector, options)

                // ── Named targets ───────────────────────────
                if (selector === 'this') return multiple ? [element] : element
                if (selector === 'body') return multiple ? [document.body] : document.body
                if (selector === 'document') return multiple ? [document] : document
                if (selector === 'window') return multiple ? [window] : window

                // ── Immediate relatives ─────────────────────
                if (selector === 'next') return match(element.nextElementSibling)
                if (selector === 'previous') return match(element.previousElementSibling)
                if (selector === 'host') return match(element.getRootNode()?.host)

                // ── Traversal ───────────────────────────────
                if (selector.startsWith('closest ')) return match(element.closest(selector.slice(8)))
                if (selector.startsWith('next ')) return match(scanForward(element, selector.slice(5)))
                if (selector.startsWith('previous ')) return match(scanBackward(element, selector.slice(9)))

                // ── Scoped search (strip prefix, fall through)
                if (selector.startsWith('find ')) {
                    selector = selector.slice(5)
                }

                return original(element, selector, {multiple})
            })
        }
    }
})

// ── Attribute inheritance ─────────────────────────────────────────────────
// Core attr runs getAttribute → parse. This wraps it with:
//
//   1. Direct:    hx-target on the element → use it
//   2. Inherited: hx-target:inherited on the element → use it
//   3. Append:    hx-target:append or hx-target:inherited:append →
//                 find ancestor's value, concatenate with comma
//   4. Walk up:   closest ancestor with :inherited or :inherited:append →
//                 recursively resolve
//
// When config.implicitInheritance is true, plain attributes also inherit
// (step 4 matches hx-target without :inherited suffix).
// Pass {inherit: false} to skip inheritance for a single call.

htmx.register('inheritance', {
    on: {
        'htmx:boot': (detail, api) => {
            htmx.config.inheritance ??= {}
            htmx.config.inheritance.mode ??= 'explicit'
            htmx.config.inheritance.inheritSuffix ??= 'inherited'
            htmx.config.inheritance.appendSuffix ??= 'append'

            api.wrap('attr', (original, element, name, options) => {
                if (options?.inherit === false) return original(element, name, options)

                const {mode, inheritSuffix, appendSuffix} = htmx.config.inheritance
                const inherited = `${name}:${inheritSuffix}`
                const append = `${name}:${appendSuffix}`
                const inheritedAppend = `${name}:${inheritSuffix}:${appendSuffix}`

                // ── Direct attribute on element ──────────────
                if (element.hasAttribute(name)) return original(element, name, options)
                if (element.hasAttribute(inherited)) return original(element, inherited, options)

                // ── Build ancestor selector ──────────────────
                const parts = [`[${CSS.escape(inherited)}]`, `[${CSS.escape(inheritedAppend)}]`]
                if (mode === 'implicit') parts.unshift(`[${CSS.escape(name)}]`)
                const selector = parts.join(',')

                // ── Collect :append chain + base, walking up ─
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

// ── Dot-path expansion ──────────────────────────────────────────────────
// Expands dot-notation keys into nested objects: user.name:John → {user: {name: "John"}}

htmx.register('parse-dot-path', {
    on: {
        'htmx:boot': (detail, api) => {
            api.wrap('parse', (original, text) => {
                const result = original(text)
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

// ── Method attributes ──────────────────────────────────────────────────
// Reads hx-get, hx-post, etc. → detail.request.url + detail.request.method
// Reads hx-swap → detail.swap.style, hx-target → detail.swap.target

htmx.register('method-attrs', {
    on: {
        'htmx:before:init': (detail, api) => {
            for (const verb of ['get', 'post', 'put', 'patch', 'delete']) {
                const val = api.attr(detail.element, `hx-${verb}`, {as: 'url'})
                if (val) {
                    detail.request = {url: val.url, method: verb.toUpperCase()}
                    break
                }
            }

            const swap = api.attr(detail.element, 'hx-swap', {as: 'style'})
            if (swap) {
                detail.swap ??= {}
                Object.assign(detail.swap, swap)
            }

            const target = api.attr(detail.element, 'hx-target', {as: 'selector'})
            if (target) {
                detail.swap ??= {}
                detail.swap.target = target.selector
            }
        }
    }
})

// ── Default trigger ─────────────────────────────────────────────────────
// Click for most elements, change for inputs, submit for forms.
// Sets detail.trigger.eventName during before:init — used by the kernel's
// default wiring or as a fallback for trigger-attrs entries without an event.

htmx.register('default-trigger', {
    on: {
        'htmx:before:init': (detail) => {
            if (detail.trigger.eventName) return
            if (detail.element.matches('form')) detail.trigger.eventName = 'submit'
            else if (detail.element.matches('input:not([type=button]), select, textarea')) detail.trigger.eventName = 'change'
            else detail.trigger.eventName = 'click'
        }
    }
})

// ── Trigger attributes ───────────────────────────────────────────────
// Reads hx-trigger and wraps detail.init.execute to wire one listener per
// comma-separated entry via api.on, using detail.trigger.execute (the per-fire
// function set by the kernel). Nulls eventName to prevent the kernel's
// default wiring.

htmx.register('trigger-attrs', {
    on: {
        'htmx:before:init': (detail, api) => {
            const raw = detail.element.getAttribute('hx-trigger')
            if (!raw) return
            const triggers = raw.split(',').map(part => api.parse(part.trim(), {as: 'eventName'}))

            const defaultEventName = detail.trigger.eventName
            detail.trigger.eventName = null // prevent kernel's default wiring

            const defaultExecute = detail.init.execute
            detail.init.execute = () => {
                defaultExecute() // commits state (skips wiring since eventName is null)

                const element = detail.element
                const execute = detail.trigger.execute

                for (const t of triggers) {
                    const eventName = t.eventName || defaultEventName

                    // Build options for api.on (delay/throttle processed by wraps)
                    const options = {}
                    if (t.delay !== undefined) options.delay = t.delay
                    if (t.throttle !== undefined) options.throttle = t.throttle
                    if (t.once) options.once = true

                    // Special trigger: load — fire immediately
                    if (eventName === 'load') {
                        queueMicrotask(() => execute())
                        continue
                    }

                    // Special trigger: every — fire on interval
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
                        for (const target of api.find(element, t.from, {multiple: true})) {
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

// ── Boost ─────────────────────────────────────────────────────────────
// Converts regular <a> and <form> elements inside a boosted container
// into htmx-powered AJAX requests. Same behavior as htmx 2.0:
// each link/form is individually initialized through the normal pipeline.
// Supports hx-boost="false" to opt out individual elements.
// Registered after method-attrs so hx-get takes precedence over boosted href.

htmx.register('boost', {
    requires: ['method-attrs'],
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
                if (!boost || boost.value === false) continue
                for (const el of container.querySelectorAll('a[href], form')) {
                    api.initElement(el)
                }
            }
        },

        // When a link/form is being init'd, check if it's inside a boosted container
        'htmx:before:init': (detail, api) => {
            if (detail.request?.url) return
            const el = detail.element
            if (!el.matches('a[href], form')) return

            const boost = api.attr(el, 'hx-boost')
            if (!boost || boost.value === false) return

            if (el.matches('a[href]')) {
                detail.request = {url: el.getAttribute('href'), method: 'GET'}
            } else {
                detail.request = {url: el.getAttribute('action') || '', method: (el.getAttribute('method') || 'GET').toUpperCase()}
            }
        }
    }
})

// ═══════════════════════════════════════════════════════════════════════════
// SMART DEFAULTS
// Conventions that make htmx feel like htmx. These fill in sensible
// fallbacks when attributes are omitted.
// ═══════════════════════════════════════════════════════════════════════════

// ── Default swap ────────────────────────────────────────────────────────
// Use innerHTML when hx-swap is omitted.

htmx.register('default-swap', {
    on: {
        'htmx:boot': () => {
            htmx.config.defaultSwap ??= 'innerHTML'
        },
        'htmx:before:swap': (detail) => {
            detail.swap.style ??= htmx.config.defaultSwap
        },
    }
})

// ── Default headers ─────────────────────────────────────────────────────
// Tell the server this is an htmx request.

htmx.register('default-headers', {
    on: {
        'htmx:boot': () => {
            htmx.config.defaultHeaders ??= {
                'HX-Request': 'true'
            }
        },
        'htmx:before:request': (detail) => {
            detail.request.headers = {...htmx.config.defaultHeaders, ...detail.request.headers}
            detail.request.headers['HX-Current-URL'] ??= location.href
        }
    }
})

// ── Swap style aliases ───────────────────────────────────────────────────
// Friendly names that map to the insertAdjacentHTML position names in core.

htmx.register('swap-style-aliases', {
    on: {
        'htmx:before:swap': (detail) => {
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

// ── Request timeout ──────────────────────────────────────────────────────
// Default 60s timeout. Sets signal on the RequestInit via htmx:before:request.

htmx.register('timeout', {
    on: {
        'htmx:boot': () => {
            htmx.config.requestTimeout ??= 60000
        },
        'htmx:before:request': (detail) => {
            const timeout = htmx.config.requestTimeout
            if (!timeout) return

            const timeoutSignal = AbortSignal.timeout(timeout)
            // Combine with any existing signal so both can cancel
            detail.request.signal = detail.request.signal
                ? AbortSignal.any([detail.request.signal, timeoutSignal])
                : timeoutSignal
        }
    }
})

// ═══════════════════════════════════════════════════════════════════════════
// LISTENER MODIFIERS
// Wrap api.on to process custom options. trigger-attrs passes parsed
// modifier values (delay, throttle) as options to api.on; these wraps
// intercept them. Native options (once) pass straight to addEventListener.
// ═══════════════════════════════════════════════════════════════════════════

// ── Delay (debounce) ────────────────────────────────────────────────────
// Usage: hx-trigger="click delay:300ms"
// Wraps api.on — when options.delay is set, debounces the handler.

htmx.register('delay', {
    on: {
        'htmx:boot': (detail, api) => {
            api.wrap('on', (original, element, eventName, handler, options) => {
                if (options?.delay !== undefined) {
                    const ms = options.delay
                    let timeout
                    const debounced = (event) => {
                        clearTimeout(timeout)
                        timeout = setTimeout(() => handler(event), ms)
                    }
                    return original(element, eventName, debounced, options)
                }
                return original(element, eventName, handler, options)
            })
        }
    }
})

// ── Throttle ────────────────────────────────────────────────────────────
// Usage: hx-trigger="click throttle:1s"
// Wraps api.on — when options.throttle is set, throttles the handler.

htmx.register('throttle', {
    on: {
        'htmx:boot': (detail, api) => {
            api.wrap('on', (original, element, eventName, handler, options) => {
                if (options?.throttle !== undefined) {
                    const ms = options.throttle
                    let last = 0
                    const throttled = (event) => {
                        const now = Date.now()
                        if (now - last >= ms) {
                            last = now
                            handler(event)
                        }
                    }
                    return original(element, eventName, throttled, options)
                }
                return original(element, eventName, handler, options)
            })
        }
    }
})
