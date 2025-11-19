---
title: "HTTP Reference"
---

## Requests &amp; Responses {#requests}

Htmx expects responses to the AJAX requests it makes to be HTML, typically HTML fragments (although a full HTML
document, matched with a [hx-select](/attributes/hx-select) tag can be useful too).

Htmx will then swap the returned HTML into the document at the target specified and with the swap strategy specified.

Sometimes you might want to do nothing in the swap, but still perhaps trigger a client side event ([see below](#response-headers)).

For this situation, by default, you can return a `204 - No Content` response code, and htmx will ignore the content of
the response.

In the event of a connection error, the [`htmx:error`](/events) event will be triggered.

### Configuring Response Handling {#response-handling}

By default, htmx will swap content for successful HTTP responses (2xx status codes) and will not swap content for error
responses (4xx, 5xx status codes). However, you can customize this behavior using the `hx-status:XXX` attribute pattern.

#### Status-Code Conditional Swapping

The `hx-status:XXX` attribute allows you to specify different swap behaviors based on the HTTP status code of the response.
This gives you fine-grained control over how different response statuses are handled.

```html
<button hx-get="/data"
        hx-status:404="none"
        hx-status:500="target:#error-container">
    Load Data
</button>
```

```html
<form hx-post="/submit"
      hx-target="#result"
      hx-status:422="target:#validation-errors"
      hx-status:500="target:#server-error"
      hx-status:503="none">
    <input name="email">
    <button type="submit">Submit</button>
</form>

<div id="result"></div>
<div id="validation-errors"></div>
<div id="server-error"></div>
```

In this example:
- Successful responses (2xx) swap into `#result` (default behavior)
- 422 responses swap into `#validation-errors`
- 500 responses swap into `#server-error`
- 503 responses don't swap at all

### Request Headers

htmx includes headers in the requests it makes:


| Header                       | Description                                                                                          |
|------------------------------|------------------------------------------------------------------------------------------------------|
| `HX-Boosted`                 | indicates that the request is via an element using [hx-boost](/attributes/hx-boost)              |
| `HX-History-Restore-Request` | "true" if the request is for history restoration after a miss in the local history cache             |
| `HX-Request`                 | always "true" except on history restore requests if `htmx.config.historyRestoreAsHxRequest' disabled |

### Response Headers

htmx supports htmx-specific response headers:

| Header                                               | Description                                                                                                                                                                            |
|------------------------------------------------------|----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------|
| [`HX-Location`](/headers/hx-location)            | allows you to do a client-side redirect that does not do a full page reload                                                                                                            |
| [`HX-Push-Url`](/headers/hx-push-url)            | pushes a new url into the history stack                                                                                                                                                |
| [`HX-Redirect`](/headers/hx-redirect)            | can be used to do a client-side redirect to a new location                                                                                                                             |
| `HX-Refresh`                                         | if set to "true" the client-side will do a full refresh of the page                                                                                                                    |
| [`HX-Replace-Url`](/headers/hx-replace-url)      | replaces the current URL in the location bar                                                                                                                                           |
| `HX-Reswap`                                          | allows you to specify how the response will be swapped. See [hx-swap](/attributes/hx-swap) for possible values                                                                     |
| `HX-Retarget`                                        | a CSS selector that updates the target of the content update to a different element on the page                                                                                        |
| `HX-Reselect`                                        | a CSS selector that allows you to choose which part of the response is used to be swapped in. Overrides an existing [`hx-select`](/attributes/hx-select) on the triggering element |
| [`HX-Trigger`](/headers/hx-trigger)              | allows you to trigger client-side events                                                                                                                                               |
| [`HX-Trigger-After-Settle`](/headers/hx-trigger) | allows you to trigger client-side events after the settle step                                                                                                                         |
| [`HX-Trigger-After-Swap`](/headers/hx-trigger)   | allows you to trigger client-side events after the swap step                                                                                                                           |

For more on the `HX-Trigger` headers, see [`HX-Trigger` Response Headers](/headers/hx-trigger).

Submitting a form via htmx has the benefit of no longer needing the [Post/Redirect/Get Pattern](https://en.wikipedia.org/wiki/Post/Redirect/Get).
After successfully processing a POST request on the server, you don't need to return a [HTTP 302 (Redirect)](https://en.wikipedia.org/wiki/HTTP_302). You can directly return the new HTML fragment.

Also, the response headers above are not provided to htmx for processing with 3xx Redirect response codes like [HTTP 302 (Redirect)](https://en.wikipedia.org/wiki/HTTP_302). Instead, the browser will intercept the redirection internally and return the headers and response from the redirected URL. Where possible use alternative response codes like 200 to allow returning of these response headers.

## Validation

Htmx integrates with the [HTML5 Validation API](https://developer.mozilla.org/en-US/docs/Learn/Forms/Form_validation)
and will not issue a request for a form if a validatable input is invalid.

Non-form elements do not validate before they make requests by default, but you can enable validation by setting
the [`hx-validate`](/attributes/hx-validate) attribute to "true".
