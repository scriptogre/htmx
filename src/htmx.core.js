// htmx 4.0 — Core Extensions
//
// Extensions are installed in dependency order — dependencies before dependents.
//
// api is the last argument for event handlers only:
//   Event handlers: (detail, api) => { ... }
//   Wraps: (original, ...originalArgs) => { ... }  — no api, use htmx.* or closures

// ── Installation ────────────────────────────────────────────────────────
// Order matters: dependencies must be installed before dependents.


/**
 * RelaxedJSON parser — string to object transformation.
 */
htmx.install('parser', {
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
})
/**
 * Default configuration values for htmx core.
 */
htmx.install('default-config', {
    config: {
        logAll: false,
        prefix: '',
        transitions: false,
        history: true,
        mode: 'same-origin',
        defaultFocusScroll: false,
        defaultTimeout: 60000,
        extensions: '',
        implicitInheritance: false,
        defaultSettleDelay: 1,
        inlineScriptNonce: null,
        inlineStyleNonce: null,
    }
})
/**
 * Reads <meta name="htmx-config"> and merges its JSON content into config.
 */
htmx.install('meta-config', {
    on: {
        'htmx:boot': (detail, api) => {
            const meta = document.querySelector('meta[name="htmx-config"]')
            if (meta) {
                try {
                    const parsed = JSON.parse(meta.content)
                    Object.assign(api.config, parsed)
                } catch (e) {
                    console.error('[htmx] Invalid htmx-config meta tag:', e)
                }
            }
        }
    }
})
/**
 * Wraps attr() to support a configurable attribute name prefix (e.g. "data-hx-" instead of "hx-").
 */
htmx.install('prefix', {
    wrap: {
        attr: (original, element, name, options) => {
            if (htmx.config.prefix) {
                let prefixed = htmx.config.prefix + name
                let result = original(element, prefixed, options)
                if (result !== undefined && result !== null) return result
            }
            return original(element, name, options)
        }
    }
})
/**
 * Wraps attr() to replace ":" in attribute names with a configurable meta character.
 */
htmx.install('meta-character', {
    wrap: {
        attr: (original, element, name, options) => {
            if (htmx.config.metaCharacter) {
                let adjusted = name.replace(/:/g, htmx.config.metaCharacter)
                if (adjusted !== name) {
                    let result = original(element, adjusted, options)
                    if (result !== undefined && result !== null) return result
                }
            }
            return original(element, name, options)
        }
    }
})
/**
 * Parse HTML responses into fragments, extracting title and body content.
 */
htmx.install('fragment-parsing', {
    define: {
        makeFragment: (api) => function makeFragment(text) {
            const template = document.createElement('template')
            template.innerHTML = text.trim()
            let fragment = template.content
            let title = null

            // Extract title
            const titleEl = fragment.querySelector('title')
            if (titleEl) title = titleEl.textContent

            // Strip <head> content (and standalone title when no <head>/<body> wrapper)
            const head = fragment.querySelector('head')
            if (head) {
                head.remove()
            } else if (titleEl && !fragment.querySelector('body')) {
                titleEl.remove()
            }

            // Handle full HTML doc responses — extract body content
            const body = fragment.querySelector('body')
            if (body) {
                const newFrag = document.createDocumentFragment()
                while (body.childNodes.length > 0) newFrag.appendChild(body.childNodes[0])
                fragment = newFrag
            }

            // Convert <hx-partial> to <template hx type="partial">
            // Template content is inert, protecting partial innerHTML from browser processing
            for (const partial of [...fragment.querySelectorAll('hx-partial')]) {
                const tmpl = document.createElement('template')
                tmpl.setAttribute('hx', '')
                tmpl.setAttribute('type', 'partial')
                for (const attr of partial.attributes) {
                    tmpl.setAttribute(attr.name, attr.value)
                }
                tmpl.innerHTML = partial.innerHTML
                partial.replaceWith(tmpl)
            }

            return {fragment, title}
        },
    },
    on: {
        'htmx:before:swap': (detail, api) => {
            // Parse string content using makeFragment
            if (typeof detail.swap?.content === 'string') {
                const result = api.makeFragment(detail.swap.content)
                detail.swap.content = result.fragment
                if (result.title) detail.swap.title = result.title
            }
        },
        'htmx:after:swap': (detail, api) => {
            // Set document title from response (unless ignoreTitle is set)
            if (detail.swap?.title && !detail.swap?.ignoreTitle) {
                document.title = detail.swap.title
            }
        },
    }
})
/**
 * DOM swaps — resolve target, parse content, dispatch on style.
 */
htmx.install('swaps', {
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

                // Parse swap style to extract modifiers (e.g. "innerHTML ignoreTitle:true")
                detail.swap.style ??= htmx.config.defaultSwap || 'innerHTML'
                if (detail.swap.style && detail.swap.style.includes(' ')) {
                    const parts = detail.swap.style.trim().split(/\s+/)
                    detail.swap.style = parts[0]
                    for (let i = 1; i < parts.length; i++) {
                        const colonIdx = parts[i].indexOf(':')
                        if (colonIdx > 0) {
                            const key = parts[i].slice(0, colonIdx)
                            let val = parts[i].slice(colonIdx + 1)
                            if (val === 'true') val = true
                            else if (val === 'false') val = false
                            detail.swap[key] = val
                        }
                    }
                }

                // Dispatch on swap style
                const target = detail.swap.target
                const content = detail.swap.content

                // Track inserted nodes for script processing
                const insertedNodes = [...content.childNodes]

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
                    case 'textContent':
                        target.textContent = content.textContent;
                        break
                    case 'none':
                        break
                    default:
                        throw new HtmxError(`Unknown swap style "${detail.swap.style}"`, {type: 'SWAP_STYLE_UNKNOWN'})
                }

                // Store inserted nodes on detail for script processing
                detail.swap._insertedNodes = insertedNodes
            }

            if (api.emit(emitOn, 'htmx:before:swap', detail) === false) return

            const doSwap = () => {
                // Settle phase: before:settle fires before DOM mutation, after:settle after
                api.emit(emitOn, 'htmx:before:settle', detail)
                detail.swap.execute()
                // If the element was removed from the DOM by the swap (e.g. outerHTML),
                // dispatch after:swap on document so listeners can still observe it
                const afterSwapTarget = emitOn?.isConnected ? emitOn : document
                api.emit(afterSwapTarget, 'htmx:after:settle', detail)
                api.emit(afterSwapTarget, 'htmx:after:swap', detail)
                api.emit(afterSwapTarget, 'htmx:after:restore', detail)
            }

            // View transition support
            if (detail.swap.transition && document.startViewTransition) {
                if (api.emit(emitOn, 'htmx:before:viewTransition', detail) === false) return
                const transition = document.startViewTransition(() => doSwap())
                return transition.finished.then(() => {
                    api.emit(emitOn, 'htmx:after:viewTransition', detail)
                })
            } else {
                doSwap()
            }
        },
    }
})
/**
 * Extended selector syntax — closest, next, previous, this, find.
 */
htmx.install('extended-selectors', {
    wrap: {
        find: (original, selector, options) => {
            const el = options?.from
            const multiple = options?.multiple
            const match = (result) => multiple ? (result ? [result] : []) : result ?? null

            if (typeof selector !== 'string') return original(selector, options)

            // Strip hyperscript-style wrapper: <.foo/> → .foo
            if (selector.startsWith('<') && selector.endsWith('/>')) {
                selector = selector.slice(1, -2)
            }

            // Global prefix: search from document root, not from context element
            if (selector.startsWith('global ')) {
                selector = selector.slice(7)
                return multiple
                    ? [...document.querySelectorAll(selector)]
                    : document.querySelector(selector)
            }

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
})
/**
 * Attribute inheritance — walk up DOM via :inherited/:append.
 */
htmx.install('inheritance', {
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
            if (!element || options?.inherit === false) return original(element, name, options)

            const {mode, inheritSuffix, appendSuffix} = htmx.config.inheritance
            const inherited = `${name}:${inheritSuffix}`
            const append = `${name}:${appendSuffix}`
            const inheritedAppend = `${name}:${inheritSuffix}:${appendSuffix}`

            // Direct attribute on element — pass {inherit: false} to avoid recursion
            if (element.hasAttribute(name)) {
                return original(element, name, {inherit: false})
            }
            if (element.hasAttribute(inherited)) {
                return original(element, inherited, {inherit: false})
            }

            // Build ancestor selector
            const disinheritSel = '[hx-disinherit]'
            const parts = [`[${CSS.escape(inherited)}]`, `[${CSS.escape(inheritedAppend)}]`]
            if (mode === 'implicit') parts.unshift(`[${CSS.escape(name)}]`)
            const selector = parts.join(',')

            // Collect :append chain + base, walking up
            const chain = []

            const selfAppend = element.getAttribute(append)
                ?? element.getAttribute(inheritedAppend)
            if (selfAppend !== null) chain.push(selfAppend)

            let ancestor = element.parentElement?.closest(`${selector},${disinheritSel}`)
            while (ancestor) {
                // Check hx-disinherit — blocks inheritance of specific or all attributes
                const disinherit = ancestor.getAttribute('hx-disinherit')
                if (disinherit) {
                    if (disinherit === '*' || disinherit.split(/\s+/).includes(name)) {
                        break
                    }
                }

                const base = ancestor.getAttribute(inherited)
                    ?? (mode === 'implicit' ? ancestor.getAttribute(name) : null)
                if (base !== null) {
                    if (base === 'this') {
                        const attrName = ancestor.hasAttribute(inherited) ? inherited : name
                        chain.push(`closest [${CSS.escape(attrName)}="this"]`)
                    } else {
                        chain.push(base)
                    }
                    break
                }

                const ancestorAppend = ancestor.getAttribute(inheritedAppend)
                if (ancestorAppend !== null) {
                    chain.push(ancestorAppend)
                    ancestor = ancestor.parentElement?.closest(`${selector},${disinheritSel}`)
                    continue
                }

                break
            }

            if (!chain.length) return null
            return chain.reverse().join(',')
        }
    },
})
/**
 * Debounce via options.delay on api.on().
 */
htmx.install('delay-events', {
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
})
/**
 * Rate-limit via options.throttle on api.on().
 */
htmx.install('throttle-events', {
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
})
/**
 * HTTP transport — fetch pipeline with request/response/swap phases.
 */
htmx.install('ajax', {
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
            if (options.request?.url == null) throw new HtmxError('Cannot issue request without a URL', {type: 'REQUEST_URL_MISSING'})
            if (!options.request.url) options.request.url = location.pathname + location.search
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
                    const {url, execute, values, source, ...fetchOptions} = detail.request
                    return await window.fetch(url, fetchOptions)
                }

                if (api.emit(element, 'htmx:before:request', detail) === false) return

                // Merge programmatic values into request body/URL
                if (detail.request.values && typeof detail.request.values === 'object') {
                    const method = detail.request.method?.toUpperCase()
                    const usesQuery = /GET|DELETE/.test(method)
                    if (usesQuery) {
                        const url = new URL(detail.request.url, document.baseURI)
                        for (const [k, v] of Object.entries(detail.request.values)) {
                            url.searchParams.set(k, v)
                        }
                        detail.request.url = url.origin === location.origin
                            ? url.pathname + url.search : url.href
                    } else {
                        const params = detail.request.body instanceof URLSearchParams
                            ? detail.request.body : new URLSearchParams(detail.request.body || '')
                        for (const [k, v] of Object.entries(detail.request.values)) {
                            params.set(k, v)
                        }
                        detail.request.body = params
                    }
                    delete detail.request.values
                }

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

                api.emit(element, 'htmx:after:response', detail)

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
                api.emit(element, 'htmx:after:request', detail)
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
            options = {...options, context: {...options.context}}
            if (options.request !== undefined) options.context.request = options.request
            if (options.response !== undefined) options.context.response = options.response
            if (options.error !== undefined) options.context.error = options.error
            return original(swap, options)
        },
    },
})
/**
 * Default trigger — wire click/change/submit based on element type.
 */
htmx.install('default-trigger', {
    on: {
        'htmx:before:init': (detail, api) => {
            // Don't override if another extension already set up trigger
            if (detail.trigger) return

            // Only wire a default trigger for elements that have a request action.
            // Elements with only inherited/config attrs (e.g. hx-boost:inherited)
            // should not get a click handler that calls preventDefault().
            const el = detail.element
            const hasAction = api.attr(el, 'hx-get') != null || api.attr(el, 'hx-post') != null
                || api.attr(el, 'hx-put') != null || api.attr(el, 'hx-patch') != null
                || api.attr(el, 'hx-delete') != null || api.attr(el, 'hx-trigger') != null
            if (!hasAction) return

            // Default trigger based on element type
            let eventName
            if (el.matches('form')) eventName = 'submit'
            else if (el.matches('input:not([type=button]), select, textarea')) eventName = 'change'
            else eventName = 'click'

            detail.trigger = {
                eventName,
                execute: (event) => {
                    // Don't preventDefault for anchors with real fragment identifiers
                    // (e.g. href="#section"), only prevent for bare "#" or non-fragment hrefs
                    if (event) {
                        const href = el.getAttribute?.('href')
                        const isFragmentLink = href && href.startsWith('#') && href.length > 1
                        if (!isFragmentLink) {
                            event.preventDefault()
                        }
                    }
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
})
/**
 * Default swap style — apply config.defaultSwap when none is specified.
 */
htmx.install('default-swap', {
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
})
/**
 * Default headers — merge config.defaultHeaders into every request.
 */
htmx.install('default-headers', {
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
})
/**
 * Add HX-Source, HX-Target, and HX-Request-Type headers to every request.
 * HX-Source identifies the triggering element, HX-Target identifies the swap target,
 * and HX-Request-Type indicates whether the server should return a full page or fragment.
 */
htmx.install('request-identifiers', {
    requires: ['ajax'],
    on: {
        'htmx:before:request': (detail, api) => {
            function ident(el) {
                if (el === document.body) return 'body'
                const tag = el.tagName?.toLowerCase() || ''
                return el.id ? `${tag}#${el.id}` : tag
            }

            const el = detail.element
            detail.request.headers['HX-Source'] = ident(el)

            const targetAttr = api.attr(el, 'hx-target')
            const selectAttr = api.attr(el, 'hx-select')
            const target = targetAttr ? api.find(targetAttr, {from: el}) : el

            if (target) detail.request.headers['HX-Target'] = ident(target)
            detail.request.headers['HX-Request-Type'] = (target === document.body || selectAttr) ? 'full' : 'partial'
        }
    }
})
/**
 * Form data collection — collect form values and inject into requests.
 */
htmx.install('form-data', {
    requires: ['ajax'],
    config: {attributeFilter: ['hx-include', 'hx-encoding']},
    on: {
        'htmx:before:request': (detail, api) => {
            function addInputValues(elt, included, formData) {
                // If elt is a form, add all its fields
                if (elt.matches?.('form')) {
                    for (const [k, v] of new FormData(elt)) formData.append(k, v)
                    return
                }

                const inputs = elt.matches?.('input, select, textarea')
                    ? [elt]
                    : elt.querySelectorAll('input:not([disabled]), select:not([disabled]), textarea:not([disabled])')

                for (const input of inputs) {
                    if (!input.name || included.has(input)) continue
                    included.add(input)

                    const type = input.type
                    if (type === 'checkbox' || type === 'radio') {
                        if (input.checked) formData.append(input.name, input.value)
                    } else if (type === 'file') {
                        for (const file of input.files) formData.append(input.name, file)
                    } else if (input.type === 'select-multiple') {
                        for (const option of input.selectedOptions) formData.append(input.name, option.value)
                    } else {
                        formData.append(input.name, input.value)
                    }
                }
            }

            const el = detail.element
            if (!el) return

            const method = detail.request.method?.toUpperCase()
            const usesQueryParams = /GET|DELETE/.test(method)

            // Find form: for GET/DELETE only use form if element IS the form
            // For POST/PUT/PATCH, use enclosing form
            const form = usesQueryParams
                ? (el.matches?.('form') ? el : null)
                : (el.form || el.closest?.('form'))

            // Collect FormData
            const body = form ? new FormData(form) : new FormData()
            const included = form ? new Set(form.elements) : new Set()

            // Include element's own value if not in a form
            if (!form && el.name) {
                body.append(el.name, el.value)
                included.add(el)
            }

            // hx-include: add fields from other selectors
            const includeSelector = api.attr(el, 'hx-include')
            if (includeSelector) {
                const nodes = api.find(includeSelector, {from: el, multiple: true})
                for (const node of nodes) {
                    addInputValues(node, included, body)
                }
            }

            if (usesQueryParams) {
                // GET/DELETE: append form data to URL as query parameters
                const url = new URL(detail.request.url, document.baseURI)

                // Clear existing keys that will be re-added from form
                for (const key of body.keys()) {
                    url.searchParams.delete(key)
                }
                for (const [key, value] of body) {
                    url.searchParams.append(key, value)
                }

                // Keep relative if same origin
                if (url.origin === location.origin) {
                    detail.request.url = url.pathname + url.search
                } else {
                    detail.request.url = url.href
                }
            } else {
                // POST/PUT/PATCH: set body
                const encoding = api.attr(el, 'hx-encoding')
                if (encoding === 'multipart/form-data') {
                    detail.request.body = body
                } else {
                    detail.request.body = new URLSearchParams(body)
                }
            }
        },
    }
})
/**
 * Form validation — check form validity before issuing a request.
 * By default, forms validate unless novalidate is set.
 * hx-validate="true" forces validation (overrides novalidate).
 * hx-validate="false" disables validation.
 * formnovalidate on the triggering button skips validation.
 */
htmx.install('hx-validate', {
    requires: ['ajax'],
    config: {attributeFilter: ['hx-validate']},
    on: {
        'htmx:before:request': (detail, api) => {
            const el = detail.element
            if (!el) return

            const validate = api.attr(el, 'hx-validate')

            // hx-validate="false" — skip validation entirely
            if (validate === 'false') return

            // Find the enclosing form (or the element itself if it is a form)
            const form = el.matches?.('form') ? el : el.closest?.('form')

            // For elements with hx-validate="true", validate even without a form
            if (validate === 'true' || validate === '') {
                // Validate included elements or the form
                const target = form || el
                if (target.checkValidity && !target.checkValidity()) {
                    target.reportValidity?.()
                    return false
                }
                return
            }

            // No explicit hx-validate — use default form validation behavior
            if (!form) return

            // formnovalidate on the element skips validation
            if (el.hasAttribute?.('formnovalidate')) return

            // novalidate on the form disables validation by default
            if (form.noValidate) return

            // Default: validate the form
            if (!form.checkValidity()) {
                form.reportValidity()
                return false
            }
        },
    }
})
/**
 * Merge JSON values from hx-vals into request body or URL query params.
 */
htmx.install('hx-vals', {
    requires: ['form-data', 'parser'],
    config: {attributeFilter: ['hx-vals']},
    on: {
        'htmx:before:request': (detail, api) => {
            const valsAttr = api.attr(detail.element, 'hx-vals')
            if (!valsAttr) return

            let vals = {}
            // js: or javascript: prefix — evaluate as expression
            const jsMatch = valsAttr.match(/^(?:js|javascript):(.*)$/s)
            if (jsMatch) {
                let expr = jsMatch[1].trim()
                if (expr[0] !== '{') expr = '{' + expr + '}'
                try { vals = new Function('return (' + expr + ')')() } catch { return }
            } else {
                // Handle comma-separated JSON objects from inheritance chain
                // e.g. '{"a":1},{"b":2}' from inherited+append
                const parts = valsAttr.split(/(?<=\})\s*,\s*(?=\{)/)
                for (const part of parts) {
                    try { Object.assign(vals, JSON.parse(part)) } catch {
                        Object.assign(vals, api.parse(part) || {})
                    }
                }
            }

            if (!vals || typeof vals !== 'object') return

            const method = detail.request.method?.toUpperCase()
            const usesQueryParams = /GET|DELETE/.test(method)

            if (usesQueryParams) {
                const url = new URL(detail.request.url, document.baseURI)
                for (const [k, v] of Object.entries(vals)) {
                    url.searchParams.set(k, String(v))
                }
                detail.request.url = url.origin === location.origin
                    ? url.pathname + url.search
                    : url.href
            } else {
                if (!detail.request.body) detail.request.body = new URLSearchParams()
                for (const [k, v] of Object.entries(vals)) {
                    if (detail.request.body instanceof URLSearchParams) {
                        detail.request.body.set(k, String(v))
                    }
                }
            }
        },
    }
})
/**
 * Merge JSON headers from hx-headers into request headers.
 */
htmx.install('hx-headers', {
    config: {attributeFilter: ['hx-headers']},
    on: {
        'htmx:before:request': (detail, api) => {
            const headersAttr = api.attr(detail.element, 'hx-headers')
            if (!headersAttr) return
            let headers
            try {
                // js: or javascript: prefix — evaluate as expression
                const jsMatch = headersAttr.match(/^(?:js|javascript):(.*)$/s)
                if (jsMatch) {
                    let code = jsMatch[1].trim()
                    if (!code.startsWith('{')) code = '{' + code + '}'
                    const result = new Function('return (' + code + ')')()
                    headers = {}
                    for (const [k, v] of Object.entries(result)) {
                        headers[k] = String(v)
                    }
                } else {
                    // Try parsing as JSON (with or without braces)
                    let jsonStr = headersAttr.trim()
                    if (!jsonStr.startsWith('{')) jsonStr = '{' + jsonStr + '}'
                    headers = JSON.parse(jsonStr)
                }
                detail.request.headers = {...detail.request.headers, ...headers}
            } catch (e) {
                console.error('[htmx] Failed to parse hx-headers:', e)
            }
        },
    }
})
/**
 * Process HX-* response headers (redirect, refresh, retarget, reswap, etc).
 */
htmx.install('response-headers', {
    requires: ['ajax'],
    on: {
        'htmx:after:request': (detail, api) => {
            if (!detail.response?.raw?.headers) return
            const h = detail.response.raw.headers

            // Store extracted HX headers on detail for other extensions
            detail.hx = {}
            for (const [k, v] of h) {
                if (k.toLowerCase().startsWith('hx-')) {
                    detail.hx[k.toLowerCase().replace('hx-', '')] = v
                }
            }
        },

        'htmx:before:response': (detail, api) => {
            if (!detail.hx) return

            // HX-Redirect: navigate away
            if (detail.hx.redirect) {
                location.href = detail.hx.redirect
                return false // cancel further processing
            }

            // HX-Refresh: reload page
            if (detail.hx.refresh === 'true') {
                location.reload()
                return false
            }

            // HX-Location: ajax navigation
            if (detail.hx.location) {
                let path = detail.hx.location
                if (path.startsWith('{')) {
                    try {
                        const opts = JSON.parse(path)
                        path = opts.path
                    } catch {}
                }
                api.ajax({request: {url: path, method: 'GET'}})
                return false
            }

            // HX-Trigger: fire events on source element
            if (detail.hx.trigger) {
                const value = detail.hx.trigger
                if (value.startsWith('{')) {
                    try {
                        const triggers = JSON.parse(value)
                        for (const [name, eventDetail] of Object.entries(triggers)) {
                            api.emit(detail.element, name, typeof eventDetail === 'object' ? eventDetail : {})
                        }
                    } catch {}
                } else {
                    api.emit(detail.element, value, {})
                }
            }

            // HX-Retarget: change swap target
            if (detail.hx.retarget) {
                detail.swap = detail.swap || {}
                detail.swap.target = detail.hx.retarget
            }

            // HX-Reswap: change swap style
            if (detail.hx.reswap) {
                detail.swap = detail.swap || {}
                detail.swap.style = detail.hx.reswap
            }

            // HX-Reselect: change selection
            if (detail.hx.reselect) {
                detail.swap = detail.swap || {}
                detail.swap.select = detail.hx.reselect
            }
        },
    }
})
/**
 * Skip swap for 204, 304 responses.
 */
htmx.install('no-swap', {
    requires: ['ajax'],
    config: { noSwap: [204, 304] },
    on: {
        'htmx:before:response': (detail, api) => {
            if (api.config.noSwap.includes(detail.response?.status)) {
                detail.swap = detail.swap || {}
                detail.swap.style = 'none'
            }
        },
    }
})
/**
 * Store ETag from response headers and send If-None-Match on subsequent requests.
 */
htmx.install('etag-cache', {
    requires: ['ajax'],
    on: {
        'htmx:before:request': (detail) => {
            const etag = detail.element?._htmx?.etag
            if (etag) {
                detail.request.headers['If-none-match'] = etag
            }
        },
        'htmx:after:request': (detail) => {
            const etag = detail.response?.headers?.etag || detail.response?.raw?.headers?.get?.('Etag')
            if (etag) {
                detail.element._htmx = detail.element._htmx || {}
                detail.element._htmx.etag = etag
            }
        },
    }
})
/**
 * Prevent requests from disconnected elements (removed from the DOM).
 */
htmx.install('disconnected-guard', {
    on: {
        'htmx:before:trigger': (detail) => {
            if (!detail.element?.isConnected) return false
        },
    }
})
/**
 * Show confirmation dialog before trigger, with full event protocol:
 * - htmx:config:request fires first (ctx.confirm can be modified/nullified)
 * - htmx:confirm fires with detail.ctx and detail.issueRequest
 * - Supports js: prefix for custom evaluation
 * - Supports async custom confirmation UI via issueRequest callback
 */
htmx.install('hx-confirm', {
    config: {attributeFilter: ['hx-confirm']},
    on: {
        'htmx:before:trigger': (detail, api) => {
            const el = detail.element
            // Bypass confirm on re-trigger from issueRequest
            if (el._htmxConfirmBypass) return

            const confirmMsg = api.attr(el, 'hx-confirm')
            if (!confirmMsg) return

            const ctx = {confirm: confirmMsg}

            // Fire htmx:config:request so listeners can modify ctx.confirm
            el.dispatchEvent(new CustomEvent('htmx:config:request', {
                detail: {element: el, ctx},
                bubbles: true,
                cancelable: true,
                composed: true,
            }))

            // If ctx.confirm was nullified, skip confirmation entirely
            if (ctx.confirm == null) return

            // Check for js: prefix — evaluate expression
            if (ctx.confirm.startsWith('js:')) {
                const expr = ctx.confirm.slice(3)
                try {
                    const result = new Function('element', `return ${expr}`).call(el, el)
                    if (!result) return false
                } catch (e) {
                    console.error('[htmx] hx-confirm js: evaluation error:', e)
                    return false
                }
                return
            }

            // issueRequest support for async custom confirmation
            const issueRequest = (confirmed = true) => {
                if (confirmed) {
                    el._htmxConfirmBypass = true
                    if (api.emit(el, 'htmx:before:trigger', {element: el, event: detail.event}) !== false) {
                        api.emit(el, 'htmx:after:trigger', {element: el, event: detail.event})
                    }
                    el._htmxConfirmBypass = false
                }
            }

            // Fire htmx:confirm event on the element
            const dispatched = el.dispatchEvent(new CustomEvent('htmx:confirm', {
                detail: {element: el, ctx, issueRequest},
                bubbles: true,
                cancelable: true,
                composed: true,
            }))

            // If htmx:confirm was prevented, the listener will call issueRequest later
            if (!dispatched) return false

            // Default behavior: window.confirm
            if (!window.confirm(ctx.confirm)) return false
        },
    }
})
/**
 * Parse hx-trigger for multi-trigger, load, every, from.
 */
htmx.install('hx-trigger', {
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
                    let eventName = t.eventName || defaultEventName

                    // Extract filter expression from bracket notation (e.g. "evt[foo]")
                    let filterExpr = null
                    if (eventName) {
                        const openIdx = eventName.indexOf('[')
                        if (openIdx !== -1) {
                            const closeIdx = eventName.indexOf(']', openIdx)
                            if (closeIdx !== -1) {
                                filterExpr = eventName.slice(openIdx + 1, closeIdx)
                                eventName = eventName.slice(0, openIdx)
                            }
                        }
                    }

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

                    // Build a filtered+consume-aware handler wrapping execute
                    const targetFilter = t.target || null
                    const consume = !!t.consume
                    const changed = !!t.changed
                    let lastValue = changed ? element.value : undefined
                    const handler = (event) => {
                        // Changed modifier: only fire when the element's value actually changed
                        if (changed) {
                            if (element.value === lastValue) return
                            lastValue = element.value
                        }
                        // Evaluate filter expression against the event
                        // Properties of the event are available as bare names (e.g. [ctrlKey], [foo])
                        if (filterExpr !== null) {
                            try {
                                const result = new Function('event', 'with(event) { return (' + filterExpr + ') }').call(event, event)
                                if (!result) return
                            } catch {
                                return
                            }
                        }
                        // Check target filter (e.g. target:#d3)
                        if (targetFilter) {
                            const targetEl = event.target
                            if (!targetEl?.matches?.(targetFilter)) return
                        }
                        // Consume modifier: stop propagation
                        if (consume) {
                            event.stopPropagation()
                        }
                        execute(event)
                    }

                    // Resolve listen target (from modifier)
                    if (t.from) {
                        for (const fromTarget of api.find(t.from, {from: element, multiple: true})) {
                            // For from: triggers, only preventDefault when the event
                            // originated directly on the from-element, not on children
                            // bubbling through it (e.g. from:body should not preventDefault
                            // on clicks of unrelated input elements)
                            const fromHandler = (event) => {
                                const origPreventDefault = event.preventDefault.bind(event)
                                if (event.target !== fromTarget) {
                                    event.preventDefault = () => {} // no-op for bubbled events
                                }
                                handler(event)
                                event.preventDefault = origPreventDefault
                            }
                            const off = api.on(fromTarget, eventName, fromHandler, options)
                            api.state.elements(element).cleanup.push(off)
                        }
                    } else {
                        api.on(element, eventName, handler, options)
                    }
                }
            }

            // Prevent smart-defaults from also wiring its single listener
            if (detail.trigger) detail.trigger.eventName = null
        }
    }
})
/**
 * Issue GET request to hx-get URL on trigger.
 */
htmx.install('hx-get', {
    requires: ['ajax'],
    config: {attributeFilter: ['hx-get']},
    on: {
        'htmx:before:trigger': (detail, api) => {
            const url = api.attr(detail.element, 'hx-get')
            if (url != null) api.ajax({element: detail.element, request: {url: url || location.pathname + location.search, method: 'GET'}})
        }
    }
})
/**
 * Issue POST request to hx-post URL on trigger.
 */
htmx.install('hx-post', {
    requires: ['ajax'],
    config: {attributeFilter: ['hx-post']},
    on: {
        'htmx:before:trigger': (detail, api) => {
            const url = api.attr(detail.element, 'hx-post')
            if (url != null) api.ajax({element: detail.element, request: {url: url || location.pathname + location.search, method: 'POST'}})
        }
    }
})
/**
 * Issue PUT request to hx-put URL on trigger.
 */
htmx.install('hx-put', {
    requires: ['ajax'],
    config: {attributeFilter: ['hx-put']},
    on: {
        'htmx:before:trigger': (detail, api) => {
            const url = api.attr(detail.element, 'hx-put')
            if (url != null) api.ajax({element: detail.element, request: {url: url || location.pathname + location.search, method: 'PUT'}})
        }
    }
})
/**
 * Issue PATCH request to hx-patch URL on trigger.
 */
htmx.install('hx-patch', {
    requires: ['ajax'],
    config: {attributeFilter: ['hx-patch']},
    on: {
        'htmx:before:trigger': (detail, api) => {
            const url = api.attr(detail.element, 'hx-patch')
            if (url != null) api.ajax({element: detail.element, request: {url: url || location.pathname + location.search, method: 'PATCH'}})
        }
    }
})
/**
 * Issue DELETE request to hx-delete URL on trigger.
 */
htmx.install('hx-delete', {
    requires: ['ajax'],
    config: {attributeFilter: ['hx-delete']},
    on: {
        'htmx:before:trigger': (detail, api) => {
            const url = api.attr(detail.element, 'hx-delete')
            if (url != null) api.ajax({element: detail.element, request: {url: url || location.pathname + location.search, method: 'DELETE'}})
        }
    }
})
/**
 * Set swap style and modifiers from hx-swap attribute.
 */
htmx.install('hx-swap', {
    requires: ['swaps', 'parser'],
    config: {attributeFilter: ['hx-swap']},
    on: {
        'htmx:before:swap': (detail, api) => {
            // Skip nested OOB/partial swaps (they have their own style)
            // Skip boost-config swaps (boost config overrides explicit hx-* attrs)
            if (detail.swap?._boostConfig || !detail.element) return
            const swapAttr = api.parse(api.attr(detail.element, 'hx-swap'), {as: 'style'})
            if (swapAttr) Object.assign(detail.swap, swapAttr)
        }
    }
})
/**
 * Handles scroll and delay modifiers on swap specifications.
 */
htmx.install('swap-modifiers', {
    requires: ['hx-swap'],
    on: {
        'htmx:before:swap': (detail, api) => {
            const swap = detail.swap
            if (!swap) return

            // Non-blocking swap delay: swap:Nms with transition:false
            if (swap.swap && swap.transition === false) {
                const ms = parseInt(swap.swap, 10)
                if (ms > 0) {
                    const originalExecute = swap.execute
                    swap.execute = () => {
                        setTimeout(() => originalExecute(), ms)
                    }
                }
            }
        },
        'htmx:after:swap': (detail, api) => {
            const swap = detail.swap
            if (!swap) return

            const target = swap.target
            if (!(target instanceof Element)) return

            // scroll:top modifier
            if (swap.scroll === 'top') {
                target.scrollTop = 0
            }
            // scroll:bottom modifier
            if (swap.scroll === 'bottom') {
                target.scrollTop = target.scrollHeight
            }
        },
    }
})
/**
 * Resolve swap target from hx-target attribute.
 */
htmx.install('hx-target', {
    requires: ['swaps'],
    config: {attributeFilter: ['hx-target']},
    on: {
        'htmx:before:swap': (detail, api) => {
            // Skip nested OOB/partial swaps (they have their own target)
            if (!detail.element) return
            const target = api.attr(detail.element, 'hx-target')
            if (target) {
                detail.swap.target = api.find(target, {from: detail.element})
            }
        }
    }
})
/**
 * Friendly swap names — before, prepend, append, after, remove.
 */
htmx.install('swap-aliases', {
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
})
/**
 * Request timeout via AbortSignal (default 60s).
 */
htmx.install('request-timeout', {
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
})
htmx.install('request-queue', {
    requires: ['ajax'],
    config: {attributeFilter: ['hx-sync']},
    wrap: {
        ajax: (() => {
            class RequestQueue {
                _current = null
                _queue = []

                issue(ctx, strategy) {
                    ctx._queueStrategy = strategy
                    if (!this._current) {
                        this._current = ctx
                        return true
                    }

                    if (strategy === 'replace' || (strategy !== 'abort' && this._current._queueStrategy === 'abort')) {
                        this._queue.forEach(c => c._dropped = true)
                        this._queue = []
                        if (this._current._abort) this._current._abort()
                        this._current = ctx
                        return true
                    } else if (strategy === 'queue all') {
                        this._queue.push(ctx)
                    } else if (strategy === 'drop') {
                        ctx._dropped = true
                    } else if (strategy === 'queue last') {
                        this._queue.forEach(c => c._dropped = true)
                        this._queue = [ctx]
                    } else if (this._queue.length === 0 && strategy !== 'abort') {
                        // default: queue first
                        this._queue.push(ctx)
                    } else {
                        ctx._dropped = true
                    }
                    return false
                }

                finish() { this._current = null }
                next() { return this._queue.shift() }
                hasMore() { return this._queue.length > 0 }
            }

            return (original, options) => {
                const el = options?.element
                if (!el) return original(options)

                // Determine sync strategy from hx-sync attribute
                let syncAttr = el.getAttribute?.('hx-sync')
                let strategy = 'queue first'
                let queueEl = el

                if (syncAttr) {
                    if (syncAttr.includes(':')) {
                        const [selector, strat] = syncAttr.split(':')
                        strategy = strat.trim()
                        const found = document.querySelector(selector.trim())
                        if (found) queueEl = found
                    } else {
                        strategy = syncAttr.trim()
                    }
                }

                // Get or create queue for the element
                const queue = queueEl._htmxRequestQueue ||= new RequestQueue()

                const ctx = {options}
                if (!queue.issue(ctx, strategy)) return // dropped or queued

                // Set up abort capability
                const controller = new AbortController()
                ctx._abort = () => controller.abort()
                options.request.signal = options.request.signal
                    ? AbortSignal.any([options.request.signal, controller.signal])
                    : controller.signal

                // Execute and handle queue
                const result = original(options)
                if (result && typeof result.then === 'function') {
                    result.finally(() => {
                        queue.finish()
                        const next = queue.next()
                        if (next) {
                            // Re-issue the queued request
                            original(next.options)
                        }
                    })
                }
                return result
            }
        })(),
    }
})
/**
 * Out-of-band swaps via hx-swap-oob attribute on response elements.
 * Also handles hx-select-oob on the triggering element.
 */
htmx.install('hx-swap-oob', {
    requires: ['swaps'],
    config: {attributeFilter: ['hx-select-oob']},
    on: {
        'htmx:after:response': (detail, api) => {
            const text = detail.response?.text
            if (!text) return

            const template = document.createElement('template')
            template.innerHTML = text
            const fragment = template.content
            let modified = false

            // Process hx-select-oob from the triggering element
            const selectOOB = detail.element ? api.attr(detail.element, 'hx-select-oob') : null
            if (selectOOB) {
                for (const spec of selectOOB.split(',')) {
                    const [selector, oobValue = 'true'] = spec.trim().split(/:(.*)/)
                    if (!selector) continue
                    for (const el of [...fragment.querySelectorAll(selector)]) {
                        el.remove()
                        modified = true
                        oobSwap(el, oobValue, detail, api)
                    }
                }
            }

            // Process elements with hx-swap-oob attribute
            for (const el of [...fragment.querySelectorAll('[hx-swap-oob]')]) {
                const oobValue = el.getAttribute('hx-swap-oob')
                el.removeAttribute('hx-swap-oob')
                el.remove()
                modified = true
                oobSwap(el, oobValue, detail, api)
            }

            if (modified) {
                if (fragment.childNodes.length === 0) {
                    detail.response.text = null
                } else {
                    const t = document.createElement('template')
                    t.content.appendChild(fragment)
                    detail.response.text = t.innerHTML
                }
            }

            function oobSwap(el, value, detail, api) {
                let style = 'outerHTML'
                let target = el.id ? document.getElementById(el.id) : null

                if (value && value !== 'true') {
                    const [s, t] = value.split(/:(.*)/)
                    if (s) style = s
                    if (t) target = document.querySelector(t)
                }

                if (!target) return
                const frag = document.createDocumentFragment()
                if (style === 'outerHTML') {
                    frag.appendChild(el)
                } else {
                    while (el.childNodes.length) frag.appendChild(el.firstChild)
                }
                api.swap({content: frag, style, target})
            }
        },
    }
})
/**
 * Out-of-band swaps via <hx-partial> tags in response content.
 */
htmx.install('hx-partial', {
    requires: ['swaps'],
    on: {
        'htmx:after:response': (detail, api) => {
            const text = detail.response?.text
            if (!text) return

            const template = document.createElement('template')
            template.innerHTML = text
            const fragment = template.content

            const partials = [...fragment.querySelectorAll('hx-partial')]
            if (!partials.length) return

            for (const partial of partials) {
                partial.remove()
                const target = partial.getAttribute('hx-target')
                    ? document.querySelector(partial.getAttribute('hx-target'))
                    : null
                if (!target) continue

                const style = partial.getAttribute('hx-swap') || 'innerHTML'
                const frag = document.createDocumentFragment()
                while (partial.childNodes.length) frag.appendChild(partial.firstChild)
                api.swap({content: frag, style, target})
            }

            if (fragment.childNodes.length === 0) {
                detail.response.text = null
            } else {
                const t = document.createElement('template')
                t.content.appendChild(fragment)
                detail.response.text = t.innerHTML
            }
        },
    }
})
/**
 * Filter response content to only include elements matching the hx-select selector.
 */
htmx.install('hx-select', {
    requires: ['swaps'],
    config: {attributeFilter: ['hx-select']},
    on: {
        'htmx:before:swap': (detail, api) => {
            const selectAttr = detail.swap?.select || (detail.element ? api.attr(detail.element, 'hx-select') : null)
            if (!selectAttr) return

            const content = detail.swap?.content
            if (!(content instanceof DocumentFragment)) return

            // Find matching elements in the fragment
            const matches = content.querySelectorAll(selectAttr)

            // Replace content with only matched elements
            const newFrag = document.createDocumentFragment()
            for (const match of matches) {
                newFrag.appendChild(match)
            }

            // Clear the fragment and replace with filtered content
            while (content.firstChild) content.removeChild(content.firstChild)
            content.appendChild(newFrag)
        },
    }
})
/**
 * Re-creates script tags in swapped content to trigger execution.
 */
htmx.install('script-processing', {
    on: {
        'htmx:after:swap': (detail, api) => {
            // Collect all scripts to process
            const scripts = []

            // For innerHTML/afterbegin/beforeend, scripts are inside the target
            const target = detail.swap?.target
            if (target instanceof Element) {
                scripts.push(...target.querySelectorAll('script'))
            }

            // For outerHTML/beforebegin/afterend, scripts may be in inserted nodes (siblings)
            const insertedNodes = detail.swap?._insertedNodes
            if (insertedNodes) {
                for (const node of insertedNodes) {
                    if (node.nodeName === 'SCRIPT') {
                        scripts.push(node)
                    } else if (node instanceof Element) {
                        scripts.push(...node.querySelectorAll('script'))
                    }
                }
            }

            // Deduplicate and process
            const seen = new Set()
            for (const oldScript of scripts) {
                if (seen.has(oldScript)) continue
                seen.add(oldScript)
                const newScript = document.createElement('script')
                for (const attr of oldScript.attributes) {
                    newScript.setAttribute(attr.name, attr.value)
                }
                if (api.config.inlineScriptNonce) {
                    newScript.nonce = api.config.inlineScriptNonce
                }
                newScript.textContent = oldScript.textContent
                oldScript.replaceWith(newScript)
            }
        },
    }
})
/**
 * Manages loading indicator CSS classes with reference counting.
 */
htmx.install('hx-indicator', {
    config: {
        attributeFilter: ['hx-indicator'],
        indicatorClass: 'htmx-indicator',
        requestClass: 'htmx-request',
        includeIndicatorCSS: true,
        inlineStyleNonce: null,
    },
    on: {
        'htmx:boot': (detail, api) => {
            if (api.config.includeIndicatorCSS !== false) {
                const style = document.createElement('style')
                style.textContent = `.${api.config.indicatorClass}{opacity:0;transition:opacity 200ms ease-in}.${api.config.requestClass} .${api.config.indicatorClass}{opacity:1}.${api.config.requestClass}.${api.config.indicatorClass}{opacity:1}`
                if (api.config.inlineStyleNonce) style.nonce = api.config.inlineStyleNonce
                document.head.appendChild(style)
            }
        },
        'htmx:before:request': (detail, api) => {
            const el = detail.element
            if (!el) return
            const selector = api.attr(el, 'hx-indicator')
            const indicators = selector
                ? (api.find(selector, {from: el, multiple: true}) || [])
                : [el]

            for (const ind of indicators) {
                ind._htmxReqCount = (ind._htmxReqCount || 0) + 1
                ind.classList.add(api.config.requestClass)
            }
            detail._indicators = indicators
        },
        'htmx:finally': (detail, api) => {
            for (const ind of detail._indicators || []) {
                ind._htmxReqCount = (ind._htmxReqCount || 1) - 1
                if (ind._htmxReqCount <= 0) {
                    ind._htmxReqCount = 0
                    ind.classList.remove(api.config.requestClass)
                }
            }
        },
    }
})
/**
 * Disables elements during request with reference counting.
 * Disabling is synchronous (htmx:before:request); re-enabling is async (htmx:finally).
 */
htmx.install('hx-disable', {
    config: {attributeFilter: ['hx-disable']},
    on: {
        'htmx:before:request': (detail, api) => {
            const el = detail.element
            if (!el) return
            const selector = api.attr(el, 'hx-disable')
            if (!selector) return
            // Support comma-separated extended selectors (e.g. "find input, find button")
            const targets = []
            for (const part of selector.split(',')) {
                const found = api.find(part.trim(), {from: el, multiple: true}) || []
                targets.push(...found)
            }
            for (const t of targets) {
                t._htmxDisableCount = (t._htmxDisableCount || 0) + 1
                t.disabled = true
            }
            el._htmxDisabledElements = (el._htmxDisabledElements || []).concat(targets)
        },
        'htmx:finally': (detail, api) => {
            const el = detail.element
            if (!el) return
            const targets = el._htmxDisabledElements || []
            for (const t of targets) {
                t._htmxDisableCount = (t._htmxDisableCount || 1) - 1
                if (t._htmxDisableCount <= 0) {
                    t._htmxDisableCount = 0
                    t.disabled = false
                }
            }
            el._htmxDisabledElements = []
        },
    }
})
/**
 * Wire up inline JavaScript event handlers from hx-on:eventName attributes.
 */
htmx.install('hx-on', {
    on: {
        'htmx:before:init': (detail, api) => {
            const el = detail.element
            const handlers = []
            for (const attrName of el.getAttributeNames()) {
                if (!attrName.startsWith('hx-on:') && !attrName.startsWith('hx-on-')) continue
                const eventName = attrName.slice(6).replace(/-/g, ':')
                const code = el.getAttribute(attrName)
                handlers.push({eventName, code})
            }
            if (!handlers.length) return

            const originalInit = detail.init.execute
            const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor
            detail.init.execute = () => {
                originalInit()
                for (const {eventName, code} of handlers) {
                    api.on(el, eventName, (event) => {
                        try {
                            const find = (selectorOrRoot, selector) => {
                                if (selector === undefined) {
                                    return api.find(selectorOrRoot, {from: el})
                                }
                                const root = typeof selectorOrRoot === 'string'
                                    ? document.querySelector(selectorOrRoot) : selectorOrRoot
                                return api.find(selector, {from: root})
                            }
                            const timeout = (ms) => new Promise(r => setTimeout(r, ms))
                            new AsyncFunction('event', 'element', 'find', 'timeout', code).call(el, event, el, find, timeout)
                        } catch (e) {
                            console.error(`[htmx] hx-on:${eventName} error:`, e)
                        }
                    })
                }
            }
        },
    }
})
/**
 * Preserves elements across swaps by saving and restoring them.
 */
htmx.install('hx-preserve', {
    config: {attributeFilter: ['hx-preserve']},
    on: {
        'htmx:before:swap': (detail, api) => {
            const originalExecute = detail.swap?.execute
            if (!originalExecute) return

            detail.swap.execute = () => {
                // Resolve target to find preserved elements before the swap
                const target = typeof detail.swap.target === 'string'
                    ? api.find(detail.swap.target)
                    : detail.swap.target ?? detail.element

                const preserved = new Map()
                if (target) {
                    for (const el of target.querySelectorAll('[hx-preserve]')) {
                        if (el.id) preserved.set(el.id, el)
                    }
                }

                // Execute the original swap
                originalExecute()

                // Restore preserved elements
                for (const [id, original] of preserved) {
                    const replacement = document.getElementById(id)
                    if (replacement) {
                        replacement.replaceWith(original)
                    }
                }
            }
        },
    }
})
/**
 * Focus elements with the autofocus attribute after swap.
 */
htmx.install('autofocus', {
    on: {
        'htmx:after:swap': (detail) => {
            const target = detail.swap?.target
            if (!target) return
            const el = target.querySelector?.('[autofocus]')
            if (el) el.focus()
        },
    }
})
/**
 * Mark initialized elements with data-htmx-powered attribute for cleanup tracking.
 */
htmx.install('htmx-powered', {
    on: {
        'htmx:after:init': (detail) => {
            detail.element.setAttribute('data-htmx-powered', 'true')
        },
    }
})
/**
 * Prevents processing of elements within hx-ignore containers.
 */
htmx.install('hx-ignore', {
    on: {
        'htmx:before:init': (detail, api) => {
            if (detail.element.closest('[hx-ignore]')) return false
        },
    }
})
/**
 * Boost <a> and <form> inside hx-boost containers.
 */
htmx.install('hx-boost', {
    requires: ['ajax'],
    config: {attributeFilter: ['hx-boost']},
    on: {
        'htmx:after:walk:init': (detail, api) => {
            const root = detail.element
            const boostSel = '[hx-boost],[hx-boost\\:inherited]'
            const containers = [
                ...(root.matches?.(boostSel) ? [root] : []),
                ...root.querySelectorAll(boostSel)
            ]
            for (const container of containers) {
                const boost = api.attr(container, 'hx-boost')
                if (!boost || boost === 'false') continue

                // Parse advanced boost config: "swap:innerHTML target:#main select:#content"
                let boostConfig = null
                if (boost !== 'true') {
                    boostConfig = {}
                    for (const part of boost.split(/\s+/)) {
                        const colonIdx = part.indexOf(':')
                        if (colonIdx > 0) {
                            boostConfig[part.slice(0, colonIdx)] = part.slice(colonIdx + 1)
                        }
                    }
                }

                // Include the container itself if it's a boostable element (form/anchor)
                const boostable = [
                    ...(container.matches('a[href], form') ? [container] : []),
                    ...container.querySelectorAll('a[href], form'),
                ]
                for (const el of boostable) {
                    if (el._htmxBoosted) continue
                    el._htmxBoosted = true

                    // Per-element boost config: check direct hx-boost on the element itself
                    let elConfig = boostConfig
                    if (el !== container && el.hasAttribute('hx-boost')) {
                        const elBoost = el.getAttribute('hx-boost')
                        if (elBoost === 'false') continue
                        if (elBoost !== 'true') {
                            elConfig = {}
                            for (const part of elBoost.split(/\s+/)) {
                                const colonIdx = part.indexOf(':')
                                if (colonIdx > 0) {
                                    elConfig[part.slice(0, colonIdx)] = part.slice(colonIdx + 1)
                                }
                            }
                        } else {
                            elConfig = null
                        }
                    }

                    const eventType = el.matches('a') ? 'click' : 'submit'
                    api.on(el, eventType, (evt) => {
                        let url, method
                        if (el.matches('a[href]')) {
                            url = el.getAttribute('href')
                            method = 'GET'
                            // Don't boost anchors with fragment-only hrefs (e.g. #section)
                            if (url && url.startsWith('#') && url.length > 1) return
                        } else {
                            const submitter = evt.submitter
                            // Don't boost dialog forms or buttons with formmethod="dialog"
                            const resolvedMethod = submitter?.getAttribute('formmethod')
                                || el.getAttribute('method') || 'GET'
                            if (resolvedMethod.toLowerCase() === 'dialog') return
                            url = submitter?.getAttribute('formaction')
                                || el.getAttribute('action') || ''
                            method = resolvedMethod.toUpperCase()
                        }
                        evt.preventDefault()
                        // Boost config overrides explicit hx-* attrs
                        const swap = elConfig?.swap || api.attr(el, 'hx-swap') || null
                        const targetSel = elConfig?.target || api.attr(el, 'hx-target')
                        const target = targetSel ? api.find(targetSel, {from: el}) : null
                        const select = elConfig?.select || api.attr(el, 'hx-select') || null
                        api.ajax({
                            element: el,
                            request: {url, method, headers: {'HX-Boosted': 'true'}},
                            swap: {style: swap, target: target || null, select, _boostConfig: !!elConfig},
                        })
                    })
                }
            }
        },
    }
})
/**
 * hx-action attribute — auto-detects HTTP method from element type.
 * GET for links/buttons, POST for forms, or from hx-config method override.
 */
htmx.install('hx-action', {
    requires: ['ajax'],
    config: {attributeFilter: ['hx-action']},
    on: {
        'htmx:after:walk:init': (detail, api) => {
            const root = detail.element
            const actionSel = '[hx-action]'
            const elements = [
                ...(root.matches?.(actionSel) ? [root] : []),
                ...root.querySelectorAll(actionSel)
            ]
            for (const el of elements) {
                if (el._htmxActionBound) continue
                el._htmxActionBound = true
                const url = el.getAttribute('hx-action')
                if (!url) continue
                const isForm = el.matches('form')
                const eventType = isForm ? 'submit' : 'click'
                const method = isForm ? 'POST' : 'GET'
                api.on(el, eventType, (evt) => {
                    evt.preventDefault()
                    api.ajax({element: el, request: {url, method}})
                })
            }
        },
    }
})
/**
 * hx-config attribute — per-element configuration overrides merged into request context.
 * Supports JSON values with optional + prefix for merging object properties.
 */
htmx.install('hx-config', {
    requires: ['ajax'],
    config: {attributeFilter: ['hx-config']},
    on: {
        'htmx:before:request': (detail, api) => {
            const el = detail.element
            if (!el) return
            const configAttr = api.attr(el, 'hx-config')
            if (!configAttr) return

            let parsed
            try { parsed = JSON.parse(configAttr) } catch { return }

            // Apply parsed config to detail.request
            for (let key in parsed) {
                let val = parsed[key]
                let merge = false
                if (key.startsWith('+')) {
                    merge = true
                    key = key.slice(1)
                }

                if (key === 'action') {
                    detail.request.url = val
                    detail.request.action = val
                    detail.request.shouldActivate = val
                } else if (key === 'method') {
                    detail.request.method = val
                } else if ((merge || key === 'headers') && val && typeof val === 'object' && !Array.isArray(val)
                    && detail.request[key] && typeof detail.request[key] === 'object') {
                    Object.assign(detail.request[key], val)
                } else {
                    detail.request[key] = val
                }
            }

            // Fire htmx:config:request event with ctx
            const ctx = {request: detail.request}
            el.dispatchEvent(new CustomEvent('htmx:config:request', {
                detail: {element: el, ctx},
                bubbles: true,
                cancelable: true,
                composed: true,
            }))
        },
    }
})
/**
 * hx-status:NNN attribute — per-status-code swap overrides.
 * Supports exact matches (hx-status:404), 2-digit wildcards (hx-status:50x),
 * and 1-digit wildcards (hx-status:5xx).
 */
htmx.install('hx-status', {
    requires: ['ajax'],
    on: {
        'htmx:before:response': (detail, api) => {
            if (!detail.response?.raw) return
            const status = detail.response.raw.status
            const el = detail.element
            if (!el) return

            const str = status + ''
            // Try patterns: exact (404), 2-digit wildcard (40x), 1-digit wildcard (4xx)
            for (const pattern of [str, str.slice(0, 2) + 'x', str[0] + 'xx']) {
                const attrName = 'hx-status:' + pattern
                const statusValue = el.getAttribute(attrName)
                if (statusValue != null) {
                    // Parse and store overrides for application during swap
                    const overrides = {}
                    const tokens = statusValue.trim().split(/\s+/)
                    for (const token of tokens) {
                        const colonIdx = token.indexOf(':')
                        if (colonIdx > 0) {
                            const key = token.slice(0, colonIdx)
                            let val = token.slice(colonIdx + 1)
                            if (val === 'true') val = true
                            else if (val === 'false') val = false
                            overrides[key] = val
                        }
                    }

                    // Handle push/replace-url immediately (needs element attribute change)
                    if (overrides.push === false || overrides.push === 'false') {
                        el.removeAttribute('hx-push-url')
                    }

                    // Store overrides on swap object (persists into before:swap detail)
                    detail.swap = detail.swap || {}
                    detail.swap._statusOverrides = overrides
                    return // First match wins
                }
            }
        },

        'htmx:before:swap': (detail, api) => {
            // Apply status overrides stored during before:response on the swap object
            const overrides = detail.swap?._statusOverrides
            if (!overrides) return

            if (overrides.swap) {
                detail.swap.style = overrides.swap
            }
            if (overrides.target) {
                detail.swap.target = api.find(overrides.target, {from: detail.element})
            }
            if (overrides.select) {
                // Re-filter content with the status-specific selector
                const content = detail.swap?.content
                if (content instanceof DocumentFragment) {
                    const matches = content.querySelectorAll(overrides.select)
                    const newFrag = document.createDocumentFragment()
                    for (const match of matches) newFrag.appendChild(match)
                    while (content.firstChild) content.removeChild(content.firstChild)
                    content.appendChild(newFrag)
                }
            }
        },
    }
})
/**
 * strip:true swap modifier — extracts children from top-level wrapper elements.
 * For each top-level element child in the content fragment, replaces it with its children.
 */
htmx.install('strip-modifier', {
    requires: ['swaps'],
    on: {
        'htmx:before:swap': (detail, api) => {
            if (!detail.swap) return

            // Check if strip is set directly (from hxSwap parse or OOB swap)
            let shouldStrip = detail.swap.strip

            // Also check if strip is embedded in the style string (from partials)
            if (shouldStrip === undefined && detail.swap.style && typeof detail.swap.style === 'string' && detail.swap.style.includes('strip:')) {
                const match = detail.swap.style.match(/\bstrip:(true|false)\b/)
                if (match) {
                    shouldStrip = match[1] === 'true'
                    // Pre-parse the style to remove the strip modifier (so execute() doesn't re-process)
                    detail.swap.strip = shouldStrip
                    detail.swap.style = detail.swap.style.replace(/\s*strip:(true|false)\b/, '').trim()
                }
            }

            if (!shouldStrip) return
            const content = detail.swap.content
            if (!(content instanceof DocumentFragment)) return

            // For each top-level element child, replace with its children
            for (const child of [...content.childNodes]) {
                if (child.nodeType === Node.ELEMENT_NODE) {
                    const childNodes = [...child.childNodes]
                    child.replaceWith(...childNodes)
                }
            }
        },
    }
})
/**
 * History management — push/replace URL on successful requests, handle popstate.
 */
htmx.install('history', {
    requires: ['ajax'],
    config: {
        history: true,
        attributeFilter: ['hx-push-url', 'hx-replace-url'],
    },
    on: {
        'htmx:boot': (detail, api) => {
            if (!api.config.history) return
            if (!history.state) {
                history.replaceState({htmx: true}, '', location.pathname + location.search)
            }
            window.addEventListener('popstate', (event) => {
                if (event.state?.htmx) {
                    const path = location.pathname + location.search
                    if (api.emit(document.body, 'htmx:before:history:restore', {path, cacheMiss: true})) {
                        if (api.config.history === 'reload') {
                            location.reload()
                        } else {
                            api.ajax({
                                request: {
                                    url: path,
                                    method: 'GET',
                                    headers: {'HX-History-Restore-Request': 'true'}
                                },
                                swap: {target: document.body, style: 'innerHTML'},
                            })
                        }
                    }
                }
            })
        },

        'htmx:done': (detail, api) => {
            if (!api.config.history) return
            const el = detail.element

            // Check attributes
            let push = api.attr(el, 'hx-push-url')
            let replace = api.attr(el, 'hx-replace-url')

            // Check response headers
            if (detail.hx?.push || detail.hx?.pushurl) push = push || detail.hx.push || detail.hx.pushurl
            if (detail.hx?.replaceurl) replace = replace || detail.hx.replaceurl

            // Boosted elements default to push
            if (!push && !replace && api.attr(el, 'hx-boost')) push = 'true'

            const pathSource = push || replace
            if (!pathSource || pathSource === 'false') return

            let path = pathSource
            if (path === 'true') {
                path = detail.response?.url || detail.request?.url || location.href
                try {
                    const url = new URL(path, location.href)
                    path = url.pathname + url.search
                } catch {}
            }

            const type = push ? 'push' : 'replace'
            const historyDetail = {history: {type, path}, element: el}

            if (api.emit(document.body, 'htmx:before:history:update', historyDetail) === false) return

            if (type === 'push') {
                history.pushState({htmx: true}, '', path)
                api.emit(document.body, 'htmx:after:history:push', {path})
            } else {
                history.replaceState({htmx: true}, '', path)
                api.emit(document.body, 'htmx:after:history:replace', {path})
            }

            api.emit(document.body, 'htmx:after:history:update', historyDetail)
        },
    }
})
/**
 * DOM morphing algorithm — intelligently patches existing DOM nodes to match
 * new content while preserving element identity, focus state, and animations.
 */
htmx.install('morph', {
    config: {
        morphScanLimit: 10,
        morphIgnore: ['data-htmx-powered'],
        morphSkip: null,
        morphSkipChildren: null,
    },
    define: {
        morph: (api) => function morph(oldNode, fragment, innerHTML) {
            // ── Helpers ──

            function queryEltAndDescendants(elt, selector) {
                let results = [...elt.querySelectorAll(selector)]
                if (elt.matches?.(selector)) results.unshift(elt)
                return results
            }

            function isSoftMatch(oldNode, newNode) {
                if (!(oldNode instanceof Element) || oldNode.tagName !== newNode.tagName) return false
                if (oldNode._x_bindings?.id && newNode.matches?.('[\\:id], [x-bind\\:id]')) return true
                return !oldNode.id || oldNode.id === newNode.id
            }

            function copyAttributes(destination, source) {
                let attributesToIgnore = api.config.morphIgnore || []
                for (const attr of source.attributes) {
                    if (!attributesToIgnore.includes(attr.name) && destination.getAttribute(attr.name) !== attr.value) {
                        destination.setAttribute(attr.name, attr.value)
                        if (attr.name === 'value' && destination instanceof HTMLInputElement && destination.type !== 'file') {
                            destination.value = attr.value
                        }
                    }
                }
                for (let i = destination.attributes.length - 1; i >= 0; i--) {
                    let attr = destination.attributes[i]
                    if (attr && !source.hasAttribute(attr.name) && !attributesToIgnore.includes(attr.name)) {
                        destination.removeAttribute(attr.name)
                    }
                }
            }

            function moveBefore(parentNode, element, after) {
                if (parentNode.moveBefore) {
                    try { parentNode.moveBefore(element, after); return } catch (e) {}
                }
                parentNode.insertBefore(element, after)
            }

            function createPersistentIds(oldIdElements, newIdElements) {
                let duplicateIds = new Set(), oldIdTagNameMap = new Map()
                for (const {id, tagName} of oldIdElements) {
                    if (oldIdTagNameMap.has(id)) duplicateIds.add(id)
                    else if (id) oldIdTagNameMap.set(id, tagName)
                }
                let persistentIds = new Set()
                for (const {id, tagName} of newIdElements) {
                    if (persistentIds.has(id)) duplicateIds.add(id)
                    else if (oldIdTagNameMap.get(id) === tagName) persistentIds.add(id)
                }
                for (const id of duplicateIds) persistentIds.delete(id)
                return persistentIds
            }

            function populateIdMapWithTree(idMap, persistentIds, root, elements) {
                for (const elt of elements) {
                    if (persistentIds.has(elt.id)) {
                        let current = elt
                        while (current && current !== root) {
                            let idSet = idMap.get(current)
                            if (idSet == null) { idSet = new Set(); idMap.set(current, idSet) }
                            idSet.add(elt.id)
                            current = current.parentElement
                        }
                    }
                }
            }

            function createIdMaps(oldNode, newContent) {
                let oldIdElements = queryEltAndDescendants(oldNode, '[id]')
                let newIdElements = newContent.querySelectorAll('[id]')
                let persistentIds = createPersistentIds(oldIdElements, newIdElements)
                let idMap = new Map()
                populateIdMapWithTree(idMap, persistentIds, oldNode.parentElement, oldIdElements)
                populateIdMapWithTree(idMap, persistentIds, newContent, newIdElements)
                return {persistentIds, idMap}
            }

            function removeNode(ctx, node) {
                if (ctx.idMap.has(node)) {
                    moveBefore(ctx.pantry, node, null)
                } else {
                    node.remove()
                }
            }

            function matchesUpcomingSibling(ctx, oldElt, startNode) {
                if (ctx.futureMatches.has(oldElt)) return true
                for (let sibling = startNode.nextSibling, i = 0; sibling && i < api.config.morphScanLimit; sibling = sibling.nextSibling, i++) {
                    if (sibling instanceof Element && oldElt.isEqualNode(sibling)) {
                        ctx.futureMatches.add(oldElt)
                        return true
                    }
                }
                return false
            }

            function findBestMatch(ctx, node, startPoint, endPoint) {
                if (!(node instanceof Element)) return null
                let softMatch = null, displaceMatchCount = 0, scanLimit = api.config.morphScanLimit
                let newSet = ctx.idMap.get(node), nodeMatchCount = newSet?.size || 0
                if (node.id && !newSet) return null
                let cursor = startPoint
                while (cursor && cursor != endPoint) {
                    let oldSet = ctx.idMap.get(cursor)
                    if (isSoftMatch(cursor, node)) {
                        if (oldSet && newSet && [...oldSet].some(id => newSet.has(id))) return cursor
                        if (!oldSet) {
                            if (scanLimit > 0 && cursor.isEqualNode(node)) return cursor
                            if (!softMatch) softMatch = cursor
                        }
                    }
                    displaceMatchCount += oldSet?.size || 0
                    if (displaceMatchCount > nodeMatchCount) break
                    if (cursor.contains(document.activeElement)) break
                    if (--scanLimit < 1 && nodeMatchCount === 0) break
                    cursor = cursor.nextSibling
                }
                if (softMatch && matchesUpcomingSibling(ctx, softMatch, node)) return null
                return softMatch
            }

            function morphNode(oldNode, newNode, ctx) {
                if (api.config.morphSkip && oldNode.matches?.(api.config.morphSkip)) return
                if (api.emit(oldNode, 'htmx:before:morph:node', {oldNode, newNode}) === false) return
                copyAttributes(oldNode, newNode)
                if (oldNode instanceof HTMLTextAreaElement && oldNode.defaultValue != newNode.defaultValue) {
                    oldNode.value = newNode.value
                }
                let skipChildren = api.config.morphSkipChildren && oldNode.matches?.(api.config.morphSkipChildren)
                if (!skipChildren && (!oldNode.isEqualNode(newNode) || newNode.tagName === 'TEMPLATE' || newNode.querySelector?.('template'))) {
                    morphChildren(ctx, oldNode, newNode)
                }
            }

            function morphChildren(ctx, oldParent, newParent, insertionPoint = null, endPoint = null) {
                if (oldParent instanceof HTMLTemplateElement && newParent instanceof HTMLTemplateElement) {
                    oldParent = oldParent.content
                    newParent = newParent.content
                }
                insertionPoint ||= oldParent.firstChild

                for (const newChild of [...newParent.childNodes]) {
                    if (insertionPoint && insertionPoint != endPoint) {
                        let bestMatch = findBestMatch(ctx, newChild, insertionPoint, endPoint)
                        if (bestMatch) {
                            if (bestMatch !== insertionPoint) {
                                let cursor = insertionPoint
                                while (cursor && cursor !== bestMatch) {
                                    let tempNode = cursor
                                    cursor = cursor.nextSibling
                                    if (tempNode instanceof Element && (ctx.idMap.has(tempNode) || matchesUpcomingSibling(ctx, tempNode, newChild))) {
                                        moveBefore(oldParent, tempNode, endPoint)
                                    } else {
                                        removeNode(ctx, tempNode)
                                    }
                                }
                            }
                            morphNode(bestMatch, newChild, ctx)
                            insertionPoint = bestMatch.nextSibling
                            continue
                        }
                    }

                    if (newChild instanceof Element && ctx.persistentIds.has(newChild.id)) {
                        let target = (ctx.target.id === newChild.id && ctx.target) ||
                            ctx.target.querySelector(`[id="${newChild.id}"]`) ||
                            ctx.pantry.querySelector(`[id="${newChild.id}"]`)
                        let elementId = target.id
                        let element = target
                        while ((element = element.parentNode)) {
                            let idSet = ctx.idMap.get(element)
                            if (idSet) {
                                idSet.delete(elementId)
                                if (!idSet.size) ctx.idMap.delete(element)
                            }
                        }
                        moveBefore(oldParent, target, insertionPoint)
                        morphNode(target, newChild, ctx)
                        insertionPoint = target.nextSibling
                        continue
                    }

                    if (ctx.idMap.has(newChild)) {
                        let placeholder = document.createElement(newChild.tagName)
                        oldParent.insertBefore(placeholder, insertionPoint)
                        morphNode(placeholder, newChild, ctx)
                        insertionPoint = placeholder.nextSibling
                    } else {
                        oldParent.insertBefore(newChild, insertionPoint)
                        insertionPoint = newChild.nextSibling
                    }
                }

                while (insertionPoint && insertionPoint != endPoint) {
                    let tempNode = insertionPoint
                    insertionPoint = insertionPoint.nextSibling
                    removeNode(ctx, tempNode)
                }
            }

            // ── Main morph logic ──
            let {persistentIds, idMap} = createIdMaps(oldNode, fragment)
            let pantry = document.createElement('div')
            pantry.hidden = true
            document.body.after(pantry)
            let ctx = {target: oldNode, idMap, persistentIds, pantry, futureMatches: new WeakSet()}
            if (innerHTML) {
                morphChildren(ctx, oldNode, fragment)
            } else {
                morphChildren(ctx, oldNode.parentNode, fragment, oldNode, oldNode.nextSibling)
            }
            pantry.remove()
        },
    },
    on: {
        'htmx:boot': (detail, api) => { api.state._morphFn = api.morph },
        // Handle attribute-driven morph swaps (hx-swap="innerMorph"/"outerMorph")
        // The wrap handler catches programmatic calls where style is pre-set,
        // but for attribute-driven swaps the style is set by hx-swap during before:swap
        'htmx:before:swap': (detail, api) => {
            const style = detail.swap?.style
            if (style !== 'innerMorph' && style !== 'outerMorph') return
            detail.swap.execute = () => {
                let target = detail.swap.target
                if (typeof target === 'string') target = document.querySelector(target)
                target ??= detail.element || document.body
                let content = detail.swap.content
                if (typeof content === 'string') {
                    const template = document.createElement('template')
                    template.innerHTML = content
                    content = template.content
                }
                if (content instanceof DocumentFragment) {
                    api.state._morphFn(target, content, style === 'innerMorph')
                    htmx.init(target)
                }
            }
        },
    },
    wrap: {
        swap: (original, swap, options) => {
            const style = swap?.style
            if (style === 'innerMorph' || style === 'outerMorph') {
                let target = swap.target || options?.element
                if (typeof target === 'string') target = document.querySelector(target)
                if (!target) target = options?.element || document.body
                let content = swap.content
                if (typeof content === 'string') {
                    const template = document.createElement('template')
                    template.innerHTML = content
                    content = template.content
                }
                if (content instanceof DocumentFragment) {
                    htmx.state._morphFn(target, content, style === 'innerMorph')
                    htmx.init(target)
                    return
                }
            }
            return original(swap, options)
        },
    },
})
/**
 * Ergonomic htmx.swap(), htmx.ajax(), htmx.parse() wrappers.
 */
/**
 * Public API — ergonomic wrappers for programmatic htmx usage.
 */
htmx.install('public-api', {
    requires: ['swaps', 'ajax'],
    wrap: {
        on: (original, element, eventName, handler, options) => {
            if (typeof element === 'string' && typeof eventName === 'function') {
                return original(document, element, eventName, handler)
            }
            if (typeof element === 'string' && typeof eventName === 'string') {
                const target = document.querySelector(element)
                if (!target) return () => {}
                return original(target, eventName, handler, options)
            }
            return original(element, eventName, handler, options)
        },
    },
    on: {
        'htmx:boot': (detail, api) => {
            htmx.swap = (options) => {
                const {element, content, text, target, style, swap, ...modifiers} = options
                return api.swap(
                    {content: content || text, target, style: style || swap || null, ...modifiers},
                    {element: element || null},
                )
            }

            htmx.ajax = (methodOrOptions, url, options) => {
                let method, element, headers, body, target, swap, values, source, select, rest
                if (typeof methodOrOptions === 'string') {
                    method = methodOrOptions.toUpperCase()
                    if (typeof options === 'string') {
                        options = {target: options}
                    }
                    options = options || {}
                    ;({element, headers, body, target, swap, values, source, select, ...rest} = options)
                } else {
                    ;({method, url, element, headers, body, target, swap, values, source, select, ...rest} = methodOrOptions)
                    method = (method || 'GET').toUpperCase()
                }
                let sourceEl = null
                if (source) {
                    sourceEl = typeof source === 'string' ? document.querySelector(source) : source
                    if (!sourceEl) throw new Error('Source not found: ' + source)
                }
                let targetEl = null
                if (target) {
                    targetEl = typeof target === 'string' ? document.querySelector(target) : target
                    if (!targetEl) throw new Error('Target not found: ' + target)
                } else if (sourceEl) {
                    targetEl = sourceEl
                }
                const swapObj = typeof swap === 'string' ? {style: swap} : (swap || {})
                const ajaxElement = sourceEl || targetEl || document.body
                return api.ajax({
                    element: ajaxElement,
                    request: {
                        url,
                        method,
                        headers: headers || {},
                        body: body ?? null,
                        values: values || null,
                        ...rest,
                    },
                    swap: {style: null, target: targetEl || null, select: select || null, ...swapObj},
                })
            }
        }
    }
})
