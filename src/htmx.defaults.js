// htmx 4.0 — Default extensions
//
// These are conventions and conveniences that ship with htmx but live outside the core.
// The core is minimal; these defaults make htmx feel like htmx.

// ── Attribute inheritance ─────────────────────────────────────────────────
// Core attr is pure getAttribute. This adds parent-walking inheritance.

htmx.register('inheritance', {
    on: {
        'htmx:boot': (detail, api) => {
            const original = api.attr
            api.attr = (element, name, opts = {}) => {
                const {inherit = true} = opts
                let current = element
                while (current) {
                    const value = original(current, name)
                    if (value !== null) return value
                    if (!inherit) return null
                    current = current.parentElement
                }
                return null
            }
        }
    }
})

// ── Extended selectors ───────────────────────────────────────────────────
// Core find defaults to document.querySelector. This adds keyword selectors.

htmx.register('extended-selectors', {
    on: {
        'htmx:boot': (detail, api) => {
            const originalFind = api.find
            api.find = (element, selector) => {
                if (selector === undefined) {
                    selector = element;
                    element = document
                }
                if (selector === 'this') return element
                if (selector === 'body') return document.body
                if (selector.startsWith('closest ')) return element.closest(selector.slice(8))
                if (selector.startsWith('find ')) return element.querySelector(selector.slice(5))
                return originalFind(element, selector)
            }
            const originalFindAll = api.findAll
            api.findAll = (element, selector) => {
                if (selector === undefined) {
                    selector = element;
                    element = document
                }
                if (selector.startsWith('find ')) return [...element.querySelectorAll(selector.slice(5))]
                return originalFindAll(element, selector)
            }
        }
    }
})

// ═══════════════════════════════════════════════════════════════════════════
// SMART DEFAULTS
// Conventions that make htmx feel like htmx. Core requires all attributes
// to be explicit; these make them optional with sensible fallbacks.
// ═══════════════════════════════════════════════════════════════════════════

// ── Default swap ────────────────────────────────────────────────────────
// Use innerHTML when hx-swap is omitted.

htmx.register('default-swap', {
    on: {
        'htmx:boot': () => {
            htmx.config.defaultSwap ??= 'innerHTML'
        },
        'htmx:before:swap': (detail) => {
            detail.method ??= htmx.config.defaultSwap
        }
    }
})

// ── Default headers ─────────────────────────────────────────────────────
// Tell the server this is an htmx request.

htmx.register('default-headers', {
    on: {
        'htmx:boot': () => {
            htmx.config.defaultHeaders ??= {
                'HX-Request': 'true'
            }
        },
        'htmx:before:request': ({request}) => {
            request.headers = {...htmx.config.defaultHeaders, ...request.headers}
            request.headers['HX-Current-URL'] ??= location.href
        }
    }
})

// ── Default trigger ─────────────────────────────────────────────────────
// Click for most elements, change for inputs, submit for forms.

htmx.register('default-trigger', {
    on: {
        'htmx:setup:trigger': ({element, trigger}) => {
            if (trigger.event) return
            if (element.matches('form')) trigger.event = 'submit'
            else if (element.matches('input:not([type=button]), select, textarea')) trigger.event = 'change'
            else trigger.event = 'click'
        }
    }
})

// ── Swap methods ─────────────────────────────────────────────────────────
// Resolves swap.fn from swap.method during htmx:before:swap.

htmx.register('swap-methods', {
    on: {
        'htmx:before:swap': (detail) => {
            if (detail.fn) return
            const methods = {
                innerHTML: (target, content) => { target.innerHTML = ''; target.append(content) },
                outerHTML: (target, content) => { const parent = target.parentNode; target.replaceWith(content); return parent },
                before: (target, content) => target.before(content),
                prepend: (target, content) => target.prepend(content),
                append: (target, content) => target.append(content),
                after: (target, content) => target.after(content),
                remove: (target) => target.remove(),
                none: () => {},
                // Aliases (insertAdjacentHTML position names)
                beforebegin: (target, content) => target.before(content),
                afterbegin: (target, content) => target.prepend(content),
                beforeend: (target, content) => target.append(content),
                afterend: (target, content) => target.after(content),
                delete: (target) => target.remove(),
            }
            detail.fn = methods[detail.method]
        }
    }
})

// ── Request timeout ──────────────────────────────────────────────────────
// Default 60s timeout. Sets signal on the RequestInit via htmx:before:request.

htmx.register('request-timeout', {
    on: {
        'htmx:boot': () => {
            htmx.config.requestTimeout ??= 60000
        },
        'htmx:before:request': ({request}) => {
            const timeout = htmx.config.requestTimeout
            if (!timeout) return

            const timeoutSignal = AbortSignal.timeout(timeout)
            // Combine with any existing signal so both can cancel
            request.signal = request.signal
                ? AbortSignal.any([request.signal, timeoutSignal])
                : timeoutSignal
        }
    }
})

// ── Trigger: load ───────────────────────────────────────────────────────
// Fires immediately when the element is initialized.

htmx.register('trigger-load', {
    on: {
        'htmx:setup:trigger': ({element, trigger}, {emit}) => {
            if (trigger.event !== 'load') return
            trigger.event = 'htmx:trigger:load'
            queueMicrotask(() => emit(element, trigger.event))
        }
    }
})

// ── Trigger: every ──────────────────────────────────────────────────────
// Fires on a repeating interval. Usage: hx-trigger="every interval:3s"

htmx.register('trigger-every', {
    on: {
        'htmx:setup:trigger': ({element, trigger, cleanup}, {emit}) => {
            if (trigger.event !== 'every') return
            trigger.event = 'htmx:trigger:every'
            const id = setInterval(() => emit(element, trigger.event), trigger.interval)
            cleanup.push(() => clearInterval(id))
        }
    }
})

// ── Trigger modifier: delay (debounce) ──────────────────────────────────

htmx.register('modifier-delay', {
    on: {
        'htmx:setup:trigger': (detail) => {
            if (detail.trigger.delay === undefined) return
            const value = detail.trigger.delay
            const original = detail.handler
            let timeout
            detail.handler = (event) => {
                clearTimeout(timeout)
                timeout = setTimeout(() => original(event), value)
            }
        }
    }
})

// ── Trigger modifier: throttle ──────────────────────────────────────────

htmx.register('modifier-throttle', {
    on: {
        'htmx:setup:trigger': (detail) => {
            if (detail.trigger.throttle === undefined) return
            const value = detail.trigger.throttle
            const original = detail.handler
            let last = 0
            detail.handler = (event) => {
                const now = Date.now()
                if (now - last >= value) {
                    last = now
                    original(event)
                }
            }
        }
    }
})
