---
title: "Advanced Features"
---

### Synchronization {#synchronization}

Often you want to coordinate the requests between two elements.  For example, you may want a request from one element
to supersede the request of another element, or to wait until the other element's request has finished.

htmx offers a [`hx-sync`](/reference/attributes/hx-sync) attribute to help you accomplish this.

Consider a race condition between a form submission and an individual input's validation request in this HTML:

```html
<form hx-post="/store">
    <input id="title" name="title" type="text"
        hx-post="/validate"
        hx-trigger="change">
    <button type="submit">Submit</button>
</form>
```

Without using `hx-sync`, filling out the input and immediately submitting the form triggers two parallel requests to
`/validate` and `/store`.

Using `hx-sync="closest form"` on the input and `hx-sync="this:replace"` on the form will watch for requests from the form
and abort an input's in flight request:

```html
<form hx-post="/store" hx-sync="this:replace">
    <input id="title" name="title" type="text"
        hx-post="/validate"
        hx-trigger="change"
        hx-sync="closest form">
    <button type="submit">Submit</button>
</form>
```

This resolves the synchronization between the two elements in a declarative way.

htmx also supports a programmatic way to cancel requests: you can send the `htmx:abort` event to an element to
cancel any in-flight requests:

```html
<button id="request-button" hx-post="/example">
    Issue Request
</button>
<button onclick="htmx.trigger('#request-button', 'htmx:abort')">
    Cancel Request
</button>
```

More examples and details can be found on the [`hx-sync` attribute page.](/reference/attributes/hx-sync)

### Parameters

By default, an element that causes a request will include its `value` if it has one.  If the element is a form it
will include the values of all inputs within it.

As with HTML forms, the `name` attribute of the input is used as the parameter name in the request that htmx sends.

Additionally, if the element causes a non-`GET` request, the values of all the inputs of the associated form will be
included (typically this is the nearest enclosing form, but could be different if e.g. `<button form="associated-form">` is used).

If you wish to include the values of other elements, you can use the [hx-include](/reference/attributes/hx-include) attribute
with a CSS selector of all the elements whose values you want to include in the request.

Finally, if you want to programmatically modify the parameters, you can use the [htmx:config:request](/events.md#)
event.

#### File Upload {#files}

If you wish to upload files via an htmx request, you can set the [hx-encoding](/reference/attributes/hx-encoding) attribute to
`multipart/form-data`.  This will use a `FormData` object to submit the request, which will properly include the file
in the request.

Note that depending on your server-side technology, you may have to handle requests with this type of body content very
differently.

### Confirming Requests {#confirming}

Often you will want to confirm an action before issuing a request.  htmx supports the [`hx-confirm`](/reference/attributes/hx-confirm)
attribute, which allows you to confirm an action using a simple javascript dialog:

```html
<button hx-delete="/account" hx-confirm="Are you sure you wish to delete your account?">
    Delete My Account
</button>
```

`hx-confirm` may also contain JavaScript by using the `js:` or `javascript:` prefix.  In this case
the JavaScript will be evaluated and, if a promise is returned, it will wait until the promise
resolves with a `true` value to continue

```html
<script>
    async function swalConfirm() {
        let result = await Swal.fire({
            title: "Are you sure?",
            text: "You won't be able to revert this!",
            icon: "warning",
            showCancelButton: true,
            confirmButtonColor: "#3085d6",
            cancelButtonColor: "#d33",
            confirmButtonText: "Yes, delete it!"
        })
        return result.isConfirmed
    }
</script>
<button hx-delete="/account" hx-confirm="js:swalConfirm()">
    Delete My Account
</button>
```

## Attribute Inheritance {#inheritance}

<details class="migration-note">
<summary>htmx 2.0 to 4.0 Changes</summary>

In htmx 2.0 attribute inheritance was implicit by default: elements inherited the attributes on their parents, such
as hx-target.  In htmx 4.0 attribute inheritance is now explicit by default, using the `:inherited` modifier.

</details>

Inheritance allows you to "hoist" attributes up the DOM to avoid code duplication.

Consider the following htmx:

```html
<button hx-delete="/account" hx-confirm="Are you sure?">
    Delete My Account
</button>
<button hx-put="/account" hx-confirm="Are you sure?">
    Update My Account
</button>
```

Here we have a duplicate `hx-confirm` attribute.

We can hoist this attribute to a parent element using the `:inherited` modifier:

```html
<div hx-confirm:inherited="Are you sure?">
    <button hx-delete="/account">
        Delete My Account
    </button>
    <button hx-put="/account">
        Update My Account
    </button>
</div>
```

This `hx-confirm` attribute will now apply to all htmx-powered elements within it.

## Boosting

Htmx supports "boosting" regular HTML anchors and forms with the [hx-boost](/reference/attributes/hx-boost) attribute.  This
attribute will convert all anchor tags and forms into AJAX requests that, by default, target the body of the page.

Here is an example:

```html
<div hx-boost:inherited="true">
    <a href="/blog">Blog</a>
    <a href="/about">About</a>
    <a href="/contact">Contact</a>
</div>
```

The anchor tags in this div will issue an AJAX `GET` request to `/blog` and swap the response into the `body` tag.

Note that `hx-boost` is using the `inherited` modifier here.

### Progressive Enhancement {#progressive_enhancement}

A nice feature of `hx-boost` is that it degrades gracefully if javascript is not enabled: the links and forms continue
to work, they simply don't use ajax requests.

This is known as
[Progressive Enhancement](https://developer.mozilla.org/en-US/docs/Glossary/Progressive_Enhancement), and it allows
a wider audience to use your site's functionality.

Other htmx patterns can be adapted to achieve progressive enhancement as well, but they will require more thought.

Consider the [active search](/patterns/active-search) example.  As it is written, it will not degrade gracefully:
someone who does not have javascript enabled will not be able to use this feature. This is done for simplicity's sake,
to keep the example as brief as possible.

However, you could wrap the htmx-enhanced input in a form element:

```html
<form action="/search" method="POST">
    <input class="form-control" type="search"
        name="search" placeholder="Begin typing to search users..."
        hx-post="/search"
        hx-trigger="keyup changed delay:500ms, search"
        hx-target="#search-results"
        hx-indicator=".htmx-indicator">
</form>
```

With this in place, javascript-enabled clients would still get the nice active-search UX, but non-javascript enabled
clients would be able to hit the enter key and still search.  Even better, you could add a "Search" button as well.
You would then need to update the form with an `hx-post` that mirrored the `action` attribute, or perhaps use `hx-boost`
on it.

You would need to check on the server side for the `HX-Request` header to differentiate between an htmx-driven and a
regular request, to determine exactly what to render to the client.

Other patterns can be adapted similarly to achieve the progressive enhancement needs of your application.

As you can see, this requires more thought and more work.  It also rules some functionality entirely out of bounds.
These tradeoffs must be made by you, the developer, with respect to your projects goals and audience.

[Accessibility](https://developer.mozilla.org/en-US/docs/Learn/Accessibility/What_is_accessibility) is a concept
closely related to progressive enhancement.  Using progressive enhancement techniques such as `hx-boost` will make your
htmx application more accessible to a wide array of users.

htmx-based applications are very similar to normal, non-AJAX driven web applications because htmx is HTML-oriented.

As such, the normal HTML accessibility recommendations apply.  For example:

* Use semantic HTML as much as possible (i.e. the right tags for the right things)
* Ensure focus state is clearly visible
* Associate text labels with all form fields
* Maximize the readability of your application with appropriate fonts, contrast, etc.

## Streaming Responses

htmx 4 has built-in support for Streaming Responses Server-Sent Events (SSE).

The typical `hx-get`, `hx-post`, `hx-put`, `hx-patch`, or `hx-delete` attributes can trigger a streaming response. When
the server responds with `Content-Type: text/event-stream` instead of `Content-Type: text/html`, htmx automatically
handles the stream.

Each SSE message with a `data:` line (and no `event:` line) is processed like a regular htmx response, respecting
`hx-target`, `hx-select`, and `hx-swap` attributes.

Like [fetch-event-source](https://github.com/Azure/fetch-event-source), htmx's custom SSE implementation supports
request bodies, custom headers, and all HTTP methods (not just GET), and Page Visibility API
integration (using the `pauseHidden` modifier).

### Basic Usage

```html
<button hx-get="/stream" hx-target="#stream-output" hx-swap="innerHTML">
    Stream Response
</button>

<div id="stream-output"></div>
```

The server sends SSE messages with `data:` lines:
```
data: H

data: He

// ...

data: Hello partner!

```

Each message replaces the target element's content. The stream processes until the connection closes, then stops.
No reconnection occurs by default.

### Stream Modes

The `hx-stream` attribute controls reconnection behavior. The default mode is `once`, so it doesn't need to be specified.

- `once` (default): Process stream until connection closes. No reconnection.
- `continuous`: Reconnect automatically if connection drops. Retries with exponential backoff.

```html
<body hx-get="/updates" hx-stream="continuous" hx-trigger="load">
    ...
</body>
```

**Note:** `hx-stream="continuous"` is primarily intended for use with `<htmx-action type="partial">` to enable real-time
updates to multiple parts of the page via a permanently open SSE connection.

### Custom Events

SSE `event:` lines trigger custom DOM events. When an `event:` line is present, htmx fires that event instead of
performing a normal swap.

Use this for lightweight updates without swapping DOM elements.

```html
<button hx-get="/progress"
        hx-on:progress="find('#bar').style.width = event.detail.data + '%'">
    Start
</button>
```

Server sends custom events:

```
event: progress
data: 50

event: progress
data: 100

```

### Configuration

You can configure the global streaming config in `htmx.config.streams`:

```html
<meta name="htmx:config" content='{
  "streams": {
    "mode": "once",
    "maxRetries": 3,
    "initialDelay": 500,
    "maxDelay": 30000,
    "pauseHidden": false
  }
}'>
```

- `mode`: `'once'` or `'continuous'`
- `maxRetries`: Maximum reconnection attempts (default: `Infinity`)
- `initialDelay`: First reconnect delay in ms (default: `500`)
- `maxDelay`: Max backoff delay in ms (default: `30000`)
- `pauseHidden`: Pause stream when page is hidden (default: `false`). Uses the Page Visibility API to pause the stream when the browser window is minimized or the tab is in the background.


You can override these settings per-element using the `hx-stream` attribute:
```html
<button hx-get="/stream"
        hx-stream="continuous maxRetries:10 initialDelay:1s pauseHidden:true">
    Start
</button>
```

### Events

- `htmx:before:sse:stream`: Fired before processing stream
- `htmx:before:sse:message`: Fired before each message swap. Cancel with `event.detail.message.cancelled = true`
- `htmx:after:sse:message`: Fired after each message swap
- `htmx:after:sse:stream`: Fired when stream ends
- `htmx:before:sse:reconnect`: Fired before reconnection attempt. Cancel with `event.detail.reconnect.cancelled = true`

## Web Sockets

Web Sockets are supported via an extensions.  Please see the [WebSocket extension](/extensions/ws)
page to learn more.

## History Support {#history}

<details class="migration-note">
<summary>htmx 2.0 to 4.0 Changes</summary>

History support in htmx 4.0 has changed significantly.  We no longer snapshot the DOM and keep a copy in sessionStorage.

Instead, we issue a full page request every time someone navigates to a history element.  This is much less error-prone
and foolproof.  It also eliminates security concerns regarding keeping history state in accessible storage

This change makes history restoration much more reliable and reduces client-side complexity.

</details>

Htmx provides a simple mechanism for interacting with the [browser history API](https://developer.mozilla.org/en-US/docs/Web/API/History_API):

If you want a given element to push its request URL into the browser navigation bar and add the current state of the page
to the browser's history, include the [hx-push-url](/reference/attributes/hx-push-url) attribute:

```html
<a hx-get="/blog" hx-push-url="true">Blog</a>
```

When a user clicks on this link, htmx will push a new location onto the history stack.

When a user hits the back button, htmx will retrieve the old content from the original URL and swap it back into the body,
simulating "going back" to the previous state.

**NOTE:** If you push a URL into the history, you **must** be able to navigate to that URL and get a full page back!
A user could copy and paste the URL into an email, or new tab.
