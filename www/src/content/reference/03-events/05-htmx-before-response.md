---
title: "htmx:before:response"
description: "Fires before `response.text()`"
---

The `htmx:before:response` event fires after a fetch response arrives but before htmx reads the response body.

See the [request → response → swap lifecycle](/reference/events).

## When It Fires

After [`htmx:after:request`](/reference/events/htmx-after-request), before response body is read (using [`response.text()`](https://developer.mozilla.org/en-US/docs/Web/API/Response/text)), htmx decodes response headers:

- Swap directives update `ctx.swap`:
  [`HX-Retarget`](/reference/headers/HX-Retarget),
  [`HX-Reswap`](/reference/headers/HX-Reswap),
  [`HX-Reselect`](/reference/headers/HX-Reselect).
- Other `HX-*` headers become actions in `ctx.actions`:
  [`HX-Trigger`](/reference/headers/HX-Trigger),
  [`HX-Push-Url`](/reference/headers/HX-Push-Url),
  [`HX-Replace-Url`](/reference/headers/HX-Replace-Url).

Call `preventDefault()` to skip body consumption and all later response and swap processing.

## Event Detail

- `ctx.response.raw` - The raw Response object (body not yet consumed)
- `ctx.response.status` - The HTTP status code
- `ctx.response.headers` - The response headers

## Example

```javascript
htmx.on('htmx:before:response', (evt) => {
  const status = evt.detail.ctx.response.status;
  const headers = evt.detail.ctx.response.headers;

  console.log('Response status:', status);
  console.log('Content-Type:', headers.get('content-type'));

  // Handle error status codes before body is consumed
  if (status >= 400) {
    console.log('Error response received');
  }
});
```

Cancel this event to skip normal response processing, including body consumption and the swap.
