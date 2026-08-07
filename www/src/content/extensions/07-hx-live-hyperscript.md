---
title: "hx-live-hyperscript"
description: "Optional shorthand syntax for hx-live expressions"
category: "UX"
icon: "icon-[mdi--code-braces]"
keywords: ["live", "hyperscript", "sigils", "syntax", "selector"]
---

`hx-live-hyperscript` adds shorthand syntax to [`hx-live`](06-hx-live). It
rewrites expressions to the core `q()` API before they run.

## Installing

Load both extensions:

```html
<script src="https://cdn.jsdelivr.net/npm/htmx.org@__VERSION__/dist/htmx.min.js"></script>
<script src="https://cdn.jsdelivr.net/npm/htmx.org@__VERSION__/dist/ext/hx-live.min.js"></script>
<script src="https://cdn.jsdelivr.net/npm/htmx.org@__VERSION__/dist/ext/hx-live-hyperscript.min.js"></script>
```

The extension adds syntax only. It does not add a state model or runtime API.

## Attribute sigils

`@` reads and writes local state. `^` uses explicit closest-owner lookup.

| Shorthand | Core form |
| --- | --- |
| `@data-count` | `q(this).data.count` |
| `^data-count` | `q(this).closest.data.count` |
| `@aria-expanded` | `q(this).aria.expanded` |
| `^aria-expanded` | `q(this).closest.aria.expanded` |
| `@.active` | `q(this).class.active` |
| `^.active` | `q(this).closest.class.active` |
| `@readonly` | `q(this).attr.readonly` |
| `^readonly` | `q(this).closest.attr.readonly` |

The sigils also work after a `q()` expression:

```js
q('#cart').@data-count++
q('.tab').@aria.selected = true
q('.item').^data-open = true
```

Without an attribute key, `@data-*`, `^data-*`, `@class`, and `^class` name
their corresponding state namespaces.

## Selector literals

`#id` is shorthand for `q('#id')`. `<.../>` accepts any selector supported by
`q()`:

```js
#cart.@data-count++
<.row/>.@hidden = true
<previous input/>.@value
<.error/>.^data-invalid = true
```

Selector literals support the directional grammar:

```js
<first .item/>
<last .item/>
<next .item/>
<previous .item/>
<closest .field/>
<.item in #panel/>
```

They also work with possessive access:

```js
#cart's @data-count++
<.field/>'s @value
```

Possessive access is shorthand for continuing from the selected proxy.

## Attribute names in helpers

Inside `toggle()` and `take()`, the shorthand names the attribute without a
string:

```js
toggle(@aria-expanded)
toggle(@data-view, 'grid', 'list')
take(@aria-selected)
take(@.active)
```

The plain core forms remain available:

```js
toggle('aria-expanded')
toggle('data-view', 'grid', 'list')
take('aria-selected')
take('.active')
```

## Rewrite boundaries

The rewrite skips strings, comments, regular expressions, and raw template
text. A `^` or `<` after a value keeps its normal JavaScript meaning.

For the complete state model, read [`hx-live`](06-hx-live).
