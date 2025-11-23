# htmx 4.0 Architecture

This document describes the htmx 4.0 architecture: a middleware-like feature system where order = definition order.

---

## Core Principles

1. **Kernel handles fundamentals** - Activation, trigger binding (hx-trigger), verb extraction (hx-get/post/...), request execution, swap
2. **Features are middleware** - They run in definition order, modifying request/response/swap
3. **`htmx.features` is an object** - Keys are feature names, order = insertion order
4. **Arrow functions** - Handlers use arrow functions; `feature` is injected as a parameter
5. **Feature injection is scoped** - Features get `{ feature, element, request, swap, ... }`, external listeners get `{ element, request, swap, ... }` (no `feature`)
6. **Wrapped elements** - `element` is always wrapped with `attr()`, `find()`, `trigger()`, etc.

---

## The Features Object

Features are defined in order. The object key order IS the execution order.

```javascript
htmx.features = {

    // ═══════════════════════════════════════════════════════════════════════════
    // hx-boost
    // ═══════════════════════════════════════════════════════════════════════════

    'hx-boost': {
        on: {
            'htmx:after:activate': ({ element }) => {
                if (element.attr('hx-boost') !== 'true') return

                for (const link of element.querySelectorAll('a')) {
                    if (link.hasAttribute('data-htmx-boosted')) continue
                    if (link.closest('[hx-boost="false"]')) continue
                    if (link.target === '_blank') continue
                    if (!link.href || link.href.includes('#')) continue
                    if (!htmx.isSameOrigin(link.href)) continue

                    link.toggleAttribute('data-htmx-boosted', true)
                    link._htmx = { listeners: [] }
                    link.addEventListener('click', htmx.createRequestHandler(link))
                }

                for (const form of element.querySelectorAll('form')) {
                    if (form.hasAttribute('data-htmx-boosted')) continue
                    if (form.closest('[hx-boost="false"]')) continue
                    if (form.method === 'dialog') continue
                    if (!htmx.isSameOrigin(form.action)) continue

                    form.toggleAttribute('data-htmx-boosted', true)
                    form._htmx = { listeners: [] }
                    form.addEventListener('submit', htmx.createRequestHandler(form))
                }
            }
        }
    },

    'hx-on': {
        on: {
            'htmx:after:activate': ({ element }) => {
                const prefix = htmx.config.syntax.prefix
                const xpathQuery = `.//*[@*[starts-with(name(), "${prefix}on:")]]`

                const xpath = new XPathEvaluator().createExpression(xpathQuery)
                const iter = xpath.evaluate(element, XPathResult.UNORDERED_NODE_ITERATOR_TYPE)

                let node
                while (node = iter.iterateNext()) {
                    htmx.processHxOnAttributes(node)
                }

                htmx.processHxOnAttributes(element)
            }
        }
    },

    // ═══════════════════════════════════════════════════════════════════════════
    // SWAP CONFIG - Read attributes at trigger time, apply defaults
    // ═══════════════════════════════════════════════════════════════════════════

    'hx-swap': {
        // Defaults (also exposed via htmx.config.swap alias)
        method: 'innerHTML',
        target: 'this',
        modifiers: {
            swapDelay: 0,
            settleDelay: 20,
            transition: false,
            ignoreTitle: false,
            focus: null,
        },

        on: {
            // Read attributes at trigger time, not activation
            'htmx:before:request': ({ feature, element, swap }) => {
                // Start with defaults
                swap.method = feature.method
                swap.target = feature.target
                swap.select = null
                swap.selectOOB = null
                swap.modifiers = { ...feature.modifiers }

                // Apply hx-target override
                const targetAttr = element.attr('hx-target')
                if (targetAttr) swap.target = targetAttr

                // Apply hx-swap override
                const swapAttr = element.attr('hx-swap')
                if (swapAttr) {
                    const parsed = htmx.parse(swapAttr)[0]
                    swap.method = parsed.value

                    if (parsed.swap) swap.modifiers.swapDelay = parseInt(parsed.swap)
                    if (parsed.settle) swap.modifiers.settleDelay = parseInt(parsed.settle)
                    if (parsed.scroll) swap.modifiers.scroll = parsed.scroll
                    if (parsed.show) swap.modifiers.show = parsed.show
                    if (parsed.transition !== undefined) swap.modifiers.transition = parsed.transition === 'true'
                    if (parsed.ignoreTitle !== undefined) swap.modifiers.ignoreTitle = parsed.ignoreTitle === 'true'
                    if (parsed.focus) swap.modifiers.focus = parsed.focus
                }

                // Apply hx-select
                const selectAttr = element.attr('hx-select')
                if (selectAttr) swap.select = selectAttr

                // Apply hx-select-oob
                const selectOOBAttr = element.attr('hx-select-oob')
                if (selectOOBAttr) swap.selectOOB = selectOOBAttr
            }
        }
    },

    'hx-confirm': {
        on: {
            'htmx:before:request': async ({ element }) => {
                const question = element.attr('hx-confirm')
                if (!question) return

                const allowed = await element.trigger('htmx:confirm', { question })

                if (!allowed || !window.confirm(question)) {
                    return false
                }
            }
        }
    },

    'hx-headers': {
        on: {
            'htmx:before:request': async ({ element, request }) => {
                const value = element.attr('hx-headers')
                if (!value) return

                let headers
                if (value.startsWith('js:') || value.startsWith('javascript:')) {
                    let code = value.startsWith('js:') ? value.slice(3) : value.slice(11)
                    if (!code.trimStart().startsWith('{')) code = `{ ${code} }`
                    headers = await htmx.eval(code, { element: element.native })
                } else {
                    headers = htmx.parse(value)
                }

                Object.assign(request.headers, headers)
            }
        }
    },

    'hx-vals': {
        on: {
            'htmx:before:request': async ({ element, request }) => {
                const value = element.attr('hx-vals')
                if (!value) return

                let vals
                if (value.startsWith('js:') || value.startsWith('javascript:')) {
                    // Extract JS code
                    let code = value.startsWith('js:') ? value.slice(3) : value.slice(11)
                    // Wrap in {} if not already an object literal (convenience)
                    if (!code.trimStart().startsWith('{')) code = `{ ${code} }`
                    vals = await htmx.eval(code, { element: element.native })
                } else {
                    vals = htmx.parse(value)
                }

                for (const [k, v] of Object.entries(vals)) {
                    request.body.set(k, v)
                }
            }
        }
    },

    'hx-include': {
        on: {
            'htmx:before:request': ({ element, request }) => {
                const selector = element.attr('hx-include')
                if (!selector) return

                for (const input of element.findAll(selector)) {
                    htmx.addInputToBody(input, request.body)
                }
            }
        }
    },

    'hx-validate': {
        on: {
            'htmx:before:request': ({ element, request }) => {
                // Validation is element-specific, don't inherit from ancestors
                const validate = element.attr('hx-validate', { inherit: false })
                if (validate !== null) request.validate = validate !== 'false'
            }
        }
    },

    'hx-encoding': {
        on: {
            'htmx:before:request': ({ element, request }) => {
                const encoding = element.attr('hx-encoding')
                if (encoding) request.encoding = encoding
            }
        }
    },

    'hx-indicator': {
        on: {
            'htmx:before:request': ({ element, request }) => {
                const selector = element.attr('hx-indicator')
                const indicators = selector
                    ? element.findAll(selector)
                    : [element.native]

                // Store on request detail (transient, per-request)
                request.indicators = indicators

                for (const indicator of indicators) {
                    indicator._htmxReqCount = (indicator._htmxReqCount || 0) + 1
                    indicator.classList.add(htmx.config.classes.request)
                }
            },

            'htmx:finally:request': ({ request }) => {
                for (const indicator of request.indicators || []) {
                    indicator._htmxReqCount = (indicator._htmxReqCount || 1) - 1
                    if (indicator._htmxReqCount <= 0) {
                        indicator.classList.remove(htmx.config.classes.request)
                        delete indicator._htmxReqCount
                    }
                }
            }
        }
    },

    'hx-disable': {
        on: {
            'htmx:before:request': ({ element, request }) => {
                const selector = element.attr('hx-disable')
                if (!selector) return

                // Store on request detail (transient, per-request)
                request.disabled = element.findAll(selector)

                for (const target of request.disabled) {
                    target._htmxDisableCount = (target._htmxDisableCount || 0) + 1
                    target.disabled = true
                }
            },

            'htmx:finally:request': ({ request }) => {
                for (const target of request.disabled || []) {
                    target._htmxDisableCount = (target._htmxDisableCount || 1) - 1
                    if (target._htmxDisableCount <= 0) {
                        target.disabled = false
                        delete target._htmxDisableCount
                    }
                }
            }
        }
    },

    'hx-sync': {
        on: {
            // Read at trigger time, not activation
            'htmx:before:request': ({ element, request }) => {
                const value = element.attr('hx-sync')
                if (!value) return

                const parsed = htmx.parse(value)[0]
                request.queue = {
                    strategy: parsed.value,
                    scope: parsed.from || 'this'
                }
            }
        }
    },

    'hx-config': {
        on: {
            'htmx:before:request': ({ element, request, swap }) => {
                const value = element.attr('hx-config')
                if (!value) return

                htmx.mergeConfig(value, { request, swap })
            }
        }
    },

    // ═══════════════════════════════════════════════════════════════════════════
    // RESPONSE PROCESSING - After fetch, before swap
    // ═══════════════════════════════════════════════════════════════════════════

    'noSwap': {
        statusCodes: [204, 304],

        on: {
            'htmx:after:request': ({ feature, response, swap }) => {
                if (feature.statusCodes.includes(response.status)) {
                    swap.method = 'none'
                }
            }
        }
    },

    'responseHeaders': {
        on: {
            'htmx:after:request': ({ element, response, swap }) => {
                const h = response.headers

                if (h['HX-Trigger']) {
                    htmx.handleTriggerHeader(h['HX-Trigger'], element.native)
                }

                if (h['HX-Refresh'] === 'true') {
                    location.reload()
                    swap.method = 'none'
                    return
                }

                if (h['HX-Redirect']) {
                    location.href = h['HX-Redirect']
                    swap.method = 'none'
                    return
                }

                if (h['HX-Location']) {
                    htmx.handleLocationHeader(h['HX-Location'])
                    swap.method = 'none'
                    return
                }

                if (h['HX-Retarget']) {
                    swap.target = htmx.find(h['HX-Retarget'])
                }

                if (h['HX-Reswap']) {
                    const parsed = htmx.parse(h['HX-Reswap'])[0]
                    swap.method = parsed.value
                    if (parsed.swap) swap.modifiers.swapDelay = parseInt(parsed.swap)
                    if (parsed.settle) swap.modifiers.settleDelay = parseInt(parsed.settle)
                }

                if (h['HX-Reselect']) {
                    swap.select = h['HX-Reselect']
                }
            }
        }
    },

    'etag': {
        on: {
            'htmx:before:request': ({ element, request }) => {
                const etag = element.native._htmx?.etag
                if (etag) request.headers['If-None-Match'] = etag
            },

            'htmx:after:request': ({ element, response }) => {
                const etag = response.headers['ETag']
                if (etag) element.native._htmx.etag = etag
            }
        }
    },

    'hx-status': {
        on: {
            'htmx:after:request': ({ element, response, swap, request }) => {
                const status = response.status.toString()
                const patterns = [status, status.slice(0, 2) + 'x', status[0] + 'xx']

                for (const pattern of patterns) {
                    const value = element.attr(`hx-status:${pattern}`)
                    if (value) {
                        htmx.mergeConfig(value, { request, swap })
                        return
                    }
                }
            }
        }
    },

    'sse': {
        reconnect: {
            enable: false,
            delay: 500,
            maxDelay: 60000,
            maxAttempts: 10,
            jitter: 0.3
        },
        pauseInBackground: false,

        on: {
            'htmx:after:request': async ({ feature, request, response, swap }) => {
                if (!response.headers['content-type']?.includes('text/event-stream')) return

                swap.method = 'none'

                // Parse SSE stream, emit htmx:sse:message events,
                // swap each message, handle reconnection with exponential backoff,
                // pause when document hidden if pauseInBackground enabled
            }
        }
    },

    // ═══════════════════════════════════════════════════════════════════════════
    // POST-SWAP - After content is in DOM
    // ═══════════════════════════════════════════════════════════════════════════

    'title': {
        on: {
            'htmx:after:swap': ({ response, swap }) => {
                if (response.title && !swap.modifiers.ignoreTitle) {
                    document.title = response.title
                }
            }
        }
    },

    'history': {
        reload: false,

        on: {
            'htmx:after:init': ({ feature }) => {
                if (!history.state) {
                    history.replaceState({ htmx: true }, '', location.pathname + location.search)
                }

                window.addEventListener('popstate', (event) => {
                    if (!event.state?.htmx) return
                    htmx.restoreHistory()
                })
            },

            'htmx:before:request': ({ element, request }) => {
                // Capture at request time, store on request detail (survives element removal)
                // History attributes are element-specific, don't inherit
                request.historyPush = element.attr('hx-push-url', { inherit: false })
                request.historyReplace = element.attr('hx-replace-url', { inherit: false })
            },

            'htmx:after:swap': ({ request, response }) => {
                const push = request.historyPush
                const replace = request.historyReplace

                if (push && push !== 'false') {
                    const path = push === 'true' ? response.url : push
                    history.pushState({ htmx: true }, '', path)
                    htmx.trigger('htmx:after:history:push', { path })
                }

                if (replace && replace !== 'false') {
                    const path = replace === 'true' ? response.url : replace
                    history.replaceState({ htmx: true }, '', path)
                    htmx.trigger('htmx:after:history:replace', { path })
                }
            }
        }
    },

    // ═══════════════════════════════════════════════════════════════════════════
    // STYLES - Inject indicator CSS
    // ═══════════════════════════════════════════════════════════════════════════

    'injectStyles': {
        on: {
            'htmx:before:init': () => {
                const c = htmx.config.classes
                const nonce = htmx.config.security.styleNonce
                const styles = `
                    .${c.indicator} {
                        opacity: 0;
                        visibility: hidden;
                    }
                    .${c.request} .${c.indicator},
                    .${c.request}.${c.indicator} {
                        opacity: 1;
                        visibility: visible;
                        transition: opacity 200ms ease-in;
                    }`

                document.head.insertAdjacentHTML('beforeend',
                    `<style${nonce ? ` nonce="${nonce}"` : ''}>${styles}</style>`
                )
            }
        }
    },

    // ═══════════════════════════════════════════════════════════════════════════
    // COMPATIBILITY - Backwards compat aliases (can be disabled)
    // ═══════════════════════════════════════════════════════════════════════════

    'compat': {
        enable: true,

        on: {
            'htmx:before:init': () => {
                // Method aliases
                htmx.process = htmx.activate
                htmx.ajax = htmx.request
                htmx.registerExtension = htmx.register

                // Config aliases (old flat names → new nested)
                // htmx.config.defaultSwapStyle → htmx.config.swap.method
                // etc.
            }
        }
    },
}
```

---

## Config Object

Config provides kernel settings and convenient aliases to feature config.

```javascript
htmx.config = {

    // ═══════════════════════════════════════════════════════════════════════════
    // ALIASES - Point to feature config for ergonomics
    // ═══════════════════════════════════════════════════════════════════════════

    get swap() { return htmx.features['hx-swap'] },

    // Trigger defaults (kernel config, not a feature)
    trigger: {
        default: 'click',
        defaults: {
            'form': 'submit',
            'input:not([type=button])': 'change',
            'select': 'change',
            'textarea': 'change'
        }
    },

    // ═══════════════════════════════════════════════════════════════════════════
    // KERNEL SETTINGS
    // ═══════════════════════════════════════════════════════════════════════════

    request: {
        timeout: 60000,
        credentials: 'same-origin',
        mode: 'same-origin',
        encoding: null,

        headers: {
            'HX-Request': 'true',
            'Accept': 'text/html, text/event-stream',
            'HX-Current-URL': () => window.location.href,
            'HX-Source': (request) => request.element.id || null,
            'HX-Target': (swap) => swap.target?.id || null,
        },

        queue: 'replace'
    },

    morph: {
        ignore: ['data-htmx-powered'],
        scanLimit: 10,
        skip: null,
        skipChildren: null
    },

    syntax: {
        prefix: 'hx-',
        delimiter: ':',
        format: RelaxedJSON  // Object with parse(str) and stringify(obj) methods
    },

    inheritance: {
        enable: true,
        mode: 'explicit',   // 'explicit' requires hx-attr:marker, 'implicit' auto-inherits
        marker: 'inherited' // produces "hx-target:inherited", or use '*' for "hx-target:*"
    },

    security: {
        allowEval: true,    // Set false to disable js:/javascript: in attributes
        nonce: null,        // CSP nonce for inline scripts/styles
        allowOrigins: null, // null = unrestricted, ['self'] = same-origin, [...] = whitelist
        trustedTypes: null  // null = disabled, string = policy name
    },

    classes: {
        indicator: 'htmx-indicator',
        request: 'htmx-request',
        swapping: 'htmx-swapping',
        settling: 'htmx-settling',
        added: 'htmx-added'
    },

    debug: false
}
```

---

## Kernel Implementation

### attrName() - Transform canonical name to configured syntax

```javascript
htmx.attrName = function(canonical) {
    const { prefix, delimiter } = htmx.config.syntax

    // Transform canonical 'hx-' prefix to configured prefix
    // Transform canonical ':' delimiter to configured delimiter
    return canonical
        .replace(/^hx-/, prefix)
        .replace(/:/g, delimiter)
}

// Examples with default config (prefix: 'hx-', delimiter: ':'):
htmx.attrName('hx-target')           // → 'hx-target'
htmx.attrName('hx-target:inherited') // → 'hx-target:inherited'
htmx.attrName('hx-on:click')         // → 'hx-on:click'

// Examples with custom config (prefix: 'data-hx-', delimiter: '--'):
htmx.attrName('hx-target')           // → 'data-hx-target'
htmx.attrName('hx-target:inherited') // → 'data-hx-target--inherited'
htmx.attrName('hx-on:click')         // → 'data-hx-on--click'
```

### attr() - Get attribute with inheritance

```javascript
htmx.attr = function(element, name, { inherit = true } = {}) {
    const { enable, mode, marker } = htmx.config.inheritance
    const attrName = htmx.attrName(name)

    // Direct value always wins
    const direct = element.getAttribute(attrName)
    if (direct !== null) return direct

    // No inheritance?
    if (!enable || !inherit) return null

    // Explicit mode: check for marker (e.g., hx-target:inherited)
    if (mode === 'explicit') {
        const markerAttr = htmx.attrName(`${name}:${marker}`)
        if (!element.hasAttribute(markerAttr)) {
            return null
        }
    }

    // Walk up tree
    let current = element.parentElement
    while (current) {
        const value = current.getAttribute(attrName)
        if (value !== null) return value
        current = current.parentElement
    }
    return null
}
```

**The `inherit` option is per-call, not per-attribute.** This lets each feature decide whether inheritance makes sense for that specific attribute:

```javascript
// hx-target: inheritance makes sense (parent sets target for children)
element.attr('hx-target')  // default, inherits

// hx-validate: inheritance doesn't make sense (validation is element-specific)
element.attr('hx-validate', { inherit: false })  // feature opts out

// hx-push-url: history actions are element-specific
element.attr('hx-push-url', { inherit: false })
```

Features that shouldn't inherit simply pass `{ inherit: false }` in their implementation. The global `htmx.config.inheritance` controls whether inheritance is *possible*, but each feature controls whether it *uses* inheritance.

### parse() / stringify() - Use configured format

```javascript
htmx.parse = function(str) {
    return htmx.config.syntax.format.parse(str)
}

htmx.stringify = function(obj) {
    return htmx.config.syntax.format.stringify(obj)
}

// Usage:
htmx.parse('method:innerHTML, swap:100ms')  // Uses RelaxedJSON by default
htmx.stringify({ method: 'innerHTML' })

// Users can swap the parser:
htmx.config.syntax.format = JSON  // Use standard JSON instead
```

### eval() - Execute JavaScript with context

```javascript
htmx.eval = async function(code, context = {}) {
    if (!htmx.config.security.allowEval) {
        console.warn('htmx: JS evaluation disabled (security.allowEval = false)')
        return undefined
    }

    const args = { htmx, ...context }
    const keys = Object.keys(args)
    const values = Object.values(args)

    const AsyncFunction = Object.getPrototypeOf(async function() {}).constructor
    const fn = new AsyncFunction(...keys, `return (${code})`)

    return await fn(...values)
}
```

### resolveTarget() - Find target element with smart defaults

```javascript
htmx.resolveTarget = function(element, selector) {
    element = htmx.wrap(element)

    // Already an element - return as-is
    if (selector instanceof Element) return selector

    // String selector - use extended find (handles 'closest', 'next', 'previous', etc.)
    if (selector) return element.find(selector)

    // No selector - default to body if boosted, otherwise self
    return element.hasAttribute('data-htmx-boosted')
        ? document.body
        : element.native
}

// Usage:
const target = htmx.resolveTarget(element, swap.target)  // swap.target might be 'this', '#foo', 'closest form', or null
```

### wrap() - Create powered-up element

```javascript
const WRAPPED = Symbol('htmx.wrapped')

htmx.wrap = function(element) {
    if (element[WRAPPED]) return element  // Already wrapped, idempotent

    return new Proxy(element, {
        get(target, prop) {
            if (prop === WRAPPED) return true
            if (prop === 'native') return target
            if (prop === 'is') return (other) => target === (other?.[WRAPPED] ? other.native : other)
            if (prop === 'attr') return (name, opts) => htmx.attr(target, name, opts)
            if (prop === 'find') return (selector) => htmx.find(target, selector)
            if (prop === 'findAll') return (selector) => htmx.findAll(target, selector)
            if (prop === 'trigger') return (eventName, detail) => htmx.trigger(target, eventName, detail)

            // Everything else falls through to native element
            const value = target[prop]
            return typeof value === 'function' ? value.bind(target) : value
        }
    })
}
```

**Idempotent:** Safe to call multiple times - returns same wrapped element.

**Usage:**
```javascript
'htmx:before:request': ({ element }) => {
    // Powered-up methods
    const target = element.attr('hx-target')
    const inputs = element.findAll('input')
    const form = element.find('closest form')
    element.trigger('htmx:confirm', { question })

    // Identity comparison (works with wrapped or native)
    if (element.is(someOtherElement)) { ... }

    // Native DOM still works
    element.classList.add('loading')

    // Access native when needed (e.g., for external APIs)
    externalLibrary.init(element.native)
}
```

### trigger() - Run features then dispatch DOM event

```javascript
htmx.trigger = function(element, eventName, detail = {}) {
    // element is optional - defaults to document for global events
    if (typeof element === 'string') {
        detail = eventName || {}
        eventName = element
        element = document
    }

    // Wrap element in detail (idempotent - safe if already wrapped)
    if (detail.element) {
        detail = { ...detail, element: htmx.wrap(detail.element) }
    }

    // 1. Run features in definition order
    for (const [name, featureDef] of Object.entries(htmx.features)) {
        if (featureDef.enable === false) continue

        const handler = featureDef.on?.[eventName]
        if (!handler) continue

        const result = handler({ ...detail, feature: featureDef })

        if (htmx.config.debug) {
            console.log(`[${eventName}] [${name}]`, result === false ? '✗ cancelled' : '✓')
        }

        if (result === false) return false
    }

    // 2. Dispatch DOM event (with native element, not wrapped)
    const event = new CustomEvent(eventName, {
        detail,
        bubbles: true,
        cancelable: true
    })

    return element.dispatchEvent(event)
}
```

### register() - Add features with optional positioning

```javascript
htmx.register = function(name, feature, options = {}) {
    if (options.before || options.after) {
        // Rebuild object with insertion at correct position
        const entries = Object.entries(htmx.features)
        const targetName = options.before || options.after
        const targetIdx = entries.findIndex(([n]) => n === targetName)
        const insertIdx = options.before ? targetIdx : targetIdx + 1

        entries.splice(insertIdx, 0, [name, feature])
        htmx.features = Object.fromEntries(entries)
    } else {
        // Append to end
        htmx.features[name] = feature
    }
}
```

### activate() - Process an element

```javascript
htmx.activate = function(element) {
    element = htmx.wrap(element)

    if (element.hasAttribute('data-htmx-activated')) return

    element.trigger('htmx:before:activate', { element })

    element.toggleAttribute('data-htmx-activated', true)
    element.native._htmx = { listeners: [] }

    // Bind trigger if element has hx-get, hx-post, hx-put, hx-patch, or hx-delete
    const hasVerb = ['get', 'post', 'put', 'patch', 'delete'].some(v =>
        element.attr(`hx-${v}`, { inherit: false })
    )

    if (hasVerb) {
        // Determine event to listen for
        let event = element.attr('hx-trigger') || htmx.config.trigger.default
        for (const [selector, evt] of Object.entries(htmx.config.trigger.defaults)) {
            if (element.matches(selector)) { event = evt; break }
        }

        // Bind listener
        const handler = htmx.createRequestHandler(element.native)
        element.addEventListener(event, handler)
        element.native._htmx.listeners.push({ eventName: event, handler })
    }

    element.trigger('htmx:after:activate', { element })
}
```

### deactivate() - Cleanup an element

```javascript
htmx.deactivate = function(element) {
    element = htmx.wrap(element)

    if (!element.hasAttribute('data-htmx-activated')) return

    element.trigger('htmx:before:deactivate', { element })

    // Remove listeners
    for (const { eventName, handler } of element.native._htmx?.listeners || []) {
        element.removeEventListener(eventName, handler)
    }

    element.removeAttribute('data-htmx-activated')
    delete element.native._htmx

    element.trigger('htmx:after:deactivate', { element })
}
```

### ajax() - Programmatic requests (public API)

```javascript
htmx.ajax = async function(verb, url, options = {}) {
    // Resolve source element
    let source = options.source
    if (typeof source === 'string') source = document.querySelector(source)
    if (!source) source = document.body

    const element = htmx.wrap(source)

    // Resolve target
    const target = htmx.resolveTarget(element.native, options.target)
    if (!target) throw new Error('Target not found')

    const detail = {
        element,
        request: {
            method: verb.toUpperCase(),
            url,
            element: element.native,
            event: options.event,
            headers: { ...htmx.config.request.headers, ...options.headers },
            body: new FormData(),
        },
        swap: {
            method: options.swap || 'innerHTML',
            target,
        },
        response: null,
    }

    // Add values to body
    if (options.values) {
        for (const [k, v] of Object.entries(options.values)) {
            detail.request.body.set(k, v)
        }
    }

    try {
        if (!element.trigger('htmx:before:request', detail)) return

        detail.response = await htmx.fetch(detail.request)

        element.trigger('htmx:after:request', detail)

        if (!element.trigger('htmx:before:swap', detail)) return
        htmx.performSwap(detail.swap)
        element.trigger('htmx:after:swap', detail)

        element.trigger('htmx:before:settle', detail)
        await htmx.settle(detail.swap)
        element.trigger('htmx:after:settle', detail)

    } finally {
        element.trigger('htmx:finally:request', detail)
    }

    return detail.response
}

// Usage:
htmx.ajax('GET', '/api/users', { target: '#results' })
htmx.ajax('POST', '/api/submit', {
    source: '#my-form',
    target: '#response',
    swap: 'outerHTML',
    values: { name: 'John' },
    headers: { 'X-Custom': 'value' }
})
```

### request() - Internal request from element interaction

```javascript
htmx.request = async function(element, event) {
    element = htmx.wrap(element)

    // Find verb and URL from hx-get, hx-post, hx-put, hx-patch, hx-delete
    let method, url
    for (const verb of ['get', 'post', 'put', 'patch', 'delete']) {
        url = element.attr(`hx-${verb}`, { inherit: false })
        if (url) { method = verb.toUpperCase(); break }
    }
    if (!method) return

    const detail = {
        element,
        request: {
            method,
            url,
            element: element.native,
            event,
            headers: { ...htmx.config.request.headers },
            body: new FormData(),
        },
        swap: {
            // Populated by hx-swap feature during htmx:before:request
        },
        response: null,
    }

    try {
        if (!element.trigger('htmx:before:request', detail)) return

        detail.swap.target = htmx.resolveTarget(element.native, detail.swap.target || 'this')
        detail.response = await htmx.fetch(detail.request)

        element.trigger('htmx:after:request', detail)

        if (!element.trigger('htmx:before:swap', detail)) return
        htmx.performSwap(detail.swap)
        element.trigger('htmx:after:swap', detail)

        element.trigger('htmx:before:settle', detail)
        await htmx.settle(detail.swap)
        element.trigger('htmx:after:settle', detail)

    } finally {
        element.trigger('htmx:finally:request', detail)
    }
}
```

---

## Element State

State is stored based on what it is:

### 1. `data-htmx-*` Attributes (CSS-targetable, debugging)

Boolean flags only. Useful for CSS selectors (e.g., Tailwind `data-htmx-activated:opacity-50`).

```html
<button hx-get="/api" data-htmx-activated>
<a href="/page" data-htmx-boosted>
```

```javascript
// Set
element.toggleAttribute('data-htmx-activated', true)

// Check
if (element.hasAttribute('data-htmx-activated')) return

// Remove
element.removeAttribute('data-htmx-activated')
```

**What goes here:**
- `data-htmx-activated` - element has been processed
- `data-htmx-boosted` - element was boosted (listener attached)

### 2. `element._htmx` (internal state)

Everything else - non-serializable objects and internal values:

```javascript
element._htmx = {
    listeners: [...],    // Array of {fromElt, eventName, handler} for cleanup
    interval: 123,       // setInterval ID
    requestQueue: ReqQ,  // Request queue instance
    etag: 'W/abc123'     // Last ETag from response
}
```

### 3. Derived from Attributes (not stored)

Everything else is read from `hx-*` attributes at trigger time:

- `verb` / `url` → from `hx-get`, `hx-post`, etc.
- `swap` config → from `hx-swap`, `hx-target`, etc.
- `trigger` config → from `hx-trigger`
- All other attribute values

**No caching.** Parse when needed.

### 4. Request Detail (transient, per-request)

Active request state lives on the detail object:

```javascript
detail = {
    request: {
        element,
        indicators: [...],  // for cleanup
        disabled: [...],    // for cleanup
        historyPush: '...',
        // ...
    },
    // ...
}
```

---

### Data Flow

1. **Activation** → `element.toggleAttribute('data-htmx-activated', true)`, init `element._htmx`
2. **Trigger fires** → Read `hx-*` attributes, build request detail
3. **Request lifecycle** → Transient state on detail object
4. **Cleanup** → Use `element._htmx.listeners` to remove handlers
5. **Deactivation** → Remove `data-htmx-*` attributes, delete `element._htmx`

---

## Event Detail Structure

### What features receive

```javascript
// Feature handlers get `feature` injected + `element` is wrapped (powered-up)
({ feature, element }) => {
    element.attr('hx-target')  // works! element is wrapped
    element.native             // access underlying DOM element
}

({ feature, element, request, swap }) => { ... }
({ feature, element, request, response, swap }) => { ... }
```

### What external listeners receive

```javascript
// DOM event listeners do NOT get `feature`, but `element` IS wrapped
document.addEventListener('htmx:before:request', (e) => {
    const { element, request, swap } = e.detail
    element.attr('hx-swap')  // works
    // no `feature` here
})
```

### Detail objects

```javascript
// Top-level element (wrapped with Proxy for powered-up access)
element: HtmxElement  // element.attr(), element.native, etc.

// request (from htmx:before:request)
request: {
    element: HTMLElement,  // Also available here (native, not wrapped)
    event: Event,
    method: 'GET'|'POST'|'PUT'|'PATCH'|'DELETE',
    url: '/api/endpoint',
    headers: { ... },
    body: FormData,
    timeout: 60000,
    credentials: 'same-origin',
    mode: 'same-origin',
    encoding: null,
    form: HTMLFormElement,
    submitter: HTMLElement,
    validate: true,
    anchor: 'section',
    queue: { scope: HTMLElement, strategy: 'replace' },
    signal: AbortSignal,
    abort: Function
}

// response (from htmx:after:request)
response: {
    status: 200,
    headers: { ... },
    body: '<div>...</div>',
    url: 'https://...',
    title: null
}

// swap (from htmx:before:request, fully resolved by htmx:before:swap)
swap: {
    method: 'innerHTML',
    target: HTMLElement,
    select: null,
    selectOOB: null,
    fragment: DocumentFragment,
    perform: null,
    modifiers: {
        swapDelay: 0,
        settleDelay: 20,
        transition: false,
        ignoreTitle: false,
        focus: null
    }
}
```

---

## Registration Examples

### Append (default)

```javascript
htmx.register('csrf', {
    on: {
        'htmx:before:request': ({ request }) => {
            request.headers['X-CSRF-Token'] = document.querySelector('meta[name="csrf-token"]').content
        }
    }
})
```

### Insert before a specific feature

```javascript
htmx.register('csrf', {
    on: {
        'htmx:before:request': ({ request }) => {
            request.headers['X-CSRF-Token'] = getToken()
        }
    }
}, { before: 'hx-indicator' })
```

### Insert after a specific feature

```javascript
htmx.register('analytics', {
    on: {
        'htmx:after:request': ({ request, response }) => {
            track('htmx:request', { url: request.url, status: response.status })
        }
    }
}, { after: 'responseHeaders' })
```

### Feature with config

```javascript
htmx.register('retryOnError', {
    maxRetries: 3,
    retryDelay: 1000,

    on: {
        'htmx:after:request': async ({ feature, request, response, swap }) => {
            if (response.status >= 500 && request._retryCount < feature.maxRetries) {
                request._retryCount = (request._retryCount || 0) + 1
                await new Promise(r => setTimeout(r, feature.retryDelay))
                return htmx.request(request.element, request.event)
            }
        }
    }
})
```

---

## Extending Swap Methods

Features can add custom swap methods by setting `swap.perform`:

```javascript
htmx.register('morphSwap', {
    on: {
        'htmx:before:swap': ({ swap }) => {
            if (!swap.method.startsWith('morph')) return

            swap.perform = () => {
                const outer = swap.method === 'morph:outer'
                Idiomorph.morph(
                    outer ? swap.target : swap.target.innerHTML,
                    swap.fragment,
                    htmx.config.morph
                )
            }
        }
    }
})

// Usage: <div hx-get="/items" hx-swap="morph">
```

---

## Debug Output

With `htmx.config.debug = true`:

```
[htmx:after:activate] [hx-verb] ✓
[htmx:after:activate] [hx-trigger] ✓
[htmx:after:activate] [hx-boost] ✓

── click ──

[htmx:before:request] [hx-swap] ✓
[htmx:before:request] [hx-confirm] ✓
[htmx:before:request] [hx-headers] ✓
[htmx:before:request] [hx-indicator] ✓

── fetch GET /api → 200 ──

[htmx:after:request] [noSwap] ✓
[htmx:after:request] [responseHeaders] ✓
[htmx:after:request] [etag] ✓

[htmx:after:swap] [title] ✓
[htmx:after:swap] [history] ✓

[htmx:finally:request] [hx-indicator] ✓
```

---

## Public API

### Methods

```javascript
htmx.activate(element)              // Process element, bind triggers
htmx.deactivate(element)            // Cleanup element, remove listeners
htmx.ajax(verb, url, options)       // Programmatic request (public API)
htmx.request(element, event)        // Internal request from element interaction
htmx.register(name, feature, opts)  // Register feature

// Utilities
htmx.find(selector)
htmx.findAll(selector)
htmx.closest(element, selector)
htmx.trigger(element, eventName, detail)  // or htmx.trigger(eventName, detail) for document
htmx.on(event, callback)
htmx.onLoad(callback)
htmx.takeClass(element, className)
htmx.parseInterval(str)

// Internal utilities (used by features)
htmx.attr(element, name, options)   // Get attribute (with inheritance support)
htmx.attrName(canonical)            // Transform 'hx-foo:bar' to configured syntax
htmx.parse(value)                   // Parse string using syntax.format
htmx.stringify(value)               // Stringify using syntax.format
htmx.wrap(element)                  // Create powered-up element (idempotent)

// Wrapped element methods:
element.attr(name, opts)            // Get attribute with inheritance
element.find(selector)              // Find single element
element.findAll(selector)           // Find all elements
element.trigger(eventName, detail)  // Trigger event on element
element.is(other)                   // Compare identity (works with wrapped or native)
element.native                      // Access underlying DOM element
htmx.resolveTarget(element, selector) // Find target with smart defaults
htmx.eval(code, context)             // Execute JavaScript with context
htmx.isSameOrigin(url)               // Check if URL is same origin
```

### Events

```javascript
// Lifecycle
htmx:before:init
htmx:after:init
htmx:before:activate
htmx:after:activate
htmx:before:deactivate
htmx:after:deactivate

// Request
htmx:before:request
htmx:after:request
htmx:before:swap
htmx:after:swap
htmx:before:settle
htmx:after:settle
htmx:finally:request

// Other
htmx:confirm
htmx:error
htmx:after:history:push
htmx:after:history:replace
```

---

## Open Questions

### Architecture Cleanup
1. **`htmx.ajax()` / request flow** - Overlapping concepts, needs cleaner single entry point
2. **Remove `htmx.resolveTarget()`** - Should be inlined, not a separate utility
3. **Detail structure** - Centralize and document what's available at each event phase

### Element State
4. **`_htmx` storage location** - Store on `element.native._htmx` or inside the Proxy so we can do `element._htmx`?
5. **`element.attr()` for data attributes** - Can we use `element.attr('data-htmx-activated')` instead of `element.hasAttribute(...)`?

### Request API
6. **Element/event requirement** - Should `htmx.ajax()` require an element and event, or allow fully detached requests?
7. **`htmx.fetch()` and `htmx.settle()`** - These are called but not defined. What do they do?
8. **Custom fetch** - How to allow users to override fetch? `htmx.config.request.fetch = customFetch`?

### Type Classes
9. **HtmxElement, HtmxRequest, HtmxResponse, HtmxSwap** - Should we use classes instead of plain objects to:
   - Provide cleaner API with methods
   - Make detail structure self-documenting
   - Enable IDE autocompletion

   ```javascript
   // Instead of:
   detail.request.headers['X-Custom'] = 'value'

   // Could be:
   request.setHeader('X-Custom', 'value')
   ```

### Other
10. **Scroll/show modifier structure** - nested vs flat, exact field names
11. **XPath dependency** - hx-on uses XPath for efficiency; acceptable for all environments?
12. **Async handler behavior** - should all handlers support async/await?
