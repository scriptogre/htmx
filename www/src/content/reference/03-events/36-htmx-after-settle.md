---
title: "htmx:after:settle"
description: "After the settle phase completes"
---

The `htmx:after:settle` event fires after htmx finishes the settle phase, including any CSS transitions.

## When It Fires

After all settle callbacks have completed for newly swapped content.

## Event Detail

- `ctx` - Request context
  - `ctx.swap` - The resolved swap that was settled
- `newContent` - Array of settled elements
- `settleCallbacks` - Array of settle callbacks that ran

## Example

```javascript
htmx.on('htmx:after:settle', (evt) => {
  console.log('Settle complete for', evt.detail.newContent.length, 'element(s)');
});
```

The DOM is fully stable at this point.
