# htmx 4.0 Architecture

> ⚠️ **WORK IN PROGRESS** - Everything can change at any point.

---

## Design Goals

1. **Linear flow**: Clear request → response → swap pipeline
2. **Eliminate ctx**: No god object
3. **Declarative config**: Everything configurable via `#defaultConfig`
4. **Unified swap config**: Global defaults, local overrides via `hx-config`
5. **Extensible features**: All behavior in `#defaultFeatures`
6. **HtmxElement**: Wrapper replaces scattered `element._htmx` logic

---

## HtmxElement

Wraps native DOM elements. Provides clean API. Replaces `element._htmx`.

```javascript
const element = createHtmxElement(nativeElement, htmxInstance)

// State (replaces element._htmx)
element.htmx.boosted = true
element.htmx.requesting = true

// Attributes
element.attr('hx-swap', 'outerHTML')  // Set
const swap = element.attr('hx-swap')   // Get (with inheritance)

// Events with auto-cleanup
element.on('click', handler)

// Query
element.find('closest form')
element.findAll('button')

// Native fallthrough
element.classList.add('active')
element.textContent = 'Hello'
```

**Activation**: When `activate()` runs, create HtmxElement. Fire events with HtmxElement, not native element.

```javascript
activate(el) {
  const element = createHtmxElement(el, this)

  const allowed = await this.trigger('htmx:before:element:activate', { element }, el)
  if (!allowed) return

  element.htmx.activated = true

  await this.trigger('htmx:after:element:activate', { element }, el)
}
```

**Events**: Detail includes `{ element }` where `element` is HtmxElement. Access native via `element.native`.

---

## Configuration

### #defaultConfig Structure

Core settings only. Feature-specific config lives in features.

```javascript
#defaultConfig = {
  version: '4.0.0-alpha3',

  debug: {
    enable: false
  },

  // Syntax for attributes
  syntax: {
    prefix: 'hx-',
    delimiter: ':',
    parser: RelaxedJSON  // .parse() and .stringify()
  },

  // Global swap defaults
  swap: {
    method: 'innerHTML',
    target: 'this',

    modifiers: {
      extract: null,
      extractOOB: null,
      delay: 0,
      scroll: null,
      show: null,
      focus: null,
      transition: true,
      async: false
    }
  },

  // Request defaults
  request: {
    timeout: 60000,
    credentials: 'same-origin',
    mode: 'same-origin',
    vals: {},
    headers: {
      'HX-Request': 'true',
      'Accept': 'text/html, text/event-stream',
      'HX-Current-URL': () => location.href,
      'HX-Source': request => request.element.id || request.element.name,
      'HX-Boosted': request => request.element.__htmxElement.htmx.boosted ? 'true' : null
    }
  },

  // State sync to DOM
  state: {
    dom: {
      enable: true,
      attribute: 'data-htmx',
      sync: {
        always: ['active', 'boosted', 'requesting', 'loading', 'error'],
        debug: ['status', 'verb', 'url', 'etag'],
        never: ['eventHandler', 'triggerSpecs', 'listeners', 'interval', 'timeout']
      },
      serializers: {},
      format: {
        htmx: RelaxedJSON
      }
    }
  },

  selectors: {
    activate: '[hx-get], [hx-post], [hx-put], ...',
    ignore: '[hx-ignore], [hx-ignore] *',
    inputs: 'input:not([disabled]), ...'
  },

  security: {
    nonce: null
  }
}
```

### #defaultFeatures Structure

All htmx behavior. Two patterns:

**Simple features** (objects):
```javascript
noSwapOn204: {
  enable: true,
  on: {
    'htmx:after:request': ({ response, swap }) => {
      if (response.status === 204) swap.method = 'none'
    }
  }
}
```

**Complex features** (classes):
```javascript
'hx-on': {
  enable: true,
  feature: class {
    PATTERNS = {
      name: /^hx-on:(.+)$/,
      value: /.*/
    }

    inheritable = false

    on = {
      'htmx:after:element:activate': ({ element }) => {
        for (let attrName of element.getAttributeNames()) {
          const match = attrName.match(this.PATTERNS.name)
          if (!match) continue

          const eventName = match[1]
          const code = element.attr(attrName)

          element.on(eventName, (event) => {
            htmx.__executeJavaScript(element, { event }, code, false)
          })
        }
      }
    }
  }
}
```

**Config-mapping features** (shortcuts):
Many attributes just modify config locally. Create utility for these.

Examples:
- `hx-target` → `config.swap.target`
- `hx-swap` → `config.swap.method` (+ merge modifiers)
- `hx-timeout` → `config.request.timeout`

**History feature**:
```javascript
history: {
  enable: true,
  syntax: '%name%:inherited',  // Moved from syntax.inheritance
  on: { /* history logic */ }
}
```

**Inheritance feature**:
```javascript
inheritance: {
  enable: true,
  syntax: '%name%:inherited',
  on: { /* intercepts getAttribute calls */ }
}
```

---

## Swap Configuration

Global defaults in `config.swap`. Everything depends on this.

**Local overrides**: Use `hx-config` to merge into config locally.

```html
<div hx-config="swap.method: outerHTML, swap.target: #result">
  <!-- This subtree uses modified config -->
</div>
```

**Attribute shortcuts**: Map to config paths.

```html
<div hx-target="#foo">
  <!-- Equivalent to: hx-config="swap.target: #foo" -->
</div>

<div hx-swap="outerHTML">
  <!-- Equivalent to: hx-config="swap.method: outerHTML" -->
</div>

<div hx-swap="innerHTML scroll:top delay:100ms">
  <!-- Maps to:
       config.swap.method = 'innerHTML'
       config.swap.modifiers.scroll = {direction: 'top', ...}
       config.swap.modifiers.delay = 100
  -->
</div>
```

**Implementation**: Utility function creates config-mapping features.

```javascript
function createConfigMappingFeature(attributeName, configPath, options = {}) {
  return {
    enable: true,
    feature: class {
      PATTERNS = {
        name: attributeName,
        value: options.valuePattern || /.*/
      }

      on = {
        'htmx:before:request': ({ element, request }) => {
          const value = element.attr(attributeName)
          if (!value) return

          // Parse and merge into request.config
          // Handle special cases like hx-swap with modifiers
        }
      }
    }
  }
}
```

---

## Events

Events fire on native element. Detail includes HtmxElement.

```javascript
{
  element,    // HtmxElement (access native via element.native)
  request,    // HtmxRequest
  response,   // HtmxResponse
  swap,       // Main Swap
  swaps       // All swaps
}
```

### Key Events

| Event                            | Detail                             |
|----------------------------------|------------------------------------|
| `htmx:before:element:activate`   | `{element}`                        |
| `htmx:after:element:activate`    | `{element}`                        |
| `htmx:before:element:deactivate` | `{element}`                        |
| `htmx:before:request`            | `{element, request}`               |
| `htmx:after:request`             | `{element, request, response}`     |
| `htmx:before:swap`               | `{element, request, response, swap, swaps}` |
| `htmx:after:swap`                | `{element, request, response, swap, swaps}` |
| `htmx:error`                     | `{element, request, response?, error}` |

### hx-on

Inline handlers. Dropped event shortcuts.

```html
<!-- Drop htmx: prefix with :: -->
<button hx-on::before:request="console.log('requesting')">

<!-- Regular events -->
<button hx-on:click="console.log('clicked')">

<!-- NO stop() injection (clashes with window.stop) -->
<!-- Use event.preventDefault() or return false -->
<button hx-on::before:request="return confirm('Sure?')">
```

---

## Feature Registration

`__registerFeatures()` handles both patterns:

```javascript
__registerFeatures() {
  for (let [name, config] of Object.entries(this.config.features)) {
    if (config.enable === false) continue

    // Get feature (config.feature or config itself)
    let feature = config.feature || config

    // Instantiate classes
    if (typeof feature === 'function') {
      feature = new feature()
      if (config.feature) config.feature = feature
    }

    // Register event handlers
    for (let [eventName, handler] of Object.entries(feature.on || {})) {
      document.addEventListener(eventName, evt => {
        handler.call(this, evt.detail || {})
      })
    }
  }
}
```

**Result**: Uniform API. Everything is object after registration.

```javascript
// Disable any feature
htmx.config.features['hx-on'].enable = false
htmx.config.features.noSwapOn204.enable = false

// Override feature
htmx.config.features['hx-on'] = {
  enable: true,
  feature: class { /* custom implementation */ }
}
```

---

## Request/Response/Swap Flow

```javascript
async __handleRequest(element, event) {
  // 1. Create HtmxElement
  element = element.__htmxElement || createHtmxElement(element, this)

  // 2. Build request
  let request = new HtmxRequest({ element, event, ... })

  // 3. Lifecycle
  await this.trigger('htmx:before:request', { element, request })

  let response = await request.execute()

  await this.trigger('htmx:after:request', { element, request, response })

  // 4. Extract swaps
  let swaps = extractSwapsFromResponse(response, this)
  let swap = swaps.find(s => s.type === 'main')

  await this.trigger('htmx:before:swap', { element, request, response, swap, swaps })

  // 5. Execute swaps
  let sequential = swaps.filter(s => !s.modifiers.async)
  let parallel = swaps.filter(s => s.modifiers.async)

  for (let s of sequential) await s.execute(this)
  await Promise.all(parallel.map(s => s.execute(this)))

  await this.trigger('htmx:after:swap', { element, request, response, swap, swaps })
}
```

---

## Implementation Status

**Complete**:
- ✅ HtmxElement class with reactive state
- ✅ Integrated HtmxElement into htmx.js
- ✅ Unified feature structure (`enable` + `feature`)
- ✅ Feature registration handling classes
- ✅ Removed `#defaultAttributes`
- ✅ Removed priority logic
- ✅ Updated activation flow to create HtmxElements
- ✅ Updated deactivation flow to cleanup HtmxElements
- ✅ Updated event handlers to use `element.htmx.*`

**TODO**:
- [ ] Remove `__initDOMSync` (obsolete)
- [ ] Replace remaining `__setHtmxState` calls with `element.htmx.*`
- [ ] Update trigger/listener logic to use HtmxElement
- [ ] Create config-mapping utility
- [ ] Convert remaining features to new structure
- [ ] Implement inheritance feature

---

## Notes

Everything under development. Ask before assuming. Update this doc as decisions are made.
