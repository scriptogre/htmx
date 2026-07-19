---
title: "htmx:after:actions"
description: "Fires after actions run"
---

The `htmx:after:actions` event fires after htmx runs actions.

## When It Fires

After `runActions()` processes a non-empty action set. It does not fire when [`htmx:before:actions`](/reference/events/htmx-before-actions) is cancelled.

## Event Detail

- `actions` - Actions after any `htmx:before:actions` changes, e.g. `{trigger: "myEvent"}`
- `ctx` - HTTP request context, e.g. `ctx.response.status`

See the [canonical action formats](/reference/events/htmx-before-actions#actions).

## Example

```javascript
htmx.on('htmx:after:actions', (evt) => {
  console.log('Actions ran:', evt.detail.actions);
});
```

## See Also

- [`htmx:before:actions`](/reference/events/htmx-before-actions)
