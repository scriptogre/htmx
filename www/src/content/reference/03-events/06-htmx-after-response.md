---
title: "htmx:after:response"
description: "Fires after `response.text()`"
---

The `htmx:after:response` event fires after htmx reads the response body into `ctx.swap.content`, before it processes HX response headers, status rules, or swaps.

See the [request → response → swap lifecycle](/reference/events).

## When It Fires

After [`htmx:before:response`](/reference/events/htmx-before-response) and body consumption. [`htmx:response:error`](/reference/events/htmx-response-error) follows when the response status is 400 or higher.

Cancelling this event has no effect.

## Event Detail

- `ctx` - Request context with `ctx.response` and `ctx.swap.content`

## Example

```javascript
htmx.on('htmx:after:response', (evt) => {
  evt.detail.ctx.swap.content = transform(evt.detail.ctx.swap.content);
});
```
