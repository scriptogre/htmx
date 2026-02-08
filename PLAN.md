# Config Restructure Plan

## New Structure

```js
htmx = {
    // ═══════════════════════════════════════════════════════════════
    // CONFIG: all values (static or functions)
    // ═══════════════════════════════════════════════════════════════
    config: {
        // Trigger
        triggerEvent: 'click',  // or (node) => 'click'

        // Swap
        swapMethod: 'innerHTML',
        swapTarget: 'this',

        // Request
        requestTimeout: 60000,
        requestCredentials: 'same-origin',
        requestMode: 'same-origin',
        requestHeaders: {
            'HX-Request': 'true',
            'HX-Current-URL': () => location.href,
        },

        // Syntax
        syntaxPrefix: 'hx-',
        syntaxDelimiter: ':',

        // Init
        selectors: [],
    },

    // ═══════════════════════════════════════════════════════════════
    // REGISTRY: all implementations (always functions)
    // ═══════════════════════════════════════════════════════════════
    registry: {
        triggers: {
            // (element, eventName, modifiers, handler) => cleanup?
        },
        swaps: {
            // (target, content) => void
        },
        modifiers: {
            trigger: {
                // (handler, value, element) => handler
            },
            swap: {
                // (options, value, element) => options
            },
        },
    },
}
```

## Helper: resolve()

```js
// Resolves a config value - handles both static and function
function resolve(value, context) {
    return typeof value === 'function' ? value(context) : value
}
```

## Changes Required

### 1. Config object restructure

**Before:**
```js
const config = {
    trigger: { event: fn, delay: 0, throttle: 0, registry: {}, modifiers: {} },
    request: { timeout: 60000, credentials: '...', mode: '...', headers: {} },
    swap: { method: '...', target: '...', settle: 20, transition: false, registry: {} },
    syntax: { prefix: '...', delimiter: '...' },
}
```

**After:**
```js
const config = {
    triggerEvent: (node) => {
        if (node.matches('form')) return 'submit'
        if (node.matches('input:not([type=button]), select, textarea')) return 'change'
        return 'click'
    },
    swapMethod: 'innerHTML',
    swapTarget: 'this',
    requestTimeout: 60000,
    requestCredentials: 'same-origin',
    requestMode: 'same-origin',
    requestHeaders: {
        'HX-Request': 'true',
        'HX-Current-URL': () => location.href,
    },
    syntaxPrefix: 'hx-',
    syntaxDelimiter: ':',
    selectors: [],
}

const registry = {
    triggers: {},
    swaps: {},
    modifiers: {
        trigger: {},
        swap: {},
    },
}
```

### 2. Update setupTriggers()

**Before:**
```js
const defaultEvent = config.trigger.event(node)
// ...
for (const [name, fn] of Object.entries(config.trigger.modifiers)) { ... }
// ...
const synthetic = config.trigger.registry[eventName]
```

**After:**
```js
const defaultEvent = resolve(config.triggerEvent, node)
// ...
for (const [name, fn] of Object.entries(registry.modifiers.trigger)) { ... }
// ...
const synthetic = registry.triggers[eventName]
```

### 3. Update fetch()

**Before:**
```js
credentials: config.request.credentials,
mode: config.request.mode,
// headers built from config.request.headers
```

**After:**
```js
credentials: resolve(config.requestCredentials, context),
mode: resolve(config.requestMode, context),
// headers built from config.requestHeaders
```

### 4. Update swap()

**Before:**
```js
const fn = config.swap.registry[method]
```

**After:**
```js
const fn = registry.swaps[method]
```

### 5. Update attr()

**Before:**
```js
const {prefix, delimiter} = config.syntax
```

**After:**
```js
const prefix = config.syntaxPrefix
const delimiter = config.syntaxDelimiter
```

### 6. Update init()

**Before:**
```js
const selector = config.selectors?.init?.join(',')
```

**After:**
```js
const selector = config.selectors?.join(',')
```

## Extension Examples

### Example 1: Adding a trigger (load)

```js
htmx.register('load-trigger', {
    on: {
        'htmx:ready': () => {
            htmx.registry.triggers.load = (element, eventName, modifiers, handler) => {
                queueMicrotask(() => handler(new Event('load')))
                // no cleanup needed
            }
        }
    }
})
```

### Example 2: Adding a swap method (morph)

```js
htmx.register('morph', {
    on: {
        'htmx:ready': () => {
            htmx.registry.swaps.morph = (target, content) => {
                morphdom(target, content)
            }
        }
    }
})
```

### Example 3: Adding a trigger modifier (delay)

```js
htmx.register('delay-modifier', {
    on: {
        'htmx:ready': () => {
            htmx.registry.modifiers.trigger.delay = (handler, value, element) => {
                let timeout
                return (event) => {
                    clearTimeout(timeout)
                    timeout = setTimeout(() => handler(event), value)
                }
            }
        }
    }
})
```

### Example 4: Changing a default

```js
// Static value
htmx.config.swapMethod = 'outerHTML'

// Dynamic value
htmx.config.swapMethod = (element) =>
    element.matches('.modal') ? 'outerHTML' : 'innerHTML'
```

### Example 5: Adding a header

```js
htmx.config.requestHeaders['X-CSRF-Token'] = () =>
    document.querySelector('meta[name="csrf-token"]').content
```

### Example 6: Adding selectors

```js
htmx.config.selectors.push('[hx-sse]', '[hx-ws]')
```

### Example 7: Extension with its own config namespace

```js
htmx.register('sse', {
    on: {
        'htmx:ready': () => {
            // Extension adds its own config namespace
            htmx.config.sse = {
                reconnect: true,
                reconnectDelay: 1000,
            }
        }
    }
})
```

## Public API

```js
return {
    version: '4.0.0-kernel',

    // Config & Registry
    config,
    registry,

    // Core
    register,
    init,
    fetch,

    // Events
    emit,
    on,

    // Elements
    wrap,
    attr,
    state,

    // Utilities
    resolve,  // expose so extensions can use it
    parse,
    resolveTarget,
    makeFragment,
}
```

## Migration Checklist

- [x] Create `resolve()` helper
- [x] Restructure `config` object (flat, clear names)
- [x] Create separate `registry` object
- [x] Update `setupTriggers()` to use new paths
- [x] Update `parseTrigger()` - no changes needed
- [x] Update `fetch()` to use new paths + resolve()
- [x] Update `swap()` to use new paths
- [x] Update `attr()` to use new paths
- [x] Update `init()` to use new paths
- [x] Update `resolveHeaders()` to handle both static and function values
- [x] Export `registry` in public API
- [x] Export `resolve()` in public API
- [ ] Test with basic HTML page
