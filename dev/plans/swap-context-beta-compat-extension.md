# Swap Context Beta Compatibility Extension

## Goal

Keep core swap handling focused on the canonical htmx 4 context shape while a built-in beta compatibility extension maps beta-era APIs onto that shape.

Canonical core shape:

- `ctx.swap.content`
- `ctx.swap.target`
- `ctx.swap.*` for swap options
- `ctx.swaps` for the resolved swap set
- `ctx.history.push` and `ctx.history.replace`
- singular `htmx:before:swap` and `htmx:after:swap` for individual swaps
- plural `htmx:before:swaps` and `htmx:after:swaps` for swap sets

The beta compatibility extension is bundled by default during beta. It owns runtime aliases and warnings for beta-era public shapes.

## Checkpoints

1. Add a built-in `beta-compat` extension block at the bottom of `src/htmx.js`.
2. Move warning state and alias utilities into the extension closure.
3. Move event detail aliases into extension hooks:
   - `detail.tasks -> detail.ctx.swaps`
   - `detail.task -> detail.ctx.swap`
   - `detail.settleTasks -> detail.settleCallbacks`
4. Move flat context aliases into extension hooks:
   - `ctx.text -> ctx.swap.content`
   - `ctx.target -> ctx.swap.target`
   - `ctx.select -> ctx.swap.select`
   - `ctx.selectOOB -> ctx.swap.selectOOB`
   - `ctx.transition -> ctx.swap.transition`
   - `ctx.push -> ctx.history.push`
   - `ctx.replace -> ctx.history.replace`
5. Move event-time `ctx.swap = "..."` compatibility into the extension.
6. Move resolved swap aliases into the extension:
   - `swap.swapSpec -> swap`
7. Remove core beta compatibility helpers after extension hooks cover current behavior.
8. Audit whether `__processMainSwap`, `__processOOB`, and `__processPartials` should be replaced with one cleaner swap-planning primitive.
9. Update docs and tests to describe the built-in beta compatibility extension.

## Tests

Run targeted tests after each checkpoint:

```sh
npm test -- test/tests/unit/swap.js
npm test -- test/tests/unit/morph.js test/tests/ext/hx-optimistic.js test/tests/ext/hx-live.js test/tests/ext/hx-history-cache.js test/tests/end2end/events.js
```

Run the full suite before each commit:

```sh
npm test -- --runInBand
```

## Runtime Warning Coverage

The extension should warn on real deprecated access, not just event creation.

Cover these access paths in tests:

- `htmx.on(...)`
- `addEventListener(...)`
- `hx-on::event="..."`

Cover reads and writes where applicable:

- `ctx.text`
- `ctx.target`
- `detail.tasks`
- `detail.task`
- `detail.settleTasks`
- `ctx.swap = "none"`
