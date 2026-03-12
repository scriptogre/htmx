/**
 * htmx WebSocket Extension
 *
 * Provides WebSocket connectivity via hx-ws:connect and hx-ws:send attributes.
 * Supports connection sharing, reconnection, JSON envelope protocol, and
 * HTML partial swapping.
 *
 * Usage:
 *   <div hx-ws:connect="/ws/chat">
 *     <div id="messages"></div>
 *     <form hx-ws:send>
 *       <input name="message">
 *       <button>Send</button>
 *     </form>
 *   </div>
 */

;(() => {
    let api

    // ========================================
    // ATTRIBUTE HELPERS
    // ========================================

    function getWsAttribute(element, attrName) {
        let val = api.attr(element, 'hx-ws:' + attrName)
        if (val != null) return val
        val = api.attr(element, 'hx-ws-' + attrName)
        if (val != null) return val
        if (attrName === 'send') {
            val = api.attr(element, 'hx-ws')
            if (val != null) return val
        }
        return null
    }

    function hasWsAttribute(element, attrName) {
        return getWsAttribute(element, attrName) != null
    }

    function buildWsSelector(attrName) {
        const prefix = htmx.config.prefix || 'hx-'
        const colonAttr = prefix + 'ws:' + attrName
        const hyphenAttr = prefix + 'ws-' + attrName
        return `[${colonAttr.replace(':', '\\:')}],[${hyphenAttr}]`
    }

    // ========================================
    // CONFIGURATION
    // ========================================

    function getConfig() {
        const defaults = {
            reconnect: true,
            reconnectDelay: 1000,
            reconnectMaxDelay: 30000,
            reconnectJitter: true,
            pendingRequestTTL: 30000
        }
        return {...defaults, ...(htmx.config.websockets || {})}
    }

    // ========================================
    // URL NORMALIZATION
    // ========================================

    function normalizeWebSocketUrl(url) {
        if (url.startsWith('ws://') || url.startsWith('wss://')) return url
        if (url.startsWith('http://')) return 'ws://' + url.slice(7)
        if (url.startsWith('https://')) return 'wss://' + url.slice(8)

        const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
        const host = window.location.host

        if (url.startsWith('//')) return protocol + url
        if (url.startsWith('/')) return protocol + '//' + host + url

        const basePath = window.location.pathname.substring(0, window.location.pathname.lastIndexOf('/') + 1)
        return protocol + '//' + host + basePath + url
    }

    // ========================================
    // CONNECTION REGISTRY
    // ========================================

    const connectionRegistry = new Map()

    function getOrCreateConnection(url, element) {
        const normalizedUrl = normalizeWebSocketUrl(url)

        if (connectionRegistry.has(normalizedUrl)) {
            const entry = connectionRegistry.get(normalizedUrl)
            entry.refCount++
            entry.elements.add(element)
            return entry
        }

        const entry = {
            url: normalizedUrl,
            socket: null,
            refCount: 1,
            elements: new Set([element]),
            reconnectAttempts: 0,
            reconnectTimer: null,
            pendingRequests: new Map(),
            listeners: {}
        }

        if (!triggerEvent(element, 'htmx:before:ws:connect', {url: normalizedUrl})) {
            return null
        }

        connectionRegistry.set(normalizedUrl, entry)
        createWebSocket(normalizedUrl, entry)
        return entry
    }

    function createWebSocket(url, entry) {
        const firstElement = entry.elements.values().next().value

        if (entry.socket) {
            const oldSocket = entry.socket
            entry.socket = null
            if (entry.listeners.open) oldSocket.removeEventListener('open', entry.listeners.open)
            if (entry.listeners.message) oldSocket.removeEventListener('message', entry.listeners.message)
            if (entry.listeners.close) oldSocket.removeEventListener('close', entry.listeners.close)
            if (entry.listeners.error) oldSocket.removeEventListener('error', entry.listeners.error)
            try {
                if (oldSocket.readyState === WebSocket.OPEN || oldSocket.readyState === WebSocket.CONNECTING) {
                    oldSocket.close()
                }
            } catch (e) {}
        }

        try {
            entry.socket = new WebSocket(url)

            entry.listeners.open = () => {
                entry.reconnectAttempts = 0
                if (firstElement) {
                    triggerEvent(firstElement, 'htmx:after:ws:connect', {url, socket: entry.socket})
                }
            }

            entry.listeners.message = (event) => {
                handleMessage(entry, event)
            }

            entry.listeners.close = (event) => {
                if (event.target !== entry.socket) return
                if (firstElement) {
                    triggerEvent(firstElement, 'htmx:ws:close', {url, code: event.code, reason: event.reason})
                }
                if (!connectionRegistry.has(url)) return
                const config = getConfig()
                if (config.reconnect && entry.refCount > 0) {
                    scheduleReconnect(url, entry)
                } else {
                    entry.pendingRequests.clear()
                    connectionRegistry.delete(url)
                }
            }

            entry.listeners.error = (error) => {
                if (firstElement) {
                    triggerEvent(firstElement, 'htmx:ws:error', {url, error})
                }
            }

            entry.socket.addEventListener('open', entry.listeners.open)
            entry.socket.addEventListener('message', entry.listeners.message)
            entry.socket.addEventListener('close', entry.listeners.close)
            entry.socket.addEventListener('error', entry.listeners.error)
        } catch (error) {
            if (firstElement) {
                triggerEvent(firstElement, 'htmx:ws:error', {url, error})
            }
        }
    }

    function scheduleReconnect(url, entry) {
        const config = getConfig()
        entry.reconnectAttempts++
        const attempts = entry.reconnectAttempts

        let delay = Math.min(
            (config.reconnectDelay || 1000) * Math.pow(2, attempts - 1),
            config.reconnectMaxDelay || 30000
        )
        if (config.reconnectJitter) {
            delay = delay * (0.75 + Math.random() * 0.5)
        }

        entry.reconnectTimer = setTimeout(() => {
            if (entry.refCount > 0) {
                const firstElement = entry.elements.values().next().value
                if (firstElement) {
                    triggerEvent(firstElement, 'htmx:ws:reconnect', {url, attempts})
                }
                createWebSocket(url, entry)
            }
        }, delay)
    }

    function decrementRef(url, element) {
        const normalizedUrl = normalizeWebSocketUrl(url)
        if (!connectionRegistry.has(normalizedUrl)) return

        const entry = connectionRegistry.get(normalizedUrl)
        if (!entry.elements.has(element)) return
        entry.elements.delete(element)
        entry.refCount--

        if (entry.refCount <= 0) {
            if (entry.reconnectTimer) clearTimeout(entry.reconnectTimer)
            entry.pendingRequests.clear()
            if (entry.socket && entry.socket.readyState === WebSocket.OPEN) {
                entry.socket.close()
            }
            connectionRegistry.delete(normalizedUrl)
        }
    }

    // ========================================
    // MESSAGE SENDING
    // ========================================

    function looksLikeUrl(value) {
        if (!value) return false
        return value.startsWith('/') || value.startsWith('.') ||
            value.startsWith('ws:') || value.startsWith('wss:') ||
            value.startsWith('http:') || value.startsWith('https:') ||
            value.startsWith('//')
    }

    async function sendMessage(element, event) {
        let url = getWsAttribute(element, 'send')
        if (!looksLikeUrl(url)) {
            const selector = buildWsSelector('connect')
            const ancestor = element.closest(selector)
            if (ancestor) {
                url = getWsAttribute(ancestor, 'connect')
            } else {
                url = null
            }
        }

        if (!url) {
            triggerEvent(element, 'htmx:wsSendError', {element, error: 'No WebSocket connection found for element'})
            return
        }

        const normalizedUrl = normalizeWebSocketUrl(url)
        const entry = connectionRegistry.get(normalizedUrl)
        if (!entry || !entry.socket || entry.socket.readyState !== WebSocket.OPEN) {
            triggerEvent(element, 'htmx:wsSendError', {url: normalizedUrl, error: 'Connection not open'})
            return
        }

        // Collect form data
        const form = element.form || element.closest('form')
        const body = form ? new FormData(form) : new FormData()

        // Handle hx-vals
        const valsAttr = api.attr(element, 'hx-vals')
        if (valsAttr) {
            let vals = null
            if (valsAttr.startsWith('js:') || valsAttr.startsWith('javascript:')) {
                const expr = valsAttr.startsWith('js:') ? valsAttr.slice(3) : valsAttr.slice(11)
                try {
                    vals = await new Function('return (async () => (' + expr + '))()')()
                } catch (e) { /* ignore eval errors */ }
            } else {
                try { vals = JSON.parse(valsAttr) } catch (e) { /* ignore parse errors */ }
            }
            if (vals && typeof vals === 'object') {
                for (const [k, v] of Object.entries(vals)) {
                    body.set(k, v)
                }
            }
        }

        // Build values object preserving multi-value fields
        const values = {}
        for (const [key, value] of body) {
            if (key in values) {
                if (!Array.isArray(values[key])) values[key] = [values[key]]
                values[key].push(value)
            } else {
                values[key] = value
            }
        }

        // Build headers
        const headers = {
            'HX-Request': 'true',
            'HX-Current-URL': window.location.href
        }
        if (element.id) headers['HX-Trigger'] = element.id
        const targetAttr = api.attr(element, 'hx-target')
        if (targetAttr) headers['HX-Target'] = targetAttr

        const requestId = generateUUID()
        const message = {
            type: 'request',
            request_id: requestId,
            event: event.type,
            headers,
            values,
            path: normalizedUrl
        }
        if (element.id) message.id = element.id

        const detail = {data: message, element, url: normalizedUrl}
        if (!triggerEvent(element, 'htmx:before:ws:send', detail)) return

        try {
            entry.socket.send(JSON.stringify(detail.data))
            entry.pendingRequests.set(requestId, {element, timestamp: Date.now()})
            triggerEvent(element, 'htmx:after:ws:send', {data: detail.data, url: normalizedUrl})
        } catch (error) {
            triggerEvent(element, 'htmx:wsSendError', {url: normalizedUrl, error})
        }
    }

    function generateUUID() {
        return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function (c) {
            const r = Math.random() * 16 | 0
            const v = c === 'x' ? r : (r & 0x3 | 0x8)
            return v.toString(16)
        })
    }

    // ========================================
    // MESSAGE RECEIVING & ROUTING
    // ========================================

    function handleMessage(entry, event) {
        let envelope
        try {
            envelope = JSON.parse(event.data)
        } catch (e) {
            const firstElement = entry.elements.values().next().value
            if (firstElement) {
                triggerEvent(firstElement, 'htmx:wsUnknownMessage', {data: event.data, parseError: e})
            }
            return
        }

        envelope.channel = envelope.channel || 'ui'
        envelope.format = envelope.format || 'html'

        let targetElement = null
        if (envelope.request_id && entry.pendingRequests.has(envelope.request_id)) {
            targetElement = entry.pendingRequests.get(envelope.request_id).element
            entry.pendingRequests.delete(envelope.request_id)
        } else {
            targetElement = entry.elements.values().next().value
        }

        if (!triggerEvent(targetElement, 'htmx:before:ws:message', {envelope, element: targetElement})) return

        if (envelope.channel === 'ui' && envelope.format === 'html') {
            handleHtmlMessage(targetElement, envelope)
        } else {
            triggerEvent(targetElement, 'htmx:wsMessage', {...envelope, element: targetElement})
        }

        triggerEvent(targetElement, 'htmx:after:ws:message', {envelope, element: targetElement})
    }

    // ========================================
    // HTML PARTIAL HANDLING
    // ========================================

    function handleHtmlMessage(element, envelope) {
        const parser = new DOMParser()
        const doc = parser.parseFromString(envelope.payload || '', 'text/html')
        const partials = doc.querySelectorAll('hx-partial')

        if (partials.length === 0) {
            const target = resolveTarget(element, envelope.target)
            if (target) {
                swapContent(target, envelope.payload, element, envelope.swap)
            }
            return
        }

        for (const partial of partials) {
            const targetId = partial.getAttribute('id')
            if (!targetId) continue
            const target = document.getElementById(targetId)
            if (!target) continue
            swapContent(target, partial.innerHTML, element, envelope.swap)
        }
    }

    function resolveTarget(element, envelopeTarget) {
        if (envelopeTarget) {
            if (envelopeTarget === 'this') return element
            return document.querySelector(envelopeTarget)
        }
        const targetSelector = api.attr(element, 'hx-target')
        if (targetSelector) {
            if (targetSelector === 'this') return element
            return document.querySelector(targetSelector)
        }
        return element
    }

    function swapContent(target, content, sourceElement, envelopeSwap) {
        const swapStyle = envelopeSwap || api.attr(sourceElement, 'hx-swap') || htmx.config.defaultSwap || 'innerHTML'
        // Don't pass element — target and swap are already resolved by the WS extension.
        // This prevents hxTarget/hxSwap from overriding our resolved values.
        htmx.swap({
            target,
            content: content || '',
            style: swapStyle,
        })
    }

    // ========================================
    // EVENT HELPERS
    // ========================================

    function triggerEvent(element, eventName, detail = {}) {
        if (!element) return true
        return htmx.trigger(element, eventName, detail)
    }

    // ========================================
    // ELEMENT LIFECYCLE
    // ========================================

    function initializeElement(element) {
        if (element._htmx?.wsInitialized) return

        const connectUrl = getWsAttribute(element, 'connect')
        if (!connectUrl) return

        element._htmx = element._htmx || {}
        element._htmx.wsInitialized = true

        const triggerSpec = api.attr(element, 'hx-trigger')

        if (!triggerSpec) {
            const entry = getOrCreateConnection(connectUrl, element)
            if (entry) element._htmx.wsUrl = entry.url
        } else {
            const specs = htmx.parseTriggerSpecs(triggerSpec)
            if (specs.length > 0) {
                const spec = specs[0]
                if (spec.name === 'load') {
                    const entry = getOrCreateConnection(connectUrl, element)
                    if (entry) element._htmx.wsUrl = entry.url
                } else {
                    element.addEventListener(spec.name, () => {
                        if (!element._htmx?.wsUrl) {
                            const entry = getOrCreateConnection(connectUrl, element)
                            if (entry) element._htmx.wsUrl = entry.url
                        }
                    }, {once: true})
                }
            }
        }
    }

    function initializeSendElement(element) {
        if (element._htmx?.wsSendInitialized) return

        const sendAttr = getWsAttribute(element, 'send')
        const sendUrl = looksLikeUrl(sendAttr) ? sendAttr : null
        let triggerSpec = api.attr(element, 'hx-trigger')

        if (!triggerSpec) {
            triggerSpec = element.matches('form') ? 'submit' :
                element.matches('input:not([type=button]),select,textarea') ? 'change' : 'click'
        }

        const specs = htmx.parseTriggerSpecs(triggerSpec)
        if (specs.length > 0) {
            const spec = specs[0]

            const handler = async (evt) => {
                if (element.matches('form') && evt.type === 'submit') {
                    evt.preventDefault()
                }
                if (sendUrl && !element._htmx?.wsUrl) {
                    const entry = getOrCreateConnection(sendUrl, element)
                    if (entry) element._htmx.wsUrl = entry.url
                }
                await sendMessage(element, evt)
            }

            element.addEventListener(spec.name, handler)
            element._htmx = element._htmx || {}
            element._htmx.wsSendInitialized = true
            element._htmx.wsSendHandler = handler
            element._htmx.wsSendEvent = spec.name
        }
    }

    function cleanupElement(element) {
        if (element._htmx?.wsUrl) {
            decrementRef(element._htmx.wsUrl, element)
        }
        if (element._htmx?.wsSendHandler) {
            element.removeEventListener(element._htmx.wsSendEvent, element._htmx.wsSendHandler)
        }
    }

    // ========================================
    // BACKWARD COMPATIBILITY
    // ========================================

    function checkLegacyAttributes(element) {
        if (element.hasAttribute('ws-connect') || element.hasAttribute('ws-send')) {
            console.warn('HTMX WebSocket: Legacy attributes ws-connect and ws-send are deprecated. Use hx-ws:connect and hx-ws:send instead.')

            if (element.hasAttribute('ws-connect')) {
                const url = element.getAttribute('ws-connect')
                const attr = (htmx.config.prefix || 'hx-') + 'ws-connect'
                if (!element.hasAttribute(attr)) element.setAttribute(attr, url)
            }
            if (element.hasAttribute('ws-send')) {
                const attr = (htmx.config.prefix || 'hx-') + 'ws-send'
                if (!element.hasAttribute(attr)) element.setAttribute(attr, '')
            }
        }
    }

    function processNode(node) {
        checkLegacyAttributes(node)
        if (hasWsAttribute(node, 'connect')) initializeElement(node)
        if (hasWsAttribute(node, 'send')) initializeSendElement(node)
    }

    // ========================================
    // EXTENSION REGISTRATION
    // ========================================

    htmx.install('hx-ws', {
        on: {
            'htmx:after:init': (detail, _api) => {
                api = _api
                const element = detail.element
                processNode(element)

                const connectSelector = buildWsSelector('connect')
                const sendSelector = buildWsSelector('send')
                const plainAttr = (htmx.config.prefix || 'hx-') + 'ws'
                const fullSelector = `${connectSelector},${sendSelector},[${plainAttr}],[ws-connect],[ws-send]`
                element.querySelectorAll(fullSelector).forEach(processNode)
            },

            'htmx:before:cleanup': (detail) => {
                cleanupElement(detail.element)
            },
        },
    })

    // Expose registry for testing
    if (typeof window !== 'undefined' && window.htmx) {
        window.htmx.ext = window.htmx.ext || {}
        window.htmx.ext.ws = {
            getRegistry: () => ({
                clear: () => {
                    const entries = Array.from(connectionRegistry.values())
                    connectionRegistry.clear()
                    entries.forEach(entry => {
                        entry.refCount = 0
                        if (entry.reconnectTimer) clearTimeout(entry.reconnectTimer)
                        if (entry.socket) entry.socket.close()
                        entry.elements.clear()
                        entry.pendingRequests.clear()
                    })
                },
                get: (key) => connectionRegistry.get(normalizeWebSocketUrl(key)),
                has: (key) => connectionRegistry.has(normalizeWebSocketUrl(key)),
                size: connectionRegistry.size
            })
        }
    }
})()
