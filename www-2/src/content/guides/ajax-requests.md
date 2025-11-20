---
title: "AJAX Requests"
---

## AJAX

<details class="migration-note">
<summary>htmx 2.0 to 4.0 Changes</summary>

htmx 4.0 uses the <code>fetch()</code> API instead of XMLHttpRequest. This enables built-in streaming response support
and simplifies the implementation of htmx, but does create some significant changes between the two versions.

</details>

At the core of htmx are two attributes that allow you to issue fetch()-based AJAX requests directly from HTML:

| Attribute                              | Description                                                                                             |
|----------------------------------------|---------------------------------------------------------------------------------------------------------|
| [hx-action](/reference/attributes/hx-action) | Specifies a URL to issue the request to                                                                 |
| [hx-method](/reference/attributes/hx-method) | Specifies the [HTTP Method](https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Methods) to use |

These attributes can be used like so:

```html
<button hx-method="post" hx-action="/messages">
    Post To Messages
</button>
```
This tells the browser:

> When a user clicks on this button, issue a POST request to the URL /messages and load the response into the button

If no method is specified, the default `GET` method will be used.

Because it is so common to specify a method & action together, htmx provides five attributes that allow
you to specify both in the same single attribute.

| Attribute                              | Description                                |
|----------------------------------------|--------------------------------------------|
| [hx-get](/reference/attributes/hx-get)       | Issues a `GET` request to the given URL    |
| [hx-post](/reference/attributes/hx-post)     | Issues a `POST` request to the given URL   |
| [hx-put](/reference/attributes/hx-put)       | Issues a `PUT` request to the given URL    |
| [hx-patch](/reference/attributes/hx-patch)   | Issues a `PATCH` request to the given URL  |
| [hx-delete](/reference/attributes/hx-delete) | Issues a `DELETE` request to the given URL |

These attributes are typically used in place of `hx-method` & `hx-action`.

Here is the example above redone using `hx-post`:

```html
<button hx-post="/messages">
    Post To Messages
</button>
```

### Configuring Requests

You can configure requests that an element makes via the `hx-config` attribute.  This attribute is specified using
JSON, and supports the following options:

| Property      | Type    | Description                                              | Example       |
|---------------|---------|----------------------------------------------------------|---------------|
| `timeout`     | number  | Request timeout in milliseconds                          | 5000          |
| `credentials` | string  | Fetch credentials mode: "omit", "same-origin", "include" | "include"     |
| `mode`        | string  | Fetch mode: "cors", "no-cors", "same-origin"             | "cors"        |
| `cache`       | string  | Fetch cache mode: "default", "no-cache", "reload", etc.  | "no-cache"    |
| `redirect`    | string  | Fetch redirect mode: "follow", "error", "manual"         | "follow"      |
| `referrer`    | string  | Referrer URL or "no-referrer"                            | "no-referrer" |
| `integrity`   | string  | Subresource integrity value                              | "sha384-..."  |
| `validate`    | boolean | Whether to validate form before submission               | true          |

For example, if you wish to set the timeout for a request to a different value than the default, you could write
the following HTML:

Setting Request Timeout

```html

<button hx-get="/slow-endpoint"
        hx-config='{"timeout": 10000}'>
Load (10s timeout)
</button>
```
#### Merging Config Information

Sometimes it is useful to merge configuration information with a parent configuration, rather than replacing it.  The
hx-config attribute offers a syntax for doing so:

Merging Configuration with + Prefix

You can merge configuration objects into nested properties using the + prefix:

```html
<button hx-get="/data"
        hx-config='{"+headers": {"X-Custom": "value"}}'>
  Load with Custom Header
</button>
```

By prefixing the property name with a `+`, the information will be merged into an existing value from a parent, rather
than replacing it.

#### Overriding Configuration With The `htmx:config:request` Event

You can control almost every aspect of a request via the `htmx:config:request` event.  This event offers a "request
context" object that holds information regarding the request that is going to be sent:

```js
{
    sourceElement,  // The element that triggered the request
    sourceEvent,    // The event that triggered the request
    target,         // The swap target element
    select,         // hx-select value
    selectOOB,      // hx-select-oob value
    swap,           // hx-swap value
    push,           // hx-push-url value
    replace,        // hx-replace-url value
    transition,     // Whether to use view transitions
    request:
    {
        validate,     // Whether to validate the form
        action,       // Request URL
        method,       // HTTP method
        headers,      // Request headers object
        body,         // Request body (FormData)
        credentials,  // Fetch credentials mode
        mode,         // Fetch mode
        cache,        // Fetch cache mode
        timeout,      // Timeout in milliseconds
        // ... any other fetch options
    }
}
```

Note that calling `evt.preventDefault()` in this event will cancel the request.

### Triggering Requests {#triggers}

By default, requests are triggered by the "natural" event of an element:

* `input`, `textarea` & `select` are triggered on the `change` event
* `form` is triggered on the `submit` event
* everything else is triggered by the `click` event

If you want different behavior you can use the [hx-trigger](/reference/attributes/hx-trigger)
attribute to specify which event will cause the request.

Here is a `div` that posts to `/mouse_entered` when a mouse enters it:

```html
<div hx-post="/mouse_entered" hx-trigger="mouseenter">
    Mouse Trap
</div>
```

#### Trigger Modifiers

A trigger can also have additional modifiers that change its behavior.  For example, if you want a request to only
 happen once, you can use the `once` modifier for the trigger:

```html
<div hx-post="/mouse_entered" hx-trigger="mouseenter once">
    Mouse Trap
</div>
```

Other modifiers you can use for triggers are:

* `changed` - only issue a request if the value of the element has changed
* `delay:<time interval>` - wait the given amount of time (e.g. `1s`) before
issuing the request.  If the event triggers again, the countdown is reset.
* `throttle:<time interval>` - wait the given amount of time (e.g. `1s`) before
issuing the request.  Unlike `delay` if a new event occurs before the time limit is hit the event will be discarded,
so the request will trigger at the end of the time period.
* `from:<CSS Selector>` - listen for the event on a different element.  This can be used for things like keyboard
  shortcuts. Note that this CSS selector is not re-evaluated if the page changes.

Multiple triggers can be specified in the [hx-trigger](/reference/attributes/hx-trigger) attribute, separated by commas.

You can use these features to implement many common UX patterns, such as [Active Search](/patterns/active-search):

```html
<input type="text" name="q"
       hx-get="/search"
       hx-trigger="input delay:500ms, keyup[key=='Enter']"
       hx-target="#search-results"
       placeholder="Search...">
<div id="search-results"></div>
```

This input will issue a request 500 milliseconds after an input event occurs, or the `enter` key is pressed and inserts
the results into the `div` with the id `search-results`.

#### Trigger Filters

In the example above, you may have noticed the square brackets after the event name.  This is called a "trigger filter".

Trigger filters allow you to place a filtering javascript expression after the event name that will prevent the trigger
if the filter does not return true.

Here is an example that triggers only on a Shift-Click of the element

```html
<div hx-get="/shift_clicked" hx-trigger="click[shiftKey]">
    Shift Click Me
</div>
```

Properties like `shiftKey` will be resolved against the triggering event first, then against the global scope.

The `this` symbol will be set to the current element.

#### Special Events

htmx provides a few special events for use in [hx-trigger](/reference/attributes/hx-trigger):

* `load` - fires once when the element is first loaded
* `revealed` - fires once when an element first scrolls into the viewport
* `intersect` - fires once when an element first intersects the viewport.  This supports two additional options:
    * `root:<selector>` - a CSS selector of the root element for intersection
    * `threshold:<float>` - a floating point number between 0.0 and 1.0, indicating what amount of intersection to fire the event on

You can also use custom events to trigger requests.

#### Polling

Polling is a simple technique where a web page periodically issues a request to the server to see if any updates have
occurred.  It is not very highly respected in many web development circles, but it is simple, can be relatively
resource-light because it does not maintain a constant network connection, and it tolerates network failures well

In htmx you can implement polling via the `every` syntax in the [`hx-trigger`](/reference/attributes/hx-trigger) attribute:

```html
<div hx-get="/news" hx-trigger="every 2s"></div>
```

This tells htmx:

> Every 2 seconds, issue a GET to /news and load the response into the div

#### Load Polling {#load_polling}

Another technique that can be used to achieve polling in htmx is "load polling", where an element specifies
a `load` trigger along with a delay, and replaces itself with the response:

```html
<div hx-get="/messages"
    hx-trigger="load delay:1s"
    hx-swap="outerHTML">
</div>
```

If the `/messages` end point keeps returning a div set up this way, it will keep "polling" back to the URL every
second.

Load polling can be useful in situations where a poll has an end point at which point the polling terminates, such as
when you are showing the user a [progress bar](/patterns/progress-bar).

### Request Indicators {#indicators}

When an AJAX request is issued it is often good to let the user know that something is happening since the browser
will not give them any feedback.  You can accomplish this in htmx by using `htmx-indicator` class.

The `htmx-indicator` class is defined so that the opacity of any element with this class is `0` by default, making it
invisible but present in the DOM.

When htmx issues a request, it will put a `htmx-request` class onto an element (either the requesting element or
another element, if specified).  The `htmx-request` class will cause a child element with the `htmx-indicator` class
on it to transition to an opacity of `1`, showing the indicator.

```html
<button hx-get="/click">
    Click Me!
    <img class="htmx-indicator" src="/spinner.gif" alt="Loading...">
</button>
```

Here we have a button.  When it is clicked the `htmx-request` class will be added to it, which will reveal the spinner
gif element.

Rhe `htmx-indicator` class uses opacity to hide and show the progress indicator but if you would prefer another
mechanism you can create your own CSS transition like so:

```css
.htmx-indicator{
    display:none;
}
.htmx-request .htmx-indicator{
    display:inline;
}
.htmx-request.htmx-indicator{
    display:inline;
}
```

If you want the `htmx-request` class added to a different element, you can use the [hx-indicator](/reference/attributes/hx-indicator)
attribute with a CSS selector to do so:

```html
<div>
    <button hx-get="/click" hx-indicator="#indicator">
        Click Me!
    </button>
    <img id="indicator" class="htmx-indicator" src="/spinner.gif" alt="Loading..."/>
</div>
```

Here we call out the indicator explicitly by id.

Note that we could have placed the class on the parent `div` as well and had the same effect.

You can also add the [`disabled` attribute](https://developer.mozilla.org/en-US/docs/Web/HTML/Attributes/disabled) to
elements for the duration of a request by using the [hx-disable](/reference/attributes/hx-disable) attribute.
