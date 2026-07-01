---
title: "htmx:after:swap"
description: "After each resolved swap is applied"
---

The `htmx:after:swap` event fires once after each resolved swap changes the DOM.

## When It Fires

After an individual swap inserts, replaces, morphs, or deletes content, and before the settle phase for that swap.

The event is dispatched on the swap target. If that target is no longer connected, htmx dispatches the event on `document`.

## Event Detail

- `ctx` - Request context for the current swap
  - `ctx.swap` - The resolved swap that was applied
  - `ctx.swaps` - The resolved swap set for this content unit
- `newContent` - Array of nodes inserted or updated by the swap
- `task` - Beta compatibility alias for `ctx.swap`

## Example

```javascript
htmx.on('htmx:after:swap', (evt) => {
  console.log('Finished swap:', evt.detail.ctx.swap.type);
  console.log('New nodes:', evt.detail.newContent.length);
});
```

The new content is in the DOM but may not be fully processed by htmx yet.
