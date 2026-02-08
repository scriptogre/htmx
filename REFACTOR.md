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

## Decisions

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

### 025: Config Structure Redesign — Flat Config + Registry
**Date:** 2026-02-06 | **Status:** In Progress

**Context:** ADR-023 used nested config (`config.trigger.event`, `config.swap.method`). This created confusion:
- `config.trigger.registry` (implementations) mixed with `config.trigger.event` (default value)
- Unclear what's a "value" vs an "implementation"
- Extensions need to reach deep paths

**Decision:** Separate concerns completely:

```js
// CONFIG: values (static or functions)
config = {
    defaultTrigger: (node) => ...,    // corresponds to hx-trigger
    defaultSwap: 'innerHTML',          // corresponds to hx-swap
    defaultTarget: 'this',             // corresponds to hx-target

    requestTimeout: 60000,
    requestCredentials: 'same-origin',
    requestMode: 'same-origin',
    requestHeaders: { ... },

    syntaxPrefix: 'hx-',               // escape hatch
    syntaxDelimiter: ':',              // escape hatch

    selectors: [],                     // extensions push to this
}

// REGISTRY: implementations (always functions)
registry = {
    swaps: {},                         // method → fn(target, content)
    triggers: {},                      // name → fn(element, modifiers, handler)
    modifiers: {
        trigger: {},                   // name → fn(handler, value, element)
    },
}
```

**Key principles:**
1. **Config = values**, can be static or functions, use `resolve(config.X, context)`
2. **Registry = implementations**, always functions, extensions populate at `htmx:ready`
3. **`request*` prefix** for fetch API options (global, not per-element)
4. **`default*` prefix** for values that correspond to `hx-*` attributes (per-element defaults)
5. **`syntax*` prefix** for escape hatches (when `hx-*` conflicts with your stack)

**Open question:** Naming consistency. We have:
- `defaultTrigger`, `defaultSwap`, `defaultTarget` — consistent
- `requestTimeout`, `requestCredentials`, `requestMode`, `requestHeaders` — consistent
- `syntaxPrefix`, `syntaxDelimiter` — consistent within group, but...

Is this the right grouping? Alternatives discussed but not resolved:
- Everything `default*`: `defaultRequestTimeout` (verbose)
- Drop prefixes: `trigger`, `swap`, `target`, `timeout` (ambiguous)
- Different grouping entirely?

**Current file:** `src/htmx.core.js` (~380 lines)

**Consequences:**
- Clear separation of concerns
- Extensions populate registry, not config
- `resolve()` exported for extensions to use same pattern
- Naming question remains open

---

## Parking Lot

Ideas worth preserving for later consideration. Not committed to.

| Idea                        | Category  | Description                                                                                                                                                                                                                                                                                                                |
|-----------------------------|-----------|----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------|
| `htmx:arrival`              | Event     | Fires on each top-level element added by any swap. Replaces htmx 2.0's `htmx:load`. For reacting to new DOM without `hx-*` attributes.                                                                                                                                                                                     |
| Chainable Layer 3 API       | API       | `htmx.on('#btn', 'click').get('/api', { target: '#result' })`. Declarative JS equivalent of attributes. Deferred until Layer 2 is designed.                                                                                                                                                                                |
| `CANCELLED` sentinel        | Pipeline  | Symbol returned from pipeline to short-circuit without error. Cleaner than `return false` for "intentionally stopped."                                                                                                                                                                                                     |
| `detail.waitUntil(promise)` | Pipeline  | Async extension hooks that delay the pipeline (e.g., confirm dialogs, async validation).                                                                                                                                                                                                                                   |
| RelaxedJSON parser          | Parsing   | Dot notation in `hx-vals`/`hx-headers` (e.g., `hx-vals="user.name: 'John'"`).                                                                                                                                                                                                                                              |
| Reactive state → DOM sync   | State     | `element.state` changes auto-reflect to DOM attributes or text.                                                                                                                                                                                                                                                            |
| `htmx.inspect(element)`     | Debug     | Returns all htmx state/config for an element.                                                                                                                                                                                                                                                                              |
| `hx-debug`                  | Debug     | Per-element debug flag (registered feature, not kernel).                                                                                                                                                                                                                                                                   |
| Trace mode                  | Debug     | Opt-in logging (`htmx.config.debug = true` or `['request', 'swap']`). Logs extension, detail, cancellations.                                                                                                                                                                                                               |
| `hx-on` shorthands          | Attribute | `hx-on::init` maps to `htmx:before:init`, etc. (see ADR-017).                                                                                                                                                                                                                                                              |
| `hx-on` unified syntax      | Attribute | `hx-on="click from:body throttle:500 => { handler() }; input => { other() }"`. Reuses trigger parser for event+modifiers, adds `=> {body}` and `;` separator. Enables modifier support (`from`, `throttle`, `debounce`, `once`) that `hx-on:event` can't express. Own MutationObserver since can't CSS-select `[hx-on:*]`. |
| Universal attribute parser  | Parsing   | Single parser for all `hx-*` values (modifiers, selectors, expressions).                                                                                                                                                                                                                                                   |
| View transitions queue      | Swap      | Coordinate multiple concurrent view transitions.                                                                                                                                                                                                                                                                           |
| Configurable selectors      | Extension | Extensions register custom selector syntax (`closest`, `find`, `next`, `previous`).                                                                                                                                                                                                                                        |
| Meta config dot-path        | Config    | `<meta name="htmx.config.swap.method" content="outerHTML">`.                                                                                                                                                                                                                                                               |
| CDN bundle builder          | Tooling   | Landing page with checkboxes → `cdn.htmx.org/4.0/htmx.min.js?ext=focusRestore,sse`. CF Worker concatenates + caches.                                                                                                                                                                                                       |
| `AbortSignal.timeout()`     | Modern JS | Replace manual `setTimeout` + `AbortController` in timeout extension. Cleaner request timeout handling.                                                                                                                                                                                                                    |
| `AbortSignal.any()`         | Modern JS | Combine user cancel + timeout signals in sync extension. Eliminates manual signal tracking.                                                                                                                                                                                                                                |
| `element.checkVisibility()` | Modern JS | Replace `offsetWidth > 0 && offsetHeight > 0` hack for `revealed` trigger. Native visibility check.                                                                                                                                                                                                                        |

