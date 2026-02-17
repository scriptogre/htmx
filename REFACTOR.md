# htmx 4.0 Refactor — Design Journal

> **This document is the design process, not the spec.** Many ideas below were explored and discarded. ADRs contradict each other as thinking evolved. The source of truth for the current architecture is the code itself: `src/htmx.core.js`, `src/htmx.defaults.js`, and `src/extensions/`. Read the code first, then come here for historical context on *why* decisions were made.

---

## Current Architecture (read the code)

- **`src/htmx.core.js`** (~580 lines) — Complete engine: parse, find, attr, swap, ajax, init/cleanup, events, wrap, register, emit, on. Standalone-usable (no extensions needed for programmatic API).
- **`src/htmx.defaults.js`** (~260 lines) — All standard behaviors in one file, 12 individual `htmx.register()` calls: hx-get/post/put/patch/delete, hx-swap, hx-target, hx-trigger, default-trigger, defaults (config, swap aliases, headers, timeout), delay, throttle.
- **`src/extensions/`** (4 files) — Optional: extended-selectors, inheritance, parse-dot-path, boost.
- **`dist/htmx.js`** — Always the assembled output. All extensions inlined, zero register() calls.
- **`tools/assembler/`** — Rust assembler. Inlines boot handlers between markers, event handlers at `api.emit()` call sites. Zero `register()` calls in output. Validates handler params at build time.
- **`dist/htmx.js`** — Assembled output with all extensions inlined.
- Extensions register via `htmx.register(name, {on: {...}})` and receive `(detail, api)` in handlers.
- Internal code calls through `api.*` so extension wraps take effect. Extensions wrap api functions via `api.wrap(name, fn)`. Public API uses getters that delegate to `api`.

### Two-Level Interception Architecture

The kernel is not a monolithic library with rigid encapsulation. It is a microkernel where internal consistency is delegated to extensions. Two distinct interception mechanisms operate at two architectural levels:

**Level 1 — API-level wrapping** (cross-cutting concerns):

Extensions wrap `api.*` functions at boot via `api.wrap(name, wrapper)`. The wrapper receives the original function as its first argument, followed by the caller's arguments — the Decorator pattern applied at function granularity. Internal code calls through `api.*`, so wraps take effect transparently at every call site. This is "Poor Man's Dependency Injection": the `api` object is scoped to the closure and handed only to registered extensions, not exposed globally.

Current wraps:
- `api.find` ← `extended-selectors`: adds named targets (`this`, `body`), traversal (`closest`, `next`, `previous`)
- `api.attr` ← `inheritance`: adds ancestor walking with `:inherited` / `:append` suffixes
- `api.parse` ← `parse-dot-path`: post-processes parsed objects to expand dot-notation keys
- `api.on` ← `delay`: debounces handler when `options.delay` is set
- `api.on` ← `throttle`: throttles handler when `options.throttle` is set

Wraps compose as a decorator chain in registration order (last registered wraps outermost):
```
caller → parse-dot-path → kernel parse → result
caller → inheritance → kernel attr → result
caller → extended-selectors → kernel find → result
caller → throttle → delay → kernel on → addEventListener
```

**Level 2 — Pipeline-level events** (phase-specific behavior):

Extensions listen to lifecycle events to modify a specific pipeline execution. Three-phase convention per pipeline step:
- `config:*` — extensions configure detail, set default strategies (Strategy pattern via handler replacement)
- `before:*` — extensions can cancel (`return false` or `preventDefault`)
- `after:*` — extensions observe results

The handler-as-data pattern (Strategy pattern) is the core mechanism that makes a 550-line kernel possible. The kernel defines the pipeline shape, sets a sensible default handler, and lets extensions swap the strategy:

```js
detail.handler = async () => { /* default: fetch */ }
api.emit(element, 'htmx:config:request', detail)  // extensions may replace handler
await detail.handler()                              // execute whatever strategy won
```

This is strictly more powerful than `preventDefault` — instead of only saying "don't do the default," extensions can say "do this instead." This enables swapping fetch for WebSockets, mocking for testing, or custom transports, without the kernel knowing about any of them.

**Why two levels?**

These serve genuinely different architectural purposes:
- **API wrapping** answers: "how does this operation work everywhere?" — global, call-site transparent
- **Pipeline events** answer: "what happens during this particular execution?" — scoped to one pipeline run, detail-aware

Collapsing them into one mechanism would lose expressiveness. API-level wrapping is for cross-cutting concerns (selector resolution, attribute inheritance). Pipeline events are for workflow-specific behavior (request headers, swap styles).

**What this is not:**

The architecture uses patterns formalized by AOP (Aspect-Oriented Programming) — Decorator for API wraps, Observer + Strategy for pipeline events — but it is not a formal AOP system. There is no pointcut language, no declarative join point selection, and no weaving step. Extensions explicitly name what they hook. This is intentional: for a ~550-line kernel with <20 extensions, explicit interception is more appropriate than a pointcut abstraction layer.

---

### Split defaults into individual extension files (stale)

Previously extracted 17 extensions from `htmx.defaults.js` into `src/defaults/*.js`. Now stale after ADR-077: `load.js`, `every.js`, `once.js`, `from.js` were absorbed into `trigger-attrs`; `delay.js` and `throttle.js` were rewritten as `api.on` wraps; `trigger-attrs.js` was rewritten to use `detail.trigger.handler`. The split files need re-syncing with the current `htmx.defaults.js`.

**Files:**
- `src/defaults/` — 17 extension files (stale, need updating)
- `tests/` — 7 test files (some will need updating)
- `src/htmx.defaults.js` — canonical source of truth

---

*Everything below is the design journal — the messy history of how we got here.*

---

## Original htmx 4.0-alpha Inventory

---

## Original htmx 4.0-alpha Inventory

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

| Style         | Description                |
|---------------|----------------------------|
| `innerHTML`   | Replace children (default) |
| `outerHTML`   | Replace entire element     |
| `beforebegin` | Insert before element      |
| `afterbegin`  | Insert as first child      |
| `beforeend`   | Insert as last child       |
| `afterend`    | Insert after element       |
| `delete`      | Remove target element      |
| `none`        | No swap                    |
| `textContent` | Replace text content       |
| `innerMorph`  | Morph children             |
| `outerMorph`  | Morph entire element       |

Swap modifiers: `swap:Xms`, `settle:Xms`, `scroll:top/bottom`, `show:top/bottom`, `transition`, `ignoreTitle`

### Events (Current)

> Note: The proposed architecture uses a simplified event model (see "Simplified Event Model" below).

| Event                        | When                               |
|------------------------------|------------------------------------|
| `htmx:before:init`           | Before element initialization      |
| `htmx:after:init`            | After element initialization       |
| `htmx:before:process`        | Before processing DOM tree         |
| `htmx:after:process`         | After processing DOM tree          |
| `htmx:before:request`        | Before request sent                |
| `htmx:after:request`         | After response received            |
| `htmx:config:request`        | Configure request (modify headers) |
| `htmx:before:swap`           | Before DOM swap                    |
| `htmx:after:swap`            | After DOM swap                     |
| `htmx:before:settle`         | Before settle phase                |
| `htmx:after:settle`          | After settle phase                 |
| `htmx:before:cleanup`        | Before element cleanup             |
| `htmx:after:cleanup`         | After element cleanup              |
| `htmx:before:history:update` | Before history update              |
| `htmx:after:history:update`  | After history update               |
| `htmx:before:sse:stream`     | Before SSE stream starts           |
| `htmx:after:sse:stream`      | After SSE stream ends              |
| `htmx:before:sse:message`    | Before SSE message processed       |
| `htmx:after:sse:message`     | After SSE message processed        |
| `htmx:before:sse:reconnect`  | Before SSE reconnect               |
| `htmx:confirm`               | Confirmation (can override)        |
| `htmx:error`                 | Request error                      |
| `htmx:finally:request`       | Always fires after request         |
| `htmx:abort`                 | Request aborted                    |

### Response Headers

| Header                    | Purpose                    |
|---------------------------|----------------------------|
| `HX-Trigger`              | Trigger event(s) on client |
| `HX-Trigger-After-Swap`   | Trigger after swap         |
| `HX-Trigger-After-Settle` | Trigger after settle       |
| `HX-Redirect`             | Client-side redirect       |
| `HX-Refresh`              | Full page refresh          |
| `HX-Location`             | Navigate with htmx         |
| `HX-Push-Url`             | Push URL to history        |
| `HX-Replace-Url`          | Replace URL in history     |
| `HX-Reswap`               | Override swap method       |
| `HX-Retarget`             | Override target            |
| `HX-Reselect`             | Override select            |

### Request Headers

| Header                       | Value                     |
|------------------------------|---------------------------|
| `HX-Request`                 | "true"                    |
| `HX-Boosted`                 | "true" if boosted         |
| `HX-Source`                  | Source element identifier |
| `HX-Target`                  | Target element identifier |
| `HX-Current-URL`             | Current page URL          |
| `HX-Request-Type`            | "full" or "partial"       |
| `HX-History-Restore-Request` | "true" on history restore |

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
- `htmx.onLoad()` — use `htmx.on('htmx:after:init', ...)`
- `htmx.parseInterval()` — extensions can implement
- `htmx.timeout()` — use `new Promise(r => setTimeout(r, ms))`
- `htmx.forEvent()` — extensions can implement

**Compat aliases** (via compat extension):
- `htmx.ajax` → `htmx.fetch`
- `htmx.trigger` → `htmx.emit`
- `htmx.process` → `htmx.init`
- `htmx.registerExtension` → `htmx.register`

### Internal Methods

| Method                       | Signature                                               | Purpose                                 |
|------------------------------|---------------------------------------------------------|-----------------------------------------|
| `__initHtmxConfig`           | `()`                                                    | Parse `<meta>` config, set defaults     |
| `__initRequestIndicatorCss`  | `()`                                                    | Inject indicator stylesheet             |
| `__attributeValue`           | `(el, name, default, collector)`                        | Read attribute with inheritance         |
| `__parseConfig`              | `(str)`                                                 | Parse config string to object           |
| `__mergeConfig`              | `(str, target)`                                         | Merge config string into target         |
| `__parseTriggerSpecs`        | `(spec)`                                                | Parse `hx-trigger` value to spec array  |
| `__determineMethodAndAction` | `(el, evt)`                                             | Resolve HTTP method + URL from element  |
| `__createRequestContext`     | `(el, evt)`                                             | Build request context object            |
| `__handleTriggerEvent`       | `(ctx)`                                                 | Process trigger → issue request         |
| `__issueRequest`             | `(ctx)`                                                 | Execute fetch, handle response          |
| `__handleSSE`                | `(ctx, el, response)`                                   | Handle SSE streaming response           |
| `__parseSSE`                 | `(response)`                                            | Parse SSE event stream                  |
| `__makeFragment`             | `(text)`                                                | Parse HTML string to DocumentFragment   |
| `__parseSwapSpec`            | `(str)`                                                 | Parse `hx-swap` value to spec           |
| `__insertContent`            | `(task, cssTransition)`                                 | Execute single swap task                |
| `__processOOB`               | `(fragment, sourceEl, selectOOB)`                       | Process out-of-band swaps               |
| `__morph`                    | `(oldNode, fragment, innerHTML)`                        | DOM diffing entry point                 |
| `__morphChildren`            | `(ctx, oldParent, newParent, insertionPoint, endPoint)` | Recursive child morphing                |
| `__findBestMatch`            | `(ctx, node, startPoint, endPoint)`                     | Find best morph match                   |
| `__handleHistoryUpdate`      | `(ctx)`                                                 | Push/replace history state              |
| `__showIndicators`           | `(el)`                                                  | Show request indicators                 |
| `__hideIndicators`           | `(indicators)`                                          | Hide request indicators                 |
| `__disableElements`          | `(el)`                                                  | Disable elements during request         |
| `__enableElements`           | `(elements)`                                            | Re-enable elements after request        |
| `__collectFormData`          | `(el, form, submitter, validate)`                       | Collect form inputs for request         |
| `__findExt`                  | `(el, selector, thisAttr)`                              | Find element with extended selectors    |
| `__findAllExt`               | `(el, selector, thisAttr, global)`                      | Find all with extended selectors        |
| `__cleanup`                  | `(el)`                                                  | Remove listeners, state, abort requests |

---

## Proposed Architecture

### Three Layers

- **Layer 3 — High-Level API:** User-facing public methods. TBD.
- **Layer 2 — Behaviors:** Orchestration, parsing, queue management. TBD.
- **Layer 1 — Kernel:** `emit()`, `register()`, `wrap()`, `state`, `config`. Minimal core.

### Event Model (before/after pairs)

The kernel emits explicit `htmx:before:X` and `htmx:after:X` pairs. Extensions always use the explicit form. DOM users get shorthands via `hx-on` (see ADR-017).

| Event                         | When                               | Can Do         | Fires On       | Detail                                   |
|-------------------------------|------------------------------------|----------------|----------------|------------------------------------------|
| **System**                    |                                    |                |                |                                          |
| `htmx:ready`                  | Library boots                      | —              | `document`     | `{}`                                     |
| **Element lifecycle**         |                                    |                |                |                                          |
| `htmx:before:init`            | Before parsing/binding             | Cancel, Modify | element        | `{ element, root }`                      |
| `htmx:after:init`             | After element fully initialized    | Observe        | element        | `{ element, root }`                      |
| `htmx:before:cleanup`         | Before element loses htmx behavior | Cancel         | element        | `{ element }`                            |
| `htmx:after:cleanup`          | After cleanup complete             | Observe        | element        | `{ element }`                            |
| **Request lifecycle**         |                                    |                |                |                                          |
| `htmx:before:trigger`         | Before trigger fires               | Cancel         | source element | `{ source }`                             |
| `htmx:after:trigger`          | After trigger fired                | Observe        | source element | `{ source }`                             |
| `htmx:before:request`         | Before fetch                       | Cancel, Modify | source element | `{ source, request }`                    |
| `htmx:after:request`          | After fetch completes              | Observe        | source element | `{ source, request }`                    |
| `htmx:before:response`        | Before reading response body       | Cancel         | source element | `{ source, request, response }`          |
| `htmx:after:response`         | After response body read           | Modify         | source element | `{ source, request, response }`          |
| `htmx:before:swap`            | Before DOM mutation                | Cancel, Modify | source element | `{ source, request, response, swap }`    |
| `htmx:after:swap`             | After DOM mutation                 | Observe        | source element | `{ source, request, response, swap }`    |
| `htmx:before:settle`          | Before CSS settle phase            | Cancel         | source element | `{ source, request, response, swap }`    |
| `htmx:after:settle`           | After CSS settle complete          | Observe        | source element | `{ source, request, response, swap }`    |
| `htmx:error`                  | On error (no pair needed)          | Cancel         | source element | `{ source, request?, response?, error }` |
| `htmx:done`                   | Finally block (no pair needed)     | Observe        | source element | `{ source, request, response, error? }`  |
| **History**                   |                                    |                |                     |                                           |
| `htmx:before:history:push`    | Before URL push                    | Cancel         | trigger element     | —                                         |
| `htmx:after:history:push`     | After URL pushed                   | Observe        | trigger element     | —                                         |
| `htmx:before:history:replace` | Before URL replace                 | Cancel         | trigger element     | —                                         |
| `htmx:after:history:replace`  | After URL replaced                 | Observe        | trigger element     | —                                         |
| `htmx:before:history:restore` | Before state restore               | Cancel         | trigger element     | —                                         |
| `htmx:after:history:restore`  | After state restored               | Observe        | trigger element     | —                                         |
| **SSE**                       |                                    |                |                     |                                           |
| `htmx:sse:open`               | Connection established             | Observe        | trigger element     | —                                         |
| `htmx:sse:message`            | Message received                   | Cancel, Modify | trigger element     | —                                         |
| `htmx:sse:close`              | Connection closed                  | Observe        | trigger element     | —                                         |
| `htmx:sse:error`              | Connection error                   | Cancel         | trigger element     | —                                         |
| **WebSocket**                 |                                    |                |                     |                                           |
| `htmx:ws:open`                | Connection established             | Observe        | trigger element     | —                                         |
| `htmx:ws:message`             | Message received                   | Cancel, Modify | trigger element     | —                                         |
| `htmx:ws:close`               | Connection closed                  | Observe        | trigger element     | —                                         |
| `htmx:ws:send`                | Before sending message             | Cancel, Modify | trigger element     | —                                         |
| `htmx:ws:error`               | Connection error                   | Cancel         | trigger element     | —                                         |

**Notes:**
- `htmx:error` and `htmx:done` have no pairs — they're terminal events
- SSE/WebSocket events don't use before/after — they're already named by state
- Detail accumulates through request lifecycle: `source` → `+request` → `+response` → `+swap`
- `source` = `{ element, event }` — what initiated the request. See ADR-022 for naming rationale.

### Detail Fields

- `element` = wrapped element (used in init/cleanup events)
- `root` = element passed to `htmx.init()` (check `e.target === e.detail.root` for subtree completion)
- `source` = `{ element, event }` — what initiated the request (element is wrapped). See ADR-022.
- `request` = `{ url, method, headers, body }` — outgoing request
- `response` = `{ status, url, headers, text }` — server response
- `swap` = `{ content, target, method }` — the DOM mutation: what content, where, how (target is wrapped)
- `error` = `{ type, message, cause? }` — type: `'network'`, `'timeout'`, `'abort'`, `'swap'`, `'target'`, etc.

Extensions can attach fields to the detail for cross-phase state. Per-element state via `element.state`.

### Wrapped Elements

Elements in event detail are wrapped Proxies. Methods:

| Method                 | Returns         | Purpose                                                    |
|------------------------|-----------------|------------------------------------------------------------|
| `.attr(name)`          | `string\|null`  | Read attribute (with inheritance)                          |
| `.find(selector)`      | `wrapped\|null` | `querySelector`, wrapped                                   |
| `.findAll(selector)`   | `wrapped[]`     | `querySelectorAll`, wrapped                                |
| `.emit(event, detail)` | `boolean`       | Dispatch event on element                                  |
| `.state`               | `object`        | Auto-vivifying per-element state (namespaced by extension) |
| `.native`              | `Element`       | Unwrap to raw DOM element                                  |

Static equivalents: `htmx.attr(el, name)`, `htmx.find(el, sel)`, `htmx.findAll(el, sel)`, `htmx.emit(el, evt, detail)`, `htmx.state(el)`.

### Layer 3: High-Level API

TBD. See Parking Lot for chainable API concept.

### Layer 1: Kernel

**Config shape:** (See ADR-023 for full rationale)

| Path                  | Default                    | Purpose                                        |
|-----------------------|----------------------------|------------------------------------------------|
| `trigger.event`       | `'click'`                  | Default trigger event                          |
| `trigger.delay`       | `0`                        | Default delay (ms)                             |
| `trigger.throttle`    | `0`                        | Default throttle (ms)                          |
| `trigger.registry`    | `{ load, revealed, ... }`  | Non-DOM trigger handlers                       |
| `request.timeout`     | `60000`                    | Request timeout (ms)                           |
| `request.credentials` | `'same-origin'`            | Fetch credentials mode                         |
| `request.mode`        | `'same-origin'`            | Fetch mode                                     |
| `request.headers`     | `{ 'HX-Request': ... }`    | Static strings or functions (dynamic headers)  |
| `swap.method`         | `'innerHTML'`              | Default swap style                             |
| `swap.target`         | `'this'`                   | Default target                                 |
| `swap.settle`         | `20`                       | Default settle delay (ms)                      |
| `swap.transition`     | `false`                    | Default view transition                        |
| `swap.registry`       | `{ innerHTML, ... }`       | Swap method implementations                    |
| `syntax.prefix`       | `'hx-'`                    | Attribute prefix                               |
| `syntax.delimiter`    | `':'`                      | Modifier delimiter                             |
| `syntax.format`       | `RelaxedJSON`              | Attribute value parser                         |

Extensions own their config namespaces via `htmx:ready` convention (see ADR-010).

**Kernel API:**

| Function   | Signature                                 | Purpose                                                                  |
|------------|-------------------------------------------|--------------------------------------------------------------------------|
| `emit`     | `(element, eventName, detail?) → boolean` | Call extension handlers, dispatch DOM event. Returns false if cancelled. |
| `register` | `(name, { requires?, on }) → void`        | Register extension. Throws on duplicate or missing dependency.           |
| `wrap`     | `(element) → Proxy`                       | Wrap element with convenience methods.                                   |
| `state`    | WeakMap-backed                            | Per-element state. Auto-vivifying namespaces via Proxy.                  |

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

Extensions hook into lifecycle events via `on` handlers. They can also customize API functions by reassigning `htmx.*` in `htmx:ready` handlers (see ADR-034).

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
- Late registration: if `htmx:ready` already fired, extension's `htmx:before:init` called immediately for existing elements
- Duplicate names throw

### Built-in Extensions

Core htmx behaviors are implemented as extensions. This dogfoods the extension system, lets users disable/replace core behaviors, and ensures core and external extensions use identical APIs.

| Extension          | Events                                                    | Purpose                                                      |
|--------------------|-----------------------------------------------------------|--------------------------------------------------------------|
| **Init phase**     |                                                           |                                                              |
| `defaultTriggers`  | `ready`, `before:init`                                    | Assign default trigger events (click/change/submit)          |
| `hx-boost`         | `before:init`                                             | Intercept links/forms, add htmx behavior                     |
| `hx-on`            | `after:init`, `before:cleanup`                            | Bind/unbind `hx-on:*` event handlers, map DOM shorthands     |
| **Trigger phase**  |                                                           |                                                              |
| `intersect`        | `before:init`, `before:cleanup`                           | Normalize + setup IntersectionObserver (revealed, intersect) |
| `polling`          | `before:init`, `before:cleanup`                           | Normalize `every Xs` → standard syntax, setup interval       |
| `load`             | `before:init`                                             | Normalize `load` trigger, fire immediately                   |
| **Request phase**  |                                                           |                                                              |
| `hx-confirm`       | `before:request`                                          | Show confirmation dialog, cancel if declined                 |
| `hx-headers`       | `before:request`                                          | Add headers from `hx-headers` attribute                      |
| `hx-validate`      | `before:request`                                          | Form validation via `reportValidity()`                       |
| `hx-encoding`      | `before:request`                                          | Multipart/form-data encoding                                 |
| `formData`         | `before:request`                                          | Collect form data from trigger element or enclosing form     |
| `dynamicHeaders`   | `before:request`                                          | Add HX-Current-URL, HX-Target, HX-Source, etc.               |
| `jsEval`           | `ready`, `before:request`                                 | Evaluate `js:`/`javascript:` prefixes in hx-vals, hx-headers |
| `hx-vals`          | `before:request`                                          | Add values from `hx-vals` to request body                    |
| `hx-include`       | `before:request`                                          | Include additional inputs in request                         |
| `hx-indicator`     | `before:request`, `done`                                  | Show/hide loading indicators                                 |
| `hx-disable`       | `before:request`, `done`                                  | Disable/re-enable elements during request                    |
| `hx-sync`          | `before:init`, `before:request`, `done`, `before:cleanup` | Request queue strategies (drop, abort, replace, queue)       |
| `timeout`          | `ready`, `before:request`, `done`                         | Abort requests exceeding timeout                             |
| `etag`             | `before:request`, `after:request`                         | ETag caching (If-None-Match)                                 |
| **Response phase** |                                                           |                                                              |
| `noSwap`           | `ready`, `after:request`                                  | Skip swap for 204/304 responses                              |
| `responseHeaders`  | `after:request`, `before:swap`                            | Handle HX-Trigger, HX-Redirect, HX-Retarget, etc.            |
| `hx-status`        | `before:swap`                                             | Route to alternate targets by status code                    |
| `sse`              | `ready`, `after:request`                                  | Handle text/event-stream responses                           |
| `fullDocParsing`   | `after:request`                                           | Extract body/head from full HTML documents                   |
| **Swap phase**     |                                                           |                                                              |
| `select`           | `before:swap`                                             | Filter response by `hx-select`                               |
| `oob`              | `before:swap`                                             | Process `hx-select-oob` and `hx-swap-oob` (requires: select) |
| `hx-preserve`      | `before:swap`                                             | Preserve elements across swaps (moveBefore/pantry)           |
| `morph`            | `ready`, `before:swap`                                    | DOM diffing for innerMorph/outerMorph swap styles            |
| `partials`         | `before:swap`                                             | Process `<template hx-type="partial">` in response           |
| **Settle phase**   |                                                           |                                                              |
| `executeScripts`   | `after:settle`                                            | Execute `<script>` tags in swapped content                   |
| `autofocus`        | `after:settle`                                            | Focus first `[autofocus]` in swapped content                 |
| `anchorScroll`     | `after:settle`                                            | Scroll to hash fragment from response URL                    |
| `cssTransitions`   | `ready`, `swap`, `settle`                                 | htmx-swapping/htmx-settling/htmx-added CSS classes           |
| `viewTransitions`  | `ready`, `before:swap`                                    | View Transitions API integration                             |
| **Done phase**     |                                                           |                                                              |
| `title`            | `done`                                                    | Update document.title from response                          |
| `history`          | `ready`, `before:request`, `done`                         | Push/replace history state                                   |
| **Ready phase**    |                                                           |                                                              |
| `injectStyles`     | `ready`                                                   | Inject indicator CSS                                         |
| `compat`           | `ready`                                                   | Backwards-compat aliases (ajax→fetch, etc.)                  |

---

## Decisions (Historical)

> **These ADRs are historical.** They document the thinking process, not the final state. Many were superseded, some were partially implemented then reworked, and some were accepted in theory but the code went a different direction. If an ADR contradicts the code, the code wins.

### 001: Simplified Event Model — *Superseded by ADR-014*

---

### 002: No Abbreviated Parameter Names
**Date:** 2026-02-03 | **Status:** Accepted

**Context:** Codebase littered with `el`, `evt`, `ctx`, `s`. Hard to read, inconsistent, requires mental translation.

**Decision:** Full names in function signatures: `element`, `event`, `spec`, `data`. Abbreviations acceptable only in tight loops (`for (const el of elements)`).

**Consequences:** Slightly more typing. Much easier to read and grep. Self-documenting code.

---

### 003: No Context Object
**Date:** 2026-02-03 | **Status:** Accepted

**Context:** The `ctx` pattern passes one big mutable object through every function. Unclear what's available at each phase, easy to accidentally mutate, hard to trace data flow.

**Decision:** Phase-specific detail objects with clear shapes. Each event receives only what it needs. Detail accumulates predictably: `request` → `request + response` → `request + response + swap`.

**Consequences:** More explicit function signatures. Harder to "sneak" data through. Forces clear thinking about what each phase needs.

---

### 004: Incremental Event Detail
**Date:** 2026-02-03 | **Status:** Accepted

**Context:** Event handlers need access to request/response/swap data, but not all data exists at all phases.

**Decision:** Each phase contributes its piece to the detail object:
- `htmx:request` → `{ trigger, request }`
- `htmx:response` → `{ trigger, request, response }`
- `htmx:swap` → `{ trigger, request, response, swap }`
- `htmx:done` → `{ trigger, request, response, swap, error? }`

**Consequences:** Predictable. Handlers destructure exactly what they need. No guessing what's available.

---

### 005: WeakMap for Element State
**Date:** 2026-02-03 | **Status:** Accepted

**Context:** Current htmx stores state on `element._htmx`. Pollutes DOM elements, can leak if elements removed without cleanup.

**Decision:** Use WeakMap keyed by element. State automatically garbage collected when element is removed.

**Consequences:** Cleaner elements. No property conflicts. Requires explicit state access via `state.get(element)`.

---

### 006: Wrapped Elements in Event Handlers
**Date:** 2026-02-03 | **Status:** Accepted

**Context:** Event handlers often need to read attributes, query children, emit events. Raw DOM API is verbose.

**Decision:** Elements in event detail are wrapped in a Proxy providing convenience methods: `.attr()`, `.find()`, `.findAll()`, `.emit()`, `.state`, `.native`. Static equivalents: `htmx.attr(element, ...)`, `htmx.find(element, ...)`, `htmx.findAll(element, ...)`, `htmx.emit(element, ...)`, `htmx.state(element)`.

**Consequences:** Cleaner handler code. Slight overhead from Proxy. Access raw element via `.native` when needed.

---

### 007: JIT Attribute Reading
**Date:** 2026-02-03 | **Status:** Accepted

**Context:** Should attributes be read at activation time or trigger time? Reading at activation time means dynamic changes don't take effect.

**Decision:** Read attributes at trigger time (JIT). Activation only sets up the event listener.

**Consequences:** Dynamic attribute changes work. Slightly more work per trigger. More flexible.

---

### 008: Events-Only Extension System
**Date:** 2026-02-03 | **Status:** Accepted

**Context:** Extensions need to hook into htmx lifecycle and modify behavior. Considered `override` pattern (wrapping kernel functions) but rejected it—creates hard-to-debug chains, leaks internal signatures as API, order-dependent behavior.

**Decision:** Extensions use only `on` event handlers. No `override`, no registries. Custom behaviors (swap styles, triggers, etc.) are handled by listening to events and returning `false` to prevent defaults.

**Rejected alternatives:**

| Pattern                                   | Why Rejected                                                               |
|-------------------------------------------|----------------------------------------------------------------------------|
| Hook types (Sync, Bail, Waterfall, Async) | Tapable complexity for Webpack's needs, not ours. `return false` suffices. |
| Plugin priority numbers                   | Implicit ordering games. Registration order + `requires` is simpler.       |
| Override/wrapping system                  | Hard to debug, leaks internal signatures as API, order-dependent.          |
| Registries (swapStyles, triggers)         | Unnecessary indirection. Events handle custom swap styles and triggers.    |

**Consequences:** Simpler mental model. Extensions can't break each other via wrapping chains. All extension points are explicit lifecycle events. Slightly more verbose for some use cases but much more predictable. Hyrum's Law applies: every kernel function exposed to extensions becomes permanent API — keep the surface minimal (`register`, `emit`, `wrap`).

---

### 009: DOM Processing Naming — *Superseded by ADR-014*

---

### 010: Extension Config via htmx:init Convention
**Date:** 2026-02-03 | **Status:** Accepted

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
**Date:** 2026-02-03 | **Status:** Accepted

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
**Date:** 2026-02-03 | **Status:** Accepted

**Context:** Explored whether the "UNIX file" primitive for htmx should be the attribute (user-facing interface) or the hypermedia fragment (data flowing through the system). The attribute is the shell command; the fragment is the file descriptor.

**Decision:** The fragment is the core data primitive. A fragment is a unit of DOM mutation: `{ content, target, method }`. It doesn't exist at request time — it emerges when the response is parsed. One response can produce multiple fragments (main swap + OOB). The event detail object flows as a single object through the lifecycle, and the `swap` field IS the fragment.

The pipeline model maps directly onto the event system — events are named checkpoints, the detail is the data flowing through. No new abstraction needed beyond treating the detail object as a first-class pipeline datum.

**Consequences:** Cleaner mental model for non-HTTP sources (WebSocket message → fragment → same swap pipeline). OOB is just "one response produced multiple fragments." Indicators/confirm/sync are request-lifecycle concerns, not fragment concerns — they operate before any fragment exists.

---

### 013: Event Naming — *Superseded by ADR-014*

---

### 014: Pragmatic Event Timing — No Mandatory Pairs — *Superseded by ADR-017*

---

### 015: Public API — Modern Naming, Minimal Surface
**Date:** 2026-02-03 | **Status:** Accepted

**Context:** htmx 2.0 API has legacy names (`ajax`, `trigger`) and utility functions that duplicate browser APIs (`find`, `findAll`). Need to modernize for 4.0 while keeping API surface minimal.

**Decision:**

```js
htmx.config                              // Configuration object
htmx.init(element)                       // Initialize subtree
htmx.fetch(url, options)                 // Programmatic request
htmx.on(element, event, handler)         // Bind listener, returns off()
htmx.emit(element, event, detail)        // Dispatch event
htmx.register(name, extension)           // Register extension
```

Naming changes:
- `htmx.ajax()` → `htmx.fetch()` — modern terminology, "ajax" is 2005
- `htmx.trigger()` → `htmx.emit()` — avoids collision with `htmx:trigger` event, matches EventEmitter convention
- `htmx.registerExtension()` → `htmx.register()` — shorter, cleaner
- `htmx.process()` → `htmx.init()` — clearer intent

Removed:
- `htmx.find()` / `htmx.findAll()` — use `document.querySelector`
- `htmx.takeClass()` — too niche
- `htmx.onLoad()` — use `htmx.on('htmx:after:init', ...)`
- `htmx.parseInterval()` / `htmx.timeout()` / `htmx.forEvent()` — trivial utilities, extensions can implement

**Consequences:**
- 6 public methods total (down from 13+)
- Modern naming that doesn't feel dated
- No collision between `htmx.emit()` method and `htmx:trigger` event
- Compat extension provides aliases for migration

---

### 016: Modern JavaScript APIs
**Date:** 2026-02-04 | **Status:** Accepted

**Context:** htmx 2.0 supported IE11 until recently, which prevented use of modern browser APIs. htmx 4.0 drops IE11 support. Several patterns in the codebase can be simplified using APIs that landed in browsers 2020-2023.

**Decision:** Prefer native browser APIs over manual implementations:

| Pattern             | Old Approach                                                      | Modern API                                       |
|---------------------|-------------------------------------------------------------------|--------------------------------------------------|
| Once-only listeners | Manual wrapper: `let f; return e => { if (!f) { f = 1; fn(e) } }` | `addEventListener(event, handler, {once: true})` |

**Consequences:**
- Simpler, less code
- Native `{once: true}` auto-removes listener (less cleanup work)
- Browser baseline: ES2020+ (Chrome 80+, Firefox 75+, Safari 14+)

---

### 017: Before/After Event Pairs with DOM Shorthands
**Date:** 2026-02-04 | **Status:** Accepted

**Context:** ADR-014 tried to simplify events by picking "the most useful time" for each event. But this caused problems:
- Extensions need `htmx:before:init` to normalize exotic attribute syntax (e.g., `"every 2s"` → standard format) before the kernel parses
- No way to hook in before parsing without adding ad-hoc events like `htmx:normalize`
- The "pragmatic timing" approach doesn't scale — different extensions need different timings

**Decision:** Restore explicit `htmx:before:X` / `htmx:after:X` pairs. The kernel emits both. Extensions always use the explicit form.

For DOM convenience, `hx-on` maps shorthands to pragmatic defaults:

| Shorthand       | Maps To                  | Rationale                                    |
|-----------------|--------------------------|----------------------------------------------|
| `hx-on::init`   | `htmx:before:init`       | Normalize attributes before parsing          |
| `hx-on::cleanup`| `htmx:before:cleanup`    | Save state before teardown                   |
| `hx-on::trigger`| `htmx:after:trigger`     | React to trigger firing                      |
| `hx-on::request`| `htmx:before:request`    | Modify/cancel before fetch                   |
| `hx-on::response`| `htmx:after:request`    | React to response                            |
| `hx-on::swap`   | `htmx:before:swap`       | Modify/cancel before DOM mutation            |
| `hx-on::settle` | `htmx:after:settle`      | React after CSS transitions complete         |
| `hx-on::error`  | `htmx:error`             | No pair needed                               |
| `hx-on::done`   | `htmx:done`              | No pair needed                               |

The mapping lives in the `hx-on` extension, not the kernel. Users writing `hx-on::init` don't know or care about the underlying event name.

**Consequences:**
- Full extensibility — extensions can hook before or after any phase
- Clean DOM syntax — users write `hx-on::init`, not `hx-on::before:init`
- No ambiguity for extension authors — always use explicit `before:`/`after:`
- Solves the exotic trigger problem (`"every 2s"`, `"intersect"`, custom swap methods)
- More events than ADR-014, but predictable and symmetric

---

### 018: Event Listener API — `htmx.on()` and `element.on()`
**Date:** 2026-02-04 | **Status:** Accepted

**Context:** Need a clean way to bind event listeners that:
- Tracks listeners automatically for cleanup
- Works at both `htmx.on(element, event, handler)` and `element.on(event, handler)` levels
- Returns something useful

**Decision:**

```js
// Static API
const off = htmx.on(element, event, handler, options?)

// Wrapped element shorthand (calls htmx.on internally)
const off = element.on(event, handler, options?)
```

Key behaviors:
- Returns cleanup function (`off()` removes the listener)
- Automatically tracks in `element.state["cleanup"]` for cleanup
- Cleanup iterates `element.state["cleanup"]` and calls each `off()`
- Use "handler" terminology consistently (not "callback" or "listener")

**Why return cleanup function:**
- Modern pattern (React `useEffect`, `AbortController`)
- More useful than returning the handler
- Enables: `const off = element.on('click', h); /* later */ off()`

**State convention:** Use bracket notation `element.state["cleanup"]`, `element.state["sync"]` to visually distinguish the stable `state` object from dynamic keys inside it.

**Consequences:**
- Single API for binding with automatic cleanup tracking
- Extensions use `element.on()` instead of raw `addEventListener`
- Cleanup is trivial: iterate and call each stored `off()`
- Resolves the `htmx.on` collision question — signature is `(element, event, handler)`

---

### 019: Inline Attribute Normalization
**Date:** 2026-02-04 | **Status:** Accepted

**Context:** Some htmx attributes have "exotic" syntax that doesn't fit the standard `"value mod:x mod:y"` parser format:

- `hx-trigger="every 2s"` — space-separated, not colon-separated
- `hx-sync="closest form:drop"` — colon means strategy, not modifier

Options considered:
1. **Schema/vocabulary system** — parser knows attribute semantics, too complex
2. **Pre-processor registry** — extensions register normalizers, over-engineered
3. **Inline normalization** — transform exotic syntax before parsing, at call site

**Decision:** Normalize exotic syntax inline, at the call site, with clear before→after comments:

```js
// Normalize: "every 2s" → "every interval:2s"
const triggerRaw = element.attr('hx-trigger')
const triggerNormalized = triggerRaw?.replace(/^every\s+(\d+(?:ms|s|m)?)/, 'every interval:$1')
const {value, ...modifiers} = parse(triggerNormalized)

// Normalize: "closest form:drop" → "closest form strategy:drop"
const syncRaw = element.attr('hx-sync')
const syncNormalized = syncRaw?.replace(/:(?=drop|abort|replace|queue)/, ' strategy:')
const {value: target, strategy} = parse(syncNormalized)
```

**Consequences:**
- No parser complexity — parser stays generic
- Transformations are visible and greppable
- Each exotic attribute documents its own normalization
- Extensions needing exotic syntax do the same pattern
- Trade-off: slightly verbose, but explicit > implicit

---

### 020: State Management and Initialization Tracking
**Date:** 2026-02-04 | **Status:** Accepted

**Context:** Need to track per-element state (cleanup functions, config overrides, etc.) and detect whether an element has been initialized. Previous approach used `data-htmx-initialized` attribute for both tracking and DOM visibility.

**Decision:**

1. **WeakMap for state**, simple naming:
```js
const _state = new WeakMap()

function state(element) {
    let s = _state.get(element)
    if (!s) {
        s = {}
        _state.set(element, s)
    }
    return s
}
```

2. **Initialization check** uses WeakMap presence:
```js
if (_state.has(node)) continue
```

3. **DOM marker** is a separate registered extension:
```js
register('dom-marker', {
    on: {
        'htmx:after:init': ({element}) => {
            element.native.toggleAttribute('data-htmx', true)
        },
        'htmx:after:cleanup': ({element}) => {
            element.native.removeAttribute('data-htmx')
        }
    }
})
```

Usage reads naturally:
```js
state(node)["cleanup"] = []
state(node)["cleanup"].push(off)
```

**Consequences:**
- Cleaner naming: `state(element)` instead of `getOrCreateState(element)`
- Separation of concerns: init tracking (WeakMap) vs DOM visibility (extension)
- Shorter DOM marker: `data-htmx` instead of `data-htmx-initialized`
- DOM marker is optional (extension can be excluded)

---

### 021: Descendant Cleanup via Tree Walk
**Date:** 2026-02-04 | **Status:** Accepted (pending perf validation)

**Context:** MutationObserver only reports top-level removed nodes, not descendants. We need to clean up all initialized descendants (intervals, observers, extension state like `hx-sync` queues).

**Decision:** Walk the removed subtree, check each element:

```js
removed.forEach(node => {
    cleanup(node)
    node.querySelectorAll('*').forEach(el => {
        if (_state.has(el)) cleanup(el)
    })
})
```

**Rejected: Self-cleaning** (intervals check `isConnected` each tick) — adds overhead to every tick, holds references preventing GC, hides bugs.

**Performance:** `querySelectorAll('*')` is O(subtree), `_state.has()` is O(1). Real cost is `cleanup()` calls (2 events each). Likely fine, but needs benchmarking with 100-1000 element removals.

---

### 022: `source` vs `trigger` — Naming Clarity
**Date:** 2026-02-05 | **Status:** Accepted

**Context:** The word "trigger" is overloaded:
- `config.trigger` — configures the trigger system (event defaults, registry, modifiers)
- `detail.trigger` — what initiated a request (element + event)

This creates confusion: `config.trigger.event` (default trigger event) vs `detail.trigger.event` (the DOM event that fired).

**Decision:** Use `source` for the "what initiated this request" concept in event details:

```js
// Config: trigger system configuration
config.trigger.event      // 'click'
config.trigger.registry   // { load, revealed, intersect, every }

// Event detail: what initiated the request
detail.source.element     // wrapped element that triggered the request
detail.source.event       // DOM event that fired
```

All lifecycle events use `source` consistently:
- `htmx:before:trigger` → `{ source: { element, event } }`
- `htmx:before:request` → `{ source, request }`
- `htmx:after:request` → `{ source, request, response }`
- `htmx:before:swap` → `{ source, request, response, swap }`
- `htmx:done` → `{ source, request, response, swap, error? }`

Dynamic header functions receive `{ source, url, method }` as context.

**Consequences:**
- Clear distinction: `config.trigger` = system config, `detail.source` = request origin
- Consistent detail shape across all lifecycle events
- Extension authors always destructure `{ source }` for request lifecycle events
- `htmx.fetch()` accepts `source: { element, event }` option

---

### 023: Config Structure — Pipeline Order with Registries
**Date:** 2026-02-05 | **Status:** Accepted

**Context:** The kernel config needs to be minimal, extensible, and ordered logically. Registries (swap methods, trigger handlers) need to coexist with scalar defaults.

**Decision:** Config ordered by pipeline flow: `trigger → request → swap → syntax`. Each namespace has scalar defaults + optional `registry` for extensible implementations.

```js
config = {
    trigger: {
        event: 'click',           // default trigger event
        delay: 0,                 // default delay (ms)
        throttle: 0,              // default throttle (ms)
        // Registry: non-DOM triggers. Anything not here is a DOM event name.
        registry: { load, revealed, intersect, every },
    },
    request: {
        timeout: 60000,
        credentials: 'same-origin',
        mode: 'same-origin',
        // Static strings or functions. Functions called with { source, url, method }.
        headers: {
            'HX-Request': 'true',
            'HX-Current-URL': () => location.href,
        },
    },
    swap: {
        method: 'innerHTML',      // default swap method
        target: 'this',           // default swap target
        settle: 20,               // default settle delay (ms)
        transition: false,        // default view transition
        // Registry: swap methods. fn(target, content).
        registry: { innerHTML, outerHTML, textContent, beforebegin, afterbegin, beforeend, afterend, delete, none },
    },
    syntax: {
        prefix: 'hx-',
        delimiter: ':',
        format: RelaxedJSON,
    },
}
```

**Key decisions:**
- `trigger.event` is the scalar default, `trigger.registry` holds non-DOM trigger handlers
- `swap.method` is the scalar default, `swap.registry` holds swap method implementations
- `request.headers` supports functions for dynamic headers (evaluated before `htmx:before:request`)
- Features like `history`, `sync`, `sse` register their own config namespaces via `htmx:ready`

**Consequences:**
- Minimal kernel config — only what the kernel needs
- Extensible — features add their namespaces at runtime
- Consistent pattern — scalar defaults + registry where needed
- Dynamic headers built into kernel — no separate extension needed

---

### 024: htmx Core, Not Kernel
**Date:** 2026-02-06 | **Status:** Accepted

**Context:** Early design called this a "kernel" — implying an abstract, minimal core that could power different hypermedia libraries. But that's not what we're building.

**Decision:** This is **htmx core**, not a kernel.

**Baked in (this IS htmx):**
- The lifecycle: init → trigger → request → response → swap → settle
- Trigger syntax: `click delay:500ms`, `keyup[key=='Enter']`, `every 2s`
- Attribute inheritance
- The `hx-*` convention

**Extensible (customization points):**
- Swap methods via `registry.swaps`
- Synthetic triggers via `registry.triggers`
- Trigger modifiers via `registry.modifiers.trigger`
- Request headers via `config.requestHeaders`

**Escape hatches (for environment constraints):**
- `syntaxPrefix` — when `hx-*` conflicts with server-side templating
- `syntaxDelimiter` — same

The difference from a "kernel" is intent. A kernel would be abstract; htmx core owns the htmx semantics. Extensions add capabilities to htmx, they don't define htmx from scratch.

**Consequences:**
- File is `htmx.core.js`, will become `htmx.js`
- No pretense of abstraction
- Trigger parsing, attribute syntax are baked in, not pluggable
- Escape hatches documented as "if you have problems, use these" not as features

---

### 025: Config Structure — Everything on `config`
**Date:** 2026-02-06 | **Status:** Accepted (partially superseded by ADR-027, ADR-029)

**Context:** ADR-023 used nested config (`config.trigger.event`, `config.swap.method`). ADR-025 initially proposed a separate `registry` object. Both caused confusion — too many objects, unclear where to look for things.

**Decision:** Everything lives on `config`. No separate `registry`. Registries are just objects on config alongside scalar defaults.

```js
config = {
    // Per-element defaults (correspond to hx-* attributes)
    defaultTrigger: node => ...,       // fn or string
    defaultSwap: 'innerHTML',
    defaultTarget: 'this',

    // Request defaults (grouped — these always travel together)
    defaultRequest: {
        timeout: 60000,
        credentials: 'same-origin',
        mode: 'same-origin',
        headers: {
            'HX-Request': 'true',
            'HX-Current-URL': () => location.href,
        },
    },

    // Registries (implementations, always functions)
    swaps: { innerHTML, outerHTML, beforebegin, ... },
    triggers: { event: fn(element, trigger, handler) → cleanup },
    triggerModifiers: {},              // name → fn(handler, value, element) → handler
    swapModifiers: {},                 // name → fn(options, value, element) → options

    // Escape hatches
    syntaxPrefix: 'hx-',
    syntaxDelimiter: ':',
    initSelectors: ['[hx-get]', '[hx-post]', '[hx-put]', '[hx-patch]', '[hx-delete]'],
}
```

**Naming conventions:**
- `default*` — per-element defaults that `hx-*` attributes override
- `defaultRequest` — nested object because request options always travel together
- Plurals — registries (`swaps`, `triggers`, `triggerModifiers`, `swapModifiers`)
- `syntax*` — escape hatches for environment constraints
- `initSelectors` — what elements to auto-initialize

**Trigger registry pattern** (see TODO in code):
- `config.triggers.event` handles DOM events (click, submit, keyup, etc.)
- Custom triggers register as `config.triggers.load`, `config.triggers.every`, etc.
- Lookup: `config.triggers[trigger.event] || config.triggers.event`
- This naming is awkward — `.event` does double duty as a trigger name AND the fallback. Needs revisiting.

**`applyModifiers` is per-trigger-type:**
- Modifiers (delay, throttle, etc.) are the trigger type's concern, not universal
- `config.triggers.event` calls `applyModifiers()` internally
- Custom trigger types opt in by calling `htmx.applyModifiers(handler, trigger, element)`

**Current file:** `src/htmx.core.js` (~490 lines)

**Consequences:**
- One object to look at: `htmx.config`
- `resolve()` exported for extensions to use same static-or-function pattern
- Extensions add to registries at `htmx:ready`
- Trigger registry fallback pattern needs polish (marked TODO)

---

### 026: Error Handling — `fail()` Closure with `detail.phase` Tracking
**Date:** 2026-02-10 | **Status:** Accepted

**Context:** The `request()` function had repetitive error handling: each failure needed to construct an error object, emit an event, and return. The catch block also needed to know which phase failed. There was no structured convention for error types.

**Decision:** Three changes:

1. **`fail()` closure** — defined inside `request()`, captures `detail` and `source` from closure scope. DRY error emission:
```js
const fail = (type, message, cause) => {
    detail.error = { type, message }
    if (cause) detail.error.cause = cause
    emit(source.element, 'htmx:error', detail)
}
```

2. **`detail.phase`** — tracks current lifecycle phase (`'request'`, `'response'`, `'swap'`, `'settle'`) directly on the event detail object. Updated as execution progresses. Available to extensions and error handlers.

3. **`phase:specific` error type convention** — error types use colon-separated `phase:reason` format:
   - `swap:target` — target element not found
   - `swap:method` — unknown swap method
   - `request:timeout` — request timed out (AbortError)
   - Bare phase name (e.g., `'response'`) for unspecified errors in catch block

**Consequences:**
- Errors are consistent and machine-parseable
- `detail.phase` gives extensions runtime context about where execution is
- Catch block uses `detail.phase` for automatic error typing — no manual tracking needed
- `fail()` closure keeps error handling DRY without introducing a helper class

---

### 027: Unified Registry Pattern — `default` Key with String Alias Resolution
**Date:** 2026-02-10 | **Status:** Accepted | **Supersedes:** Parts of ADR-025

**Context:** ADR-025 had separate `defaultSwap`, `defaultTrigger` scalars alongside `swaps` and `triggers` registries. This created asymmetry — two places to look for the same concept. We wanted the registries to be self-contained.

**Rejected alternatives:**
- `default: () => config.swaps.innerHTML` — arrow function returns the function instead of calling it, breaks swap lookup
- Getter on config — works but magical, hard to serialize for debugging
- Separate `defaultSwap`/`defaultTrigger` keys — asymmetric, two places to look

**Decision:** Both `config.swaps` and `config.triggers` have a `default` key. The value can be a string or a function (resolved via `resolve()`).

```js
config.swaps = {
    default: 'innerHTML',        // string → looked up in same registry
    innerHTML: (target, content) => { ... },
    outerHTML: (target, content) => { ... },
    // ...
}

config.triggers = {
    default: 'click',            // string → used as event name
    // Custom emitters added by extensions:
    // load: (element, trigger) => { ... },
}
```

**String alias resolution** at lookup time (one level):
```js
let swapFn = config.swaps[swapMethod]
if (typeof swapFn === 'string') swapFn = config.swaps[swapFn]   // resolve alias
if (typeof swapFn !== 'function') return fail('swap:method', ...)
```

This enables `config.swaps.default = 'outerHTML'` — users change the default by setting a string, which resolves to the function at runtime.

**Consequences:**
- Single source of truth: `config.swaps` and `config.triggers` are self-contained
- `resolve()` handles both string and function values for `default` keys
- Aliases are late-binding — changing `config.swaps.innerHTML` also changes any alias pointing to `'innerHTML'`
- Meta tag override works: `<meta name="htmx.config.swaps.default" content="outerHTML">`
- Removes `config.defaultSwap` and `config.defaultTrigger` from ADR-025

---

### 028: Swap Method Names — DOM-Native
**Date:** 2026-02-10 | **Status:** Accepted

**Context:** htmx historically used `insertAdjacentHTML` position names (`beforebegin`, `afterbegin`, `beforeend`, `afterend`) for swap methods. Modern DOM has cleaner names: `before()`, `prepend()`, `append()`, `after()`. The old names are unintuitive — `beforeend` means "append" and `afterbegin` means "prepend."

**Decision:** Primary swap methods use DOM-native names:

| Old Name      | New Name    | DOM Method             |
|---------------|-------------|------------------------|
| `beforebegin` | `before`    | `element.before()`     |
| `afterbegin`  | `prepend`   | `element.prepend()`    |
| `beforeend`   | `append`    | `element.append()`     |
| `afterend`    | `after`     | `element.after()`      |
| `delete`      | `remove`    | `element.remove()`     |

Kept as-is: `innerHTML`, `outerHTML`, `none` — these are already clear and standard.

Legacy names (`beforebegin`, `afterbegin`, `beforeend`, `afterend`, `delete`) are available as string aliases via the `swap-aliases` default extension.

**Consequences:**
- Swap names match the DOM methods they actually call
- New users can guess the swap method from the DOM API
- Backwards compat via `swap-aliases` extension (string aliases, not copies — see ADR-029)

---

### 029: All Triggers Are Events — Emitter Pattern
**Date:** 2026-02-10 | **Status:** Accepted | **Supersedes:** Parts of ADR-025

**Context:** ADR-025 had a dual-role `config.triggers.event` that served as both the fallback DOM event binder AND the namespace for custom triggers (`config.triggers.load`, etc.). Custom triggers called the handler directly, which meant trigger modifiers (delay, throttle) didn't apply — modifiers only wrapped the handler inside `bindDOMEvent`.

**Decision:** All triggers work through DOM events. Custom trigger types are "emitters" — they dispatch events, and the core always listens via `addEventListener`.

**Emitter contract:** `(element, trigger) → cleanup?`
- Receives the wrapped element and parsed trigger spec
- Dispatches events using `element.emit(trigger.event)`
- Optionally returns a cleanup function

```js
// Core always does this for every trigger:
const off = bindDOMEvent(element, trigger, handler)

// If a custom emitter exists, it runs too:
const emitter = config.triggers[trigger.event]
if (typeof emitter === 'function') {
    trigger.event = 'htmx:trigger:' + trigger.event  // namespace (see ADR-030)
    const off2 = emitter(element, trigger)
    if (off2) addCleanup(node, off2)
}
```

**Example emitters:**
```js
// Load: fires once immediately
config.triggers.load = (element, trigger) => {
    queueMicrotask(() => element.emit(trigger.event))
}

// Every: fires on interval
config.triggers.every = (element, trigger) => {
    const id = setInterval(() => element.emit(trigger.event), trigger.interval)
    return () => clearInterval(id)
}
```

**Key insight:** Because the core always binds via `addEventListener`, modifiers (delay, throttle, once) apply uniformly to ALL trigger types — native DOM events and custom emitters alike. This was a bug in the old architecture.

**Consequences:**
- Modifiers work on all triggers — no opt-in required
- Custom triggers are simpler — just emit events, don't manage handlers
- `element.emit()` goes through htmx event system (extension handlers fire)
- Eliminates the `config.triggers.event` dual-role confusion from ADR-025

---

### 030: Custom Trigger Event Namespacing
**Date:** 2026-02-10 | **Status:** Accepted

**Context:** Custom trigger names like `load` clash with native DOM events. An element with `hx-trigger="load"` would receive both the native `load` event AND the htmx-emitted `load` event, causing double-fires.

**Decision:** The core automatically namespaces custom trigger events with `htmx:trigger:` prefix. When `setupTriggers` finds a matching emitter in `config.triggers`, it rewrites `trigger.event` before binding:

```js
trigger.event = 'htmx:trigger:' + trigger.event
```

The emitter uses `trigger.event` (already namespaced) and never hardcodes the event name:
```js
// Correct — uses the namespaced event
element.emit(trigger.event)

// Wrong — hardcodes, would clash with native 'load'
element.emit('load')
```

**Convention:** Emitters MUST use `trigger.event`, never a hardcoded string. This ensures the namespacing works automatically.

**Consequences:**
- No clashes with native DOM events (`load`, `error`, `scroll`, etc.)
- Transparent to emitter authors — just use `trigger.event`
- Namespace prefix (`htmx:trigger:`) is internal, never visible to users
- Users write `hx-trigger="load"`, core handles the plumbing

---

### 031: Core/Defaults Split
**Date:** 2026-02-10 | **Status:** Accepted

**Context:** Several htmx behaviors are conventions rather than core mechanics: smart trigger defaults (form→submit, input→change), legacy swap aliases, the `load` and `every` triggers, delay/throttle modifiers. Putting these in core violates the principle that the core should be minimal.

**Decision:** Split into two files:

- **`htmx.core.js`** — Minimal core: lifecycle pipeline, event system, element wrapping, extension registration, generic trigger/swap infrastructure. ~475 lines.
- **`htmx.defaults.js`** — Conventions and conveniences as extensions, using only the public API (`htmx.register`, `htmx.config`). Shipped with htmx but separable.

**Default extensions:**

| Extension          | Purpose                                          |
|--------------------|--------------------------------------------------|
| `smart-triggers`   | Form→submit, input→change, else→click            |
| `swap-aliases`     | `beforebegin`→`before`, `afterbegin`→`prepend`, etc. |
| `trigger-load`     | Emitter: fires on init                           |
| `trigger-every`    | Emitter: fires on interval                       |
| `modifier-delay`   | Trigger modifier: debounce                       |
| `modifier-throttle`| Trigger modifier: rate limit                     |

Each registers via `htmx.register()` and configures via `htmx:ready` event — dogfooding the extension system.

**Consequences:**
- Core stays minimal and focused on the pipeline
- Users can exclude defaults they don't need
- Defaults serve as reference implementations for extension authors
- Proves the extension system is sufficient for real features

---

### 032: No Extension-Specific Knowledge in Core
**Date:** 2026-02-10 | **Status:** Accepted | **Supersedes:** ADR-019 (partially)

**Context:** The trigger parser in core had a normalization regex that converted `every 3s` → `every interval:3s`. But the `every` trigger itself is an extension (in `htmx.defaults.js`). Having parse rules in core for a feature that lives in an extension means the modular split failed.

ADR-019 prescribed inline normalization at call sites. This is still correct for extensions normalizing their own syntax. But the core must not contain normalization for extension-specific syntax.

**Decision:** Removed the `every` normalization regex from core's `parseTrigger()`. The `every` trigger now uses standard modifier syntax: `every interval:3s`. The generic parser handles this without any special cases.

**Principle:** If a parse rule only exists to support an extension, the extension owns that rule. Core's parser is generic — it handles `value mod:x mod:y` and nothing more.

**Consequences:**
- Core parser has zero special cases
- `every` syntax changes from `every 3s` to `every interval:3s` (consistent with all other modifiers)
- Extensions that need exotic syntax normalization do it themselves (per ADR-019)
- Adding a new custom trigger never requires modifying core

---

### 033: Remove `defaultTarget` — Self-Targeting Is Semantic, Not Configurable
**Date:** 2026-02-10 | **Status:** Accepted

**Context:** `config.defaultTarget: 'this'` had two problems:
1. The magic string `'this'` couples config to `resolveTarget()`'s implementation
2. "Default target is self" is a semantic truth about htmx, not a user preference — if someone wants a different target, they use `hx-target` with inheritance

**Decision:** Removed `config.defaultTarget`. The "no target → use source element" fallback is hardcoded in the request pipeline:

```js
const targetSelector = options.target
const targetNode = targetSelector
    ? resolveTarget(source.element.native, targetSelector)
    : source.element.native
```

`'this'` still works as an explicit value in `hx-target="this"` — that's `resolveTarget`'s concern, not config's.

**Consequences:**
- No magic string in config
- No coupling between config and target resolution internals
- One fewer configurable option (less to document, less to misuse)
- Global target override via `hx-target` inheritance on a parent element (e.g., `<body hx-target="body">`)

---

### 034: Events-Only Customization — No `api` Field
**Date:** 2026-02-10 | **Status:** Accepted | **Reinforces:** ADR-008

**Context:** Initially added an `api` field to `register()` for wrapping public functions (`attr`, `find`, `findAll`). But since `htmx === api` (the IIFE returns the api object), extensions can just reassign `htmx.*` in their `htmx:ready` handlers:

```js
htmx.register('extended-selectors', {
    on: {
        'htmx:ready': () => {
            const original = htmx.find
            htmx.find = (selector, node) => {
                if (selector === 'this') return node
                return original(selector, node)
            }
        }
    }
})
```

Internal code calls through `api.*`, so the reassignment takes effect everywhere. No special mechanism needed.

**Decision:** Remove the `api` field from `register()`. Extensions customize API functions by reassigning `htmx.*` in `htmx:ready` handlers. One mechanism for everything: `on` events.

**Rejected:** The `api` field with validation (`typeof api[key] !== 'function'` → throw). While typo-safe, it's a second mechanism alongside `on`. The validation benefit doesn't justify the added complexity.

**Consequences:**
- `register()` signature simplifies: just `{ requires?, on }`
- One mechanism for all customization: events
- Composable — multiple extensions wrap the same function via `requires` ordering
- No typo validation (acceptable — extension author notices immediately when their wrap doesn't work)
- ADR-008's "events only" vision fully realized

---

### 035: Trigger Infrastructure as Extension
**Date:** 2026-02-10 | **Status:** Accepted

**Context:** The trigger system (parsing, modifiers, custom emitters, event namespacing) was ~50 lines of core infrastructure with 3 config keys (`config.triggers`, `config.triggerModifiers`, `config.swapModifiers`). While the pipeline is core, the trigger parsing and modifier system are conventions that can live in an extension.

**Decision:** Core provides a minimal `setupTriggers` on the api — reads `hx-trigger` as a literal event name, calls `addEventListener`. No parsing, no modifiers, no emitters:

```js
setupTriggers: (element) => {
    const event = element.attr('hx-trigger')
    if (!event) return
    element.on(event, element.state.handler)
}
```

The handler is created by core's internal `createHandler()` and stored in `element.state.handler` during init.

A `triggers` extension in defaults.js replaces `htmx.setupTriggers` in its `htmx:ready` handler, providing full trigger parsing, modifier application, custom emitters, and event namespacing. Trigger-specific extensions (`trigger-load`, `trigger-every`, `modifier-delay`, `modifier-throttle`) declare `requires: ['triggers']`.

**Removed from core:** `setupTriggers` (complex), `bindDOMEvent`, `parseTriggerList`, `parseTrigger`, `config.triggers`, `config.triggerModifiers`, `config.swapModifiers`.

**Kept in core:** `createHandler` (internal — pipeline bridge), `parseModifiers` (generic utility on api), `parseDuration` (internal).

**Consequences:**
- Core drops ~50 lines, config has 3 fewer keys
- Core standalone: explicit `hx-trigger="click"` works, no modifiers, no custom triggers
- With defaults: full trigger parsing, modifiers, emitters — same behavior as before
- `parseTriggerList`/`parseTrigger` move to defaults.js as module-level functions, calling `htmx.parseModifiers()`
- Proves the customization model: extensions can fully replace core behaviors by reassigning `htmx.*`

---

### 036: Defaults Out of Registries
**Date:** 2026-02-10 | **Status:** Accepted | **Partially supersedes:** ADR-027

**Context:** ADR-027 put `default` keys inside registries (`config.swaps.default = 'innerHTML'`, `config.triggers.default = 'click'`). This made registries self-contained, but once defaults moved to extensions (ADR-031), it created a conceptual mismatch: the registry is a pure lookup table of implementations, but `default` isn't an implementation — it's a preference.

Extensions writing `htmx.config.swaps.default = 'innerHTML'` muddy the registry with opinion.

**Decision:** Defaults live as separate config keys:

```js
config.defaultSwap       // string — looked up in config.swaps
config.defaultTrigger    // string or function — resolved via resolve()
```

Registries are pure:
```js
config.swaps    = { innerHTML, outerHTML, before, ... }  // implementations only
config.triggers = { load, every, ... }                    // emitters only
```

The `smart-defaults` extension sets `htmx.config.defaultSwap ??= 'innerHTML'` and `htmx.config.defaultTrigger ??= node => ...`.

**Consequences:**
- Registries are pure lookup tables — no special keys
- Defaults are explicit config — easy to find, easy to override
- `??=` convention preserved — user pre-configuration wins
- Core reads `config.defaultSwap` and `config.defaultTrigger` (undefined by default = no opinion)

---

### 037: Unopinionated Kernel — Conventions via Extensions
**Date:** 2026-02-10 | **Status:** Accepted | **Supersedes:** ADR-024 (partially)

**Context:** ADR-024 said "this IS htmx" and baked in inheritance, `hx-*` convention, and smart triggers. But as the extension system matured (ADR-034's `api` wrapping, ADR-031's core/defaults split), it became clear that *more* could move out without losing usability.

The kernel should be an unopinionated but functional htmx — it runs the full pipeline (init → trigger → request → response → swap → settle), but has no opinions about defaults, inheritance, extended selectors, or request headers.

**Decision:** The kernel provides:

**Capabilities (stay in core):**
- Full request pipeline with events at every phase
- Swap implementations (`innerHTML`, `outerHTML`, `before`, `prepend`, `append`, `after`, `remove`, `none`)
- Simple trigger binding (explicit `hx-trigger` → `addEventListener`)
- Extension system (`register` with `on`, `detail.api` for internals)
- State management, MutationObserver

**Conventions (moved to `htmx.defaults.js`):**
- `inheritance` — `attr` wraps `getAttribute` with parent walking
- `extended-selectors` — `find`/`findAll` wraps `querySelector` with keyword selectors
- `default-headers` — `HX-Request`, `HX-Current-URL`
- `smart-defaults` — default swap (`innerHTML`), default trigger (click/change/submit)
- `swap-aliases` — legacy position names
- `trigger-load`, `trigger-every` — synthetic trigger emitters
- `modifier-delay`, `modifier-throttle` — trigger modifiers

The kernel alone requires explicit `hx-trigger` and `hx-swap` attributes. Loading defaults makes it feel like htmx.

**Consequences:**
- Core is ~380 lines of pure pipeline mechanics
- Everything in defaults uses `detail.api` — proves the extension system works
- Users can load a subset of defaults for minimal builds
- ADR-024's "this IS htmx" still applies to the full build (core + defaults)

---

### 038: Internal API vs Public Surface
**Date:** 2026-02-10 | **Status:** Accepted | **Supersedes:** ADR-015 (partially)

**Context:** The public `htmx` object exposed ~15 functions: `init`, `ajax`, `emit`, `on`, `attr`, `find`, `findAll`, `wrap`, `state`, `resolve`, `parseModifiers`, `setupTriggers`, `register`, plus `config` and `version`. Many of these are implementation details that only extensions need (e.g., `attr`, `find`, `wrap`, `state`, `parseModifiers`). Exposing them all as public API makes the surface area large and hard to maintain.

Extensions need to wrap internal functions (inheritance wraps `attr`, extended-selectors wraps `find`), but users don't need to call these directly.

**Rejected:** Keeping everything on one flat object (status quo) — large public surface, can't distinguish user API from extension internals.

**Decision:** Two objects:

- **`api`** (internal) — all extensible functions. Extensions receive it via `detail.api` in every event handler. `emit()` adds `api` to the detail before calling extension handlers, removes it before DOM dispatch.
- **`htmx`** (public) — minimal surface with getters that delegate to `api`:

```js
return {
    version, config, register,
    get init() { return api.init },
    get ajax() { return api.ajax },
    get emit() { return api.emit },
    get on() { return api.on },
}
```

Extensions wrap internals via `({api}) =>` destructuring:
```js
htmx.register('inheritance', {
    on: {
        'htmx:ready': ({api}) => {
            const original = api.attr
            api.attr = (node, name, opts) => { /* ... */ }
        }
    }
})
```

**Consequences:**
- Public surface is 7 things: `version`, `config`, `register`, `init`, `ajax`, `emit`, `on`
- Internal extensible functions (`attr`, `find`, `findAll`, `wrap`, `state`, `resolve`, `parseModifiers`) are only on `api`
- Extensions access `api` via `detail.api` — available in all event handlers, not just `htmx:ready`
- Getters ensure public `htmx.ajax` etc. always delegate to the (possibly wrapped) `api.ajax`
- `api` is not leaked into DOM event details (removed before `dispatchEvent`)

---

### 039: Mutable Detail for Trigger Binding
**Date:** 2026-02-10 | **Status:** Accepted | **Supersedes:** ADR-035 (partially)

**Context:** ADR-035 moved trigger infrastructure to an extension that replaced `htmx.setupTriggers`. But `setupTriggers` was an awkward API name (all other API functions are one word) and the wrapping pattern was ad-hoc compared to the rest of the architecture.

The request pipeline already uses mutable detail as its extension pattern: `detail.request`, `detail.response`, `detail.swap` flow through events and extensions can modify them. The same pattern should apply to trigger binding.

**Decision:** The init detail carries `trigger` (the event name string) and the handler lives in `element.state.handler`:

```js
// In init():
const detail = {element, trigger: element.attr('hx-trigger')}
emit(element, 'htmx:before:init', detail)

// Default: if trigger wasn't consumed, simple addEventListener
if (detail.trigger) {
    element.on(detail.trigger, element.state.handler)
}
```

The triggers extension nulls `trigger` to prevent core's default binding, and grabs the handler from state:

```js
'htmx:before:init': (detail) => {
    detail.trigger = null  // I'm handling this
    const handler = detail.element.state.handler
    // ... rich trigger setup with parsing, modifiers, emitters
}
```

This separates intent (`detail.trigger` — what event to bind) from implementation (`state.handler` — what to call). The detail describes what's happening, not how.

**Consequences:**
- `setupTriggers` removed from API entirely — no awkward naming
- Core's default trigger binding is 3 lines (check trigger, addEventListener)
- `detail.trigger` is a string, not a function — crystal clear what it means
- Extensions override by nulling `detail.trigger` and doing their own binding
- Handler always accessible via `element.state.handler` for wrapping with modifiers
- Core alone works with explicit `hx-trigger="click"` — functional but minimal

---

### 040: No Element Wrapping in Core
**Date:** 2026-02-10 | **Status:** Accepted | **Supersedes:** ADR-006 (partially)

**Context:** ADR-006 introduced Proxy-based element wrapping so extension handlers could use `element.attr()`, `element.state`, `element.emit()`, `element.on()` instead of calling API functions directly. This required `wrap()` (~20 lines), `unwrap()` (~10 lines), and a `WRAPPED` Symbol.

With ADR-038's `detail.api` pattern, extensions already receive the API object in every handler. The wrapping layer provided syntactic sugar (`element.attr(name)` vs `api.attr(element, name)`) but added complexity: Proxy objects, a Symbol for identity checks, recursive unwrapping before DOM dispatch, and a conceptual split between "wrapped elements" and "raw nodes."

**Decision:** Remove `wrap()`, `unwrap()`, and `WRAPPED` from core. Work with raw DOM elements everywhere.

- Core calls `api.attr(element, name)`, `api.emit(element, name)`, etc.
- Extensions use `detail.api` for the same: `api.attr(element, 'hx-trigger')`
- `api.state(element)` is a function (wraps `WeakMap.get`) — returns the element's state object
- `emit()` passes detail directly to `CustomEvent` — no unwrapping step
- All internal calls go through `api.*` for consistency and extensibility

**Consequences:**
- Core drops ~30 lines (wrap, unwrap, WRAPPED symbol)
- `emit()` simplified — no unwrap step, no `.native` extraction
- One kind of element (DOM Element) — no wrapped vs unwrapped confusion
- Extensions use `api.attr(element, name)` — slightly more verbose but explicit
- `api.state(element).handler` replaces `element.state.handler` — clear what's happening
- Wrapping could be re-added as an opt-in extension if ergonomics matter later

---

### 041: Consistent `api.*` for Internal Calls
**Date:** 2026-02-10 | **Status:** Accepted

**Context:** Some internal functions called through `api.*` (extensible) while others called directly (bypassing wraps). This created an implicit, undocumented distinction between "extensible" and "non-extensible" functions.

**Decision:** All internal calls to functions on the `api` object go through `api.*`. The `api` object IS the extensibility boundary — if it's on `api`, it's extensible; if it's not, it's internal implementation.

```js
// Core calls through api for everything on the api object:
api.emit(element, 'htmx:before:init', detail)
api.attr(element, 'hx-trigger')
api.on(element, event, handler)
api.init(inserted || targetElement)

// Internal helpers called directly (not on api):
addCleanup(element, fn)
createHandler(element)
cleanupTree(root)
```

**Consequences:**
- Any function on `api` can be wrapped by extensions and the wrap takes effect everywhere
- Clear rule: on `api` = extensible, not on `api` = internal
- Slightly more verbose inside core, but explicit and consistent
- No timing ambiguity — `api.*` resolves at call time, always gets the current (possibly wrapped) version

---

### 042: `htmx:setup:trigger` Event Instead of Registries
**Date:** 2026-02-10 | **Status:** Accepted | **Supersedes:** part of ADR-035

**Context:** The `triggers` extension did too much — it parsed trigger strings, applied modifiers from `htmx.config.triggerModifiers`, applied custom emitters from `htmx.config.triggers`, and bound listeners. Two config-based registries (`htmx.config.triggers`, `htmx.config.triggerModifiers`) were a parallel extension mechanism outside the standard event system, and modifier/emitter extensions needed `requires: ['triggers']` to ensure registration order.

**Decision:** The triggers extension emits `htmx:setup:trigger` for each parsed trigger with a mutable detail:

```js
{element, trigger, handler, cleanup: []}
```

- **Modifiers** (delay, throttle) hook into `htmx:setup:trigger` and wrap `detail.handler`
- **Emitters** (load, every) hook into `htmx:setup:trigger`, rename `detail.trigger.event`, and push teardown functions to `detail.cleanup`
- After the event, triggers binds the (possibly modified) handler to the (possibly renamed) event
- Returning `false` from `htmx:setup:trigger` skips that trigger entirely
- `htmx.config.triggers` and `htmx.config.triggerModifiers` registries are eliminated
- `requires: ['triggers']` is no longer needed — if the event never fires, handlers are natural no-ops

Event name follows the `htmx:<time>:<thing>` convention (`setup` is the time, `trigger` is the thing). No parallel `htmx:setup:request` is needed — `htmx:before:request` already serves as the request customization point. Requests are one-shot (configure and fire in the same moment), while triggers are configured once and fire many times, so the setup/fire distinction is meaningful only for triggers.

**Consequences:**
- Triggers extension is just parsing + binding (~30 lines). No registry management.
- Modifiers and emitters are standard extension event handlers — no special API
- Order is registration order (same as all extensions). Modifiers and emitters are orthogonal.
- New trigger types and modifiers are trivial to add — just hook `htmx:setup:trigger`
- `htmx:setup:trigger` is observable from DOM event listeners too (for debugging)

---

### 043: `detail.request` as Native RequestInit
**Date:** 2026-02-10 | **Status:** Accepted

**Context:** `detail.request` was a custom object that core had to manually map to `fetch()` arguments. Meanwhile extensions like `request-timeout` needed to add `signal`, which is a standard RequestInit property.

**Decision:** `detail.request` is a proper RequestInit object plus `url`:

```js
detail.request = {
    url,
    method: options.method || 'GET',
    headers: options.headers || {},
    body: options.body ?? null,
}
```

Core destructures: `const {url: requestUrl, ...fetchOptions} = detail.request` and passes `fetchOptions` directly to `fetch()`. Extensions modify `detail.request` properties directly in `htmx:before:request` — any valid RequestInit property (signal, credentials, mode, cache, etc.) flows through automatically.

**Consequences:**
- `config.defaultRequest` eliminated — defaults live in extensions (e.g. `default-headers`)
- `request-timeout` sets `request.signal` directly instead of wrapping `api.ajax`
- Any RequestInit property is supported without core changes
- Extensions compose naturally — timeout adds signal, CORS adds mode, etc.

---

### 044: Extension Handler Signature `(detail, api)`
**Date:** 2026-02-10 | **Status:** Accepted | **Supersedes:** ADR-034

**Context:** ADR-034 added `detail.api` so extensions could access the internal API. This polluted every detail object with an `api` property that leaked into DOM CustomEvents. The `api` field was also added before dispatch and deleted after — messy lifecycle management.

**Decision:** Pass `api` as the second argument to extension event handlers:

```js
// Extension handler signature:
'htmx:boot': (detail, api) => { ... }
'htmx:setup:trigger': ({element, trigger}, {emit}) => { ... }
```

`emit()` calls `extension.on?.[name]?.(detail, api)`. DOM CustomEvent listeners still receive the event as usual — `api` never touches the detail object.

Late-registered extensions (after boot) receive: `extension.on['htmx:boot']({}, api)`.

**Consequences:**
- `detail` is clean — only data relevant to the event
- No add/delete dance in `emit()`
- Extensions destructure what they need: `({element, trigger}, {emit, attr})`
- DOM event listeners see only the detail — no internal API leakage
- `_api` shadowing issues eliminated — every handler gets api as second arg

---

### 045: `htmx.swap(content, target, options?)` — Standalone Swap
**Date:** 2026-02-10 | **Status:** Accepted

**Context:** Swapping was only available through the request lifecycle (`ajax()`). Users and extensions needed programmatic swapping without triggering a request.

**Decision:** `swap()` is a standalone public method on the API:

```js
swap(content, target, options = {})
```

- `content` — HTML string or DocumentFragment (positional, required)
- `target` — Element or CSS selector string (positional, required)
- `options.swap` — swap method name (string, e.g. "innerHTML")
- `options.context` — arbitrary context (e.g. `{source, response}` when called from `ajax()`)

Strings are parsed to DocumentFragment via `<template>`. Selectors resolved via `api.find()`. Swap events fire on `target` element:

```js
detail = {target, content, method: options.swap || null, fn: null, context: options.context || null}
emit(target, 'htmx:before:swap', detail)    // extensions set detail.fn
detail.fn(detail.target, detail.content)     // actual swap
emit(target, 'htmx:after:swap', detail)
```

`ajax()` calls `swap()` internally, passing response context:

```js
swap(detail.response.text, target, {
    swap: options.swap,
    context: {source, response: detail.response},
})
```

**Consequences:**
- Programmatic swapping without the request lifecycle
- `ajax()` uses the same swap path as everyone else
- Swap events always fire on the target element (breaking change from htmx 1-3 which fired on source)
- Extensions resolve `detail.fn` from `detail.method` during `htmx:before:swap`
- `detail.fn = null` by default — if no extension sets it, nothing happens (core doesn't know swap methods)

---

### 046: Swap Events Fire on Target Element
**Date:** 2026-02-10 | **Status:** Accepted

**Context:** htmx 1-3 fired swap events (`htmx:beforeSwap`, `htmx:afterSwap`) on the source element. But swap logically affects the target — that's where content goes and where observers need to react. With `htmx.swap()` being usable standalone (no source element), firing on source is impossible.

**Decision:** Swap events (`htmx:before:swap`, `htmx:after:swap`) fire on the target element. Request events (`htmx:before:request`, etc.) fire on the source element.

**Consequences:**
- Breaking change for htmx 1-3 users who listened for swap events on source
- Semantically correct — swap events fire where the swap happens
- `htmx.swap()` works standalone with no source
- Backwards compat extension is a possible future add-on (not designed yet — previous attempt rejected)

---

### 047: Triggers in Core, Trigger Behaviors as Extensions
**Date:** 2026-02-10 | **Status:** Accepted | **Supersedes:** ADR-035

**Context:** ADR-035 moved the entire trigger system to a `triggers` extension. But triggers are fundamental to htmx — without them, `hx-trigger` is dead markup. The extension was awkward: it required `initSelectors` knowledge, duplicated core patterns, and every other trigger extension depended on it.

**Decision:** Core owns trigger parsing and binding. The `init()` function:
1. Reads `hx-trigger`, splits on commas (bracket-aware regex)
2. Parses each part with `parse()` (universal parser)
3. Sets `trigger.event = trigger.value`
4. Emits `htmx:setup:trigger` for each trigger (mutable detail)
5. Binds the (possibly modified) handler to the (possibly renamed) event

Trigger *behaviors* remain extensions:
- `trigger-load` — synthetic "load" trigger (renames to `htmx:trigger:load`, fires via microtask)
- `trigger-every` — repeating interval trigger
- `modifier-delay` — debounce via handler wrapping
- `modifier-throttle` — throttle via handler wrapping
- `default-trigger` — implicit trigger (click/change/submit) when `hx-trigger` omitted

**Consequences:**
- `triggers` extension eliminated — its logic is in core's `init()`
- Core is self-sufficient: loads, parses triggers, binds handlers
- `htmx:setup:trigger` remains the hook for trigger customization
- No `requires: ['triggers']` needed anywhere

---

### 048: Universal `parse()` Method
**Date:** 2026-02-10 | **Status:** Accepted

**Context:** There were three parsers: `parseTriggerList` (comma-split + loop), `parseTrigger` (trigger-specific parsing), and `parseModifiers` (generic `value mod:arg` parsing). The trigger-specific parsers existed because `hx-trigger` had special syntax (comma-separated, filters). But `parseModifiers` was already sufficient for individual trigger specs.

**Decision:** One universal parser named `parse()`:

```js
function parse(raw) {
    if (!raw) return {value: null}
    const [value, ...parts] = raw.trim().split(/\s+/)
    const result = {value}
    for (const part of parts) {
        const index = part.indexOf(config.syntaxDelimiter)
        if (index > 0) {
            const key = part.slice(0, index)
            const rawValue = part.slice(index + 1)
            result[key] = parseDuration(rawValue) ?? rawValue
        } else {
            result[part] = true
        }
    }
    return result
}
```

Handles any `value modifier:arg modifier:arg flag` pattern. Comma-splitting for `hx-trigger` is done inline before calling `parse()` on each part. Duration parsing (`500ms`, `2s`, `1m`) is automatic for modifier values.

`parseTriggerList` and `parseTrigger` are eliminated. `parseModifiers` is renamed to `parse()` and exposed on the api object.

**Consequences:**
- One parser for all attribute values
- `api.parse` available to extensions for their own attributes
- Trigger comma-splitting is separate from parsing (inline in `init()`)
- Duration values auto-parsed to milliseconds

---

### 049: Config Reduced to Minimal Core
**Date:** 2026-02-10 | **Status:** Accepted | **Supersedes:** ADR-025

**Context:** ADR-025 put everything on `config` including swap registries, trigger registries, default values. With the events-only architecture, extensions handle all behavior — core config should only have what core itself needs.

**Decision:** Core config is minimal:

```js
const config = {
    syntaxDelimiter: ':',
    initSelectors: ['[hx-get]', '[hx-post]', '[hx-put]', '[hx-patch]', '[hx-delete]'],
}
```

- `syntaxDelimiter` — used by `parse()` for modifier syntax
- `initSelectors` — CSS selectors that trigger htmx initialization

Everything else lives in extensions that set config properties at boot:
- `htmx.config.defaultSwap` — set by `default-swap` extension
- `htmx.config.defaultHeaders` — set by `default-headers` extension
- `htmx.config.requestTimeout` — set by `request-timeout` extension

Extensions use `??=` so user overrides before boot are preserved.

**Consequences:**
- Core has zero opinions about defaults
- `config` is open — extensions add properties freely
- User can set any config property before boot; extensions use `??=` to respect it
- No registries (`config.swaps`, `config.triggers`, `config.triggerModifiers` all eliminated)

---

### 051: `api.resolve(element)` — Attribute-Agnostic Element Config
**Date:** 2026-02-11 | **Status:** Superseded

**Context:** The core hardcoded attribute-to-method resolution in `createHandler`, meaning the pipeline knew about specific attributes (`hx-get`, `hx-post`, etc.). This coupled the core to specific attribute names and made it impossible for extensions to provide alternative config sources (e.g., `hx-action`/`hx-method`, data attributes, or JS-based config).

**Rejected alternatives:**
- **Config object on element state** — would require init to read all attributes upfront, losing JIT (just-in-time) resolution of dynamic attributes
- **Passing raw attributes through the pipeline** — would push resolution responsibility to every extension

**Decision:** Add `api.resolve(element)` as a wrappable function that reads element config at trigger time and returns an options object `{url, method, source, target, swap}` (or `null`). Default implementation reads the 8 `hx-*` attributes. Extensions can wrap `api.resolve` to support additional attribute schemes.

**Consequences:**
- `createHandler` is eliminated — the handler is a 3-line inline closure calling `resolve()` then `ajax()`
- Attribute reading happens at trigger time (JIT preserved)
- Extensions like `hx-action` can wrap `api.resolve` to add their own attribute reading
- Exposed on public API as `htmx.resolve(element)` for programmatic use

### 052: `ajax(options)` — Single Options Object
**Date:** 2026-02-11 | **Status:** Accepted

**Context:** `ajax(url, options)` had a split signature — URL as a positional arg, everything else in an options object. This was inconsistent with `resolve()` returning a complete options object and required callers to destructure before passing.

**Rejected alternatives:**
- **Keep `ajax(url, options)`** — requires spreading: `ajax(opts.url, opts)`. Awkward.
- **Named parameter with default** — `ajax({url, ...rest})` is what we chose

**Decision:** Change to `ajax(options)` where options is `{url, method, source, target, swap, headers, body}`. The return value of `resolve()` can be passed directly: `ajax(resolve(element))`.

**Consequences:**
- Clean composition: handler is `const options = resolve(element); if (options) ajax(options)`
- `target` is resolved early (string → element) and placed on `detail` so extensions can retarget during `htmx:before:request` or `htmx:after:response`
- Swap uses `detail.target` and `detail.swap` (extensions can modify both)
- `phase` field removed from detail — event names already identify the phase

### 053: `source` Is Just an Element
**Date:** 2026-02-11 | **Status:** Accepted

**Context:** `detail.source` was `{element, event}` — a wrapper object carrying both the source element and the triggering event. This complicated every emit call (`emit(source.element, ...)`) and every extension that needed the source element.

**Rejected alternatives:**
- **Keep `{element, event}`** — the event is available via the trigger closure, no need to thread it through the pipeline
- **Add event to detail separately** — extra field with unclear lifecycle

**Decision:** `source` is just the element. Pipeline events emit on `source` directly. The triggering event is a closure concern, not a pipeline concern.

**Consequences:**
- All `emit(source.element, ...)` simplifies to `emit(source, ...)`
- `fail()` emits on `source` directly
- Extensions access `detail.source` as an element (no `.element` unwrapping)
- Default source for programmatic `ajax()` is `document.body` (element, not wrapper)

### 054: Universal `parse(text)` — RelaxedJSON Grammar
**Date:** 2026-02-11 | **Status:** Accepted | **Supersedes:** ADR-048

**Context:** ADR-048 defined `parse()` as a single-object parser using `split(/\s+/)`. Too naive — didn't handle quoted values, type coercion, or real-world attribute syntax. The htmx 4.0 alpha had two separate parsers (`__parseTriggerSpecs` and `__parseConfig`) with overlapping responsibilities. We need one parser that handles any attribute value segment.

**Rejected alternatives:**
- **Character-by-character tokenizer (`scan`/`tokenize`)** — unnecessary; a single `matchAll` regex handles all core cases
- **Separate `parseList()` function** — unnecessary API surface; comma-splitting is the caller's concern
- **`parse()` returns an array** — unintuitive; parse handles one segment, callers split on commas when they need lists
- **JSON passthrough (`{` → `JSON.parse`)** — RelaxedJSON is its own format; JSON support can be an extension
- **Nesting-aware tokenizer in core** — extensions handle exotic nesting via protect-and-restore wrapping
- **`htmx:parse:protect` event** — new mechanism when wrapping `api.parse` already works
- **Reviver/replacer parameters** — per-call customization creates a second extensibility mechanism alongside wrapping; attribute-specific interpretation already happens in lifecycle events

**Decision:** `parse(text)` takes a string, returns a single object.

**Grammar:**
```
segment  = token (ws token)*
token    = (key ":" value) | value
key      = quoted | bare
value    = quoted | bare
bare     = [^\s,:]+
quoted   = "..." | '...'
```

**Behavior:**
- First bare token (no colon) → `value` property
- `key:value` tokens → named properties (first colon splits; subsequent colons are part of the value)
- Bare tokens after first → boolean flags (`true`)
- Type coercion on property values: `true`/`false` → boolean, `/^\d+(ms|s|m)?$/` → number (ms)
- No coercion on the `value` property (always a string)
- Quoted keys/values: `"..."` or `'...'` — protects spaces, commas, colons
- Comma-splitting for multi-value attributes (like `hx-trigger`) is the caller's concern

**Implementation:** One `matchAll` regex, ~20 lines total.

**Exotic syntax — the protect-and-restore pattern:**

Extensions wrap `api.parse` to handle syntax containing RelaxedJSON delimiters. The pattern is always the same — protect exotic regions with placeholders, delegate to the original parser, restore. No matter how exotic the input, the output is always a clean JSON-like object:

```js
// Extension wraps api.parse — same pattern every time:
const original = api.parse
api.parse = (text) => {
    if (!text?.includes(MARKER)) return original(text)  // guard: fast no-op
    const vault = []
    const safe = text.replace(PATTERN, match => {
        vault.push(match); return `__${vault.length}__`
    })
    const result = original(safe)
    for (const key of Object.keys(result))
        if (typeof result[key] === 'string')
            result[key] = result[key].replace(/__(\d+)__/g, (_, i) => vault[i - 1])
    return result
}
```

Different extensions, different syntax, same pattern:
```js
text.replace(/\[([^\]]*)\]/g, ...)        // bracket expressions
text.replace(/\$\{[^}]*\}/g, ...)         // template literals
text.replace(/\/(?:[^/\\]|\\.)+\//g, ...) // regex literals
text.replace(/\{\{[^}]*\}\}/g, ...)       // server-side templates
```

Each extension composes via `requires` ordering. Core stays ~20 lines forever.

**Key discipline — protect globally, interpret locally:**

Wrapping `api.parse` should only **protect** exotic regions (make them survive tokenization). It should NOT **interpret** what they mean. Interpretation happens in scoped lifecycle events:

```js
// api.parse wrap: PROTECT — safe globally
// "click[ctrlKey] delay:300ms" → {value: "click[ctrlKey]", delay: 300}
// Brackets survived tokenization, but parse didn't interpret them

// htmx:setup:trigger handler: INTERPRET — scoped to triggers only
if (trigger.value.includes('[')) {
    trigger.filter = trigger.value.slice(trigger.value.indexOf('[') + 1, -1)
    trigger.value = trigger.value.slice(0, trigger.value.indexOf('['))
}
```

This ensures global wrapping never corrupts unrelated attributes. Same discipline as `inheritance` (wraps `api.attr` globally with guard) and `extended-selectors` (wraps `api.find` globally with guard).

**Other changes:**
- **Dot-path expansion** (`user.name:John` → `{user: {name: "John"}}`) is an extension in `htmx.defaults.js`
- **`config.syntax` removed** — `api.parse` and `api.stringify` are the wrappable extension points

**Consequences:**
- One function, one object — simple, predictable
- Regex-based: ~20 lines
- `config.syntax` eliminated
- Duration coercion baked in (number format, not htmx-specific)
- Extensions compose by wrapping `api.parse` in registration order
- Guard pattern (`includes` check) ensures zero cost for unaffected attributes
- Parking lot items "Universal attribute parser" and "RelaxedJSON parser" are addressed

### 055: Init/Cleanup Split — Tree vs Element Functions with Tree Events
**Date:** 2026-02-11 | **Status:** Accepted | **Supersedes:** ADR-049 (config.initSelector)

**Context:** `init(root)` walked a subtree and initialized each element inline. `cleanupTree(root)` walked descendants calling `cleanup(element)`. Naming was asymmetric (`init` vs `cleanupTree`), per-element init logic wasn't callable independently, and there was no event-based mechanism for extensions to discover elements when a subtree was added or removed. Extensions like `hx-ws` or `hx-on:*` need to find and process their own elements during tree initialization, but `config.initSelector` only covered core's elements.

**Rejected alternatives:**
- **Keep `config.initSelector` and let extensions append to it** — couples extension selectors to core's query; extensions can't do custom discovery logic
- **Single `init` function with tree events but no `initElement` on api** — extensions that need to initialize a single element programmatically would have to call `init` on a wrapper, defeating the purpose
- **`htmx:init:subtree` without before/after split** — inconsistent with the existing `htmx:before:init` / `htmx:after:init` per-element pattern (ADR-017)

**Decision:**
- `init(root)` — tree-level: emits `htmx:before:init:subtree` / `htmx:after:init:subtree` with `{root}`, runs `querySelectorAll` with hardcoded selector, calls `initElement` for each match
- `initElement(element)` — per-element: emits `htmx:before:init` / `htmx:after:init` (unchanged), sets up triggers and listeners
- `cleanup(root)` — tree-level (renamed from `cleanupTree`): emits `htmx:before:cleanup:subtree` / `htmx:after:cleanup:subtree` with `{root}`, calls `cleanupElement` on root and stateful descendants
- `cleanupElement(element)` — per-element (renamed from `cleanup`): emits `htmx:before:cleanup` / `htmx:after:cleanup` (unchanged)
- `config.initSelector` removed — hardcoded `const initSelector` in core; `config` starts as `{}` (extensions populate it)
- `api.initElement` and `api.cleanupElement` added for extensions that need per-element operations

**Consequences:**
- Symmetric naming: `init`/`cleanup` (tree), `initElement`/`cleanupElement` (element)
- Extensions can listen to `htmx:before:init:subtree` to discover their own elements via their own selectors
- `config.initSelector` eliminated — core's selector is an implementation detail, not configurable
- `config` starts empty — extensions own all configuration
- Per-element events (`htmx:before:init`, `htmx:after:init`, etc.) unchanged — `default-trigger` and other extensions work without modification

### 056: Extension Naming Convention and Trigger Setup Ownership
**Date:** 2026-02-11 | **Status:** Accepted

**Context:** Extension names like `modifier-once` are ambiguous — is it a trigger modifier or a swap modifier? Additionally, core's `initElement` contained `setup.listeners[]` and `setup.cleanup[]` fields that only existed for specific extensions (`modifier-from` and `trigger-every`). Core shouldn't know about cross-element listener binding or extension-specific cleanup — those are extension concerns.

**Rejected alternatives:**
- **`setup.listeners[]` on setup object** — only exists for `modifier-from`; couples core to the cross-element binding concern
- **`setup.cleanup[]` on setup object** — only exists for `trigger-every`; extensions can use `api.state.get(element).cleanup.push(fn)` directly
- **`on()` with owner parameter** — adds complexity to a core function for a niche use case; `modifier-from` can handle its own cleanup via `api.state`
- **`requires` for trigger modifier ordering** — would break independent registration (e.g., using `from` without `delay`); registration order in defaults.js is sufficient

**Decision:**

Extension naming convention by category:
- `attr-*` — wraps `api.attr` (`attr-inheritance`)
- `find-*` — wraps `api.find`/`api.findAll` (`find-extended-selectors`)
- `parse-*` — wraps `api.parse` (`parse-dot-path`)
- `default-*` — smart defaults (`default-swap`, `default-trigger`, `default-handler`, `default-headers`)
- `swap-*` — swap methods and modifiers
- `request-*` — request behavior (`request-timeout`)
- `trigger-*` — trigger types (`trigger-load`, `trigger-every`)
- `trigger-modifier-*` — trigger modifiers (`trigger-modifier-once`, `trigger-modifier-delay`, `trigger-modifier-throttle`, `trigger-modifier-from`)

Trigger setup ownership:
- `setup` object reduced to `{element, trigger, handler, options}` — no `listeners[]` or `cleanup[]`
- Core binds one listener: `api.on(element, trigger.event, setup.handler, setup.options)`
- `trigger-modifier-from` handles its own cross-element binding: nulls `setup.handler`, binds on targets via `api.on()`, tracks cleanup via `api.state`
- `trigger-every` tracks its own interval cleanup via `api.state`
- `trigger-modifier-from` must be registered after handler-wrapping modifiers (delay, throttle) — convention, not enforced by `requires`

**Consequences:**
- `initElement` simplified — one binding line instead of six
- Extension names unambiguously scoped to their pipeline phase
- Extensions fully own their special concerns (cross-element binding, interval cleanup)
- Registration order matters for `trigger-modifier-from` — documented in defaults.js header

### 057: Swap Refactoring — Core Styles, Options Object, Flat Detail
**Date:** 2026-02-11 | **Status:** Accepted

**Context:** Swap styles (innerHTML, outerHTML, beforebegin, etc.) were in a `swap-methods` extension. The swap function had a positional signature. The swap detail nested things in a `context` object. We needed consistency with `ajax(options)` and clear naming (`style` for swap mode, `method` for HTTP verb).

**Rejected alternatives:**
- **Swap styles as extension** — swap styles are fundamental to htmx, not optional behavior
- **`api.swapStyles` registry** — wrapping `api.swap` is more consistent with attr/find/parse wrapping pattern
- **`fn` in swap detail** — too generic, resolved internally instead
- **`method` for swap style** — clashes with HTTP method naming
- **`context` in swap detail** — unclear origin; pipeline context passes through via spread instead

**Decision:**
- Swap styles built into core as local `swapStyles` map (not on api)
- `swap(options)` takes a single options object: `{content, target, style, source}`
- Swap events use flat detail: `{target, content, style, source, ...pipelineContext}`
- `style` names swap mode; `method` reserved for HTTP verb
- Extensions add custom styles by wrapping `api.swap` (e.g., `swap-style-aliases` maps `before`→`beforebegin`)
- Swap events fire on source element (fallback to target if no source)
- `api.fail()` for errors with `/`-delimited types: `swap/target`, `swap/style`
- `default-swap` extension sets `detail.style ??= htmx.config.defaultSwap`

**Consequences:**
- `swap-methods` extension removed from defaults, replaced by `swap-style-aliases`
- Programmatic `htmx.swap({...})` emits events — consistent behavior
- Swap detail is flat; when called from ajax, request/response flow through via spread

---

### 058: `api.fail()` — Shared Error Utility
**Date:** 2026-02-11 | **Status:** Accepted

**Context:** Error handling was inconsistent — ajax emitted errors manually, swap silently returned. We needed a shared pattern.

**Rejected alternatives:**
- **`:` delimiter for error types** — clashes with event name colons (`htmx:before:swap`)
- **Single `'swap'` type for all swap errors** — too coarse, different failure modes need different types

**Decision:**
- `fail(element, detail, type, message, cause)` sets `detail.error = {type, message, cause?}` and emits `htmx:error`
- Error types use `/` delimiter: `swap/target`, `swap/style`, `request`
- In ajax, swap errors caught separately with type `'swap'`; fetch errors use type `'request'`

**Consequences:**
- Consistent error handling across all pipeline phases
- Error type hierarchy via `/` enables pattern matching (e.g., `startsWith('swap/')`)

---

### 059: Consistent Request Lifecycle Detail
**Date:** 2026-02-11 | **Status:** Accepted

**Context:** The event detail shape varied across lifecycle events. We needed a consistent shape that extensions can rely on.

**Decision:**
- All request lifecycle events share: `{source, request, swap, response, error}`
- All fields present from the start with null defaults: `response: null, error: null`
- `source` is top-level — it's the "who" alongside request (what HTTP), swap (what DOM mutation), response (what came back), error (what went wrong)
- `swap: {style, target}` — target stays as a string through the lifecycle, resolved right before swap
- Extensions can modify any field in any event; late resolution means target changes are respected

**Consequences:**
- Extensions can always destructure the same shape
- Target resolution is late — happens after all events have had a chance to modify `detail.swap.target`

---

### 060: Settle Removal from Core
**Date:** 2026-02-11 | **Status:** Accepted

**Context:** `htmx:before:settle` / `htmx:after:settle` were two events back-to-back with zero logic between them — empty ceremony from htmx 2.0.

**Decision:** Remove settle events from core. Move to `htmx.compat.js` (planned, not yet implemented — see `PLAN-compat.md`).

**Consequences:**
- Core lifecycle simplified: init → trigger → request → response → swap
- Existing code listening for settle events needs the compat layer

---

### 061: Core Bugfixes — emit fallback, parse(null), cancelled init
**Date:** 2026-02-11 | **Status:** Accepted

**Context:** Code review found several issues in core.

**Decision:**
1. **`emit()` fallback to `document.body`** — was `document`. Events on disconnected elements now bubble through body → document → window, so `document.body.addEventListener(...)` catches them.
2. **`parse(null)` returns `null`** — was `{value: null}` (truthy). Now `if (detail.trigger)` correctly skips bindTrigger when no trigger is specified. `default-trigger` handles null via `detail.trigger?.value`.
3. **Cancelled init deletes state** — `state.delete(element)` when `htmx:before:init` returns false. Element becomes re-initializable instead of permanently claimed.

---

### 062: find/findAll Redesign — IN PROGRESS
**Date:** 2026-02-11 | **Status:** Proposed (not yet implemented)

**Context:** `find(element, selector)` has conflicting semantics for target resolution. Plain CSS selectors (`#target`) need document-global search. Keyword selectors (`closest .card`) need element as context. Core's two-arg form does `element.querySelector(selector)` which scopes to element — wrong for `hx-target="#target"` when target is elsewhere in the document.

**Rejected alternatives:**
- **Separate `api.resolveTarget()` function** — adds surface area, user wants find to handle it
- **Core find ignores element parameter** — dishonest function signature
- **Late target resolution via events** — too indirect
- **Core find always searches from document** — breaks the contract of the two-arg form
- **Ajax uses one-arg find only** — keyword selectors lose context entirely

**Leading proposal:**
Core `find`/`findAll` are single-arg only — thin wrappers around `document.querySelector`:
```js
find: (selector) => document.querySelector(selector),
findAll: (selector) => [...document.querySelectorAll(selector)],
```
Core swap uses single-arg: `if (typeof target === 'string') target = api.find(target)`.
Ajax passes target as string to swap: `target: detail.swap.target || source`.
`find-extended-selectors` extension does TWO things:
1. Adds two-arg `api.find(context, selector)` with keyword support (closest, find, this, body)
2. Wraps `api.swap` to resolve keyword targets using `options.source` before core swap sees them

This means: core is correct without extensions (plain CSS always searches document). Keywords work when the extension is loaded. No ambiguous two-arg semantics in core.

**Open questions:**
- Should find/findAll even exist in core, or should core use `document.querySelector` directly?
- If find is single-arg in core, the extension adds the two-arg overload — is that clean or surprising?

### 063: Wrappers vs Events — Prefer Events When a Checkpoint Exists
**Date:** 2026-02-12 | **Status:** Accepted

**Context:** Several extensions used function wrapping (`api.swap = (options) => { ...; original(options) }`) when an event already existed at that point in the pipeline. Function wrapping has known costs:
- Stack depth — each wrapper adds a frame
- Debuggability — anonymous closures, can't inspect what a function "currently does"
- Ordering — outer wrapper runs first, implicit dependency on registration order

Event handlers are more debuggable (named checkpoints, loggable) and compose independently (each sees the same mutable detail).

**Decision:** Principle: **wrap functions only when no corresponding event exists.** If there's already an event where `detail` is mutable and read after the emit, use an event handler instead.

Applied: `swap-style-aliases` converted from `api.swap` wrapper to `htmx:before:swap` event handler. `detail.style` is already read after the emit, so remapping it in an event handler works identically.

Remaining wrappers justified:
- `attr-inheritance` wraps `api.attr` — no "attribute read" event exists; would fire hundreds of times
- `find-extended-selectors` wraps `api.find`/`api.findAll` — no "element lookup" event; hot path
- `parse-dot-path` wraps `api.parse` — no "parse" event; called for every attribute

**Consequences:**
- One fewer wrapper in defaults
- Clear guideline for extension authors: events first, wrappers only for semantic changes to hot-path utilities with no event checkpoint

### 064: Pipeline Detail Flows Through Swap — Polymorphic Dispatch
**Date:** 2026-02-12 | **Status:** Accepted | **Supersedes:** ADR-057 (flat swap detail), resolves ADR-059 tension

**Context:** ADR-057 gave `swap()` a flat detail (`{target, content, style, source, ...pipelineContext}`). ADR-059 said all pipeline events share `{source, request, swap, response, error}` with `swap: {style, target}`. These contradicted each other — swap events had `detail.style` (flat) while every other pipeline event used `detail.swap.style` (nested).

The root cause: `ajax()` was destructuring its pipeline detail and re-packing it flat for `swap()`:
```js
api.swap({content: detail.response.text, target: swapTarget, style: detail.swap.style,
          source, request: detail.request, response: detail.response})
```

This made swap create its own detail object, losing the identity of the pipeline detail that had been flowing through request → response events.

**Decision:** The pipeline detail object flows through the entire lifecycle as one object. `ajax()` passes its detail directly to `swap()`:

```js
detail.swap.content = detail.response.text
api.swap(detail)
```

`swap()` uses polymorphic dispatch — it accepts two shapes:

1. **Pipeline shape** (from ajax): `{source, request, swap: {content, target, style}, response, error}` — detected by `detail.swap` being present
2. **Standalone shape** (public API): `{content, target, style, source?}` — normalized to pipeline shape internally

```js
// Public API — clean, flat:
htmx.swap({content: '<p>hi</p>', target: '#foo', style: 'innerHTML'})

// Internal — ajax passes detail directly:
api.swap(detail)
```

Target resolution also moves into `swap()`: string targets are resolved via `api.find(detail.source, selector)` with fallback to `detail.source`. This means target resolution happens late (after all response events) and in one place.

All swap events fire with the full pipeline shape. Extensions always use `detail.swap.style`, `detail.swap.target`, `detail.swap.content`.

**Consequences:**
- One detail object flows through the entire lifecycle — no destructuring, no re-packing
- `detail.swap.style` everywhere — consistent with ADR-059
- `...pipelineContext` spread eliminated
- Target resolution consolidated in `swap()` instead of split between `ajax()` and `swap()`
- Standalone `htmx.swap()` public API stays clean — flat options normalized internally
- Polymorphic dispatch is idiomatic JS (same pattern as `fetch(string|Request)`)

### 065: Unified `find()` — Single Function with `{multiple}` Option
**Date:** 2026-02-13 | **Status:** Accepted | **Supersedes:** ADR-062

**Context:** Core had both `find(element, selector)` → Element and `findAll(element, selector)` → Element[]. Two functions for the same concept (selector resolution), different return types. Extensions wrapping selector resolution had to wrap both.

**Decision:** Single `find(element, selector, options)` function. Pass `{multiple: true}` to get an array. Signature is overloaded: `find(selector)` uses `document` as default element.

**Consequences:**
- `findAll` removed from api and public surface
- One wrapping point for extensions
- `match()` helper inside find normalizes nullable single results for the return mode

### 066: Extended Selectors in Kernel
**Date:** 2026-02-13 | **Status:** Accepted

**Context:** Extended selectors (`this`, `body`, `closest X`, `next X`, `previous X`, etc.) were initially in a wrapping extension. But they're used universally — `hx-target` needs them, and they're fundamental to how htmx resolves element references.

**Decision:** Full extended selector support built into kernel's `find()`:
- Named targets: `this`, `body`, `document`, `window`
- Immediate relatives: `next`, `previous`, `host`
- Traversal: `closest X`, `next X`, `previous X`
- Scoped search: `find X` (strips prefix, searches within element)
- CSS selector fallback: `querySelector` / `querySelectorAll`

Helper functions `scanForward` / `scanBackward` use `compareDocumentPosition` for `next X` / `previous X`.

**Consequences:**
- `find-extended-selectors` extension removed
- Kernel is self-sufficient for all selector resolution
- Extensions can still wrap `api.find` for custom selector syntax

### 067: `config:*` / `before:*` Event Split
**Date:** 2026-02-13 | **Status:** Accepted

**Context:** `config:trigger` existed because triggers have a real temporal gap — setup (once) vs firing (every time). For swap/request/init, both events fire once per call, but we added `config:*` for consistency. The question was: what's the semantic difference?

**Decision:** All phases follow the same pattern:
- `config:*` = **configure** — set handlers, modify options, fill defaults, push selectors
- `before:*` = **observe/cancel** — last chance to inspect and cancel; don't modify

Same detail object flows through both events. The handler is visible in `before:*` (same object) but convention says modify in `config`, cancel in `before`.

Applied consistently:
- `config:init` / `before:init` / `after:init`
- `config:init:element` / `before:init:element` / `after:init:element`
- `config:trigger` / (bind) ... `before:trigger` / `after:trigger`
- `config:request` / `before:request` / `after:request`
- `config:swap` / `before:swap` / `after:swap`

Extensions moved from `before:*` to `config:*`: default-swap, swap-style-aliases, default-headers, timeout, method-attrs.

**Consequences:**
- Clear convention for extension authors: configure in `config`, gate in `before`
- Consistent across all phases — one mental model
- Prevents confusion when writing trigger extensions (where the distinction is temporal, not just semantic)

### 068: `parse()` Accepts Options — `{as}` Rename Moved from `attr`
**Date:** 2026-02-13 | **Status:** Accepted

**Context:** `attr()` did three things: getAttribute → parse → rename first token via `{as}`. The inheritance extension needed to wrap `attr` but work with raw strings for `:append` concatenation. This forced it to either add a new api function (`attrRaw`) or duplicate the parse + as-rename logic.

**Decision:** Move `{as}` rename into `parse(text, options)`. Now `attr` is just:
```js
function attr(element, name, options) {
    return api.parse(element.getAttribute(name), options)
}
```

The inheritance extension wraps `api.attr`, resolves the raw string (with ancestor walking + append concatenation), then calls `api.parse(raw, options)` — no duplication, no new api function.

**Consequences:**
- `parse` is more useful standalone — can rename tokens without going through `attr`
- `attr` is a one-liner
- Inheritance extension has zero duplication with kernel logic

### 069: Attribute Inheritance — Full Alpha Parity
**Date:** 2026-02-13 | **Status:** Accepted

**Context:** The initial inheritance extension was simple parent-walking. The alpha (htmx.js) has a richer system with explicit inheritance markers and append concatenation.

**Decision:** Inheritance extension matches alpha behavior:
1. **Direct**: `hx-target` on element → use it
2. **Inherited marker**: `hx-target:inherited` on element → use it
3. **Append**: `hx-target:append` or `hx-target:inherited:append` → find ancestor's value, concatenate with comma
4. **Walk up**: `closest()` to ancestor with `:inherited` or `:inherited:append`, recursively resolve

Configurable via `htmx.config.inheritance`:
- `mode: 'explicit' | 'implicit'` — explicit requires `:inherited` suffix; implicit also inherits plain attributes
- `inheritSuffix: 'inherited'` — configurable marker suffix
- `appendSuffix: 'append'` — configurable append suffix

Implementation: loop-based (not recursive). Collects raw append chain walking upward, reverses, joins with comma, parses once via `api.parse(raw, options)`.

**Consequences:**
- Full alpha parity for inheritance behavior
- Configurable suffixes — can change `:inherited` to any string
- Mode switch — explicit (default, like alpha) or implicit (like htmx 1.x/2.x)
- No new api functions — wraps `api.attr`, uses `api.parse`

### 070: Swap Styles Stay in Kernel
**Date:** 2026-02-13 | **Status:** Accepted

**Context:** Considered moving swap styles (innerHTML, outerHTML, etc.) out of the kernel into a default extension, for consistency with how triggers don't have built-in event names. Tried it — tests failed, and it made the kernel unable to swap without extensions.

**Decision:** Swap styles stay in the kernel. They're "minimal substance" — the DOM mutation primitives that make the kernel actually do something. The kernel sets `detail.swap.handler` to a default that reads `detail.swap.style` lazily from a local map. Extensions can:
- Modify `detail.swap.style` during `config:swap` (e.g., swap-style-aliases)
- Replace `detail.swap.handler` entirely during `config:swap` (e.g., morphing, view transitions)

**Consequences:**
- Kernel is self-sufficient for swapping — works without any extensions
- Swap styles map is internal to the handler closure, not exposed on detail or api
- Consistent with trigger pattern: kernel provides default `bindHandler`, extensions configure it

### 072: Expose Swap Styles as `api.swaps`
**Date:** 2026-02-13 | **Status:** Accepted — *Supersedes ADR-070 consequence "swap styles map is internal"*

**Context:** Swap styles lived as a local `swapStyles` object inside `swap()`. This worked but made the system's capabilities opaque — there was no way to enumerate available swap styles from devtools, tooling, or extensions. An event-only override model (`htmx:config:swap`) works for *modifying* swap behavior, but doesn't let you ask "what swaps exist?" or add a new style without writing an event handler.

Considered:
- **Formal Registry pattern** (`Map` + `registerSwap()` method) — too much ceremony, new pattern to learn
- **Proxy on the object** (throw on duplicate assignment) — too clever, surprising behavior on plain assignment, awkward override ergonomics (`delete` then reassign)
- **Plain object on `api`** — simple, enumerable, zero new patterns

**Decision:** Promote `swapStyles` to `api.swaps`, a plain object. The `swap()` function's default handler reads from `api.swaps`. Extensions add styles via direct assignment:

```js
// In a morph extension's boot handler:
api.swaps.morph = (target, content) => { /* morphdom logic */ }
```

No registration method, no Proxy. Second assignment wins — that's standard JavaScript and developers understand it.

**Consequences:**
- Introspectable: `Object.keys(api.swaps)` in devtools shows available styles
- Extensions add swap styles with a single assignment instead of writing a `config:swap` event handler
- `config:swap` events still work for context-dependent overrides (e.g., inspect response headers to decide swap strategy)
- No new API pattern — it's just an object property

---

### 073: TreeWalker `hx-*` Init Discovery
**Date:** 2026-02-13 | **Status:** Accepted — *Supersedes init detail shape from ADR-071*

**Context:** The kernel's `init()` put a `selectors: []` array on the detail and had a default handler that joined them into a querySelectorAll call. Extensions pushed selectors during `htmx:config:init`. This baked a coordination protocol (the selectors array) into the kernel's event detail — the kernel prescribed CSS selectors as the discovery mechanism, even though it never contributed any selectors itself.

This also meant extensions like `hx-boost` that use non-method attributes couldn't be discovered without explicitly adding their selectors.

Considered:
- **Init every element** — too wasteful, O(all DOM nodes)
- **Keep selectors array** — bakes a protocol into kernel detail that extensions must conform to
- **No-op default handler** — makes kernel useless without extensions, contradicts pragmatic kernel philosophy

**Decision:** The kernel's default init handler uses a TreeWalker to discover elements with any `hx-*` prefixed attribute. The `selectors` array is removed from the detail. The detail shape is now `{root, handler}`.

```js
handler: () => {
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT)
    let node = root
    while (node) {
        for (let i = 0; i < node.attributes.length; i++) {
            if (node.attributes[i].name.startsWith('hx-')) {
                api.initElement(node)
                break
            }
        }
        node = walker.nextNode()
    }
}
```

**Noise reduction:** `initElement` checks after `config:init:element` whether any extension claimed the element (set `detail.url`, added triggers, or registered cleanup callbacks). If nothing was configured, state is deleted and `before/after` events are skipped — no debug noise from unclaimed elements.

Benchmarked at ~300µs for 5000 elements (249 with hx-*) vs ~200µs for targeted selectors. The 100µs difference is imperceptible.

**Consequences:**
- Kernel discovers all `hx-*` elements without knowing specific attribute names
- Extensions like boost work automatically — container with `hx-boost` gets discovered and init'd
- No protocol on the detail — extensions that need custom discovery replace `detail.handler`
- `method-attrs` extension no longer needs a `htmx:config:init` handler
- Unclaimed elements are silently discarded — no WeakMap leak, no event noise

---

### 071: `initElement` Owns the Pipeline Wiring
**Date:** 2026-02-13 | **Status:** Accepted

**Context:** After moving method attribute reading into an extension (`method-attrs`), the kernel's `initElement` had no visible connection to the pipeline — you couldn't see where `api.ajax` was called without reading `htmx.defaults.js`. This made the core pipeline invisible.

**Rejected:** Adding an `api.process(element)` function — too vague, hides the pipeline behind another layer.

**Decision:** `initElement` has a default `detail.handler` that wires `detail.url/method/swap/target/triggers` to `bindTrigger + ajax`. Extensions set these fields during `htmx:config:init:element`; the handler reads them. This keeps the pipeline connection visible in the kernel:

```
config:init:element → extensions set url, method, swap, target, triggers
handler()           → for each trigger, bindTrigger(element, {handler: () => ajax(...)})
```

**Consequences:**
- The kernel shows the full pipeline: init → initElement → bindTrigger → ajax → swap
- `method-attrs` is simplified to just reading attributes onto detail — no pipeline logic
- Other extensions can set url/method/etc. from non-attribute sources (JS API, data attributes, etc.)
- Empty triggers fallback to `[{}]` so the handler always has something to iterate

### 074: Extended Selectors Move from Kernel to Extension
**Date:** 2026-02-13 | **Status:** Accepted

**Context:** The kernel's `find()` included extended selector logic (named targets like `this`/`body`/`document`/`window`, traversal keywords like `closest`/`next`/`previous`, scan helpers) that accounted for ~974 bytes minified / ~210 bytes brotli. This was the single biggest size optimization available. The kernel only needs `querySelector`/`querySelectorAll` for its own operations.

**Rejected:** Keeping extended selectors in the kernel — they're convenience syntax, not core plumbing. No kernel code uses `closest`, `next`, `previous`, etc.

**Decision:** Slim `find()` to just CSS selectors + Element/null passthrough. Move extended selectors to an `extended-selectors` extension in `htmx.defaults.js` that wraps `api.find` at boot, using the same pattern as `inheritance` wraps `api.attr`. Registered first (before `inheritance`) since other extensions may use `api.find` with extended syntax.

**Consequences:**
- Kernel `find()` is 8 lines instead of 52 — minimal CSS-only primitive
- `scanForward`/`scanBackward` helpers move to the extension (closure-scoped)
- Full feature parity preserved — all extended selector syntax works when defaults are loaded
- Kernel-only users get a smaller footprint; they can add extended selectors back if needed

### 075: Trigger Phase Redesign — No Trigger Lists in Kernel, Flat Detail, handler + bind
**Date:** 2026-02-13 | **Status:** Accepted

**Context:** The standalone `addTrigger(element, trigger)` function had an unclear signature. The `trigger` argument was a mystery bag mixing the event callback, event name, modifier flags, and a `bindHandler` function. Extensions accessed nested properties like `detail.trigger.handler`, `detail.trigger.delay`, `detail.trigger.bindHandler` — mixing "what to do" with "when to do it" and "how to attach it." The kernel also iterated trigger lists, which is extension-to-extension data.

**Rejected alternatives:**
- Two separate events (`config:trigger` + `config:trigger:bind`) each with `detail.handler` — cleaner separation but added complexity; the bind event needed a bridge property to access the trigger handler from phase 1.
- Three-arg function `onTrigger(element, callback, spec)` — the kernel shouldn't know about trigger specs; they're extension-to-extension data.
- Plugin fan-out ("fork and cancel") — the multiplexing plugin calls `onTrigger` recursively from inside `config:trigger`, causing recursion issues.
- Keeping trigger list iteration in the kernel — the kernel shouldn't know about trigger lists. That's an extension concern.

**Decision:**
1. Replace `addTrigger` with `createTrigger(element, callback)` — a factory that returns a trigger object with `handler` (lifecycle-wrapped) and `bind` (default addEventListener). Lifecycle events (before:trigger / after:trigger) are baked into handler and cannot be skipped.
2. The kernel's `initElement` handler creates a single trigger via `api.createTrigger`, emits `config:trigger`, then calls `bind()`.
3. Parsed trigger properties are spread flat onto the trigger (`trigger.eventName`, `trigger.delay`, etc.) — no nested `detail.trigger` bag.
4. Split `method-attrs` — new `trigger-attrs` extension handles hx-trigger parsing AND multi-trigger multiplexing by replacing `detail.handler` during `config:init:element`. It uses `api.createTrigger` for each trigger, guaranteeing lifecycle.
5. The kernel knows nothing about trigger lists or trigger specs. It just sets up one trigger per element. Multi-trigger is purely an extension concern.

**Consequences:**
- `createTrigger` replaces `addTrigger` on `api` — cleaner factory pattern
- Lifecycle events are guaranteed — baked into handler by the factory, not by the caller
- `config:trigger` detail is flat and clear — extensions read/write top-level properties
- Two pluggable functions on the trigger, with distinct roles: `handler` (noun — the callback) vs `bind` (verb — the attachment action)
- No trigger setup duplication — both kernel and `trigger-attrs` use `api.createTrigger`

### 076: Formalize api.wrap — First-Class Decorator Pattern
**Date:** 2026-02-13 | **Status:** Accepted

**Context:** Three extensions (extended-selectors, inheritance, parse-dot-path) wrap api functions at boot using an ad-hoc pattern: capture `const original = api.fn`, replace `api.fn = (...) => { ...; original(...) }`. Each does this manually with slightly different styles. The pattern is the core mechanism for cross-cutting concerns, but nothing in the code signals "I am extending this function" vs "I am replacing it."

**Rejected alternatives:**
- Full AOP framework with pointcuts, formal advice types, weaving — overengineering for <20 extensions and a 550-line kernel.
- Proxy-based interception on the api object — runtime overhead, debugging complexity, no meaningful benefit over explicit wrapping.
- Do nothing — the manual pattern works, but inconsistency grows with each new wrapping extension.

**Decision:** Add `api.wrap(name, wrapper)` to the kernel (3 lines). The wrapper receives the original function as its first argument, followed by the caller's arguments:

```js
function wrap(name, wrapper) {
    const original = api[name]
    api[name] = (...args) => wrapper(original, ...args)
}
```

Refactored all three boot-time wrapping extensions to use it.

**Consequences:**
- Consistent pattern — no more manual `const original = api.X; api.X = ...` boilerplate
- Explicit intent — `api.wrap('find', ...)` reads as "extending find," not "replacing find"
- Foundation for future introspection (wrap chain tracking, debug tooling) without committing to it now
- Does NOT add: unwrapping, ordering control, pointcut selection — those are AOP-framework features not needed at this scale

### 077: Remove Trigger Abstraction — Shared Handler + Lightweight config:trigger
**Date:** 2026-02-14 | **Status:** Accepted (supersedes ADR-075)

**Context:** ADR-075 introduced `setupTrigger` as a kernel primitive — a factory that builds a trigger detail with `handler` + `bind`, emits `config:trigger`, and calls `bind()`. This created a "trigger" abstraction the kernel doesn't need. The kernel already has `api.on` (addEventListener + cleanup) and lifecycle events. Triggers are just "listen for an event, then run the pipeline."

**Key insight:** The trigger handler (what runs when the event fires) is a shared concern — the kernel creates it once, and all triggers reuse it. The wiring (how to attach the listener) is a separate concern. These two responsibilities map cleanly to two detail properties: `detail.trigger.handler` and `detail.handler`.

**Rejected alternatives:**
- Keep `setupTrigger` but rename to `setupListener` — same abstraction, different name.
- Remove `config:trigger` entirely — loses the handler-wrapping point needed for future features like `hx-confirm`.
- Put `listenOn`, `delay`, `throttle` on the `config:init:element` detail — kernel shouldn't know about these; they're defaults-layer concerns.
- Two named handler variables (`triggerHandler`/`initHandler`) — inconsistent with single `handler` pattern used in every other pipeline event.

**Decision:**

1. **Remove `setupTrigger` from the kernel.** No trigger factory, no `bind` function.

2. **Keep `config:trigger` as a lightweight handler-wrapping point.** The kernel emits `htmx:config:trigger` with `detail.trigger` (containing `{element, handler}`). Extensions like a future `hx-confirm` can wrap `detail.trigger.handler` here. This is not a trigger abstraction — it's the same handler-as-data pattern used by every other pipeline phase.

3. **`detail.trigger.handler`** — the kernel creates this once. It runs each time the event fires: `preventDefault`, emit `before:trigger`, call `api.ajax`, emit `after:trigger`. All triggers reuse this same handler, so lifecycle events and `config:trigger` wrapping apply uniformly.

4. **`detail.handler`** — how to wire the listener. Default: one `api.on` call. `trigger-attrs` replaces this for multi-trigger, reusing `detail.trigger.handler` throughout. Zero duplication.

5. **`api.on` becomes the fourth wrappable primitive**, alongside `find`, `attr`, `parse`:
   ```
   api.find  ← extended-selectors
   api.attr  ← inheritance
   api.parse ← parse-dot-path
   api.on    ← delay, throttle
   ```
   Extensions wrap `api.on` to process custom options (e.g., `options.delay`).

6. **`trigger-attrs`** replaces `detail.handler` and reuses `detail.trigger.handler`:
   ```js
   detail.handler = () => {
       const handler = detail.trigger.handler  // reuse kernel's handler
       for (const t of triggers) {
           api.on(element, t.eventName, handler, {delay: t.delay, once: t.once})
       }
   }
   ```
   Handles `load` (queueMicrotask), `every` (setInterval), `from` (resolve target), `once` (native option).

7. **Kernel `initElement` flow:**
   ```js
   detail.trigger = {element}
   detail.trigger.handler = (event) => { /* preventDefault, before:trigger, ajax, after:trigger */ }
   detail.handler = () => { if (detail.eventName) api.on(element, detail.eventName, detail.trigger.handler) }

   emit('htmx:config:init:element', detail)  // extensions populate request, swap, eventName
   emit('htmx:config:trigger', detail.trigger)  // extensions can wrap trigger.handler
   detail.handler()  // wire it up
   ```

**Consequences:**
- Kernel has no trigger abstraction. `setupTrigger` removed entirely.
- `detail.trigger.handler` created once by kernel, reused by all triggers — zero duplication between kernel and `trigger-attrs`.
- `config:trigger` survives as a thin handler-wrapping point (same pattern as `config:request`, `config:swap`).
- `delay`/`throttle` wrap `api.on` — consistent with `find`/`attr`/`parse` wrapping pattern.
- `load`/`every`/`from`/`once` handled by `trigger-attrs` — no separate extensions needed.
- Each config event has exactly one `handler` — consistent naming throughout the pipeline.

### 078: Rename Init/Cleanup Events — Unsuffixed = Element, `:all` = Subtree
**Date:** 2026-02-14 | **Status:** Accepted

**Context:** The events `htmx:config:init` (subtree walk) and `htmx:config:init:element` (single element) had counterintuitive naming. Users hearing "config:init" expect it to mean "an element is being initialized," not "the global tree-walking process is being configured." The `:element` suffix made the primary concept feel like a sub-concept. Same issue with `cleanup` / `cleanup:element`.

**Rejected alternatives:**
- Introduce new terms (`discover`/`sweep` for subtree, `init`/`cleanup` for element) — adds vocabulary. User preferred keeping concept count low.
- Keep current naming — counterintuitive for users listening for events.

**Decision:** Flip the suffix. The unsuffixed event is the intuitive one (element-level). The subtree walk gets `:all`:

| Old name | New name | Meaning |
|---|---|---|
| `config:init` | `config:init:all` | Subtree walk |
| `before:init` | `before:init:all` | Subtree walk |
| `after:init` | `after:init:all` | Subtree walk |
| `config:init:element` | `config:init` | Single element |
| `before:init:element` | `before:init` | Single element |
| `after:init:element` | `after:init` | Single element |
| `config:cleanup` | `config:cleanup:all` | Subtree walk |
| `before:cleanup` | `before:cleanup:all` | Subtree walk |
| `after:cleanup` | `after:cleanup:all` | Subtree walk |
| `before:cleanup:element` | `before:cleanup` | Single element |
| `after:cleanup:element` | `after:cleanup` | Single element |

Function names stay as-is: `init()` (subtree), `initElement()` (single element). The slight mismatch is fine — `init()` genuinely does both (discovers and initializes), and the events separate those phases.

**Consequences:**
- `htmx:config:init` now means what users expect — "an element is being initialized."
- No new vocabulary. Same two terms (`init`, `cleanup`), just flipped suffix.
- All defaults updated: `method-attrs`, `default-trigger`, `trigger-attrs`, `boost` now listen on `htmx:config:init` (element). `boost` subtree hook uses `htmx:after:init:all`.

### 079: Universal Event Detail Contract — `{element, handler}`
**Date:** 2026-02-14 | **Status:** Accepted

**Context:** Event details had inconsistent structure across events. Subtree walk events used `detail.root`, ajax used `detail.source`, init used `detail.element`. Handler location varied: top-level on init events, nested on ajax phases (`detail.request.handler`, `detail.response.handler`, `detail.swap.handler`). No universal contract that an extension author could rely on.

htmx 2.0 has the same problem (ad-hoc per event) but at least injects `detail.elt` into every event via `triggerEvent()`. We can do better.

**Rejected alternatives:**
- Per-phase detail objects (each ajax phase gets its own flat detail) — loses cross-phase visibility. Extensions in `config:swap` can't see request URL; `config:request` can't see swap target.
- Flat everything (no grouping) — name collisions between request and response (`url`, `headers` mean different things).
- Keep `source`/`root` for semantic clarity — breaks the universal contract, which is the whole point.

**Decision:**

Universal contract for all event details:
- **`element`** — always present. The element this event concerns (was `root` in init:all, `source` in ajax).
- **`handler`** — always present on `config:*` events, always top-level. Reassigned per phase in ajax. Modifiable only during `config:*` (convention — `before:*` is for cancellation, not configuration).
- Everything else is phase-specific "kwargs" that specific extensions produce/consume.

Phase data is grouped to avoid name collisions: `detail.request.url`, `detail.response.url`, `detail.swap.target`. Handler is the exception — always promoted to top level so extensions always do `detail.handler = ...` regardless of which phase.

**Full event detail map:**

```
config:init:all     {element, handler}
config:init         {element, handler, trigger: {element, eventName}, request: null, swap: null}
config:trigger      {element, handler, trigger: {element, eventName}, request, swap}
before:trigger      {element, event}
after:trigger       {element, event}
config:request      {element, handler, request: {url, method, headers, body}, swap: {...}}
config:response     {element, handler, request: {...}, response: {raw, status, ok, ...}, swap: {...}}
config:swap         {element, handler, request: {...}, response: {...}, swap: {content, target, style}}
htmx:done           {element, handler, request, response, swap, error: null}
htmx:error          {element, handler, request, response, swap, error: Error}
htmx:finally        {element, handler, request, response, swap, error}
config:cleanup:all  {element, handler}
before:cleanup      {element}
after:cleanup       {element}
```

*Updated by ADR-082: `trigger.handler` removed, `config:trigger` receives full detail, `htmx:done`/`htmx:error`/`htmx:finally` split (ADR-080).*

**Consequences:**
- Extension authors can rely on `detail.element` and `detail.handler` everywhere.
- `detail.handler = myFn` works the same in `config:request`, `config:swap`, `config:init` — no need to remember `detail.request.handler` vs `detail.swap.handler`.
- Ajax handler no longer needs to destructure itself out of `detail.request` for fetch — cleaner default handler.
- `source` eliminated as a concept. `element` is "who this event concerns." `swap.target` is "where the response goes."
- Phase data stays grouped (request, response, swap) — collision-free, semantically clear.

### 080: Kernel Polish — Errors, Guards, Event Naming
**Date:** 2026-02-14 | **Status:** Accepted

**Context:** Several small inconsistencies accumulated: `=== false` checks were unexpressive, error handling was ad-hoc (mix of `new Error` and `new HtmxError`, inconsistent messages, no runtime error visibility), and the ajax pipeline had a single `htmx:done` event that carried both success and error — like responding 200 with an error body.

**Decision:**

1. **`canceled()` predicate** — `const canceled = (result) => result === false`. Every emit guard now reads `if (canceled(api.emit(...))) return`.

2. **`HtmxError` convention** — follows standard `Error(message, options)` signature. Type goes in options: `new HtmxError('message', {type: 'SWAP_TARGET_MISSING'})`. Supports native `cause` chaining.

3. **Error types** — descriptive, max 3 words: `EXTENSION_ALREADY_REGISTERED`, `EXTENSION_DEPENDENCY_MISSING`, `EVENT_NAME_MISSING`, `SWAP_TARGET_MISSING`, `SWAP_STYLE_UNKNOWN`, `REQUEST_URL_MISSING`, `WRAP_TARGET_MISSING`.

4. **Two error mechanisms** (documented in file header):
   - `throw HtmxError` — programmer error (bad args, misconfiguration). Crashes immediately. Inside ajax pipeline, caught and converted to htmx:error.
   - `htmx:error` event — runtime error during ajax. Logged to console, available on `detail.error`.

5. **Ajax outcome events** — map to try/catch/finally:
   - `htmx:done` — success only (end of try)
   - `htmx:error` — failure only (catch), `detail.error` set, `console.error` logged
   - `htmx:finally` — always runs (finally)

**Consequences:**
- Every guard is self-documenting. The `=== false` distinction is explained once.
- Error messages are consistent: plain English, no prefix, subject first.
- Runtime errors are never silent — console.error + event.
- Extensions can react to errors (`htmx:error`) or do cleanup (`htmx:finally`) without checking `detail.error` on a success event.

---

### 081: Swap/Ajax Public vs Internal Split
**Date:** 2026-02-14 | **Status:** Accepted

**Context:** `swap()` was polymorphic — it sniffed `options.swap` to guess whether it received flat public options or a pipeline detail. `ajax()` similarly mixed normalization with pipeline logic.

**Decision:** Separate concerns:
- **`api.swap(detail)` / `api.ajax(options)`** — internal pipeline functions. Accept pipeline-shaped detail. Wrappable by extensions via `api.wrap`.
- **`htmx.swap(options)` / `htmx.ajax(options)`** — public API methods (not getters). Normalize flat user options to pipeline shape, then call `api.*`. Extra keys forwarded as modifiers (kwargs pattern): swap modifiers go to `detail.swap`, request modifiers go to `detail.request`.

**Consequences:**
- No more shape sniffing. Internal functions always get pipeline detail.
- Extensions wrapping `api.swap`/`api.ajax` always see pipeline shape.
- Public API supports kwargs: `htmx.swap({style: 'innerHTML', transition: true})`.
- `htmx.ajax` accepts `swap` as string shorthand or object with modifiers.

---

### 082: Remove URL Gate, Flatten Handler, Inline Wiring
**Date:** 2026-02-14 | **Status:** Accepted

**Context:** `initElement` had `if (!detail.request?.url) return` — encoding "every htmx element does HTTP" into the kernel. This would block SSE/WebSocket extensions. Additionally, `detail.trigger.handler` (per-fire) and `detail.handler` (wiring) were two different concepts using the same name at different nesting levels.

**Decision:**

1. **Remove URL gate** — extensions cancel `config:init` if they don't want an element. The default wiring handler already no-ops when eventName is null. WeakMap state on unclaimed elements is cheap (GC'd automatically).

2. **Flatten handler** — `detail.trigger.handler` promoted to `detail.handler`. One handler, always means "what runs when triggered." `detail.trigger` becomes pure data: `{element, eventName}`.

3. **Inline wiring** — kernel wires inline after `config:trigger`:
   ```js
   if (detail.trigger.eventName) api.on(element, detail.trigger.eventName, detail.handler)
   ```
   Extensions that do their own wiring (trigger-attrs for multi-trigger) null `detail.trigger.eventName` to prevent default. Elements without DOM triggers (SSE, WebSockets) leave eventName null.

4. **trigger-attrs moved to config:trigger** — reads `detail.handler` directly, does its own `api.on` calls, nulls eventName.

**Consequences:**
- Kernel is transport-agnostic. SSE/WebSocket extensions can participate in the full init lifecycle.
- One `detail.handler` everywhere — always means "the strategy to execute."
- `detail.trigger` is just config data, no nested handler.
- `config:trigger` is where all trigger wiring happens (kernel default + extensions).

### 083: Single Source File — Core Pipeline Inline, Extensions for Third Parties
**Date:** 2026-02-15 | **Status:** Accepted

**Context:** The kernel/standard split (two files) and `api.expose()` were over-engineering. htmx's value is simplicity. An ~600-line library doesn't need a microkernel + standard extension + API slots. The core pipeline functions (parse, find, attr, swap, ajax) are the engine — they should be inline code. The extension system (register, wrap, emit) is valuable for third-party extensions but the core shouldn't be forced through it.

**Decision:**

1. **One source file** (`src/htmx.js`, ~600 lines) with the complete engine: parse, find, attr, swap, ajax, init/cleanup, events, wrap, register, emit, on.
2. **Extensions for behaviors** — method attrs, default triggers, trigger parsing, config defaults, delay, throttle, swap aliases, etc. are `htmx.register()` calls in `src/extensions/`.
3. **Kill** kernel/standard split, `api.expose()`, API slots.
4. **Keep** `register()`, `wrap()`, `emit()` for third-party and built-in extensions.

**Consequences:**
- Source IS the readable file — no "read the build artifact" indirection.
- Extensions are individually replaceable — someone could use `data-action` instead of `hx-get`.
- Assembler injects extensions into the single file for distribution.

### 084: Extension Naming — Each Attribute Is a Separate Register Call
**Date:** 2026-02-15 | **Status:** Accepted

**Context:** Grouping behaviors under abstract names like "method-attrs" and "standard" made it unclear what each extension does. The name should be the documentation.

**Decision:**

Each `hx-*` attribute gets its own `htmx.register('hx-get', ...)` call. One file can contain multiple register calls (e.g., `hx-methods.js` has hx-get through hx-delete). Non-attribute defaults are grouped as `htmx.register('defaults', ...)`.

Extension files:
- `hx-methods.js` — hx-get, hx-post, hx-put, hx-patch, hx-delete
- `hx-swap.js`, `hx-target.js`, `hx-trigger.js`, `default-trigger.js`
- `defaults.js` — config, swap defaults/aliases, request defaults/timeout
- `delay.js`, `throttle.js`
- `extended-selectors.js`, `inheritance.js`, `parse-dot-path.js`, `boost.js`

**Consequences:**
- Looking at the extension list immediately tells you what htmx supports.
- Each register call is self-contained and self-documenting.

### 085: Assembler Emit-Site Inlining — No Register in Output
**Date:** 2026-02-15 | **Status:** Accepted

**Context:** The assembled output should contain zero `register()` calls. Built-in extension behavior should be inline code at the relevant call sites, not dispatched through the extension event loop.

**Decision:**

The assembler performs two types of inlining:

1. **Boot handlers** — bodies injected between `// ── Extensions: Start` and `// ── Extensions: End` markers. These run at script load time (wraps, config setup).

2. **Event handlers** — bodies injected at matching `api.emit()` call sites. A `before:init` handler body is placed right before `api.emit(element, 'htmx:before:init', detail)`. The emit still fires for third-party runtime extensions.

Cancellation: `return false` in handler bodies is converted to `return` when inlined — exits the enclosing function, equivalent to emit-loop cancellation.

**Parameter validation:** Handler params must be `(detail, api)` (or `_` if unused). The assembler validates this at build time with Rust-style error messages:
```
error: extension 'bad-ext' handler for 'htmx:before:init' has invalid parameter names
  --> src/extensions/bad.js:3:5
   |
 3 |     (d, a) => {
   |     ^^^^^^
   = help: first parameter 'd' — expected 'detail' (or '_' if unused)
```

**Consequences:**
- Zero overhead for built-in extensions — they're inline code.
- `register()` exists purely as the third-party runtime API.
- Assembled output is readable — each inlined block is tagged with `[extension-name]`.
- Behavioral equivalence: same semantics as register + emit loop, validated by running tests against both source and assembled builds.

### 086: Remove `request`/`swap` from initElement Detail — JIT at Trigger Time
**Date:** 2026-02-17 | **Status:** Accepted

**Context:** `initElement()` built a detail object with `request` and `swap` fields that extensions populated during `before:init`. These were captured in a closure and used later when the trigger fired. This had two problems: (1) it coupled the kernel to ajax concepts — WebSocket/WebTransport extensions don't use request/swap, so those fields are meaningless noise; (2) attribute values were frozen at init time, so dynamic attribute changes (e.g., `element.setAttribute('hx-get', '/new-url')`) had no effect. Continues the JIT direction from ADR-007.

**Rejected alternatives:**
- **Keep request/swap on init detail** — convenient closure, but couples kernel to HTTP and prevents dynamic attributes
- **`api.resolve(element)` on the kernel** — wrappable JIT reader, but still makes the kernel aware of ajax-shaped config (superseded)

**Decision:** Strip `request` and `swap` from the init detail. `initElement` only configures the trigger (`eventName`, `execute`, `init.execute`). The default `trigger.execute` emits `before:trigger` / `after:trigger` — nothing else. Core extensions hook `before:trigger` to read attributes JIT via `api.attr()` and call `api.ajax()`.

**Consequences:**
- Kernel has no knowledge of HTTP, requests, or response handling
- WebSocket/SSE extensions use the same lifecycle without unused fields
- Dynamic attribute changes work — attributes are read fresh each trigger fire
- `ajax()` moves out of the kernel into core extensions (see ADR-087)

---

### 087: Move `ajax()` from Kernel to Core Extension
**Date:** 2026-02-17 | **Status:** Accepted

**Context:** With ADR-086 removing request/swap from the init detail, the kernel's trigger.execute no longer calls ajax. The kernel has no HTTP awareness. Having `ajax()` defined in the kernel contradicts this — it's HTTP transport, not lifecycle.

**Rejected alternatives:**
- **Keep ajax in kernel** — convenient, but the kernel should be transport-agnostic. WebSocket and SSE are equally valid transports.

**Decision:** Move `ajax()` to a core extension. Installed on `api.ajax` at boot time (same pattern as `api.parse`). The public `htmx.ajax()` getter exposes it. The kernel defines the lifecycle; core extensions define the transport.

**Consequences:**
- Kernel is purely lifecycle + DOM primitives (swap, init/cleanup, events, utilities)
- `ajax` is a core extension that installs `api.ajax` at boot
- Extensions that need HTTP call `api.ajax()` — still available, just not kernel-defined
- Public API unchanged — `htmx.ajax()` still works via getter delegation

---

### 088: Remove Swap Styles Registry — Use `before:swap` Instead
**Date:** 2026-02-17 | **Status:** Accepted (supersedes ADR-070, ADR-072)

**Context:** The kernel had `api.swaps`, a plain object registry mapping style names to functions. This was a third extension mechanism alongside events (`before:*` → replace `execute()`) and wrappers (`api.wrap()`). Three mechanisms is two too many.

**Rejected alternatives:**
- **Keep `api.swaps` registry** — convenient one-liner to add styles, but it's a separate dispatch mechanism that duplicates what `before:swap` already provides

**Decision:** Remove `api.swaps`. The kernel's default `swap.execute` handles the standard DOM insertion methods (innerHTML, outerHTML, beforebegin, afterbegin, beforeend, afterend, delete, none). Custom swap styles hook `before:swap`, check `detail.swap.style`, and replace `detail.swap.execute`. This is the same `before:*` → replace `execute()` pattern used by every other phase.

**Consequences:**
- One fewer concept in the kernel. Two extension mechanisms: events and wrappers.
- Adding a morph swap: hook `before:swap`, check style, replace execute. Standard pattern.
- Built-in styles live in the kernel's default execute — no registry lookup, just a switch/if-chain.

### 089: Pipeline Context — Transport-Agnostic Detail with Namespaces
**Date:** 2026-02-17 | **Status:** Accepted

**Context:** `swap(detail)` received the full HTTP pipeline detail (`{element, request, response, swap}`). This coupled a kernel function to HTTP-specific fields. But swap genuinely needs access to upstream context — a morph extension reads `detail.response.headers` during `before:swap`, a logging extension might read connection info. The question: how does context flow through without coupling swap to a specific transport?

**Rejected alternatives:**
- **Flat options `swap({element, content, target, style})`** — clean signature, but loses pipeline context. Extensions at `before:swap` can't see upstream info (response headers, connection state). Would require ad-hoc workarounds.
- **Separate context parameter `swap(options, context)`** — two args, unclear ownership, extensions would need to know which arg to modify.

**Decision:** The detail is a **pipeline context** — a shared object that flows through the entire pipeline for a given action. Each transport owns its own namespace; the kernel only reads what it needs:

```
HTTP:          {element, request, response, swap: {content, target, style}}
WebSocket:     {element, connection, message, swap: {content, target, style}}
SSE:           {element, source, event, swap: {content, target, style}}
Programmatic:  {element, swap: {content, target, style}}
```

The kernel's `swap()` reads `detail.element` and `detail.swap.*`. Everything else is pass-through context that extensions can read across namespaces. The kernel is transport-agnostic not because it ignores context, but because it doesn't define or require transport-specific namespaces.

**Consequences:**
- `swap(detail)` is the correct signature — detail is not "an HTTP detail", it's "a pipeline context"
- Each transport defines its own namespaces (request/response for HTTP, connection/message for WebSocket)
- Extensions can read across namespaces (morph reads `detail.response` at `before:swap`)
- The kernel documents which namespaces it reads; everything else is pass-through
- Same pattern applies to any future kernel function that participates in a pipeline

---

## Session State (2026-02-17) — Snapshot, may be stale

### What's done
- All previous work (ADRs 001-085)
- **ADR-086**: Remove request/swap from initElement detail. JIT attribute reading at trigger time. Kernel has no HTTP awareness.
- **ADR-087**: Move ajax() from kernel to core extension. Installed on api.ajax at boot (like api.parse).
- **ADR-088**: Remove api.swaps registry. Custom swap styles use before:swap → replace execute(). Two extension mechanisms only: events and wrappers.
- **ADR-089**: Pipeline context with namespaces. swap(detail) reads detail.element and detail.swap.*; transport-specific fields (request, response, connection, message) are pass-through for extensions.

### Kernel scope (after ADRs 086-088)
- **Lifecycle:** init, initElement, cleanup, cleanupElement, boot, MutationObserver
- **DOM primitives:** swap (with built-in styles in default execute)
- **Events:** emit, on
- **Utilities:** find, attr, wrap
- **State:** elements WeakMap, config, extensions

NOT in kernel: ajax, parse, resolve, swap registry. These are core extensions.

### Pending kernel changes
- [ ] Strip request/swap from initElement detail, make default trigger.execute just emit before:trigger / after:trigger
- [ ] Move ajax() to core extension (install on api.ajax at boot)
- [ ] Remove api.swaps registry, move built-in styles into default swap.execute
- [ ] Add execute() to cleanupElement for lifecycle uniformity
- [ ] Move swap preprocessing (target resolution, content parsing) into swap.execute

### File layout
- **`src/htmx.kernel.js`** — Lifecycle + DOM primitives. No HTTP awareness.
- **`src/htmx.core.js`** — All behavior: ajax, parse, hx-* attributes, triggers, defaults.
- **`src/extensions/`** — Optional extensions.
- **`tools/assembler/`** — Rust assembler. Inlines extensions at emit sites.
- **`dist/htmx.js`** — Assembled output.

---

## Parking Lot

Ideas worth preserving for later consideration. Not committed to.

| Idea                        | Category  | Description                                                                                                                                                                                                                                                                                                                |
|-----------------------------|-----------|----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------|
| `htmx:arrival`              | Event     | Fires on each top-level element added by any swap. Replaces htmx 2.0's `htmx:load`. For reacting to new DOM without `hx-*` attributes.                                                                                                                                                                                     |
| Chainable Layer 3 API       | API       | `htmx.on('#btn', 'click').get('/api', { target: '#result' })`. Declarative JS equivalent of attributes. Deferred until Layer 2 is designed.                                                                                                                                                                                |
| `CANCELLED` sentinel        | Pipeline  | Symbol returned from pipeline to short-circuit without error. Cleaner than `return false` for "intentionally stopped."                                                                                                                                                                                                     |
| `detail.waitUntil(promise)` | Pipeline  | Async extension hooks that delay the pipeline (e.g., confirm dialogs, async validation).                                                                                                                                                                                                                                   |
| ~~RelaxedJSON parser~~      | Parsing   | ~~Dot notation — addressed by ADR-054 (dot-path expansion extension)~~                                                                                                                                                                                                                                                      |
| Reactive state → DOM sync   | State     | `element.state` changes auto-reflect to DOM attributes or text.                                                                                                                                                                                                                                                            |
| `htmx.inspect(element)`     | Debug     | Returns all htmx state/config for an element.                                                                                                                                                                                                                                                                              |
| `hx-debug`                  | Debug     | Per-element debug flag (registered feature, not kernel).                                                                                                                                                                                                                                                                   |
| Trace mode                  | Debug     | Opt-in logging (`htmx.config.debug = true` or `['request', 'swap']`). Logs extension, detail, cancellations.                                                                                                                                                                                                               |
| `hx-on` shorthands          | Attribute | `hx-on::init` maps to `htmx:before:init`, etc. (see ADR-017).                                                                                                                                                                                                                                                              |
| `hx-on` unified syntax      | Attribute | `hx-on="click from:body throttle:500 => { handler() }; input => { other() }"`. Reuses trigger parser for event+modifiers, adds `=> {body}` and `;` separator. Enables modifier support (`from`, `throttle`, `debounce`, `once`) that `hx-on:event` can't express. Own MutationObserver since can't CSS-select `[hx-on:*]`. |
| ~~Universal attribute parser~~| Parsing | ~~Addressed by ADR-054 — universal `parse(text)` with protect-and-restore extensibility~~                                                                                                                                                                                                                                   |
| View transitions queue      | Swap      | Coordinate multiple concurrent view transitions.                                                                                                                                                                                                                                                                           |
| Configurable selectors      | Extension | Extensions register custom selector syntax (`closest`, `find`, `next`, `previous`).                                                                                                                                                                                                                                        |
| Meta config dot-path        | Config    | `<meta name="htmx.config.swap.method" content="outerHTML">`.                                                                                                                                                                                                                                                               |
| CDN bundle builder          | Tooling   | Landing page with checkboxes → `cdn.htmx.org/4.0/htmx.min.js?ext=focusRestore,sse`. CF Worker concatenates + caches.                                                                                                                                                                                                       |
| `AbortSignal.timeout()`     | Modern JS | Replace manual `setTimeout` + `AbortController` in timeout extension. Cleaner request timeout handling.                                                                                                                                                                                                                    |
| `AbortSignal.any()`         | Modern JS | Combine user cancel + timeout signals in sync extension. Eliminates manual signal tracking.                                                                                                                                                                                                                                |
| `element.checkVisibility()` | Modern JS | Replace `offsetWidth > 0 && offsetHeight > 0` hack for `revealed` trigger. Native visibility check.                                                                                                                                                                                                                        |
| ~~Extension compiler~~      | Tooling   | ~~Implemented as ADR-085: assembler emit-site inlining.~~ |
| Debug trace extension       | Debug     | Extension that visualizes the full execution path in console: wrapper chains, event handler invocations, detail mutations. Shows indented tree like `ajax() → swap-style-aliases wrapper → emit(htmx:before:swap) → [default-swap] handler`. More detailed than trace mode — shows wrappers too, not just events.             |

