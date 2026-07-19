# Bugs found and fixed on 4.0/integration

Range: `four-dev..4.0/integration`. Each entry: the bug, the fix, the test that proves it, the commit.

## 1. focusScroll swap modifier never worked as documented

- Bug: docs and tests used `focus-scroll:true`, but the swap code reads `focusScroll`. The documented spelling was a no-op.
- Fix: standardized everything on `focusScroll`.
- Test: `swap.js` "focusScroll:true scrolls the restored focused element into view" (asserts `preventScroll: false` on restored focus).
- Commit: `c81066e7`. Orthogonal.

## 2. Manual swaps crashed on boosted source elements

- Bug: history updates ran inside `swap()`, so a manual `htmx.swap()` with a boosted `sourceElement` inferred a history push and crashed (synthetic context has no request URL).
- Fix: moved `__handleHistoryUpdate` out of `swap()` into the request lifecycle. History is request-only.
- Test: `swap.js` "does not inherit boosted history behavior".
- Commit: `955d1d36`. Orthogonal.

## 3. Partial-only and OOB-only responses disagreed on the main target

- Bug: a response with only `<hx-partial>` left the main target untouched, but an OOB-only response cleared it. Inconsistent empty-swap behavior.
- Fix: unified under `config.defaultSwapEmpty: true`; partial-only responses now clear the main target unless `swapEmpty:false`.
- Test: `swap.js` "swaps empty main target when response contains only partial" (and the whitespace variant). `acae9a11` aligned hx-upsert tests.
- Commits: `8189738c` + `acae9a11`. Orthogonal. Behavior change, needs release notes.

## 4. Swap target selector destroyed by eager resolution

- Bug: `ctx.swap.target` was overwritten with the resolved element at request time, so extensions and late retargeting lost the original selector. Also: `htmx.ajax()` resolved targets relative to `document.body` instead of the source element, and treated `target: ''` as absent.
- Fix: keep the selector canonical on ctx, resolve at the points of use, expose `api.resolveTarget`. `target != null` checks.
- Tests: additions in `swap.js`, `ajax.js`, `__createRequestContext.js`, plus hx-head/hx-optimistic/hx-sse extension tests.
- Commit: `9914fca5`. Depends on the canonical swap state work.

## 5. Deferred head scripts leaked on ctx and got lost on history restore

- Bug: hx-head stashed `_deferredHeadScripts` on the request ctx and on the restore detail; history-cache restores never ran them consistently, and the private field leaked across extensions.
- Fix: WeakMap keyed by ctx/detail inside hx-head, plus a new `htmx_history_cache_after_restore` hook that runs the deferred scripts.
- Test: 76 new lines in `test/tests/ext/hx-head.js`, history-cache tests updated.
- Commit: `effef445`. Extension-only, orthogonal.

## 6. SSE legacy attribute gaps and warning spam

- Bug: legacy `sse-close` was unsupported (migration blocker), and legacy-attribute warnings fired per element per process.
- Fix: `sse-close` mapped to the new config; all legacy warnings fire once.
- Tests: `hx-sse.js` "supports legacy sse-close attribute and warns once", "supports legacy sse-connect attribute and warns once", "warns once for removed sse-swap attribute".
- Commits: `ad8faa0a`, `ebf7fca0`. Extension-only, orthogonal.

## 7. Boost config lost to hx-swap modifiers

- Bug: boost's target/transition config was overridden by `hx-swap` flat modifiers during the canonical swap migration.
- Fix: precedence restored inside the canonical swap state translation.
- Tests: `hx-boost.js` "boost target config overrides hx-swap target modifier", "boost transition config overrides hx-swap transition modifier".
- Commit: `096b30f3` (part of the canonical swap migration, not extractable).

## 8. hx-status history overrides beat HX-Push-Url / HX-Replace-Url headers

- Bug: an `hx-status` rule writing push/replace overrode explicit server headers. Headers should win.
- Fix: `__handleStatusCodes` only writes history actions when no HX-Push-Url / HX-Replace-Url header is present.
- Test: `__runActions.js` "HX-Push-Url header overrides hx-push-url attribute".
- Commit: `5b3a9edf`. Depends on ctx.actions.

## 9. HX-Location push/replace options were dead code

- Bug: HX-Location's documented `replace` option parsed into the ctx root, which nothing read. HX-Location always pushed.
- Fix: options flow through `htmx.ajax()` push/replace normalization; push only defaults when no replace is given.
- Test: `__runActions.js` "HX-Location replace option replaces instead of pushing". Known weakness: it does not assert history length, so it would also pass with a push. Needs strengthening.
- Commit: `a06f2667`. Depends on runActions.

## 10. hx-method lost to shorthand request attributes

- Bug: when `hx-action` was absent, `hx-get`, `hx-post`, and other shorthand attributes overwrote an explicit `hx-method`. This contradicted the documented method resolution priority.
- Fix: resolve action and method precedence independently, with `hx-method` first.
- Test: `__determineMethodAndAction.js` "hx-method overrides the shorthand request method". The old code returned `POST`; the fixed code returns `DELETE`.
- Size: applying the fix to `upstream/four-dev` adds 23 B to the minified Brotli output.
- Commit: `a886974c`. Orthogonal.

## 11. History events fired while history was disabled

- Bug: `htmx:before:history:update` and `htmx:after:history:update` fired with `htmx.config.history = false`. The history-cache extension then saved and stamped a page even though no browser history entry changed.
- Fix: return from `runHistoryAction` before dispatching history events when history is disabled.
- Tests: `__runActions.js` "does not run history events when history is disabled" and `hx-history-cache.js` "does not cache a page when history is disabled".
- Commit: uncommitted. Depends on runActions.

## Not bugs, but adjacent cleanups

- `efc5ec47`: `ctx.status` was a hidden listener-mutable flag core read once; replaced by queue admission results.
- `e80b5a9c`: `history:update` event detail dropped its unused `response` field.
- `3da3cbb4`: removed an obsolete boolean `reconnectJitter` conversion in streaming config.
