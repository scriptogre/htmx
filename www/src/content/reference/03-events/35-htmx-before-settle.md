---
title: "htmx:before:settle"
description: "Before the settle phase begins after a swap"
---

The `htmx:before:settle` event fires after new content is inserted into the DOM but before CSS transitions are applied.

## When It Fires

After a resolved swap completes, right before htmx runs the settle phase.

## Event Detail

- `ctx` - Request context
  - `ctx.swap` - The resolved swap being settled
- `newContent` - Array of newly inserted elements
- `settleCallbacks` - Array of pending settle callbacks, such as CSS transition steps

## Example

```javascript
htmx.on('htmx:before:settle', (evt) => {
  console.log('About to settle', evt.detail.newContent.length, 'element(s)');
});
```
