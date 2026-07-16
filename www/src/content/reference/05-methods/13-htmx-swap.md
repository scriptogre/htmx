---
title: "htmx.swap()"
description: "Perform an HTML content swap into the DOM"
---

The `htmx.swap()` function swaps HTML content into the DOM. For most use cases, prefer [`htmx.ajax()`](/reference/methods/htmx-ajax), which handles the complete request lifecycle.

## Syntax

```javascript
htmx.swap(content, target, options)
```

## Parameters

- `content` - The HTML content to swap.
- `target` - The target element or selector.
- `options` - Optional swap fields:
  - `source` - The source element or selector. Defaults to the resolved target.
  - `style` - Swap style such as `innerHTML` or `outerHTML`.
  - `select` - CSS selector used to select content.
  - `selectOOB` - Selector for out-of-band content.
  - `transition` - Whether to use view transitions.
  - Any [`hx-swap` modifiers](/reference/attributes/hx-swap).

## Example

```javascript
await htmx.swap(
  '<div>Swapped!</div>',
  '#output',
  { style: 'innerHTML' }
);
```
