# htmx 4.0 Refactor (alpha → beta)

> Architecture refactor from htmx 4.0-alpha (`src/htmx.js`) to 4.0-beta. Current inventory, proposed architecture, and decision log.

---

## Current htmx 4.0 Inventory

### Attributes

| Attribute        | Purpose                              | Default             |
|------------------|--------------------------------------|---------------------|
| `hx-get`         | GET request to URL                   | -                   |
| `hx-post`        | POST request to URL                  | -                   |
| `hx-put`         | PUT request to URL                   | -                   |
| `hx-patch`       | PATCH request to URL                 | -                   |
| `hx-delete`      | DELETE request to URL                | -                   |
| `hx-action`      | URL (method via `hx-method`)         | -                   |
| `hx-method`      | HTTP method for `hx-action`          | GET                 |
| `hx-trigger`     | Event(s) that trigger request        | click/change/submit |
| `hx-target`      | Element to swap into                 | this                |
| `hx-swap`        | How to swap content                  | innerHTML           |
| `hx-select`      | Select portion of response           | -                   |
| `hx-select-oob`  | OOB selection from response          | -                   |
| `hx-swap-oob`    | OOB swap (on response element)       | -                   |
| `hx-push-url`    | Push URL to history                  | false               |
| `hx-replace-url` | Replace URL in history               | false               |
| `hx-indicator`   | Element(s) to show during request    | -                   |
| `hx-disable`     | Element(s) to disable during request | -                   |
| `hx-confirm`     | Confirmation message                 | -                   |
| `hx-include`     | Additional inputs to include         | -                   |
| `hx-vals`        | Additional values to submit          | -                   |
| `hx-headers`     | Additional headers                   | -                   |
| `hx-validate`    | Validate form before submit          | false               |
| `hx-encoding`    | Request encoding                     | -                   |
| `hx-sync`        | Request synchronization              | queue first         |
| `hx-boost`       | Boost links/forms                    | false               |
| `hx-preserve`    | Preserve element across swaps        | -                   |
| `hx-on:*`        | Inline event handlers                | -                   |
| `hx-config`      | Per-element config overrides         | -                   |
| `hx-ignore`      | Skip htmx processing                 | -                   |
| `hx-status:*`    | Status code handling                 | -                   |

### Trigger Modifiers

| Modifier    | Example            | Purpose                      |
|-------------|--------------------|------------------------------|
| `delay`     | `delay:300ms`      | Debounce                     |
| `throttle`  | `throttle:1s`      | Throttle                     |
| `once`      | `once`             | Fire only once               |
| `changed`   | `changed`          | Only if value changed        |
| `from`      | `from:document`    | Listen on different element  |
| `target`    | `target:.btn`      | Filter by event target       |
| `consume`   | `consume`          | Stop propagation             |
| `root`      | `root:#container`  | Intersection observer root   |
| `threshold` | `threshold:0.5`    | Intersection threshold       |

Special triggers: `load`, `revealed`, `intersect`, `every Xs`

### Swap Styles

| Style         | Description               |
|---------------|---------------------------|
| `innerHTML`   | Replace children (default)|
| `outerHTML`   | Replace entire element    |
| `beforebegin` | Insert before element     |
| `afterbegin`  | Insert as first child     |
| `beforeend`   | Insert as last child      |
| `afterend`    | Insert after element      |
| `delete`      | Remove target element     |
| `none`        | No swap                   |
| `textContent` | Replace text content      |
| `innerMorph`  | Morph children            |
| `outerMorph`  | Morph entire element      |

Swap modifiers: `swap:Xms`, `settle:Xms`, `scroll:top/bottom`, `show:top/bottom`, `transition`, `ignoreTitle`

### Events (Current)

> Note: The proposed architecture uses a simplified event model (see "Simplified Event Model" below).

| Event                       | When                                   |
|-----------------------------|----------------------------------------|
| `htmx:before:init`          | Before element initialization          |
| `htmx:after:init`           | After element initialization           |
| `htmx:before:process`       | Before processing DOM tree             |
| `htmx:after:process`        | After processing DOM tree              |
| `htmx:before:request`       | Before request sent                    |
| `htmx:after:request`        | After response received                |
| `htmx:config:request`       | Configure request (modify headers)     |
| `htmx:before:swap`          | Before DOM swap                        |
| `htmx:after:swap`           | After DOM swap                         |
| `htmx:before:settle`        | Before settle phase                    |
| `htmx:after:settle`         | After settle phase                     |
| `htmx:before:cleanup`       | Before element cleanup                 |
| `htmx:after:cleanup`        | After element cleanup                  |
| `htmx:before:history:update`| Before history update                  |
| `htmx:after:history:update` | After history update                   |
| `htmx:before:sse:stream`    | Before SSE stream starts               |
| `htmx:after:sse:stream`     | After SSE stream ends                  |
| `htmx:before:sse:message`   | Before SSE message processed           |
| `htmx:after:sse:message`    | After SSE message processed            |
| `htmx:before:sse:reconnect` | Before SSE reconnect                   |
| `htmx:confirm`              | Confirmation (can override)            |
| `htmx:error`                | Request error                          |
| `htmx:finally:request`      | Always fires after request             |
| `htmx:abort`                | Request aborted                        |

### Response Headers

| Header                  | Purpose                    |
|-------------------------|----------------------------|
| `HX-Trigger`            | Trigger event(s) on client |
| `HX-Trigger-After-Swap` | Trigger after swap         |
| `HX-Trigger-After-Settle`| Trigger after settle      |
| `HX-Redirect`           | Client-side redirect       |
| `HX-Refresh`            | Full page refresh          |
| `HX-Location`           | Navigate with htmx         |
| `HX-Push-Url`           | Push URL to history        |
| `HX-Replace-Url`        | Replace URL in history     |
| `HX-Reswap`             | Override swap method       |
| `HX-Retarget`           | Override target            |
| `HX-Reselect`           | Override select            |

### Request Headers

| Header                      | Value                      |
|-----------------------------|----------------------------|
| `HX-Request`                | "true"                     |
| `HX-Boosted`                | "true" if boosted          |
| `HX-Source`                 | Source element identifier  |
| `HX-Target`                 | Target element identifier  |
| `HX-Current-URL`            | Current page URL           |
| `HX-Request-Type`           | "full" or "partial"        |
| `HX-History-Restore-Request`| "true" on history restore  |

### Config Options

> **Note:** Kernel owns core lifecycle config (`request`, `swap`, `trigger`, `syntax`). Extensions own their modifiers via `htmx:init` convention (see Decision 010).

| Option                     | Default               | Purpose                        |
|----------------------------|-----------------------|--------------------------------|
| `prefix`                   | ""                    | Attribute prefix               |
| `defaultSwap`              | "innerHTML"           | Default swap style             |
| `defaultTimeout`           | 60000                 | Request timeout (ms)           |
| `indicatorClass`           | "htmx-indicator"      | Indicator CSS class            |
| `requestClass`             | "htmx-request"        | Request-in-progress class      |
| `includeIndicatorCSS`      | true                  | Inject indicator CSS           |
| `history`                  | true                  | Enable history                 |
| `transitions`              | false                 | Enable view transitions        |
| `mode`                     | "same-origin"         | Fetch mode                     |
| `implicitInheritance`      | false                 | Implicit attribute inheritance |
| `logAll`                   | false                 | Log all events                 |
| `morphIgnore`              | ["data-htmx-powered"] | Morph ignore attributes        |
| `morphScanLimit`           | 10                    | Morph scan limit               |
| `noSwap`                   | [204, 304]            | Status codes that skip swap    |
| `sse.reconnect`            | false                 | SSE auto-reconnect             |
| `sse.reconnectDelay`       | 500                   | SSE reconnect delay            |
| `sse.reconnectMaxDelay`    | 60000                 | SSE max delay                  |
| `sse.reconnectMaxAttempts` | 10                    | SSE max attempts               |
| `sse.reconnectJitter`      | 0.3                   | SSE jitter                     |
| `sse.pauseInBackground`    | false                 | Pause SSE in background        |

### Public API (htmx 4.0)

```js
htmx.config                      // Configuration object
htmx.init(element)               // Initialize subtree
htmx.fetch(method, url, options) // Programmatic request
htmx.on(event, handler)          // Listen to lifecycle events
htmx.emit(element, event, detail)// Dispatch event
htmx.register(name, extension)   // Register extension
```

**Removed:**
- `htmx.find()` / `htmx.findAll()` — use `document.querySelector`
- `htmx.takeClass()` — too niche
- `htmx.onLoad()` — use `htmx.on('htmx:init', ...)`
- `htmx.parseInterval()` — extensions can implement
- `htmx.timeout()` — use `new Promise(r => setTimeout(r, ms))`
- `htmx.forEvent()` — extensions can implement

**Compat aliases** (via compat extension):
- `htmx.ajax` → `htmx.fetch`
- `htmx.trigger` → `htmx.emit`
- `htmx.process` → `htmx.init`
- `htmx.registerExtension` → `htmx.register`

### Internal Methods

| Method | Signature | Purpose |
|--------|-----------|---------|
| `__initHtmxConfig` | `()` | Parse `<meta>` config, set defaults |
| `__initRequestIndicatorCss` | `()` | Inject indicator stylesheet |
| `__attributeValue` | `(el, name, default, collector)` | Read attribute with inheritance |
| `__parseConfig` | `(str)` | Parse config string to object |
| `__mergeConfig` | `(str, target)` | Merge config string into target |
| `__parseTriggerSpecs` | `(spec)` | Parse `hx-trigger` value to spec array |
| `__determineMethodAndAction` | `(el, evt)` | Resolve HTTP method + URL from element |
| `__createRequestContext` | `(el, evt)` | Build request context object |
| `__handleTriggerEvent` | `(ctx)` | Process trigger → issue request |
| `__issueRequest` | `(ctx)` | Execute fetch, handle response |
| `__handleSSE` | `(ctx, el, response)` | Handle SSE streaming response |
| `__parseSSE` | `(response)` | Parse SSE event stream |
| `__makeFragment` | `(text)` | Parse HTML string to DocumentFragment |
| `__parseSwapSpec` | `(str)` | Parse `hx-swap` value to spec |
| `__insertContent` | `(task, cssTransition)` | Execute single swap task |
| `__processOOB` | `(fragment, sourceEl, selectOOB)` | Process out-of-band swaps |
| `__morph` | `(oldNode, fragment, innerHTML)` | DOM diffing entry point |
| `__morphChildren` | `(ctx, oldParent, newParent, insertionPoint, endPoint)` | Recursive child morphing |
| `__findBestMatch` | `(ctx, node, startPoint, endPoint)` | Find best morph match |
| `__handleHistoryUpdate` | `(ctx)` | Push/replace history state |
| `__showIndicators` | `(el)` | Show request indicators |
| `__hideIndicators` | `(indicators)` | Hide request indicators |
| `__disableElements` | `(el)` | Disable elements during request |
| `__enableElements` | `(elements)` | Re-enable elements after request |
| `__collectFormData` | `(el, form, submitter, validate)` | Collect form inputs for request |
| `__findExt` | `(el, selector, thisAttr)` | Find element with extended selectors |
| `__findAllExt` | `(el, selector, thisAttr, global)` | Find all with extended selectors |
| `__cleanup` | `(el)` | Remove listeners, state, abort requests |

---

## Proposed Architecture

### Three Layers

- **Layer 3 — High-Level API:** User-facing public methods. TBD.
- **Layer 2 — Behaviors:** Orchestration, parsing, queue management. TBD.
- **Layer 1 — Kernel:** `emit()`, `register()`, `wrap()`, `state`, `config`. Minimal core.

### Event Model (22 events)

| Event | When | Can Do | Fires On | Detail |
|---|---|---|---|---|
| **System** |
| `htmx:ready` | Library boots | — | `document` | `{}` |
| **Element lifecycle** |
| `htmx:init` | After element gets htmx behaviors | Observe | initialized element | `{ element, root }` |
| `htmx:cleanup` | Before element loses htmx behavior | Cancel | cleaned-up element | `{ element }` |
| **Request lifecycle** — detail accumulates as one object through the pipeline |
| `htmx:trigger` | After trigger condition met | Observe | trigger element | `{ trigger }` |
| `htmx:request` | Before fetch | Cancel, Modify | trigger element | `{ trigger, request }` |
| `htmx:response` | After fetch, before swap | Cancel, Modify | trigger element | `{ trigger, request, response }` |
| `htmx:swap` | Before each DOM mutation (×N) | Cancel, Modify | trigger element | `{ trigger, request, response, swap }` |
| `htmx:settle` | After DOM + process + CSS settle (×N) | Observe | trigger element | `{ trigger, request, response, swap }` |
| `htmx:error` | On error during request lifecycle | Cancel | trigger element | `{ trigger, request?, response?, error }` |
| `htmx:done` | After all swaps (finally) | Observe | trigger element | `{ trigger, request, response, error? }` |
| `htmx:abort` | Cancel in-flight request | — | trigger element | — |
| **History** (extension-owned) |
| `htmx:history:push` | After URL pushed | Observe | trigger element | — |
| `htmx:history:replace` | After URL replaced | Observe | trigger element | — |
| `htmx:history:restore` | Before restoring state | Cancel | trigger element | — |
| **SSE** (extension-owned) |
| `htmx:sse:open` | Connection established | Observe | trigger element | — |
| `htmx:sse:message` | Message received | Cancel, Modify | trigger element | — |
| `htmx:sse:close` | Connection closed | Observe | trigger element | — |
| `htmx:sse:error` | Connection error | Cancel | trigger element | — |
| **WebSocket** (extension-owned) |
| `htmx:ws:open` | Connection established | Observe | trigger element | — |
| `htmx:ws:message` | Message received | Cancel, Modify | trigger element | — |
| `htmx:ws:close` | Connection closed | Observe | trigger element | — |
| `htmx:ws:send` | Before sending message | Cancel, Modify | trigger element | — |
| `htmx:ws:error` | Connection error | Cancel | trigger element | — |

`htmx:error` defaults to `console.error`; cancelling suppresses the log. `htmx:done` always fires (finally block). `htmx:swap`/`htmx:settle` fire ×N for OOB/partial responses — each with a different `swap` object but the same `trigger`/`request`/`response`.

### Detail Fields

- `element` = wrapped element
- `root` = element passed to `htmx.init()` (check `e.target === e.detail.root` for subtree completion)
- `trigger` = `{ element, event }` — what initiated the request (element is wrapped)
- `request` = `{ url, method, headers, body }` — outgoing request
- `response` = `{ status, url, headers, text }` — server response
- `swap` = `{ content, target, method }` — the DOM mutation: what content, where, how (target is wrapped)
- `error` = `{ type, message, cause? }` — type: `'network'`, `'timeout'`, `'abort'`, `'swap'`, `'target'`, etc.

Extensions can attach fields to the detail for cross-phase state. Per-element state via `element.state`.

### Wrapped Elements

Elements in event detail are wrapped Proxies. Methods:

| Method | Returns | Purpose |
|--------|---------|---------|
| `.attr(name)` | `string\|null` | Read attribute (with inheritance) |
| `.find(selector)` | `wrapped\|null` | `querySelector`, wrapped |
| `.findAll(selector)` | `wrapped[]` | `querySelectorAll`, wrapped |
| `.emit(event, detail)` | `boolean` | Dispatch event on element |
| `.state` | `object` | Auto-vivifying per-element state (namespaced by extension) |
| `.native` | `Element` | Unwrap to raw DOM element |

Static equivalents: `htmx.attr(el, name)`, `htmx.find(el, sel)`, `htmx.findAll(el, sel)`, `htmx.emit(el, evt, detail)`, `htmx.state(el)`.

### Layer 3: High-Level API

TBD. See Parking Lot for chainable API concept.

### Layer 1: Kernel

**Config shape:**

| Path | Default | Purpose |
|------|---------|---------|
| `request.credentials` | `'same-origin'` | Fetch credentials mode |
| `request.mode` | `'same-origin'` | Fetch mode |
| `request.timeout` | `60000` | Request timeout (ms) |
| `request.headers` | `{ 'HX-Request': 'true' }` | Default headers |
| `swap.method` | `'innerHTML'` | Default swap style |
| `swap.target` | `'this'` | Default target |
| `syntax.prefix` | `'hx-'` | Attribute prefix |
| `syntax.delimiter` | `':'` | Modifier delimiter |

Extensions own their config namespaces via `htmx:init` convention (see ADR-010).

**Kernel API:**

| Function | Signature | Purpose |
|----------|-----------|---------|
| `emit` | `(element, eventName, detail?) → boolean` | Call extension handlers, dispatch DOM event. Returns false if cancelled. |
| `register` | `(name, { requires?, on }) → void` | Register extension. Throws on duplicate or missing dependency. |
| `wrap` | `(element) → Proxy` | Wrap element with convenience methods. |
| `state` | WeakMap-backed | Per-element state. Auto-vivifying namespaces via Proxy. |

**Target resolution:** `this`, `body`, `closest <sel>`, `find <sel>`, or CSS selector.

**JIT attribute reading:** Attributes read at trigger time, not activation time. Enables dynamic attribute changes.

---

## Layer 2: Behaviors (WIP)

This layer needs design. Current thinking:

- Should be as clean as Layer 3
- Handles orchestration between request/swap/history/indicators
- Parsing utilities (trigger specs, swap specs, intervals)
- Attribute reading with inheritance
- Request queue management

Open question: What's the cleanest API for this layer?

---

## Extension System

Extensions listen to lifecycle events and modify behavior. That's it—no overrides, no registries, just events.

### Registration

```js
htmx.register('name', {
    requires: [],  // optional: load after these extensions
    on: {}         // event handlers
})
```

### Examples

**Simple extension:**
```js
htmx.register('csrf', {
    on: {
        'htmx:request': ({ request }) => {
            request.headers['X-CSRF-Token'] = document.querySelector('meta[name="csrf-token"]').content
        }
    }
})
```

**Extension with config:**

Convention: declare defaults in `htmx:init`, user overrides win via spread.

```js
htmx.register('preload', {
    on: {
        'htmx:init': () => {
            htmx.config.preload = {
                delay: 100,
                images: false,
                ...htmx.config.preload
            }
        },
        'htmx:init': ({ element }) => {
            if (!element.attr('hx-preload')) return

            const handler = () => {
                setTimeout(() => {
                    const url = element.attr('hx-get') || element.attr('href')
                    if (url && !element.state.preload.done) {
                        fetch(url)
                        element.state.preload.done = true
                    }
                }, htmx.config.preload.delay)
            }

            element.native.addEventListener('mouseenter', handler)
            element.state.preload.handler = handler
        },
        'htmx:cleanup': ({ element }) => {
            element.state.preload?.handler &&
                element.native.removeEventListener('mouseenter', element.state.preload.handler)
        }
    }
})

// User configures (before or after registration):
htmx.config.preload = { delay: 200 }
// Or after init:
htmx.config.preload.delay = 200
```

**Extension with dependency:**
```js
htmx.register('oob', {
    requires: ['select'],
    on: {
        'htmx:swap': ({ swap }) => {
            // select extension already filtered the fragment
        }
    }
})
```

**Custom swap style via events:**
```js
htmx.register('morph', {
    on: {
        'htmx:swap': ({ swap }) => {
            if (swap.method === 'morph') {
                morphdom(swap.target.native, swap.content)
                return false  // prevent default swap
            }
        }
    }
})
```

**Cancel requests:**
```js
htmx.register('offline-guard', {
    on: {
        'htmx:request': () => {
            if (!navigator.onLine) {
                showOfflineMessage()
                return false  // cancel request
            }
        }
    }
})
```

### How It Works

- Handlers receive a detail object they can inspect and modify
- Return `false` to cancel the current phase
- Extensions are called in registration order (respecting `requires`)
- State is stored via `element.state.{extensionName}` (auto-vivified)
- Config convention: set defaults in `htmx:init` with `{ defaults..., ...htmx.config.name }`

### Registration

- Extensions stored in array, called in registration order
- `requires` array enforces dependencies (must be registered first)
- Late registration: if `htmx:ready` already fired, extension's `htmx:init` called immediately
- Duplicate names throw

### Built-in Extensions

Core htmx behaviors are implemented as extensions. This dogfoods the extension system, lets users disable/replace core behaviors, and ensures core and external extensions use identical APIs.

| Extension | Events | Purpose |
|-----------|--------|---------|
| `defaultTriggers` | `ready`, `init` | Assign default trigger events (click/change/submit) |
| `hx-boost` | `init` | Intercept links/forms, add htmx behavior |
| `hx-on` | `init` | Bind `hx-on:*` event handlers |
| `hx-confirm` | `request` | Show confirmation dialog, cancel if declined |
| `hx-headers` | `request` | Add headers from `hx-headers` attribute |
| `hx-vals` | `request` | Add values from `hx-vals` to request body |
| `hx-include` | `request` | Include additional inputs in request |
| `hx-indicator` | `request`, `done` | Show/hide loading indicators |
| `hx-disable` | `request`, `done` | Disable/re-enable elements during request |
| `hx-sync` | `request` | Request queue strategy |
| `timeout` | `ready`, `request`, `done` | Abort requests exceeding timeout |
| `etag` | `request`, `response` | ETag caching (If-None-Match) |
| `noSwap` | `ready`, `response` | Skip swap for 204/304 responses |
| `responseHeaders` | `response`, `swap` | Handle HX-Trigger, HX-Redirect, HX-Retarget, etc. |
| `hx-status` | `swap` | Route to alternate targets by status code |
| `sse` | `ready`, `response` | Handle text/event-stream responses |
| `select` | `swap` | Filter response by `hx-select` |
| `oob` | `swap` | Process `hx-select-oob` and `hx-swap-oob` (requires: select) |
| `title` | `done` | Update document.title from response |
| `history` | `ready`, `request`, `done` | Push/replace history state |
| `injectStyles` | `ready` | Inject indicator CSS |
| `compat` | `ready` | Backwards-compat aliases (ajax→fetch, etc.)

---

## Decisions

### 001: Simplified Event Model — *Superseded by ADR-014*

---

### 002: No Abbreviated Parameter Names

**Context:** Codebase littered with `el`, `evt`, `ctx`, `s`. Hard to read, inconsistent, requires mental translation.

**Decision:** Full names in function signatures: `element`, `event`, `spec`, `data`. Abbreviations acceptable only in tight loops (`for (const el of elements)`).

**Consequences:** Slightly more typing. Much easier to read and grep. Self-documenting code.

---

### 003: No Context Object

**Context:** The `ctx` pattern passes one big mutable object through every function. Unclear what's available at each phase, easy to accidentally mutate, hard to trace data flow.

**Decision:** Phase-specific detail objects with clear shapes. Each event receives only what it needs. Detail accumulates predictably: `request` → `request + response` → `request + response + swap`.

**Consequences:** More explicit function signatures. Harder to "sneak" data through. Forces clear thinking about what each phase needs.

---

### 004: Incremental Event Detail

**Context:** Event handlers need access to request/response/swap data, but not all data exists at all phases.

**Decision:** Each phase contributes its piece to the detail object:
- `htmx:request` → `{ trigger, request }`
- `htmx:response` → `{ trigger, request, response }`
- `htmx:swap` → `{ trigger, request, response, swap }`
- `htmx:done` → `{ trigger, request, response, swap, error? }`

**Consequences:** Predictable. Handlers destructure exactly what they need. No guessing what's available.

---

### 005: WeakMap for Element State

**Context:** Current htmx stores state on `element._htmx`. Pollutes DOM elements, can leak if elements removed without cleanup.

**Decision:** Use WeakMap keyed by element. State automatically garbage collected when element is removed.

**Consequences:** Cleaner elements. No property conflicts. Requires explicit state access via `state.get(element)`.

---

### 006: Wrapped Elements in Event Handlers

**Context:** Event handlers often need to read attributes, query children, emit events. Raw DOM API is verbose.

**Decision:** Elements in event detail are wrapped in a Proxy providing convenience methods: `.attr()`, `.find()`, `.findAll()`, `.emit()`, `.state`, `.native`. Static equivalents: `htmx.attr(element, ...)`, `htmx.find(element, ...)`, `htmx.findAll(element, ...)`, `htmx.emit(element, ...)`, `htmx.state(element)`.

**Consequences:** Cleaner handler code. Slight overhead from Proxy. Access raw element via `.native` when needed.

---

### 007: JIT Attribute Reading

**Context:** Should attributes be read at activation time or trigger time? Reading at activation time means dynamic changes don't take effect.

**Decision:** Read attributes at trigger time (JIT). Activation only sets up the event listener.

**Consequences:** Dynamic attribute changes work. Slightly more work per trigger. More flexible.

---

### 008: Events-Only Extension System

**Context:** Extensions need to hook into htmx lifecycle and modify behavior. Considered `override` pattern (wrapping kernel functions) but rejected it—creates hard-to-debug chains, leaks internal signatures as API, order-dependent behavior.

**Decision:** Extensions use only `on` event handlers. No `override`, no registries. Custom behaviors (swap styles, triggers, etc.) are handled by listening to events and returning `false` to prevent defaults.

**Rejected alternatives:**

| Pattern | Why Rejected |
|---|---|
| Hook types (Sync, Bail, Waterfall, Async) | Tapable complexity for Webpack's needs, not ours. `return false` suffices. |
| Plugin priority numbers | Implicit ordering games. Registration order + `requires` is simpler. |
| Override/wrapping system | Hard to debug, leaks internal signatures as API, order-dependent. |
| Registries (swapStyles, triggers) | Unnecessary indirection. Events handle custom swap styles and triggers. |

**Consequences:** Simpler mental model. Extensions can't break each other via wrapping chains. All extension points are explicit lifecycle events. Slightly more verbose for some use cases but much more predictable. Hyrum's Law applies: every kernel function exposed to extensions becomes permanent API — keep the surface minimal (`register`, `emit`, `wrap`).

---

### 009: DOM Processing Naming — *Superseded by ADR-014*

---

### 010: Extension Config via htmx:init Convention

**Context:** Extensions need configurable options with sensible defaults. Considered a `config:` field in registration, but that adds a special case to the API.

**Decision:** Convention over configuration. Extensions declare defaults in `htmx:init` handler using spread pattern:

```js
'htmx:init': () => {
    htmx.config.myExtension = {
        option1: 'default',
        option2: 100,
        ...htmx.config.myExtension  // user overrides win
    }
}
```

Late-registered extensions have their `htmx:init` called immediately.

**Consequences:**
- No special `config:` field in registration API
- Defaults are explicit and visible at top of extension
- User overrides work before or after registration
- Kernel handles late registration edge case

---

### 011: Extension State via element.state.{name}

**Context:** Extensions need per-element state (e.g., storing an IntersectionObserver). Considered auto-namespacing via kernel magic, but that requires the kernel to know which extension is accessing state.

**Decision:** Explicit namespacing by convention. Extensions access `element.state.{extensionName}`:

```js
'htmx:init': ({ element }) => {
    element.state.preload.observer = new IntersectionObserver(...)
}
```

The `element.state` object uses auto-vivification (Proxy) so `element.state.preload.anything` auto-creates the `preload` namespace.

**Consequences:**
- No kernel magic needed
- Extensions explicitly namespace their state
- Extensions can share state if desired (use same namespace)
- Typos in namespace names could cause subtle bugs (acceptable trade-off)

---

### 012: Fragment as Architectural Primitive

**Context:** Explored whether the "UNIX file" primitive for htmx should be the attribute (user-facing interface) or the hypermedia fragment (data flowing through the system). The attribute is the shell command; the fragment is the file descriptor.

**Decision:** The fragment is the core data primitive. A fragment is a unit of DOM mutation: `{ content, target, method }`. It doesn't exist at request time — it emerges when the response is parsed. One response can produce multiple fragments (main swap + OOB). The event detail object flows as a single object through the lifecycle, and the `swap` field IS the fragment.

The pipeline model maps directly onto the event system — events are named checkpoints, the detail is the data flowing through. No new abstraction needed beyond treating the detail object as a first-class pipeline datum.

**Consequences:** Cleaner mental model for non-HTTP sources (WebSocket message → fragment → same swap pipeline). OOB is just "one response produced multiple fragments." Indicators/confirm/sync are request-lifecycle concerns, not fragment concerns — they operate before any fragment exists.

---

### 013: Event Naming — *Superseded by ADR-014*

---

### 014: Pragmatic Event Timing — No Mandatory Pairs

**Context:** htmx 4.0-alpha has 30+ events with mandatory `before:`/`after:` pairs for every phase. Most go unused. The question: how to reduce event bloat while preserving extensibility?

Considered approaches:
1. Mandatory before/after pairs for everything → event bloat
2. Single event per phase with phase flags → awkward API
3. `before:` prefix for "before", bare name for "after" → still prefix clutter
4. Past tense (`-ed`) for "after" universally → `hx-on::inited` is awkward, users expect `hx-on::init`

**Decision:** Each event fires at its **most useful time**. Add a second event only where both timings are genuinely needed.

See unified event table in "Event Model (22 events)" above. Key timing rationale:

**No before-init event.** Use cases are covered:
- Prevent init → use `hx-ignore`
- Modify attributes → JIT reading means modify after init, read at trigger time

**`htmx:settle` not `htmx:swapped`.** "Settle" implies dust has settled — cleaner than awkward past tense. Fires after DOM insertion + element processing + CSS settle transitions.

**Subtree init completion:** Every `htmx:init` includes `e.detail.root`. Check `e.target === e.detail.root` for batch completion.

**API method:**
- `htmx.init(element)` — initialize htmx behaviors on subtree

No public cleanup method. Cleanup happens automatically when elements are removed from DOM or when `htmx.init()` is called on a subtree that was already initialized.

**Consequences:**
- 22 total events (down from 30+)
- No prefix clutter (`before:`/`after:`)
- No awkward `-ed` suffixes
- Each event fires at its most useful time
- Feature events namespaced (`history:`, `sse:`, `ws:`)
- `hx-on::init` just works
- Breaking change from 4.0-alpha event names

---

### 015: Public API — Modern Naming, Minimal Surface

**Context:** htmx 2.0 API has legacy names (`ajax`, `trigger`) and utility functions that duplicate browser APIs (`find`, `findAll`). Need to modernize for 4.0 while keeping API surface minimal.

**Decision:**

```js
htmx.config                      // Configuration object
htmx.init(element)               // Initialize subtree
htmx.fetch(method, url, options) // Programmatic request
htmx.on(event, handler)          // Listen to lifecycle events
htmx.emit(element, event, detail)// Dispatch event
htmx.register(name, extension)   // Register extension
```

Naming changes:
- `htmx.ajax()` → `htmx.fetch()` — modern terminology, "ajax" is 2005
- `htmx.trigger()` → `htmx.emit()` — avoids collision with `htmx:trigger` event, matches EventEmitter convention
- `htmx.registerExtension()` → `htmx.register()` — shorter, cleaner
- `htmx.process()` → `htmx.init()` — clearer intent

Removed:
- `htmx.find()` / `htmx.findAll()` — use `document.querySelector`
- `htmx.takeClass()` — too niche
- `htmx.onLoad()` — use `htmx.on('htmx:init', ...)`
- `htmx.parseInterval()` / `htmx.timeout()` / `htmx.forEvent()` — trivial utilities, extensions can implement

**Consequences:**
- 6 public methods total (down from 13+)
- Modern naming that doesn't feel dated
- No collision between `htmx.emit()` method and `htmx:trigger` event
- Compat extension provides aliases for migration

---

## Open Questions

1. ~~**DOM processing naming**~~ — Resolved: `htmx.init()` with events `htmx:init` / `htmx:cleanup`. No public cleanup method. (see Decision 014)

2. **`htmx.on` collision** - Layer 1 uses `htmx.on(event, handler)` for lifecycle events. Layer 3 uses `htmx.on(element, event).get(...)` for binding behaviors. Same name, different purposes. Options: different names (`listen` vs `on`), namespacing (`htmx.events.on`), or signature detection.

3. **Layer 2 design** - What's the clean API for the behavior/orchestration layer?

4. **SSE/WebSocket** - How do they fit the chainable model?

5. **OOB swaps** - How exposed in API?

6. **Boost** - Extension or built-in?

7. **Error handling** - Events only? Callbacks? `.catch()`?

---

## Parking Lot

Ideas worth preserving for later consideration. Not committed to.

- **`htmx:arrival`** — fires on each top-level element added by any swap. Replaces htmx 2.0's `htmx:load`. For scripts/extensions reacting to new DOM that doesn't have `hx-*` attributes (where `htmx:init` wouldn't fire).
- **Chainable Layer 3 API** — `htmx.on('#btn', 'click').get('/api', { target: '#result' })`. Declarative JS equivalent of attributes. Deferred until Layer 2 is designed.
- **`CANCELLED` sentinel** — Symbol returned from pipeline to short-circuit without error. Cleaner than `return false` for "intentionally stopped."
- **`detail.waitUntil(promise)`** — async extension hooks that delay the pipeline (e.g., confirm dialogs, async validation).
- **RelaxedJSON parser** — dot notation support in `hx-vals`/`hx-headers` (e.g., `hx-vals="user.name: 'John'"`).
- **Reactive state → DOM sync** — `element.state` changes auto-reflect to DOM attributes or text.
- **`htmx.inspect(element)`** — debug helper returning all htmx state/config for an element.
- **`hx-debug`** — per-element debug flag (registered feature, not kernel).
- **`hx-on` shorthands** — shorthand syntax for common event handlers (separate feature).
- **Universal attribute parser** — single parser for all `hx-*` attribute values (modifiers, selectors, expressions).
- **View transitions queue** — coordinate multiple concurrent view transitions.
- **Configurable selectors** — allow extensions to register custom selector syntax (e.g., `closest`, `find`, `next`, `previous`).
- **Meta config dot-path naming** — `<meta name="htmx.config.swap.method" content="outerHTML">`.
- **Trace mode** — opt-in debug logging (`htmx.config.debug = true` or `['request', 'swap']`). Log which extension fired, detail at each phase, cancellations.
- **CDN bundle builder** — Landing page UI with checkboxes for extensions. Generates URL like `cdn.htmx.org/4.0/htmx.min.js?ext=focusRestore,sse`. Cloudflare Worker concatenates kernel + core + selected extensions on first request, caches result. Makes "what's in core" less high-stakes since adding/removing features is visible and trivial.

---

## Files

| File                     | Status     | Purpose                                  |
|--------------------------|------------|------------------------------------------|
| `src/htmx.js`            | Current    | htmx 4.0-alpha (monolithic)              |
| `src/htmx.draft.js`      | Draft      | Kernel implementation matching this spec |
| `src/htmx.kernel.js`     | Delete     | Superseded by htmx.draft.js              |
| `src/htmx.refactored.js` | Delete     | Superseded by htmx.draft.js              |
| `dev/four/DECISIONS.md`  | Delete     | Superseded by this file                  |
| `ARCHITECTURE_FULL.md`   | Delete     | Superseded by this file                  |
| `EVENT_AUDIT.md`         | Delete     | Superseded by this file                  |
| `IDEAS.md`               | Delete     | Superseded by this file                  |

---

## Status

- [x] Inventory current htmx behaviors
- [x] Design Layer 3 API (high-level)
- [x] Design Layer 1 kernel concepts
- [ ] Design Layer 2 (behaviors/orchestration)
- [ ] Implement kernel
- [ ] Implement Layer 2
- [ ] Implement Layer 3
- [ ] Make attributes compile to API
- [ ] Test suite
- [ ] Migration guide
