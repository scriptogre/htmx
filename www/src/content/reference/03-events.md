---
title: "Events"
description: "Lifecycle hooks for requests, responses, swaps, and errors."
thumbnail: "reference/events.svg"
---

htmx processes an interaction through request, response, and swap phases. Each phase has events around the work it performs.

## Main Path

**Setup**

[`htmx:config:request`](/reference/events/htmx-config-request) → [`htmx:confirm`](/reference/events/htmx-confirm) when configured

**Request**

[`htmx:before:request`](/reference/events/htmx-before-request) → `fetch()` → [`htmx:after:request`](/reference/events/htmx-after-request)

**Response**

Decode [`HX-*` response headers](/reference/headers) into `ctx.swap` and `ctx.actions`

↓

[`htmx:before:response`](/reference/events/htmx-before-response)

↓

Read `response.text()` into `ctx.swap.content`

↓

[`htmx:after:response`](/reference/events/htmx-after-response)

↓

[`htmx:response:error`](/reference/events/htmx-response-error) when status is 400 or higher

**Actions**

Apply [`htmx.config.noSwap`](/reference/config/htmx-config-noSwap) and matching [`hx-status:*`](/reference/attributes/hx-status) rules

↓

Resolve [`pushUrl` priority](/reference/events/htmx-before-actions#priority)

↓

[`htmx:before:actions`](/reference/events/htmx-before-actions)

↓

Run [actions](/reference/events/htmx-before-actions#actions)

↓

[`htmx:after:actions`](/reference/events/htmx-after-actions)

**Swap**

[`htmx:before:swap`](/reference/events/htmx-before-swap) → [`htmx:before:settle`](/reference/events/htmx-before-settle) → update DOM → [`htmx:after:settle`](/reference/events/htmx-after-settle) → [`htmx:after:swap`](/reference/events/htmx-after-swap) → [`htmx:finally:swap`](/reference/events/htmx-finally-swap)

**Completion**

[`htmx:done`](/reference/events/htmx-done)

## Cancellation and Errors

| Event or outcome | Next step |
|---|---|
| Cancel `htmx:config:request` | Stop before the pipeline starts |
| Cancel `htmx:confirm`, `htmx:before:request`, or `htmx:before:response` | Skip to `htmx:done` |
| Cancel `htmx:before:swap` | Skip to `htmx:finally:swap`, then `htmx:done` |
| Exception before swapping | Fire [`htmx:error`](/reference/events/htmx-error), then `htmx:done` |
| Exception while swapping | Fire `htmx:finally:swap`, `htmx:error`, then `htmx:done` |
| `HX-Refresh`, `HX-Redirect`, or `HX-Location` | Skip swapping, then fire `htmx:done` |

Cancelling `after:*`, `finally:*`, `htmx:error`, or `htmx:done` has no effect.
