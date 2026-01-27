---
title: "Targets"
description: "Specify which elements receive server responses"
---

# Targets

By default, responses replace the element that made the request.

Change this with [`hx-target`](/reference/attributes/hx-target).

```html
<button hx-get="..."
        hx-target="#results">
  Load Results
</button>

<div id="results">
    <!-- Response goes here -->
</div>
```

The button makes the request.

The response loads into `#results`.

The button stays unchanged.

## Extended Selectors

Use [extended selectors](/docs/core-concepts/extended-selectors) to target elements flexibly.

Beyond standard CSS selectors, you can use:

* [`this`](/docs/core-concepts/extended-selectors#this) - target the element itself
* [`closest <selector>`](/docs/core-concepts/extended-selectors#closest-selector) - find the nearest ancestor
* [`find <selector>`](/docs/core-concepts/extended-selectors#find-selector) - find the first child
* [`next`](/docs/core-concepts/extended-selectors#next) - target the next sibling
* [`next <selector>`](/docs/core-concepts/extended-selectors#next-selector) - find next sibling matching `<selector>`
* [`previous`](/docs/core-concepts/extended-selectors#previous) - target the previous sibling
* [`previous <selector>`](/docs/core-concepts/extended-selectors#previous-selector) - find previous sibling matching `<selector>`
* And more...

See the full [extended selectors guide](/docs/core-concepts/extended-selectors) for all options and examples.

This keeps your HTML cleaner without requiring `id` attributes everywhere.
