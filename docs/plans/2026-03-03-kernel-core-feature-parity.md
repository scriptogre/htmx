# Kernel + Core Feature Parity Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Complete the htmx 4.0 kernel+core refactor so that `htmx.kernel.js` + `htmx.core.js` provides full feature parity with the current `htmx.js` alpha, with all ~856 test behaviors covered — tests adapted to the new API surface.

**Architecture:** The microkernel (`htmx.kernel.js`, ~434 lines) provides lifecycle, events, and the extension API. All features are implemented as extensions in `htmx.core.js` using `htmx.register(name, {...})`. Tests are adapted to test the new API directly — no compatibility shim. Two assembly modes (simple concatenation and inline optimization) both produce working builds.

**Tech Stack:** Vanilla JavaScript, web-test-runner + Mocha/Chai for testing, Rust assembler for builds.

**Key Files:**
- `src/htmx.kernel.js` — Microkernel (DONE, do not modify unless absolutely necessary)
- `src/htmx.core.js` — Core extensions (INCOMPLETE, main work area)
- `src/htmx.js` — Current working alpha (REFERENCE ONLY for behavior, do not modify)
- `test/web-test-runner.config.mjs` — Test config (will be updated to load kernel+core)
- `test/lib/helpers.js` — Test helpers (will be updated for new API)
- `test/lib/fetch-mock.js` — Fetch mock (no changes needed)
- `tools/assembler/` — Rust build tool

**Strategy:** Two-track approach executed in tiers:
1. **Track A — Extensions:** Add missing extensions to `src/htmx.core.js` tier by tier
2. **Track B — Tests:** Adapt test files to the new API surface, keeping all behavioral assertions

Each tier: implement extensions → adapt related tests → run tests → commit.

**Key API Differences (alpha → kernel+core):**
- `htmx.process(el)` → `htmx.init(el)`
- `htmx.trigger(el, name, detail)` → `htmx.emit(el, name, detail)`
- `htmx:finally:request` → `htmx:finally`
- `htmx:before:process` / `htmx:after:process` → `htmx:before:walk:init` / `htmx:after:walk:init`
- `htmx.__*` internal methods → gone; test the extension-defined `api.*` functions or test behavior end-to-end
- `htmx.registerExtension` / `htmx.defineExtension` → `htmx.register`
- Old extension API (`init(internalAPI)` + method hooks) → new extension API (`{on, define, wrap, config, requires}`)

**Test Adaptation Principles:**
- Every behavioral assertion from the old tests is preserved
- Unit tests for `htmx.__internals` are rewritten to test the equivalent kernel/extension API
- If an internal was just a thin wrapper (e.g., `__resolveTarget` → `api.find`), the test calls the new API directly
- If an internal had unique logic (e.g., `__parseTriggerSpecs`), the logic is exposed via an extension `define` and the test calls that
- Attribute tests (hx-get, hx-post, etc.) mostly just need helper function updates
- End-to-end tests mostly just need event name updates

---

## Tier 0: Test Infrastructure Setup

### Task 1: Update test runner to load kernel+core

**Files:**
- Modify: `test/web-test-runner.config.mjs`
- Modify: `package.json` (add `test:alpha` script to preserve old test ability)

**Step 1:** Copy current config to `test/web-test-runner.alpha.mjs` (preserves ability to test old htmx.js):
```javascript
// exact copy of current config — loads src/htmx.js
```
Add `"test:alpha": "wtr --config test/web-test-runner.alpha.mjs --playwright --browsers chromium"` to package.json.

**Step 2:** Update `test/web-test-runner.config.mjs` to load kernel+core instead of htmx.js:
```html
<script src="src/htmx.kernel.js"></script>
<script src="src/htmx.core.js"></script>
```
Remove `<script src="src/htmx.js"></script>`.

Note: The meta config tag `<meta name="htmx:config" ...>` should still work once the metaConfig extension is added. For now it will be ignored.

**Step 3:** Run `npm test` to get the initial failure baseline. Record the count.

**Step 4:** Commit: `"Switch test runner to kernel+core, preserve alpha config"`

---

### Task 2: Update test helpers for new API

**Files:**
- Modify: `test/lib/helpers.js`

**Step 1:** Update `helpers.js` to use the new kernel+core API:

```javascript
// createProcessedHTML: htmx.process → htmx.init
function createProcessedHTML(innerHTML) {
    let pg = playground()
    if (pg) {
        pg.innerHTML = innerHTML
        htmx.init(pg)
    }
    return pg.childNodes[0]
}

// forRequest: wait for htmx:finally instead of htmx:finally:request
function forRequest(timeout = 200) {
    return waitForEvent('htmx:finally', timeout)
}

// waitForEvent: use htmx.forEvent if available, else manual
function waitForEvent(eventName, timeout = 200) {
    return new Promise((resolve, reject) => {
        const handler = (evt) => {
            clearTimeout(timeoutId)
            document.removeEventListener(eventName, handler)
            resolve(evt)
        }
        const timeoutId = timeout > 0 ? setTimeout(() => {
            document.removeEventListener(eventName, handler)
            reject(new Error(`Timeout waiting for ${eventName}`))
        }, testDebugging ? 0 : timeout) : null
        document.addEventListener(eventName, handler)
    })
}

// playground: use document.querySelector directly (htmx.find may not exist yet as public API)
function playground() {
    return document.querySelector('#test-playground')
}

// find: querySelector scoped to playground
function find(selector) {
    return playground()?.querySelector(selector)
}
```

**Step 2:** Run `npm test` — fewer failures expected now that helpers match the API.

**Step 3:** Commit: `"Update test helpers for kernel+core API"`

---

### Task 3: Add minimal public API surface via publicApi extension

**Files:**
- Modify: `src/htmx.core.js` (expand `publicApi` extension)

The kernel exposes `htmx.init`, `htmx.emit`, `htmx.on`, `htmx.attr`, `htmx.find`, `htmx.config`, `htmx.register`, `htmx.state`. Tests also need:

- `htmx.findAll(selector)` / `htmx.findAll(root, selector)`
- `htmx.process(el)` — alias for `htmx.init(el)`
- `htmx.trigger(el, name, detail)` — alias for `htmx.emit(el, name, detail)`
- `htmx.forEvent(name, timeout, target)` — promise-based event waiting
- `htmx.timeout(ms)` — promise-based delay
- `htmx.parseInterval(str)` — duration string parser
- `htmx.onLoad(callback)` — after-init callback
- `htmx.takeClass(el, className, container)` — class toggle utility

Update the `publicApi` extension in core.js to expose all of these on the `htmx` object at boot:

```javascript
const publicApi = {
    requires: ['swaps', 'ajax'],
    on: {
        'htmx:boot': (detail, api) => {
            // Aliases
            htmx.process = htmx.init
            htmx.trigger = htmx.emit

            // findAll
            htmx.findAll = (selectorOrRoot, selector) => {
                if (selector === undefined) return [...document.querySelectorAll(selectorOrRoot)]
                const root = typeof selectorOrRoot === 'string'
                    ? document.querySelector(selectorOrRoot) : selectorOrRoot
                return root ? [...root.querySelectorAll(selector)] : []
            }

            // forEvent
            htmx.forEvent = (event, timeout = 200, target = document) => {
                return new Promise((resolve, reject) => {
                    const handler = (evt) => {
                        clearTimeout(timeoutId)
                        target.removeEventListener(event, handler)
                        resolve(evt)
                    }
                    const timeoutId = timeout > 0 ? setTimeout(() => {
                        target.removeEventListener(event, handler)
                        reject(new Error(`Timeout waiting for ${event}`))
                    }, timeout) : null
                    target.addEventListener(event, handler)
                })
            }

            // timeout
            htmx.timeout = (ms) => new Promise(r => setTimeout(r, ms))

            // parseInterval
            htmx.parseInterval = (str) => {
                if (typeof str === 'number') return str
                if (!str) return undefined
                const m = str.match(/^(\d+)(ms|s|m)?$/)
                if (!m) return undefined
                const [, n, unit] = m
                return unit === 's' ? n * 1000 : unit === 'm' ? n * 60000 : +n
            }

            // onLoad
            htmx.onLoad = (callback) => {
                document.addEventListener('htmx:after:walk:init', (evt) => callback(evt.detail.element))
            }

            // takeClass
            htmx.takeClass = (el, className, container = el.parentElement) => {
                for (const elt of container.querySelectorAll('.' + className)) elt.classList.remove(className)
                el.classList.add(className)
            }

            // swap/ajax/parse (existing)
            htmx.swap = (options) => { ... }  // keep existing
            htmx.ajax = (options) => { ... }  // keep existing
            htmx.parse = (text, options) => api.parse(text, options)

            // defineExtension — old-style extension adapter
            htmx.defineExtension = (name, ext) => htmx.register(name, ext)
        }
    }
}
```

**Step 1:** Implement. **Step 2:** Run `npm test`. **Step 3:** Commit: `"Expand publicApi extension with full public surface"`

---

## Tier 1: HTTP Verbs & Form Data (Critical Path)

### Task 4: Uncomment and enable HTTP verb + trigger extensions

**Files:**
- Modify: `src/htmx.core.js` (uncomment install lines)

**Step 1:** Uncomment these install calls:
```javascript
htmx.register('hx-trigger', hxTrigger)
htmx.register('hx-post', hxPost)
htmx.register('hx-put', hxPut)
htmx.register('hx-patch', hxPatch)
htmx.register('hx-delete', hxDelete)
```

**Step 2:** Run `npm test -- --files test/tests/attributes/hx-post.js` to verify.

**Step 3:** Commit: `"Enable HTTP verb extensions: POST, PUT, PATCH, DELETE, trigger"`

---

### Task 5: Implement form data collection extension

**Files:**
- Modify: `src/htmx.core.js` (add `formData` extension)

Reference: `htmx.js` lines 1670-1720.

This extension hooks `htmx:before:trigger` and `htmx:before:request` to:
1. Collect FormData from the source element's form (or the element itself if it's a form)
2. Include element's own name/value if not in a form
3. Handle `hx-include` to pull in fields from other selectors
4. Handle `hx-encoding` for multipart
5. For GET requests: append form data to URL as query parameters
6. For non-GET: set `detail.request.body` to FormData
7. Handle submitter button value

Key behaviors to preserve (from `htmx.js`):
- Forms with hx-get collect their own fields as query params
- Anchors (#hash) are stripped from URL before query params, then re-appended
- Relative URLs stay relative
- Checkboxes/radios only included when checked
- File inputs included as-is
- Multi-select options included individually

**Step 1:** Implement with all edge cases. **Step 2:** Install after `default-headers`, before verb extensions. **Step 3:** Run GET form tests: `npm test -- --files test/tests/attributes/hx-get.js`. **Step 4:** Run POST tests: `npm test -- --files test/tests/attributes/hx-post.js`. **Step 5:** Commit: `"Add form data collection extension"`

---

### Task 6: Adapt hx-get tests

**Files:**
- Modify: `test/tests/attributes/hx-get.js`

Review each test case. The behavioral assertions (URL checking, content swapping) should stay the same. Changes needed:
- If `forRequest()` doesn't resolve, check event name
- If `createProcessedHTML` doesn't trigger behavior, check if init pipeline runs

**Step 1:** Run tests, examine failures. **Step 2:** Fix test-side issues. **Step 3:** Commit: `"Adapt hx-get tests for kernel+core API"`

---

### Task 7: Adapt hx-post/put/patch/delete tests

**Files:**
- Modify: `test/tests/attributes/hx-post.js`
- Modify: `test/tests/attributes/hx-put.js`
- Modify: `test/tests/attributes/hx-patch.js`
- Modify: `test/tests/attributes/hx-delete.js`

Same approach as Task 6.

**Step 1:** Run each, fix failures. **Step 2:** Commit: `"Adapt HTTP verb tests for kernel+core API"`

---

### Task 8: Implement hx-vals and hx-headers extensions

**Files:**
- Modify: `src/htmx.core.js` (add `hxVals` and `hxHeaders` extensions)

**hx-vals:** Hook `htmx:before:request` to parse JSON from `hx-vals` attribute and merge into request body/URL.

**hx-headers:** Hook `htmx:before:request` to parse JSON from `hx-headers` attribute and merge into request headers.

Reference: `htmx.js` lines 1724-1748 (hx-vals), 375-378 (hx-headers).

**Step 1:** Implement both. **Step 2:** Adapt and run: `test/tests/attributes/hx-vals.js`. **Step 3:** Adapt and run: `test/tests/attributes/hx-headers.js`. **Step 4:** Commit: `"Add hx-vals and hx-headers extensions, adapt tests"`

---

## Tier 2: Response Processing & Flow Control

### Task 9: Implement response header processing extension

**Files:**
- Modify: `src/htmx.core.js` (add `responseHeaders` extension)

Reference: `htmx.js` lines 548-584.

Hooks `htmx:after:request` to process HX-* response headers:
- `HX-Trigger` → fire events on source element (string or JSON)
- `HX-Redirect` → `location.href = value`
- `HX-Refresh` → `location.reload()`
- `HX-Location` → ajax navigation (string path or JSON `{path, target, swap}`)
- `HX-Retarget` → change `detail.swap.target`
- `HX-Reswap` → change `detail.swap.style`
- `HX-Reselect` → change `detail.swap.select`
- `HX-Push-Url` / `HX-Replace-Url` → history update

**Step 1:** Implement. **Step 2:** Adapt and run relevant unit tests. **Step 3:** Commit: `"Add response header processing extension"`

---

### Task 10: Implement noSwap status codes and hx-status extensions

**Files:**
- Modify: `src/htmx.core.js`

**noSwap:** config `noSwap: [204, 304]`, hooks `htmx:before:response` to set `swap.style = 'none'` for those status codes.

**hx-status:** Hooks `htmx:before:response` to check `hx-status:NNN` and `hx-status:Nxx` attributes and apply swap overrides.

**Step 1:** Implement both. **Step 2:** Adapt and run: `test/tests/unit/__handleStatusCodes.js` → rewrite as `test/tests/unit/status-codes.js`. **Step 3:** Adapt and run: `test/tests/attributes/hx-status.js`. **Step 4:** Commit: `"Add status code handling extensions, adapt tests"`

---

## Tier 3: Swap Enhancements

### Task 11: Implement fragment parsing extension

**Files:**
- Modify: `src/htmx.core.js` (add `fragmentParsing` extension)

Reference: `htmx.js` lines 997-1027.

Defines `api.makeFragment(text)` → `{fragment, title}`. Handles:
- Title extraction from `<title>` tags
- Body tag detection (extract body content)
- Template partial detection

**Step 1:** Implement as `define: { makeFragment: ... }`. **Step 2:** Wire into ajax swap pipeline (response text → makeFragment → swap). **Step 3:** Adapt bootstrap.js fragment tests to call `htmx.parse` or the new `makeFragment` API. **Step 4:** Commit: `"Add fragment parsing extension"`

---

### Task 12: Implement hx-select extension

**Files:**
- Modify: `src/htmx.core.js`

Hooks `htmx:before:swap` to filter response content by CSS selector from `hx-select` attribute.

**Step 1:** Implement. **Step 2:** Adapt and run: `test/tests/attributes/hx-select.js`. **Step 3:** Commit: `"Add hx-select extension, adapt tests"`

---

### Task 13: Implement OOB swap extensions

**Files:**
- Modify: `src/htmx.core.js` (add `oobSwap` extension)

Reference: `htmx.js` lines 1027-1066.

Hooks `htmx:before:swap` to:
1. Extract elements with `hx-swap-oob` from the response fragment
2. Swap each OOB element into its target independently using `api.swap`
3. Handle `hx-select-oob` attribute to select elements from response for OOB

**Step 1:** Implement. **Step 2:** Adapt and run: `test/tests/attributes/hx-swap-oob.js`. **Step 3:** Adapt and run: `test/tests/attributes/hx-select-oob.js`. **Step 4:** Adapt and run: `test/tests/end2end/oob.js`. **Step 5:** Commit: `"Add OOB swap extensions, adapt tests"`

---

### Task 14: Implement script processing extension

**Files:**
- Modify: `src/htmx.core.js`

Hooks `htmx:after:swap` to replace `<script>` tags in swapped content with fresh copies (to trigger execution). Handles `config.inlineScriptNonce`.

**Step 1:** Implement. **Step 2:** Commit: `"Add script processing extension"`

---

### Task 15: Implement swap modifiers (scroll, settle, show, transition)

**Files:**
- Modify: `src/htmx.core.js`

Reference: `htmx.js` lines 1074-1148, 1194-1208.

Processes hx-swap modifiers: `swap:Nms`, `settle:Nms`, `scroll:top|bottom`, `show:top|bottom`, `scrollTarget:selector`, `showTarget:selector`, `transition:true|false`, `focusScroll`, `ignoreTitle`, `strip`.

**Step 1:** Implement. **Step 2:** Adapt and run: `test/tests/attributes/hx-swap.js`. **Step 3:** Commit: `"Add swap modifier extension, adapt tests"`

---

## Tier 4: Element Behavior Extensions

### Task 16: Implement hx-confirm extension

**Files:**
- Modify: `src/htmx.core.js`

Hooks `htmx:before:trigger`, calls `window.confirm()` with attribute value.

**Step 1:** Implement. **Step 2:** Adapt and run: `test/tests/attributes/hx-confirm.js`. **Step 3:** Commit: `"Add hx-confirm extension, adapt tests"`

---

### Task 17: Implement hx-indicator extension

**Files:**
- Modify: `src/htmx.core.js`

Reference: `htmx.js` lines 1616-1641.

Manages loading indicator visibility via CSS classes, with reference counting for nested requests. Injects indicator CSS at boot.

**Step 1:** Implement. **Step 2:** Adapt and run: `test/tests/attributes/hx-indicator.js`. **Step 3:** Commit: `"Add hx-indicator extension, adapt tests"`

---

### Task 18: Implement hx-disable extension

**Files:**
- Modify: `src/htmx.core.js`

Reference: `htmx.js` lines 1644-1665.

Disables elements during request via `disabled` attribute, with reference counting.

**Step 1:** Implement. **Step 2:** Adapt and run: `test/tests/attributes/hx-disable.js`. **Step 3:** Commit: `"Add hx-disable extension, adapt tests"`

---

### Task 19: Implement hx-on:* inline handler extension

**Files:**
- Modify: `src/htmx.core.js`

Reference: `htmx.js` lines 1599-1613.

Hooks `htmx:before:init` to scan for `hx-on:eventName` attributes and wire up JS execution handlers.

**Step 1:** Implement. **Step 2:** Adapt and run: `test/tests/attributes/hx-on.js`. **Step 3:** Commit: `"Add hx-on inline handler extension, adapt tests"`

---

### Task 20: Implement hx-preserve and hx-ignore extensions

**Files:**
- Modify: `src/htmx.core.js`

**hx-preserve:** Hooks `htmx:before:swap` to save preserved elements, hooks `htmx:after:swap` to restore them.

**hx-ignore:** Hooks `htmx:before:init` to cancel init for elements inside `[hx-ignore]` containers.

**Step 1:** Implement both. **Step 2:** Adapt and run: `test/tests/attributes/hx-preserve.js`. **Step 3:** Commit: `"Add hx-preserve and hx-ignore extensions, adapt tests"`

---

## Tier 5: Request Queue & Sync

### Task 21: Implement request queue and hx-sync extension

**Files:**
- Modify: `src/htmx.core.js`

Reference: `htmx.js` lines 4-57 (ReqQ class), 597-612.

Implements per-element request queuing with strategies: `abort`, `replace`, `queue all`, `queue last`, `drop`. The `hx-sync` attribute specifies `selector:strategy`.

**Step 1:** Implement. **Step 2:** Adapt and run: `test/tests/end2end/cancel-behavior.js`. **Step 3:** Commit: `"Add request queue and hx-sync extension, adapt tests"`

---

## Tier 6: Boosting

### Task 22: Enable and refine hx-boost extension

**Files:**
- Modify: `src/htmx.core.js` (uncomment, refine)

The extension exists but is commented out. Needs:
- Default event cancellation for boosted links/forms
- `HX-Boosted: true` header
- Form data collection integration for boosted forms
- Same-origin check

**Step 1:** Uncomment and refine. **Step 2:** Adapt and run: `test/tests/attributes/hx-boost.js`. **Step 3:** Commit: `"Enable hx-boost extension, adapt tests"`

---

## Tier 7: History Management

### Task 23: Implement history extension

**Files:**
- Modify: `src/htmx.core.js`

Reference: `htmx.js` lines 1524-1598.

Handles:
- `hx-push-url` and `hx-replace-url` attributes
- `HX-Push-Url` and `HX-Replace-Url` response headers
- `popstate` event listener for back/forward
- History restore via re-fetch or reload
- Boosted link push-url default behavior

**Step 1:** Implement. **Step 2:** Adapt and run: `test/tests/end2end/basic-history.js`. **Step 3:** Commit: `"Add history management extension, adapt tests"`

---

## Tier 8: Morphing

### Task 24: Implement morphing extension

**Files:**
- Modify: `src/htmx.core.js`

Reference: `htmx.js` lines 1795-1949.

This is the largest single feature (~150 lines of algorithm). Adds `innerMorph` and `outerMorph` swap styles. The morph algorithm:
1. Matches elements by ID, then soft-match (tag + class + attributes)
2. Updates attributes, text, children in-place
3. Preserves focus/selection state
4. Fires `htmx:before:morph:node` hooks
5. Respects `config.morphIgnore`, `config.morphSkip`, `config.morphSkipChildren`, `config.morphScanLimit`

**Step 1:** Port morph algorithm. **Step 2:** Register `innerMorph`/`outerMorph` as swap styles (hook `htmx:before:swap` to intercept these styles). **Step 3:** Adapt and run: `test/tests/unit/morph.js`. **Step 4:** Commit: `"Add morphing extension, adapt tests"`

---

## Tier 9: Configuration & Meta

### Task 25: Implement htmx-config meta tag extension

**Files:**
- Modify: `src/htmx.core.js`

**IMPORTANT:** This must be installed FIRST (before other extensions read config) or hooked into `htmx:boot` with high priority.

Reads `<meta name="htmx-config">` or `<meta name="htmx:config">` and merges JSON into `htmx.config`.

**Step 1:** Implement. **Step 2:** Adapt and run: `test/tests/attributes/hx-config.js`. **Step 3:** Commit: `"Add htmx-config meta tag extension, adapt tests"`

---

### Task 26: Implement prefix, metaCharacter, and ETag extensions

**Files:**
- Modify: `src/htmx.core.js`

**prefix:** Wraps `api.attr` to support `config.prefix` (e.g., `data-hx-*` instead of `hx-*`).

**metaCharacter:** Wraps attribute name resolution to replace `:` with custom character.

**ETag:** Hooks `htmx:after:request` to store ETag from response, hooks `htmx:before:request` to send `If-None-Match`.

**Step 1:** Implement all three. **Step 2:** Adapt and run: `test/tests/unit/htmx.config.prefix.js`, `test/tests/unit/htmx.config.metaCharacter.js`, `test/tests/unit/_htmx.etag.js`. **Step 3:** Commit: `"Add prefix, metaCharacter, and ETag extensions, adapt tests"`

---

## Tier 10: Rewrite Unit Tests for New API

### Task 27: Rewrite internal-API unit tests

**Files:**
- Modify/rewrite all `test/tests/unit/__*.js` files (33 files)

These tests currently call `htmx.__methodName(...)` which won't exist in kernel+core. For each test file:

**Strategy per file:**

| Old test file | New approach |
|---|---|
| `__attributeValue.js` | Test `htmx.attr(el, name)` with inheritance extension active |
| `__collectFormData.js` | Test form data behavior end-to-end (submit form, check request body) |
| `__disableEnableElements.js` | Test via hx-disable attribute behavior |
| `__extractFilter.js` | Test trigger filter behavior end-to-end |
| `__extractHxHeaders.js` | Test via mocked responses with HX-* headers |
| `__findAllExt.js` | Test `htmx.find(selector, {from, multiple})` with extended selectors |
| `__getRequestQueue.js` | Test queue behavior via hx-sync attribute |
| `__handleHistoryUpdate.js` | Test via hx-push-url/hx-replace-url behavior |
| `__handleHxHeadersAndMaybeReturnEarly.js` | Test via mocked HX-Redirect/HX-Refresh responses |
| `__handleHxVals.js` | Test via hx-vals attribute |
| `__handleStatusCodes.js` | Test via mocked 204/304 responses + hx-status attribute |
| `__handleTriggerEvent.js` | Test trigger behavior end-to-end |
| `__handleTriggerHeader.js` | Test via mocked HX-Trigger response header |
| `__initializeTriggers.js` | Test via hx-trigger attribute behavior |
| `__issueRequest.js` | Test via hx-get/hx-post end-to-end |
| `__makeFragment.js` | Test `api.makeFragment` (exposed via extension define) |
| `__normalizeSwapStyle.js` | Test swap alias resolution via hx-swap attribute |
| `__parseConfig.js` | Test `htmx.parse` (from parser extension) |
| `__parseSwapSpec.js` | Test `htmx.parse` with swap-style inputs |
| `__parseTriggerSpecs.js` | Expose trigger parser via define, or test end-to-end |
| `__queryEltAndDescendants.js` | Test `htmx.findAll` |
| `__resolveTarget.js` | Test `htmx.find` with extended selectors |
| `__shouldBoost.js` | Test boost behavior end-to-end |
| `__shouldCancel.js` | Test event cancellation behavior |
| `__showHideIndicators.js` | Test via hx-indicator attribute |
| `__trigger.js` | Test `htmx.emit` |

For some of these, it makes sense to **expose the function via an extension `define`** so it can be tested directly. For example, `parseTriggerSpecs` is complex enough to warrant direct testing. Add it to the parser or hx-trigger extension:

```javascript
define: {
    parseTriggerSpecs: (api) => function parseTriggerSpecs(spec) { ... }
}
```

Then the test becomes `htmx.parseTriggerSpecs(spec)` (exposed via publicApi).

For others (like `__shouldCancel`, `__shouldBoost`), behavior-level testing is better — test that clicking a link inside `[hx-boost]` cancels navigation, etc.

**Step 1:** Work through each file, rewriting to test the new API or behavior. **Step 2:** Run: `npm test -- --files 'test/tests/unit/**/*.js'`. **Step 3:** Commit per batch: `"Rewrite unit tests for kernel+core API (batch N)"`

---

### Task 28: Rewrite bootstrap.js

**Files:**
- Modify: `test/tests/unit/bootstrap.js`

**Key changes:**
- `__makeFragment` tests → call exposed `makeFragment` API or test fragment behavior
- `__attributeValue` tests → call `htmx.attr` with inheritance
- `__parseTriggerSpecs` tests → call exposed `parseTriggerSpecs` API
- **Public API surface test** → update expected methods list:
  ```javascript
  const expectedPublicMethods = [
      'ajax', 'attr', 'defineExtension', 'emit', 'find', 'findAll',
      'forEvent', 'init', 'register', 'on', 'onLoad', 'parse',
      'parseInterval', 'process', 'swap', 'takeClass', 'timeout', 'trigger',
  ].sort()
  ```

**Step 1:** Rewrite. **Step 2:** Run: `npm test -- --files test/tests/unit/bootstrap.js`. **Step 3:** Commit: `"Rewrite bootstrap tests for kernel+core API"`

---

### Task 29: Adapt remaining non-unit tests

**Files:**
- Modify: `test/tests/end2end/*.js` (8 files)
- Modify: Any attribute test files not yet adapted

Most changes will be:
- Event name updates (`htmx:finally:request` → `htmx:finally`)
- `htmx.process` → `htmx.init` (if called directly in tests)
- `htmx.__trigger` → `htmx.emit`

**Step 1:** Run full suite, categorize remaining failures. **Step 2:** Fix in batches. **Step 3:** Commit per batch.

---

## Tier 11: End-to-End Integration

### Task 30: Full test suite green

**Files:**
- Modify: whatever's still failing

**Step 1:** Run `npm test` — full suite.
**Step 2:** For each remaining failure, determine if it's:
  - Missing extension → implement in core.js
  - API surface mismatch → fix test or add to publicApi
  - Timing issue → adjust test or extension
  - Behavioral difference → decide which behavior is correct for 4.0
**Step 3:** Iterate until 0 failures.
**Step 4:** Commit: `"All tests pass against kernel+core"`

---

## Tier 12: Assembly Verification

### Task 31: Verify simple assembly mode

**Step 1:** Build:
```bash
cargo run --manifest-path tools/assembler/Cargo.toml -- build -i src/htmx.kernel.js -i src/htmx.core.js -o dist/htmx.assembled.js
```
**Step 2:** Create `test/web-test-runner.assembled.mjs` that loads `dist/htmx.assembled.js` instead of kernel+core separately.
**Step 3:** Run tests against assembled build.
**Step 4:** Commit: `"Verify simple assembly passes all tests"`

---

### Task 32: Verify inline assembly mode

**Step 1:** Build with `--inline`:
```bash
cargo run --manifest-path tools/assembler/Cargo.toml -- build -i src/htmx.kernel.js -i src/htmx.core.js -o dist/htmx.optimized.js --inline
```
**Step 2:** Verify all new extensions comply with the define factory contract (assembler validates this).
**Step 3:** Run tests against inline build.
**Step 4:** Fix any inline-specific issues.
**Step 5:** Commit: `"Verify inline assembly passes all tests"`

---

### Task 33: Update CDN worker

**Step 1:** Update `tools/cdn-worker/build-sources.js` for new extensions.
**Step 2:** Rebuild: `node tools/cdn-worker/build-sources.js`.
**Step 3:** Commit: `"Update CDN worker sources"`

---

## Tier 13: External Extensions & Polish

### Task 34: Port external extensions to new API

**Files:**
- Modify: `src/ext/hx-optimistic.js`
- Modify: `src/ext/hx-preload.js`
- Check: `src/ext/hx-ws.js`

Old extension API (`registerExtension` + `init(internalAPI)` + method hooks) → new `htmx.register(name, {on, define, wrap, config})`.

**Step 1:** Port each extension. **Step 2:** Adapt and run: `test/tests/ext/*.js`. **Step 3:** Commit: `"Port external extensions to kernel API"`

---

### Task 35: Final verification — all three builds

**Step 1:** Run all tests: kernel+core (concatenated) — `npm test`
**Step 2:** Run all tests: simple assembly — `npm run test:assembled`
**Step 3:** Run all tests: inline assembly — `npm run test:inline`
**Step 4:** All three should report 0 failures.
**Step 5:** Commit: `"All builds verified: kernel+core, simple assembly, inline assembly"`

---

## Extension Installation Order

The final order in `src/htmx.core.js` must be:
1. **metaConfig** — reads `<meta>` config (must run first so other extensions see correct config)
2. **parser** — no deps, used by many
3. **fragmentParsing** — no deps, used by swaps/ajax
4. **swaps** — no deps
5. **extended-selectors** — wraps find
6. **inheritance** — wraps attr
7. **delay-events** — wraps on
8. **throttle-events** — wraps on
9. **ajax** — requires: swaps
10. **form-data** — requires: ajax
11. **response-headers** — requires: ajax
12. **no-swap** — requires: ajax
13. **request-timeout** — requires: ajax
14. **request-queue** — requires: ajax
15. **default-trigger** — no deps
16. **default-swap** — requires: swaps
17. **default-headers** — requires: ajax
18. **hx-trigger** — requires: parser
19. **hx-get, hx-post, hx-put, hx-patch, hx-delete** — require: ajax
20. **hx-swap** — requires: swaps, parser
21. **hx-target** — requires: swaps
22. **hx-select** — requires: swaps
23. **hx-select-oob, hx-swap-oob** — require: swaps
24. **hx-vals** — no deps
25. **hx-headers** — no deps
26. **hx-confirm** — no deps
27. **hx-indicator** — no deps
28. **hx-disable** — no deps
29. **hx-on** — no deps
30. **hx-ignore** — no deps
31. **hx-preserve** — requires: swaps
32. **hx-status** — no deps
33. **hx-boost** — requires: ajax
34. **history** — requires: ajax
35. **morph** — requires: swaps
36. **script-processing** — no deps
37. **etag** — requires: ajax
38. **swap-aliases** — requires: swaps
39. **public-api** — requires: swaps, ajax

## Define Factory Contract (for --inline assembly)

All `define` entries MUST follow:
```javascript
define: {
    fnName: (api) => function fnName(...args) { ... }
}
```
- Factory: arrow function, 0 or 1 param (must be `api` if 1)
- Returns: **named** function expression
- Name must match key

## What NOT to Change
- `src/htmx.kernel.js` — stable, do not modify
- `src/htmx.js` — reference only, do not modify
- `test/lib/fetch-mock.js` — shared infrastructure, do not modify
