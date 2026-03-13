/**
 * Alpha-compatibility API — matches the htmx 4.0-alpha public API surface.
 * Include this script after htmx.kernel.js + htmx.core.js to provide
 * backward compatibility for alpha consumers migrating to beta.
 *
 * This file is NOT required for production beta builds.
 */
htmx.register('alpha-api', {
    on: {
        'htmx:boot': (detail, api) => {
            htmx.process = htmx.init

            htmx.trigger = (elementOrSelector, eventName, detail, bubbles) => {
                let element = elementOrSelector
                if (typeof element === 'string') {
                    element = document.querySelector(element)
                    if (!element) return true
                }
                if (bubbles === false) {
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

            htmx.findAll = (selectorOrRoot, selector) => {
                if (selector === undefined) {
                    return [...document.querySelectorAll(selectorOrRoot)]
                }
                const root = typeof selectorOrRoot === 'string'
                    ? document.querySelector(selectorOrRoot) : selectorOrRoot
                return root ? [...root.querySelectorAll(selector)] : []
            }

            const _kernelFind = htmx.find
            Object.defineProperty(htmx, 'find', {
                value: (selectorOrRoot, selector) => {
                    if (selector === undefined) return _kernelFind(selectorOrRoot)
                    const root = typeof selectorOrRoot === 'string'
                        ? document.querySelector(selectorOrRoot) : selectorOrRoot
                    return root?.querySelector(selector) ?? null
                },
                configurable: true, writable: true,
            })

            htmx.forEvent = (event, timeout = 200, target = document) => {
                return new Promise((resolve) => {
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

            htmx.timeout = (ms) => {
                if (typeof ms === 'string') ms = htmx.parseInterval(ms)
                if (!ms || ms <= 0) return undefined
                return new Promise(r => setTimeout(r, ms))
            }

            htmx.parseInterval = (str) => {
                if (typeof str === 'number') return str
                if (!str) return undefined
                const m = str.match(/^(\d+\.?\d*)(ms|s|m)?$/)
                if (!m) return undefined
                const [, n, unit] = m
                return unit === 's' ? n * 1000 : unit === 'm' ? n * 60000 : +n
            }

            htmx.onLoad = (callback) => {
                document.addEventListener('htmx:after:walk:init', (evt) => callback(evt.detail.element))
            }

            htmx.takeClass = (el, className, container = el.parentElement) => {
                for (const elt of container.querySelectorAll('.' + className)) elt.classList.remove(className)
                el.classList.add(className)
            }

            htmx.defineExtension = (name, ext) => htmx.register(name, ext)

            htmx.resolveTarget = (elt, selector) => {
                if (selector instanceof Element) return selector
                if (!selector) return elt
                return api.find(selector, {from: elt}) ?? elt
            }

            htmx.findAllExt = (eltOrSelector, maybeSelector) => {
                let selector = maybeSelector ?? eltOrSelector
                let elt = maybeSelector
                    ? (typeof eltOrSelector === 'string' ? document.querySelector(eltOrSelector) : eltOrSelector)
                    : document
                if (typeof selector !== 'string') return []
                let parts = selector.replace(/<[^>]+\/>/g, m => m.replace(/,/g, '\x00'))
                    .split(',').map(p => p.replace(/\x00/g, ','))
                let result = []
                for (let part of parts) {
                    part = part.trim()
                    if (part.startsWith('<') && part.endsWith('/>')) part = part.slice(1, -2)
                    if (part === 'root') { result.push(document) }
                    else if (part === 'nextElementSibling') { if (elt?.nextElementSibling) result.push(elt.nextElementSibling) }
                    else if (part === 'previousElementSibling') { if (elt?.previousElementSibling) result.push(elt.previousElementSibling) }
                    else {
                        let found = api.find(part, {from: elt, multiple: true})
                        if (Array.isArray(found)) result.push(...found)
                        else if (found) result.push(found)
                    }
                }
                return [...new Set(result)]
            }

            htmx.parse = (text, options) => api.parse(text, options)
            htmx.makeFragment = (html) => api.makeFragment(html)

            htmx.normalizeSwapStyle = (style) => {
                const map = {before: 'beforebegin', after: 'afterend', prepend: 'afterbegin', append: 'beforeend'}
                return map[style] || style
            }

            htmx.parseSwap = (str) => {
                if (!str) return {style: htmx.config.defaultSwap}
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
                let styleToken, startIdx
                if (tokens[0].includes(':')) { styleToken = htmx.config.defaultSwap; startIdx = 0 }
                else { styleToken = tokens[0]; startIdx = 1 }
                const result = {style: map[styleToken] || styleToken}
                for (let i = startIdx; i < tokens.length; i++) {
                    const colonIdx = tokens[i].indexOf(':')
                    if (colonIdx === -1) continue
                    const key = tokens[i].slice(0, colonIdx)
                    let value = tokens[i].slice(colonIdx + 1)
                    if (value === 'true') value = true
                    else if (value === 'false') value = false
                    result[key] = value
                }
                return result
            }
            htmx.__parseSwap = htmx.parseSwap

            htmx.parseTriggerSpecs = (str) => {
                if (!str || !str.trim()) return []
                const specs = []
                const parts = []
                let current = '', depth = 0
                for (const ch of str) {
                    if (ch === '[') depth++; else if (ch === ']') depth--
                    if (ch === ',' && depth === 0) { parts.push(current.trim()); current = '' }
                    else current += ch
                }
                if (current.trim()) parts.push(current.trim())
                for (const part of parts) {
                    if (!part) continue
                    const tokens = []
                    let token = '', bd = 0
                    for (const ch of part) {
                        if (ch === '[') bd++; else if (ch === ']') bd--
                        if (/\s/.test(ch) && bd === 0) { if (token) tokens.push(token); token = '' }
                        else token += ch
                    }
                    if (token) tokens.push(token)
                    if (!tokens.length) continue
                    const full = tokens.join(' ')
                    if ((full.match(/\[/g) || []).length !== (full.match(/\]/g) || []).length)
                        throw new Error('Unterminated filter in trigger spec: ' + part)
                    const spec = {name: tokens[0]}
                    for (let i = 1; i < tokens.length; i++) {
                        const t = tokens[i]
                        if (t.includes(':')) { const [key, ...rest] = t.split(':'); spec[key] = rest.join(':') }
                        else spec[t] = true
                    }
                    specs.push(spec)
                }
                return specs
            }

            htmx.extractFilter = (str) => {
                if (!str) return [str, null]
                const openIdx = str.indexOf('[')
                if (openIdx === -1) return [str, null]
                const closeIdx = str.indexOf(']', openIdx)
                if (closeIdx === -1) return [str, null]
                return [str.slice(0, openIdx), str.slice(openIdx + 1, closeIdx)]
            }

            htmx.selectAll = (elt, selector) => {
                const results = []
                if (elt.matches && elt.matches(selector)) results.push(elt)
                results.push(...elt.querySelectorAll(selector))
                return results
            }
        }
    }
})
