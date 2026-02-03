# htmx 4.0 Architecture

```javascript
// ╔═══════════════════════════════════════════════════════════════════════════════╗
// ║ HTMX 4.0                                                                      ║
// ║                                                                               ║
// ║ Principles:                                                                   ║
// ║ 1. Kernel: activation, triggers, verbs, fetch, swap, events                   ║
// ║ 2. Features: middleware that modify request/response/swap in definition order ║
// ║ 3. Clean DOM: WeakMap for state, no element._htmx                             ║
// ║ 4. JIT: read attributes when needed, not upfront                              ║
// ║ 5. Wrapped elements: element.attr(), element.find(), element.emit()        ║
// ╚═══════════════════════════════════════════════════════════════════════════════╝

var htmx = (function() {
    'use strict'
    
    // ═══════════════════════════════════════════════════════════════════════════
    // SECTION 1: CORE
    // ═══════════════════════════════════════════════════════════════════════════
    
    
    // ───────────────────────────────────────────────────────────────────────────
    // 1.1 STATE - WeakMap for per-element data (replaces element._htmx)
    // ───────────────────────────────────────────────────────────────────────────
    
    const _state = new WeakMap()
    
    const state = {
        get(element) {
            let elementState = _state.get(element)
            if (!elementState) {
                elementState = {
                    trigger: {
                        listeners: [],    // [{ target, event, handler }] - for cleanup
                        observers: [],    // [IntersectionObserver] - for cleanup
                        intervals: [],    // [id] - setInterval IDs (for `every`)
                        timeouts: [],     // [id] - setTimeout IDs (for `delay`)
                    },
                    request: {
                        queue: null,      // RequestQueue instance (for hx-sync)
                        controller: null, // Current AbortController
                    },
                    cache: {
                        etag: null,       // Last ETag for conditional requests
                    },
                }
                _state.set(element, elementState)
            }
            return elementState
        },
        has(element) {
            return _state.has(element)
        },
        delete(element) {
            _state.delete(element)
        },
    }
    
    
    // ───────────────────────────────────────────────────────────────────────────
    // 1.2 CONFIG
    // ───────────────────────────────────────────────────────────────────────────
    
    const config = {
        
        // ─── Request defaults (Fetch API options) ───────────────────────────────
        request: {
            credentials: 'same-origin',
            mode: 'same-origin',
            
            // Static headers - sent with every request
            // Dynamic headers (HX-Current-URL, HX-Target) added by 'dynamicHeaders' feature
            headers: {
                'HX-Request': 'true',
            },
        },
        
        // ─── Swap defaults ──────────────────────────────────────────────────────
        swap: {
            method: 'innerHTML',
            target: 'this',
            
            // Modifier defaults - features read these and apply their behavior
            // Set htmx.config.swap.modifiers.transition = true to enable globally
            // Or use hx-swap="innerHTML transition:true" per-element
            modifiers: {
                transition: false,    // View Transitions API (feature: 'transition')
                ignoreTitle: false,   // Don't update document.title (feature: 'title')
                scroll: null,         // { target, position } (feature: 'scroll')
                show: null,           // { target, position } (feature: 'show')
                focus: null,          // Selector to focus (feature: 'focus')
                swapDelay: 0,         // Delay before swap in ms (feature: 'timing')
                settleDelay: 20,      // Delay for settle in ms (feature: 'timing')
            },
        },
        
        // ─── Trigger defaults ───────────────────────────────────────────────────
        trigger: {
            // Which event to listen for, by element type
            // '*' is the fallback for elements not matching other selectors
            events: {
                '*': 'click',
                'form': 'submit',
                'input:not([type=button]), select, textarea': 'change',
            },
            
            // Modifier defaults - features read these
            modifiers: {
                delay: 0,
                throttle: 0,
            },
        },
        
        // ─── Syntax ─────────────────────────────────────────────────────────────
        syntax: {
            prefix: 'hx-',
            delimiter: ':',
            format: RelaxedJSON,      // Pluggable parser - must have parse(str) method
                                      // Users can swap: htmx.config.syntax.format = JSON
        },
        
        // ─── Inheritance ────────────────────────────────────────────────────────
        inheritance: {
            enabled: true,
            mode: 'explicit',         // 'explicit' requires marker, 'implicit' auto-inherits
            marker: 'inherited',      // e.g. hx-target:inherited
        },
        
        // ─── Security ───────────────────────────────────────────────────────────
        security: {
            allowEval: true,          // Allow js: in attributes
            nonce: null,              // CSP nonce for inline scripts/styles
        },
        
        // ─── CSS classes ────────────────────────────────────────────────────────
        classes: {
            indicator: 'htmx-indicator',
            request: 'htmx-request',
            swapping: 'htmx-swapping',
            settling: 'htmx-settling',
            added: 'htmx-added',
        },
        
        debug: false,
    }
    
    
    // ───────────────────────────────────────────────────────────────────────────
    // 1.3 PARSE - Attribute value parser
    // ───────────────────────────────────────────────────────────────────────────
    
    // htmx.parse('innerHTML swap:100ms transition:true', 'method')
    // → { method: 'innerHTML', swap: '100ms', transition: 'true' }
    //
    // htmx.parse('click delay:500ms changed', 'event')
    // → { event: 'click', delay: '500ms', changed: true }
    //
    // Uses config.syntax.format for the actual parsing (pluggable).
    // The firstKey parameter names the first unnamed token.
    
    function parse(str, firstKey) {
        // If string looks like JSON, use format.parse directly
        if (str.trim().startsWith('{')) {
            return config.syntax.format.parse(str)
        }
        
        const result = {}
        const tokens = str.trim().split(/\s+/)
        
        tokens.forEach((token, i) => {
            if (i === 0 && firstKey && !token.includes(':')) {
                // First token without colon gets the firstKey name
                result[firstKey] = token
            } else if (token.includes(':')) {
                // key:value pair
                const [key, value] = token.split(':')
                result[key] = value
            } else {
                // Boolean flag
                result[token] = true
            }
        })
        
        return result
    }
    
    // RelaxedJSON - default parser that handles htmx attribute syntax
    // Supports: key:value pairs, boolean flags, JSON objects
    const RelaxedJSON = {
        parse(str) {
            if (str.trim().startsWith('{')) {
                return JSON.parse(str)
            }
            // Parse key:value and boolean flags
            const result = {}
            str.trim().split(/\s*,\s*|\s+/).forEach(token => {
                if (token.includes(':')) {
                    const [key, value] = token.split(':')
                    result[key] = value
                } else if (token) {
                    result[token] = true
                }
            })
            return result
        }
    }
    
    
    // ───────────────────────────────────────────────────────────────────────────
    // 1.4 EVENTS - 7 total, no before/after pairs
    // ───────────────────────────────────────────────────────────────────────────
    //
    // Features run in definition order. First to return false cancels.
    //
    // Event              Detail
    // ─────────────────────────────────────────────────────────────────────────
    // htmx:init          {}
    // htmx:activate      { element }
    // htmx:deactivate    { element }
    // htmx:request       { trigger: { element, event }, request, swap }
    // htmx:response      { trigger: { element, event }, request, response, swap }
    // htmx:swap          { trigger: { element, event }, request, response, swap }
    // htmx:done          { trigger: { element, event }, request, response, swap, error }
    
    
    // ───────────────────────────────────────────────────────────────────────────
    // 1.5 REQUEST LIFECYCLE
    // ───────────────────────────────────────────────────────────────────────────
    //
    // This shows the complete flow and where objects are created/modified.
    
    async function issueRequest(triggerElement, triggerEvent) {
        const element = wrap(triggerElement)

        // ─── Build request (Fetch API compatible) ───────────────────────────────
        // Kernel creates with config defaults. Features modify during htmx:request.
        const controller = new AbortController()
        state.get(triggerElement).request.controller = controller
        
        const request = {
            url: '',                                    // Set by kernel from hx-get/post/etc
            method: 'GET',                              // Set by kernel from hx-get/post/etc
            headers: { ...config.request.headers },     // Static headers from config
            body: null,                                 // Features populate (form data, hx-vals)
            signal: controller.signal,
            credentials: config.request.credentials,
            mode: config.request.mode,
        }
        // Example after features run:
        // {
        //     url: '/api/users',
        //     method: 'POST',
        //     headers: {
        //         'HX-Request': 'true',
        //         'HX-Current-URL': 'http://localhost/page',  // added by dynamicHeaders
        //         'HX-Target': '#results',                    // added by dynamicHeaders
        //         'X-CSRF-Token': 'abc123',                   // added by csrf feature
        //     },
        //     body: FormData { name: 'John', email: '...' },
        //     signal: AbortSignal,
        //     credentials: 'same-origin',
        //     mode: 'same-origin',
        // }
        
        // ─── Build swap (DOM mutation instructions) ─────────────────────────────
        // Kernel creates with config defaults. Features modify during htmx:request.
        const swap = {
            method: config.swap.method,
            target: config.swap.target,                 // Selector string, resolved JIT
            modifiers: { ...config.swap.modifiers },
        }
        // Example after features run:
        // {
        //     method: 'innerHTML',
        //     target: '#results',                      // Still a selector here
        //     modifiers: {
        //         transition: true,
        //         swapDelay: 100,
        //         settleDelay: 20,
        //         select: '.content',                  // Added by hx-select feature
        //     },
        // }
        
        // ─── Detail object (passed to all events) ───────────────────────────────
        const detail = {
            trigger: {
                element,                                // Wrapped element
                event: triggerEvent,                    // Original DOM event
            },
            request,
            response: null,                             // Set after fetch
            swap,
            error: null,                                // Set if something fails
            
            // Transient state - features attach here, GC'd when request completes
            // Examples:
            //   detail.indicators = [...]              // hx-indicator feature
            //   detail.disabled = [...]                // hx-disable feature  
            //   detail.timeoutId = 123                 // timeout feature
            //   detail.historyPath = '/new-url'        // history feature
        }
        
        try {
            // ─── htmx:request ───────────────────────────────────────────────────
            // Features can: modify request/swap, add transient state, cancel
            if (!trigger('htmx:request', detail)) return
            
            // ─── Fetch ─────────────────────────────────────────────────────────
            const fetchResponse = await fetch(request.url, request)
            
            // ─── Build response (immutable snapshot) ────────────────────────────
            const headers = {}
            fetchResponse.headers.forEach((v, k) => headers[k.toLowerCase()] = v)
            
            detail.response = {
                status: fetchResponse.status,
                url: fetchResponse.url,
                headers,                                // Lowercase keys
                text: await fetchResponse.text(),
            }
            // Example:
            // {
            //     status: 200,
            //     url: 'http://localhost/api/users',
            //     headers: {
            //         'content-type': 'text/html',
            //         'hx-trigger': 'userAdded',
            //         'hx-push-url': '/users/123',
            //     },
            //     text: '<div id="results">...</div>',
            // }
            
            // ─── htmx:response ──────────────────────────────────────────────────
            // Features can: read response, modify swap, cancel
            if (!trigger('htmx:response', detail)) return
            
            // ─── Resolve target JIT ─────────────────────────────────────────────
            swap.target = resolveTarget(triggerElement, swap.target)
            
            // ─── Parse fragment ─────────────────────────────────────────────────
            swap.fragment = makeFragment(detail.response.text)
            
            // ─── htmx:swap ──────────────────────────────────────────────────────
            // Features can: manipulate fragment, perform OOB swaps, cancel
            if (!trigger('htmx:swap', detail)) return
            
            // ─── Kernel performs swap ───────────────────────────────────────────
            performSwap(swap)
            
        } catch (e) {
            detail.error = e
        } finally {
            // ─── htmx:done ──────────────────────────────────────────────────────
            // Always fires. Features clean up transient state here.
            trigger('htmx:done', detail)
            
            state.get(triggerElement).request.controller = null
        }
    }


// ═══════════════════════════════════════════════════════════════════════════════
// SECTION 2: FEATURES
// ═══════════════════════════════════════════════════════════════════════════════
```

---

## The Features Object

Features are defined in order. The object key order IS the execution order.

```javascript
htmx.features = {
    
    // ═══════════════════════════════════════════════════════════════════════════
    // DEFAULT TRIGGERS - Assign default events based on element type
    // ═══════════════════════════════════════════════════════════════════════════
    'defaultTriggers': {
        defaults: {
            'form': 'submit',
            'input:not([type=button])': 'change',
            'select': 'change',
            'textarea': 'change',
        },
        on: {
            'htmx:activate': ({ feature, element, trigger }) => {
                if (trigger.event) return;  // Skip if explicit hx-trigger present

                for (const [selector, eventName] of Object.entries(feature.defaults)) {
                    if (element.matches(selector)) {
                        trigger.event = eventName
                        return
                    }
                }
            }
        }    
    },

    // ═══════════════════════════════════════════════════════════════════════════
    // hx-boost
    // ═══════════════════════════════════════════════════════════════════════════

    'hx-boost': {
        on: {
            'htmx:activate': ({element}) => {
                if (element.attr('hx-boost') !== 'true') return

                for (const link of element.native.querySelectorAll('a')) {
                    if (link.hasAttribute('data-htmx-boosted')) continue
                    if (link.closest('[hx-boost="false"]')) continue
                    if (link.target === '_blank') continue
                    if (!link.href || link.href.includes('#')) continue
                    if (!htmx.isSameOrigin(link.href)) continue

                    link.toggleAttribute('data-htmx-boosted', true)
                    const handler = htmx.createRequestHandler(link)
                    link.addEventListener('click', handler)
                    htmx.state.get(link).listeners = [{target: link, event: 'click', handler}]
                }

                for (const form of element.native.querySelectorAll('form')) {
                    if (form.hasAttribute('data-htmx-boosted')) continue
                    if (form.closest('[hx-boost="false"]')) continue
                    if (form.method === 'dialog') continue
                    if (!htmx.isSameOrigin(form.action)) continue

                    form.toggleAttribute('data-htmx-boosted', true)
                    const handler = htmx.createRequestHandler(form)
                    form.addEventListener('submit', handler)
                    htmx.state.get(form).listeners = [{target: form, event: 'submit', handler}]
                }
            }
        }
    },

    'hx-on': {
        on: {
            'htmx:activate': ({element}) => {
                const prefix = htmx.config.syntax.prefix
                const xpathQuery = `.//*[@*[starts-with(name(), "${prefix}on:")]]`

                const xpath = new XPathEvaluator().createExpression(xpathQuery)
                const iter = xpath.evaluate(element.native, XPathResult.UNORDERED_NODE_ITERATOR_TYPE)

                let node
                while (node = iter.iterateNext()) {
                    htmx.processHxOnAttributes(node)
                }

                htmx.processHxOnAttributes(element.native)
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
            'htmx:request': ({feature, element, swap}) => {
                // Start with defaults
                swap.method = feature.method
                swap.target = feature.target
                swap.select = null
                swap.selectOOB = null
                swap.modifiers = {...feature.modifiers}

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
            'htmx:request': async ({trigger: {element}}) => {
                const question = element.attr('hx-confirm')
                if (!question) return

                const allowed = await element.emit('htmx:confirm', {question})

                if (!allowed || !window.confirm(question)) {
                    return false
                }
            }
        }
    },

    'hx-headers': {
        on: {
            'htmx:request': async ({trigger: {element}, request}) => {
                const value = element.attr('hx-headers')
                if (!value) return

                let headers
                if (value.startsWith('js:') || value.startsWith('javascript:')) {
                    let code = value.startsWith('js:') ? value.slice(3) : value.slice(11)
                    if (!code.trimStart().startsWith('{')) code = `{ ${code} }`
                    headers = await htmx.eval(code, {element: element.native})
                } else {
                    headers = htmx.parse(value)
                }

                Object.assign(request.headers, headers)
            }
        }
    },

    'hx-vals': {
        on: {
            'htmx:request': async ({trigger: {element}, request}) => {
                const value = element.attr('hx-vals')
                if (!value) return

                let vals
                if (value.startsWith('js:') || value.startsWith('javascript:')) {
                    // Extract JS code
                    let code = value.startsWith('js:') ? value.slice(3) : value.slice(11)
                    // Wrap in {} if not already an object literal (convenience)
                    if (!code.trimStart().startsWith('{')) code = `{ ${code} }`
                    vals = await htmx.eval(code, {element: element.native})
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
            'htmx:request': ({trigger: {element}, request}) => {
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
            'htmx:request': ({trigger: {element}, request}) => {
                // Validation is element-specific, don't inherit from ancestors
                const validate = element.attr('hx-validate', {inherit: false})
                if (validate !== null) request.validate = validate !== 'false'
            }
        }
    },

    'hx-encoding': {
        on: {
            'htmx:request': ({trigger: {element}, request}) => {
                const encoding = element.attr('hx-encoding')
                if (encoding) request.encoding = encoding
            }
        }
    },

    'hx-indicator': {
        on: {
            'htmx:request': ({trigger: {element}, request}) => {
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

            'htmx:done': ({request}) => {
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
            'htmx:request': ({trigger: {element}, request}) => {
                const selector = element.attr('hx-disable')
                if (!selector) return

                // Store on request detail (transient, per-request)
                request.disabled = element.findAll(selector)

                for (const target of request.disabled) {
                    target._htmxDisableCount = (target._htmxDisableCount || 0) + 1
                    target.disabled = true
                }
            },

            'htmx:done': ({request}) => {
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
            'htmx:request': ({trigger: {element}, request}) => {
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
            'htmx:request': ({trigger: {element}, request, swap}) => {
                const value = element.attr('hx-config')
                if (!value) return

                htmx.mergeConfig(value, {request, swap})
            }
        }
    },

    // ═══════════════════════════════════════════════════════════════════════════
    // TIMEOUT - Uses AbortController signal to abort after delay
    // ═══════════════════════════════════════════════════════════════════════════

    'timeout': {
        delay: 60000,                 // Default 60 seconds

        on: {
            'htmx:request': ({feature, element, detail}) => {
                const timeout = element.attr('hx-timeout')
                    ?? feature.delay
                if (!timeout) return

                const state = htmx.state.get(element.native)
                detail.timeoutId = setTimeout(() => {
                    state.controller?.abort()
                }, htmx.parseInterval(timeout))
            },

            'htmx:done': ({detail}) => {
                if (detail.timeoutId) {
                    clearTimeout(detail.timeoutId)
                }
            }
        }
    },

    // ═══════════════════════════════════════════════════════════════════════════
    // RESPONSE PROCESSING - After fetch, before swap
    // ═══════════════════════════════════════════════════════════════════════════

    'noSwap': {
        statusCodes: [204, 304],

        on: {
            'htmx:response': ({feature, response, swap}) => {
                if (feature.statusCodes.includes(response.status)) {
                    swap.method = 'none'
                }
            }
        }
    },

    'responseHeaders': {
        on: {
            'htmx:response': ({trigger: {element}, response, swap}) => {
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
            'htmx:request': ({trigger: {element}, request}) => {
                const etag = htmx.state.get(element.native).etag
                if (etag) request.headers['If-None-Match'] = etag
            },

            'htmx:response': ({trigger: {element}, response}) => {
                const etag = response.headers['etag']  // lowercase
                if (etag) htmx.state.get(element.native).etag = etag
            }
        }
    },

    'hx-status': {
        on: {
            'htmx:response': ({trigger: {element}, response, swap, request}) => {
                const status = response.status.toString()
                const patterns = [status, status.slice(0, 2) + 'x', status[0] + 'xx']

                for (const pattern of patterns) {
                    const value = element.attr(`hx-status:${pattern}`)
                    if (value) {
                        htmx.mergeConfig(value, {request, swap})
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
            'htmx:response': async ({feature, request, response, swap}) => {
                if (!response.headers['content-type']?.includes('text/event-stream')) return

                swap.method = 'none'

                // Parse SSE stream, emit htmx:sse:message events,
                // swap each message, handle reconnection with exponential backoff,
                // pause when document hidden if pauseInBackground enabled
            }
        }
    },

    // ═══════════════════════════════════════════════════════════════════════════
    // SWAP PROCESSING - Runs during htmx:swap, before DOM mutation
    // Features here manipulate swap.fragment before kernel performs swap
    // ═══════════════════════════════════════════════════════════════════════════

    'select': {
        on: {
            'htmx:swap': ({trigger: {element}, swap}) => {
                // hx-select: extract only matching elements from response
                const selector = element.attr('hx-select')
                    ?? swap.modifiers.select
                if (!selector || !swap.fragment) return

                const selected = swap.fragment.querySelectorAll(selector)
                const newFragment = document.createDocumentFragment()
                newFragment.append(...selected)
                swap.fragment = newFragment
            }
        }
    },

    'oob': {
        on: {
            'htmx:swap': ({trigger: {element}, swap}) => {
                if (!swap.fragment) return

                // Process hx-select-oob attribute (from triggering element)
                const selectOOB = element.attr('hx-select-oob')
                if (selectOOB) {
                    for (const spec of selectOOB.split(',')) {
                        const [selector, targetSpec] = spec.trim().split(':')
                        for (const el of swap.fragment.querySelectorAll(selector)) {
                            htmx.swapOOB(el, targetSpec || 'true')
                            el.remove()  // Remove from main fragment
                        }
                    }
                }

                // Process elements with hx-swap-oob attribute (in response)
                for (const el of swap.fragment.querySelectorAll('[hx-swap-oob]')) {
                    const oobValue = el.getAttribute('hx-swap-oob')
                    el.removeAttribute('hx-swap-oob')
                    htmx.swapOOB(el, oobValue)
                    el.remove()  // Remove from main fragment
                }
            }
        }
    },

    // ═══════════════════════════════════════════════════════════════════════════
    // POST-SWAP - After content is in DOM
    // ═══════════════════════════════════════════════════════════════════════════

    'title': {
        on: {
            'htmx:done': ({response, swap}) => {
                if (response.title && !swap.modifiers.ignoreTitle) {
                    document.title = response.title
                }
            }
        }
    },

    'history': {
        reload: false,

        on: {
            'htmx:init': ({feature}) => {
                if (!history.state) {
                    history.replaceState({htmx: true}, '', location.pathname + location.search)
                }

                window.addEventListener('popstate', (event) => {
                    if (!event.state?.htmx) return
                    htmx.restoreHistory()
                })
            },

            'htmx:request': ({trigger: {element}, request}) => {
                // Capture at request time, store on request detail (survives element removal)
                // History attributes are element-specific, don't inherit
                request.historyPush = element.attr('hx-push-url', {inherit: false})
                request.historyReplace = element.attr('hx-replace-url', {inherit: false})
            },

            'htmx:done': ({request, response}) => {
                const push = request.historyPush
                const replace = request.historyReplace

                if (push && push !== 'false') {
                    const path = push === 'true' ? response.url : push
                    history.pushState({htmx: true}, '', path)
                    htmx.trigger('htmx:history:push', {path})
                }

                if (replace && replace !== 'false') {
                    const path = replace === 'true' ? response.url : replace
                    history.replaceState({htmx: true}, '', path)
                    htmx.trigger('htmx:history:replace', {path})
                }
            }
        }
    },

    // ═══════════════════════════════════════════════════════════════════════════
    // STYLES - Inject indicator CSS
    // ═══════════════════════════════════════════════════════════════════════════

    'injectStyles': {
        on: {
            'htmx:init': () => {
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
            'htmx:init': () => {
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

```javascript
htmx.config = {

    // ═══════════════════════════════════════════════════════════════════════════
    // KERNEL - Request defaults (Fetch API options)
    // ═══════════════════════════════════════════════════════════════════════════

    request: {
        credentials: 'same-origin',
        mode: 'same-origin',

        headers: {
            'HX-Request': 'true',
            'Accept': 'text/html, text/event-stream',
        },
    },

    // NOTE: timeout is a FEATURE config, not here. See htmx.features['timeout']

    // ═══════════════════════════════════════════════════════════════════════════
    // KERNEL - Swap defaults
    // ═══════════════════════════════════════════════════════════════════════════

    swap: {
        method: 'innerHTML',
        target: 'this',
    },

    // ═══════════════════════════════════════════════════════════════════════════
    // KERNEL - Trigger defaults
    // ═══════════════════════════════════════════════════════════════════════════

    trigger: {
        default: 'click',
        defaults: {
            'form': 'submit',
            'input:not([type=button])': 'change',
            'select': 'change',
            'textarea': 'change',
        },
    },

    // ═══════════════════════════════════════════════════════════════════════════
    // KERNEL - Syntax configuration
    // ═══════════════════════════════════════════════════════════════════════════

    syntax: {
        prefix: 'hx-',
        delimiter: ':',
        format: RelaxedJSON,  // Object with parse(str) and stringify(obj) methods
    },

    // ═══════════════════════════════════════════════════════════════════════════
    // KERNEL - Inheritance behavior
    // ═══════════════════════════════════════════════════════════════════════════

    inheritance: {
        enable: true,
        mode: 'explicit',     // 'explicit' requires marker, 'implicit' auto-inherits
        marker: 'inherited',  // produces "hx-target:inherited"
    },

    // ═══════════════════════════════════════════════════════════════════════════
    // KERNEL - Security
    // ═══════════════════════════════════════════════════════════════════════════

    security: {
        allowEval: true,      // Set false to disable js:/javascript: in attributes
        nonce: null,          // CSP nonce for inline scripts/styles
    },

    // ═══════════════════════════════════════════════════════════════════════════
    // KERNEL - CSS classes used by features
    // ═══════════════════════════════════════════════════════════════════════════

    classes: {
        indicator: 'htmx-indicator',
        request: 'htmx-request',
        swapping: 'htmx-swapping',
        settling: 'htmx-settling',
        added: 'htmx-added',
    },

    // ═══════════════════════════════════════════════════════════════════════════
    // DEBUG
    // ═══════════════════════════════════════════════════════════════════════════

    debug: false,
}

// ═══════════════════════════════════════════════════════════════════════════════
// FEATURE CONFIGS - Live on the feature, not htmx.config
// ═══════════════════════════════════════════════════════════════════════════════

// htmx.features['timeout'].delay = 60000
// htmx.features['morph'].scanLimit = 10
// htmx.features['sse'].reconnect = { ... }

// Access via: htmx.features['timeout'].delay
// Or define alias: get timeout() { return htmx.features['timeout'] }
```

---

## Kernel Implementation

### attrName() - Transform canonical name to configured syntax

```javascript
htmx.attrName = function (canonical) {
    const {prefix, delimiter} = htmx.config.syntax

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
htmx.attr = function (element, name, {inherit = true} = {}) {
    const {enable, mode, marker} = htmx.config.inheritance
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
htmx.parse = function (str) {
    return htmx.config.syntax.format.parse(str)
}

htmx.stringify = function (obj) {
    return htmx.config.syntax.format.stringify(obj)
}

// Usage:
htmx.parse('method:innerHTML, swap:100ms')  // Uses RelaxedJSON by default
htmx.stringify({method: 'innerHTML'})

// Users can swap the parser:
htmx.config.syntax.format = JSON  // Use standard JSON instead
```

### eval() - Execute JavaScript with context

```javascript
htmx.eval = async function (code, context = {}) {
    if (!htmx.config.security.allowEval) {
        console.warn('htmx: JS evaluation disabled (security.allowEval = false)')
        return undefined
    }

    const args = {htmx, ...context}
    const keys = Object.keys(args)
    const values = Object.values(args)

    const AsyncFunction = Object.getPrototypeOf(async function () {
    }).constructor
    const fn = new AsyncFunction(...keys, `return (${code})`)

    return await fn(...values)
}
```

### resolveTarget() - Find target element with smart defaults

```javascript
htmx.resolveTarget = function (element, selector) {
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

htmx.wrap = function (element) {
    if (element[WRAPPED]) return element  // Already wrapped, idempotent

    return new Proxy(element, {
        get(target, prop) {
            if (prop === WRAPPED) return true
            if (prop === 'native') return target
            if (prop === 'is') return (other) => target === (other?.[WRAPPED] ? other.native : other)
            if (prop === 'attr') return (name, opts) => htmx.attr(target, name, opts)
            if (prop === 'find') return (selector) => htmx.find(target, selector)
            if (prop === 'findAll') return (selector) => htmx.findAll(target, selector)
            if (prop === 'emit') return (eventName, detail) => htmx.emit(target, eventName, detail)
            if (prop === 'trigger') return (eventName, detail) => htmx.emit(target, eventName, detail)  // alias

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
'htmx:request': ({trigger: {element}}) => {
    // Powered-up methods
    const target = element.attr('hx-target')
    const inputs = element.findAll('input')
    const form = element.find('closest form')
    element.emit('htmx:confirm', { question })

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
htmx.trigger = function (element, eventName, detail = {}) {
    // element is optional - defaults to document for global events
    if (typeof element === 'string') {
        detail = eventName || {}
        eventName = element
        element = document
    }

    // Wrap trigger.element so features get powered-up elements
    if (detail.trigger?.element) {
        detail = {
            ...detail,
            trigger: {...detail.trigger, element: htmx.wrap(detail.trigger.element)}
        }
    }

    // 1. Run features in definition order
    for (const [name, featureDef] of Object.entries(htmx.features)) {
        if (featureDef.enable === false) continue

        const handler = featureDef.on?.[eventName]
        if (!handler) continue

        const result = handler({...detail, feature: featureDef})

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

### register() - Add features with dependency-based ordering

```javascript
htmx.register = function (name, feature) {
    features[name] = feature

    // Apply overrides
    if (feature.override) {
        for (const [fn, wrapper] of Object.entries(feature.override)) {
            const original = kernel[fn]
            kernel[fn] = (...args) => wrapper(original, ...args)
        }
    }

    // Re-sort features topologically based on requires
    topologicalSort()
}
```

The kernel validates the dependency graph on every registration:
- Missing dependency → `console.warn('Feature "oob" requires "select" which is not registered')`
- Circular dependency → `console.error('Circular dependency: oob → select → oob')`

### activate() - Process an element

```javascript
htmx.activate = function (element) {
    element = htmx.wrap(element)

    if (element.hasAttribute('data-htmx-activated')) return

    element.emit('htmx:activate', {element})

    element.toggleAttribute('data-htmx-activated', true)
    element.native._htmx = {listeners: []}

    // Bind trigger if element has hx-get, hx-post, hx-put, hx-patch, or hx-delete
    const hasVerb = ['get', 'post', 'put', 'patch', 'delete'].some(v =>
        element.attr(`hx-${v}`, {inherit: false})
    )

    if (hasVerb) {
        // Determine event to listen for
        let event = element.attr('hx-trigger') || htmx.config.trigger.default
        for (const [selector, evt] of Object.entries(htmx.config.trigger.defaults)) {
            if (element.matches(selector)) {
                event = evt;
                break
            }
        }

        // Bind listener
        const handler = htmx.createRequestHandler(element.native)
        element.addEventListener(event, handler)
        element.native._htmx.listeners.push({eventName: event, handler})
    }

    element.emit('htmx:activate', {element})
}
```

### deactivate() - Cleanup an element

```javascript
htmx.deactivate = function (element) {
    element = htmx.wrap(element)

    if (!element.hasAttribute('data-htmx-activated')) return

    element.emit('htmx:deactivate', {element})

    // Remove listeners
    for (const {eventName, handler} of element.native._htmx?.listeners || []) {
        element.removeEventListener(eventName, handler)
    }

    element.removeAttribute('data-htmx-activated')
    delete element.native._htmx

    element.emit('htmx:deactivate', {element})
}
```

### ajax() - Programmatic requests (public API)

```javascript
htmx.ajax = async function (verb, url, options = {}) {
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
            headers: {...htmx.config.request.headers, ...options.headers},
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
        if (!element.emit('htmx:request', detail)) return

        detail.response = await htmx.fetch(detail.request)

        element.emit('htmx:response', detail)

        if (!element.emit('htmx:swap', detail)) return
        htmx.performSwap(detail.swap)

        element.emit('htmx:settle', detail)
        await htmx.settle(detail.swap)

    } finally {
        element.emit('htmx:done', detail)
    }

    return detail.response
}

// Usage:
htmx.ajax('GET', '/api/users', {target: '#results'})
htmx.ajax('POST', '/api/submit', {
    source: '#my-form',
    target: '#response',
    swap: 'outerHTML',
    values: {name: 'John'},
    headers: {'X-Custom': 'value'}
})
```

### request() - Internal request from element interaction

```javascript
htmx.request = async function (element, event) {
    element = htmx.wrap(element)

    // Find verb and URL from hx-get, hx-post, hx-put, hx-patch, hx-delete
    let method, url
    for (const verb of ['get', 'post', 'put', 'patch', 'delete']) {
        url = element.attr(`hx-${verb}`, {inherit: false})
        if (url) {
            method = verb.toUpperCase();
            break
        }
    }
    if (!method) return

    const detail = {
        element,
        request: {
            method,
            url,
            element: element.native,
            event,
            headers: {...htmx.config.request.headers},
            body: new FormData(),
        },
        swap: {
            // Populated by hx-swap feature during htmx:request
        },
        response: null,
    }

    try {
        if (!element.emit('htmx:request', detail)) return

        detail.swap.target = htmx.resolveTarget(element.native, detail.swap.target || 'this')
        detail.response = await htmx.fetch(detail.request)

        element.emit('htmx:response', detail)

        if (!element.emit('htmx:swap', detail)) return
        htmx.performSwap(detail.swap)

        element.emit('htmx:settle', detail)
        await htmx.settle(detail.swap)

    } finally {
        element.emit('htmx:done', detail)
    }
}
```

---

## Element State

```javascript
// ═══════════════════════════════════════════════════════════════════════════════
// STATE STORAGE - Three categories
// ═══════════════════════════════════════════════════════════════════════════════

// ─────────────────────────────────────────────────────────────────────────────────
// 1. DATA ATTRIBUTES - CSS-targetable boolean flags
// ─────────────────────────────────────────────────────────────────────────────────

// Useful for CSS selectors (e.g., Tailwind `data-htmx-activated:opacity-50`)
element.toggleAttribute('data-htmx-activated', true)
element.toggleAttribute('data-htmx-boosted', true)

// Check
if (element.hasAttribute('data-htmx-activated')) return

// HTML result:
// <button hx-get="/api" data-htmx-activated>
// <a href="/page" data-htmx-boosted>


// ─────────────────────────────────────────────────────────────────────────────────
// 2. WEAKMAP STATE - Internal state (replaces element._htmx)
// ─────────────────────────────────────────────────────────────────────────────────

// See Section 1.5 for full structure
const s = htmx.state.get(element)
s.listeners.push({target, event, handler})
s.controller = new AbortController()
s.etag = response.headers['etag']

// Benefits:
// - Auto-GC when element removed (no memory leaks)
// - Clean DOM (no _htmx polluting elements)
// - Debuggable via htmx.state.get(element)


// ─────────────────────────────────────────────────────────────────────────────────
// 3. JIT FROM ATTRIBUTES - Never stored, always read fresh
// ─────────────────────────────────────────────────────────────────────────────────

// verb/url    → hx-get, hx-post, hx-put, hx-patch, hx-delete
// swap config → hx-swap, hx-target
// trigger     → hx-trigger
// everything  → read at the moment it's needed, not cached


// ─────────────────────────────────────────────────────────────────────────────────
// 4. TRANSIENT STATE - Per-request, on detail object
// ─────────────────────────────────────────────────────────────────────────────────

// See Section 1.6 - features attach to detail, GC'd when request completes
detail.indicators = [...]
detail.disabled = [...]
detail.historyPush = '/new-url'


// ═══════════════════════════════════════════════════════════════════════════════
// DATA FLOW
// ═══════════════════════════════════════════════════════════════════════════════

// 1. Activation
element.toggleAttribute('data-htmx-activated', true)
htmx.state.get(element).listeners = []

// 2. Trigger fires
// Read hx-* attributes JIT, build detail object

// 3. Request lifecycle  
// Features attach transient state to detail

// 4. Cleanup
for (const {target, event, handler} of htmx.state.get(element).listeners) {
    target.removeEventListener(event, handler)
}

// 5. Deactivation
element.removeAttribute('data-htmx-activated')
htmx.state.delete(element)
```

---

## Event Detail Structure

```javascript
// ═══════════════════════════════════════════════════════════════════════════════
// WHAT FEATURES RECEIVE
// ═══════════════════════════════════════════════════════════════════════════════

// Feature handlers get `feature` injected + `element` is wrapped
({ feature, element, event, request, response, swap }) => {
    element.attr('hx-target')    // powered-up method
    element.native               // access underlying DOM element
    feature.someConfig           // access feature's own config
}

// ═══════════════════════════════════════════════════════════════════════════════
// WHAT EXTERNAL LISTENERS RECEIVE
// ═══════════════════════════════════════════════════════════════════════════════

// DOM event listeners get same detail, but no `feature` injected
document.addEventListener('htmx:request', (e) => {
    const { trigger, request, swap } = e.detail
    trigger.element.attr('hx-swap')  // works - element is wrapped
    // no `feature` here
})

// ═══════════════════════════════════════════════════════════════════════════════
// DETAIL STRUCTURE BY EVENT
// ═══════════════════════════════════════════════════════════════════════════════

// htmx:init
{}                               // No detail, global startup

// htmx:activate / htmx:deactivate
{
    element: WrappedElement,     // The element being activated/deactivated
}

// htmx:request
{
    element: WrappedElement,     // Triggering element (wrapped)
    event: Event,                // DOM event (click, submit, etc.)
    request: {                   // Fetch API compatible - see Section 1.1
        url: '/api/endpoint',
        method: 'GET',
        headers: { ... },
        body: FormData | null,
        signal: AbortSignal,
        credentials: 'same-origin',
        mode: 'same-origin',
    },
    response: null,              // Not yet available
    swap: {                      // See Section 1.3
        method: 'innerHTML',
        target: '#results',      // Selector string, resolved JIT
        modifiers: { ... },
    },
}

// htmx:response
{
    element: WrappedElement,
    event: Event,
    request: { ... },            // Same as above
    response: {                  // Now available - see Section 1.2
        status: 200,
        url: 'https://...',
        headers: { ... },        // Lowercase keys
        text: '<div>...</div>',
    },
    swap: { ... },
}

// htmx:swap
{
    element: WrappedElement,
    event: Event,
    request: { ... },
    response: { ... },
    swap: {
        method: 'innerHTML',
        target: HTMLElement,     // NOW resolved to actual element
        modifiers: { ... },
        fragment: DocumentFragment,  // Parsed from response.text
    },
}

// htmx:done (finally - always fires, even on error)
{
    element: WrappedElement,
    event: Event,
    request: { ... },
    response: { ... } | null,    // null if fetch failed
    swap: { ... },
    error: Error | null,         // If something went wrong
}
```

---

## Registration Examples

### Simple feature (no dependencies)

```javascript
htmx.register('csrf', {
    on: {
        'htmx:request': ({request}) => {
            request.headers['X-CSRF-Token'] = document.querySelector('meta[name="csrf-token"]').content
        }
    }
})
```

### Feature with dependencies

```javascript
htmx.register('oob', {
    requires: ['select'],
    on: {
        'htmx:swap': ({swap}) => {
            // select already filtered the fragment
        }
    }
})
```

### Feature with config

```javascript
htmx.register('retryOnError', {
    maxRetries: 3,
    retryDelay: 1000,

    on: {
        'htmx:response': async ({feature, request, response, swap}) => {
            if (response.status >= 500 && request._retryCount < feature.maxRetries) {
                request._retryCount = (request._retryCount || 0) + 1
                await new Promise(r => setTimeout(r, feature.retryDelay))
                return htmx.fetch(request.url, request)
            }
        }
    }
})
```

### Feature with override

```javascript
htmx.register('extended-selectors', {
    override: {
        find(original, root, selector) {
            if (selector.startsWith('closest ')) return wrap(root.closest(selector.slice(8)))
            return original(root, selector)
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
        'htmx:swap': ({ swap }) => {
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
[htmx:activate] [hx-verb] ✓
[htmx:activate] [hx-trigger] ✓
[htmx:activate] [hx-boost] ✓

── click ──

[htmx:request] [hx-swap] ✓
[htmx:request] [hx-confirm] ✓
[htmx:request] [hx-headers] ✓
[htmx:request] [hx-indicator] ✓

── fetch GET /api → 200 ──

[htmx:response] [noSwap] ✓
[htmx:response] [responseHeaders] ✓
[htmx:response] [etag] ✓

[htmx:done] [title] ✓
[htmx:done] [history] ✓

[htmx:done] [hx-indicator] ✓
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
htmx.emit(element, eventName, detail)     // or htmx.emit(eventName, detail) for document
htmx.trigger(element, eventName, detail)  // alias for emit (backwards compat)
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
element.emit(eventName, detail)  // Trigger event on element
element.is(other)                   // Compare identity (works with wrapped or native)
element.native                      // Access underlying DOM element
htmx.resolveTarget(element, selector) // Find target with smart defaults
htmx.eval(code, context)             // Execute JavaScript with context
htmx.isSameOrigin(url)               // Check if URL is same origin
```

### Events

```javascript
// ═══════════════════════════════════════════════════════════════════════════════
// 7 CORE EVENTS - No before/after pairs. Order = feature definition order.
// ═══════════════════════════════════════════════════════════════════════════════

'htmx:init'         // Once on startup, no detail
'htmx:activate'     // Element processed: { element }
'htmx:deactivate'   // Element cleanup: { element }
'htmx:request'      // Before fetch: { trigger, request, swap }
'htmx:response'     // After fetch: { trigger, request, response, swap }
'htmx:swap'         // DOM mutation: { trigger, request, response, swap }
'htmx:done'         // Finally (cleanup): { trigger, request, response, swap, error }

// ═══════════════════════════════════════════════════════════════════════════════
// FEATURE-SPECIFIC EVENTS - Triggered by features, not kernel
// ═══════════════════════════════════════════════════════════════════════════════

'htmx:confirm'      // Triggered by hx-confirm feature
'htmx:history:push' // Triggered by history feature
'htmx:history:replace'
'htmx:sse:message'  // Triggered by sse feature
// ... features can define their own events
```

---

## Feature Extension Model

Features have two orthogonal extension points:

### 1. `on` — React to lifecycle events

Features declare handlers for kernel events. They observe and can cancel, but don't change what the kernel functions do.

```javascript
htmx.register('csrf', {
    on: {
        'htmx:request': ({request}) => {
            request.headers['X-CSRF-Token'] = getToken()
        }
    }
})
```

### 2. `override` — Wrap kernel functions

Features can wrap kernel functions to modify their behavior. Each overrideor receives the previous function (which may itself be a wrapped version) as the first argument. This creates a middleware chain where definition order = wrapping order (first registered = outermost, runs first).

```javascript
htmx.register('extended-selectors', {
    override: {
        find(original, root, selector) {
            if (selector.startsWith('closest ')) return wrap(root.closest(selector.slice(8)))
            if (selector.startsWith('next ')) return wrap(scanForward(root, selector.slice(5)))
            return original(root, selector)
        }
    }
})
```

The kernel maintains an internal `kernel` object holding the current (possibly wrapped) versions of overrideable functions. Internal code always calls `kernel.find(...)`, `kernel.fetch(...)`, etc. — never the raw functions directly. This ensures the override chain is always honored.

```javascript
// Inside the kernel:
const kernel = { find, findAll, fetch, swap, activate }

// Registration wraps:
function register(name, feature) {
    features[name] = feature
    if (feature.override) {
        for (const [fn, wrapper] of Object.entries(feature.override)) {
            const original = kernel[fn]
            kernel[fn] = (...args) => wrapper(original, ...args)
        }
    }
}
```

### When to use which

- **`on`** — The 90% case. Reacting to lifecycle events: adding headers, modifying swap config, reading response headers, cleanup. Declarative.
- **`override`** — The 10% escape hatch. Fundamentally altering kernel behavior: extended selector syntax, custom swap implementations (morph), request transformation (auth, caching, retries), custom activation scanning (hx-on:*, reactivity engines).

### Feature ordering: `requires`

Features declare dependencies via `requires`. The kernel topologically sorts features based on these declarations. No `before`/`after` — if you care about order, declare the dependency. If you don't declare it, you don't get ordering guarantees.

```javascript
htmx.register('oob', {
    requires: ['select'],
    on: {
        'htmx:swap': ({swap}) => {
            // select already filtered the fragment — guaranteed by requires
        }
    }
})
```

The kernel:
1. Topologically sorts features based on `requires`
2. Errors on cycles (`A requires B, B requires A`)
3. Warns on missing dependencies (`"Feature 'oob' requires 'select' which is not registered"`)
4. Runs features sequentially within each event, in sorted order
5. Features without `requires` get no ordering guarantee — the kernel may run them in any sequence

This means: if two features hook the same event and neither declares a dependency on the other, they must be independent. If they're not, that's a bug — add `requires`.

### Debug tracing

With `config.debug = true`, the kernel logs every feature handler invocation and every mutation to the `detail` object (via Proxy). This makes the feature execution chain fully observable:

```
[htmx:request] [hx-swap]    set swap.method = 'innerHTML'
[htmx:request] [csrf]       set request.headers.X-CSRF-Token = 'abc'
[htmx:request] [auth]       set request.headers.Authorization = 'Bearer ...'
```

### Examples of override in practice

**Morph swap:**
```javascript
htmx.register('morph', {
    override: {
        swap(original, content, options) {
            if (options.method === 'morph') {
                Idiomorph.morph(options.target, content)
                return []
            }
            return original(content, options)
        }
    }
})
```

**Auth headers via fetch overrideion:**
```javascript
htmx.register('auth', {
    override: {
        fetch(original, url, options) {
            options.headers = {...options.headers, 'Authorization': `Bearer ${getToken()}`}
            return original(url, options)
        }
    }
})
```

**Custom activation (e.g., hx-on:\* which needs attribute inspection):**
```javascript
htmx.register('hx-on', {
    override: {
        activate(original, root) {
            original(root)
            for (const el of root.querySelectorAll('*')) {
                for (const a of el.attributes) {
                    if (a.name.startsWith(attrName('hx-on'))) {
                        bindOnHandler(el, a)
                    }
                }
            }
        }
    }
})
```

### What should be overrideable (UNDECIDED)

The principle: only kernel functions that represent **policy decisions** (how things behave) should be overrideable. Functions that are **foundational mechanics** (how things work) should not.

Candidates for overrideable:

| Function | Use case | Status |
|----------|----------|--------|
| `find` / `findAll` | Extended selector syntax | Likely yes |
| `fetch` | Auth, caching, retries, abort | Likely yes |
| `swap` | Morph, animations, view transitions | Likely yes |
| `activate` | Custom attribute scanning, reactivity engines | Likely yes |
| `emit` | Event transformation, logging | Undecided |
| `attr` | Custom attribute resolution | Undecided — config.syntax may be sufficient |
| `makeFragment` | Custom HTML parsing | Undecided |

NOT overrideable (foundational):
- `config` — just data
- `state` — just a WeakMap wrapper
- `wrap` — proxy mechanics
- `register` — plugin loading
- `attrName` — pure config transformation

### Activation model with override

With `override.activate`, features can participate in activation without the kernel knowing what attributes they care about. The default htmx lifecycle (scan for hx-get/post/etc, bind triggers, fire fetch on event) is itself just the default `activate` implementation. Features can wrap it to add their own scanning.

This means a hypothetical reactivity engine or Datastar-like system could override `activate` and add its own attribute processing alongside (or instead of) the default htmx behavior.

### The "Datastar test"

The architecture should be powerful enough that someone could build a fundamentally different hypermedia pattern (like Datastar's signal-based reactivity) on the same foundation. With the override model:

- Intercept `activate` → scan for `data-model`, `data-text`, `data-show` instead of `hx-get`, `hx-post`
- Intercept `fetch` → replace with SSE connection
- Intercept `swap` → replace with signal-driven DOM binding
- Use `config.syntax.prefix = 'data-'`

The kernel provides: DOM observation, state management, event emission, element wrapping, feature registration. The lifecycle is policy, not identity.

---

## Open Questions

```javascript
// ═══════════════════════════════════════════════════════════════════════════════
// RESOLVED
// ═══════════════════════════════════════════════════════════════════════════════

// ✓ request structure    → Fetch API compatible: { url, method, headers, body, signal, credentials, mode }
// ✓ response structure   → Immutable: { status, url, headers, text }
// ✓ swap structure       → { method, target, fragment, perform() }
// ✓ element._htmx        → Replaced with WeakMap: htmx.state.get(element)
// ✓ timeout              → Feature, not kernel (uses signal to abort)
// ✓ select/selectOOB     → Features that modify swap, not core swap fields
// ✓ oob                  → Self-encapsulated feature
// ✓ event model          → 7 events, no before/after pairs
// ✓ detail structure     → { trigger: { element, event }, request, response, swap }
// ✓ htmx.fetch()         → Single entry point for requests (replaces ajax/request split)
// ✓ config.fetch          → Native fetch stored in config, replaceable by extensions
// ✓ emit() explicit args → No magic typeof overload, always emit(element, eventName, detail)
// ✓ find/findAll          → Return wrapped elements, support find(selector) and find(root, selector)
// ✓ resolveTarget         → To be eliminated; find() with override handles extended selectors
// ✓ feature extension     → Two mechanisms: `on` (react to events) + `override` (wrap kernel functions)


// ═══════════════════════════════════════════════════════════════════════════════
// TODO - NEEDS DISCUSSION
// ═══════════════════════════════════════════════════════════════════════════════

// 1. Exactly which kernel functions should be overrideable
//    - find, findAll, fetch, swap, activate are strong candidates
//    - emit, attr, makeFragment are undecided
//    - See "Feature Extension Model" section for full analysis

// 2. Should deactivate be a feature hook or kernel-only?
//    - WeakMap handles memory, but event listeners need explicit removal
//    - Reactivity/SSE features may need custom cleanup beyond AbortController

// 3. Activation scanning model
//    - Default: CSS selector-based (fast, for hx-get/post/etc)
//    - hx-on:* needs attribute name inspection (no CSS selector for attr name prefixes)
//    - override.activate handles this, but is querySelectorAll('*') acceptable?

// 4. Async feature handlers
//    - Should all feature handlers support async/await?
//    - How does cancellation work with async handlers in the `on` pipeline?
```