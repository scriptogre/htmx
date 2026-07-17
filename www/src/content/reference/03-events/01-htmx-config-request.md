---
title: "htmx:config:request"
description: "Fires before request data is encoded"
---

The `htmx:config:request` event fires after request values are collected and validated, but before encoding and sending.

## When It Fires

After htmx has constructed the request context but before [`htmx:confirm`](/reference/events/htmx-confirm) or [`htmx:before:request`](/reference/events/htmx-before-request).

## Event Detail

`event.detail.ctx` contains the [request context](/docs#request-context). During this event, `ctx.request.body` is a `FormData` object and `ctx.response` is not yet available.

Modify `ctx.request` to configure the request before it is sent.

Call `evt.preventDefault()` to cancel the request.

## Examples

### Add authentication to all requests

```javascript
document.body.addEventListener('htmx:config:request', function(evt) {
    evt.detail.ctx.request.headers['X-Auth-Token'] = getAuthToken();
});
```

### Set longer timeout for specific endpoint

```javascript
htmx.on('htmx:config:request', (evt) => {
    if (evt.detail.ctx.request.action.includes('/slow-endpoint')) {
        evt.detail.ctx.request.timeout = 30000;
    }
});
```

### Include credentials for CORS requests

```javascript
document.body.addEventListener('htmx:config:request', function(evt) {
    if (evt.detail.ctx.request.action.startsWith('https://api.example.com')) {
        evt.detail.ctx.request.credentials = 'include';
        evt.detail.ctx.request.mode = 'cors';
    }
});
```

### Cancel request based on condition

```javascript
htmx.on('htmx:config:request', (evt) => {
    if (!isUserAuthorized()) {
        evt.preventDefault();
    }
});
```

## Notes

- This is the ideal place to modify request configuration globally
- Changes made here apply after [`hx-config`](/reference/attributes/hx-config) attributes are processed
- Use this for cross-cutting concerns like authentication, logging, or global timeouts
