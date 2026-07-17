---
title: "htmx:done"
description: "When the request → response → swap pipeline ends"
---

The `htmx:done` event fires when the request → response → swap pipeline ends, whether it completes, is cancelled, or fails.

See the [request → response → swap lifecycle](/reference/events).

## When It Fires

After the pipeline ends and before the next queued request starts.

It does not fire when processing stops before the request issues:

- validation failure
- cancelled [`htmx:config:request`](/reference/events/htmx-config-request)

## Event Detail

- `ctx` - Request context object

## Example

```javascript
htmx.on('htmx:done', (evt) => {
  console.log('Done:', evt.detail.ctx);
});
```

Useful for cleanup operations started after the request begins issuing.
