// noinspection ES6ConvertVarToLetConst
var htmx = (() => {

    // SECTION 1: CORE

    // 1.1 STATE - WeakMap for per-element data (replaces element._htmx)

    const _state = new WeakMap()

    const state = {
        get(element) {
            let s = _state.get(element)
            if (!s) {
                s = {
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
                _state.set(element, s)
            }
            return s
        },
        has(element) {
            return _state.has(element)
        },
        delete(element) {
            _state.delete(element)
        },
    }

    // HtmxElement: Enhanced wrapper around native DOM elements
    // Replaces the need for element._htmx scattered everywhere
    class HtmxElement {
        #htmxInstance
        #listeners
        #state

        constructor(native, htmxInstance) {
            this.native = native
            this.#htmxInstance = htmxInstance
            this.#listeners = []
            this.#state = {}

            // Create reactive state proxy (replaces element._htmx)
            this.htmx = this.#createReactiveState()

            // Store reference on native element for quick lookup
            native.__htmxElement = this
        }

        // Check if element is activated
        get isActivated() {
            return this.htmx.activated === true
        }

        // HtmxElement.from(nativeElement) factory method
        static from(nativeElement, htmx) {
            // TODO: Get rid of this
            // Return existing wrapper if already created
            // if (nativeElement.__htmxElement) {
            //     return nativeElement.__htmxElement
            // }

            const wrapper = new HtmxElement(nativeElement, htmx)

            return new Proxy(wrapper, {
                get(target, prop) {
                    // Check wrapper properties first
                    if (prop in target) return target[prop]

                    // Fall through to native element
                    const value = target.native[prop]
                    return typeof value === 'function' ? value.bind(target.native) : value
                },

                set(target, prop, value) {
                    // If property exists on wrapper, set it there
                    if (prop in target) {
                        target[prop] = value
                    } else {
                        // Otherwise set on native element
                        target.native[prop] = value
                    }
                    return true
                }
            })
        }

        // Create reactive state that syncs to DOM
        #createReactiveState() {
            const config = this.#htmxInstance.config

            return new Proxy(this.#state, {
                get: (target, key) => target[key],

                set: (target, key, value) => {
                    target[key] = value

                    // Sync to DOM if enabled
                    if (config.state.dom.enable) {
                        this.#syncStateToDOM(key, value)
                    }

                    return true
                },

                deleteProperty: (target, key) => {
                    delete target[key]

                    if (config.state.dom.enable) {
                        this.#syncStateToDOM(key, null)
                    }

                    return true
                }
            })
        }

        // Sync state to DOM attribute (data-htmx by default)
        #syncStateToDOM(key, value) {
            const config = this.#htmxInstance.config
            const sync = config.state.dom.sync
            const attr = config.state.dom.attribute
            const format = config.state.dom.format?.htmx || RelaxedJSON

            let shouldSync = false

            // Never serialize these (runtime only)
            if (sync.never.includes(key)) {
                shouldSync = false
            }
            // Always serialize these
            else if (sync.always.includes(key)) {
                shouldSync = true
            }
            // Debug-only states
            else if (sync.debug.includes(key) && config.debug.enable) {
                shouldSync = true
            }
            // For any other primitives, serialize them
            else if (
                typeof value === 'string' ||
                typeof value === 'number' ||
                typeof value === 'boolean'
            ) {
                shouldSync = true
            }

            // Don't sync objects/functions
            if (typeof value === 'object' || typeof value === 'function') {
                shouldSync = false
            }

            if (shouldSync) {
                // Apply custom serializer if exists
                const serializers = config.state.dom.serializers || {}
                let serializedValue = value
                if (serializers[key] && value !== null && value !== undefined) {
                    serializedValue = serializers[key](value)
                }

                // Update DOM attribute
                const current = format.parse(this.native.getAttribute(attr) || '')

                if (serializedValue === null || serializedValue === undefined) {
                    delete current[key]
                } else {
                    current[key] = serializedValue
                }

                const str = format.stringify(current)
                if (str) {
                    this.native.setAttribute(attr, str)
                } else {
                    this.native.removeAttribute(attr)
                }
            }
        }

        // Get/set attributes (respects custom prefix/delimiter/inheritance)
        attr(name, value) {
            if (value !== undefined) {
                const fullName = this.#resolveAttributeName(name)
                this.native.setAttribute(fullName, value)
                return this
            }
            return this.#htmxInstance.getAttribute(this.native, name)
        }

        // Resolve attribute name with prefix
        #resolveAttributeName(name) {
            // If name already has prefix, return as-is
            const prefix = this.#htmxInstance.config.syntax.prefix
            if (name.startsWith(prefix) || name.startsWith('data-')) {
                return name
            }
            return prefix + name
        }

        // Get all attribute names on this element
        getAttributeNames() {
            return Array.from(this.native.attributes).map(attr => attr.name)
        }

        // Check if element has an attribute
        hasAttr(name) {
            const fullName = this.#resolveAttributeName(name)
            return this.native.hasAttribute(fullName)
        }

        // Bind event with automatic cleanup on deactivate
        on(eventName, handler) {
            this.native.addEventListener(eventName, handler)
            this.#listeners.push({eventName, handler})
            return this
        }

        // Remove event listener
        off(eventName, handler) {
            this.native.removeEventListener(eventName, handler)
            this.#listeners = this.#listeners.filter(
                l => !(l.eventName === eventName && l.handler === handler)
            )
            return this
        }

        // Enhanced querying (supports 'closest foo', 'next bar', etc.)
        find(selector) {
            return this.#htmxInstance.find(this.native, selector)
        }

        findAll(selector) {
            return this.#htmxInstance.__queryAll(this.native, selector)
        }

        // Trigger event scoped to this element
        trigger(eventName, detail = {}) {
            return this.#htmxInstance.trigger(eventName, detail, this.native)
        }

        // Cleanup all listeners (called on deactivate)
        cleanup() {
            for (let {eventName, handler} of this.#listeners) {
                this.native.removeEventListener(eventName, handler)
            }
            this.#listeners = []
        }
    }

    class Htmx {
        #vocabulary = {
            VERB: 'get|post|put|patch|delete|stream|sse',

            BOOLEAN: 'true|false',
            CONFIG: '.+',

            SWAP_METHOD: 'innerHTML|outerHTML|beforebegin|afterbegin|beforeend|afterend|delete|none',

            EXTENDED_CSS_SELECTOR:
                '(?:this|window|document|body|(?:closest|next|previous|find)\\s+.+|<.+/>|.+)',

            EVENT: '[\\w:.-]+',
        }

        // The order of features here matters for synchronous handlers (definition order = execution order)
        // Async handlers are processed in parallel
        #defaultFeatures = {


            //====================================================================
            // GROUP 1: SECURITY & GUARDS (Run First)
            //====================================================================
            // TODO: Find a more elegant structure that can handle both simple cases, and complex features
            'hx-confirm': {
                enable: true,
                feature: class {
                    PATTERNS = {
                        name: 'hx-confirm',
                        value: /^.+$/
                    }

                    inheritable = true

                    on = {
                        "htmx:before:request": async ({element, event}) => {
                            const question = element.attr('hx-confirm')
                            if (!question) return

                            const allowed = await this.trigger("htmx:confirm", {
                                question,
                                triggeringEvent: event
                            }, element.native)

                            // If user called preventDefault() on htmx:confirm, we stop here
                            if (!allowed) {
                                event.preventDefault()
                                throw CANCELLED
                            }

                            // Default Native Behavior
                            // (Only runs if the custom event wasn't cancelled)
                            // Note: If the user handled the UI in step 1 but didn't cancel the event,
                            // this native box will still pop up. The standard pattern for custom UI
                            // is to preventDefault() in step 1 and handle the flow manually.
                            if (!window.confirm(question)) {
                                event.preventDefault()
                                throw CANCELLED
                            }
                        }
                    }
                }
            },

            'hx-boost': {
                enable: true,
                feature: class {
                    PATTERNS = {
                        name: 'hx-boost',
                        value: /^<BOOLEAN>$/
                    }

                    inheritable = true

                    on = {
                        'htmx:after:element:activate': ({element}) => {
                            const boostValue = element.attr('hx-boost')
                            if (boostValue !== 'true') return // Only handle hx-boost="true"

                            const candidates = element.findAll('a, form')

                            for (let candidate of candidates) {
                                // candidate is native element here, need to check if boosted
                                if (candidate.__htmxElement?.htmx?.boosted) continue

                                // Skip explicit ignore
                                if (candidate.closest('[hx-boost="false"]')) continue

                                // Filter Logic
                                const tagName = candidate.tagName.toLowerCase()

                                // Filter: Links
                                if (tagName === 'a') {
                                    if (candidate.getAttribute('target') === '_blank') continue
                                    if (!candidate.href || candidate.href.indexOf('#') > -1) continue
                                }

                                // Filter: Forms
                                if (tagName === 'form') {
                                    if (candidate.getAttribute('method') === 'dialog') continue
                                }

                                // Same-Origin Policy Check
                                const url = candidate.href || candidate.action
                                let isSameOrigin = false
                                try {
                                    const parsed = new URL(url, window.location.href)
                                    isSameOrigin = parsed.origin === window.location.origin
                                } catch (e) {
                                    isSameOrigin = false
                                }

                                if (!isSameOrigin) continue

                                // Apply the Boost - create HtmxElement for candidate
                                const candidateElement = candidate.__htmxElement || createHtmxElement(candidate, this)
                                candidateElement.htmx.boosted = true
                                candidateElement.htmx.activated = true

                                const handler = this.__createHtmxEventHandler(candidate)

                                // Bind the appropriate event
                                const triggerEvent = tagName === 'a' ? 'click' : 'submit'
                                candidate.addEventListener(triggerEvent, handler)

                                // Emit event (preserving error handling)
                                try {
                                    this.trigger('htmx:after:element:activate', {element: candidateElement}, candidate)
                                } catch (e) {
                                    if (e !== CANCELLED) throw e
                                }
                            }
                        }
                    }
                }
            },

            'hx-trigger': {
                enable: true,
                feature: class {
                    PATTERNS = {
                        name: 'hx-trigger',
                        value: /^<EVENT>\s*[^,]*(?:\s*,\s*<EVENT>\s*[^,]*)*$/
                    }

                    inheritable = false

                    on = {
                        'htmx:after:element:activate': ({element}) => {
                            const triggerSpec = element.attr('hx-trigger')
                            if (!triggerSpec) return

                            const specs = this.__parseTriggerSpecs(triggerSpec)
                            element.state.triggerSpecs = specs
                            element.state.listeners = []
                            specs.forEach(spec => this.__bindTriggerSpec(element.native, spec))
                        }
                    }
                }
            },

            'hx-ignore': {
                enable: true,
                on: {
                    'htmx:before:element:activate': ({event}) => event.preventDefault()
                }
            },

            // Dynamic attribute: hx-on:*
            'hx-on': {
                enable: true,
                feature: class {
                    PATTERNS = {
                        name: /^hx-on:(.+)$/,
                        value: /.*/
                    }

                    inheritable = false

                    on = {
                        "htmx:after:element:activate": ({element}) => {
                            // Scan element for all hx-on:* attributes
                            for (let attrName of element.getAttributeNames()) {
                                const match = attrName.match(this.PATTERNS.name)
                                if (!match) continue

                                const eventName = match[1]
                                const code = element.attr(attrName)

                                // Bind event with auto-cleanup
                                element.on(eventName, (event) => {
                                    // Inside the JS code, `this` will be the HtmxElement
                                    htmx.__executeJavaScript(element, {event}, code, false)
                                })
                            }
                        }
                    }
                }
            },

            // --- Verbs (Grouped via Regex) ---

            'hx-verb': {
                // Matches hx-get, hx-post, hx-put, etc.
                patterns: {name: /^hx-(<VERB>)$/},
                // These are primarily used by the Harvester to determine the verb,
                // but we can add hooks if specific verbs need specific setup.
                on: {
                    'htmx:before:request': ({request, match}) => {
                        request.verb = match[1].toUpperCase()
                    },
                },
            },

            //====================================================================
            // TYPE: CONFIG
            // Logic: Parse string -> Merge into config object
            //====================================================================

            // hx-swap="innerHTML transition:true"
            'hx-swap': {
                type: 'config',
                map: 'swap.method',
                merge: 'swap.modifiers'
            },

            // hx-target="#foo"
            'hx-target': {
                type: 'config',
                map: 'swap.target',  // hx-target="#foo" updates config.swap.target
            },

            'hx-headers': {
                type: 'config',
                scope: 'request.headers'
            },

            'hx-indicator': {
                patterns: {
                    name: /^hx-indicator$/,
                    value: /^<EXTENDED_CSS_SELECTOR>$/,
                },
                mapTo: 'request.indicator',
                inheritable: true,
            },

            'hx-select': {configPath: 'swap.extract', inheritable: true},

            'hx-vals': {
                patterns: {
                    name: /^hx-vals$/,
                    implicit: /^(javascript:.*|(<CONFIG>))$/,
                },
                inheritable: true,
                on: {
                    'htmx:before:request': ({match, request}) => {
                        if (match[2]) {
                            Object.assign(request.vals, this.config.syntax.parser.parse(match[2]))
                        }
                    },
                },
            },

            // hx-history="true reload:true"
            'hx-history': {
                type: 'config',
                map: 'features.history.enable', // Map "true" -> enable
                merge: 'features.history'         // Merge "reload:true" -> history
            },

            'hx-debug': {configPath: 'debug.enable', inheritable: true},

            // Example of a complex wildcard attribute
            'hx-status': {
                pattern: /^hx-status:(.+)$/, // e.g. hx-status:404
                on: {
                    'htmx:after:request': ({response, swap, match, attributeValue}) => {
                        const code = match[1]
                        // Logic to handle status override
                        if (
                            code === response.status.toString() ||
                            (code.endsWith('xx') && response.status.toString().startsWith(code[0]))
                        ) {
                            // apply logic from attributeValue
                        }
                    },
                },
            },

            //====================================================================
            // GLOBAL FEATURES (No attribute binding)
            //====================================================================

            noSwapOn204: {
                enable: true,
                on: {
                    'htmx:after:request': ({response, swap}) =>
                        response.status === 204 && (swap.method = 'none'),
                },
            },
            noSwapOn304: {
                enable: true,
                on: {
                    'htmx:after:request': ({response, swap}) =>
                        response.status === 304 && (swap.method = 'none'),
                },
            },
            applyReswapHeader: {
                enable: true,
                on: {
                    'htmx:after:request': ({response, swap}) =>
                        response.headers['HX-Reswap'] && (swap.method = response.headers['HX-Reswap']),
                },
            },
            applyRetargetHeader: {
                enable: true,
                on: {
                    'htmx:after:request': ({response, swap}) =>
                        response.headers['HX-Retarget'] && (swap.target = response.headers['HX-Retarget']),
                },
            },
            applyReselectHeader: {
                enable: true,
                on: {
                    'htmx:after:request': ({response, swap}) =>
                        response.headers['HX-Reselect'] && (swap.extract = response.headers['HX-Reselect']),
                },
            },
            applyRedirectHeader: {
                enable: true,
                on: {
                    'htmx:after:request': ({response}) =>
                        response.headers['HX-Redirect'] &&
                        ((location.href = response.headers['HX-Redirect']), false),
                },
            },
            applyRefreshHeader: {
                enable: true,
                on: {
                    'htmx:after:request': ({response}) =>
                        response.headers['HX-Refresh'] === 'true' && location.reload(),
                },
            },
            applyTriggerHeader: {
                enable: true,
                on: {
                    'htmx:after:request': function ({response, el}) {
                        if (response.headers['HX-Trigger']) {
                            // Need access to htmx instance - will be bound in __registerConfigEventHandlers
                            this.__handleTriggerHeader(response.headers['HX-Trigger'], el)
                        }
                    },
                },
            },
            applyLocationHeader: {
                enable: true,
                on: {
                    'htmx:after:request': function ({response}) {
                        if (response.headers['HX-Location']) {
                            let path = response.headers['HX-Location'],
                                opts = {}
                            if (path[0] === '{' || /[\s,]/.test(path)) {
                                opts = this.__parse(path)
                                path = opts.path
                                delete opts.path
                            }
                            opts.push = opts.push || 'true'
                            this.ajax('GET', path, opts)
                            return false // Abort swap
                        }
                    },
                },
            },
            replaceTitle: {
                enable: true,
                on: {
                    'htmx:after:swap': ({swaps}) => {
                        let mainSwap = swaps?.find(s => s.type === 'main')
                        if (mainSwap?.fragment) {
                            let title = mainSwap.fragment.querySelector('title')
                            if (title) document.title = title.textContent
                        }
                    },
                },
            },
            executeScripts: {
                enable: true,
                on: {
                    'htmx:after:response': function ({config, swaps}) {
                        const nonce = config.security.nonce

                        for (let swap of swaps) {
                            if (!swap.fragment) continue

                            // Execute scripts by replacing them
                            let scripts = this.__queryAll(swap.fragment, 'script')
                            for (let oldScript of scripts) {
                                let newScript = document.createElement('script')
                                for (let attr of oldScript.attributes) {
                                    newScript.setAttribute(attr.name, attr.value)
                                }
                                if (nonce) {
                                    newScript.nonce = nonce
                                }
                                newScript.textContent = oldScript.textContent
                                oldScript.replaceWith(newScript)
                            }
                        }
                    },
                },
            },
            injectStyles: {
                enable: true,
                on: {
                    'htmx:before:init': function ({config}) {
                        if (!config.features.injectStyles.enable) return

                        let stateAttr = config.state.attribute
                        let styles = `
                        [${stateAttr}~="loading"] {
                            opacity:0;
                            visibility:hidden
                        }
                        [${stateAttr}~="requesting"] [${stateAttr}~="loading"] 
                        [${stateAttr}~="requesting"][${stateAttr}~="loading"]{
                            opacity: 1;
                            visibility: visible;
                            transition: opacity 200ms ease-in
                        }`
                        document.head.insertAdjacentHTML(
                            'beforeend',
                            `<style${config.security.nonce && ` nonce="${config.security.nonce}"`}>
                                    ${styles}
                               </style>`,
                        )
                    },
                },
            },
            etag: {
                enable: true,
                on: {
                    'htmx:after:request': ({response, element}) => {
                        // Store ETag from response headers
                        const etag = response.headers['ETag']
                        if (etag) element.htmx.etag = etag
                    },
                    'htmx:before:request': ({request}) => {
                        // Add If-None-Match header if we have an ETag for this element
                        const etag = request.element.htmx?.etag
                        if (etag) request.headers['If-None-Match'] = etag
                    },
                },
            },

            //========================================
            // History Support
            //========================================
            history: {
                enable: true, // Controlled by config.history.enable usually, but good to have here
                on: {
                    'htmx:after:init': function () {
                        // 1. Initial State
                        if (this.config.history.enable && !history.state) {
                            history.replaceState({htmx: true}, '', location.pathname + location.search)
                        }

                        // 2. Popstate Listener
                        window.addEventListener('popstate', event => {
                            if (!this.config.history.enable || !event.state?.htmx) return

                            const path = location.pathname + location.search

                            // Internal Restore Logic
                            const restore = async () => {
                                try {
                                    await this.trigger('htmx:before:history:restore', {path, cacheMiss: true})

                                    if (this.config.history.reload) {
                                        location.reload()
                                    } else {
                                        // Fetch the previous content
                                        this.ajax('GET', path, {
                                            target: 'body',
                                            request: {headers: {'HX-History-Restore-Request': 'true'}},
                                        })
                                    }

                                    await this.trigger('htmx:after:history:restore', {path, cacheMiss: true})
                                } catch (e) {
                                    if (e !== CANCELLED) throw e
                                }
                            }

                            restore();
                        })
                    },

                    // Check for URL updates before swapping
                    'htmx:before:swap': function ({ctx}) {
                        if (!this.config.history.enable) return

                        let {sourceElement, hx, response} = ctx
                        let push = hx?.push || hx?.pushurl
                        let replace = hx?.replaceurl

                        // Implicit Boost Logic
                        if (!push && !replace && sourceElement?.htmx?.boosted) {
                            push = 'true'
                        }

                        let path = push || replace
                        if (!path || path === 'false') return

                        // "true" means use the URL from the request action
                        if (path === 'true') {
                            path = ctx.request.originalAction
                        }

                        let type = push ? 'push' : 'replace'
                        let historyDetail = {history: {type, path}, sourceElement, response}

                        // Lifecycle + Execution
                        // We use an IIFE logic here or just execute, assuming 'this' is bound to HTMX instance
                        const updateHistory = async () => {
                            await this.trigger('htmx:before:history:update', historyDetail)

                            if (type === 'push') {
                                await this.trigger('htmx:before:history:push', {path})
                                history.pushState({htmx: true}, '', path)
                                await this.trigger('htmx:after:history:push', {path})
                            } else {
                                await this.trigger('htmx:before:history:replace', {path})
                                history.replaceState({htmx: true}, '', path)
                                await this.trigger('htmx:after:history:replace', {path})
                            }

                            await this.trigger('htmx:after:history:update', historyDetail)
                        }

                        // Execute immediately (sync) or via promise if you want to await it
                        // History updates are usually sync to ensure URL reflects before next tick
                        void updateHistory();
                    }
                }
            },

            //========================================
            // Config Shortcut Attributes
            //========================================

            'hx-debug': {
                enable: true,
                attribute: 'debug',
                config: 'debug.enable',
            },

            'hx-history': {
                enable: true,
                attribute: 'history',
                config: 'history.enable',
            },

            'hx-features': {
                enable: true,
                attribute: 'features',
                config: 'features',
            },

            'hx-security': {
                enable: true,
                attribute: 'security',
                config: 'security',
            },

            //========================================
            // Behavioral Attributes
            //========================================

            // hx-ignore: Cancel activation of elements inside [hx-ignore] containers
            'hx-ignore': {
                enable: true,
                attribute: 'ignore',
                on: {
                    'htmx:before:element:activate': function ({element}) {
                        const attr = this.getAttributeName('hx-ignore')
                        if (element.closest(`[${attr}]`)) return false
                    },
                },
            },

            // hx-on: Declarative event handlers in HTML attributes
            // TODO: Add cleanup on htmx:before:element:deactivate (remove listeners)
            'hx-on': {
                enable: true,
                attribute: /^hx-on[:\.]/, // matches hx-on:click, hx-on.click, etc.
                shorthands: {
                    request: 'htmx:before:request',
                    response: 'htmx:after:response',
                    swap: 'htmx:before:swap',
                    error: 'htmx:error',
                    'element:activate': 'htmx:before:element:activate',
                    'element:deactivate': 'htmx:before:element:deactivate',
                    'history:push': 'htmx:before:history:push',
                    'history:replace': 'htmx:before:history:replace',
                    'history:restore': 'htmx:before:history:restore',
                    sse: 'htmx:before:sse',
                    'sse:message': 'htmx:before:sse:message',
                    transition: 'htmx:before:transition',
                },
                on: {
                    'htmx:after:element:activate': function ({element}) {
                        const attributeName = this.getAttributeName('hx-on')
                        const delimiter = this.config.syntax.delimiter
                        const shorthands = FEATURES['hx-on'].shorthands

                        for (let attr of element.getAttributeNames()) {
                            if (!attr.startsWith(attributeName + delimiter)) continue

                            let eventName = attr.slice(attributeName.length + 1) // +1 for delimiter
                            let code = element.getAttribute(attr)

                            // Handle :: shorthand (drops htmx: prefix)
                            if (eventName.startsWith(delimiter)) {
                                eventName = eventName.slice(1) // Remove leading delimiter

                                // Check for shorthand (e.g., ::request -> htmx:before:request)
                                if (!eventName.startsWith('before:') && !eventName.startsWith('after:')) {
                                    eventName = shorthands[eventName] || 'htmx:before:' + eventName
                                } else {
                                    eventName = 'htmx:' + eventName
                                }
                            }

                            element.addEventListener(eventName, async event => {
                                try {
                                    await this.__executeJavaScript(element, {event}, code, false)
                                } catch (e) {
                                    if (e !== CANCELLED) console.error(e)
                                }
                            })
                        }
                    },
                },
            },

            //====================================================================
            // INHERITANCE SYSTEM
            //====================================================================

            inheritance: {
                enable: true,

                // Intercepts getAttribute calls to implement inheritance lookupthrough :inherited modifier
                // When a parent has hx-swap:inherited, children without hx-swap will use parent's value
                on: {
                    // This would need a new event like 'htmx:before:attribute:get' that fires
                    // before returning attribute values, allowing features to modify the lookup
                    // For now, this is just the conceptual structure
                }
            },
        }
        #defaultConfig = {
            version: '4.0.0-alpha3',

            // Core Settings
            debug: {
                enable: false,
                // TODO: Add more debug options here
            },
            inheritanceMode: 'explicit', // 'explicit' | 'implicit' | false

            // Syntax Configuration
            syntax: {
                prefix: 'hx-', // Attribute prefix: Using `x-` would result in `x-on:click`
                delimiter: ':', // Attribute delimiter: hx-on:click -> hx-on.click
                inheritance: '%name%:inherited', // '%name%:explicit' | 'inherited:%name%' | '*:%name%' | '%name%'
                parser: RelaxedJSON, // Parser for attribute values (requires .parse and .stringify methods)
            },

            // History
            history: {
                enable: true,
                reload: false,
            },

            // Security
            security: {
                nonce: null, // CSP nonce for inline scripts/styles
                allowOrigins: null, // null = unrestricted, ["self"] = same-origin, [...] = whitelist
                // TODO: Implement this
                trustedTypes: null, // null = disabled, string = policy name
            },

            // Request Configuration
            request: {
                timeout: 60000,
                credentials: 'same-origin',
                mode: 'same-origin',
                // TODO: Find a more suitable / conventional name for this
                vals: {},
                headers: {
                    // Static
                    'HX-Request': 'true',
                    Accept: 'text/html, text/event-stream',
                    // Dynamic (resolved at runtime)
                    'HX-Current-URL': () => location.href,
                    // null = remove header
                    // TODO: Find out if this is possible (to pass the request here)
                    'HX-Source': request => request.element.id || request.element.name,
                    'HX-Boosted': request => (request.element.htmx?.boosted ? 'true' : null),
                },
            },

            // Features
            // TODO: Allow easily enabling/disabling features via config
            features: this.#defaultFeatures,

            // Default Swap Behavior
            swap: {
                method: 'innerHTML',
                target: 'this',

                modifiers: {
                    extract: null,
                    extractOOB: null, // TODO: Get rid of this
                    delay: 0, // delay before swap (ms)
                    scroll: null, // {direction: 'top'|'bottom', target: selector}
                    show: null, // {direction: 'top'|'bottom', target: selector}
                    focus: null, // {scroll: bool}
                    transition: true,
                    async: false, // TODO: Implement this (run swap in parallel)
                }
            },

            // Element state configuration (element._htmx & data-htmx)
            state: {
                dom: {
                    enable: true,
                    attribute: 'data-htmx',
                    sync: {
                        // Always serialized to data-htmx (for styling/debugging)
                        always: ['active', 'boosted', 'requesting', 'loading', 'error'],
                        // Additional states serialized only in when config.debug.enable is true
                        debug: ['status', 'verb', 'url', 'etag'],
                        // States never serialized (runtime only)
                        never: ['eventHandler', 'triggerSpecs', 'listeners', 'interval', 'timeout', 'requests'],
                    },
                    // Custom serializers: Convert complex objects → simple values BEFORE stringifying
                    // Example: [Trigger, Trigger] → "click, hover" (array to string)
                    serializers: {
                        // triggers: (triggers) => triggers.map(t => t.name).join(', ')
                    },
                    // Format parsers: Handle string ↔ object conversion (parsing/stringifying)
                    // Example: "count:5" ↔ {count: 5} (RelaxedJSON), '{"x":1}' ↔ {x: 1} (JSON)
                    format: {
                        htmx: RelaxedJSON, // Format for data-htmx attribute
                        // Add other formats as needed (e.g., triggers: RelaxedJSON)
                    },
                },
            },

            // CSS selectors
            selectors: {
                // What selectors need to be present for htmx.activate() to activate an element
                activate: ['get', 'post', 'put', 'patch', 'delete', 'stream', 'sse']
                    .map(verb => `[hx-${verb}]`)
                    .concat(['[hx-action]'])
                    .join(','),

                // What should be ignored by htmx
                ignore: '[hx-ignore], [hx-ignore] *',

                // What contributes to form data / `hx-vals`
                inputs: 'input:not([disabled]), select:not([disabled]), textarea:not([disabled])',
            },

            // Allowlist: Only these keys can be overridden via hx-config & other attributes
            _allowOverrides: new Set([
                'history.*',
                'swap.*',
                'request.*',
                'state.*',
                'security.nonce',
            ]),

            extensions: {
                allow: [],
                registered: [],
            }
        }

        #transitionQueue
        #processingTransition

        constructor() {
            this.config = {
                ...this.#defaultConfig,
                features: this.#defaultFeatures
            };

            void this.trigger('htmx:before:init')

            // Apply Meta Tags Overrides
            document.querySelectorAll('meta[name^="htmx:config"]').forEach(meta => {
                const overrides = this.__parse(meta.content);

                // Resolve Target: "htmx:config.features" -> this.config.features
                const path = meta.name.split('.').slice(1);
                let target = this.config;

                for (const key of path) {
                    // Ensure path exists (e.g. creating intermediate objects if needed)
                    if (!target[key]) target[key] = {};
                    target = target[key];
                }

                this.__deepMerge(target, overrides);
            });

            // Register all features
            this.__registerFeatures()

            const run = () => {
                this.activate(document.body);
                void this.trigger('htmx:after:init', {htmx: this});
            };

            if (document.readyState === 'loading') {
                document.addEventListener('DOMContentLoaded', run);
            } else {
                run();
            }
        }

        /**
         * Dispatches a lifecycle event with support for:
         * 1. Async Blocking (via evt.detail.waitUntil)
         * 2. Cancellation (via evt.preventDefault -> returns false)
         * * @see __cancellable - Wrapper that handles the CANCELLED exception flow.
         * @param {string} eventName
         * @param {object} detail
         * @param {EventTarget} [target]
         */
        async trigger(eventName, detail = {}, target = document) {
            // 1. Debugging (Optional but recommended)
            if (this.config.debug.enable) console.log(eventName, detail, target);

            // 2. Async Setup (The "Wait" Capability)
            const promises = [];
            detail.waitUntil = (p) => promises.push(p);

            // 3. Robust Dispatch Target
            // If the specific element was removed from the DOM (e.g. swap),
            // fallback to document so global listeners still hear the event.
            const dispatchTarget = target.isConnected ? target : document;

            // 4. Create the Event
            const event = new CustomEvent(eventName, {
                bubbles: true,    // Lifecycle events always bubble
                cancelable: true, // Listeners can say "Stop!"
                composed: true,   // Cross Shadow DOM boundaries
                detail
            });

            // 5. Attach Metadata (in case we fell back to document)
            // This lets listeners know where the event *originated* conceptually.
            if (dispatchTarget !== target) event.originalTarget = target;

            // 6. Fire (Synchronous Phase)
            dispatchTarget.dispatchEvent(event);

            // 7. Wait (Asynchronous Phase)
            if (promises.length > 0) {
                try {
                    await Promise.all(promises);
                } catch (e) {
                    console.error(`Async error in ${eventName}:`, e);
                }
            }

            // Returns: TRUE (Allowed) / FALSE (Prevented)
            return !event.defaultPrevented;
        }

        /**
         * Executes an async function, acting as a "Circuit Breaker" for the pipeline.
         * * - Catches 'CANCELLED' exceptions (Flow Control) -> Logs info if debug=true
         * - Catches Real Errors (Bugs) -> Logs error always
         * * @param {Function} fn - The async block to execute
         */
        __cancellable = async (fn) => {
            try {
                await fn();
            } catch (e) {
                if (e === CANCELLED) {
                    if (this.config.debug.enable) {
                        console.info(`%c[htmx] Pipeline stopped (CANCELLED exception caught)`, "color: gray");
                    }
                } else {
                    console.error(e);
                }
            }
        }

        __registerFeatures() {
            for (let [name, config] of Object.entries(this.config.features || {})) {
                // Check if feature is enabled
                if (config.enable === false) continue

                // Get the feature (either from config.feature or config itself)
                let feature = config.feature || config

                // If feature is a class, instantiate it
                if (typeof feature === 'function') {
                    feature = new feature()
                    // Store the instantiated feature back for runtime access
                    if (config.feature) {
                        config.feature = feature
                    }
                }

                // Register event handlers
                for (let [eventName, handler] of Object.entries(feature.on || {})) {
                    document.addEventListener(eventName, evt => {
                        // Bind htmx instance as 'this' for handlers that need it
                        let result = handler.call(this, evt.detail || {})
                        if (result === false) evt.preventDefault()
                    })
                }
            }
        }

        __deepMerge(target, source) {
            // TODO: Include clear comment of what it does
            for (const key in source) {
                const sVal = source[key]
                // Deep merge objects
                if (sVal && typeof sVal === 'object' && !Array.isArray(sVal)) {
                    if (!target[key]) target[key] = {}
                    this.__deepMerge(target[key], sVal)
                }
                // Escape hatch: null deletes the key
                else if (sVal === null) {
                    delete target[key]
                } else {
                    target[key] = sVal
                }
            }
            return target
        }

        // TODO: Maybe find a better name and implement this better
        __buildLocalConfig(el) {
            // 1. Start with Global Defaults (cached/cloned)
            let scope = {...this.config}

            // 2. Iterate attributes ONCE
            for (let attr of el.attributes) {
                let name = this.getAttributeName(attr.name) // Handle prefixes if used
                let value = attr.value
                let configKey = null

                // Read config attributes (e.g. hx-debug, hx-headers, hx-swap, etc.)

                // 3. Process the Config Key (If found)
                if (configKey) {
                    // Handle nested paths like "fetch.headers"
                    let keys = configKey.split('.')
                    let target = scope

                    // Navigate to the parent object
                    for (let i = 0; i < keys.length - 1; i++) {
                        if (!target[keys[i]]) target[keys[i]] = {}
                        target = target[keys[i]]
                    }

                    let finalKey = keys[keys.length - 1]

                    // Check allowlist with the full path
                    if (#defaultConfig._allowOverrides.has(configKey)) {
                        // Is the target an object (headers, vals)? -> MERGE
                        if (target[finalKey] && typeof target[finalKey] === 'object') {
                            // hx-headers="a:1" -> parses to object -> merges
                            let overrides = this.__parse(value)
                            this.__deepMerge(target[finalKey], overrides)
                        }
                        // Is the target a primitive (timeout, indicator)? -> REPLACE
                        else {
                            // hx-timeout="5000" -> raw string logic
                            target[finalKey] = value
                        }
                    }
                }
            }

            return scope
        }

        // TODO: Reimplement
        // defineExtension(name, extension) {
        //   if (this.#approvedExt && !this.#approvedExt.split(/,\s*/).includes(name)) return false
        //   if (this.#registeredExt.has(name)) return false
        //   this.#registeredExt.add(name)
        //   if (extension.init) extension.init(this.#extensionAPI)
        //   Object.entries(extension).forEach(([key, value]) => {
        //     if (!this.#extMethods.get(key)?.push(value)) this.#extMethods.set(key, [value])
        //   })
        // }

        /**
         * Gets the value of an HTMX attribute, handling:
         * 1. Configurable Prefixes (data-hx-)
         * 2. Configurable Delimiters (hx-on.click)
         * 3. Inheritance (if enabled)
         * @param {Element} element
         * @param {string} attributeName - The abstract name (e.g. "hx-target")
         */
        getAttribute(element, attributeName) {
            // Get full name with configured prefix/delimiter
            const name = this.__resolveAttributeName(attributeName)

            // 1. Local (Priority)
            if (element.hasAttribute(name)) return element.getAttribute(name)

            const inheritedName = this.config.inheritanceMode === 'implicit'
                ? name
                : this.config.syntax.inheritance.replace('%name%', name)

            // 3. Ancestor Lookup
            // Use parentElement to ensure we stay within Element nodes (which have .closest)
            // Optional chaining handles the case where we are at the root (<html>).
            const parent = element.parentElement?.closest?.(`[${CSS.escape(inheritedName)}]`)

            return parent ? parent.getAttribute(inheritedName) : null
        }

        // TODO: Ensure it always uses local config
        __parse(value, config = this.config) {
            return config.syntax.parser.parse(value)
        }

        // TODO: Ensure it always uses local config (maybe find a clean way to temporarily replace this.config?)
        __stringify(obj, config = this.config) {
            return config.syntax.parser.stringify(obj)
        }

        __queryAll(el, selector) {
            let results = [...el.querySelectorAll(selector)]
            if (el.matches?.(selector)) {
                results.unshift(el)
            }
            return results
        }

        // TODO: Make RelaxedJSON customizable
        /**
         * Universal attribute value parser
         *
         * Format: item1 || item2 || item3
         * Where each item is: <value> <modifier1>:<val1>, <modifier2>:<val2>
         *
         * Rules:
         * - || separates multiple items (for multi-value attributes like hx-trigger)
         * - Within an item: everything before first key:value pattern is the value
         * - Commas within items are optional separators for readability
         * - Values can have spaces (no quotes needed)
         *
         * Examples:
         * - "innerHTML scroll:top" -> [{value: "innerHTML", scroll: "top"}]
         * - "closest form, strategy:drop" -> [{value: "closest form", strategy: "drop"}]
         * - "click || keyup delay:500ms" -> [{value: "click"}, {value: "keyup", delay: "500ms"}]
         */
        __parseAttributeValue(value) {
            if (!value?.trim()) return []

            // Split by || for multi-item attributes
            let items = value
                .split('||')
                .map(s => s.trim())
                .filter(Boolean)

            return items
                .map(item => {
                    // Split by spaces and commas
                    let tokens = item.split(/[\s,]+/).filter(Boolean)

                    // Find first token containing ':' (start of modifiers)
                    let modifierIndex = tokens.findIndex(t => t.includes(':'))

                    if (modifierIndex === -1) {
                        // No modifiers - entire item is the value
                        return {value: item.replace(/\s*,\s*/g, ' ').trim()}
                    }

                    if (modifierIndex === 0) {
                        // Starts with modifier (no value)
                        return {
                            value: null,
                            ...this.__parse(tokens.join(' ')),
                        }
                    }

                    // Split between value and modifiers
                    let value = tokens.slice(0, modifierIndex).join(' ')
                    let modifierStr = tokens.slice(modifierIndex).join(' ')

                    return {
                        value,
                        ...this.__parse(modifierStr),
                    }
                })
                .filter(Boolean)
        }

        /**
         * Parse swap-related attributes (hx-swap, hx-target, hx-select)
         * All map to the swap config namespace but have different "primary" properties
         *
         * @param {string} attrName - The attribute name (e.g., "hx-swap")
         * @param {string} attrValue - The attribute value (e.g., "#foo scroll:top")
         * @returns {object} - Parsed config object mapping to swap namespace
         *
         * Examples:
         * - parseSwapAttribute("hx-target", "#foo scroll:top")
         *   → {target: "#foo", scroll: {direction: "top", ...}}
         * - parseSwapAttribute("hx-swap", "innerHTML target:#foo")
         *   → {method: "innerHTML", target: "#foo"}
         */
        __parseSwapAttribute(attrName, attrValue) {
            // Parse using universal parser (returns array, we take first item)
            let parsed = this.__parseAttributeValue(attrValue)
            if (!parsed.length) return {}

            let item = parsed[0] // Swap attributes don't use || syntax

            // Determine primary property based on attribute name
            const PRIMARY_PROPERTIES = {
                'hx-swap': 'method',
                'hx-target': 'target',
                'hx-select': 'extract',
            }

            let primaryProp = PRIMARY_PROPERTIES[attrName]
            if (!primaryProp) return item // Unknown attribute, return as-is

            // Build result: primary property + all modifiers
            let result = {...item}
            delete result.value
            result[primaryProp] = item.value

            return result
        }

        __parseTriggerSpecs(spec) {
            // Use universal parser, but add 'name' for backward compatibility
            return this.__parseAttributeValue(spec).map(item => {
                // Check for unterminated brackets (old validation)
                if (item.value?.includes('[') && !item.value.includes(']')) {
                    throw new Error('Unterminated bracket in: ' + item.value)
                }
                return {name: item.value, ...item}
            })
        }

        __issueRequest = async (ctx) => {
            let el = ctx.sourceElement
            let syncStrategy = this.__determineSyncStrategy(el)
            let requestQueue = this.__getRequestQueue(el)

            if (!requestQueue.issue(ctx, syncStrategy)) return

            ctx.status = 'issuing'
            /** @type {HtmxElement} */
            const element = el.__htmxElement || createHtmxElement(el, this)
            element.htmx.requesting = true
            this.__initTimeout(ctx)

            let indicatorsSelector = this.getAttributeValue(el, 'hx-indicator')
            let indicators = this.__showIndicators(el, indicatorsSelector)
            let disableSelector = this.getAttributeValue(el, 'hx-disable')
            let disableElements = this.__disableElements(el, disableSelector)

            try {
                // TODO: Reimplement hx-confirm inside #defaultAttributes
                // if (ctx.confirm) {
                //   let issueRequest = null
                //   let confirmed = await new Promise(resolve => {
                //     issueRequest = resolve
                //     try {
                //       this.trigger(
                //         'htmx:confirm',
                //         {
                //           ctx,
                //           issueRequest: skip => issueRequest?.(skip !== false),
                //         },
                //         el,
                //       )
                //       let js = this.__extractJavascriptContent(ctx.confirm)
                //       resolve(
                //         js ? this.__executeJavaScriptAsync(el, {}, js, true) : window.confirm(ctx.confirm),
                //       )
                //     } catch (e) {
                //       if (e === CANCELLED) resolve(false)
                //       else throw e
                //     }
                //   })
                //   if (!confirmed) return
                // }

                ctx.fetch ||= window.fetch.bind(window)
                await this.trigger('htmx:before:request', {ctx}, el)

                let response = await ctx.fetch(ctx.request.activate, ctx.request)

                ctx.response = {
                    raw: response,
                    status: response.status,
                    headers: response.headers,
                }
                this.__extractHxHeaders(ctx)
                ctx.isSSE = response.headers.get('Content-Type')?.includes('text/event-stream')
                if (!ctx.isSSE) {
                    ctx.text = await response.text()
                }

                // Convert headers to object for event handlers
                let headers = {}
                for (let [k, v] of ctx.response.headers) {
                    headers[k] = v
                }

                // Prepare event data for htmx:after:request handlers
                let eventData = {
                    response: {
                        status: ctx.response.status,
                        headers: headers,
                        text: ctx.text,
                    },
                    swap: ctx.swap,
                    el: el,
                }

                await this.trigger('htmx:after:request', eventData, el)

                // Check if behaviors set swap.method to "none" (via noSwapOn204/304 etc)
                if (ctx.swap.method === 'none') return

                // Handle advanced hx-status:XXX attribute overrides
                this.__applyStatusCodeOverrides(ctx)
                if (ctx.swap.method === 'none') return

                let isSSE = response.headers.get('Content-Type')?.includes('text/event-stream')
                if (isSSE) {
                    // SSE response
                    await this.__handleSSE(ctx, el, response)
                } else {
                    // HTTP response
                    if (ctx.status === 'issuing') {
                        ctx.status = 'response received'
                        await this.swap(ctx)
                        ctx.status = 'swapped'
                    }
                }
            } catch (error) {
                if (error === CANCELLED) return
                ctx.status = 'error: ' + error
                // Set error state with debug details if debug mode is enabled
                if (this.config.debug.enable) {
                    element.htmx.error = `${error.name} - ${error.message}`
                } else {
                    element.htmx.error = true
                }
                await this.trigger('htmx:error', {ctx, error}, el)
            } finally {
                element.htmx.requesting = null
                element.htmx.error = null
                this.__hideIndicators(indicators)
                this.__enableElements(disableElements)
                await this.trigger('htmx:finally:request', {ctx}, el)

                requestQueue.finish()
                if (requestQueue.more()) {
                    // TODO is it OK to not await here?  try/catch?
                    this.__issueRequest(requestQueue.next())
                }
            }
        }

        // Extract HX-* headers into ctx.hx (used for SSE and other legacy needs)
        __extractHxHeaders(ctx) {
            ctx.hx = {}
            for (let [k, v] of ctx.response.raw.headers) {
                if (k.toLowerCase().startsWith('hx-')) {
                    ctx.hx[k.slice(3).toLowerCase().replace(/-/g, '')] = v
                }
            }
        }

        async __handleSSE(ctx, el, response) {
            let config = {...this.config.sse, ...ctx.request.sse}

            let waitForVisible = () =>
                new Promise(r => {
                    let onVisible = () =>
                        !document.hidden && (document.removeEventListener('visibilitychange', onVisible), r())
                    document.addEventListener('visibilitychange', onVisible)
                })

            let lastEventId = null,
                attempt = 0,
                currentResponse = response

            while (el.isConnected) {
                // Handle reconnection for subsequent iterations
                if (attempt > 0) {
                    if (!config.reconnect || attempt > config.reconnectMaxAttempts) break

                    if (config.pauseInBackground && document.hidden) {
                        await waitForVisible()
                        if (!el.isConnected) break
                    }

                    let delay = Math.min(
                        this.parseInterval(config.reconnectDelay) * Math.pow(2, attempt - 1),
                        this.parseInterval(config.reconnectMaxDelay),
                    )
                    if (config.reconnectJitter > 0) {
                        let jitterRange = delay * config.reconnectJitter
                        let jitter = (Math.random() * 2 - 1) * jitterRange
                        delay = Math.max(0, delay + jitter)
                    }
                    let reconnect = {attempt, delay, lastEventId, cancelled: false}

                    ctx.status = 'reconnecting to stream'
                    try {
                        await this.trigger('htmx:before:sse:reconnect', {ctx, reconnect}, el)
                    } catch (e) {
                        if (e === CANCELLED) break
                        throw e
                    }
                    if (reconnect.cancelled) break

                    await new Promise(r => setTimeout(r, reconnect.delay))
                    if (!el.isConnected) break

                    try {
                        if (lastEventId)
                            (ctx.request.headers = ctx.request.headers || {})['Last-Event-ID'] = lastEventId
                        currentResponse = await fetch(ctx.request.activate, ctx.request)
                    } catch (e) {
                        ctx.status = 'stream error'
                        await this.trigger('htmx:error', {ctx, error: e}, el)
                        attempt++
                        continue
                    }
                }

                // Core streaming logic
                try {
                    await this.trigger('htmx:before:sse:stream', {ctx}, el)
                } catch (e) {
                    if (e === CANCELLED) break
                    throw e
                }
                ctx.status = 'streaming'

                attempt = 0 // Reset on successful connection

                try {
                    for await (const sseMessage of this.__parseSSE(currentResponse)) {
                        if (!el.isConnected) break

                        if (config.pauseInBackground && document.hidden) {
                            await waitForVisible()
                            if (!el.isConnected) break
                        }

                        let msg = {
                            data: sseMessage.data,
                            event: sseMessage.eent,
                            id: sseMessage.id,
                            cancelled: false,
                        }
                        try {
                            await this.trigger('htmx:before:sse:message', {ctx, message: msg}, el)
                        } catch (e) {
                            if (e === CANCELLED) continue
                            throw e
                        }
                        if (msg.cancelled) continue

                        if (sseMessage.id) lastEventId = sseMessage.id

                        // Trigger custom event if `event:` line is present
                        if (sseMessage.event) {
                            await this.trigger(sseMessage.event, {data: sseMessage.data, id: sseMessage.id}, el)
                            // Skip swap for custom events
                            await this.trigger('htmx:after:sse:message', {ctx, message: msg}, el)
                            continue
                        }

                        ctx.text = sseMessage.data
                        ctx.status = 'stream message received'

                        if (!ctx.response.cancelled) {
                            await this.swap(ctx)
                            ctx.status = 'swapped'
                        }
                        await this.trigger('htmx:after:sse:message', {ctx, message: msg}, el)
                    }
                } catch (e) {
                    if (e === CANCELLED) continue
                    ctx.status = 'stream error'
                    await this.trigger('htmx:error', {ctx, error: e}, el)
                }

                if (!el.isConnected) break
                await this.trigger('htmx:after:sse:stream', {ctx}, el)

                attempt++
            }
        }

        async* __parseSSE(response) {
            let reader = response.body.getReader()
            let decoder = new TextDecoder()
            let buffer = ''
            let message = {data: '', event: '', id: '', retry: null}

            try {
                while (true) {
                    let {done, value} = await reader.read()
                    if (done) break

                    // Decode chunk and add to buffer
                    buffer += decoder.decode(value, {stream: true})
                    let lines = buffer.split('\n')
                    // Keep incomplete line in buffer
                    buffer = lines.pop() || ''

                    for (let line of lines) {
                        // Empty line or carriage return indicates end of message
                        if (!line || line === '\r') {
                            if (message.data) {
                                yield message
                                message = {data: '', event: '', id: '', retry: null}
                            }
                            continue
                        }

                        // Parse field: value
                        let colonIndex = line.indexOf(':')
                        if (colonIndex <= 0) continue

                        let field = line.slice(0, colonIndex)
                        let value = line.slice(colonIndex + 1).trimStart()

                        if (field === 'data') {
                            message.data += (message.data ? '\n' : '') + value
                        } else if (field === 'event') {
                            message.event = value
                        } else if (field === 'id') {
                            message.id = value
                        } else if (field === 'retry') {
                            let retryValue = parseInt(value, 10)
                            if (!isNaN(retryValue)) {
                                message.retry = retryValue
                            }
                        }
                    }
                }
            } finally {
                reader.releaseLock()
            }
        }

        __initTimeout(ctx) {
            let timeoutInterval
            if (ctx.request.timeout) {
                timeoutInterval = this.parseInterval(ctx.request.timeout)
            } else {
                timeoutInterval = this.config.request.timeout
            }
            ctx.requestTimeout = setTimeout(() => ctx.abort?.(), timeoutInterval)
        }

        __determineSyncStrategy(el) {
            let syncValue = this.getAttributeValue(el, 'hx-sync')
            return syncValue?.split(':')[1] || 'queue first'
        }

        __getRequestQueue(el) {
            let syncValue = this.getAttributeValue(el, 'hx-sync')
            let syncElt = el
            if (syncValue && syncValue.includes(':')) {
                let strings = syncValue.split(':')
                let selector = strings[0]
                syncElt = this.__findExt(selector)
            }
            return (syncElt._htmxRequestQueue ||= new ReqQ())
        }

        __isModifierKeyClick(evt) {
            return evt.type === 'click' && (evt.ctrlKey || evt.metaKey || evt.shiftKey)
        }

        __shouldCancel(evt) {
            let el = evt.currentTarget
            let isSubmit = evt.type === 'submit' && el?.tagName === 'FORM'
            if (isSubmit) return true

            let isClick = evt.type === 'click' && evt.button === 0
            if (!isClick) return false

            let btn = el?.closest?.('button, input[type="submit"], input[type="image"]')
            let form = btn?.form || btn?.closest('form')
            let isSubmitButton =
                btn &&
                !btn.disabled &&
                form &&
                (btn.type === 'submit' || btn.type === 'image' || (!btn.type && btn.tagName === 'BUTTON'))
            if (isSubmitButton) return true

            let link = el?.closest?.('a')
            if (!link || !link.href) return false

            let href = link.getAttribute('href')
            let isFragmentOnly = href && href.startsWith('#') && href.length > 1
            return !isFragmentOnly
        }

        // TODO: Reimplement
        __initTriggers(el, initialHandler = this.__createHtmxEventHandler(el)) {
            let specString = this.getAttributeValue(el, 'hx-trigger')
            if (!specString) {
                specString = el.matches('form')
                    ? 'submit'
                    : el.matches('input:not([type=button]),select,textarea')
                        ? 'change'
                        : 'click'
            }
            const element = el.__htmxElement || createHtmxElement(el, this)
            element.htmx.triggerSpecs = this.__parseTriggerSpecs(specString)
            element.htmx.listeners = []

            for (let spec of element.htmx.triggerSpecs) {
                spec.handler = initialHandler
                spec.listeners = []
                spec.values = {}

                let [eventName, filter] = this.__extractFilter(spec.name)

                // should be first so logic is called only when all other filters pass
                if (spec.once) {
                    let original = spec.handler
                    spec.handler = evt => {
                        original(evt)
                        for (let listenerInfo of spec.listeners) {
                            listenerInfo.fromElt.removeEventListener(listenerInfo.eventName, listenerInfo.handler)
                        }
                    }
                }

                if (eventName === 'intersect' || eventName === 'revealed') {
                    let observerOptions = {}
                    if (spec.opts?.root) {
                        observerOptions.root = this.__findExt(el, spec.opts.root)
                    }
                    if (spec.opts?.threshold) {
                        observerOptions.threshold = parseFloat(spec.opts.threshold)
                    }
                    let isRevealed = eventName === 'revealed'
                    spec.observer = new IntersectionObserver(entries => {
                        for (let i = 0; i < entries.length; i++) {
                            let entry = entries[i]
                            if (entry.isIntersecting) {
                                this.trigger(el, 'intersect', {}, false)
                                if (isRevealed) {
                                    spec.observer.disconnect()
                                }
                                break
                            }
                        }
                    }, observerOptions)
                    eventName = 'intersect'
                    spec.observer.observe(el)
                }

                if (spec.delay) {
                    let original = spec.handler
                    spec.handler = evt => {
                        clearTimeout(spec.timeout)
                        spec.timeout = setTimeout(() => original(evt), this.parseInterval(spec.delay))
                    }
                }

                if (spec.throttle) {
                    let original = spec.handler
                    spec.handler = evt => {
                        if (spec.throttled) {
                            spec.throttledEvent = evt
                        } else {
                            spec.throttled = true
                            original(evt)
                            spec.throttleTimeout = setTimeout(() => {
                                spec.throttled = false
                                if (spec.throttledEvent) {
                                    // implement trailing-edge throttling
                                    let throttledEvent = spec.throttledEvent
                                    spec.throttledEvent = null
                                    spec.handler(throttledEvent)
                                }
                            }, this.parseInterval(spec.throttle))
                        }
                    }
                }

                if (spec.target) {
                    let original = spec.handler
                    spec.handler = evt => {
                        if (evt.target?.matches?.(spec.target)) {
                            original(evt)
                        }
                    }
                }

                if (eventName === 'every') {
                    let interval = Object.keys(spec).find(k => k !== 'name')
                    spec.interval = setInterval(() => {
                        if (el.isConnected) {
                            try {
                                await this.trigger('every', {}, el, false)
                            } catch (e) {
                                if (e !== CANCELLED) throw e
                            }
                        } else {
                            clearInterval(spec.interval)
                        }
                    }, this.parseInterval(interval))
                }

                if (filter) {
                    let original = spec.handler
                    spec.handler = evt => {
                        if (this.__shouldCancel(evt)) evt.preventDefault()
                        if (this.__executeFilter(el, evt, filter)) {
                            original(evt)
                        }
                    }
                }

                let fromElts = [el]
                if (spec.from) {
                    fromElts = this.__findAllExt(el, spec.from)
                }

                if (spec.consume) {
                    let original = spec.handler
                    spec.handler = evt => {
                        evt.stopPropagation()
                        original(evt)
                    }
                }

                if (spec.changed) {
                    let original = spec.handler
                    spec.handler = evt => {
                        let trigger = false
                        for (let fromElt of fromElts) {
                            if (spec.values[fromElt] !== fromElt.value) {
                                trigger = true
                                spec.values[fromElt] = fromElt.value
                            }
                        }
                        if (trigger) {
                            original(evt)
                        }
                    }
                }

                for (let fromElt of fromElts) {
                    let listenerInfo = {fromElt, eventName, handler: spec.handler}
                    element.htmx.listeners.push(listenerInfo)
                    spec.listeners.push(listenerInfo)
                    fromElt.addEventListener(eventName, spec.handler)
                }
            }
        }

        __extractFilter(str) {
            let match = str.match(/^([^\[]*)\[([^\]]*)]/)
            if (!match) return [str, null]
            return [match[1], match[2]]
        }

        __handleTriggerHeader(value, el) {
            if (value[0] === '{') {
                let triggers = this.__parse(value)
                for (let name in triggers) {
                    let detail = triggers[name]
                    if (detail?.target) el = this.find(detail.target) || el
                    this.trigger(el, name, typeof detail === 'object' ? detail : {value: detail})
                }
            } else {
                value.split(',').forEach(name => this.trigger(el, name.trim(), {}))
            }
        }

        __apiMethods(thisArg) {
            let bound = {}
            let proto = Object.getPrototypeOf(this)
            for (let name of Object.getOwnPropertyNames(proto)) {
                if (name !== 'constructor' && typeof this[name] === 'function') {
                    if (['find', 'findAll'].includes(name)) {
                        bound[name] = (arg1, arg2) => {
                            if (arg2 === undefined) {
                                return this[name](thisArg, arg1)
                            } else {
                                return this[name](arg1, arg2)
                            }
                        }
                    } else {
                        bound[name] = this[name].bind(this)
                    }
                }
            }
            return bound
        }

        async __executeJavaScript(thisArg, obj, code, expression = true) {
            // thisArg is now HtmxElement (if passed from hx-on)

            const args = {
                ...context,
                // Inject wrapper methods as top-level variables
                // e.g. user can type "find('.foo')" instead of "this.find('.foo')"
                find: (sel) => thisArg.find(sel),
                findAll: (sel) => thisArg.findAll(sel),
                attr: (name) => thisArg.attr(name),

                // Standard cancel capability
                cancel: () => {
                    throw CANCELLED;
                }
            };

            const keys = Object.keys(args);
            const values = Object.values(args);

            const AsyncFunction = Object.getPrototypeOf(async function () {
            }).constructor;
            const func = new AsyncFunction(...keys, expression ? `return (${code})` : code);

            // Execute with 'this' bound to the wrapper
            return await func.call(thisArg, ...values);
        }

        __executeFilter(thisArg, event, code) {
            let args = {}
            Object.assign(args, this.__apiMethods(thisArg))
            for (let key in event) {
                args[key] = event[key]
            }
            let keys = Object.keys(args)
            let values = Object.values(args)
            let func = new Function(...keys, `return (${code})`)
            return func.call(thisArg, ...values)
        }

        /**
         * Orchestrates the activation of a DOM tree.
         * @param {HTMLElement} root - The root of the subtree to activate.
         */
        activate = async (root = document.body) => {
            if (!root) return

            await this.__cancellable(async () => {
                await this.trigger("htmx:before:activate", {element: root}, root)

                // Gather children that must be activated (e.g., [hx-get], [hx-post], etc)
                const candidates = this.__queryAll(root, this.config.selectors.activate)

                for (let element of candidates) {
                    await this.__activateElement(element);
                }

                await this.trigger("htmx:after:activate", {element: root}, root);
            })
        }

        /**
         * Handles the setup of a single element.
         * @param {HTMLElement} nativeElement - The specific node to initialize.
         */
        __activateElement = async (nativeElement) => {
            if (element.__htmxElement) return; // Already activated

            await this.__cancellable(async () => {
                // Create HtmxElement wrapper
                const element = HtmxElement.from(nativeElement);

                await element.trigger("htmx:before:element:activate", {element});

                element.htmx.activated = true;

                await element.trigger("htmx:after:element:activate", {element});
            });
        }

        deactivate(el) {
            if (!el) return
            try {
                this.trigger('htmx:before:deactivate', {element: el}, el)

                // Deactivate all child elements with htmx state
                for (let child of el.querySelectorAll(`[${this.config.state.dom.attribute}]`)) {
                    this.deactivate(child)
                }

                // Cleanup element state
                if (el.__htmxElement) {
                    try {
                        const htmxElement = el.__htmxElement

                        this.trigger('htmx:before:element:deactivate', {element: htmxElement}, el)

                        // Clear intervals and timeouts
                        if (htmxElement.htmx.interval) clearInterval(htmxElement.htmx.interval)
                        for (let spec of htmxElement.htmx.triggerSpecs || []) {
                            if (spec.interval) clearInterval(spec.interval)
                            if (spec.timeout) clearTimeout(spec.timeout)
                        }

                        // Cleanup event listeners via HtmxElement
                        htmxElement.cleanup()

                        // Mark as deactivated
                        htmxElement.htmx.activated = false

                        // Remove reference
                        delete el.__htmxElement

                        this.trigger('htmx:after:element:deactivate', {element: htmxElement}, el)
                    } catch (e) {
                        if (e !== CANCELLED) throw e
                    }
                }

                this.trigger('htmx:after:deactivate', {element: el}, el)
            } catch (e) {
                if (e !== CANCELLED) throw e
            }
        }


        // TODO: Move to an `hx-preserve` feature module
        __handlePreservedElements(fragment) {
            let pantry = document.createElement('div')
            pantry.style.display = 'none'
            document.body.appendChild(pantry)
            let newPreservedElts =
                fragment.querySelectorAll?.(`[${this.getAttributeName('hx-preserve')}]`) || []
            for (let preservedElt of newPreservedElts) {
                let currentElt = document.getElementById(preservedElt.id)
                if (pantry.moveBefore) {
                    pantry.moveBefore(currentElt, null)
                } else {
                    pantry.appendChild(currentElt)
                }
            }
            return pantry
        }

        __restorePreservedElements(pantry) {
            for (let preservedElt of pantry.children) {
                let newElt = document.getElementById(preservedElt.id)
                if (newElt.parentNode.moveBefore) {
                    newElt.parentNode.moveBefore(preservedElt, newElt)
                } else {
                    newElt.replaceWith(preservedElt)
                }
                this.deactivate(newElt)
                newElt.remove()
            }
            pantry.remove()
        }

        __parseHTML(resp) {
            return Document.parseHTMLUnsafe?.(resp) || new DOMParser().parseFromString(resp, 'text/html')
        }

        // TODO: Reimplement
        // __makeFragment(text) {
        //   let response = text
        //     .replace(/<hx-([a-z]+)(\s+|>)/gi, '<template hx type="$1"$2')
        //     .replace(/<\/hx-[a-z]+>/gi, '</template>')
        //   let title = ''
        //   response = response.replace(
        //     /<title[^>]*>[\s\S]*?<\/title>/i,
        //     m => ((title = this.__parseHTML(m).title), ''),
        //   )
        //   let responseWithNoHead = response.replace(/<head(\s[^>]*)?>[\s\S]*?<\/head>/i, '')
        //   let startTag = responseWithNoHead.match(/<([a-z][^\/>\x20\t\r\n\f]*)/i)?.[1]?.toLowerCase()
        //
        //   let doc, fragment
        //   if (startTag === 'html') {
        //     doc = this.__parseHTML(response)
        //     fragment = doc.body
        //   } else if (startTag === 'body') {
        //     doc = this.__parseHTML(responseWithNoHead)
        //     fragment = doc.body
        //   } else {
        //     doc = this.__parseHTML(`<template>${responseWithNoHead}</template>`)
        //     fragment = doc.querySelector('template').content
        //   }
        //   this.__processScripts(fragment)
        //
        //   return {
        //     fragment,
        //     title,
        //   }
        // }

        // TODO: Reimplement via Swap class
        // __createOOBTask(tasks, el, oobValue, sourceElement) {
        //   let target = el.id ? '#' + CSS.escape(el.id) : null
        //   if (oobValue !== 'true' && oobValue && !oobValue.includes(' ')) {
        //     ;[oobValue, target = target] = oobValue.split(/:(.*)/)
        //   }
        //   if (oobValue === 'true' || !oobValue) oobValue = 'outerHTML'
        //
        //   let swap = this.__parseSwap(oobValue)
        //   target = swap.target || target
        //   swap.strip ??= !swap.style.startsWith('outer')
        //   if (!target) return
        //   let fragment = document.createDocumentFragment()
        //   fragment.append(el)
        //   tasks.push({ type: 'oob', fragment, target, swap, sourceElement })
        // }

        // TODO: Reimplement via Swap class
        // __processOOB(fragment, sourceElement, selectOOB) {
        //   let tasks = []
        //
        //   // Process hx-select-oob first (extract elements from response)
        //   if (selectOOB) {
        //     for (let spec of selectOOB.split(',')) {
        //       let [selector, oobValue = 'true'] = spec.split(/:(.*)/)
        //       for (let el of fragment.querySelectorAll(selector)) {
        //         this.__createOOBTask(tasks, el, oobValue, sourceElement)
        //       }
        //     }
        //   }
        //
        //   // Process elements with hx-swap-oob attribute
        //   for (let oobElt of fragment.querySelectorAll(`[${this.getAttributeName('hx-swap-oob')}]`)) {
        //     let oobValue = oobElt.getAttribute(this.getAttributeName('hx-swap-oob'))
        //     oobElt.removeAttribute(this.getAttributeName('hx-swap-oob'))
        //     this.__createOOBTask(tasks, oobElt, oobValue, sourceElement)
        //   }
        //
        //   return tasks
        // }

        // TODO: Reimplement via Swap class
        // __insertNodes(parent, before, fragment) {
        //   if (before) {
        //     before.before(...fragment.childNodes)
        //   } else {
        //     parent.append(...fragment.childNodes)
        //   }
        // }

        // TODO: Reimplement via Swap
        // __parseSwap(swapStr) {
        //   swapStr = swapStr.trim()
        //   let method = this.config.swap.method
        //   if (swapStr && !/^\S*:/.test(swapStr)) {
        //     let m = swapStr.match(/^(\S+)\s*(.*)$/)
        //     method = m[1]
        //     swapStr = m[2]
        //   }
        //   return {
        //     style:
        //       method === 'before'
        //         ? 'beforebegin'
        //         : method === 'after'
        //           ? 'afterend'
        //           : method === 'prepend'
        //             ? 'afterbegin'
        //             : method === 'append'
        //               ? 'beforeend'
        //               : method,
        //     ...this.__parse(swapStr),
        //   }
        // }

        // TODO: Reimplement via Swap class
        // __processPartials(fragment, ctx) {
        //   let tasks = []
        //
        //   for (let templateElt of fragment.querySelectorAll('template[hx]')) {
        //     let type = templateElt.getAttribute('type')
        //
        //     if (type === 'partial') {
        //       let swap = this.__parseSwap(
        //         templateElt.getAttribute(this.getAttributeName('hx-swap')) || this.config.swap.default,
        //       )
        //
        //       tasks.push({
        //         type: 'partial',
        //         fragment: templateElt.content.cloneNode(true),
        //         target: templateElt.getAttribute(this.getAttributeName('hx-target')),
        //         swap,
        //         sourceElement: ctx.sourceElement,
        //       })
        //     } else {
        //       this.__triggerExtensions(templateElt, 'htmx:process:' + type, { ctx, tasks })
        //     }
        //     templateElt.remove()
        //   }
        //
        //   return tasks
        // }

        __handleAutoFocus(el) {
            let autofocus = this.find(el, '[autofocus]')
            autofocus?.focus?.()
        }

        __handleScroll(task) {
            if (task.swap.scroll) {
                let target = task.swap.scrollTarget ? this.__findExt(task.swap.scrollTarget) : task.target
                if (task.swap.scroll === 'top') {
                    target.scrollTop = 0
                } else if (task.swap.scroll === 'bottom') {
                    target.scrollTop = target.scrollHeight
                }
            }
            if (task.swap.show) {
                let target = task.swap.showTarget ? this.__findExt(task.swap.showTarget) : task.target
                target.scrollIntoView(task.swap.show === 'top')
            }
        }

        __handleAnchorScroll(ctx) {
            let anchor = ctx.request?.originalAction?.split('#')[1]
            if (anchor) {
                document.getElementById(anchor)?.scrollIntoView({block: 'start', behavior: 'auto'})
            }
        }

        __processScripts(container) {
            let scripts = this.__queryAll(container, 'script')
            for (let oldScript of scripts) {
                let newScript = document.createElement('script')
                for (let attr of oldScript.attributes) {
                    newScript.setAttribute(attr.name, attr.value)
                }
                if (this.config.security.nonce) {
                    newScript.nonce = this.config.security.nonce
                }
                newScript.textContent = oldScript.textContent
                oldScript.replaceWith(newScript)
            }
        }

        //============================================================================================
        // Public JS API
        //============================================================================================

        async swap(ctx) {
            this.__handleHistoryUpdate(ctx)
            let {fragment, title} = this.__makeFragment(ctx.text)
            ctx.title = title
            let tasks = []

            // Process OOB and partials
            let oobTasks = this.__processOOB(fragment, ctx.sourceElement, ctx.selectOOB)
            let partialTasks = this.__processPartials(fragment, ctx)
            tasks.push(...oobTasks, ...partialTasks)

            // Process main swap
            let mainSwap = this.__processMainSwap(ctx, fragment, partialTasks)
            if (mainSwap) {
                tasks.push(mainSwap)
            }

            // TODO - can we remove this and just let the function complete?
            if (tasks.length === 0) return

            // Separate transition/nonTransition tasks
            let transitionTasks = tasks.filter(t => t.transition)
            let nonTransitionTasks = tasks.filter(t => !t.transition)

            this.trigger('htmx:before:swap', {ctx, tasks})

            // insert non-transition tasks immediately or with delay
            for (let task of nonTransitionTasks) {
                if (task.swap?.swap) {
                    setTimeout(() => this.__insertContent(task), this.parseInterval(task.swapSpec.swap))
                } else {
                    this.__insertContent(task)
                }
            }

            // insert transition tasks in the transition queue
            if (transitionTasks.length > 0) {
                let tasksWrapper = () => {
                    for (let task of transitionTasks) {
                        this.__insertContent(task)
                    }
                }
                await this.__submitTransitionTask(tasksWrapper)
            }

            this.trigger('htmx:after:swap', {ctx})
            if (ctx.title && !mainSwap?.swapSpec?.ignoreTitle) document.title = ctx.title
            await this.timeout(1)
            // invoke restore tasks
            for (let task of tasks) {
                for (let restore of task.restoreTasks || []) {
                    restore()
                }
            }
            this.trigger('htmx:after:restore', {ctx})
            this.__handleAnchorScroll(ctx)
            // TODO this stuff should be an extension
            // if (ctx.hx?.triggerafterswap) this.__handleTriggerHeader(ctx.hx.triggerafterswap, ctx.sourceElement);
        }

        __processMainSwap(ctx, fragment, partialTasks) {
            // Create main task if needed
            let swapSpec = this.__parseSwap(ctx.swap || this.config.swap.default)
            // skip creating main swap if extracting partials resulted in empty response except for delete style
            if (
                swapSpec.style === 'delete' ||
                /\S/.test(fragment.innerHTML || '') ||
                !partialTasks.length
            ) {
                if (ctx.extract) {
                    let selected = fragment.querySelectorAll(ctx.extract)
                    fragment = document.createDocumentFragment()
                    fragment.append(...selected)
                }
                if (ctx.sourceElement?.htmx?.boosted) {
                    swapSpec.show ||= 'top'
                }
                let mainSwap = {
                    type: 'main',
                    fragment,
                    target: this.__resolveTarget(
                        ctx.sourceElement || document.body,
                        swapSpec.target || ctx.target,
                    ),
                    swapSpec,
                    sourceElement: ctx.sourceElement,
                    transition: ctx.transition !== false && swapSpec.transition !== false,
                }
                return mainSwap
            }
        }

        __insertContent(task) {
            let {target, swapSpec, fragment} = task
            if (typeof target === 'string') {
                target = document.querySelector(target)
            }
            if (!target) return
            if (swapSpec.strip && fragment.firstElementChild) {
                task.unstripped = fragment
                fragment = document.createDocumentFragment()
                fragment.append(
                    ...(task.fragment.firstElementChild.content || task.fragment.firstElementChild)
                        .childNodes,
                )
            }

            let pantry = this.__handlePreservedElements(fragment)
            let parentNode = target.parentNode
            let newContent = [...fragment.childNodes]
            if (swapSpec.style === 'innerHTML') {
                this.__captureCSSTransitions(task, target)
                for (const child of target.children) {
                    this.deactivate(child)
                }
                target.replaceChildren(...fragment.childNodes)
            } else if (swapSpec.style === 'outerHTML') {
                if (parentNode) {
                    this.__captureCSSTransitions(task, parentNode)
                    this.__insertNodes(parentNode, target, fragment)
                    this.deactivate(target)
                    parentNode.removeChild(target)
                }
            } else if (swapSpec.style === 'innerMorph') {
                this.__morph(target, fragment, true)
            } else if (swapSpec.style === 'outerMorph') {
                this.__morph(target, fragment, false)
            } else if (swapSpec.style === 'beforebegin') {
                if (parentNode) {
                    this.__insertNodes(parentNode, target, fragment)
                }
            } else if (swapSpec.style === 'afterbegin') {
                this.__insertNodes(target, target.firstChild, fragment)
            } else if (swapSpec.style === 'beforeend') {
                this.__insertNodes(target, null, fragment)
            } else if (swapSpec.style === 'afterend') {
                if (parentNode) {
                    this.__insertNodes(parentNode, target.nextSibling, fragment)
                }
            } else if (swapSpec.style === 'delete') {
                if (parentNode) {
                    this.deactivate(target)
                    parentNode.removeChild(target)
                }
                return
            } else if (swapSpec.style === 'none') {
                return
            } else {
                task.target = target
                task.fragment = fragment
                if (!this.__triggerExtensions(target, 'htmx:handle:swap', task)) return
                throw new Error(`Unknown swap style: ${swapSpec.style}`)
            }
            this.__restorePreservedElements(pantry)
            for (const el of newContent) {
                this.activate(el)
                this.__handleAutoFocus(el)
            }
            this.__handleScroll(task)
        }

        // Reimplemented as `async trigger(...)`
        // trigger(eventName, detail = {}, element = document, bubbles = true) {
        //   element = this.__normalizeElement(element)
        //   if (this.config.debug.enable) console.log(eventName, detail, element)
        //   this.__triggerExtensions(element, eventName, detail)
        //   if (!this.trigger(element, eventName, detail, bubbles)) throw CANCELLED
        // }

        // __triggerExtensions(el, eventName, detail = {}) {
        //   let methods = this.#extMethods.get(eventName.replace(/:/g, '_'))
        //   if (methods) {
        //     detail.cancelled = false
        //     for (const fn of methods) {
        //       if (fn(el, detail) === false || detail.cancelled) {
        //         detail.cancelled = true
        //         return false
        //       }
        //     }
        //   }
        //   return true
        // }

        timeout(time) {
            time = this.parseInterval(time)
            if (time > 0) {
                return new Promise(resolve => setTimeout(resolve, time))
            }
        }

        forEvent(event, timeout, on = document) {
            return new Promise((resolve, reject) => {
                let handler = evt => {
                    clearTimeout(timeoutId)
                    resolve(evt)
                }

                let timeoutId =
                    timeout &&
                    setTimeout(() => {
                        on.removeEventListener(event, handler)
                        resolve(null)
                    }, timeout)

                on.addEventListener(event, handler, {once: true})
            })
        }

        onLoad(callback) {
            this.on('htmx:after:activate', evt => {
                callback(evt.target)
            })
        }

        takeClass(element, className, container = element.parentElement) {
            for (let el of this.findAll(this.__normalizeElement(container), '.' + className)) {
                el.classList.remove(className)
            }
            element.classList.add(className)
        }

        on(eventOrElt, eventOrCallback, callback) {
            let event
            let el = document
            if (callback === undefined) {
                event = eventOrElt
                callback = eventOrCallback
            } else {
                el = this.__normalizeElement(eventOrElt)
                event = eventOrCallback
            }
            el.addEventListener(event, callback)
            return callback
        }

        find(selectorOrElt, selector) {
            return this.__findExt(selectorOrElt, selector)
        }

        findAll(selectorOrElt, selector) {
            return this.__findAllExt(selectorOrElt, selector)
        }

        parseInterval(str) {
            if (typeof str === 'number') return str
            let m = {ms: 1, s: 1000, m: 60000}
            let [, n, u] = str?.match(/^([\d.]+)(ms|s|m)?$/) || []
            let v = parseFloat(n) * (m[u] || 1)
            return isNaN(v) ? undefined : v
        }

        // TODO: Reimplement as needed
        // trigger(on, eventName, detail = {}, bubbles = true) {
        //   on = this.__normalizeElement(on)
        //   let evt = new CustomEvent(eventName, {
        //     detail,
        //     cancelable: true,
        //     bubbles,
        //     composed: true,
        //     originalTarget: on,
        //   })
        //   let target = on.isConnected ? on : document
        //   let result = !detail.cancelled && target.dispatchEvent(evt)
        //   return result
        // }

        // TODO: Reimplement as needed
        // ajax(verb, path, context) {
        //   // Normalize context to object
        //   if (!context || context instanceof Element || typeof context === 'string') {
        //     context = { target: context }
        //   }
        //
        //   let sourceElt =
        //     typeof context.source === 'string' ? document.querySelector(context.source) : context.source
        //
        //   // If source selector was provided but didn't match, reject
        //   if (typeof context.source === 'string' && !sourceElt) {
        //     return Promise.reject(new Error('Source not found'))
        //   }
        //
        //   // Resolve target, defaulting to body only if no source or target provided
        //   let target = this.__resolveTarget(document.body, context.target || sourceElt)
        //   if (!target) {
        //     return Promise.reject(new Error('Target not found'))
        //   }
        //
        //   sourceElt ||= target
        //
        //   let ctx = this.__createRequestContext(sourceElt, context.event || {})
        //   Object.assign(ctx, context, { target })
        //   Object.assign(ctx.request, { activate: path, verb: verb.toUpperCase() })
        //   if (context.headers) Object.assign(ctx.request.headers, context.headers)
        //
        //   return this.__handleTriggerEvent(ctx)
        // }

        __showIndicators(el, indicatorsSelector) {
            let indicatorElements = []
            if (indicatorsSelector) {
                indicatorElements = [el, ...this.__queryAll(el, indicatorsSelector)]
                for (const indicator of indicatorElements) {
                    indicator._htmxReqCount ||= 0
                    indicator._htmxReqCount++
                    const indicatorElement = indicator.__htmxElement || createHtmxElement(indicator, this)
                    indicatorElement.htmx.loading = true
                }
            }
            return indicatorElements
        }

        __hideIndicators(indicatorElements) {
            for (let indicator of indicatorElements) {
                if (indicator._htmxReqCount) {
                    indicator._htmxReqCount--
                    if (indicator._htmxReqCount <= 0) {
                        const indicatorElement = indicator.__htmxElement || createHtmxElement(indicator, this)
                        indicatorElement.htmx.loading = null
                        delete indicator._htmxReqCount
                    }
                }
            }
        }

        __disableElements(el, disabledSelector) {
            let disabledElements = []
            if (disabledSelector) {
                disabledElements = this.__queryAll(el, disabledSelector)
                for (let indicator of disabledElements) {
                    indicator._htmxDisableCount ||= 0
                    indicator._htmxDisableCount++
                    indicator.disabled = true
                }
            }
            return disabledElements
        }

        __enableElements(disabledElements) {
            for (const indicator of disabledElements) {
                if (indicator._htmxDisableCount) {
                    indicator._htmxDisableCount--
                    if (indicator._htmxDisableCount <= 0) {
                        indicator.disabled = false
                        delete indicator._htmxDisableCount
                    }
                }
            }
        }

        __collectFormData(el, form, submitter) {
            let formData = form ? new FormData(form) : new FormData()
            let included = form ? new Set(form.elements) : new Set()
            if (!form && el.name) {
                formData.append(el.name, el.value)
                included.add(el)
            }
            if (submitter && submitter.name) {
                formData.append(submitter.name, submitter.value)
                included.add(submitter)
            }
            let includeSelector = this.getAttributeValue(el, 'hx-include')
            if (includeSelector) {
                let includeNodes = this.__findAllExt(el, includeSelector)
                for (let node of includeNodes) {
                    this.__addInputValues(node, included, formData)
                }
            }
            return formData
        }

        __addInputValues(el, included, formData) {
            let inputs = this.__queryAll(
                el,
                'input:not([disabled]), select:not([disabled]), textarea:not([disabled])',
            )

            for (let input of inputs) {
                if (!input.name || included.has(input)) continue
                included.add(input)

                let type = input.type
                if (type === 'checkbox' || type === 'radio') {
                    // Only add if checked
                    if (input.checked) {
                        formData.append(input.name, input.value)
                    }
                } else if (type === 'file') {
                    // Add all selected files
                    for (let file of input.files) {
                        formData.append(input.name, file)
                    }
                } else if (type === 'select-multiple') {
                    // Add all selected options
                    for (let option of input.selectedOptions) {
                        formData.append(input.name, option.value)
                    }
                } else if (input.matches('select, textarea, input')) {
                    // Regular inputs, single selects, textareas
                    formData.append(input.name, input.value)
                }
            }
        }

        // TODO: Implement via #defaultAttributes, like hx-on
        __handleHxVals(el, body) {
            let hxValsValue = this.getAttributeValue(el, 'hx-vals')
            if (hxValsValue) {
                let javascriptContent = this.__extractJavascriptContent(hxValsValue)
                if (javascriptContent) {
                    // Return promise for async evaluation
                    return this.__executeJavaScript(el, {}, javascriptContent, true).then(obj => {
                        for (let key in obj) {
                            body.append(key, obj[key])
                        }
                    })
                } else {
                    // Synchronous path
                    let obj = this.__parse(hxValsValue)
                    for (let key in obj) {
                        body.append(key, obj[key])
                    }
                }
            }
        }

        __stringHyperscriptStyleSelector(selector) {
            let s = selector.trim()
            return s.startsWith('<') && s.endsWith('/>') ? s.slice(1, -2) : s
        }

        __findAllExt(eltOrSelector, maybeSelector, global) {
            let selector = maybeSelector ?? eltOrSelector
            let el = maybeSelector ? this.__normalizeElement(eltOrSelector) : document
            if (selector.startsWith('global ')) {
                return this.__findAllExt(el, selector.slice(7), true)
            }
            let parts = selector
                ? selector
                    .replace(/<[^>]+\/>/g, m => m.replace(/,/g, '%2C'))
                    .split(',')
                    .map(p => p.replace(/%2C/g, ','))
                : []
            let result = []
            let unprocessedParts = []
            for (const part of parts) {
                let selector = this.__stringHyperscriptStyleSelector(part)
                let item
                if (selector.startsWith('closest ')) {
                    item = el.closest(selector.slice(8))
                } else if (selector.startsWith('find ')) {
                    item = document.querySelector(el, selector.slice(5))
                } else if (selector === 'next' || selector === 'nextElementSibling') {
                    item = el.nextElementSibling
                } else if (selector.startsWith('next ')) {
                    item = this.__scanForwardQuery(el, selector.slice(5), !!global)
                } else if (selector === 'previous' || selector === 'previousElementSibling') {
                    item = el.previousElementSibling
                } else if (selector.startsWith('previous ')) {
                    item = this.__scanBackwardsQuery(el, selector.slice(9), !!global)
                } else if (selector === 'document') {
                    item = document
                } else if (selector === 'window') {
                    item = window
                } else if (selector === 'body') {
                    item = document.body
                } else if (selector === 'root') {
                    item = this.__getRootNode(el, !!global)
                } else if (selector === 'host') {
                    item = el.getRootNode().host
                } else {
                    unprocessedParts.push(selector)
                }

                if (item) {
                    result.push(item)
                }
            }

            if (unprocessedParts.length > 0) {
                let standardSelector = unprocessedParts.join(',')
                let rootNode = this.__getRootNode(el, !!global)
                result.push(...rootNode.querySelectorAll(standardSelector))
            }

            return result
        }

        __scanForwardQuery(start, match, global) {
            return this.__scanUntilComparison(
                this.__getRootNode(start, global).querySelectorAll(match),
                start,
                Node.DOCUMENT_POSITION_PRECEDING,
            )
        }

        __scanBackwardsQuery(start, match, global) {
            let results = [...this.__getRootNode(start, global).querySelectorAll(match)].reverse()
            return this.__scanUntilComparison(results, start, Node.DOCUMENT_POSITION_FOLLOWING)
        }

        __scanUntilComparison(results, start, comparison) {
            for (const el of results) {
                if (el.compareDocumentPosition(start) === comparison) {
                    return el
                }
            }
        }

        __getRootNode(el, global) {
            if (el.isConnected && el.getRootNode) {
                return el.getRootNode?.({composed: global})
            } else {
                return document
            }
        }

        __findExt(eltOrSelector, selector) {
            return this.__findAllExt(eltOrSelector, selector)[0]
        }

        __extractJavascriptContent(string) {
            if (string != null) {
                if (string.startsWith('js:')) {
                    return string.substring(3)
                } else if (string.startsWith('javascript:')) {
                    return string.substring(11)
                }
            }
        }

        __initAbortListener(el) {
            el.addEventListener('htmx:abort', () => {
                let requestQueue = this.__getRequestQueue(el)
                requestQueue.abort()
            })
        }

        __morph(oldNode, fragment, innerHTML) {
            let {persistentIds, idMap} = this.__createIdMaps(oldNode, fragment)
            let pantry = document.createElement('div')
            pantry.hidden = true
            document.body.after(pantry)
            let ctx = {target: oldNode, idMap, persistentIds, pantry}

            if (innerHTML) {
                this.__morphChildren(ctx, oldNode, fragment)
            } else {
                this.__morphChildren(ctx, oldNode.parentNode, fragment, oldNode, oldNode.nextSibling)
            }
            this.deactivate(pantry)
            pantry.remove()
        }

        __morphChildren(ctx, oldParent, newParent, insertionPoint = null, endPoint = null) {
            if (oldParent instanceof HTMLTemplateElement && newParent instanceof HTMLTemplateElement) {
                oldParent = oldParent.content
                newParent = newParent.content
            }
            insertionPoint ||= oldParent.firstChild

            for (const newChild of newParent.childNodes) {
                if (insertionPoint && insertionPoint != endPoint) {
                    let bestMatch = this.__findBestMatch(ctx, newChild, insertionPoint, endPoint)
                    if (bestMatch) {
                        if (bestMatch !== insertionPoint) {
                            let cursor = insertionPoint
                            while (cursor && cursor !== bestMatch) {
                                let tempNode = cursor
                                cursor = cursor.nextSibling
                                this.__removeNode(ctx, tempNode)
                            }
                        }
                        this.__morphNode(bestMatch, newChild, ctx)
                        insertionPoint = bestMatch.nextSibling
                        continue
                    }
                }

                if (newChild instanceof Element && ctx.persistentIds.has(newChild.id)) {
                    let target =
                        (ctx.target.id === newChild.id && ctx.target) ||
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
                    this.__moveBefore(oldParent, target, insertionPoint)
                    this.__morphNode(target, newChild, ctx)
                    insertionPoint = target.nextSibling
                    continue
                }

                let tempChild
                if (ctx.idMap.has(newChild)) {
                    tempChild = document.createElement(newChild.tagName)
                    oldParent.insertBefore(tempChild, insertionPoint)
                    this.__morphNode(tempChild, newChild, ctx)
                } else {
                    tempChild = document.importNode(newChild, true)
                    oldParent.insertBefore(tempChild, insertionPoint)
                }
                insertionPoint = tempChild.nextSibling
            }

            while (insertionPoint && insertionPoint != endPoint) {
                let tempNode = insertionPoint
                insertionPoint = insertionPoint.nextSibling
                this.__removeNode(ctx, tempNode)
            }
        }

        __findBestMatch(ctx, node, startPoint, endPoint) {
            let softMatch = null,
                nextSibling = node.nextSibling,
                siblingSoftMatchCount = 0,
                displaceMatchCount = 0
            let newSet = ctx.idMap.get(node),
                nodeMatchCount = newSet?.size || 0
            let cursor = startPoint
            while (cursor && cursor != endPoint) {
                let oldSet = ctx.idMap.get(cursor)
                if (this.__isSoftMatch(cursor, node)) {
                    if (oldSet && newSet && [...oldSet].some(id => newSet.has(id))) return cursor
                    if (softMatch === null && !oldSet) {
                        if (!nodeMatchCount) return cursor
                        else softMatch = cursor
                    }
                }
                displaceMatchCount += oldSet?.size || 0
                if (displaceMatchCount > nodeMatchCount) break
                if (softMatch === null && nextSibling && this.__isSoftMatch(cursor, nextSibling)) {
                    siblingSoftMatchCount++
                    nextSibling = nextSibling.nextSibling
                    if (siblingSoftMatchCount >= 2) softMatch = undefined
                }
                if (cursor.contains(document.activeElement)) break
                cursor = cursor.nextSibling
            }
            return softMatch || null
        }

        __isSoftMatch(oldNode, newNode) {
            return (
                oldNode.nodeType === newNode.nodeType &&
                oldNode.tagName === newNode.tagName &&
                (!oldNode.id || oldNode.id === newNode.id)
            )
        }

        __removeNode(ctx, node) {
            if (ctx.idMap.has(node)) {
                this.__moveBefore(ctx.pantry, node, null)
            } else {
                this.deactivate(node)
                node.remove()
            }
        }

        __moveBefore(parentNode, element, after) {
            if (parentNode.moveBefore) {
                try {
                    parentNode.moveBefore(element, after)
                    return
                } catch (e) {
                    // ignore and insertBefore insteat
                }
            }
            parentNode.insertBefore(element, after)
        }

        __morphNode(oldNode, newNode, ctx) {
            let type = newNode.nodeType

            if (type === 1) {
                let noMorph = this.config.morphIgnore || []
                this.__copyAttributes(oldNode, newNode, noMorph)
                if (
                    oldNode instanceof HTMLTextAreaElement &&
                    oldNode.defaultValue != newNode.defaultValue
                ) {
                    oldNode.value = newNode.value
                }
            }

            if ((type === 8 || type === 3) && oldNode.nodeValue !== newNode.nodeValue) {
                oldNode.nodeValue = newNode.nodeValue
            }
            if (!oldNode.isEqualNode(newNode)) this.__morphChildren(ctx, oldNode, newNode)
        }

        __copyAttributes(destination, source, attributesToIgnore = []) {
            for (const attr of source.attributes) {
                if (
                    !attributesToIgnore.includes(attr.name) &&
                    destination.getAttribute(attr.name) !== attr.value
                ) {
                    destination.setAttribute(attr.name, attr.value)
                    if (
                        attr.name === 'value' &&
                        destination instanceof HTMLInputElement &&
                        destination.type !== 'file'
                    ) {
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

        __populateIdMapWithTree(idMap, persistentIds, root, elements) {
            for (const el of elements) {
                if (persistentIds.has(el.id)) {
                    let current = el
                    while (current && current !== root) {
                        let idSet = idMap.get(current)
                        if (idSet == null) {
                            idSet = new Set()
                            idMap.set(current, idSet)
                        }
                        idSet.add(el.id)
                        current = current.parentElement
                    }
                }
            }
        }

        __createIdMaps(oldNode, newContent) {
            let oldIdElements = this.__queryAll(oldNode, '[id]')
            let newIdElements = newContent.querySelectorAll('[id]')
            let persistentIds = this.__createPersistentIds(oldIdElements, newIdElements)
            let idMap = new Map()
            this.__populateIdMapWithTree(idMap, persistentIds, oldNode.parentElement, oldIdElements)
            this.__populateIdMapWithTree(idMap, persistentIds, newContent, newIdElements)
            return {persistentIds, idMap}
        }

        __createPersistentIds(oldIdElements, newIdElements) {
            let duplicateIds = new Set(),
                oldIdTagNameMap = new Map()
            for (const {id, tagName} of oldIdElements) {
                if (oldIdTagNameMap.has(id)) duplicateIds.add(id)
                else oldIdTagNameMap.set(id, tagName)
            }
            let persistentIds = new Set()
            for (const {id, tagName} of newIdElements) {
                if (persistentIds.has(id)) duplicateIds.add(id)
                else if (oldIdTagNameMap.get(id) === tagName) persistentIds.add(id)
            }
            for (const id of duplicateIds) persistentIds.delete(id)
            return persistentIds
        }

        __submitTransitionTask(task) {
            return new Promise(resolve => {
                this.#transitionQueue ||= []
                this.#transitionQueue.push({task, resolve})
                if (!this.#processingTransition) {
                    this.__processTransitionQueue()
                }
            })
        }

        // TODO: Figure out at which layer this should be a concern
        async __processTransitionQueue() {
            if (this.#transitionQueue.length === 0 || this.#processingTransition) {
                return
            }

            this.#processingTransition = true
            let {task, resolve} = this.#transitionQueue.shift()

            try {
                if (document.startViewTransition) {
                    this.trigger('htmx:before:transition', {task})
                    await document.startViewTransition(task).finished
                    this.trigger('htmx:after:transition', {task})
                } else {
                    task()
                }
            } catch (e) {
                // Transitions can be skipped/aborted - this is normal
                if (e !== CANCELLED) throw e
            } finally {
                this.#processingTransition = false
                resolve()
                this.__processTransitionQueue()
            }
        }

        __captureCSSTransitions(task, root) {
            let idElements = root.querySelectorAll('[id]')
            let existingElementsById = Object.fromEntries([...idElements].map(e => [e.id, e]))
            let newElementsWithIds = task.fragment.querySelectorAll('[id]')
            task.restoreTasks = []
            for (let el of newElementsWithIds) {
                let existing = existingElementsById[el.id]
                if (existing?.tagName === el.tagName) {
                    let clone = el.cloneNode(false) // shallow clone node
                    this.__copyAttributes(el, existing, this.config.morphIgnore)
                    task.restoreTasks.push(() => {
                        this.__copyAttributes(el, clone, this.config.morphIgnore)
                    })
                }
            }
        }

        __normalizeElement(cssOrElement) {
            if (typeof cssOrElement === 'string') {
                return this.find(cssOrElement)
            } else {
                return cssOrElement
            }
        }
    }

    const RelaxedJSON = {
        parse(str) {
            if (!str) return {}; // Guard against null/undefined/empty
            if (str[0] === '{') return JSON.parse(str)
            let pattern = /([^\s,]+?)(?:\s*:\s*(?:"([^"]*)"|'([^']*)'|<([^>]+)\/>|([^\s,]+)))?(?=\s|,|$)/g
            return [...str.matchAll(pattern)].reduce((result, match) => {
                let keyPath = match[1].split('.')
                let value = (match[2] ?? match[3] ?? match[4] ?? match[5] ?? 'true').trim()
                if (value === 'true') value = true
                else if (value === 'false') value = false
                else if (/^\d+$/.test(value)) value = parseInt(value)
                keyPath.slice(0, -1).reduce((obj, key) => (obj[key] ??= {}), result)[keyPath.at(-1)] = value
                return result
            }, {})
        },
        stringify(obj) {
            if (!obj) return "";
            return Object.entries(obj)
                .map(([k, v]) => {
                    if (v === true) return k
                    if (typeof v === 'string' && v.includes(' ')) return `${k}:"${v}"`
                    return `${k}:${v}`
                })
                .join(' ')
        },
    }

    class ReqQ {
        #c = null
        #q = []

        issue(ctx, queueStrategy) {
            if (!this.#c) {
                this.#c = ctx
                return true
            } else {
                // Update ctx.status properly for replaced request contexts
                if (queueStrategy === 'replace') {
                    this.#q.map(value => (value.status = 'dropped'))
                    this.#q = []
                    if (this.#c) {
                        this.#c.abort()
                    }
                    return true
                } else if (queueStrategy === 'queue all') {
                    this.#q.push(ctx)
                    ctx.status = 'queued'
                } else if (queueStrategy === 'drop') {
                    // ignore the request
                    ctx.status = 'dropped'
                } else if (queueStrategy === 'queue last') {
                    this.#q.map(value => (value.status = 'dropped'))
                    this.#q = [ctx]
                    ctx.status = 'queued'
                } else if (this.#q.length === 0) {
                    // default queue first
                    this.#q.push(ctx)
                    ctx.status = 'queued'
                } else {
                    ctx.status = 'dropped'
                }
                return false
            }
        }

        finish() {
            this.#c = null
        }

        next() {
            return this.#q.shift()
        }

        abort() {
            this.#c?.abort?.()
        }

        more() {
            return this.#q?.length
        }
    }

    class HtmxRequest {
        constructor({element, event, action, verb, headers = {}, body = null, config}) {
            Object.assign(this, {element, event, action, verb, headers, body, config})
            this.abortController = new AbortController()
        }

        async execute() {
            // Build fetch request
            const fetchOptions = {
                method: this.verb,
                headers: this.headers,
                signal: this.abortController.signal,
                credentials: this.config.request.credentials,
                mode: this.config.request.mode,
            }

            // Add body if not GET
            if (this.verb !== 'GET' && this.body) {
                fetchOptions.body = this.body
            }

            // Setup timeout
            const timeout = this.config.request.timeout
            const timeoutId = timeout ? setTimeout(() => this.abort(), timeout) : null

            try {
                // Execute fetch
                const rawResponse = await fetch(this.action, fetchOptions)

                // Clear timeout
                if (timeoutId) clearTimeout(timeoutId)

                // Create and return HtmxResponse
                return new HtmxResponse({
                    request: this,
                    raw: rawResponse,
                })
            } catch (error) {
                // Clear timeout on error
                if (timeoutId) clearTimeout(timeoutId)
                throw error
            }
        }

        abort() {
            this.abortController.abort()
        }
    }

    class HtmxResponse {
        #text

        constructor({request, raw}) {
            this.request = request
            this.raw = raw
            this.status = raw.status
            this.headers = Object.fromEntries(raw.headers)
        }

        async text() {
            if (!this.#text) {
                this.#text = await this.raw.text()
            }
            return this.#text
        }

        isSSE() {
            return this.raw.headers.get('content-type')?.includes('text/event-stream')
        }
    }

    class Swap {
        constructor({fragment, method, target}) {
            this.fragment = fragment
            this.method = method
            this.target = target
        }

        perform() {
            if (!this.target) return

            const parent = this.target.parentNode

            switch (this.method) {
                case 'innerHTML':
                    this.target.replaceChildren(...this.fragment.childNodes)
                    break
                case 'outerHTML':
                    if (parent) this.target.replaceWith(...this.fragment.childNodes)
                    break
                case 'beforebegin':
                    if (parent) this.target.before(...this.fragment.childNodes)
                    break
                case 'afterbegin':
                    this.target.prepend(...this.fragment.childNodes)
                    break
                case 'beforeend':
                    this.target.append(...this.fragment.childNodes)
                    break
                case 'afterend':
                    if (parent) this.target.after(...this.fragment.childNodes)
                    break
                case 'delete':
                    if (parent) parent.removeChild(this.target)
                    break
                case 'none':
                    // No-op
                    break
                default:
                    throw new Error(`Unknown swap method: ${this.method}`)
            }

            return this.target
        }
    }

    /**
     * Extract Swap instances from an HtmxResponse
     * Returns array of Swap objects: [main swap, ...oob swaps, ...partial swaps]
     */
    async function extractSwapsFromResponse(response, htmx) {
        const swaps = []
        const text = await response.text()

        // Parse HTML (convert <hx-*> tags to <template> tags)
        let html = text
            .replace(/<hx-([a-z]+)(\s+|>)/gi, '<template hx type="$1"$2')
            .replace(/<\/hx-[a-z]+>/gi, '</template>')

        // Remove <head> content
        let htmlWithNoHead = html.replace(/<head(\s[^>]*)?>[\s\S]*?<\/head>/i, '')
        let startTag = htmlWithNoHead.match(/<([a-z][^\/>\x20\t\r\n\f]*)/i)?.[1]?.toLowerCase()

        // Parse into fragment
        let doc, fragment
        if (startTag === 'html') {
            doc = htmx.__parseHTML(html)
            fragment = doc.body
        } else if (startTag === 'body') {
            doc = htmx.__parseHTML(htmlWithNoHead)
            fragment = doc.body
        } else {
            doc = htmx.__parseHTML(`<template>${htmlWithNoHead}</template>`)
            fragment = doc.querySelector('template').content
        }

        // Extract OOB swaps from selectOOB config
        const config = response.request.config
        if (config.swap.selectOOB) {
            for (let spec of config.swap.selectOOB.split(',')) {
                let [selector, oobValue = 'true'] = spec.trim().split(/:(.*)/)
                for (let el of fragment.querySelectorAll(selector)) {
                    let target = el.id ? '#' + CSS.escape(el.id) : null

                    // Parse oobValue: could be "true", a swap method, or "method:target"
                    let method = 'outerHTML'
                    if (oobValue !== 'true' && oobValue && !oobValue.includes(' ')) {
                        ;[oobValue, target = target] = oobValue.split(/:(.*)/)
                    }
                    if (oobValue && oobValue !== 'true') method = oobValue

                    if (!target) continue

                    let oobFragment = document.createDocumentFragment()
                    oobFragment.append(el)

                    swaps.push(
                        new Swap({
                            type: 'oob',
                            response,
                            fragment: oobFragment,
                            method,
                            target,
                        }),
                    )
                }
            }
        }

        // Extract OOB swaps from hx-swap-oob attributes
        for (let oobElt of fragment.querySelectorAll(`[${this.getAttributeName('hx-swap-oob')}]`)) {
            let oobValue = oobElt.getAttribute(this.getAttributeName('hx-swap-oob'))
            oobElt.removeAttribute(this.getAttributeName('hx-swap-oob'))

            let target = oobElt.id ? '#' + CSS.escape(oobElt.id) : null

            // Parse oobValue: could be "true", a swap method, or "method:target"
            let method = 'outerHTML'
            if (oobValue !== 'true' && oobValue && !oobValue.includes(' ')) {
                ;[oobValue, target = target] = oobValue.split(/:(.*)/)
            }
            if (oobValue && oobValue !== 'true') method = oobValue

            if (!target) continue

            let oobFragment = document.createDocumentFragment()
            oobFragment.append(oobElt)

            swaps.push(
                new Swap({
                    type: 'oob',
                    response,
                    fragment: oobFragment,
                    method,
                    target,
                }),
            )
        }

        // Extract partial swaps (template elements with hx type="partial")
        for (let templateElt of fragment.querySelectorAll('template[hx]')) {
            let type = templateElt.getAttribute('type')

            if (type === 'partial') {
                let method = templateElt.getAttribute(this.getAttributeName('hx-swap')) || config.swap.method
                let target = templateElt.getAttribute(this.getAttributeName('hx-target'))

                swaps.push(
                    new Swap({
                        // TODO: include type?
                        type: 'partial',
                        response,
                        fragment: templateElt.content.cloneNode(true),
                        method,
                        target,
                    }),
                )

                templateElt.remove()
            } else {
                // Other template types handled by extensions
                htmx.__triggerExtensions(templateElt, 'htmx:process:' + type, {response, swaps})
            }
        }

        // Create main swap
        const mainSwap = new Swap({
            // TODO: include type?
            type: 'main',
            response,
            fragment,
            method: config.swap.method,
            target: config.swap.target,
        })
        swaps.push(mainSwap)

        return swaps
    }

    return new Htmx()
})()
