---
title: "htmx:before:actions"
description: "Fires before actions run"
---

The `htmx:before:actions` event fires before htmx runs actions such as `HX-Trigger` or `HX-Push-Url`.

## When It Fires

Before `runActions()` executes a non-empty action set.

Core builds one action set per HTTP response from four sources:

- **Request attributes:** [`hx-push-url`](/reference/attributes/hx-push-url), [`hx-replace-url`](/reference/attributes/hx-replace-url)
- **Response headers:** such as [`HX-Trigger`](/reference/headers/HX-Trigger), [`HX-Location`](/reference/headers/HX-Location), [`HX-Push-Url`](/reference/headers/HX-Push-Url), and custom `HX-*` headers
- **Status rules:** [`hx-status:*`](/reference/attributes/hx-status)
- **Boosted navigation:** [`hx-boost`](/reference/attributes/hx-boost)

Core calls `runActions()` once with the result.

## Priority

For `pushUrl`, the first available value wins:

```text
HX-Push-Url
→ hx-status:* push
→ hx-push-url
→ hx-boost default
```

## Actions

Response headers map directly to action keys. Attributes and status rules can create the same actions.

| Action key | Response header | Value | Effect |
|---|---|---|---|
| `trigger` | [`HX-Trigger`](/reference/headers/HX-Trigger) | Event name, comma-separated names, or an HCON object | Fire named events |
| `refresh` | [`HX-Refresh`](/reference/headers/HX-Refresh) | `true` or `"true"` | Reload the page |
| `redirect` | [`HX-Redirect`](/reference/headers/HX-Redirect) | URL | Navigate with a full reload |
| `location` | [`HX-Location`](/reference/headers/HX-Location) | URL or HCON options | Send a follow-up htmx GET |
| `pushUrl` | [`HX-Push-Url`](/reference/headers/HX-Push-Url) | URL, `true`, or `false` | Push a URL into browser history |
| `replaceUrl` | [`HX-Replace-Url`](/reference/headers/HX-Replace-Url) | URL, `true`, or `false` | Replace the current browser history URL |

Any other key is a custom action. Core leaves it for extensions to handle.

## Event Detail

- `actions` - Actions about to run, e.g. `{trigger: "myEvent"}`
- `ctx` - HTTP request context, e.g. `ctx.response.status`

## Example

```javascript
htmx.on('htmx:before:actions', (evt) => {
  console.log('Running actions:', evt.detail.actions);
});
```

Unknown `HX-*` response headers become custom actions: `HX-Toast: Saved!` arrives as `actions.toast`. Core ignores them; handle them here.

```javascript
htmx.on('htmx:before:actions', (evt) => {
  if (evt.detail.actions.toast) showToast(evt.detail.actions.toast);
});
```

Cancel this event to skip execution and [`htmx:after:actions`](/reference/events/htmx-after-actions).

## See Also

- [`htmx:after:actions`](/reference/events/htmx-after-actions)
- [`htmx:before:history:update`](/reference/events/htmx-before-history-update)
