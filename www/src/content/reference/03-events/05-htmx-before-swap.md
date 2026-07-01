---
title: "htmx:before:swap"
description: "Before each resolved swap is applied"
---

The `htmx:before:swap` event fires once for each resolved swap, after htmx resolves the swap target and before it changes the DOM.

## When It Fires

After [`htmx:before:swaps`](/reference/events/htmx-before-swaps) and immediately before an individual swap runs.

This event does not fire for `swap:none` entries or swaps whose target cannot be resolved.

## Event Detail

- `ctx` - Request context for the current swap
  - `ctx.swap` - The resolved swap being applied
  - `ctx.swaps` - The resolved swap set for this content unit
- `task` - Beta compatibility alias for `ctx.swap`

## Example

```javascript
htmx.on('htmx:before:swap', (evt) => {
  if (evt.detail.ctx.swap.type === 'oob') {
    console.log('About to run an out-of-band swap');
  }
});
```

Cancel this event to skip only the current swap. Use [`htmx:before:swaps`](/reference/events/htmx-before-swaps) to inspect or cancel the whole swap set.
