---
title: "hx-ws"
description: "Send and receive messages over WebSockets"
category: "Networking"
icon: "icon-[mdi--swap-horizontal]"
keywords: ["websockets", "ws", "real-time", "bidirectional", "socket"]
---

The `hx-ws` extension opens [WebSocket](https://developer.mozilla.org/en-US/docs/Web/API/WebSockets_API) connections, swaps incoming HTML, and sends form data as JSON.

If you used the WebSocket extension in [htmx 2.0](https://htmx.org/extensions/ws/), see [Migration](#migration).

## Installing

```html
<script src="https://cdn.jsdelivr.net/npm/htmx.org@__VERSION__/dist/htmx.min.js"></script>
<script src="https://cdn.jsdelivr.net/npm/htmx.org@__VERSION__/dist/ext/hx-ws.min.js"></script>
```

## Usage

### Swap One Target

Open a WebSocket connection:

```html
<div hx-ws:connect="/chat">
  ...
</div>
```

The server sends over `/chat`:

```html
<p>New message</p>
```

The result is:

```html
<div hx-ws:connect="/chat">
  <p>New message</p> <!-- Swapped in -->
</div>
```

htmx applied its normal swap rules using the defaults:

- [`hx-target="this"`](/reference/attributes/hx-target#this)
- [`hx-swap="innerHTML"`](/reference/attributes/hx-swap#innerhtml) (from [`htmx.config.defaultSwap`](/reference/config/htmx-config-defaultSwap))

Because it behaves like normal swaps, you can set [`hx-target`](/reference/attributes/hx-target) and [`hx-swap`](/reference/attributes/hx-swap) (including [modifiers](/reference/attributes/hx-swap#modifiers)):

```html
<div hx-ws:connect="/chat"
     hx-target="#messages"
     hx-swap="beforeend">

  <div id="messages">
    <p>Old message</p>
    <!-- Content goes here -->
  </div>

</div>
```

The server sends:

```html
<p>New message</p>
```

The result is:

```html
<div hx-ws:connect="/chat"
     hx-target="#messages"
     hx-swap="beforeend">

  <div id="messages">
    <p>Old message</p>
    <p>New message</p> <!-- Appended -->
  </div>

</div>
```

You can also use:

- [`hx-select`](/reference/attributes/hx-select) to select content for the swap
- [`hx-select-oob`](/reference/attributes/hx-select-oob) to select more elements to swap

These attributes follow [attribute inheritance](/docs#attribute-inheritance).

### Swap Multiple Targets

However, you will most likely use WebSockets to update several page elements.

You can do it:

```html
<div hx-ws:connect="/chat"></div>

<div id="feed">
  <p>Old</p>
</div>
<div id="status">Offline</div>
```

We’ll send an [`hx-swap-oob`](/reference/attributes/hx-swap-oob) element and an [`<hx-partial>`](/reference/tags/hx-partial) (new in 4.0):

```html
<!-- Match by ID -->
<div id="status" hx-swap-oob="true">Online</div>

<!-- Append -->
<hx-partial hx-target="#feed" hx-swap="beforeend">
  <p>New</p>
</hx-partial>
```

The page becomes:

```html
<div hx-ws:connect="/chat"></div>

<div id="feed">
  <p>Old</p>
  <p>New</p>
</div>
<div id="status">Online</div>
```

**Why wasn't the normal swap used?**

htmx extracts `hx-swap-oob` and `<hx-partial>` elements before the normal swap.

If the message contains nothing else, no HTML remains:

```text
(empty)
```

By default, [`swapEmpty:false`](/reference/attributes/hx-swap#swapempty) skips that empty swap and leaves the connection unchanged. Set [`swapEmpty:true`](/reference/attributes/hx-swap#swapempty) to run it instead.


The server can also mix these updates with ordinary HTML:

```html
<p>New chat content</p>

<!-- Also replace #status -->
<hx-partial hx-target="#status">Busy</hx-partial>
```

The first element uses the connection's target and swap. The partial updates `#status`.

To disable the connection's swap, set `hx-swap="none"`:

```html
<div hx-ws:connect="/chat" hx-swap="none">
  ...
</div>
```

Partials and OOB swaps still run.

### Send a Message

Add [`hx-ws:send`](#hx-wssend) to an input inside the connection:

```html
<div hx-ws:connect="/chat" hx-target="#messages">
  <div id="messages"></div>
  <input hx-ws:send type="button" name="message" value="Hello">
</div>
```

The outgoing message is:

```json
{
  "headers": {
    "HX-Request": "true",
    "HX-Request-ID": "550e8400-e29b-41d4-a716-446655440000",
    "HX-Request-Type": "partial",
    "HX-Source": "input",
    "HX-Target": "div#messages",
    "HX-Current-URL": "https://example.com/chat"
  },
  "message": "Hello"
}
```

`headers` is reserved for metadata. Form values and `hx-vals` use the other top-level keys.

Repeat a form field to send an array:

```html
<form hx-ws:send>
  <input name="tag" value="urgent">
  <input name="tag" value="public">
  <button>Send</button>
</form>
```

The outgoing message is:

```jsonc
{
  "headers": { /* ... */ },
  "tag": ["urgent", "public"]
}
```

## Advanced Usage

### Override an Incoming Swap

Use JSON when one incoming message needs a different target or swap:

- `headers`: metadata such as `HX-Request-ID`
- `content`: the HTML to swap
- `target`: where to swap it
- `swap`: a serialized [`hx-swap`](/reference/attributes/hx-swap) specification
- `select`: what to select from `content`

```json
{
  "content": "<p class=\"message\">New message</p>",
  "target": "#messages",
  "swap": "beforeend settle:10ms",
  "select": ".message"
}
```

HTTP `HX-Re*` headers replace values already chosen for a request.

A WebSocket message may arrive without a request, so its JSON fields can choose those values from the start:

| JSON field | HTTP response header | Element default |
|------------|----------------------|-----------------|
| `target` | [`HX-Retarget`](/reference/headers/HX-Retarget) | [`hx-target`](/reference/attributes/hx-target) |
| `swap` | [`HX-Reswap`](/reference/headers/HX-Reswap) | [`hx-swap`](/reference/attributes/hx-swap) |
| `select` | [`HX-Reselect`](/reference/headers/HX-Reselect) | [`hx-select`](/reference/attributes/hx-select) |

`content` uses the same `hx-target`, `hx-swap`, and `hx-select` attributes as plain HTML.

`hx-swap-oob` and `<hx-partial>` inside `content` still produce independent swaps.

The JSON fields override the corresponding attributes:

```text
TARGET
JSON target  -->  hx-target  -->  connection element*

SWAP
JSON swap    -->  hx-swap    -->  defaultSwap

SELECT
JSON select  -->  hx-select  -->  all content

* incoming messages with a matching HX-Request-ID use the sending element
```

`hx-select-oob` remains an element setting. A server can use `hx-swap-oob` or `<hx-partial>` inside `content` instead.

An explicit `swapEmpty` modifier overrides the `false` default.

### Handle Custom Messages

JSON without `content` is not swapped:

```json
{
  "type": "notification",
  "text": "New message"
}
```

Handle it with [`htmx:ws:before:message:incoming`](#htmxwsbeforemessageincoming):

```js
document.addEventListener('htmx:ws:before:message:incoming', async event => {
  let message = await event.detail.message.json()
  if (message.type === 'notification') showNotification(message)
})
```

Cancel the event to take over custom or binary processing:

```js
document.addEventListener('htmx:ws:before:message:incoming', async event => {
  event.preventDefault()
  handleCustomMessage(await event.detail.message.text())
})
```

The original string, `Blob`, or `ArrayBuffer` is available as `message.data`. Convert it with `message.text()`, `message.json()`, `message.blob()`, or `message.arrayBuffer()`. Conversions are cached, and `json()` rejects when the message is not valid JSON.

Canceling skips built-in processing. Binary messages are never swapped automatically.

### Choose a Trigger

Use [`hx-trigger`](/reference/attributes/hx-trigger) to open a connection later than `load`:

```html
<button id="connect">Connect</button>

<div hx-ws:connect="/chat"
     hx-trigger="click from:#connect">
</div>
```

All [`hx-trigger` modifiers](/reference/attributes/hx-trigger#event-modifiers) are supported.

### Open a Direct Connection

A sender can open its own connection when it has no `hx-ws:connect` ancestor:

```html
<button hx-ws:send="/actions" name="action" value="refresh">
  Refresh
</button>
```

### Use Shared Connections

Put several [`hx-ws:send`](#hx-wssend) elements inside one [`hx-ws:connect`](#hx-wsconnect):

```html
<div hx-ws:connect="/actions">
  <button hx-ws:send name="action" value="save"
          hx-target="#save-result">Save</button>
  <button hx-ws:send name="action" value="delete"
          hx-target="#delete-result">Delete</button>
</div>

<div id="save-result"></div>

<div id="delete-result"></div>
```

Both buttons use the same WebSocket connection, but each incoming message needs the right target.

**Route incoming messages**

WebSockets do not associate incoming messages with outgoing messages.

Without [`HX-Request-ID`](#hx-request-id), an incoming message uses the connection element instead of the sending button.

Copy the ID from the outgoing message into the incoming message:

```json
{
  "headers": {
    "HX-Request-ID": "550e8400-e29b-41d4-a716-446655440000"
  },
  "content": "<p>Saved</p>"
}
```

An incoming message carrying Save's ID uses `#save-result`.

One carrying Delete's ID uses `#delete-result`.

Relative targets and swap events also use the sending button.

**Reuse by URL**

Separate `hx-ws:connect` elements with the same URL share a connection too:

```html
<header hx-ws:connect="/actions"></header>
<main hx-ws:connect="/actions"></main>
```

Only one connection to `/actions` is opened. It closes when htmx removes its last element.

### Configure Connections

Set [WebSocket defaults](#config) for every connection:

```html
<meta name="htmx-config"
      content="ws.reconnectDelay:1s ws.reconnectMaxAttempts:5">
```

Override them for one connection with [`hx-config`](/reference/attributes/hx-config):

```html
<div hx-ws:connect="/ws"
     hx-config="ws.reconnectMaxAttempts:2">
</div>
```

Config is fixed when the connection is created.

## Attributes

### `hx-ws:connect`

Opens a WebSocket connection:

```html
<div hx-ws:connect="/chat"></div>
```

Incoming HTML uses these inherited swap attributes:

- [`hx-target`](/reference/attributes/hx-target): defaults to the connection element
- [`hx-swap`](/reference/attributes/hx-swap): defaults to [`htmx.config.defaultSwap`](/reference/config/htmx-config-defaultSwap)
- [`hx-select`](/reference/attributes/hx-select): selects content for the connection's swap
- [`hx-select-oob`](/reference/attributes/hx-select-oob): selects more elements to swap

`hx-ws` defaults [`swapEmpty`](/reference/attributes/hx-swap#swapempty) to `false`. Set it explicitly in `hx-swap` to override the default.

Default trigger: [`load`](/reference/attributes/hx-trigger#load). Use [`hx-trigger`](#choose-a-trigger) to change it.

Connections reconnect automatically. [Elements using the same URL share one connection](#use-shared-connections).

### `hx-ws:send`

Sends form data and [`hx-vals`](/reference/attributes/hx-vals) as JSON.

Accepted forms:

- `hx-ws:send`: use the nearest ancestor connection
- `hx-ws:send="<url>"`: open its own connection

```html
<div hx-ws:connect="/chat">
  <form id="chat-form" hx-ws:send hx-target="#messages">
    <input name="message">
    <button>Send</button>
  </form>
  <div id="messages"></div>
</div>
```

The outgoing message contains core htmx headers and the element's values:

```json
{
  "headers": {
    "HX-Request": "true",
    "HX-Request-ID": "550e8400-e29b-41d4-a716-446655440000",
    "HX-Request-Type": "partial",
    "HX-Source": "form#chat-form",
    "HX-Target": "div#messages",
    "HX-Current-URL": "https://example.com/chat"
  },
  "message": "Hello"
}
```

For example, [`hx-vals="count:2"`](/reference/attributes/hx-vals) overrides `<input name="count" value="1">`. The message contains the number `2`, not the string `"1"`.

Defaults match [`hx-trigger`](/reference/attributes/hx-trigger):

- `change` → `<input>` (except `type="button"` and `type="submit"`), `<textarea>`, `<select>`
- `submit` → `<form>`
- `click` → `<input type="button">`, `<input type="submit">`, and everything else

## Events

Event data is available on `event.detail`.

Connection and close events:

```js
event.detail.connection = {
  url,
  config,
  socket,     // WebSocket or null
  attempt,    // reconnect count
  cancelled
}
```

Incoming message events:

```js
event.detail.message = {
  data,          // original string, Blob, or ArrayBuffer
  type,          // "text" or "binary"
  text(),
  json(),
  blob(),
  arrayBuffer(),
  waitUntil(),
  cancelled      // before processing only
}
```

Outgoing message events expose:

```js
event.detail.message = {
  headers,       // htmx metadata
  values,        // form values and hx-vals
  data,          // actual WebSocket payload
  waitUntil(),
  cancelled      // before sending only
}
```

Message events dispatch from a live connection element. [An incoming message with a matching `HX-Request-ID`](#use-shared-connections) dispatches from the sending element.

### `htmx:ws:before:connection`

Fires before the initial connection and each reconnect.

Choose a subprotocol before opening:

```js
document.addEventListener('htmx:ws:before:connection', event => {
  event.detail.connection.config.protocols = 'graphql-transport-ws'
})
```

Cancel either way:

- call `event.preventDefault()`
- set `event.detail.connection.cancelled` to `true`

### `htmx:ws:after:connection`

Fires after a connection opens.

Configure the open socket:

```js
document.addEventListener('htmx:ws:after:connection', event => {
  event.detail.connection.socket.binaryType = 'arraybuffer'
})
```

### `htmx:ws:before:message:outgoing`

Fires before sending an outgoing message.

- `message.headers`: mutable htmx metadata
- `message.values`: mutable form values and `hx-vals`
- `message.data`: optional replacement payload

Modify or cancel the outgoing message:

```js
document.addEventListener('htmx:ws:before:message:outgoing', event => {
  let message = event.detail.message
  message.headers.Authorization = `Bearer ${token}`

  if (!isValid(message.values)) event.preventDefault()
})
```

The normal path serializes `{...values, headers}` as JSON. Set `message.data` to send a string, `Blob`, `ArrayBuffer`, or typed-array view instead:

```js
document.addEventListener('htmx:ws:before:message:outgoing', event => {
  let message = event.detail.message
  message.data = encodeMessagePack({
    ...message.values,
    headers: message.headers
  })
})
```

### `htmx:ws:after:message:outgoing`

Fires after sending an outgoing message. `message.data` is the value passed to `WebSocket.send()`.

```js
document.addEventListener('htmx:ws:after:message:outgoing', event => {
  console.log('Outgoing:', event.detail.message.data)
})
```

### `htmx:ws:before:message:incoming`

Fires before processing an incoming message.

JSON without `content` is not swapped. Handle data messages here:

```js
document.addEventListener('htmx:ws:before:message:incoming', event => {
  let message = event.detail.message
  message.waitUntil(message.json().then(data => {
    if (data.type === 'notification') showNotification(data)
  }))
})
```

`waitUntil()` delays built-in processing until asynchronous inspection or decoding finishes. Set `message.cancelled` from that work to prevent processing.

Cancel synchronous processing either way:

- call `event.preventDefault()`
- set `event.detail.message.cancelled` to `true`

### `htmx:ws:after:message:incoming`

Fires after the extension handles an incoming message.

```js
document.addEventListener('htmx:ws:after:message:incoming', event => {
  console.log('Incoming:', event.detail.message.data)
})
```

### `htmx:ws:close`

Fires when a connection closes.

- `reason`: `closed`, `removed`, or `cancelled`
- `code`: the WebSocket close code, or `null`

```js
document.addEventListener('htmx:ws:close', event => {
  console.log('Closed:', event.detail.reason, event.detail.code)
})
```

### `htmx:ws:error`

Fires on connection and send errors.

- `url`: the WebSocket URL, or `null`
- `error`: the error value

```js
document.addEventListener('htmx:ws:error', event => {
  console.error('WebSocket error:', event.detail.error)
})
```

## Config

Set global defaults with an `htmx-config` meta tag.

### `ws.reconnect`

Control whether a closed connection reconnects automatically.

```html
<meta name="htmx-config" content="ws.reconnect:false">
```

Defaults to `true`.

### `ws.reconnectDelay`

Set how long to wait before the first reconnect attempt.

```html
<meta name="htmx-config" content="ws.reconnectDelay:1s">
```

Defaults to `500` milliseconds. Each failed attempt doubles the delay, and values may be milliseconds or time strings such as `500ms`, `1s`, and `2m`.

### `ws.reconnectMaxDelay`

Limit how long to wait between reconnect attempts.

```html
<meta name="htmx-config" content="ws.reconnectMaxDelay:30s">
```

Defaults to `60000` milliseconds. Use milliseconds or a time string.

### `ws.reconnectMaxAttempts`

Limit how many times a closed connection tries to reconnect.

```html
<meta name="htmx-config" content="ws.reconnectMaxAttempts:5">
```

Defaults to `Infinity`.

### `ws.reconnectJitter`

Spread reconnect attempts so many clients do not retry at once.

```html
<meta name="htmx-config" content="ws.reconnectJitter:0">
```

Defaults to `0.3`, which randomizes each delay by up to ±30%. Use `0` for exact delays.

### `ws.pauseOnBackground`

Close connections while the page is hidden and reconnect when it becomes visible.

```html
<meta name="htmx-config" content="ws.pauseOnBackground:false">
```

Defaults to `true`.

### `ws.pendingRequestTTL`

Set how long `hx-ws` remembers an outgoing message so an [incoming message can use its sender](#use-shared-connections).

```html
<meta name="htmx-config" content="ws.pendingRequestTTL:60000">
```

Defaults to `30000` milliseconds. After it expires, the incoming message uses the connection element.

### `ws.protocols`

Set [WebSocket subprotocols](https://developer.mozilla.org/en-US/docs/Web/API/WebSocket/WebSocket#protocols) for the handshake.

```html
<meta name="htmx-config" content="ws.protocols:graphql-transport-ws">
```

No subprotocol is set by default. Use JSON config to set several subprotocols.

## Headers

### `HX-Request-ID`

`hx-ws` adds a unique `HX-Request-ID` to `headers` for every outgoing message.

Copy the same ID into an incoming message to [associate it with the outgoing message's sender](#use-shared-connections):

```jsonc
// Browser → server
{ "headers": { "HX-Request-ID": "abc123" }, "message": "Save" }

// Server → browser
{ "headers": { "HX-Request-ID": "abc123" }, "content": "<p>Saved</p>" }
```

## Migration

### htmx 2.0

htmx 2.0 treats every incoming element as an implicit [`hx-swap-oob`](https://htmx.org/extensions/ws/#receiving-messages-from-a-websocket):

```html
<!-- interpreted as hx-swap-oob="true" by default -->
<div id="notifications">
  New message
</div>
```

htmx 4.0 uses [`hx-target`](/reference/attributes/hx-target) and [`hx-swap`](/reference/attributes/hx-swap) on the connection:

```html
<div hx-ws:connect="/notifications"
     hx-target="#notifications"
     hx-swap="outerHTML">
</div>

<div id="notifications"></div>
```

The incoming message contains plain HTML:

```html
<div id="notifications">
  New message
</div>
```

htmx 4.0 requires explicit syntax for each extra swap.

Choose either [`hx-swap-oob`](/reference/attributes/hx-swap-oob) or [`<hx-partial>`](/reference/tags/hx-partial).

[JSON](#override-an-incoming-swap) can choose the connection's target and swap instead.

[`HX-Request-ID`](#hx-request-id) can route incoming messages through the sending element.

**Outgoing messages**

htmx 2 added `HEADERS` to the form values:

```json
{
  "message": "Hello",
  "HEADERS": {
    "HX-Request": "true"
  }
}
```

htmx 4 reserves `headers` for metadata and puts values at the top level:

```json
{
  "headers": {
    "HX-Request": "true"
  },
  "message": "Hello"
}
```

**Attributes and APIs**

| htmx 2.x | htmx 4.x |
|----------|----------|
| [`ws-connect`](https://htmx.org/extensions/ws/#usage) | [`hx-ws:connect`](#hx-wsconnect) |
| [`ws-send`](https://htmx.org/extensions/ws/#usage) | [`hx-ws:send`](#hx-wssend) |
| [`htmx.config.wsReconnectDelay`](https://htmx.org/extensions/ws/#configuration) | [`htmx.config.ws.reconnectDelay`](#wsreconnectdelay) |
| [`createWebSocket`](https://htmx.org/extensions/ws/#configuration) | Removed |
| [`wsBinaryType`](https://htmx.org/extensions/ws/#configuration) | Removed |
| [`socketWrapper`](https://htmx.org/extensions/ws/#socket-wrapper) | Removed |

`ws-connect` and `ws-send` still work with a warning.

**Events**

| htmx 2.x | htmx 4.x |
|----------|----------|
| [`htmx:wsConnecting`](https://htmx.org/extensions/ws/#htmx:wsConnecting) | Removed |
| [`htmx:wsOpen`](https://htmx.org/extensions/ws/#htmx:wsOpen) | [`htmx:ws:after:connection`](#htmxwsafterconnection) |
| [`htmx:wsClose`](https://htmx.org/extensions/ws/#htmx:wsClose) | [`htmx:ws:close`](#htmxwsclose) |
| [`htmx:wsError`](https://htmx.org/extensions/ws/#htmx:wsError) | [`htmx:ws:error`](#htmxwserror) |
| [`htmx:wsBeforeMessage`](https://htmx.org/extensions/ws/#htmx:wsBeforeMessage) | [`htmx:ws:before:message:incoming`](#htmxwsbeforemessageincoming) |
| [`htmx:wsAfterMessage`](https://htmx.org/extensions/ws/#htmx:wsAfterMessage) | [`htmx:ws:after:message:incoming`](#htmxwsaftermessageincoming) |
| [`htmx:wsConfigSend`](https://htmx.org/extensions/ws/#htmx:wsConfigSend) | [`htmx:ws:before:message:outgoing`](#htmxwsbeforemessageoutgoing) |
| [`htmx:wsBeforeSend`](https://htmx.org/extensions/ws/#htmx:wsBeforeSend) | [`htmx:ws:before:message:outgoing`](#htmxwsbeforemessageoutgoing) |
| [`htmx:wsAfterSend`](https://htmx.org/extensions/ws/#htmx:wsAfterSend) | [`htmx:ws:after:message:outgoing`](#htmxwsaftermessageoutgoing) |

### htmx 4.0 alpha

Early htmx 4 builds used different names:

| Early htmx 4 | Current | Compatibility |
|--------------|---------|---------------|
| `htmx.config.websockets` | [`htmx.config.ws`](#config) | Removed |
| `payload` | [`content`](#override-an-incoming-swap) | Works with a warning |

## Notes

- [`hx-ws:connect`](#hx-wsconnect) accepts:
  - Root-relative URLs: `/ws`
  - Path-relative URLs: `events`
  - Protocol-relative URLs: `//api.example.com/ws`
  - HTTP(S) URLs: `https://example.com/ws`
  - WebSocket URLs: `wss://example.com/ws`

  HTTP(S) URLs are converted to their WebSocket equivalents.

- `hx-target`, `hx-swap`, `hx-select`, and `hx-select-oob` follow [attribute inheritance](/docs#attribute-inheritance).
- All WebSocket swaps use [`htmx.swap()`](/reference/methods/htmx-swap).
- Setting [`hx-swap`](/reference/attributes/hx-swap) to [`none`](/reference/attributes/hx-swap#none) skips the connection's swap but still processes `hx-swap-oob` and `<hx-partial>`:

  ```html
  <div id="status" hx-swap-oob="true">Connected</div>
  ```

- [`swapEmpty`](/reference/attributes/hx-swap#swapempty) defaults to `false` for incoming WebSocket messages. Set `swapEmpty:true` to swap an empty remainder after htmx extracts `hx-swap-oob` and `<hx-partial>`.
- Use `hx-ws-connect` and `hx-ws-send` when colons are not supported, such as in JSX.

## See Also

- [`hx-swap`](/reference/attributes/hx-swap)
- [`hx-target`](/reference/attributes/hx-target)
- [`hx-select`](/reference/attributes/hx-select)
- [`hx-select-oob`](/reference/attributes/hx-select-oob)
- [`hx-trigger`](/reference/attributes/hx-trigger)
- [`htmx.swap()`](/reference/methods/htmx-swap)
- [`hx-sse`](/extensions/hx-sse)
