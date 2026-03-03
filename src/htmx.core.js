// htmx 4.0 — Core Extensions
//
// Extension definitions ordered by importance. Installation order at the bottom.
//
// api is the last argument for event handlers only:
//   Event handlers: (detail, api) => { ... }
//   Wraps: (original, ...originalArgs) => { ... }  — no api, use htmx.* or closures


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
                    const {url, execute, values, source, ...fetchOptions} = detail.request
                    return await fetch(url, fetchOptions)
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
                detail.swap.execute()
                // If the element was removed from the DOM by the swap (e.g. outerHTML),
                // dispatch after:swap on document so listeners can still observe it
                const afterSwapTarget = emitOn?.isConnected ? emitOn : document
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


// ── hx-vals / hx-headers ─────────────────────────────────────────────────

/**
 * Merge JSON values from hx-vals into request body or URL query params.
 */
const hxVals = {
    config: {attributeFilter: ['hx-vals']},
    on: {
        'htmx:before:request': (detail, api) => {
            const valsAttr = api.attr(detail.element, 'hx-vals')
            if (!valsAttr) return

            let vals
            try { vals = JSON.parse(valsAttr) } catch { return }

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
}

/**
 * Merge JSON headers from hx-headers into request headers.
 */
const hxHeaders = {
    config: {attributeFilter: ['hx-headers']},
    on: {
        'htmx:before:request': (detail, api) => {
            const headersAttr = api.attr(detail.element, 'hx-headers')
            if (!headersAttr) return
            let headers
            try {
                // Try javascript: prefix first
                if (headersAttr.startsWith('javascript:')) {
                    let code = headersAttr.slice(11).trim()
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
}


// ── Response Headers ─────────────────────────────────────────────────────

/**
 * Process HX-* response headers (redirect, refresh, retarget, reswap, etc).
 */
const responseHeaders = {
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
}

/**
 * Skip swap for 204, 304 responses.
 */
const noSwap = {
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
}


// ── Fragment Parsing ─────────────────────────────────────────────────────

/**
 * Parse HTML responses into fragments, extracting title and body content.
 */
const fragmentParsing = {
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
}


// ── Form Data ───────────────────────────────────────────────────────────

/**
 * Form data collection — collect form values and inject into requests.
 */
const formData = {
    requires: ['ajax'],
    config: {attributeFilter: ['hx-include', 'hx-encoding']},
    on: {
        'htmx:before:request': (detail, api) => {
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
}

/** Add input values from an element and its descendants to formData */
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
            // Skip nested OOB/partial swaps (they have their own style)
            if (detail.swap?._oob) return
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
            // Skip nested OOB/partial swaps (they have their own target)
            if (detail.swap?._oob) return
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
                    const handler = (event) => {
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
            const boostSel = '[hx-boost],[hx-boost\\:inherited]'
            const containers = [
                ...(root.matches?.(boostSel) ? [root] : []),
                ...root.querySelectorAll(boostSel)
            ]
            for (const container of containers) {
                const boost = api.attr(container, 'hx-boost')
                if (!boost || boost === 'false') continue
                // Include the container itself if it's a boostable element (form/anchor)
                const boostable = [
                    ...(container.matches('a[href], form') ? [container] : []),
                    ...container.querySelectorAll('a[href], form'),
                ]
                for (const el of boostable) {
                    if (el._htmxBoosted) continue
                    el._htmxBoosted = true
                    const eventType = el.matches('a') ? 'click' : 'submit'
                    el.addEventListener(eventType, (evt) => {
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
                        const swap = api.attr(el, 'hx-swap') || null
                        const targetSel = api.attr(el, 'hx-target')
                        const target = targetSel ? api.find(targetSel, {from: el}) : null
                        api.ajax({
                            element: el,
                            request: {url, method, headers: {'HX-Boosted': 'true'}},
                            swap: {style: swap, target: target || null},
                        })
                    })
                }
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

            // Only wire a default trigger for elements that have a request action.
            // Elements with only inherited/config attrs (e.g. hx-boost:inherited)
            // should not get a click handler that calls preventDefault().
            const el = detail.element
            const hasAction = api.attr(el, 'hx-get') || api.attr(el, 'hx-post')
                || api.attr(el, 'hx-put') || api.attr(el, 'hx-patch')
                || api.attr(el, 'hx-delete') || api.attr(el, 'hx-trigger')
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


/**
 * Request queue — manages concurrent requests per-element.
 */
class RequestQueue {
    #current = null
    #queue = []

    issue(ctx, strategy) {
        ctx._queueStrategy = strategy
        if (!this.#current) {
            this.#current = ctx
            return true
        }

        if (strategy === 'replace' || (strategy !== 'abort' && this.#current._queueStrategy === 'abort')) {
            this.#queue.forEach(c => c._dropped = true)
            this.#queue = []
            if (this.#current._abort) this.#current._abort()
            this.#current = ctx
            return true
        } else if (strategy === 'queue all') {
            this.#queue.push(ctx)
        } else if (strategy === 'drop') {
            ctx._dropped = true
        } else if (strategy === 'queue last') {
            this.#queue.forEach(c => c._dropped = true)
            this.#queue = [ctx]
        } else if (this.#queue.length === 0 && strategy !== 'abort') {
            // default: queue first
            this.#queue.push(ctx)
        } else {
            ctx._dropped = true
        }
        return false
    }

    finish() { this.#current = null }
    next() { return this.#queue.shift() }
    hasMore() { return this.#queue.length > 0 }
}

const requestQueueExt = {
    requires: ['ajax'],
    config: {attributeFilter: ['hx-sync']},
    wrap: {
        ajax: (original, options) => {
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
        },
    }
}

/**
 * History management — push/replace URL on successful requests, handle popstate.
 */
const historyMgmt = {
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
                    if (api.emit(document.body, 'htmx:before:restore:history', {path, cacheMiss: true})) {
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
                api.emit(document.body, 'htmx:after:push:into:history', {path})
            } else {
                history.replaceState({htmx: true}, '', path)
                api.emit(document.body, 'htmx:after:replace:into:history', {path})
            }

            api.emit(document.body, 'htmx:after:history:update', historyDetail)
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
                    // When "this" is inherited from an ancestor, resolve it to a
                    // `closest` selector so api.find() targets the declaring element
                    // rather than the requesting element.
                    if (base === 'this') {
                        const attrName = ancestor.hasAttribute(inherited) ? inherited : name
                        chain.push(`closest [${CSS.escape(attrName)}="this"]`)
                    } else {
                        chain.push(base)
                    }
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


// ── hx-select ──────────────────────────────────────────────────────────

/**
 * Filter response content to only include elements matching the hx-select selector.
 */
const hxSelect = {
    requires: ['swaps'],
    config: {attributeFilter: ['hx-select']},
    on: {
        'htmx:before:swap': (detail, api) => {
            // Skip nested (OOB/partial) swaps
            if (detail.swap?._oob) return
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
}


/**
 * Parse an hx-swap-oob attribute value into { style, target, swap, ... }.
 * Supports:
 *   "true" → { style: 'outerHTML' }
 *   "innerHTML" → { style: 'innerHTML' }
 *   "innerHTML:#selector" → legacy format { style: 'innerHTML', target: '#selector' }
 *   "innerHTML target:#sel swap:100ms" → new format with modifiers
 *   'innerHTML target:".foo .bar"' → quoted multi-word selector
 */
function parseSwapOobValue(value) {
    const result = {style: 'outerHTML', target: null, swap: null}
    if (!value || value === 'true') return result

    // Tokenize respecting quoted strings
    const tokens = []
    let current = ''
    let inQuote = null
    for (let i = 0; i < value.length; i++) {
        const ch = value[i]
        if (inQuote) {
            if (ch === inQuote) {
                inQuote = null
            } else {
                current += ch
            }
        } else if (ch === '"' || ch === "'") {
            inQuote = ch
        } else if (/\s/.test(ch)) {
            if (current) { tokens.push(current); current = '' }
        } else {
            current += ch
        }
    }
    if (current) tokens.push(current)
    if (!tokens.length) return result

    // First token: swapStyle or swapStyle:targetSelector (legacy)
    const firstPart = tokens[0]
    const colonIdx = firstPart.indexOf(':')
    if (colonIdx > 0) {
        result.style = firstPart.slice(0, colonIdx)
        const sel = firstPart.slice(colonIdx + 1)
        if (sel) result.target = sel
    } else {
        result.style = firstPart
    }

    // Remaining tokens: key:value modifiers
    for (let i = 1; i < tokens.length; i++) {
        const modColonIdx = tokens[i].indexOf(':')
        if (modColonIdx > 0) {
            const key = tokens[i].slice(0, modColonIdx)
            const val = tokens[i].slice(modColonIdx + 1)
            if (key === 'target') result.target = val
            else if (key === 'swap') result.swap = val
            else result[key] = val === 'true' ? true : val === 'false' ? false : val
        }
    }

    return result
}

// ── OOB Swap ───────────────────────────────────────────────────────────

/**
 * Processes out-of-band swaps from response content.
 * Handles hx-swap-oob attributes on response elements and hx-select-oob on triggers.
 */
const oobSwap = {
    requires: ['swaps'],
    config: {attributeFilter: ['hx-select-oob']},
    on: {
        'htmx:before:swap': (detail, api) => {
            const content = detail.swap?.content
            if (!(content instanceof DocumentFragment)) return
            // Skip nested OOB/partial swaps
            if (detail.swap?._oob) return

            // Process hx-select-oob from the triggering element
            const selectOOB = detail.element ? api.attr(detail.element, 'hx-select-oob') : null
            if (selectOOB) {
                // Split on commas but not inside CSS escape sequences
                // Each spec can be:
                //   #selector                          → outerHTML swap to matching element by id
                //   #selector:swapStyle                → specific swap style
                //   #selector:swapStyle:#target        → legacy format: swap style + target selector
                //   #selector:swapStyle modifiers      → new format with space-separated modifiers like target:#x strip:false
                for (const spec of selectOOB.split(',')) {
                    const trimmed = spec.trim()
                    if (!trimmed) continue

                    let selector, swapStyle = 'outerHTML', targetSelector = null, modifiers = {}

                    // Check if there's a space (new format with modifiers)
                    const spaceIdx = trimmed.indexOf(' ')
                    if (spaceIdx > 0) {
                        // Parse: selector:swapStyle modifier1 modifier2...
                        const selectorPart = trimmed.slice(0, spaceIdx)
                        const modifiersPart = trimmed.slice(spaceIdx + 1)

                        // Split selector part on first colon (respecting CSS escapes)
                        const colonMatch = selectorPart.match(/^((?:[^:\\]|\\.)*)(?::(.*))?$/)
                        if (colonMatch) {
                            selector = colonMatch[1]
                            if (colonMatch[2]) swapStyle = colonMatch[2]
                        } else {
                            selector = selectorPart
                        }

                        // Parse space-separated modifiers
                        for (const mod of modifiersPart.split(/\s+/)) {
                            const colonIdx = mod.indexOf(':')
                            if (colonIdx > 0) {
                                const key = mod.slice(0, colonIdx)
                                let val = mod.slice(colonIdx + 1)
                                if (val === 'true') val = true
                                else if (val === 'false') val = false
                                if (key === 'target') targetSelector = val
                                else modifiers[key] = val
                            } else {
                                modifiers[mod] = true
                            }
                        }
                    } else {
                        // No spaces — could be simple selector, selector:style, or selector:style:target (legacy)
                        // Split on colons, respecting CSS escapes (backslash-colon)
                        const parts = []
                        let current = ''
                        for (let i = 0; i < trimmed.length; i++) {
                            if (trimmed[i] === '\\' && i + 1 < trimmed.length) {
                                current += trimmed[i] + trimmed[i + 1]
                                i++
                            } else if (trimmed[i] === ':') {
                                parts.push(current)
                                current = ''
                            } else {
                                current += trimmed[i]
                            }
                        }
                        parts.push(current)

                        selector = parts[0]
                        if (parts.length > 1 && parts[1]) swapStyle = parts[1]
                        if (parts.length > 2 && parts[2]) targetSelector = parts[2]
                    }

                    if (!selector) continue

                    // Find matching elements in the response fragment
                    for (const el of [...content.querySelectorAll(selector)]) {
                        // Determine target: explicit target selector, or match by id in the document
                        let target
                        if (targetSelector) {
                            target = document.querySelector(targetSelector)
                        } else {
                            target = el.id ? document.getElementById(el.id) : null
                        }
                        if (!target) continue

                        const frag = document.createDocumentFragment()
                        frag.appendChild(el)
                        const swapOpts = {content: frag, style: swapStyle, target, _oob: true, ...modifiers}
                        // Default strip:true for non-outerHTML OOB swaps
                        if (swapOpts.strip === undefined && swapStyle !== 'outerHTML') swapOpts.strip = true
                        api.swap(swapOpts, {element: detail.element})
                    }
                }
            }

            // Process elements with hx-swap-oob attribute
            const oobElts = [...content.querySelectorAll('[hx-swap-oob]')]
            for (const oobElt of oobElts) {
                // Remove from main content first
                oobElt.parentNode?.removeChild(oobElt)
                let oobValue = oobElt.getAttribute('hx-swap-oob')
                oobElt.removeAttribute('hx-swap-oob')

                let target = oobElt.id ? document.getElementById(oobElt.id) : null
                let swapStyle = 'outerHTML'

                if (oobValue && oobValue !== 'true') {
                    const parsed = parseSwapOobValue(oobValue)
                    swapStyle = parsed.style
                    if (parsed.target) target = document.querySelector(parsed.target)

                    if (parsed.swap) {
                        const delay = htmx.parseInterval?.(parsed.swap) ?? parseInt(parsed.swap, 10)
                        if (delay > 0) {
                            const delayedTarget = target
                            const delayedStyle = swapStyle
                            const delayedOobElt = oobElt
                            setTimeout(() => {
                                const frag = document.createDocumentFragment()
                                frag.appendChild(delayedOobElt)
                                api.swap({content: frag, style: delayedStyle, target: delayedTarget, _oob: true}, {element: detail.element})
                            }, delay)
                            target = null // skip immediate swap
                        }
                    }
                }

                if (!target) continue
                const frag = document.createDocumentFragment()
                frag.appendChild(oobElt)
                // Extract extra modifiers from parsed (exclude style/target/swap which are handled above)
                const {style: _s, target: _t, swap: _sw, ...oobModifiers} = (oobValue && oobValue !== 'true')
                    ? parseSwapOobValue(oobValue) : {}
                const swapOpts = {content: frag, style: swapStyle, target, _oob: true, ...oobModifiers}
                // Default strip:true for non-outerHTML OOB swaps
                if (swapOpts.strip === undefined && swapStyle !== 'outerHTML') swapOpts.strip = true
                api.swap(swapOpts, {element: detail.element})
            }

            // Process hx-partial elements (converted to <template hx type="partial"> by makeFragment)
            const partialElts = [...content.querySelectorAll('template[hx][type="partial"]')]
            for (const partial of partialElts) {
                partial.parentNode?.removeChild(partial)
                const targetSel = partial.getAttribute('hx-target')
                const swapStyleAttr = partial.getAttribute('hx-swap')
                const partialTarget = targetSel ? document.querySelector(targetSel) : null
                if (!partialTarget) continue
                // Template elements store children in .content
                const partialFrag = partial.content || document.createDocumentFragment()
                api.swap(
                    {content: partialFrag, style: swapStyleAttr || 'innerHTML', target: partialTarget, _oob: true},
                    {element: detail.element}
                )
            }

            // If all content was extracted as OOB/partials, skip the main swap
            if (content.childNodes.length === 0 && (oobElts.length > 0 || partialElts.length > 0)) {
                detail.swap.style = 'none'
            }
        },
    }
}


// ── Script Processing ──────────────────────────────────────────────────

/**
 * Re-creates script tags in swapped content to trigger execution.
 */
const scriptProcessing = {
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
}


// ── hx-confirm ─────────────────────────────────────────────────────────

/**
 * Show confirmation dialog before trigger, with full event protocol:
 * - htmx:config:request fires first (ctx.confirm can be modified/nullified)
 * - htmx:confirm fires with detail.ctx and detail.issueRequest
 * - Supports js: prefix for custom evaluation
 * - Supports async custom confirmation UI via issueRequest callback
 */
const hxConfirm = {
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
            const issueRequest = (confirmed) => {
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
}


// ── hx-indicator ───────────────────────────────────────────────────────

/**
 * Manages loading indicator CSS classes with reference counting.
 */
const hxIndicator = {
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
}


// ── hx-disable ─────────────────────────────────────────────────────────

/**
 * Disables elements during request with reference counting.
 * Disabling is synchronous (htmx:before:request); re-enabling is async (htmx:finally).
 */
const hxDisable = {
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
}


// ── hx-on:* ────────────────────────────────────────────────────────────

/**
 * Wire up inline JavaScript event handlers from hx-on:eventName attributes.
 */
const hxOn = {
    on: {
        'htmx:before:init': (detail, api) => {
            const el = detail.element
            const handlers = []
            for (const attrName of el.getAttributeNames()) {
                if (!attrName.startsWith('hx-on:') && !attrName.startsWith('hx-on-')) continue
                const eventName = attrName.startsWith('hx-on:')
                    ? attrName.slice(6).replace(/-/g, ':')
                    : attrName.slice(6).replace(/-/g, ':')
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
}


// ── hx-preserve ────────────────────────────────────────────────────────

/**
 * Preserves elements across swaps by saving and restoring them.
 */
const hxPreserve = {
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
}


// ── hx-ignore ──────────────────────────────────────────────────────────

/**
 * Prevents processing of elements within hx-ignore containers.
 */
const hxIgnore = {
    on: {
        'htmx:before:init': (detail, api) => {
            if (detail.element.closest('[hx-ignore]')) return false
        },
    }
}


// ── Config ─────────────────────────────────────────────────────────────

/**
 * Default configuration values for htmx core.
 */
const defaultConfig = {
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
}

/**
 * Reads <meta name="htmx-config"> and merges its JSON content into config.
 */
const metaConfig = {
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
}

/**
 * Wraps attr() to support a configurable attribute name prefix (e.g. "data-hx-" instead of "hx-").
 */
const prefix = {
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
}

/**
 * Wraps attr() to replace ":" in attribute names with a configurable meta character.
 */
const metaCharacter = {
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
}

// ── Morph ─────────────────────────────────────────────────────────────

/**
 * DOM morphing algorithm — intelligently patches existing DOM nodes to match
 * new content while preserving element identity, focus state, and animations.
 */
let _morphFn = null // Closure reference for morph wrap to call the defined morph function
const morph = {
    config: {
        morphScanLimit: 10,
        morphIgnore: ['data-htmx-powered'],
        morphSkip: null,
        morphSkipChildren: null,
    },
    define: {
        morph: (api) => { const fn = function morph(oldNode, fragment, innerHTML) {
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
        }; _morphFn = fn; return fn },
    },
    wrap: {
        swap: (originalSwap, swapObj, options) => {
            const style = swapObj?.style
            if (style === 'innerMorph' || style === 'outerMorph') {
                let target = swapObj.target || options?.element
                if (typeof target === 'string') target = document.querySelector(target)
                if (!target) target = options?.element || document.body
                let content = swapObj.content
                if (typeof content === 'string') {
                    const template = document.createElement('template')
                    template.innerHTML = content
                    content = template.content
                }
                if (content instanceof DocumentFragment) {
                    _morphFn(target, content, style === 'innerMorph')
                    htmx.init(target)
                    return
                }
            }
            return originalSwap(swapObj, options)
        },
    },
}


// ── Public API ──────────────────────────────────────────────────────────

/**
 * Ergonomic htmx.swap(), htmx.ajax(), htmx.parse() wrappers.
 */
const publicApi = {
    requires: ['swaps', 'ajax'],
    wrap: {
        // on() — flexible public signature:
        //   on(eventName, handler)          → listen on document
        //   on('#sel', eventName, handler)  → listen on querySelector result
        //   on(element, eventName, handler)  → listen on element (passthrough)
        on: (original, element, eventName, handler, options) => {
            if (typeof element === 'string' && typeof eventName === 'function') {
                // on(eventName, handler)
                return original(document, element, eventName, handler)
            }
            if (typeof element === 'string' && typeof eventName === 'string') {
                // on('#selector', eventName, handler)
                const el = document.querySelector(element)
                if (!el) return () => {}
                return original(el, eventName, handler, options)
            }
            return original(element, eventName, handler, options)
        },
    },
    on: {
        'htmx:boot': (detail, api) => {
            // Aliases
            htmx.process = htmx.init
            // trigger(element, eventName, detail, bubbles) — enhanced emit
            // Supports: string selectors, optional bubbles param (4th arg)
            htmx.trigger = (elementOrSelector, eventName, detail, bubbles) => {
                let element = elementOrSelector
                if (typeof element === 'string') {
                    element = document.querySelector(element)
                    if (!element) return true
                }
                if (bubbles === false) {
                    // Dispatch directly without bubbling, bypass emit which always bubbles
                    const dispatchTarget = element?.isConnected ? element : document
                    return dispatchTarget.dispatchEvent(
                        new CustomEvent(eventName, {
                            detail: detail || {},
                            bubbles: false,
                            cancelable: true,
                            composed: true,
                        }))
                }
                return api.emit(element, eventName, detail || {})
            }
            // findAll(selector) or findAll(root, selector)
            htmx.findAll = (selectorOrRoot, selector) => {
                if (selector === undefined) {
                    return [...document.querySelectorAll(selectorOrRoot)]
                }
                const root = typeof selectorOrRoot === 'string'
                    ? document.querySelector(selectorOrRoot) : selectorOrRoot
                return root ? [...root.querySelectorAll(selector)] : []
            }

            // find override: support find(root, selector) two-arg form
            const _kernelFind = htmx.find
            htmx.find = (selectorOrRoot, selector) => {
                if (selector === undefined) {
                    return _kernelFind(selectorOrRoot)
                }
                const root = typeof selectorOrRoot === 'string'
                    ? document.querySelector(selectorOrRoot) : selectorOrRoot
                return root?.querySelector(selector) ?? null
            }

            // forEvent(name, timeout, target) — promise-based event waiting
            htmx.forEvent = (event, timeout = 200, target = document) => {
                return new Promise((resolve, reject) => {
                    const handler = (evt) => {
                        clearTimeout(timeoutId)
                        target.removeEventListener(event, handler)
                        resolve(evt)
                    }
                    const timeoutId = timeout > 0 ? setTimeout(() => {
                        target.removeEventListener(event, handler)
                        resolve(null)
                    }, timeout) : null
                    target.addEventListener(event, handler)
                })
            }

            // timeout(ms) — promise-based delay, supports string format via parseInterval
            htmx.timeout = (ms) => {
                if (typeof ms === 'string') ms = htmx.parseInterval(ms)
                if (!ms || ms <= 0) return undefined
                return new Promise(r => setTimeout(r, ms))
            }

            // parseInterval(str) — "150" → 150, "2s" → 2000, "1m" → 60000
            htmx.parseInterval = (str) => {
                if (typeof str === 'number') return str
                if (!str) return undefined
                const m = str.match(/^(\d+\.?\d*)(ms|s|m)?$/)
                if (!m) return undefined
                const [, n, unit] = m
                return unit === 's' ? n * 1000 : unit === 'm' ? n * 60000 : +n
            }

            // onLoad(callback) — fires after walk:init
            htmx.onLoad = (callback) => {
                document.addEventListener('htmx:after:walk:init', (evt) => callback(evt.detail.element))
            }

            // takeClass(el, className, container)
            htmx.takeClass = (el, className, container = el.parentElement) => {
                for (const elt of container.querySelectorAll('.' + className)) elt.classList.remove(className)
                el.classList.add(className)
            }

            // defineExtension — old-style adapter
            htmx.defineExtension = (name, ext) => htmx.install(name, ext)

            // resolveTarget(elt, selector) — resolve a target element from a selector
            htmx.resolveTarget = (elt, selector) => {
                if (selector instanceof Element) return selector
                if (!selector) return elt
                return api.find(selector, {from: elt}) ?? elt
            }

            // findAllExt(eltOrSelector, maybeSelector) — extended selector find returning array
            htmx.findAllExt = (eltOrSelector, maybeSelector) => {
                let selector = maybeSelector ?? eltOrSelector
                let elt = maybeSelector
                    ? (typeof eltOrSelector === 'string' ? document.querySelector(eltOrSelector) : eltOrSelector)
                    : document

                if (typeof selector !== 'string') return []

                // Handle 'global' prefix
                let global = false
                if (selector.startsWith('global ')) {
                    global = true
                    selector = selector.slice(7)
                }

                // Hyperscript-style: protect commas inside <.../> from splitting
                let parts = selector.replace(/<[^>]+\/>/g, m => m.replace(/,/g, '\x00'))
                    .split(',').map(p => p.replace(/\x00/g, ','))

                let result = []
                let unprocessedParts = []

                for (let part of parts) {
                    part = part.trim()
                    // Strip hyperscript-style wrapper
                    if (part.startsWith('<') && part.endsWith('/>')) part = part.slice(1, -2)

                    let item
                    if (part === 'root') {
                        item = document
                    } else if (part === 'nextElementSibling') {
                        item = elt?.nextElementSibling
                    } else if (part === 'previousElementSibling') {
                        item = elt?.previousElementSibling
                    } else {
                        // Delegate to api.find for standard extended selectors
                        let found = api.find(part, {from: elt, multiple: true})
                        if (Array.isArray(found)) {
                            result.push(...found)
                        } else if (found) {
                            result.push(found)
                        }
                        continue
                    }

                    if (item) result.push(item)
                }

                return [...new Set(result)]
            }

            // swap(options) — public swap API
            // Accepts: {target, text|content, swap|style, element, ...modifiers}
            htmx.swap = (options) => {
                const {element, content, text, target, style, swap, ...modifiers} = options
                return api.swap(
                    {content: content || text, target, style: style || swap || null, ...modifiers},
                    {element: element || null},
                )
            }

            // ajax(method, url, options) or ajax(options)
            // 3-arg form: ajax('GET', '/url', {target, swap, values, headers, ...})
            // 3-arg form: ajax('GET', '/url', '#selector') — target shorthand
            // 1-arg form: ajax({method, url, target, swap, ...})
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
                // Resolve source element
                let sourceEl = null
                if (source) {
                    sourceEl = typeof source === 'string' ? document.querySelector(source) : source
                    if (!sourceEl) throw new Error('Source not found: ' + source)
                }
                // Resolve target
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
            htmx.parse = (text, options) => api.parse(text, options)

            // normalizeSwapStyle — maps shorthand swap names to insertAdjacentHTML positions
            htmx.normalizeSwapStyle = (style) => {
                const map = {before: 'beforebegin', after: 'afterend', prepend: 'afterbegin', append: 'beforeend'}
                return map[style] || style
            }

            // makeFragment — parses HTML string into a DocumentFragment
            htmx.makeFragment = (html) => api.makeFragment(html)

            // parseSwap — parses a swap specification string into an object
            htmx.parseSwap = (str) => {
                if (!str) return {style: htmx.config.defaultSwap}
                // Tokenize: match key:"quoted value", key:'quoted value', or bare words
                const tokens = []
                const re = /(\S+?):"([^"]*)"|(\S+?):'([^']*)'|(\S+)/g
                let m
                while ((m = re.exec(str.trim())) !== null) {
                    if (m[1] !== undefined) tokens.push(m[1] + ':' + m[2])
                    else if (m[3] !== undefined) tokens.push(m[3] + ':' + m[4])
                    else tokens.push(m[5])
                }
                if (!tokens.length) return {style: htmx.config.defaultSwap}
                const map = {before: 'beforebegin', after: 'afterend', prepend: 'afterbegin', append: 'beforeend'}
                // Check if first token has a colon (it's a modifier, not a style)
                let styleToken, startIdx
                if (tokens[0].includes(':')) {
                    styleToken = htmx.config.defaultSwap
                    startIdx = 0
                } else {
                    styleToken = tokens[0]
                    startIdx = 1
                }
                const result = {style: map[styleToken] || styleToken}
                for (let i = startIdx; i < tokens.length; i++) {
                    const colonIdx = tokens[i].indexOf(':')
                    if (colonIdx === -1) continue
                    const key = tokens[i].slice(0, colonIdx)
                    let value = tokens[i].slice(colonIdx + 1)
                    // Parse boolean values
                    if (value === 'true') value = true
                    else if (value === 'false') value = false
                    result[key] = value
                }
                return result
            }
            htmx.__parseSwap = htmx.parseSwap

            // parseTriggerSpecs — parses trigger specification strings
            htmx.parseTriggerSpecs = (str) => {
                if (!str || !str.trim()) return []
                const specs = []
                // Split on commas, but not inside brackets
                const parts = []
                let current = ''
                let depth = 0
                for (const ch of str) {
                    if (ch === '[') depth++
                    else if (ch === ']') depth--
                    if (ch === ',' && depth === 0) {
                        parts.push(current.trim())
                        current = ''
                    } else {
                        current += ch
                    }
                }
                if (current.trim()) parts.push(current.trim())

                for (const part of parts) {
                    if (!part) continue
                    const tokens = []
                    // Tokenize: split on whitespace but preserve bracket contents
                    let token = ''
                    let bd = 0
                    for (const ch of part) {
                        if (ch === '[') bd++
                        else if (ch === ']') bd--
                        if (/\s/.test(ch) && bd === 0) {
                            if (token) tokens.push(token)
                            token = ''
                        } else {
                            token += ch
                        }
                    }
                    if (token) tokens.push(token)
                    if (tokens.length === 0) continue

                    // Check for unterminated bracket
                    const full = tokens.join(' ')
                    const openCount = (full.match(/\[/g) || []).length
                    const closeCount = (full.match(/\]/g) || []).length
                    if (openCount !== closeCount) throw new Error('Unterminated filter in trigger spec: ' + part)

                    // First token is the event name (may include filter like click[ctrlKey])
                    const spec = {name: tokens[0]}
                    for (let i = 1; i < tokens.length; i++) {
                        const t = tokens[i]
                        if (t.includes(':')) {
                            const [key, ...rest] = t.split(':')
                            spec[key] = rest.join(':')
                        } else {
                            spec[t] = true
                        }
                    }
                    specs.push(spec)
                }
                return specs
            }

            // extractFilter — extracts event filter from bracket notation
            htmx.extractFilter = (str) => {
                if (!str) return [str, null]
                const openIdx = str.indexOf('[')
                if (openIdx === -1) return [str, null]
                const closeIdx = str.indexOf(']', openIdx)
                if (closeIdx === -1) return [str, null]
                return [str.slice(0, openIdx), str.slice(openIdx + 1, closeIdx)]
            }

            // selectAll — querySelectorAll that also includes the root if it matches
            htmx.selectAll = (elt, selector) => {
                const results = []
                if (elt.matches && elt.matches(selector)) results.push(elt)
                results.push(...elt.querySelectorAll(selector))
                return results
            }
        }
    }
}


// ── hx-action ──────────────────────────────────────────────────────────

/**
 * hx-action attribute — auto-detects HTTP method from element type.
 * GET for links/buttons, POST for forms, or from hx-config method override.
 */
const hxAction = {
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
                el.addEventListener(eventType, (evt) => {
                    evt.preventDefault()
                    api.ajax({element: el, request: {url, method}})
                })
            }
        },
    }
}


// ── hx-config ──────────────────────────────────────────────────────────

/**
 * hx-config attribute — per-element configuration overrides merged into request context.
 * Supports JSON values with optional + prefix for merging object properties.
 */
const hxConfig = {
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
                    detail.request.shouldActivate = val
                } else if (key === 'method') {
                    detail.request.method = val
                } else if (merge && val && typeof val === 'object' && !Array.isArray(val)
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
}


// ── hx-status:NNN ──────────────────────────────────────────────────────

/**
 * hx-status:NNN attribute — per-status-code swap overrides.
 * Supports exact matches (hx-status:404), 2-digit wildcards (hx-status:50x),
 * and 1-digit wildcards (hx-status:5xx).
 */
const hxStatus = {
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
}


// ── strip modifier ─────────────────────────────────────────────────────

/**
 * strip:true swap modifier — extracts children from top-level wrapper elements.
 * For each top-level element child in the content fragment, replaces it with its children.
 */
const stripModifier = {
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
}


// ── hx-validate ─────────────────────────────────────────────────────────

/**
 * Form validation — check form validity before issuing a request.
 * When hx-validate="true", the enclosing form must pass checkValidity()
 * and reportValidity() before the request proceeds.
 */
const hxValidate = {
    requires: ['ajax'],
    config: {attributeFilter: ['hx-validate']},
    on: {
        'htmx:before:request': (detail, api) => {
            const el = detail.element
            if (!el) return
            const validate = api.attr(el, 'hx-validate')
            if (validate === 'false') return
            if (!validate) return

            const form = el.closest?.('form')
            if (!form) return

            if (!form.checkValidity()) {
                form.reportValidity()
                return false // cancel the request
            }
        },
    }
}


// ── Swap Modifiers ─────────────────────────────────────────────────────

/**
 * Handles scroll and delay modifiers on swap specifications.
 */
const swapModifiers = {
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
}


// ── Installation ────────────────────────────────────────────────────────
// Order matters: dependencies must be installed before dependents.

htmx.install('parser', parser)
htmx.install('default-config', defaultConfig)
htmx.install('meta-config', metaConfig)
htmx.install('prefix', prefix)
htmx.install('meta-character', metaCharacter)
htmx.install('fragment-parsing', fragmentParsing)
htmx.install('swaps', swaps)
htmx.install('extended-selectors', extendedSelectors)
htmx.install('inheritance', inheritance)
htmx.install('delay-events', delayEvents)
htmx.install('throttle-events', throttleEvents)
htmx.install('ajax', ajax)
htmx.install('default-trigger', defaultTrigger)
htmx.install('default-swap', defaultSwap)
htmx.install('default-headers', defaultHeaders)
htmx.install('form-data', formData)
htmx.install('hx-validate', hxValidate)
htmx.install('hx-vals', hxVals)
htmx.install('hx-headers', hxHeaders)
htmx.install('response-headers', responseHeaders)
htmx.install('no-swap', noSwap)
htmx.install('hx-confirm', hxConfirm)
htmx.install('hx-trigger', hxTrigger)
htmx.install('hx-get', hxGet)
htmx.install('hx-post', hxPost)
htmx.install('hx-put', hxPut)
htmx.install('hx-patch', hxPatch)
htmx.install('hx-delete', hxDelete)
htmx.install('hx-swap', hxSwap)
htmx.install('swap-modifiers', swapModifiers)
htmx.install('hx-target', hxTarget)
htmx.install('swap-aliases', swapAliases)
htmx.install('request-timeout', requestTimeout)
htmx.install('request-queue', requestQueueExt)
htmx.install('oob-swap', oobSwap)
htmx.install('hx-select', hxSelect)
htmx.install('script-processing', scriptProcessing)
htmx.install('hx-indicator', hxIndicator)
htmx.install('hx-disable', hxDisable)
htmx.install('hx-on', hxOn)
htmx.install('hx-preserve', hxPreserve)
htmx.install('hx-ignore', hxIgnore)
htmx.install('hx-boost', hxBoost)
htmx.install('hx-action', hxAction)
htmx.install('hx-config', hxConfig)
htmx.install('hx-status', hxStatus)
htmx.install('strip-modifier', stripModifier)
htmx.install('history', historyMgmt)
htmx.install('morph', morph)
htmx.install('public-api', publicApi)
