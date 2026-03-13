# Swap Lifecycle Spec

## Event Sequence

A single request lifecycle uses **one shared `detail` object** that gets progressively enriched:

```
htmx:before:request    detail = { element, request, response: null, swap, error: null }
     ↓ fetch
htmx:before:response   detail = { element, request, response, swap, error: null }
     ↓ read body
htmx:after:request     detail = { element, request, response, swap, error: null }
     ↓ process headers, status codes
htmx:before:swap (×N)  separate detail per swap (see below)
htmx:after:swap  (×N)  same detail as its before:swap
     ↓ all swaps done
htmx:after:response    detail = { element, request, response, swap, swaps, error: null }
     ↓
htmx:finally           detail = { element, request, response, swap, swaps, error }
```

## Detail Shape

The shared detail starts as:

```js
{
    element: Element,          // the element that triggered the request
    request: {                 // mutable — extensions can modify before fetch
        action: String,        // URL
        method: String,
        headers: Object,
        body: FormData|null,
        execute: async Function,  // replaceable: performs the fetch
        ...                    // all fetch() init options
    },
    response: null,            // populated after fetch resolves
    swap: {                    // initial swap config from attributes
        style: String,         // hx-swap value
        target: String,        // hx-target value
        select: String|null,   // hx-select value
        selectOOB: String|null // hx-select-oob value
    },
    error: null                // populated if an error occurs
}
```

After fetch resolves, `detail.response` becomes:

```js
{
    raw: Response,             // the raw fetch Response
    status: Number,
    ok: Boolean,
    url: String,
    headers: Headers,
    execute: async Function,   // replaceable: reads the response body
    text: String               // populated after execute() runs
}
```

After all swaps complete, `detail.swaps` is added:

```js
{
    swaps: [                   // all swaps that executed (cancelled ones excluded)
        { type, target, style, fragment, execute },
        ...
    ]
}
```

## Per-Swap Events

Each individual swap (OOB, partial, main) fires its own pair of events:

```
htmx:before:swap  →  execute()  →  htmx:after:swap
```

The per-swap detail is a **separate object** from the shared request detail:

```js
{
    element: Element,          // sourceElement (the element that made the request)
    swap: {
        type: 'oob' | 'partial' | 'main',
        target: Element | String,  // resolved Element for main, CSS selector for OOB
        style: String,             // swap style (innerHTML, outerHTML, etc.)
        fragment: DocumentFragment,
        execute: async Function    // replaceable: performs the DOM insertion
    }
}
```

### Key behaviors

- **Per-swap lifecycle**: `htmx:before:swap` fires once per swap, not once for all.
  With 2 OOBs + 1 main, you get 3 `htmx:before:swap` events.

- **Independent cancellation**: `preventDefault()` on one swap's `htmx:before:swap`
  cancels only that swap. Other swaps proceed normally.

- **Replaceable execute()**: Extensions can replace `detail.swap.execute` in
  `htmx:before:swap` to intercept DOM insertion.

- **All events fire on sourceElement**: OOB and partial swap events bubble from
  the element that initiated the request, not from the OOB target.

- **Concurrent execution**: All swap executors run via `Promise.all`. Settle
  delays overlap rather than serialize.

## Batch View: `htmx:after:response`

After all swaps complete, `htmx:after:response` fires on the source element with
the shared detail object. `detail.swaps` contains all swap descriptors that
actually executed (cancelled swaps are excluded).

This provides the batch view that `tasks` previously offered, at the response
level where it belongs.

## Changes from upstream/four

| Aspect | upstream/four | This branch |
|--------|--------------|-------------|
| `htmx:before:swap` count | 1 (for all swaps) | N (one per swap) |
| `htmx:after:swap` count | 1 (after Promise.all) | N (one per swap) |
| Cancel scope | All or nothing | Per-swap |
| Detail shape | `{ctx, tasks: [...]}` | `{element, swap: {...}}` |
| Swap differentiation | `task.type` | `swap.type` |
| Swap interception | Not possible | `swap.execute()` replaceable |
| Batch view | `tasks` array on before:swap | `swaps` array on after:response |
| View transitions on OOBs | Never (bug) | Inherited from ctx.transition |
| `htmx:after:response` | Does not exist | Fires after all swaps |

All changes are additive — no previously possible behavior is lost.
The `tasks` primitive is replaced by the more powerful per-swap lifecycle +
response-level batch view.
