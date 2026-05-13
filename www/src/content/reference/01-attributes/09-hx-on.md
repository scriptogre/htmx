---
title: "hx-on"
description: "Handle events with inline scripts"
---

The `hx-on` attributes allow you to embed scripts inline to respond to events directly on an element; similar to the
[`onevent` properties](https://developer.mozilla.org/en-US/docs/Web/Events/Event_handlers#using_onevent_properties)
found in HTML, such as `onClick`.

The `hx-on` attributes improve upon `onevent` by enabling the handling of any arbitrary JavaScript event,
for enhanced [Locality of Behaviour (LoB)](/essays/locality-of-behaviour) even when dealing with non-standard DOM
events. For example, these
attributes allow you to handle [htmx events](/reference#events).

## Simple syntax: `hx-on:<event>`

For straightforward event handling with no modifiers, use the colon syntax:

```html
<button hx-on:click="alert('Clicked!')">Click</button>
```

In order to make writing htmx-based event handlers a little easier, you can use the shorthand double-colon `hx-on::` for
htmx events, and omit the "htmx" part:

```html
<!-- These two are equivalent -->
<button hx-get="/info" hx-on:htmx:before:request="alert('Making a request!')">
    Get Info!
</button>

<button hx-get="/info" hx-on::before:request="alert('Making a request!')">
    Get Info!
</button>
```

Multiple events require multiple attributes:

```html
<button hx-get="/info"
        hx-on::before:request="alert('Making a request!')"
        hx-on::after:request="alert('Done!')">
    Get Info!
</button>
```

To make this feature compatible with templating languages (e.g. [JSX](https://react.dev/learn/writing-markup-with-jsx))
that do not like colons in HTML attributes, you may use dashes in place of colons:

```html
<button hx-get="/info" hx-on--before-request="alert('Making a request!')">
    Get Info!
</button>
```

## Extended syntax: `hx-on="event modifiers => code"`

When you need modifiers like debouncing, throttling, or event filtering, use the extended syntax. It uses the
same modifier grammar as [`hx-trigger`](/reference/attributes/hx-trigger), with `=>` separating the trigger
specification from the JavaScript handler:

```html
<button hx-on="click once => log('only once')">Click</button>
<input hx-on="keyup changed delay:300ms => search()">
<div hx-on="scroll throttle:100ms => handleScroll()">
<div hx-on="keydown[key=='Escape'] from:document => closeModal()">
```

Multiple events are separated by semicolons:

```html
<input hx-on="focus => activate(); blur => deactivate()">
```

### Available modifiers

| Modifier | Example | Description |
|---|---|---|
| `once` | `click once` | Remove the listener after the first time it fires |
| `prevent` | `submit prevent` | Call `preventDefault()` before running the handler |
| `stop` | `click stop` | Call `stopPropagation()` before running the handler |
| `halt` | `click halt` | Shorthand for `prevent stop` |
| `delay:<time>` | `input delay:300ms` | Debounce: wait for a pause before firing |
| `throttle:<time>` | `scroll throttle:100ms` | Throttle: fire at most once per interval |
| `changed` | `input changed` | Only fire if the element's `.value` has changed |
| `from:<selector>` | `click from:document` | Listen on a different element |
| `from:self` | `click from:self` | Only fire when the event target is the element itself (ignore bubbled events from children) |
| `from:outside` | `click from:outside` | Only fire when the event target is outside this element (useful for "click away to close") |
| `capture` | `click capture` | Listen during the capture phase instead of the bubble phase |
| `passive` | `scroll passive` | Hint to the browser that the handler won't call `preventDefault()` (improves scroll performance) |
| `[filter]` | `keydown[key=='Enter']` | Only fire when the JavaScript expression inside brackets is truthy |

Modifiers can be combined:

```html
<!-- Debounced search that only fires when the value actually changed -->
<input hx-on="input changed delay:300ms => search()">

<!-- Close on Escape key from anywhere in the document -->
<div hx-on="keydown[key=='Escape'] from:document => close()">

<!-- Click outside to close, only once -->
<div hx-on="click once from:outside => close()">
```

### Symbols

Two symbols are available in handler scripts:

* `this` — The element on which the `hx-on` attribute is defined
* `event` — The event that triggered the handler

Properties from `event.detail` are also exposed as bare names:

```html
<button hx-on="my-event => alert(message)">Click</button>
<!-- If dispatched with detail: { message: 'hello' }, alerts 'hello' -->
```

### Notes

* `hx-on` is _not_ inherited, however due to
  [event bubbling](https://developer.mozilla.org/en-US/docs/Learn/JavaScript/Building_blocks/Events#event_bubbling_and_capture),
  `hx-on` attributes on parent elements will typically be triggered by events on child elements
* The extended syntax (`hx-on="..."`) and simple syntax (`hx-on:event="..."`) can coexist on the same element
* Browsers lowercase HTML attribute names, so `hx-on:myCustomEvent` becomes `hx-on:mycustomevent` in the DOM
  and will not match a `myCustomEvent` dispatch. Use the extended syntax instead: `hx-on="myCustomEvent => ..."`
