---
title: "Configuration and Security"
---

## Caching

htmx works with standard [HTTP caching](https://developer.mozilla.org/en-US/docs/Web/HTTP/Caching)
mechanisms out of the box.

If your server adds the
[`Last-Modified`](https://developer.mozilla.org/en-US/docs/Web/HTTP/Headers/Last-Modified)
HTTP response header to the response for a given URL, the browser will automatically add the
[`If-Modified-Since`](https://developer.mozilla.org/en-US/docs/Web/HTTP/Headers/If-Modified-Since)
request HTTP header to the next requests to the same URL.

### ETag Support

htmx supports [`ETag`](https://developer.mozilla.org/en-US/docs/Web/HTTP/Headers/ETag)-based caching on a per-element
basis. When your server includes an `ETag` header in the response, htmx will store the ETag value and automatically
include it in the [`If-None-Match`](https://developer.mozilla.org/en-US/docs/Web/HTTP/Headers/If-None-Match)
header for subsequent requests from that element.

This allows your server to return a [`304 Not Modified`](https://developer.mozilla.org/en-US/docs/Web/HTTP/Status/304)
response when the content hasn't changed.

You can set an etag on an element initially by using the `hx-config` attribute:

```html
<div id="news" hx-get="/news"
     hx-trigger="every 3s"
    hx-config='"etag":"1762656750"'>
    Latest News...
</div>
```

When this div issues a poll-based request it will submit an `If-None-Match` header and the server can respond with a
`304 Not Modified` if no new news is available.

Be mindful that if your server can render different content for the same URL depending on some other
headers, you need to use the [`Vary`](https://developer.mozilla.org/en-US/docs/Web/HTTP/Caching#vary)
response HTTP header.

For example, if your server renders the full HTML when the `HX-Request` header is missing or `false`, and it renders a
fragment of that HTML when `HX-Request: true`, you need to add `Vary: HX-Request`. That causes the cache to be keyed
based on a composite of the response URL and the `HX-Request` request header rather than being based just on the response URL.

## Security

htmx allows you to define logic directly in your DOM.  This has a number of advantages, the largest being
[Locality of Behavior](/essays/locality-of-behaviour), which makes your system easier to understand and
maintain.

A concern with this approach, however, is security: since htmx increases the expressiveness of HTML, if a malicious
user is able to inject HTML into your application, they can leverage this expressiveness of htmx to malicious
ends.

### Rule 1: Escape All User Content

The first rule of HTML-based web development has always been: *do not trust input from the user*.  You should escape all
3rd party, untrusted content that is injected into your site.  This is to prevent, among other issues,
[XSS attacks](https://en.wikipedia.org/wiki/Cross-site_scripting).

There is extensive documentation on XSS and how to prevent it on the excellent [OWASP Website](https://owasp.org/www-community/attacks/xss/),
including a [Cross Site Scripting Prevention Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Cross_Site_Scripting_Prevention_Cheat_Sheet.html).

The good news is that this is a very old and well understood topic, and the vast majority of server-side templating languages
support [automatic escaping](https://docs.djangoproject.com/en/4.2/ref/templates/language/#automatic-html-escaping) of
content to prevent just such an issue.

That being said, there are times people choose to inject HTML more dangerously, often via some sort of `raw()`
mechanism in their templating language.  This can be done for good reasons, but if the content being injected is coming
from a 3rd party then it _must_ be scrubbed, including removing attributes starting with `hx-` and `data-hx`, as well as
inline `<script>` tags, etc.

If you are injecting raw HTML and doing your own escaping, a best practice is to *whitelist* the attributes and tags you
allow, rather than to blacklist the ones you disallow.

### htmx Security Tools

Of course, bugs happen and developers are not perfect, so it is good to have a layered approach to security for
your web application, and htmx provides tools to help secure your application as well.

Let's take a look at them.

#### `hx-ignore`

The first tool htmx provides to help further secure your application is the [`hx-ignore`](/reference/attributes/hx-ignore)
attribute.  This attribute will prevent processing of all htmx attributes on a given element, and on all elements within
it.  So, for example, if you were including raw HTML content in a template (again, this is not recommended!) then you
could place a div around the content with the `hx-ignore` attribute on it:

```html
<div hx-ignore>
    <%= raw(user_content) %>
</div>
```

And htmx will not process any htmx-related attributes or features found in that content.  This attribute cannot be
disabled by injecting further content: if an `hx-ignore` attribute is found anywhere in the parent hierarchy of an
element, it will not be processed by htmx.

### CSP Options

Browsers also provide tools for further securing your web application.  The most powerful tool available is a
[Content Security Policy](https://developer.mozilla.org/en-US/docs/Web/HTTP/CSP).  Using a CSP you can tell the
browser to, for example, not issue requests to non-origin hosts, to not evaluate inline script tags, etc.

Here is an example CSP in a `meta` tag:

```html
    <meta http-equiv="Content-Security-Policy" content="default-src 'self';">
```

A full discussion of CSPs is beyond the scope of this document, but the [MDN Article](https://developer.mozilla.org/en-US/docs/Web/HTTP/CSP) provides a good jumping-off point
for exploring this topic.

#### htmx & Eval

htmx uses eval for some functionality:

* Event filters
* The `hx-on` attribute
* Handling most attribute values that starts with `js:` or `javascript:`

All of these features can be replaced with standard event listeners and thus are not crucial to using htmx.

Thus you can disable `eval()` via a CSP and continue to use htmx.

### CSRF Prevention

The assignment and checking of CSRF tokens are typically backend responsibilities, but `htmx` can support returning the
CSRF token automatically with every request using the `hx-headers` attribute. The attribute needs to be added to the
element issuing the request or one of its ancestor elements. This makes the `html` and `body` elements effective
global vehicles for adding the CSRF token to the `HTTP` request header, as illustrated below.

```html
<html lang="en" hx-headers='{"X-CSRF-TOKEN": "CSRF_TOKEN_INSERTED_HERE"}'>
    :
</html>
```

The above elements are usually unique in an HTML document and should be easy to locate within templates.


## Configuring htmx

Htmx has configuration options that can be accessed either programmatically or declaratively.

They are listed below:

<div class="info-table">

| Config Variable                   | Info                                                                                                                                                                                                                                                                       |
|-----------------------------------|----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------|
| `htmx.config.logAll`              | defaults to `false`, if set to `true` htmx will log all events to the console for debugging                                                                                                                                                                                |
| `htmx.config.prefix`              | defaults to `""` (empty string), allows you to use a custom prefix for htmx attributes (e.g., `"data-hx-"` to use `data-hx-get` instead of `hx-get`)                                                                                                                       |
| `htmx.config.transitions`         | defaults to `true`, whether to use view transitions when swapping content (if browser supports it)                                                                                                                                                                         |
| `htmx.config.history`             | defaults to `true`, whether to enable history support (push/replace URL)                                                                                                                                                                                                   |
| `htmx.config.historyReload`       | defaults to `false`, if set to `true` htmx will do a full page reload on history navigation instead of an AJAX request                                                                                                                                                     |
| `htmx.config.mode`                | defaults to `'same-origin'`, the fetch mode for AJAX requests. Can be `'cors'`, `'no-cors'`, or `'same-origin'`                                                                                                                                                            |
| `htmx.config.defaultSwap`         | defaults to `innerHTML`                                                                                                                                                                                                                                                    |
| `htmx.config.indicatorClass`      | defaults to `htmx-indicator`                                                                                                                                                                                                                                               |
| `htmx.config.requestClass`        | defaults to `htmx-request`                                                                                                                                                                                                                                                 |
| `htmx.config.includeIndicatorCSS` | defaults to `true` (determines if the indicator styles are loaded)                                                                                                                                                                                                         |
| `htmx.config.defaultTimeout`      | defaults to `60000` (60 seconds), the number of milliseconds a request can take before automatically being terminated                                                                                                                                                      |
| `htmx.config.inlineScriptNonce`   | defaults to `''`, meaning that no nonce will be added to inline scripts                                                                                                                                                                                                    |
| `htmx.config.inlineStyleNonce`    | defaults to `''`, meaning that no nonce will be added to inline styles                                                                                                                                                                                                     |
| `htmx.config.extensions`          | defaults to `''`, a comma-separated list of extension names to load (e.g., `'preload,optimistic'`)                                                                                                                                                                         |
| `htmx.config.streams`             | configuration for Server-Sent Events (SSE) streams. An object with the following properties: `mode` (`'once'` or `'continuous'`), `maxRetries` (default: `Infinity`), `initialDelay` (default: `500`ms), `maxDelay` (default: `30000`ms), `pauseHidden` (default: `false`) |
| `htmx.config.morphIgnore`         | defaults to `["data-htmx-powered"]`, array of attribute names to ignore when morphing elements                                                                                                                                                                             |
| `htmx.config.noSwap`              | defaults to `[204, 304]`, array of HTTP status codes that should not trigger a swap                                                                                                                                                                                        |
| `htmx.config.implicitInheritance` | defaults to `false`, if set to `true` attributes will be inherited from parent elements automatically without requiring the `:inherited` modifier                                                                                                                          |
| `htmx.config.metaCharacter`       | defaults to `undefined`, allows you to use a custom character instead of `:` for attribute modifiers (e.g., `-` to use `hx-get-inherited` instead of `hx-get:inherited`)                                                                                                   |
</div>

You can set them directly in javascript, or you can use a `meta` tag:

```html
<meta name="htmx:config" content='{"defaultSwap":"innerHTML"}'>
```

**Note:** The meta tag name has changed from `htmx-config` to `htmx:config` in htmx 4.

## Conclusion

And that's it!

Have fun with htmx!

You can accomplish [quite a bit](/patterns/_index) without writing a lot of code!
