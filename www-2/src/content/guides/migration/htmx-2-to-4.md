---
title: "htmx 4"
description: "Upgrade from htmx 2 to htmx 4"
---

htmx 4 is a complete rewrite. It uses `fetch()` instead of `XMLHttpRequest`.

Most htmx 2 apps will need changes to work with htmx 4.

## Quick Start: Keep Old Behavior

Add this to make htmx 4 work like htmx 2:

```javascript
htmx.config.implicitInheritance = true;
htmx.config.noSwap = [204, 304, '4xx', '5xx'];
```

This fixes the two biggest changes. Now update your code piece by piece.

## Three Big Changes

### 1. Uses `fetch()` Now

htmx 4 uses the modern `fetch()` API for all requests.

**What this means:** Upload progress events are gone. Use fetch streams if you need them.

### 2. Inheritance is Explicit

Before, child elements inherited parent attributes automatically.

Now, use `:inherited` to inherit:

```html
<!-- htmx 2 -->
<div hx-confirm="Sure?">
    <button hx-delete="/item/1">Delete</button>
</div>

<!-- htmx 4 -->
<div hx-confirm:inherited="Sure?">
    <button hx-delete="/item/1">Delete</button>
</div>
```

Works with all attributes: `hx-boost:inherited`, `hx-target:inherited`, etc.

### 3. Error Responses Swap Now

htmx 2 didn't swap `4xx` or `5xx` responses.

htmx 4 swaps everything except `204` and `304`.

**Why:** Error messages can now render directly.

## Renamed Attributes

| Old Name | New Name |
|----------|----------|
| `hx-disabled-elt` | `hx-disable` |
| `hx-disable` | `hx-ignore` |

**Warning:** `hx-disable` changed meaning. Before upgrading:

1. Find all `hx-disable` in your code
2. Change them to `hx-ignore`
3. Change `hx-disabled-elt` to `hx-disable`

## Removed Attributes

| Removed | Use Instead |
|---------|-------------|
| `hx-vars` | `hx-vals` with `js:` prefix |
| `hx-params` | `htmx:config:request` event |
| `hx-prompt` | `hx-confirm` with async function |
| `hx-ext` | Extensions work automatically now |
| `hx-disinherit` | Not needed (inheritance is explicit) |
| `hx-inherit` | Not needed (use `:inherited`) |
| `hx-request` | `hx-config` |
| `hx-history` | Removed (history works differently) |
| `hx-history-elt` | Removed |

## New Attributes

| Attribute | What It Does |
|-----------|--------------|
| `hx-action` | Set request URL (use with `hx-method`) |
| `hx-method` | Set HTTP method (use with `hx-action`) |
| `hx-config` | Configure request as JSON |
| `hx-ignore` | Disable htmx on this element |
| `hx-status:404` | Swap differently for 404 responses |

## Event Name Changes

All event names now use colons: `htmx:phase:action`

### Common Events

| Old | New |
|-----|-----|
| `htmx:load` | `htmx:after:init` |
| `htmx:afterRequest` | `htmx:after:request` |
| `htmx:beforeRequest` | `htmx:before:request` |
| `htmx:afterSwap` | `htmx:after:swap` |
| `htmx:beforeSwap` | `htmx:before:swap` |
| `htmx:configRequest` | `htmx:config:request` |

### Error Events

All errors now use one event: `htmx:error`

Before, these were separate:
- `htmx:responseError`
- `htmx:sendError`
- `htmx:swapError`
- `htmx:timeout`

Now, catch all errors with `htmx:error`.

### Upload Progress

These events are **gone**:
- `htmx:xhr:loadstart`
- `htmx:xhr:loadend`
- `htmx:xhr:progress`
- `htmx:xhr:abort`

**Reason:** `fetch()` doesn't support these.

**Solution:** Use `htmx:config:request` to access the request. Track progress with fetch streams.

### New Events

- `htmx:after:cleanup` - After removing elements
- `htmx:after:history:update` - After updating history
- `htmx:after:process` - After processing elements
- `htmx:finally:request` - Always runs after requests
- `htmx:before:viewTransition` - Before view transitions
- `htmx:after:viewTransition` - After view transitions

## JavaScript API Changes

### Removed Methods

Use native JavaScript instead:

| Removed | Use Instead |
|---------|-------------|
| `htmx.addClass()` | `element.classList.add()` |
| `htmx.removeClass()` | `element.classList.remove()` |
| `htmx.toggleClass()` | `element.classList.toggle()` |
| `htmx.closest()` | `element.closest()` |
| `htmx.remove()` | `element.remove()` |
| `htmx.off()` | `removeEventListener()` |
| `htmx.logAll()` | `htmx.config.logAll = true` |
| `htmx.logNone()` | `htmx.config.logAll = false` |
| `htmx.location()` | `htmx.ajax()` |

### New Methods

- `htmx.forEvent(eventName, timeout)` - Returns promise for event
- `htmx.timeout(time)` - Returns promise for delay

## New Features

### Morphing

Morph the DOM instead of replacing it:

```html
<div hx-get="/update" hx-swap="innerMorph">Content</div>
```

Use `innerMorph` or `outerMorph`. Preserves form input and component state better.

### Modern Swap Names

Old names still work. New names are clearer:

| Old           | New       |
|---------------|-----------|
| `beforebegin` | `before`  |
| `afterend`    | `after`   |
| `afterbegin`  | `prepend` |
| `beforeend`   | `append`  |

```html
<!-- Both work the same -->
<div hx-swap="beforeend">
<div hx-swap="append">
```

### Status Code Swapping

Swap differently based on response status:

```html
<form hx-post="/save"
      hx-status:404="#not-found"
      hx-status:5xx="#error">
```

Use exact codes (`404`) or wildcards (`2xx`, `4xx`, `5xx`).

### Append Modifier

Append to inherited values:

```html
<div hx-include=".parent">
    <div hx-include:append=".child">
        <!-- Includes both .parent and .child -->
    </div>
</div>
```

Chain modifiers: `hx-include:inherited:append=".extra"`

### Partial Tags

Return multiple targets in one response:

```html
<hx-partial hx-target="#messages" hx-swap="beforeend">
    <div>New message</div>
</hx-partial>

<hx-partial hx-target="#notifications">
    <span class="badge">5</span>
</hx-partial>
```

More explicit than out-of-band swaps.

### Streaming

*This feature is still under heavy development and may change.*

Server-sent events are now built-in:

```html
<div hx-stream="continuous maxRetries:5 initialDelay:1s"
     hx-get="/live-feed">
</div>
```

Options:
- `mode`: `once` or `continuous`
- `maxRetries`: How many reconnect attempts
- `initialDelay`, `maxDelay`: Reconnect timing
- `pauseHidden`: Pause when tab is hidden

### History

History no longer uses `localStorage`.

When you press back, htmx makes a fresh request to the server.

**Why:** More reliable. No stale cached pages.

## Upgrade Music

<iframe width="1023" height="644" src="https://www.youtube.com/embed/j4fFd0dejqk" title="Playtime Is Over" frameborder="0" allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share" referrerpolicy="strict-origin-when-cross-origin" allowfullscreen></iframe>
