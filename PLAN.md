# Plan: Simplify request() and trigger system

## Context

We're building htmx 4.0 core (`src/htmx.core.js`). The current implementation works but the two most complex areas — `request()` and the trigger system — are hard to read and reason about.

## Current problems

### request() (~70 lines)

1. **Too many concerns in one function**: header resolution, fetch, response parsing, target resolution, fragment creation, swap execution, settle — all interleaved with event emission
2. **Detail object accumulates incrementally**: starts with `{source, request, response: null, swap: null, error: null}`, gets fields added throughout. Hard to see the full shape at any point.
3. **Repetitive error pattern**: construct error object → emit → return (done 3 times)
4. **The destructure trick**: `const {timeout, headers: defaultHeaders, ...fetchDefaults} = config.defaultRequest` is clever but not obvious
5. **8 event emissions** in the happy path (before/after for request, response, swap, settle) make the actual logic hard to find between them

### Trigger system (setupTriggers + handler + parseTrigger + parseModifiers)

1. **setupTriggers does too much**: parses attributes, creates the handler closure, loops through triggers, binds them
2. **The handler closure** mixes: event handling → emit before/after trigger → JIT attribute reading → request dispatch. That's 4 concerns in one closure.
3. **Registry fallback**: `config.triggers[trigger.event] || config.triggers.event` — `.event` is both a named trigger type AND the fallback for unknown DOM events. This dual role is confusing. (Marked as TODO in code)
4. **Modifier application** is buried inside `config.triggers.event` — invisible from `setupTriggers`

## What to redesign

### 1. request() should read like a recipe

The happy path should be obvious at a glance. Each phase should be a clear block. Consider:

- Extracting phase logic into small focused functions
- Or using clear comment blocks that separate phases visually
- The 8 event emissions are load-bearing (extensions hook into them) — they can't be removed, but the actual logic between them should be minimal and obvious
- Error paths should be DRY (maybe a helper, maybe early returns)
- The header resolution and fetch options assembly should be straightforward

### 2. Trigger system should be transparent

- The "what happens when an element is triggered" flow should read linearly
- The registry lookup/fallback needs a cleaner pattern than `config.triggers[name] || config.triggers.event`
- Consider whether `setupTriggers` should be broken up or just reorganized
- The handler that bridges trigger → request is the most important code path in htmx — it should be crystal clear

### 3. Naming

- `parseModifiers` — fine (it's the general syntax parser)
- `parseTrigger` — fine (trigger-specific parsing on top of parseModifiers)
- `parseDuration` — fine (internal utility)
- `setupTriggers` — maybe rename? It does parsing + binding
- `addCleanup` — fine
- The registry fallback pattern needs better naming/structure than `config.triggers.event`

## Files

| File | Purpose |
|---|---|
| `src/htmx.core.js` | Current implementation — rewrite request() and trigger sections |
| `test-kernel.html` | Test page with inlined extensions — update if API changes |

## Instructions

1. Read `src/htmx.core.js` for current implementation
2. Redesign ONLY the request() function and trigger system (setupTriggers, handler, parsing)
3. Keep everything else as-is (boot, init, cleanup, wrapper, events, config, public API)
4. Prioritize readability over cleverness
5. The code should be something a new contributor can read top-to-bottom and understand
