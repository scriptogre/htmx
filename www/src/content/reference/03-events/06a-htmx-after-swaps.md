---
title: "htmx:after:swaps"
description: "After the resolved swap set is applied"
---

The `htmx:after:swaps` event fires after htmx finishes applying the resolved swap set for a content unit.

## When It Fires

After all resolved swaps have completed and before title and anchor-scroll follow-up work.

This event fires once per content unit.

## Event Detail

- `ctx` - Request context
  - `ctx.swap` - The incoming swap request
  - `ctx.swaps` - Array of resolved swaps that ran or were skipped
- `tasks` - Beta compatibility alias for `ctx.swaps`

## Example

```javascript
htmx.on('htmx:after:swaps', (evt) => {
  console.log('Finished swap set:', evt.detail.ctx.swaps.length);
});
```

Use [`htmx:after:swap`](/reference/events/htmx-after-swap) to observe each individual swap.
