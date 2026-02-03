// htmx 4.0-beta — Kernel Draft
// Based on REFACTOR.md architecture. Events-only extension system.

var htmx = (function () {
    'use strict'

    // ─── CONFIG ──────────────────────────────────────────────────────────────

    const config = {
        request: {
            credentials: 'same-origin',
            mode: 'same-origin',
            timeout: 60000,
            headers: { 'HX-Request': 'true' },
        },
        swap: {
            method: 'innerHTML',
            target: 'this',
        },
        syntax: {
            prefix: 'hx-',
            delimiter: ':',
        },
        debug: false,
    }

    // ─── STATE (WeakMap) ─────────────────────────────────────────────────────

    const _elementState = new WeakMap()

    // Auto-vivifying state proxy for extensions
    function getOrCreateState(element) {
        let state = _elementState.get(element)
        if (!state) {
            state = new Proxy({}, {
                get(target, prop) {
                    if (!(prop in target)) target[prop] = {}
                    return target[prop]
                }
            })
            _elementState.set(element, state)
        }
        return state
    }

    // Internal state (listeners, controller)
    // Extensions manage their own state via element.state.{extensionName}
    const _internalState = new WeakMap()

    function getInternalState(element) {
        let state = _internalState.get(element)
        if (!state) {
            state = {
                listeners: [],      // [{ event, handler }] - for cleanup
                controller: null,   // Current AbortController for in-flight request
            }
            _internalState.set(element, state)
        }
        return state
    }

    // ─── EXTENSIONS ──────────────────────────────────────────────────────────

    const extensions = []
    let initialized = false

    function register(name, extension) {
        if (extensions.find(e => e.name === name)) {
            throw new Error(`htmx: Extension "${name}" already registered`)
        }

        for (const dep of extension.requires || []) {
            if (!extensions.find(e => e.name === dep)) {
                throw new Error(`htmx: Extension "${name}" requires "${dep}" which is not registered`)
            }
        }

        extensions.push({ name, ...extension })

        // Late registration: fire htmx:ready handler immediately
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
                if (prop === 'find') return (selector) => wrap(target.querySelector(selector))
                if (prop === 'findAll') return (selector) => [...target.querySelectorAll(selector)].map(wrap)
                if (prop === 'emit') return (eventName, detail) => emit(target, eventName, detail)
                if (prop === 'state') return getOrCreateState(target)

                const value = target[prop]
                return typeof value === 'function' ? value.bind(target) : value
            }
        })
    }

    // Static equivalents
    function attr(element, canonicalName, { inherit = true } = {}) {
        const { prefix, delimiter } = config.syntax
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
        const el = element.querySelector(selector)
        return el ? wrap(el) : null
    }

    function findAll(element, selector) {
        return [...element.querySelectorAll(selector)].map(wrap)
    }

    function state(element) {
        return getOrCreateState(element)
    }

    // ─── EVENT EMISSION ──────────────────────────────────────────────────────

    async function emit(element, eventName, detail = {}) {
        // 1. Call registered extension handlers first
        for (const ext of extensions) {
            const handler = ext.on?.[eventName]
            if (handler) {
                const result = await handler(detail)
                if (config.debug) {
                    console.log(`[${eventName}] [${ext.name}]`, result === false ? 'CANCEL' : 'ok')
                }
                if (result === false) return false
            }
        }

        // 2. Dispatch DOM event
        const target = element?.isConnected !== false ? element : document
        return target.dispatchEvent(new CustomEvent(eventName, {
            detail,
            bubbles: true,
            cancelable: true,
            composed: true,
        }))
    }

    // ─── TARGET RESOLUTION ───────────────────────────────────────────────────

    function resolveTarget(element, selector) {
        if (!selector || selector === 'this') return element
        if (selector === 'body') return document.body
        if (selector.startsWith('closest ')) return element.closest(selector.slice(8))
        if (selector.startsWith('find ')) return element.querySelector(selector.slice(5))
        return document.querySelector(selector)
    }

    // ─── FRAGMENT PARSING ────────────────────────────────────────────────────

    function makeFragment(html) {
        const template = document.createElement('template')
        template.innerHTML = html
        return template.content
    }

    // ─── DOM PROCESSING ──────────────────────────────────────────────────────

    function init(root = document.body) {
        const methods = ['get', 'post', 'put', 'patch', 'delete']
        const { prefix } = config.syntax
        const selector = methods.map(m => `[${prefix}${m}]`).join(',')

        const elements = root.matches?.(selector)
            ? [root, ...root.querySelectorAll(selector)]
            : root.querySelectorAll(selector)

        for (const element of elements) {
            if (element.hasAttribute('data-htmx-initialized')) continue
            element.toggleAttribute('data-htmx-initialized', true)

            // Fire htmx:init for this element
            emit(wrap(element), 'htmx:init', {
                element: wrap(element),
                root: wrap(root),
            })

            // JIT: Set up trigger listener, read attributes at trigger time
            const rawTrigger = attr(element, 'hx-trigger')
            const eventName = rawTrigger ? rawTrigger.trim().split(/[\s,]/)[0] : 'click'

            const handler = async (event) => {
                event.preventDefault()

                // JIT attribute reading
                let method, url
                for (const m of methods) {
                    url = attr(element, `hx-${m}`, { inherit: false })
                    if (url) {
                        method = m.toUpperCase()
                        break
                    }
                }
                if (!url) return

                const swapMethod = attr(element, 'hx-swap')?.split(/\s/)[0] || config.swap.method
                const targetSelector = attr(element, 'hx-target') || config.swap.target

                await fetch(url, {
                    method,
                    trigger: { element: wrap(element), event },
                    swap: { method: swapMethod, target: targetSelector },
                })
            }

            element.addEventListener(eventName, handler)
            getInternalState(element).listeners.push({ event: eventName, handler })
        }
    }

    function cleanup(element) {
        if (!element.hasAttribute('data-htmx-initialized')) return

        emit(wrap(element), 'htmx:cleanup', { element: wrap(element) })

        const internal = getInternalState(element)
        for (const { event, handler } of internal.listeners) {
            element.removeEventListener(event, handler)
        }
        if (internal.controller) internal.controller.abort()

        element.removeAttribute('data-htmx-initialized')
        _internalState.delete(element)
        _elementState.delete(element)
    }

    // ─── FETCH ───────────────────────────────────────────────────────────────

    async function fetch(url, options = {}) {
        const triggerElement = options.trigger?.element || wrap(document.body)

        const detail = {
            trigger: {
                element: triggerElement,
                event: options.trigger?.event ?? null,
            },
            request: {
                url,
                method: options.method || 'GET',
                headers: { ...config.request.headers, ...options.headers },
                body: options.body ?? null,
            },
            response: null,
            swap: null,
            error: null,
        }

        try {
            // htmx:trigger
            emit(triggerElement, 'htmx:trigger', detail)

            // htmx:request (cancellable)
            if (await emit(triggerElement, 'htmx:request', detail) === false) return

            // Perform fetch
            const response = await window.fetch(detail.request.url, {
                method: detail.request.method,
                headers: detail.request.headers,
                body: detail.request.body,
                credentials: config.request.credentials,
                mode: config.request.mode,
            })

            detail.response = {
                status: response.status,
                url: response.url,
                headers: Object.fromEntries(response.headers),
                text: await response.text(),
            }

            // htmx:response (cancellable)
            if (await emit(triggerElement, 'htmx:response', detail) === false) return

            // Resolve target and prepare swap
            const targetSelector = options.swap?.target || config.swap.target
            const target = resolveTarget(triggerElement.native, targetSelector)

            if (!target) {
                detail.error = { type: 'target', message: `Target not found: ${targetSelector}` }
                await emit(triggerElement, 'htmx:error', detail)
                return
            }

            const fragment = makeFragment(detail.response.text)
            detail.swap = {
                content: fragment,
                target: wrap(target),
                method: options.swap?.method || config.swap.method,
            }

            // htmx:swap (cancellable)
            if (await emit(triggerElement, 'htmx:swap', detail) === false) return

            // Perform swap
            performSwap(target, detail.swap.method, fragment)

            // Initialize new content
            init(target)

            // htmx:settle
            await emit(triggerElement, 'htmx:settle', detail)

            return detail.response

        } catch (error) {
            detail.error = {
                type: error.name === 'AbortError' ? 'abort' : 'network',
                message: error.message,
                cause: error,
            }
            await emit(triggerElement, 'htmx:error', detail)

        } finally {
            // htmx:done (always fires)
            await emit(triggerElement, 'htmx:done', detail)
        }
    }

    function performSwap(target, method, fragment) {
        switch (method) {
            case 'innerHTML':
                target.replaceChildren(fragment)
                break
            case 'outerHTML':
                target.replaceWith(fragment)
                break
            case 'beforebegin':
                target.before(fragment)
                break
            case 'afterbegin':
                target.prepend(fragment)
                break
            case 'beforeend':
                target.append(fragment)
                break
            case 'afterend':
                target.after(fragment)
                break
            case 'delete':
                target.remove()
                break
            case 'none':
                break
            default:
                target.replaceChildren(fragment)
        }
    }

    // ─── DOM OBSERVER ────────────────────────────────────────────────────────

    function observeDOM() {
        new MutationObserver((mutations) => {
            for (const mutation of mutations) {
                for (const node of mutation.addedNodes) {
                    if (node.nodeType === 1) init(node)
                }
                for (const node of mutation.removedNodes) {
                    if (node.nodeType === 1) {
                        if (node.hasAttribute('data-htmx-initialized')) cleanup(node)
                        for (const el of node.querySelectorAll('[data-htmx-initialized]')) {
                            cleanup(el)
                        }
                    }
                }
            }
        }).observe(document.body, { childList: true, subtree: true })
    }

    // ─── BUILT-IN EXTENSIONS ─────────────────────────────────────────────────
    // Core htmx behaviors implemented as extensions. Dogfoods the extension system.

    // -- Init Phase --

    register('defaultTriggers', {
        on: {
            'htmx:ready': () => {
                config.defaultTriggers = {
                    'form': 'submit',
                    'input:not([type=button])': 'change',
                    'select': 'change',
                    'textarea': 'change',
                    ...config.defaultTriggers,
                }
            },
            'htmx:init': ({ element }) => {
                // TODO: Assign default trigger event based on element type
                // Skip if explicit hx-trigger present
            },
        },
    })

    register('hx-boost', {
        on: {
            'htmx:init': ({ element }) => {
                // TODO: If hx-boost="true", intercept links/forms and add htmx behavior
            },
        },
    })

    register('hx-on', {
        on: {
            'htmx:init': ({ element }) => {
                // TODO: Find hx-on:* attributes, bind event handlers
                // e.g. hx-on:click="doSomething()" -> element.addEventListener('click', ...)
                // Support hx-on::request shorthand for htmx:request
            },
            'htmx:cleanup': ({ element }) => {
                // TODO: Remove hx-on:* event handlers
            },
        },
    })

    // -- Trigger Phase --

    register('triggerModifiers', {
        on: {
            'htmx:init': ({ element }) => {
                // TODO: Parse hx-trigger modifiers: delay, throttle, once, changed, from, target, consume
                // Set up appropriate event handling (setTimeout, flags, alternate targets)
                // Store intervals/timeouts in element.state.triggerModifiers for cleanup
            },
            'htmx:cleanup': ({ element }) => {
                // TODO: Clear any pending timeouts/intervals
            },
        },
    })

    register('intersect', {
        on: {
            'htmx:init': ({ element }) => {
                const trigger = element.attr('hx-trigger')
                if (trigger?.includes('intersect') || trigger?.includes('revealed')) {
                    // TODO: Create IntersectionObserver with root/threshold from trigger spec
                    // Store observer in element.state.intersect for cleanup
                    // Fire request when intersection condition met
                }
            },
            'htmx:cleanup': ({ element }) => {
                // TODO: Disconnect IntersectionObserver
            },
        },
    })

    register('polling', {
        on: {
            'htmx:init': ({ element }) => {
                const trigger = element.attr('hx-trigger')
                if (trigger?.startsWith('every ')) {
                    // TODO: Parse interval (e.g., "every 2s")
                    // Set up setInterval, store ID in element.state.polling
                }
            },
            'htmx:cleanup': ({ element }) => {
                // TODO: clearInterval
            },
        },
    })

    register('load', {
        on: {
            'htmx:init': ({ element }) => {
                const trigger = element.attr('hx-trigger')
                if (trigger === 'load') {
                    // TODO: Immediately queue/fire the request
                    // Respect delay modifier if present
                }
            },
        },
    })

    register('eventFilter', {
        on: {
            'htmx:trigger': ({ trigger }) => {
                // TODO: Check for [expr] filter in hx-trigger
                // e.g., hx-trigger="keyup[key=='Enter']"
                // Evaluate expression against trigger.event
                // Return false if filter doesn't match
            },
        },
    })

    // -- Request Phase --

    register('hx-confirm', {
        on: {
            'htmx:request': async ({ trigger }) => {
                const message = trigger.element.attr('hx-confirm')
                if (message) {
                    // TODO: Support custom confirm dialog via htmx:confirm event
                    if (!window.confirm(message)) return false
                }
            },
        },
    })

    register('hx-headers', {
        on: {
            'htmx:request': ({ trigger, request }) => {
                const headersAttr = trigger.element.attr('hx-headers')
                if (headersAttr) {
                    // TODO: Parse JSON (or js: expression), merge into request.headers
                }
            },
        },
    })

    register('hx-validate', {
        on: {
            'htmx:request': ({ trigger }) => {
                const validate = trigger.element.attr('hx-validate')
                if (validate === 'true') {
                    // TODO: Find enclosing form, call reportValidity()
                    // Return false if validation fails
                }
            },
        },
    })

    register('hx-encoding', {
        on: {
            'htmx:request': ({ trigger, request }) => {
                const encoding = trigger.element.attr('hx-encoding')
                if (encoding === 'multipart/form-data') {
                    // TODO: Ensure request.body is FormData (not URLSearchParams)
                    // Don't set Content-Type header (browser sets it with boundary)
                }
            },
        },
    })

    register('formData', {
        on: {
            'htmx:request': ({ trigger, request }) => {
                // TODO: Collect form data from trigger element or enclosing form
                // Handle submitter, checkboxes, radio buttons, file inputs, multi-select
                // For GET requests, convert to URLSearchParams and append to URL
            },
        },
    })

    register('dynamicHeaders', {
        on: {
            'htmx:request': ({ trigger, request }) => {
                // TODO: Add dynamic headers:
                // HX-Current-URL, HX-Target, HX-Source, HX-Boosted, HX-Request-Type
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
            'htmx:request': ({ trigger, request }) => {
                // TODO: Check for js: or javascript: prefix in hx-vals, hx-headers
                // If config.security.allowEval, evaluate and use result
            },
        },
    })

    register('hx-vals', {
        on: {
            'htmx:request': ({ trigger, request }) => {
                const valsAttr = trigger.element.attr('hx-vals')
                if (valsAttr) {
                    // TODO: Parse JSON, merge into request.body (FormData or URLSearchParams)
                }
            },
        },
    })

    register('hx-include', {
        on: {
            'htmx:request': ({ trigger, request }) => {
                const includeSelector = trigger.element.attr('hx-include')
                if (includeSelector) {
                    // TODO: Find elements, collect their values, merge into request.body
                }
            },
        },
    })

    register('hx-indicator', {
        on: {
            'htmx:request': ({ trigger }) => {
                const indicatorSelector = trigger.element.attr('hx-indicator')
                // TODO: Find indicator elements, add htmx-request class
                // Store references on trigger.element.state.indicator for cleanup
            },
            'htmx:done': ({ trigger }) => {
                // TODO: Remove htmx-request class from stored indicators
            },
        },
    })

    register('hx-disable', {
        on: {
            'htmx:request': ({ trigger }) => {
                const disableSelector = trigger.element.attr('hx-disable')
                // TODO: Find elements, set disabled attribute
                // Store references on trigger.element.state.disable for cleanup
            },
            'htmx:done': ({ trigger }) => {
                // TODO: Remove disabled attribute from stored elements
            },
        },
    })

    register('hx-sync', {
        on: {
            'htmx:init': ({ element }) => {
                // Initialize sync state for this element
                element.state.sync = {
                    inflight: null,      // Currently executing request promise
                    controller: null,    // AbortController for current request
                    queue: [],           // Queued requests: [{ run: () => Promise }]
                }
            },
            'htmx:request': ({ trigger, request }) => {
                const syncSpec = trigger.element.attr('hx-sync')
                if (!syncSpec) return

                // Parse: "closest form:abort" or just "drop"
                const [targetPart, strategy = 'drop'] = syncSpec.includes(':')
                    ? [syncSpec.split(':')[0], syncSpec.split(':').slice(1).join(':')]
                    : ['this', syncSpec]

                // Resolve sync target (element whose queue we use)
                const syncTarget = targetPart === 'this'
                    ? trigger.element
                    : wrap(resolveTarget(trigger.element.native, targetPart))

                if (!syncTarget) return

                const syncState = syncTarget.state.sync
                if (!syncState) return

                // If nothing in flight, proceed normally
                if (!syncState.inflight) {
                    syncState.controller = new AbortController()
                    request.signal = syncState.controller.signal
                    syncState.inflight = request._promise // Set by kernel after we return
                    return
                }

                // Something is in flight — apply strategy
                switch (strategy.trim()) {
                    case 'drop':
                        // Discard this request entirely
                        return false

                    case 'abort':
                        // Abort current, start new
                        if (syncState.controller) syncState.controller.abort()
                        syncState.controller = new AbortController()
                        request.signal = syncState.controller.signal
                        return

                    case 'replace':
                        // Same as abort
                        if (syncState.controller) syncState.controller.abort()
                        syncState.controller = new AbortController()
                        request.signal = syncState.controller.signal
                        return

                    case 'queue':
                    case 'queue last':
                        // Queue only the most recent request
                        syncState.queue = [{ request, trigger }]
                        return false

                    case 'queue first':
                        // Only queue if nothing queued yet
                        if (syncState.queue.length === 0) {
                            syncState.queue.push({ request, trigger })
                        }
                        return false

                    case 'queue all':
                        // Queue all requests
                        syncState.queue.push({ request, trigger })
                        return false

                    default:
                        // Unknown strategy, treat as drop
                        return false
                }
            },
            'htmx:done': ({ trigger }) => {
                const syncSpec = trigger.element.attr('hx-sync')
                if (!syncSpec) return

                const [targetPart] = syncSpec.includes(':')
                    ? [syncSpec.split(':')[0]]
                    : ['this']

                const syncTarget = targetPart === 'this'
                    ? trigger.element
                    : wrap(resolveTarget(trigger.element.native, targetPart))

                if (!syncTarget) return

                const syncState = syncTarget.state.sync
                if (!syncState) return

                // Clear inflight
                syncState.inflight = null
                syncState.controller = null

                // Process queue
                if (syncState.queue.length > 0) {
                    const next = syncState.queue.shift()
                    // Re-issue the queued request via kernel fetch
                    // This will trigger htmx:request again, going through sync logic
                    queueMicrotask(() => {
                        fetch(next.request.url, {
                            method: next.request.method,
                            headers: next.request.headers,
                            body: next.request.body,
                            trigger: next.trigger,
                        })
                    })
                }
            },
            'htmx:cleanup': ({ element }) => {
                const syncState = element.state.sync
                if (syncState) {
                    if (syncState.controller) syncState.controller.abort()
                    syncState.queue = []
                    syncState.inflight = null
                }
            },
        },
    })

    register('timeout', {
        on: {
            'htmx:ready': () => {
                config.timeout = {
                    default: 60000,
                    ...config.timeout,
                }
            },
            'htmx:request': ({ trigger, request }) => {
                // TODO: Set up AbortController with timeout
                // Store on trigger.element.state.timeout
            },
            'htmx:done': ({ trigger }) => {
                // TODO: Clear timeout
            },
        },
    })

    register('etag', {
        on: {
            'htmx:request': ({ trigger, request }) => {
                // TODO: Check ETag cache, add If-None-Match header if cached
            },
            'htmx:response': ({ trigger, response }) => {
                // TODO: Cache ETag from response headers
            },
        },
    })

    // -- Response Phase --

    register('noSwap', {
        on: {
            'htmx:ready': () => {
                config.noSwap = {
                    statusCodes: [204, 304],
                    ...config.noSwap,
                }
            },
            'htmx:response': ({ response }) => {
                if (config.noSwap.statusCodes.includes(response.status)) {
                    return false // Skip swap
                }
            },
        },
    })

    register('responseHeaders', {
        on: {
            'htmx:response': ({ trigger, response }) => {
                // TODO: Handle HX-Trigger header -> emit events
                // TODO: Handle HX-Redirect -> window.location
                // TODO: Handle HX-Refresh -> window.location.reload()
                // TODO: Handle HX-Location -> htmx navigation
            },
            'htmx:swap': ({ trigger, response, swap }) => {
                // TODO: Handle HX-Retarget -> modify swap.target
                // TODO: Handle HX-Reswap -> modify swap.method
                // TODO: Handle HX-Reselect -> modify content selection
            },
        },
    })

    register('hx-status', {
        on: {
            'htmx:swap': ({ trigger, response, swap }) => {
                // TODO: Check for hx-status:4xx, hx-status:404, etc.
                // Modify swap.target based on status code
            },
        },
    })

    register('sse', {
        on: {
            'htmx:ready': () => {
                config.sse = {
                    reconnect: {
                        enable: false,
                        delay: 500,
                        maxDelay: 60000,
                        maxAttempts: 10,
                        jitter: 0.3,
                    },
                    pauseInBackground: false,
                    ...config.sse,
                }
            },
            'htmx:response': async ({ trigger, response }) => {
                const contentType = response.headers['content-type'] || ''
                if (contentType.includes('text/event-stream')) {
                    // TODO: Handle SSE response
                    // Parse event stream line by line
                    // For each message: emit htmx:sse:message, then perform swap
                    // Handle reconnection with exponential backoff + jitter
                    // Emit htmx:sse:open, htmx:sse:close, htmx:sse:error
                    // Return false to prevent normal swap
                    return false
                }
            },
        },
    })

    register('fullDocParsing', {
        on: {
            'htmx:response': ({ response, swap }) => {
                // TODO: Detect if response contains <html>, <head>, <body>
                // Extract appropriate section based on target
                // Convert <hx-*> custom tags to standard elements
            },
        },
    })

    // -- Swap Phase --

    register('select', {
        on: {
            'htmx:swap': ({ trigger, swap }) => {
                const selectSelector = trigger.element.attr('hx-select')
                if (selectSelector && swap.content) {
                    // TODO: Filter swap.content to only include matching elements
                }
            },
        },
    })

    register('oob', {
        requires: ['select'],
        on: {
            'htmx:swap': ({ trigger, swap }) => {
                // TODO: Process hx-select-oob attribute
                // TODO: Find elements with hx-swap-oob in response, swap them to their targets
            },
        },
    })

    register('hx-preserve', {
        on: {
            'htmx:swap': ({ swap }) => {
                // TODO: Find elements with hx-preserve in target
                // Store their state (using moveBefore if available, else pantry pattern)
                // Restore after swap
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
            'htmx:swap': ({ swap }) => {
                if (swap.method === 'innerMorph' || swap.method === 'outerMorph') {
                    // TODO: Implement DOM diffing algorithm
                    // Use id matching, then tag+position heuristics
                    // Respect morphIgnore, morphSkip, morphSkipChildren config
                    return false // Prevent default swap
                }
            },
        },
    })

    register('partials', {
        on: {
            'htmx:swap': ({ swap }) => {
                // TODO: Find <template hx-type="partial"> in response
                // Each partial specifies its own target/swap
                // Process each as separate swap task
            },
        },
    })

    // -- Settle Phase --

    register('executeScripts', {
        on: {
            'htmx:settle': ({ swap }) => {
                // TODO: Find <script> tags in swapped content
                // Clone and re-insert to execute them
                // Respect config.security.allowEval and CSP nonce
            },
        },
    })

    register('autofocus', {
        on: {
            'htmx:settle': ({ swap }) => {
                // TODO: Find first [autofocus] in swapped content
                // Call .focus() on it
            },
        },
    })

    register('anchorScroll', {
        on: {
            'htmx:settle': ({ response }) => {
                // TODO: Check if response URL has hash fragment
                // Scroll to that element if it exists
            },
        },
    })

    register('cssTransitions', {
        on: {
            'htmx:ready': () => {
                config.cssTransitions = {
                    swapDelay: 0,
                    settleDelay: 20,
                    ...config.cssTransitions,
                }
            },
            'htmx:swap': ({ swap }) => {
                // TODO: Add htmx-swapping class to target
                // Copy relevant attributes from old elements for CSS transition continuity
            },
            'htmx:settle': ({ swap }) => {
                // TODO: Add htmx-settling class, then htmx-added to new elements
                // Remove classes after settleDelay
            },
        },
    })

    register('viewTransitions', {
        on: {
            'htmx:ready': () => {
                config.viewTransitions = {
                    enable: false,
                    ...config.viewTransitions,
                }
            },
            'htmx:swap': async ({ swap }) => {
                const useTransition = swap.method?.includes('transition') || config.viewTransitions.enable
                if (useTransition && document.startViewTransition) {
                    // TODO: Wrap swap in document.startViewTransition()
                    // Queue multiple transitions to run sequentially
                }
            },
        },
    })

    // -- Done Phase --

    register('title', {
        on: {
            'htmx:done': ({ response }) => {
                if (!response?.text) return
                // TODO: Extract <title> from response, update document.title
            },
        },
    })

    register('history', {
        on: {
            'htmx:ready': () => {
                // TODO: Set up popstate listener for back/forward navigation
                window.addEventListener('popstate', (event) => {
                    // TODO: Restore page state from event.state
                })
            },
            'htmx:request': ({ trigger }) => {
                // TODO: Capture hx-push-url, hx-replace-url values
                // Store on trigger.element.state.history
            },
            'htmx:done': ({ trigger, request, response }) => {
                // TODO: Push or replace history state based on captured values
                // Emit htmx:history:push or htmx:history:replace
            },
        },
    })

    // -- Ready Phase --

    register('injectStyles', {
        on: {
            'htmx:ready': () => {
                if (config.includeIndicatorCSS === false) return
                // TODO: Inject indicator CSS:
                // .htmx-indicator { opacity: 0; transition: opacity 200ms; }
                // .htmx-request .htmx-indicator { opacity: 1; }
                // .htmx-request.htmx-indicator { opacity: 1; }
            },
        },
    })

    register('compat', {
        on: {
            'htmx:ready': () => {
                // Backwards-compat aliases for htmx 2.0 migration
                // htmx.process = htmx.init
                // htmx.ajax = htmx.fetch
                // htmx.trigger = htmx.emit
                // htmx.registerExtension = htmx.register
            },
        },
    })

    // ─── BOOT ────────────────────────────────────────────────────────────────

    function boot() {
        initialized = true
        emit(document, 'htmx:ready', {})
        init(document.body)
        observeDOM()
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', boot)
    } else {
        queueMicrotask(boot)
    }

    // ─── PUBLIC API ──────────────────────────────────────────────────────────

    return {
        version: '4.0.0-beta-draft',
        config,

        // Kernel
        init,
        fetch,
        emit,
        register,

        // Wrapped element helpers (static equivalents)
        wrap,
        attr,
        find,
        findAll,
        state,

        // Utilities
        resolveTarget,
        makeFragment,
    }
})()
