---
title: "htmx:before:swaps"
description: "Before the resolved swap set is applied"
---

The `htmx:before:swaps` event fires after response content is parsed and htmx has resolved the swap set, but before any individual DOM swap runs.

## When It Fires

After the response body is parsed into main, partial, and out-of-band swaps.

This event fires once per content unit, even when there are zero or one resolved swaps.

## Event Detail

- `ctx` - Request context
  - `ctx.swap` - The incoming swap request, including `content`, `target`, `select`, `selectOOB`, `style`, and modifiers
  - `ctx.swaps` - Array of resolved swaps to perform
- `tasks` - Beta compatibility alias for `ctx.swaps`

## Example

```javascript
htmx.on('htmx:before:swaps', (evt) => {
  let main = evt.detail.ctx.swaps.find(swap => swap.type === 'main');
  console.log('Resolved swaps:', evt.detail.ctx.swaps.length);
});
```

Cancel this event to skip all swaps for the content unit. Use [`htmx:before:swap`](/reference/events/htmx-before-swap) to inspect or cancel one resolved swap.
