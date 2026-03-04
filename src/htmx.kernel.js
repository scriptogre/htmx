/**
 * htmx 4.0 Kernel
 *
 * Lifecycle runtime for htmx 4.0.
 * Handles discovery, per-element state, lifecycle events, and DOM mutation wiring.
 * Behavior (requests, swaps, triggers, etc.) is extension-defined.
 *
 * Pipeline: `htmx:before:*` -> `detail.*.execute()` -> `htmx:after:*`.
 * `before:*` may mutate detail, replace execute, or cancel.
 *
 * Errors: throw `HtmxError` for programmer/config issues; emit `htmx:error`
 * for runtime failures.
 */

class HtmxError extends Error {
    constructor(message, options) {
        super(message, options)
        this.type = options?.type
    }
}

var htmx = (function () {
    'use strict'

    /** @typedef {{cleanup: function[]}} ElementState */
    /** @typedef {{name: string, requires?: string[], config?: Object<string, any>, on?: Object<string, function>, define?: Object<string, function>, wrap?: Object<string, function>}} Extension */
    /**
     * @typedef {Object} KernelConfig
     * @property {string} attributePrefix Attribute prefix used during discovery.
     * @property {string[]} attributeFilter Attributes observed for re-init.
     * Extension-defined config keys may be added during install/boot.
     */

    // ── Kernel Internals ────────────────────────────────────────────────────
    /** @type {boolean} True after boot runs. */
    let booted = false

    /** @type {WeakMap<Element, ElementState>} Per-element lifecycle state. */
    const elements = new WeakMap()

    /** @type {Object<string, string[]>} api fn -> wrapper extension names. */
    const wraps = {}

    // ── State ────────────────────────────────────────────────────────────────
    /** @type {Object<string, any>} Shared extension namespace. */
    const state = {}

    /** @returns {ElementState|undefined} Kernel state for a managed element. */
    state.elements = function (element) {
        return elements.get(element)
    }

    /** @type {Object<string, string[]>} Read-only wrapped api introspection. */
    state.wraps = wraps
    /** @type {Object<string, string>} Read-only api ownership: api fn -> defining extension. */
    state.defines = {}

    // ── Config ───────────────────────────────────────────────────────────────
    // Kernel owns attributePrefix and attributeFilter. Extensions declare
    // defaults via config: {} (merge: scalars ??=, arrays concat, objects per-key ??=).
    /** @type {KernelConfig} Kernel config surface. */
    const config = {
        /** @type {string} Attribute prefix for element discovery during init walks. */
        attributePrefix: 'hx-',
        /** @type {string[]} Attributes the MutationObserver watches for re-init. Empty = childList only. */
        attributeFilter: [],
    }

    // ── Extensions ───────────────────────────────────────────────────────────

    /** @type {Extension[]} Installed extensions in order. */
    const extensions = []

    /**
     * Install an extension. Extensions run in installation order.
     *
     * @param {string} name - Unique extension name.
     * @param {{requires?: string[], config?: Object<string, any>, on?: Object<string, function>, define?: Object<string, function>, wrap?: Object<string, function>}} extension
     */
    function install(name, extension) {
        if (extensions.some(installed => installed.name === name)) {
            throw new HtmxError(`Extension "${name}" is already installed`, {type: 'EXTENSION_ALREADY_INSTALLED'})
        }
        for (const dependency of extension.requires || []) {
            if (!extensions.some(installed => installed.name === dependency)) {
                throw new HtmxError(`Extension "${name}" requires "${dependency}" to be installed first`, {type: 'EXTENSION_DEPENDENCY_MISSING'})
            }
        }

        // Apply declarative config (merge: scalars ??=, arrays concat, objects per-key ??=).
        if (extension.config) {
            for (const [key, value] of Object.entries(extension.config)) {
                if (!(key in config) || config[key] == null) {
                    config[key] = value
                } else if (Array.isArray(config[key]) && Array.isArray(value)) {
                    config[key].push(...value)
                } else if (typeof config[key] === 'object' && config[key] !== null
                           && typeof value === 'object' && value !== null
                           && !Array.isArray(config[key]) && !Array.isArray(value)) {
                    for (const [k, v] of Object.entries(value)) {
                        config[key][k] ??= v
                    }
                }
            }
        }

        // Apply declarative api definitions first so later wraps can target them.
        // Contract: define values are factories called once at install:
        //   define.foo(api) -> function foo(...)
        if (extension.define) {
            for (const [fnName, factory] of Object.entries(extension.define)) {
                if (typeof factory !== 'function') {
                    throw new HtmxError(`Cannot define "${fnName}" — value must be a factory function`, {type: 'DEFINE_VALUE_INVALID'})
                }
                if (api[fnName]) {
                    throw new HtmxError(`Cannot define "${fnName}" — already defined by "${state.defines[fnName] || 'kernel'}"`, {type: 'DEFINE_TARGET_EXISTS'})
                }
                const fn = factory(api)
                if (typeof fn !== 'function') {
                    throw new HtmxError(`Cannot define "${fnName}" — factory must return a function`, {type: 'DEFINE_FACTORY_INVALID'})
                }
                api[fnName] = fn
                state.defines[fnName] = name
            }
        }

        extensions.push({name, ...extension})
        // Apply declarative wraps and track them
        if (extension.wrap) {
            for (const [fnName, wrapper] of Object.entries(extension.wrap)) {
                if (!api[fnName]) throw new HtmxError(`Cannot wrap "${fnName}" — not found on api`, {type: 'WRAP_TARGET_MISSING'})
                const original = api[fnName]
                api[fnName] = (...args) => wrapper(original, ...args)
                wraps[fnName] ??= []
                wraps[fnName].push(name)
            }
        }
        // Late-installed extensions still get a boot event
        if (booted && extension.on?.['htmx:boot']) {
            extension.on['htmx:boot']({}, api)
        }
    }

    // ── Events ───────────────────────────────────────────────────────────────

    /**
     * Emit an event: extensions see it first, then it dispatches as a DOM CustomEvent.
     * Any extension returning false (or preventDefault) cancels the event.
     *
     * @param {Element} element
     * @param {string} eventName
     * @param {Object} [detail={}]
     *
     * @returns {boolean} false if canceled
     */
    function emit(element, eventName, detail = {}) {
        // Extensions get first crack — can inspect/modify detail or cancel
        for (const extension of extensions) {
            try {
                if (extension.on?.[eventName]?.(detail, api) === false) return false
            } catch (error) {
                console.error(`[htmx] Extension "${extension.name}" threw in ${eventName}:`, error)
            }
        }

        // Fall back to body for disconnected elements (e.g., during cleanup)
        const dispatchTarget = element?.isConnected ? element : document.body

        return dispatchTarget.dispatchEvent(
            new CustomEvent(eventName, {
                detail,
                bubbles: true,
                cancelable: true,
                composed: true,
            }))
    }

    // ── Utilities ────────────────────────────────────────────────────────────

    /** @param {boolean} result - Return value of api.emit(). */
    const canceled = (result) => result === false

    /**
     * Listen for a DOM event. Auto-registers a cleanup callback if the element
     * has state, so listeners are removed when the element is cleaned up.
     *
     * @param {EventTarget} element
     * @param {string} eventName
     * @param {EventListener} handler
     * @param {AddEventListenerOptions} [options]
     *
     * @returns {function} unsubscribe callback
     */
    function on(element, eventName, handler, options) {
        if (!eventName) throw new HtmxError('Cannot add listener without an event name', {type: 'EVENT_NAME_MISSING'})

        element.addEventListener(eventName, handler, options)

        const off = () => element.removeEventListener(eventName, handler, options)

        // Auto-cleanup: if this element is managed, unsubscribe on removal
        if (elements.has(element)) elements.get(element).cleanup.push(off)

        return off
    }

    /**
     * Resolve an element reference. Always searches from document.
     *
     * Supports CSS selectors and direct Element references.
     * Pass {multiple: true} to get an array of matches.
     *
     * @param {string|Element|null} selector - What to resolve.
     * @param {{multiple?: boolean}} [options] - Kernel reads `multiple` only.
     *
     * @returns {Element|Element[]|null} Resolved element(s), or null/[] if not found.
     */
    function find(selector, options) {
        const multiple = options?.multiple
        if (selector instanceof Element) return multiple ? [selector] : selector
        if (!selector) return multiple ? [] : null
        return multiple
            ? [...document.querySelectorAll(selector)]
            : document.querySelector(selector)
    }

    /**
     * Read a raw attribute from an element.
     *
     * @param {Element} element - Element to read from.
     * @param {string} name - Attribute name.
     * @param {Object} [options] - Unused by kernel.
     */
    function attr(element, name, options) {
        return element.getAttribute(name)
    }

    // ── Init & Cleanup ───────────────────────────────────────────────────────

    /**
     * Initialize a subtree — discover hx-* elements and init each one.
     *
     * Default execute walks the subtree with a TreeWalker, calling initElement
     * on any element with an hx-* attribute. Extensions can replace
     * detail.walk.execute during htmx:before:walk:init for custom discovery.
     *
     * @param {Element} [root=document.body] - Subtree root to initialize.
     */
    function init(root = document.body) {
        const detail = {element: root, walk: {execute: null}}

        // Default execute: walk the subtree, initElement anything with hx-*
        detail.walk.execute = () => {
            const walker = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT)
            let node = root
            while (node) {
                const attrs = node.attributes
                for (let i = 0; i < attrs.length; i++) {
                    if (attrs[i].name.startsWith(config.attributePrefix)) {
                        api.initElement(node)
                        break
                    }
                }
                node = walker.nextNode()
            }
        }

        if (canceled(api.emit(root, 'htmx:before:walk:init', detail))) return
        detail.walk.execute()
        api.emit(root, 'htmx:after:walk:init', {element: root})
    }

    /**
     * Initialize a single element: set up state, let extensions configure
     * behavior, then commit.
     *
     * Sequence: before:init → init.execute() → after:init
     *
     * detail.init.execute — what runs at init time.
     *   Default: commit element state. Extensions wrap this during before:init
     *   to add trigger wiring, listener setup, or any other init-time behavior.
     *
     * @param {Element} element
     */
    function initElement(element) {
        if (elements.has(element)) return // already initialized

        const detail = {element, init: {execute: null}}

        detail.init.execute = () => {
            elements.set(element, {cleanup: []})
        }

        if (canceled(api.emit(element, 'htmx:before:init', detail))) return
        detail.init.execute()
        api.emit(element, 'htmx:after:init', detail)
    }

    /**
     * Clean up a subtree — tear down root and all stateful descendants.
     *
     * Default execute walks the subtree, calling cleanupElement on any
     * element with state. Extensions can replace detail.walk.execute
     * during htmx:before:walk:cleanup for custom discovery (e.g., shadow DOM).
     *
     * @param {Element} root - Subtree root to clean up.
     */
    function cleanup(root) {
        const detail = {element: root, walk: {execute: null}}

        // Default execute: cleanupElement on root + all stateful descendants
        detail.walk.execute = () => {
            const walker = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT)
            let node = root
            while (node) {
                if (elements.has(node)) api.cleanupElement(node)
                node = walker.nextNode()
            }
        }

        if (canceled(api.emit(root, 'htmx:before:walk:cleanup', detail))) return
        detail.walk.execute()
        api.emit(root, 'htmx:after:walk:cleanup', {element: root})
    }

    /**
     * Tear down listeners and delete state for a single element.
     *
     * Follows the standard before:* → execute() → after:* pattern.
     * Extensions can replace detail.cleanup.execute during before:cleanup
     * (e.g., to add exit animations before teardown).
     *
     * @param {Element} element - The element to clean up.
     */
    function cleanupElement(element) {
        if (!elements.has(element)) return

        const detail = {element, cleanup: {execute: null}}

        detail.cleanup.execute = () => {
            for (const teardown of elements.get(element).cleanup) teardown()
            elements.delete(element)
        }

        if (canceled(api.emit(element, 'htmx:before:cleanup', detail))) return
        detail.cleanup.execute()
        api.emit(element, 'htmx:after:cleanup', detail)
    }

    // ── API ──────────────────────────────────────────────────────────────────
    // Extensions receive api as the last argument in both event handlers and wraps.
    // Internal code calls through api so extension wraps take effect.

    const api = {
        config,
        install,
        init,
        initElement,
        cleanup,
        cleanupElement,
        emit,
        on,
        attr,
        find,
        state,
    }

    // ── Public API ───────────────────────────────────────────────────────────
    // Constructed before Extensions so inlined boot handlers can reference htmx.
    // Getters delegate to api so extension wraps take effect.

    htmx = {
        version: '4.0.0',
        config,
        install,
        state,
        get init() {
            return api.init
        },
        get emit() {
            return api.emit
        },
        get on() {
            return api.on
        },
        get attr() {
            return api.attr
        },
        get find() {
            return api.find
        },
    }

    // ── Extensions: Start ────────────────────────────────────────────────────
    // ── Extensions: End ──────────────────────────────────────────────────────

    // ── Boot ─────────────────────────────────────────────────────────────────

    /**
     * Emit htmx:boot, init the document body, and observe DOM mutations
     * (added nodes → init, removed nodes → cleanup).
     */
    function boot() {
        booted = true
        api.emit(document.body, 'htmx:boot')
        api.init(document.body)

        new MutationObserver(mutations => {
            for (const mutation of mutations) {
                if (mutation.type === 'attributes') {
                    api.initElement(mutation.target)
                } else {
                    for (const node of mutation.addedNodes) {
                        if (node instanceof Element) api.init(node)
                    }
                    for (const node of mutation.removedNodes) {
                        if (node instanceof Element) api.cleanup(node)
                    }
                }
            }
        }).observe(document.body, {
            childList: true,
            subtree: true,
            attributes: config.attributeFilter?.length > 0,
            attributeFilter: config.attributeFilter?.length > 0 ? config.attributeFilter : undefined,
        })
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', boot)
    } else {
        queueMicrotask(boot)
    }

    return htmx
})()
