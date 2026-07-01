---
title: "hx-multipart"
description: "Parse and handle multipart htmx responses"
category: "Streaming"
icon: "icon-[mdi--file-tree-outline]"
keywords: ["multipart", "streaming", "mixed", "parallel", "Response.parts"]
---

The `hx-multipart` extension lets servers send a single htmx response as multiple htmx swaps using `multipart/mixed` or `multipart/parallel`.

The extension includes a `Response.prototype.parts()` parser and handles each part from extension code. Part headers such as `HX-Retarget`, `HX-Reswap`, `HX-Reselect`, and `HX-Trigger` are applied before swapping the part.

## Installing

Load htmx, then the extension:

```html
<script src="https://cdn.jsdelivr.net/npm/htmx.org@next/dist/htmx.min.js"></script>
<script src="https://cdn.jsdelivr.net/npm/htmx.org@next/dist/ext/hx-multipart.js"></script>
```

## Usage

Any htmx request can receive a multipart response:

```html
<button hx-get="/updates">Load updates</button>
<div id="notifications"></div>
<div id="activity"></div>
```

The server can respond with:

```http
HTTP/1.1 200 OK
Content-Type: multipart/mixed; boundary=updates

--updates
Content-Type: text/html
HX-Retarget: #notifications
HX-Reswap: beforeend

<div>New notification</div>
--updates
Content-Type: text/html
HX-Retarget: #activity

<div>New activity</div>
--updates--
```

The extension processes each part as an htmx swap.

## Response Types

### `multipart/mixed`

Parts are handled in order. The extension waits for each part to finish swapping before handling the next part.

### `multipart/parallel`

Parts are started as soon as they are parsed. Use this for independent targets or out-of-band updates.
