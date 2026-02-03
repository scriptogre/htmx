# htmx 4.0 Refactor — Ideas & Decisions

`SETTLED` = locked in | `OPEN` = leaning but needs validation | `PARKING` = revisit later

---

## Core Principles

- **SETTLED**: Thin kernel + everything else as features/middleware
- **SETTLED**: Single file — no module splitting
- **SETTLED**: Clean DOM — WeakMap for state, no `element._htmx`
- **SETTLED**: JIT — read attributes when needed, not upfront
- **SETTLED**: Features run in definition order. `return false` cancels.
- **SETTLED**: `wrap()` Proxy for elements (not HtmxElement class)

---

## Kernel Owns

Activation/deactivation, trigger binding, verb extraction, fetch, swap, event dispatch.

---

## Open Design Questions

**Events**: Currently proposing 7 flat events (`init`, `activate`, `deactivate`, `request`, `response`, `swap`, `done`). Needs validation — are these enough to support all current htmx functionality once features are extracted? Current codebase has 20+ events.

**Event detail shape**: Ideal is 3 top-level objects matching lifecycle: `request` → `{ request }`, `response` → `{ request, response }`, `swap` → `{ request, response, swap }`. Where do `source.element` and `source.event` live? Inside `request`? Top-level? TBD.

**Error handling**: `detail.error` vs `throw`? Current codebase mostly swallows errors silently. Want much better debuggability. Need a consistent error strategy.

**Feature-specific state**: Where does transient per-request state live (e.g. indicators, disabled elements)? Options: on `detail`, in WeakMap, feature-provided hook. Need a single pattern.

**Config structure**: Is `config.swap` the right shape? Should swap defaults live in the kernel config at all, or purely in the hx-swap feature?

---

## Config

- **SETTLED**: Nested — `config.request`, `config.swap`, `config.trigger`, `config.syntax`, `config.inheritance`, `config.security`
- **SETTLED**: `config.syntax.format` pluggable (RelaxedJSON default)
- **SETTLED**: `config.inheritance` — `{ enable, mode: 'explicit'|'implicit', marker: 'inherited' }`
- **SETTLED**: Feature-specific config lives on the feature (e.g. `htmx.features['timeout'].delay`)
- **SETTLED**: CSS classes out of kernel — `injectStyles` feature owns them
- **OPEN**: `config.trigger.events` with `*` wildcard as default fallback
- **OPEN**: `config.swap.modifiers` — features define defaults, not kernel

---

## Wrapped Elements

```
element.attr(name, opts)  element.find(selector)  element.findAll(selector)
element.trigger(event, detail)  element.is(other)  element.native
```

- **OPEN**: `element.state` — expose WeakMap (e.g. `element.state.cache.etag`)
- **OPEN**: `state.get()` accepts wrapped or native

---

## Event Dispatch

- **SETTLED**: `composed: true` on all CustomEvents (Shadow DOM, htmx 4.0 already does this)
- **SETTLED**: Disconnected element fallback — dispatch on `document` if element removed

---

## Features (complete list)

Everything below is NOT kernel. Each must become a feature in the new architecture.

### Attributes

| Feature | Notes |
|---------|-------|
| hx-boost | Intercepts links/forms, same-origin guard, modifier key bypass |
| hx-on | Inline event handlers via `hx-on:<event>` attributes |
| hx-on shorthands | `::request` → `htmx:before:request` etc. Separate feature |
| hx-swap | Swap method + modifiers (delay, settle, scroll, show, transition, ignoreTitle, strip) |
| hx-target | Swap target selector |
| hx-select | Filter fragment before swap |
| hx-select-oob | Select elements from response for OOB swap |
| hx-swap-oob | Response-side OOB swap marker |
| hx-confirm | User confirmation, supports `js:` for custom confirm |
| hx-headers | Custom request headers, supports `js:` |
| hx-vals | Extra request body values, supports `js:` |
| hx-include | Include additional inputs in request body |
| hx-validate | HTML5 form validation before request |
| hx-encoding | `multipart/form-data` support |
| hx-indicator | Elements that show during requests (ref-counted) |
| hx-disable | Elements to disable during requests (ref-counted) |
| hx-sync | Request queuing strategies (queue first/last/all, drop, replace, abort) |
| hx-config | Per-element config overrides |
| hx-preserve | Preserve elements across swaps (pantry/moveBefore) |
| hx-ignore | Skip activation for element + descendants |
| hx-trigger | Event binding with modifiers (delay, throttle, once, changed, from, target, consume) |
| hx-push-url | Push URL to browser history |
| hx-replace-url | Replace URL in browser history |
| hx-status | Per-status-code config (exact `404`, wildcard `4xx`) |
| hx-action | URL independent of HTTP method |
| hx-method | HTTP method independent of URL |
| hx-debug | Enable debug for subtree |

### Trigger Types

| Feature | Notes |
|---------|-------|
| intersect / revealed | IntersectionObserver-based triggers (root, threshold options) |
| every | Polling at interval |
| load | Fire on activation |
| event filter `[expr]` | Bracket expression evaluated against event |
| Default trigger inference | form→submit, input/select/textarea→change, *→click |

### Request Lifecycle

| Feature | Notes |
|---------|-------|
| dynamicHeaders | HX-Current-URL, HX-Target, HX-Source, HX-Boosted, HX-Request-Type |
| formData | Automatic form collection, submitter, checkbox/radio/file/multi-select, GET→params |
| timeout | AbortSignal-based, configurable per-element |
| etag | If-None-Match / ETag caching |
| js: eval | `js:` / `javascript:` prefix in attribute values |

### Response Processing

| Feature | Notes |
|---------|-------|
| noSwap | Suppress swap on 204/304 (configurable status codes) |
| responseHeaders | HX-Trigger, HX-Redirect, HX-Refresh, HX-Location, HX-Retarget, HX-Reswap, HX-Reselect, HX-Push-Url, HX-Replace-Url |
| title | Extract `<title>` from response |
| executeScripts | Recreate `<script>` tags so they execute |

### Swap

| Feature | Notes |
|---------|-------|
| Swap methods | innerHTML, outerHTML, beforebegin, afterbegin, beforeend, afterend, delete, none, textContent |
| morph | Built-in DOM diffing (innerMorph, outerMorph). Config: scanLimit, morphIgnore, morphSkip, morphSkipChildren |
| oob | Out-of-band swaps from response |
| partials | `<template hx type="partial">` — response-driven targeted swaps |
| hx-preserve | Pantry pattern for preserving elements |
| autofocus | Focus first `[autofocus]` after swap |
| anchorScroll | Scroll to URL fragment after swap |
| fullDocParsing | Handle `<html>`, `<body>`, `<head>` in responses, `<hx-*>` tag conversion |

### Post-Swap

| Feature | Notes |
|---------|-------|
| history | pushState/replaceState, popstate restoration, reload mode |
| viewTransitions | View Transitions API with sequential queue |
| cssTransitions | Settle-based CSS transitions (copy old attrs, restore after settle) |
| injectStyles | Indicator CSS injection, owns class names (htmx-request, htmx-indicator, htmx-swapping, htmx-settling, htmx-added) |

### Infrastructure

| Feature | Notes |
|---------|-------|
| extensions | registerExtension, allowlist, init API, handle_swap, event hooks, internal API |
| compat | Backwards-compat aliases (htmx.process, htmx.ajax, etc.) |
| htmx:abort | Abort in-flight requests via event |
| metaConfig | `<meta name="htmx-config">` global overrides |
| metaCharacter | Replace `:` in attribute names for framework compat |
| inheritance:append | `hx-*:append` suffix for appending to inherited values |

### Public API

`process`, `swap`, `ajax`, `trigger`, `find`, `findAll`, `on`, `onLoad`, `takeClass`, `timeout`, `forEvent`, `parseInterval`, `registerExtension`, `config`

---

## Parking Lot

- `detail.waitUntil(promise)` — async event blocking. Revisit after v1.
- `CANCELLED` sentinel + `__cancellable()` — pipeline flow control. Want if consistent.
- Universal attribute parser — want it, need to solve hx-trigger edge cases.
- View Transitions queue — exact sequencing mechanism TBD.
- Configurable selectors (`config.selectors.activate`, `.ignore`, `.inputs`) — kernel or feature?
- Meta config dot-path naming — `<meta name="htmx-config" content="swap.method:innerHTML">` vs other formats.
- `htmx.inspect(element)` — debug utility for WeakMap state.
- State-to-DOM sync — CSS-targetable state concept. Over-engineered for now, idea is interesting.
