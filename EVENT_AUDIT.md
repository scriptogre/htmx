# htmx Event Audit

Mapping current events to proposed 7-event model.

## Legend

- **Cancel** = Handler can prevent default behavior
- **Modify** = Handler can change data in detail object
- **Observe** = Handler can only watch, no control

## Current Events → Proposed Mapping

### Initialization & Processing

| Current Event                    | Can Do  | Maps To         | Notes                                     |
|----------------------------------|---------|-----------------|-------------------------------------------|
| `htmx:before:init`               | Cancel  | `htmx:activate` | ✓ Before element gets htmx behaviors      |
| `htmx:after:init`                | Observe | `htmx:activate` | ✓ Fold into single event with phase flag? |
| `htmx:before:process`            | Cancel  | `htmx:activate` | ✓ Same as init but for subtree            |
| `htmx:after:process`             | Observe | `htmx:activate` | ✓ Used by onLoad callbacks                |
| `htmx:after:implicitInheritance` | Observe | (internal)      | Extension-only, maybe not needed publicly |

### Cleanup

| Current Event         | Can Do  | Maps To           | Notes                        |
|-----------------------|---------|-------------------|------------------------------|
| `htmx:before:cleanup` | Observe | `htmx:deactivate` | ✓ Before removing htmx state |
| `htmx:after:cleanup`  | Observe | `htmx:deactivate` | ✓ After cleanup complete     |

### Request Lifecycle

| Current Event          | Can Do         | Maps To         | Notes                               |
|------------------------|----------------|-----------------|-------------------------------------|
| `htmx:config:request`  | Cancel, Modify | `htmx:request`  | ✓ Merge - both configure request    |
| `htmx:confirm`         | Cancel         | **GAP**         | ⚠️ Needs user interaction, async    |
| `htmx:before:request`  | Cancel, Modify | `htmx:request`  | ✓ Primary request hook              |
| `htmx:after:request`   | Cancel         | `htmx:response` | ✓ After fetch, before swap decision |
| `htmx:error`           | Observe        | `htmx:done`     | ✓ Error in detail.error             |
| `htmx:finally:request` | Observe        | `htmx:done`     | ✓ Always fires                      |
| `htmx:abort`           | (listened to)  | (special)       | Element listens for abort signal    |

### Swap & Settle

| Current Event        | Can Do         | Maps To     | Notes                                      |
|----------------------|----------------|-------------|--------------------------------------------|
| `htmx:before:swap`   | Cancel, Modify | `htmx:swap` | ✓ Can modify tasks, cancel swap            |
| `htmx:after:swap`    | Observe        | `htmx:swap` | ✓ After DOM updated                        |
| `htmx:before:settle` | Observe        | **GAP?**    | ⚠️ Settle = post-swap CSS transition phase |
| `htmx:after:settle`  | Observe        | **GAP?**    | ⚠️ After htmx-added class removed          |

### History

| Current Event                     | Can Do  | Maps To  | Notes                             |
|-----------------------------------|---------|----------|-----------------------------------|
| `htmx:before:history:update`      | Cancel  | **GAP?** | ⚠️ Before pushState/replaceState  |
| `htmx:after:history:update`       | Observe | **GAP?** | ⚠️ After history updated          |
| `htmx:after:push:into:history`    | Observe | (merge)  | Could fold into above             |
| `htmx:after:replace:into:history` | Observe | (merge)  | Could fold into above             |
| `htmx:before:restore:history`     | Cancel  | **GAP?** | ⚠️ Before restoring from popstate |
xmth
### SSE (Server-Sent Events)

| Current Event                | Can Do  | Maps To     | Notes                              |
|------------------------------|---------|-------------|------------------------------------|
| `htmx:before:sse:stream`     | Cancel  | **GAP**     | ⚠️ SSE has its own lifecycle       |
| `htmx:after:sse:stream`      | Observe | **GAP**     | ⚠️ Stream ended                    |
| `htmx:before:sse:message`    | Cancel  | **GAP**     | ⚠️ Per-message hook                |
| `htmx:after:sse:message`     | Observe | **GAP**     | ⚠️ After message processed         |
| `htmx:before:sse:reconnect`  | Cancel  | **GAP**     | ⚠️ Before reconnect attempt        |

### View Transitions

| Current Event                | Can Do  | Maps To     | Notes                              |
|------------------------------|---------|-------------|------------------------------------|
| `htmx:before:viewTransition` | Observe | `htmx:swap` | ✓ Part of swap phase               |
| `htmx:after:viewTransition`  | Observe | `htmx:swap` | ✓ Part of swap phase               |

---

## Identified Gaps

### 1. `htmx:confirm` - User Interaction Hook

**Problem:** Confirmation needs to pause execution, wait for user input, then continue or cancel.

**Current behavior:**
```js
if (this.__trigger(elt, "htmx:confirm", {
    ctx,
    issueRequest: (skip) => issueRequest?.(skip !== false)
})) {
    // waits for promise resolution
}
```

**Options:**
- A. Make `htmx:request` async-capable (handler returns promise)
- B. Keep `htmx:confirm` as separate pre-request phase
- C. Move confirmation to application layer entirely

### ~~2. Settle Phase~~ — RESOLVED

**Decision:** Separate `htmx:settle` event (option B). Fires per fragment after DOM mutation and CSS transitions complete. Same detail shape as `htmx:swap`. See REFACTOR.md Decision 013.

### 3. History Events

**Problem:** History management has its own lifecycle:
- Before/after updating URL
- Restore from popstate

**Options:**
- A. Add `htmx:history` event with `action: 'push'|'replace'|'restore'`
- B. Keep history as plugin, fires its own events
- C. Fold into `htmx:swap` since history usually happens with swap

### 4. SSE Lifecycle

**Problem:** SSE is a long-lived connection with its own phases:
- Stream start/end
- Per-message handling
- Reconnection logic

**Options:**
- A. SSE is a plugin with its own event namespace (`htmx:sse:*`)
- B. Map to core events (stream start = request, message = response+swap)
- C. Keep SSE events separate from core 7

---

## Recommendation (Updated)

**Decided: 9 core events** (see REFACTOR.md Decisions 012, 013):

Request lifecycle (fire on trigger element, ×N = per fragment):
1. `htmx:request` — before fetch (×1)
2. `htmx:response` — after fetch (×1)
3. `htmx:swap` — before each DOM mutation (×N)
4. `htmx:settle` — after each DOM mutation + transitions (×N)
5. `htmx:done` — after all swaps complete (×1)

Element events (fire on relevant element):
6. `htmx:init` — library boot (on document)
7. `htmx:activate` — element with `hx-*` gains behavior
8. `htmx:deactivate` — element loses htmx behavior
9. `htmx:arrive` — new element lands in DOM via swap

Key design decisions:
- The event detail is **one object** that flows through the lifecycle, accumulating fields
- The `swap` field IS the fragment: `{ content, target, method }`
- Fragments emerge from the response — they don't exist at request time
- OOB = one response produces multiple fragments, each gets its own `htmx:swap`/`htmx:settle`
- All lifecycle events fire on the trigger element (locality of behavior)
- `htmx:arrive` fires on each new top-level element (for extensions/scripts reacting to new DOM)
- `htmx:activate` only fires on elements with `hx-*` attributes

**Separate concerns (plugins fire their own events):**
- **Confirm:** Application layer or `htmx:confirm` plugin
- **History:** `htmx:history` plugin with own events
- **SSE:** `htmx:sse` plugin with own events

**Remaining questions:**
1. Can `htmx:request` support async handlers for confirm flows?
2. Are history events needed in core or can history be a plugin?
