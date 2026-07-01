---
title: "htmx:finally:swap"
description: "After swap handling finishes"
---

The `htmx:finally:swap` event fires after a content unit finishes swap handling, even when the swap set is canceled or an individual swap is skipped.

## When It Fires

After [`htmx:after:swaps`](/reference/events/htmx-after-swaps), or after swap handling exits early.

## Event Detail

- `ctx` - Request context
  - `ctx.swap` - The incoming swap request
  - `ctx.swaps` - Array of resolved swaps, when swap planning completed

## Example

```javascript
htmx.on('htmx:finally:swap', (evt) => {
  console.log('Swap handling finished');
});
```

Use this event for cleanup that must run whether swaps complete, are canceled, or are skipped.
