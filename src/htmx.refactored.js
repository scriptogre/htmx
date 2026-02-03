// htmx 4.0 — Kernel only
// Request → Response → Swap lifecycle. Nothing else.

var htmx = (function () {
    'use strict'

    // ─── CONFIG ──────────────────────────────────────────────────────────────

    const config = {
        syntax: {
            prefix: 'hx-',
            delimiter: ':',
        },
        request: {
            credentials: 'same-origin',
            headers: {'HX-Request': 'true'},
        },
        swap: {
            method: 'innerHTML',
            target: 'this',
        },
        trigger: {
            event: 'click',
        },
        inheritance: {
            enable: true,
            mode: 'implicit',
            marker: 'inherited',
        },
        fetch: window.fetch.bind(window),
        debug: false,
    }

    // ─── STATE ───────────────────────────────────────────────────────────────

    const _state = new WeakMap()

    const state = {
        get(el) {
            let s = _state.get(el)
            if (!s) {
                s = {listeners: [], controller: null}
                _state.set(el, s)
            }
            return s
        },
        delete(el) {
            _state.delete(el)
        },
    }

    // ─── FEATURES ────────────────────────────────────────────────────────────

    const features = {}

    // ─── KERNEL ──────────────────────────────────────────────────────────────
    // All kernel functions live here. Features can override any of them.
    // ALL internal code calls kernel.* — never bare function names.

    const kernel = {}

    // ─── FUNCTION DEFINITIONS ────────────────────────────────────────────────

    function fetch(url, options = {}) {
        const triggerElement = kernel.wrap(options.trigger?.element || document.body)

        const detail = {
            trigger: {element: triggerElement, event: options.trigger?.event ?? null},
            request: {
                url,
                method: options.method || 'GET',
                headers: {...config.request.headers, ...options.headers},
                body: options.body ?? null,
                credentials: options.credentials || config.request.credentials,
            },
            response: null,
            swap: {...config.swap, ...options.swap},
            error: null,
        }

        return (async () => {
            try {
                if (!kernel.emit(triggerElement, 'htmx:request', detail)) return

                const {url: requestUrl, ...fetchOptions} = detail.request
                const response = await config.fetch(requestUrl, fetchOptions)

                detail.response = {
                    status: response.status,
                    url: response.url,
                    headers: Object.fromEntries(response.headers),
                    text: await response.text(),
                }

                if (!kernel.emit(triggerElement, 'htmx:response', detail)) return

                const target = kernel.resolveTarget(triggerElement.native, detail.swap.target)
                if (!target) {
                    console.warn('htmx: target not found:', detail.swap.target)
                    return
                }

                detail.swap.target = target
                detail.swap.fragment = kernel.makeFragment(detail.response.text)
                detail.swap.perform = () => kernel.performSwap(detail.swap.target, detail.swap.method, detail.swap.fragment)

                if (!kernel.emit(triggerElement, 'htmx:swap', detail)) return

                const inserted = detail.swap.perform()
                for (const el of inserted) kernel.activate(el)

                return detail.response

            } catch (error) {
                detail.error = error
                if (error.name !== 'AbortError') console.error('htmx:', error)
            } finally {
                kernel.emit(triggerElement, 'htmx:done', detail)
            }
        })()
    }

    function performSwap(target, method, fragment) {
        const newNodes = [...fragment.children]

        const cleanup = (root) => {
            for (const el of root.querySelectorAll('[data-hx-activated]')) kernel.deactivate(el)
            if (root.hasAttribute?.('data-hx-activated')) kernel.deactivate(root)
        }

        switch (method) {
            case 'innerHTML':
                cleanup(target)
                target.replaceChildren(fragment)
                break
            case 'outerHTML':
                cleanup(target)
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
                cleanup(target)
                target.remove()
                return []
            case 'none':
                return []
            default:
                cleanup(target)
                target.replaceChildren(fragment)
        }

        return newNodes
    }

    function swap(content, options = {}) {
        const target = kernel.resolveTarget(document.body, options.target || config.swap.target)
        if (!target) {
            console.warn('htmx: swap target not found:', options.target)
            return []
        }

        const fragment = typeof content === 'string' ? kernel.makeFragment(content) : content
        const method = options.method || config.swap.method

        const detail = {
            trigger: options.trigger || null,
            request: options.request || null,
            response: options.response || null,
            swap: {
                method,
                target,
                fragment,
                perform: () => kernel.performSwap(target, method, fragment),
            },
        }

        if (!kernel.emit(target, 'htmx:swap', detail)) return []

        const inserted = detail.swap.perform()
        for (const el of inserted) kernel.activate(el)

        return inserted
    }

    function activate(root) {
        const methods = ['get', 'post', 'put', 'patch', 'delete']
        const selector = methods.map(m => `[${kernel.attrName('hx-' + m)}]`).join(',')

        const elements = root.matches?.(selector)
            ? [root, ...root.querySelectorAll(selector)]
            : root.querySelectorAll(selector)

        for (const element of elements) {
            if (element.hasAttribute('data-hx-activated')) continue
            element.toggleAttribute('data-hx-activated', true)

            const raw = kernel.attr(element, 'hx-trigger')
            const eventName = raw ? raw.trim().split(/[\s,]/)[0] : config.trigger.event

            const handler = (event) => {
                event.preventDefault()

                let method, url
                for (const m of methods) {
                    url = kernel.attr(element, 'hx-' + m, {inherit: false})
                    if (url) {
                        method = m.toUpperCase()
                        break
                    }
                }

                if (!url) return

                kernel.fetch(url, {
                    method,
                    trigger: {element, event},
                    swap: {
                        method: kernel.attr(element, 'hx-swap')?.split(/\s/)[0] || config.swap.method,
                        target: kernel.attr(element, 'hx-target') || config.swap.target,
                    },
                })
            }

            element.addEventListener(eventName, handler)
            state.get(element).listeners.push({event: eventName, handler})
            kernel.emit(element, 'htmx:activate', {element})
        }
    }

    function deactivate(element) {
        if (!element.hasAttribute('data-hx-activated')) return

        const elementState = state.get(element)
        for (const {event, handler} of elementState.listeners) element.removeEventListener(event, handler)
        if (elementState.controller) elementState.controller.abort()

        element.removeAttribute('data-hx-activated')
        state.delete(element)
        kernel.emit(element, 'htmx:deactivate', {element})
    }

    const WRAPPED = Symbol('htmx.wrapped')

    function wrap(element) {
        if (element[WRAPPED]) return element

        return new Proxy(element, {
            get(target, prop) {
                if (prop === WRAPPED) return true
                if (prop === 'native') return target
                if (prop === 'attr') return (name) => kernel.attr(target, name)
                if (prop === 'find') return (selector) => kernel.find(target, selector)
                if (prop === 'findAll') return (selector) => kernel.findAll(target, selector)
                if (prop === 'emit') return (eventName, detail) => kernel.emit(target, eventName, detail)
                if (prop === 'trigger') return (eventName, detail) => kernel.emit(target, eventName, detail)

                const value = target[prop]
                return typeof value === 'function' ? value.bind(target) : value
            }
        })
    }

    function emit(element, eventName, detail = {}) {
        if (detail.trigger?.element) {
            detail = {
                ...detail,
                trigger: {...detail.trigger, element: kernel.wrap(detail.trigger.element)}
            }
        }

        for (const [name, feature] of Object.entries(features)) {
            if (feature.enable === false) continue
            const handler = feature.on?.[eventName]
            if (!handler) continue
            const result = handler({...detail, feature})
            if (config.debug) console.log(`[${eventName}] [${name}]`, result === false ? 'CANCEL' : 'ok')
            if (result === false) return false
        }

        const target = element.isConnected !== false ? element : document
        return target.dispatchEvent(new CustomEvent(eventName, {
            detail,
            bubbles: true,
            cancelable: true,
            composed: true,
        }))
    }

    function attrName(canonical) {
        const {prefix, delimiter} = config.syntax
        return canonical
            .replace(/^hx-/, prefix)
            .replace(/:/g, delimiter)
    }

    function attr(element, canonicalName, {inherit = true} = {}) {
        const {enable, mode, marker} = config.inheritance
        const name = kernel.attrName(canonicalName)

        const direct = element.getAttribute(name)
        if (direct !== null) return direct

        if (!enable || !inherit) return null

        if (mode === 'explicit') {
            const markerAttr = kernel.attrName(`${canonicalName}:${marker}`)
            if (!element.hasAttribute(markerAttr)) return null
        }

        let current = element.parentElement
        while (current) {
            const value = current.getAttribute(name)
            if (value !== null) return value
            current = current.parentElement
        }
        return null
    }

    function makeFragment(html) {
        const tpl = document.createElement('template')
        tpl.innerHTML = html
        return tpl.content
    }

    function find(root, selector) {
        if (typeof root === 'string') {
            selector = root;
            root = document
        }
        const el = root.querySelector(selector)
        return el ? kernel.wrap(el) : null
    }

    function findAll(root, selector) {
        if (typeof root === 'string') {
            selector = root;
            root = document
        }
        return [...root.querySelectorAll(selector)].map(kernel.wrap)
    }

    function resolveTarget(el, selector) {
        if (!selector || selector === 'this') return el
        if (selector === 'body') return document.body
        if (selector.startsWith('closest ')) return el.closest(selector.slice(8))
        if (selector.startsWith('find ')) return el.querySelector(selector.slice(5))
        return document.querySelector(selector)
    }

    function observeDOM() {
        new MutationObserver((mutations) => {
            for (const m of mutations) {
                for (const node of m.addedNodes) {
                    if (node.nodeType === 1) kernel.activate(node)
                }
                for (const node of m.removedNodes) {
                    if (node.nodeType === 1) {
                        if (node.hasAttribute('data-hx-activated')) kernel.deactivate(node)
                        for (const el of node.querySelectorAll('[data-hx-activated]')) kernel.deactivate(el)
                    }
                }
            }
        }).observe(document.body, {childList: true, subtree: true})
    }

    // ─── POPULATE KERNEL ─────────────────────────────────────────────────────

    Object.assign(kernel, {
        fetch, swap, performSwap,
        activate, deactivate,
        wrap, emit,
        attr, attrName, makeFragment,
        find, findAll, resolveTarget,
        observeDOM,
    })

    // ─── REGISTER ────────────────────────────────────────────────────────────

    function register(name, feature) {
        features[name] = feature

        for (const dep of feature.requires || []) {
            if (!features[dep]) console.warn(`htmx: feature "${name}" requires "${dep}" which is not registered`)
        }

        if (feature.override) {
            for (const [fn, wrapper] of Object.entries(feature.override)) {
                if (!kernel[fn]) {
                    console.warn(`htmx: feature "${name}" overrides unknown function "${fn}"`);
                    continue
                }
                const original = kernel[fn]
                kernel[fn] = (...args) => wrapper(original, ...args)
            }
        }

        // Topological sort by requires
        const sorted = []
        const visited = new Set()
        const visiting = new Set()

        const visit = (n) => {
            if (visited.has(n)) return
            if (visiting.has(n)) {
                console.error(`htmx: circular dependency involving "${n}"`);
                return
            }
            visiting.add(n)
            for (const dep of features[n]?.requires || []) {
                if (features[dep]) visit(dep)
            }
            visiting.delete(n)
            visited.add(n)
            sorted.push(n)
        }

        for (const n of Object.keys(features)) visit(n)

        const reordered = {}
        for (const n of sorted) reordered[n] = features[n]
        for (const k of Object.keys(features)) delete features[k]
        for (const [k, v] of Object.entries(reordered)) features[k] = v
    }

    // ─── BOOT ────────────────────────────────────────────────────────────────

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

    // ─── PUBLIC API ──────────────────────────────────────────────────────────

    return {
        version: '4.0.0-kernel',
        config,
        state,
        features,
        get fetch() {
            return kernel.fetch
        },
        get swap() {
            return kernel.swap
        },
        get activate() {
            return kernel.activate
        },
        get deactivate() {
            return kernel.deactivate
        },
        get find() {
            return kernel.find
        },
        get findAll() {
            return kernel.findAll
        },
        get wrap() {
            return kernel.wrap
        },
        get emit() {
            return kernel.emit
        },
        get trigger() {
            return kernel.emit
        },
        get attr() {
            return kernel.attr
        },
        get attrName() {
            return kernel.attrName
        },
        init,
        register,
    }
})()
