/**
 * htmx SSE Extension
 *
 * Intercepts responses with Content-Type: text/event-stream and handles them
 * as Server-Sent Events streams. Supports reconnection with exponential backoff,
 * custom events, and HTML swapping.
 *
 * Usage: Just use hx-get as normal — SSE is auto-detected from the response Content-Type.
 *
 * Configuration via hx-config attribute (space-separated sse.key:value pairs):
 *   hx-config="sse.reconnect:true sse.reconnectDelay:50ms sse.reconnectMaxAttempts:3"
 *
 * Or via global config:
 *   htmx.config.sse = { reconnect: true, reconnectDelay: 500 }
 */

;(() => {

    // ========================================
    // SSE PARSER
    // ========================================

    async function* parseSSE(reader) {
        const decoder = new TextDecoder()
        let buffer = ''
        let hasData = false
        let message = {data: '', event: '', id: '', retry: null}
        let firstChunk = true

        try {
            while (true) {
                const {done, value} = await reader.read()
                if (done) break

                let chunk = decoder.decode(value, {stream: true})
                if (firstChunk) {
                    if (chunk.charCodeAt(0) === 0xFEFF) chunk = chunk.slice(1)
                    firstChunk = false
                }
                buffer += chunk

                const lines = buffer.split(/\r\n|\r|\n/)
                buffer = lines.pop() || ''

                for (const line of lines) {
                    if (!line) {
                        if (hasData) {
                            yield message
                            hasData = false
                            message = {data: '', event: '', id: '', retry: null}
                        }
                        continue
                    }

                    const colonIndex = line.indexOf(':')
                    if (colonIndex === 0) continue

                    let field, val
                    if (colonIndex < 0) {
                        field = line
                        val = ''
                    } else {
                        field = line.slice(0, colonIndex)
                        val = line.slice(colonIndex + 1)
                        if (val[0] === ' ') val = val.slice(1)
                    }

                    if (field === 'data') {
                        message.data += (hasData ? '\n' : '') + val
                        hasData = true
                    } else if (field === 'event') {
                        message.event = val
                    } else if (field === 'id') {
                        if (!val.includes('\0')) message.id = val
                    } else if (field === 'retry') {
                        const retryValue = parseInt(val, 10)
                        if (!isNaN(retryValue)) message.retry = retryValue
                    }
                }
            }
        } finally {
            reader.releaseLock()
        }
    }

    // ========================================
    // CONFIG
    // ========================================

    function parseConfigValue(str) {
        if (str === 'true') return true
        if (str === 'false') return false
        if (/^\d+ms$/.test(str)) return parseInt(str, 10)
        if (/^\d+s$/.test(str)) return parseInt(str, 10) * 1000
        if (/^\d+$/.test(str)) return parseInt(str, 10)
        if (/^\d+\.\d+$/.test(str)) return parseFloat(str)
        return str
    }

    function getSSEConfig(element) {
        const defaults = {
            reconnect: false,
            reconnectDelay: 500,
            reconnectMaxDelay: 60000,
            reconnectMaxAttempts: Infinity,
            reconnectJitter: 0.3,
        }
        const global = htmx.config.sse || {}

        // Parse sse.* keys from hx-config attribute
        let perElement = {}
        const configAttr = element.getAttribute('hx-config')
        if (configAttr) {
            const parts = configAttr.split(/[\s,]+/).filter(Boolean)
            for (const part of parts) {
                const match = part.match(/^sse\.(\w+):(.+)$/)
                if (match) {
                    perElement[match[1]] = parseConfigValue(match[2])
                }
            }
        }

        return {...defaults, ...global, ...perElement}
    }

    // ========================================
    // STREAMING HANDLER
    // ========================================

    async function handleSSEResponse(detail, api) {
        const element = detail.element
        const config = getSSEConfig(element)
        let lastEventId = null
        let attempt = 0
        let reader = null
        let reconnectDelay = config.reconnectDelay

        // Resolve swap target and style from element attributes
        const swapAttr = api.attr(element, 'hx-swap') || htmx.config.defaultSwap || 'innerHTML'
        const targetAttr = api.attr(element, 'hx-target')
        const swapTarget = targetAttr ? (document.querySelector(targetAttr) || element) : element

        // Store state on element for cleanup
        const state = {reader: null, abortController: null}
        element._htmx = element._htmx || {}
        element._htmx.sse = state

        htmx.trigger(element, 'htmx:before:sse:stream', {})

        let currentResponse = detail.response.raw

        try {
            while (element.isConnected) {
                if (attempt > 0) {
                    if (!config.reconnect || attempt > config.reconnectMaxAttempts) break

                    let delay = Math.min(
                        reconnectDelay * Math.pow(2, attempt - 1),
                        config.reconnectMaxDelay
                    )
                    if (config.reconnectJitter > 0) {
                        const jitterRange = delay * config.reconnectJitter
                        delay = Math.max(0, delay + (Math.random() * 2 - 1) * jitterRange)
                    }

                    const reconnectDetail = {
                        reconnect: {attempt, delay, lastEventId, cancelled: false}
                    }
                    htmx.trigger(element, 'htmx:before:sse:reconnect', reconnectDetail)
                    if (reconnectDetail.reconnect.cancelled) break

                    await new Promise(r => setTimeout(r, reconnectDetail.reconnect.delay))
                    if (!element.isConnected) break

                    const ac = new AbortController()
                    state.abortController = ac
                    const headers = {...(detail.request.headers || {})}
                    if (lastEventId) headers['Last-Event-ID'] = lastEventId
                    try {
                        currentResponse = await fetch(detail.request.url, {
                            method: detail.request.method || 'GET',
                            headers,
                            signal: ac.signal,
                        })
                    } catch (e) {
                        if (ac.signal.aborted) break
                        htmx.trigger(element, 'htmx:sse:error', {error: e})
                        attempt++
                        continue
                    }

                    if (!currentResponse.ok) {
                        htmx.trigger(element, 'htmx:sse:error', {
                            error: new Error(`SSE reconnect failed with status ${currentResponse.status}`),
                            status: currentResponse.status
                        })
                        attempt++
                        continue
                    }

                    htmx.trigger(element, 'htmx:before:sse:stream', {})
                    attempt = 0
                }

                // Stream messages
                try {
                    reader = currentResponse.body.getReader()
                    state.reader = reader

                    for await (const msg of parseSSE(reader)) {
                        if (!element.isConnected) break

                        const msgDetail = {
                            message: {data: msg.data, event: msg.event, id: msg.id, cancelled: false}
                        }
                        htmx.trigger(element, 'htmx:before:sse:message', msgDetail)
                        if (msgDetail.message.cancelled) continue

                        if (msg.id) lastEventId = msg.id
                        if (msg.retry != null) reconnectDelay = msg.retry

                        if (msg.event) {
                            htmx.trigger(element, msg.event, {data: msg.data, id: msg.id})
                        } else {
                            htmx.swap({
                                element,
                                target: swapTarget,
                                content: msg.data,
                                style: swapAttr,
                            })
                        }

                        htmx.trigger(element, 'htmx:after:sse:message', msgDetail)
                    }
                } catch (e) {
                    if (!state.abortController?.signal?.aborted) {
                        htmx.trigger(element, 'htmx:sse:error', {error: e})
                    }
                }

                reader = null
                state.reader = null
                if (!element.isConnected) break

                htmx.trigger(element, 'htmx:after:sse:stream', {})
                attempt++
            }
        } finally {
            if (element._htmx?.sse) delete element._htmx.sse
            htmx.trigger(element, 'htmx:sse:close', {reason: element.isConnected ? 'ended' : 'removed'})
        }
    }

    // ========================================
    // CLEANUP
    // ========================================

    function cleanupSSE(element) {
        const state = element?._htmx?.sse
        if (!state) return
        state.abortController?.abort()
        state.reader?.cancel?.()
        delete element._htmx.sse
    }

    // ========================================
    // EXTENSION
    // ========================================

    htmx.register('hx-sse', {
        on: {
            'htmx:before:response': (detail, api) => {
                const contentType = detail.response?.raw?.headers?.get('Content-Type')
                if (!contentType?.includes('text/event-stream')) return

                handleSSEResponse(detail, api).catch(e => {
                    htmx.trigger(detail.element, 'htmx:sse:error', {error: e})
                })
                return false
            },

            'htmx:before:cleanup': (detail) => {
                cleanupSSE(detail.element)
            },
        },
    })
})()
