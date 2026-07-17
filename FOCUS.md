# htmx response context and multipart design

## Purpose

Make server-directed behavior reusable across HTTP responses, WebSocket messages, SSE messages, and multipart parts.

Each transport should populate the same canonical request, response, swap, and action state. Core should execute that state without transport-specific branches or copied lifecycle logic.

`hx-multipart` is the main design constraint. It must be able to stream parts through core swap and action handling.

## Canonical lifecycle context

Lifecycle state belongs in explicit namespaces:

```js
ctx = {
    sourceElement,
    sourceEvent,
    status,
    confirm,
    request,
    response,
    swap,
    actions
}
```

Do not restore flat aliases such as:

```text
ctx.text
ctx.target
ctx.select
ctx.selectOOB
ctx.transition
ctx.push
ctx.replace
```

Before this work is complete, publish one durable lifecycle context contract across core behavior, central docs, extension-authoring guidance, `dist/htmx.d.ts`, event detail types, and relevant event reference pages. Cover `ctx` plus its `request`, `response`, `swap`, and `actions` namespaces, including lifecycle availability and mutable fields.

### Request state

`ctx.request` owns all request state:

```js
ctx.request = {
    action,
    anchor,
    method,
    headers,
    body,
    signal,
    abort,
    credentials,
    mode,
    timeout
}
```

Request headers use plain objects. Extensions read and write header properties directly, and transports serialize that object at the wire boundary.

### Response state

`ctx.response` owns the received response:

```js
ctx.response = {
    raw,
    status,
    headers
}
```

`ctx.response.headers` is a native `Headers` instance.

### Swap state

`ctx.swap` is the canonical swap description:

```js
ctx.swap = {
    content,
    target,
    style,
    select,
    selectOOB,
    transition,
    swapDelay,
    settleDelay,
    ...modifiers
}
```

Swap inputs may be a style, a serialized specification, or structured fields:

```js
swap: 'innerHTML'
swap: 'innerHTML transition:true swap:200ms'
swap: { style: 'innerHTML', transition: true, swapDelay: '200ms' }
```

Normalize each form at the public or transport boundary. Internal swap execution consumes canonical fields.

`hx-target`, `hx-swap`, `hx-select`, and `hx-select-oob` initialize this state. Response headers, status configuration, WebSocket JSON, SSE, and multipart parts modify the same state.

Keep the target input distinct from its resolved element:

```js
ctx.swap.target
ctx.swap.resolvedTarget
```

This preserves selector intent while giving swap execution a stable `Element`.

### Action state

`ctx.actions` is the canonical description of server and history actions:

```js
ctx.actions = {
    pushUrl,
    replaceUrl,
    trigger,
    location,
    redirect,
    refresh
}
```

Client attributes initialize action intent. Response headers, status configuration, and multipart parts may override it.

`HX-Retarget`, `HX-Reswap`, and `HX-Reselect` update `ctx.swap`. They are swap directives, not a second action path.

Header decoding and action execution are separate steps:

1. Decode transport metadata into `ctx.swap` and `ctx.actions`.
2. Execute `ctx.actions` through one core path.
3. Execute `ctx.swap` through one core path.

Transport metadata is decoded into canonical swap and action state. It does not get a separate `ctx.hx` namespace.

## Public APIs

Public callers should not fabricate internal contexts.

```js
htmx.swap(content, target, options)
htmx.ajax(method, url, options)
```

Use one public and one internal source name:

```text
options.source    // Element or selector
ctx.sourceElement // resolved Element
```

`htmx.swap()` accepts a serialized swap specification, structured swap fields, or flat option fields:

```js
htmx.swap(html, '#messages', 'beforeend')

htmx.swap(html, '#messages', {
    swap: 'beforeend settle:10ms',
    select: '.message',
    source: connection
})
```

`htmx.ajax()` maps public options into canonical namespaces during context construction:

```js
htmx.ajax('GET', url, {
    source,
    target,
    swap,
    select,
    selectOOB,
    transition,
    request: { headers, signal },
    actions: { pushUrl, replaceUrl }
})
```

Derived request headers must be computed after these overrides are applied.

## Multiple swaps

One response or message may produce any number of swaps.

`hx-swap-oob` and `<hx-partial>` are two syntaxes for adding swaps. They must share the same `swapEmpty` behavior and normal swap lifecycle.

Core `defaultSwapEmpty` is `true`. WebSocket and SSE messages default to `swapEmpty:false` because push messages commonly contain only `hx-swap-oob` or `<hx-partial>` updates.

Internal task labels such as `main`, `oob`, and `partial` must not become competing public swap models.

## Multipart behavior

Each multipart part describes one swap and may also describe actions.

For each part, the extension should:

1. Read the body and headers.
2. Create canonical `ctx.swap` and `ctx.actions` state.
3. Invoke core action and swap handling.

The extension must not copy history, redirect, refresh, trigger, retarget, reswap, reselect, status, or swap-pipeline logic.

### Envelope defaults

Envelope swap directives are defaults for each part:

```text
envelope target / swap / select
→ part defaults
→ part target / swap / select overrides
```

Envelope one-shot actions execute once:

```text
HX-Trigger
HX-Redirect
HX-Location
HX-Refresh
history actions
```

They do not run again for every part. A part may supply and execute its own one-shot actions.

### Streaming order

- `multipart/mixed` processes parts in order as they arrive.
- `multipart/parallel` may process parts concurrently.
- Swaps should not wait for the full response body or stream close.
- A terminal action must stop further ordered processing when continuing no longer makes sense.

### Request headers

The extension adds its media types to `Accept` without replacing existing values or creating duplicates:

```text
text/html
text/event-stream
multipart/mixed
multipart/parallel
```

Preserve the plain-object header representation. Match existing header names case-insensitively when appending media types so composition does not create duplicates.

## Transport mapping

### HTTP

Response headers override request-derived swap and action state before execution.

### WebSocket

An incoming message may arrive without a request. Element attributes provide defaults, while JSON `target`, `swap`, and `select` may define or override that message's swap.

Keep the normal htmx path concise: send element values as JSON, swap incoming HTML, and let JSON `content`, `target`, `swap`, and `select` direct a swap. These top-level keys are the htmx WebSocket envelope; `content` remains the canonical HTML field. Preserve the native message data alongside these conveniences so custom extensions do not need to work around hx-ws.

Treat binary messages as first-class transport messages. Expose the original `MessageEvent.data`, honor the socket's `binaryType`, dispatch the normal incoming lifecycle events, and do not coerce binary data to text or attempt to swap it as HTML. A custom extension must be able to decode CBOR, MessagePack, protobuf, images, or another application protocol itself.

Keep hx-ws responsible for connection management, sending, receiving, lifecycle events, and the ergonomic HTML/JSON path.

Request correlation belongs in an optional extension. It adds `HX-Request-ID` under outgoing `headers`, tracks sending elements, reads the corresponding incoming header, and selects the message's source element. hx-ws exposes a mutable source element during incoming message processing. Attributes, swaps, and later events use that source. Protocol extensions compose through this hook without duplicating swap processing.

The normal outgoing path serializes headers and element values as JSON. The outgoing lifecycle must also allow a protocol extension to replace that payload with any value accepted by `WebSocket.send()`, including strings, `Blob`, `ArrayBuffer`, and typed-array views. Custom payloads retain the normal cancellation, error, and after-send lifecycle.

### SSE

Each event reuses the connection context, replaces `ctx.swap.content`, and executes the canonical swap pipeline.

### Multipart

Each part gets its own canonical context derived from the envelope defaults. Do not spread one mutable envelope context into every part.

## Validation

- Add a regression test for every changed behavior or API contract.
- Keep precedence and lifecycle semantics explicit in tests.
- Update source declarations, distributed declarations, and documentation together.
- Verify HTTP, AJAX, manual swaps, WS, SSE, and multipart behavior.
- Run focused tests throughout and the full Chromium suite before review.
