---
title: "hx-sse"
description: "Stream updates via Server-Sent Events (SSE)"
category: "Networking"
icon: "icon-[mdi--rss]"
keywords: ["sse", "server-sent events", "server sent events", "event stream", "streaming", "real-time"]
---

The `hx-sse` extension streams [Server-Sent Events](https://developer.mozilla.org/en-US/docs/Web/API/Server-sent_events) through normal htmx requests and swaps.

If you used the SSE extension in [htmx 2.0](https://htmx.org/extensions/sse/), see [Migration](#migration).

## Installing

```html
<script src="https://cdn.jsdelivr.net/npm/htmx.org@__VERSION__/dist/htmx.min.js"></script>
<script src="https://cdn.jsdelivr.net/npm/htmx.org@__VERSION__/dist/ext/hx-sse.min.js"></script>
```

## Usage

### Stream One Target

Open a persistent SSE connection:

```html
<div hx-sse:connect="/chat">
  ...
</div>
```

The server responds with `Content-Type: text/event-stream`, then sends:

```text
data: <p>New message</p>

```

The blank line ends the SSE message. htmx swaps its `data` into the connection element:

```html
<div hx-sse:connect="/chat">
  <p>New message</p> <!-- Swapped in -->
</div>
```

htmx applied its normal swap rules using the defaults:

- [`hx-target="this"`](/reference/attributes/hx-target#this)
- [`hx-swap="innerHTML"`](/reference/attributes/hx-swap#innerhtml) (from [`htmx.config.defaultSwap`](/reference/config/htmx-config-defaultSwap))

Set [`hx-target`](/reference/attributes/hx-target) and [`hx-swap`](/reference/attributes/hx-swap) to change them:

```html
<div hx-sse:connect="/chat"
     hx-target="#messages"
     hx-swap="beforeend">

  <div id="messages">
    <p>Old message</p>
  </div>

</div>
```

The server sends:

```text
data: <p>New message</p>

```

The result is:

```html
<div id="messages">
  <p>Old message</p>
  <p>New message</p> <!-- Appended -->
</div>
```

You can also use:

- [`hx-select`](/reference/attributes/hx-select) to select content for the swap
- [`hx-select-oob`](/reference/attributes/hx-select-oob) to select more elements to swap

### Stream Multiple Targets

Start with the page elements to update:

```html
<div hx-sse:connect="/events"></div>

<div id="feed">
  <p>Old</p>
</div>
<div id="status">Offline</div>
```

The server sends an [`hx-swap-oob`](/reference/attributes/hx-swap-oob) element and an [`<hx-partial>`](/reference/tags/hx-partial):

```text
data: <div id="status" hx-swap-oob="true">Online</div>
data: <hx-partial hx-target="#feed" hx-swap="beforeend">
data:   <p>New</p>
data: </hx-partial>

```

The page becomes:

```html
<div hx-sse:connect="/events"></div>

<div id="feed">
  <p>Old</p>
  <p>New</p>
</div>
<div id="status">Online</div>
```

**Why wasn't the normal swap used?**

After htmx extracts the extra swaps, the normal swap is empty:

```text
(empty)
```

By default, [`swapEmpty:false`](/reference/attributes/hx-swap#swapempty) leaves the connection element unchanged.

The server can mix extra swaps with ordinary HTML:

```text
data: <p>New event</p>
data: <hx-partial hx-target="#status">Busy</hx-partial>

```

The paragraph uses the connection's target and swap. The partial updates `#status`.

To disable the connection's swap, set `hx-swap="none"`:

```html
<div hx-sse:connect="/events" hx-swap="none"></div>
```

Partials and OOB swaps still run.

### Stream a Normal Request

Any htmx request can receive an SSE stream:

```html
<form hx-post="/generate"
      hx-target="#output"
      hx-swap="beforeend">
  <input name="prompt">
  <button>Generate</button>
</form>

<div id="output"></div>
```

The server returns:

```http
Content-Type: text/event-stream
```

Then streams messages:

```text
data: <span>Hello</span>

data: <span> world</span>

```

Normal requests keep their method, values, headers, target, and swap. Unlike [`hx-sse:connect`](#hx-sseconnect), they do not reconnect or pause on background tabs by default.

### Handle Named Events

An SSE `event` field dispatches a DOM event instead of swapping its data:

```text
event: progress
data: 50
id: task-5

```

Handle it with [`hx-on`](/reference/attributes/hx-on):

```html
<div hx-sse:connect="/progress"
     hx-on:progress="htmx.find('#progress').value = event.detail.data">
</div>

<progress id="progress" max="100" value="0"></progress>
```

The event bubbles from the request source and exposes:

```js
event.detail = {
  data: '50',
  id: 'task-5'
}
```

A named event can also trigger another htmx request:

```html
<div hx-get="/status" hx-trigger="progress from:body"></div>
```

### Close a Stream

Close a connection when a specific named event arrives:

```html
<div hx-sse:connect="/progress" hx-sse:close="done"></div>
```

The server sends:

```text
event: done
data: Complete

```

The `done` DOM event and [`htmx:sse:after:message`](#htmxsseaftermessage) fire before [`htmx:sse:close`](#htmxsseclose).

### Choose a Trigger

Use [`hx-trigger`](/reference/attributes/hx-trigger) to connect later than `load`:

```html
<button id="connect">Connect</button>

<div hx-sse:connect="/events"
     hx-trigger="click from:#connect">
</div>
```

All [`hx-trigger` modifiers](/reference/attributes/hx-trigger#event-modifiers) are supported.

### Resume After Reconnecting

Give each message an ID so the server can replay missed messages:

```text
id: event-42
data: <p>New message</p>

```

The next reconnect includes:

```http
Last-Event-ID: event-42
```

The server must use that ID to replay later messages. Without server-side replay, messages sent while disconnected are lost.

### Configure Connections

Set [SSE defaults](#config) for every stream:

```html
<meta name="htmx-config"
      content="sse.reconnectDelay:1s sse.reconnectMaxAttempts:5">
```

Override them for one request with [`hx-config`](/reference/attributes/hx-config):

```html
<div hx-sse:connect="/events"
     hx-config="sse.reconnectMaxAttempts:2">
</div>
```

Config is fixed when stream handling begins.

## Attributes

### `hx-sse:connect`

Opens a persistent SSE connection with a GET request:

```html
<div hx-sse:connect="/events"></div>
```

The connection uses:

- [`hx-headers`](/reference/attributes/hx-headers) and [`hx-vals`](/reference/attributes/hx-vals) for the GET request
- [`hx-target`](/reference/attributes/hx-target), [`hx-swap`](/reference/attributes/hx-swap), [`hx-select`](/reference/attributes/hx-select), and [`hx-select-oob`](/reference/attributes/hx-select-oob) for each message

Defaults:

- [`hx-trigger="load"`](/reference/attributes/hx-trigger#load)
- [`sse.reconnect:true`](#ssereconnect)
- [`sse.pauseOnBackground:true`](#ssepauseonbackground)
- [`swapEmpty:false`](/reference/attributes/hx-swap#swapempty) for each message

### `hx-sse:close`

Closes the connection after a matching named event:

```html
<div hx-sse:connect="/events" hx-sse:close="done"></div>
```

```text
event: done
data: Complete

```

## Events

Event data is available on `event.detail`.

Connection events expose:

```js
event.detail.connection = {
  url,
  config,
  lastEventId,
  attempt,
  status,
  cancelled
}
```

Message events expose:

```js
event.detail.message = {
  data,
  event,
  id,
  cancelled // before processing only
}
```

### `htmx:sse:before:connection`

Fires before htmx starts the initial stream or schedules a reconnect.

```js
document.addEventListener('htmx:sse:before:connection', event => {
  if (event.detail.connection.attempt > 5) event.preventDefault()
})
```

The initial HTTP response has already arrived. Cancel either way:

- call `event.preventDefault()`
- set `event.detail.connection.cancelled` to `true`

### `htmx:sse:after:connection`

Fires after the initial response or a reconnect is ready to stream.

```js
document.addEventListener('htmx:sse:after:connection', event => {
  console.log('Connected:', event.detail.connection.url)
})
```

`connection.status` contains the HTTP status.

### `htmx:sse:before:message`

Fires before processing an SSE message.

```js
document.addEventListener('htmx:sse:before:message', event => {
  let message = event.detail.message
  if (message.event === 'heartbeat') event.preventDefault()
  else message.data = sanitize(message.data)
})
```

Changing `message.data` changes the swap or named event data. Changing `message.event` changes whether the message swaps or dispatches a DOM event.

### `htmx:sse:after:message`

Fires after htmx swaps or dispatches an SSE message.

```js
document.addEventListener('htmx:sse:after:message', event => {
  console.log('Received:', event.detail.message.data)
})
```

### `htmx:sse:close`

Fires when an SSE stream closes.

```js
document.addEventListener('htmx:sse:close', event => {
  console.log('Closed:', event.detail.reason)
})
```

`reason` is one of:

- `message`: `hx-sse:close` matched a named event
- `removed`: the source element left the DOM
- `ended`: the stream ended or exhausted its reconnect attempts
- `cancelled`: the initial stream was cancelled
- `cleanup`: htmx cleaned up the source element

### `htmx:sse:error`

Fires when reading or reconnecting to an SSE stream fails.

```js
document.addEventListener('htmx:sse:error', event => {
  console.error('SSE error:', event.detail.error)
})
```

- `url`: the SSE URL
- `error`: the error value
- `status`: the HTTP status for a failed reconnect response, when available

## Config

Set global defaults with an `htmx-config` meta tag.

### `sse.reconnect`

Control whether a closed stream reconnects automatically.

```html
<meta name="htmx-config" content="sse.reconnect:false">
```

Defaults to `true` for `hx-sse:connect` and `false` for normal htmx requests.

### `sse.reconnectDelay`

Set how long to wait before the first reconnect attempt.

```html
<meta name="htmx-config" content="sse.reconnectDelay:1s">
```

Defaults to `500` milliseconds. Each failed attempt doubles the delay, and values may be milliseconds or time strings such as `500ms`, `1s`, and `2m`.

The server can replace this value for the stream:

```text
retry: 2000
data: Reconnect after two seconds

```

### `sse.reconnectMaxDelay`

Limit how long to wait between reconnect attempts.

```html
<meta name="htmx-config" content="sse.reconnectMaxDelay:30s">
```

Defaults to `60000` milliseconds. Use milliseconds or a time string.

### `sse.reconnectMaxAttempts`

Limit how many times a closed stream tries to reconnect.

```html
<meta name="htmx-config" content="sse.reconnectMaxAttempts:5">
```

Defaults to `Infinity`.

### `sse.reconnectJitter`

Spread reconnect attempts so many clients do not retry at once.

```html
<meta name="htmx-config" content="sse.reconnectJitter:0">
```

Defaults to `0.3`, which randomizes each delay by up to ±30%. Use `0` for exact delays.

### `sse.pauseOnBackground`

Close the stream while the page is hidden and reconnect when it becomes visible.

```html
<meta name="htmx-config" content="sse.pauseOnBackground:false">
```

Defaults to `true` for `hx-sse:connect` and `false` for normal htmx requests. Use event IDs and server-side replay to recover messages sent while disconnected.

## Headers

### `Accept`

Advertises SSE support on every htmx request while the extension is loaded.

```http
Accept: text/html, text/event-stream
```

A response is streamed when its `Content-Type` contains `text/event-stream`.

### `Last-Event-ID`

Identifies the last received SSE event during reconnection.

```http
Last-Event-ID: event-42
```

The extension sends this header after a message supplies an `id` field. The server decides how to replay later messages.

## Migration

### htmx 2.0

htmx 2.0 used `EventSource` and selected named messages with `sse-swap`:

```html
<div sse-connect="/chat" sse-swap="message"></div>
```

htmx 4 uses a normal htmx request and swaps unnamed messages automatically:

```html
<div hx-sse:connect="/chat"></div>
```

```text
data: <p>New message</p>

```

Named messages now dispatch DOM events instead of selecting a swap target:

```text
event: progress
data: 50

```

```html
<div hx-sse:connect="/progress"
     hx-on:progress="updateProgress(event.detail.data)">
</div>
```

Trigger another request with the ordinary event name:

```html
<!-- htmx 2 -->
<div hx-get="/status" hx-trigger="sse:progress"></div>

<!-- htmx 4 -->
<div hx-get="/status" hx-trigger="progress from:body"></div>
```

#### Attributes

These attributes changed:

| htmx 2.x | htmx 4.x | Compatibility |
|----------|----------|---------------|
| [`sse-connect`](https://htmx.org/extensions/sse/#connecting-to-an-sse-server) | [`hx-sse:connect`](#hx-sseconnect) | Works with a warning |
| [`sse-swap`](https://htmx.org/extensions/sse/#receiving-named-events) | Unnamed messages swap automatically | Removed; warns |
| [`sse-close`](https://htmx.org/extensions/sse/) | [`hx-sse:close`](#hx-sseclose) | Works with a warning |

#### Events

These events changed:

| htmx 2.x | htmx 4.x |
|----------|----------|
| [`htmx:sseOpen`](https://htmx.org/extensions/sse/#htmxsseopen) | [`htmx:sse:after:connection`](#htmxsseafterconnection) |
| [`htmx:sseError`](https://htmx.org/extensions/sse/#htmxsseerror) | [`htmx:sse:error`](#htmxsseerror) |
| [`htmx:sseBeforeMessage`](https://htmx.org/extensions/sse/#htmxssebeforemessage) | [`htmx:sse:before:message`](#htmxssebeforemessage) |
| [`htmx:sseMessage`](https://htmx.org/extensions/sse/#htmxssemessage) | [`htmx:sse:after:message`](#htmxsseaftermessage) |
| [`htmx:sseClose`](https://htmx.org/extensions/sse/#htmxsseclose) | [`htmx:sse:close`](#htmxsseclose) |

htmx 4 uses `fetch()` and `ReadableStream` instead of `EventSource`. SSE responses can therefore use any htmx HTTP method, request values, and headers.

### htmx 4.0 Alpha

Early htmx 4 builds used different lifecycle event names:

| Early htmx 4 | Current |
|--------------|---------|
| `htmx:before:sse:connection` | [`htmx:sse:before:connection`](#htmxssebeforeconnection) |
| `htmx:after:sse:connection` | [`htmx:sse:after:connection`](#htmxsseafterconnection) |
| `htmx:before:sse:message` | [`htmx:sse:before:message`](#htmxssebeforemessage) |
| `htmx:after:sse:message` | [`htmx:sse:after:message`](#htmxsseaftermessage) |
