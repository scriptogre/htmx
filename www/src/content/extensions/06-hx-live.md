---
title: "hx-live"
description: "Bind DOM state with inline expressions"
category: "UX"
icon: "icon-[mdi--lightning-bolt]"
keywords: ["live", "reactive", "bind", "DOM", "q", "selector"]
---

The `hx-live` extension keeps HTML attributes, text, classes, and styles in sync with the DOM.

## Mental Model

```text
Can HTML provide the behavior?
├─ yes → use HTML
└─ no
   Can CSS derive the presentation?
   ├─ yes → use HTML + CSS
   └─ no  → use hx-live
```

See [HTML and CSS First](#html-and-css-first) for native examples.

## Installing

```html
<script src="https://cdn.jsdelivr.net/npm/htmx.org@__VERSION__/dist/htmx.min.js"></script>
<script src="https://cdn.jsdelivr.net/npm/htmx.org@__VERSION__/dist/ext/hx-live.min.js"></script>
```

## Usage

### Update Text

Bind [`textContent`](#text) with `:text`:

```html
<label>
  Name
  <input id="name" value="Ada">
</label>

<output :text="'Hello, ' + q('#name').value"></output>
```

```text
input: Ada    → output: Hello, Ada
input: Grace  → output: Hello, Grace
```

### Bind an Attribute

Prefix an attribute with `:`:

```html
<input id="terms" type="checkbox">

<button :disabled="!q('#terms').checked">
  Continue
</button>
```

```text
unchecked → button.disabled = true
checked   → button.disabled = false
```

### Change State

Use [`hx-on`](/reference/attributes/hx-on) for actions caused by an event:

```html
<button aria-pressed="false"
        hx-on:click="aria.pressed = !aria.pressed">
  Mute
</button>

<style>
[aria-pressed="true"] {
  background: var(--selected);
}
</style>
```

```text
false → click → true → click → false
```

### Share State

```html
<section data-quantity="1">
  <button hx-on:click="data.quantity--"
          :disabled="data.quantity <= 1">
    Remove one
  </button>

  <output :text="data.quantity"></output>

  <button hx-on:click="data.quantity++">
    Add one
  </button>
</section>
```

```text
section[data-quantity]
├── button  reads and writes quantity
├── output  reads quantity
└── button  reads and writes quantity
```

Bare `data.quantity` uses the nearest [`data-quantity`](https://developer.mozilla.org/en-US/docs/Web/HTML/Global_attributes/data-*) owner.

### Read Nearby State

Use [`q()` directionals](#find-elements) for local relationships:

```html
<div class="field">
  <input value="Ada">

  <output :text="q('previous input').value.length + ' characters'"></output>
</div>
```

```text
Ada    → 3 characters
Grace  → 5 characters
```

### Wait for an Animation

Use top-level `await` in [`hx-on`](/reference/attributes/hx-on):

```html
<aside class="notice"
       hx-on:dismiss="
         q(this).class.leaving = true
         await forEvent('transitionend', '500ms')
         this.remove()
       ">
  Saved
  <button hx-on:click="q('closest .notice').trigger('dismiss')">
    Dismiss
  </button>
</aside>
```

```css
.notice {
  transition: opacity 200ms;
}

.notice.leaving {
  opacity: 0;
}
```

`transitionend` removes the notice. `500ms` is the fallback.

## Attributes

### `:<attribute>`

Binds an HTML attribute to an expression:

```html
<input id="email" type="email">
<button :disabled="!q('#email').value">Subscribe</button>
```

The binding re-runs when the DOM changes, a form control emits `input` or `change`, or an htmx swap finishes.

Attribute values follow HTML rules:

| Kind | Example | Falsy or empty result |
|---|---|---|
| Boolean | `:disabled`, `:hidden`, `:open` | Removes the attribute |
| ARIA | `:aria-expanded` | Writes `"false"` |
| Property-backed | `:checked`, `:selected`, `:value` | Updates the property and attribute |
| Other | `:href`, `:data-state` | `null` or `undefined` removes the attribute |

```html
<button :hidden="q('.result').count === 0">Clear</button>
<a :href="'/users/' + q('#user').value">Profile</a>
<input type="checkbox" :checked="data.selected">
```

The `:` prefix conflicts with Alpine.js binding syntax. When Alpine exists as `window.Alpine` during initialization, hx-live disables `:` and logs a warning. See [`live.bindPrefix`](#livebindprefix).

### `hx-live:<attribute>`

The long form of `:<attribute>`:

```html
<button hx-live:disabled="!q('#email').value">
  Subscribe
</button>
```

It always works, including when:

- A build tool removes `:` attributes.
- Alpine.js uses the `:` prefix.
- [`live.bindPrefix`](#livebindprefix) disables or changes the short prefix.

### `:text`

Binds [`textContent`](https://developer.mozilla.org/en-US/docs/Web/API/Node/textContent):

```html
<input type="number" value="2">
<input type="number" value="3">
<output :text="q('first input').value * q('last input').value"></output>
```

`null` and `undefined` become an empty string. Other values become text.

### `:html`

Binds [`innerHTML`](https://developer.mozilla.org/en-US/docs/Web/API/Element/innerHTML):

```html
<select id="status">
  <option>Ready</option>
  <option>Waiting</option>
</select>

<p :html="'Status: <strong>' + q('#status').value + '</strong>'"></p>
```

Prefer `:text` for text. Sanitize untrusted HTML before using `:html`.

### `:class` and `:.<class>`

Bind one class with `:.<class>`:

```html
<input type="number" value="0">
<p :.warning="q('previous input').value < 0">
  Balance
</p>
```

Bind several classes with an object:

```html
<input id="score" type="number" value="50">

<output :class="{
  low: q('#score').value < 40,
  high: q('#score').value > 80
}"></output>
```

Or return a space-separated string:

```html
<output :class="q('#score').value > 80 ? 'high bold' : 'low'"></output>
```

The binding manages only the classes it writes. Static classes remain unless they use the same names.

Prefer CSS selectors for state already represented by HTML:

```css
button[aria-pressed="true"] { font-weight: bold; }
details[open] { border-color: var(--accent); }
input:invalid { border-color: var(--error); }
```

### `:style`

Binds inline styles from a string:

```html
<input id="progress" type="range" value="50">
<div :style="'width:' + q('#progress').value + '%'"></div>
```

Or from an object:

```html
<div :style="{
  width: q('#progress').value + '%',
  backgroundColor: 'tomato'
}"></div>
```

Camel-case keys become CSS property names. The binding manages only the properties it writes.

Prefer a class, semantic attribute, or CSS custom property when CSS can own the presentation.

### `hx-live`

Runs a statement body whenever hx-live recomputes:

```html
<div data-last-value=""
     hx-live="
       let value = q('#source').value
       if (value === data.lastValue) return

       data.lastValue = value
       trigger('value-changed', { value })
     ">
</div>
```

Use `hx-live` only when one binding cannot express the work. Guard side effects because the body can run after any observed DOM change.

Top-level `await` works directly. Record the source value before waiting so unrelated DOM changes do not repeat the work:

```html
<div data-last-value=""
     hx-live="
  let value = q('#source').value
  if (value === data.lastValue) return

  data.lastValue = value
  await debounce(200)
  updatePreview(value)
"></div>
```

Do not wrap it in an async function. Errors from a nested async function cannot be handled by htmx.

## Expression Reference

Expressions in `:<attribute>`, `hx-live`, and [`hx-on`](/reference/attributes/hx-on) share the same DOM helpers.

### Current Element

`this` is the element that owns the expression:

```html
<button hx-on:click="this.remove()">Remove</button>
```

These helpers also target the current element:

| Expression | Reads or changes |
|---|---|
| `attr.hidden` | HTML attributes and live form properties |
| `aria.expanded` | Local `aria-expanded` state |
| `data.count` | The nearest `data-count` state |
| `closest.aria.busy` | The nearest `aria-busy` owner |
| `closest.attr.inert` | The nearest `inert` owner |
| `style` | The element's inline style |
| `matches(':invalid')` | Whether the element matches a CSS selector |

```html
<button aria-expanded="false"
        hx-on:click="aria.expanded = !aria.expanded">
  Toggle
</button>
```

Use `delete` or `null` to remove most attributes:

```html
<button hx-on:click="
  delete attr.title
  aria.description = null
">
  Clear description
</button>
```

`data.*` accepts strings and JSON values:

```html
<section data-count="1" data-items="[]">
  <button hx-on:click="
    data.count++
    data.items = [...data.items, 'new']
  ">
    Add
  </button>
</section>
```

Booleans, numbers, arrays, objects, and `null` round-trip through `data-*`. Other text remains a string. Assign `undefined` or use `delete` to remove the attribute.

### DOM State

Choose one state owner:

| State | Use |
|---|---|
| Native property | Form values, checked state, open state |
| ARIA | Accessible component state |
| `data-*` | Local application state with no semantic HTML home |
| Class | Presentation with no useful semantic selector |

Read state on another element through `q()`:

```html
<input id="accept" type="checkbox">

<button :disabled="!q('#accept').checked">
  Continue
</button>
```

The state namespaces are typed:

```text
q('#amount').value          → live input value
q('#toggle').checked        → boolean
q('#panel').aria.hidden     → boolean when "true" or "false"
q('#meter').aria.valueNow   → number
q('#tabs').aria.controls    → array of IDs
q('#cart').data.items       → parsed JSON
```

Use `.closest` to address the nearest owner explicitly:

```html
<section aria-busy="false">
  <button hx-on:click="q(this).closest.aria.busy = true">
    Load
  </button>
</section>
```

### Find Elements

`q()` selects elements and exposes their DOM state:

```html
<button :disabled="q('.required:invalid').count > 0">
  Submit
</button>
```

It reads from the first match and writes DOM properties to every match:

```html
<button hx-on:click="q('.filter').hidden = true">
  Hide filters
</button>
```

Use CSS selectors or directional selectors:

```text
q('.item')             every matching element
q('first .item')       first match
q('last .item')        last match
q('next .item')        first match after this element
q('previous input')    closest matching input before this element
q('closest .card')     nearest matching ancestor
q('.item in #cart')    matches inside #cart
q('.item in this')     matches inside this element
```

Directional selectors use the element that owns the expression as their anchor.

Chain `q()` when each match needs its own query:

```html
<button hx-on:click="
  q('.error').q('closest .field').class.invalid = true
">
  Mark invalid fields
</button>
```

Useful collection operations:

```text
q('.item').count       number of matches
q('.item').arr()       Array<Element>
q('.item').map(...)    map over matches
for (let item of q('.item')) { ... }
```

### Select One Element

`take()` moves one state among siblings:

```html
<div role="tablist">
  <button role="tab"
          aria-selected="true"
          hx-on:click="take('aria-selected')">
    Overview
  </button>

  <button role="tab"
          aria-selected="false"
          hx-on:click="take('aria-selected')">
    Activity
  </button>
</div>
```

For ARIA, `take()` writes `"false"` to the other owners and `"true"` to the current element.

Pass a selector to change the scope:

```html
<div class="toolbar">
  <button aria-pressed="true"
          hx-on:click="take('aria-pressed', '.toolbar button')">
    Bold
  </button>

  <button aria-pressed="false"
          hx-on:click="take('aria-pressed', '.toolbar button')">
    Italic
  </button>
</div>
```

### Timing

Delay work on one element with `debounce()`:

```html
<input hx-on:input="
  await debounce(200)
  trigger('search', { value: this.value })
">
```

Each element has its own debounce channel.

Wait for an event or timeout, whichever happens first:

```html
<div hx-on:close="
  q(this).class.closing = true
  await forEvent('transitionend', '500ms')
  this.remove()
"></div>
```

Wait for the next animation frame:

```html
<button hx-on:click="
  q(this).class.shake = false
  await nextFrame()
  q(this).class.shake = true
">
  Shake
</button>
```

Other action helpers:

| Helper | Effect |
|---|---|
| `trigger(type, detail?, bubbles?)` | Dispatch a `CustomEvent` from this element |
| `insert(position, html)` | Insert HTML at `before`, `after`, `start`, or `end` |
| `q(...).trigger(...)` | Dispatch from every match |
| `q(...).insert(...)` | Insert relative to every match |

Sanitize untrusted strings before passing them to `insert()`.

## Config

Configure hx-live with [`<meta name="htmx-config">`](/reference/config/htmx-config#configure-via-meta-tag) or [`hx-config`](/reference/attributes/hx-config).

### `live.inputDebounce`

Set how long hx-live waits after an `input` event:

```html
<meta name="htmx-config" content="live.inputDebounce:20ms">
```

Defaults to `100ms`. A `change` event recomputes without this delay.

### `live.bindPrefix`

Change or disable the `:` binding prefix:

```html
<meta name="htmx-config"
      content='{"live":{"bindPrefix":"hx:"}}'>
```

| Value | Binding syntax |
|---|---|
| Not set | `:hidden`, unless Alpine.js is detected |
| `:` | `:hidden` |
| `hx:` | `hx:hidden` |
| Empty | Short form disabled |

The canonical `hx-live:hidden` form always works.

### `live.useDollar`

Enable `$()` as an alias for `q()`:

```html
<meta name="htmx-config" content="live.useDollar:true">

<input id="name">
<output :text="$('#name').value"></output>
```

Defaults to `false`, so hx-live does not replace a page's existing `$`.

## How It Works

hx-live registers each binding once, then recomputes all registered expressions together:

```text
DOM mutation ─┐
input/change ─┼─→ schedule one microtask ─→ run expressions ─→ update DOM
htmx swap ────┘
```

- One document-wide [`MutationObserver`](https://developer.mozilla.org/en-US/docs/Web/API/MutationObserver) watches attributes, text, and added or removed nodes.
- Synchronous changes coalesce into one recompute.
- Recomputes pause during an htmx swap and run once after it finishes.
- Writes made by a binding do not schedule a feedback loop.
- Removed bindings are cleaned up. The observer detaches when none remain.
- A run longer than `16ms` logs one warning.

Every change recomputes every live expression. hx-live does not track dependencies between individual values.

## HTML and CSS First

### Show and Hide Details

```html
<details>
  <summary>Shipping address</summary>
  <address>...</address>
</details>
```

```css
details[open] {
  border-color: var(--accent);
}
```

### Open a Popover

```html
<button popovertarget="menu">Menu</button>

<nav id="menu" popover>
  <a href="/profile">Profile</a>
  <a href="/settings">Settings</a>
</nav>
```

### Show Content from a Checkbox

```html
<input id="show-filters" type="checkbox" checked>
<label for="show-filters">Show filters</label>

<section class="filters">
  ...
</section>
```

```css
#show-filters:not(:checked) ~ .filters {
  display: none;
}
```

### Style Invalid Fields

```html
<label for="email">Email</label>
<input id="email" name="email" type="email" required>
<p class="error">Enter a valid email address.</p>
```

```css
input:not(:user-invalid) + .error {
  display: none;
}
```

## Notes

- Keep the DOM as the source of truth. Prefer native properties, ARIA, and `data-*` over external JavaScript state.
- Keep expressions safe to run again. Guard network calls, timers, and other side effects.
- Use [`hx-ignore`](/reference/attributes/hx-ignore) to skip live bindings in a subtree.
- An `innerHTML` or `outerHTML` swap replaces state inside its target. Keep durable local state above that target or return it from the server.
- Morph swaps update `data-*` attributes by default. Add `"data-"` to [`morphIgnore`](/reference/config/htmx-config-morphIgnore) when client-owned data must survive a morph.
- Use `hx-live:<attribute>` when a build tool strips `:` attributes.
- Alpine.js and hx-live both use `:`. See [`live.bindPrefix`](#livebindprefix) when both run on one page.

## See Also

- [`hx-on`](/reference/attributes/hx-on)
- [`hx-live-hyperscript`](/extensions/hx-live-hyperscript)
- [Locality of Behaviour](/essays/locality-of-behaviour)
