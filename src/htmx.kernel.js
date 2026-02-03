// htmx 4.0 — Minimal kernel + generalized hypermedia controls.

var htmx = (function () {
    'use strict'

    // ═════════════════════════════════════════════════════════════════════════
    // KERNEL — config, state, emit, register, DOM observation
    // ═════════════════════════════════════════════════════════════════════════

    const config = { debug: false }

    const _state = new WeakMap()
    const state = {
        get(el) {
            let s = _state.get(el)
            if (!s) { s = {}; _state.set(el, s) }
            return s
        },
        has(el) { return _state.has(el) },
        delete(el) { _state.delete(el) },
    }

    const features = {}
    const kernel = {}

    function emit(element, eventName, detail = {}) {
        for (const [name, feature] of Object.entries(features)) {
            if (feature.enable === false) continue
            const handler = feature.on?.[eventName]
            if (!handler) continue
            const result = handler(detail)
            if (config.debug) console.log(`[${eventName}] [${name}]`, result === false ? 'CANCEL' : 'ok')
            if (result === false) return false
        }

        const target = element.isConnected !== false ? element : document
        return target.dispatchEvent(new CustomEvent(eventName, {
            detail, bubbles: true, cancelable: true, composed: true,
        }))
    }

    function activate(root) {}
    function deactivate(node) {}

    function observeDOM() {
        new MutationObserver((mutations) => {
            for (const m of mutations) {
                for (const node of m.addedNodes) {
                    if (node.nodeType === 1) kernel.activate(node)
                }
                for (const node of m.removedNodes) {
                    if (node.nodeType === 1) kernel.deactivate(node)
                }
            }
        }).observe(document.body, { childList: true, subtree: true })
    }

    Object.assign(kernel, { emit, activate, deactivate, observeDOM })

    function register(name, feature) {
        features[name] = feature

        for (const dep of feature.requires || []) {
            if (!features[dep]) console.warn(`htmx: feature "${name}" requires "${dep}" which is not registered`)
        }

        if (feature.init) feature.init({ config, state, kernel })

        if (feature.override) {
            for (const [fn, wrapper] of Object.entries(feature.override)) {
                if (!kernel[fn]) {
                    console.warn(`htmx: feature "${name}" overrides unknown function "${fn}"`)
                    continue
                }
                const original = kernel[fn]
                kernel[fn] = (...args) => wrapper(original, ...args)
            }
        }

        const sorted = [], visited = new Set(), visiting = new Set()
        const visit = (n) => {
            if (visited.has(n)) return
            if (visiting.has(n)) { console.error(`htmx: circular dependency: "${n}"`); return }
            visiting.add(n)
            for (const dep of features[n]?.requires || []) { if (features[dep]) visit(dep) }
            visiting.delete(n)
            visited.add(n)
            sorted.push(n)
        }
        for (const n of Object.keys(features)) visit(n)

        const reordered = {}
        for (const n of sorted) reordered[n] = features[n]
        for (const k of Object.keys(features)) delete features[k]
        Object.assign(features, reordered)
    }

    // ═════════════════════════════════════════════════════════════════════════
    // LIFECYCLE — generalized hypermedia controls
    // Attributes: hx-action, hx-method, hx-trigger, hx-target, hx-swap,
    //             hx-ignore
    // ═════════════════════════════════════════════════════════════════════════

    Object.assign(config, {
        prefix: 'hx-',
        defaultSwap: 'innerHTML',
        fetch: window.fetch.bind(window),
    })

    function attr(el, name) {
        return el.getAttribute(config.prefix + name)
    }

    function makeFragment(html) {
        const tpl = document.createElement('template')
        tpl.innerHTML = html
        return tpl.content
    }

    function swap(target, method, content) {
        const fragment = typeof content === 'string' ? kernel.makeFragment(content) : content
        switch (method) {
            case 'innerHTML': target.replaceChildren(fragment); break
            case 'outerHTML': target.replaceWith(fragment); break
            case 'beforebegin': target.before(fragment); break
            case 'afterbegin': target.prepend(fragment); break
            case 'beforeend': target.append(fragment); break
            case 'afterend': target.after(fragment); break
            case 'delete': target.remove(); break
            case 'none': break
            default: target[method] = typeof content === 'string' ? content : fragment.textContent
        }
    }

    function defaultTrigger(el) {
        if (el.tagName === 'FORM') return 'submit'
        if (el.matches('input, select, textarea')) return 'change'
        return 'click'
    }

    async function fetch(el, overrides = {}) {
        const url = overrides.url || kernel.attr(el, 'action')
        if (!url) return

        const isForm = el.tagName === 'FORM'
        const method = (overrides.method || kernel.attr(el, 'method') || (isForm ? 'POST' : 'GET')).toUpperCase()
        const targetSel = overrides.target || kernel.attr(el, 'target')
        const target = targetSel ? document.querySelector(targetSel) : el
        const swapMethod = overrides.swap || kernel.attr(el, 'swap') || config.defaultSwap

        const detail = { element: el, url, method, target, swap: swapMethod, headers: {}, body: null }

        const form = isForm ? el : el.closest('form')
        if (form) detail.body = new FormData(form)

        if (method === 'GET' && detail.body) {
            detail.url += (url.includes('?') ? '&' : '?') + new URLSearchParams(detail.body)
            detail.body = null
        }

        try {
            if (!kernel.emit(el, 'htmx:config', detail)) return
            if (!kernel.emit(el, 'htmx:before', detail)) return

            detail.response = await config.fetch(detail.url, {
                method: detail.method,
                headers: detail.headers,
                body: detail.body,
            })
            detail.text = await detail.response.text()

            if (!kernel.emit(el, 'htmx:after', detail)) return

            kernel.swap(detail.target, detail.swap, detail.text)
            kernel.emit(el, 'htmx:swapped', detail)

        } catch (error) {
            detail.error = error
            kernel.emit(el, 'htmx:error', detail)
        } finally {
            kernel.emit(el, 'htmx:finally', detail)
        }
    }

    Object.assign(kernel, { attr, makeFragment, swap, fetch })

    register('lifecycle', {
        override: {
            activate(original, root) {
                const selector = `[${config.prefix}action]`
                const ignore = `[${config.prefix}ignore]`

                const elements = root.matches?.(selector)
                    ? [root, ...root.querySelectorAll(selector)]
                    : [...root.querySelectorAll(selector)]

                for (const el of elements) {
                    if (el.closest(ignore)) continue
                    if (state.get(el).activated) continue

                    const trigger = kernel.attr(el, 'trigger') || defaultTrigger(el)

                    const handler = (event) => {
                        if (el.tagName === 'FORM' || el.tagName === 'A') event.preventDefault()
                        kernel.fetch(el)
                    }

                    el.addEventListener(trigger, handler)
                    Object.assign(state.get(el), {
                        activated: true,
                        listener: { event: trigger, handler },
                    })
                    kernel.emit(el, 'htmx:process', { element: el })
                }

                original(root)
            },

            deactivate(original, node) {
                if (state.has(node)) {
                    const s = state.get(node)
                    if (s.listener) node.removeEventListener(s.listener.event, s.listener.handler)
                    state.delete(node)
                }
                for (const el of node.querySelectorAll?.(`[${config.prefix}action]`) || []) {
                    kernel.deactivate(el)
                }
                original(node)
            },
        },
    })

    // ═════════════════════════════════════════════════════════════════════════
    // BOOT
    // ═════════════════════════════════════════════════════════════════════════

    function init() {
        kernel.emit(document.body, 'htmx:init')
        kernel.activate(document.body)
        kernel.observeDOM()
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init)
    } else {
        queueMicrotask(init)
    }

    // ═════════════════════════════════════════════════════════════════════════
    // PUBLIC API — Proxy delegates to kernel, so features that add kernel
    // functions automatically extend the public API.
    // ═════════════════════════════════════════════════════════════════════════

    const api = {
        version: '4.0.0-alpha',
        config, state, features,
        init, register,
    }

    return new Proxy(api, {
        get(target, prop) {
            if (prop in target) return target[prop]
            if (prop in kernel) return kernel[prop]
        },
        has(target, prop) {
            return prop in target || prop in kernel
        },
    })
})()
