---
title: "Requests & Responses"
description: "How htmx sends requests and updates the page"
---

# Requests & Responses

<details class="warning">
<summary>Changes in htmx 4.0</summary>

htmx 4.0 uses the [`fetch()`](https://developer.mozilla.org/en-US/docs/Web/API/Fetch_API) API instead of [`XMLHttpRequest`](https://developer.mozilla.org/en-US/docs/Web/API/XMLHttpRequest).

This enables [streaming support](/docs/streaming/server-sent-events) and simplifies internal implementation, but also introduces some breaking changes.

</details>

## Basic Request

Add `hx-get` to an element. It makes an AJAX request when clicked.

**Your HTML:**
```html
<button hx-get="/messages">
    Load Messages
</button>
```

**What the server returns:**
```html
<div>You have 3 new messages</div>
```

**What the user sees:**
```html
<button hx-get="/messages">
    <div>You have 3 new messages</div>
</button>
```

The response replaced the button's content. No JavaScript required.

## How It Works

| Step                  | What Happens                     |
|-----------------------|----------------------------------|
| 1. User clicks button | htmx intercepts the click        |
| 2. htmx makes request | Sends GET request to `/messages` |
| 3. Server responds    | Returns HTML (not JSON)          |
| 4. htmx updates page  | Swaps HTML into the button       |

## Different from SPAs

Most JavaScript frameworks use JSON APIs:

**React/Vue pattern:**
```javascript
fetch('/api/messages')
  .then(r => r.json())           // Get JSON
  .then(data => updateDOM(data))  // Build HTML in JavaScript
```

**htmx pattern:**
```html
<button hx-get="/messages">Load</button>
<!-- Server sends HTML directly -->
```

The server sends the final HTML. No client-side templating needed.

## HTTP Methods

Use different attributes for different operations:

```html
<button hx-get="/users">Load Users</button>
<button hx-post="/users">Create User</button>
<button hx-put="/users/1">Update User</button>
<button hx-patch="/users/1">Patch User</button>
<button hx-delete="/users/1">Delete User</button>
```

Each attribute combines the URL and HTTP method.

## Common Patterns

### Load data on click

```html
<button hx-get="/profile">View Profile</button>
```

### Submit a form

```html
<form hx-post="/contact">
    <input name="email" type="email">
    <button type="submit">Send</button>
</form>
```

Form submits via AJAX instead of full page reload.

### Delete an item

```html
<button hx-delete="/items/5">Delete Item</button>
```

### Update in place

```html
<div hx-get="/status">
    Loading...
</div>
```

Loads immediately when the page loads (see [Triggers](/docs/core-concepts/triggers) for details).

## What Gets Sent

htmx sends standard HTTP requests:

**Request to server:**
```
GET /messages HTTP/1.1
HX-Request: true
HX-Target: button
```

htmx adds custom headers so your server knows it's an htmx request.

**Server response:**
```html
HTTP/1.1 200 OK
Content-Type: text/html

<div>You have 3 new messages</div>
```

Just HTML. No JSON parsing needed.
