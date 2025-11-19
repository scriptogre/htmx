---
title: "Getting Started"
---

## htmx in a Nutshell {#introduction}

htmx is a library that allows you to access modern browser features directly from HTML, rather than using
JavaScript.

To understand the htmx approach, first let's take a look at the two main _hypermedia controls_, or interactive elements
of HTML, the [anchor tag](https://developer.mozilla.org/en-US/docs/Web/HTML/Reference/Elements/a) and the
[form tag](https://developer.mozilla.org/en-US/docs/Web/HTML/Reference/Elements/form):

```html
<a href="/blog">Blog</a>

<form method="post" action="/register">
    <label>Email: <input type="email"></label>
    <button type="submit">Submit</button>
</form>
```

The anchor tag tells a browser:

> When a user clicks on this link, issue an HTTP GET request to '/blog' and load the response content
>  into the browser window

The form tag tells a browser:

> When a user submits this form, issue an HTTP POST request to '/register' and load the response content
>  into the browser window

Both these elements support a [`target`](https://developer.mozilla.org/en-US/docs/Web/HTML/Reference/Elements/form#target)
attribute that allows you to place the response in an [`iframe`](https://developer.mozilla.org/en-US/docs/Web/HTML/Reference/Elements/iframe)
rather than replacing the entire page:

```html
<form method="post" action="/register" target="iframe1">
    <label>Email: <input type="email"></label>
    <button type="submit">Submit</button>
</form>
<iframe name="iframe1">
  <!-- The response will be placed here-->
</iframe>
```

This is called [transclusion](https://en.wikipedia.org/wiki/Transclusion), where on HTML document is included inside
another document.

With these ideas in mind, consider the following bit of htmx-powered HTML:

```html
<button hx-post="/clicked"
    hx-trigger="click"
    hx-target="#ouput-elt"
    hx-swap="outerHTML">
    Click Me!
</button>
<output id="output-elt">
</output>
```

Given these attribute, htmx will enable the following behavior:

> When a user clicks on this button, issue an HTTP POST request to '/clicked' and use the content from the response
>  to replace the element with the id `output-elt` in the DOM

htmx [generalizes the idea of hypermedia controls](https://dl.acm.org/doi/pdf/10.1145/3648188.3675127) in HTML, which means that
any element can issue an any [HTTP verb](https://en.wikipedia.org/wiki/HTTP_Verbs) HTTP request in response to any
[event](https://developer.mozilla.org/en-US/docs/Web/API/Document_Object_Model/Events), and the response content can
be place anywhere in the page.

Like in the case of the link and form examples above, htmx expects the server to responds with HTML, not *JSON*.

In this manner, htmx follows the [original web programming model](https://www.ics.uci.edu/~fielding/pubs/dissertation/rest_arch_style.htm)
of the web, using [Hypertext As The Engine Of Application State](https://en.wikipedia.org/wiki/HATEOAS).

## 2.x to 4.x Migration Guide

[Version 2](https://v2.htmx.org) (and [Version 1](https://v1.htmx.org)) of htmx are still supported, but the latest
version of htmx is 4.x.

If you are migrating to htmx 4.x from [htmx 2.x](https://v2.htmx.org), please see the [htmx 4.x migration guide](/migration-guide-htmx-4).

## Installing

htmx is a dependency-free, browser-oriented javascript library.

This means that using it can be as simple as adding a `<script>` tag to your document `<head>` tag.

There is no need for a build system to use htmx.

### Via A CDN (e.g. jsDelivr)

The fastest way to get going with htmx is to load it via a CDN.

Just add this to your head tag and you can get going:

```html
<script src="https://cdn.jsdelivr.net/npm/htmx.org@4.0.0-alpha2/dist/htmx.min.js" integrity="sha384-R6aiRJnQG2X5DMQnF4VAsYMZcAVNxOUoKW5AGq/3QD79h/RZWsb+EAt8DiyCjFe3" crossorigin="anonymous"></script>
```

An unminified version is also available as well:

```html
<script src="https://cdn.jsdelivr.net/npm/htmx.org@4.0.0-alpha2/dist/htmx.js" integrity="sha384-dvV6/qHoLaZSBd7pyxGlWuZIMoQ3w4cnRxd9KQDn1TOxev3oWEeU1766r3KjKhhm" crossorigin="anonymous"></script>
```

While this CDN-based approach is quick and easy, you may want to consider [not using CDNs in production](https://blog.wesleyac.com/posts/why-not-javascript-cdn).

### Download a copy

The next easiest way to install htmx is to copy it into your project, an option called [vendoring](/essays/vendoring).

Download `htmx.min.js` <a download href="https://cdn.jsdelivr.net/npm/htmx.org@4.0.0-alpha2/dist/htmx.min.js">from jsDelivr</a>
and hen add it to the appropriate directory in your project and include it where necessary with a `<script>` tag:

```html
<script src="/path/to/htmx.min.js"></script>
```

### npm

For npm-style build systems, you can install htmx via [npm](https://www.npmjs.com/):

```sh
npm install htmx.org@4.0.0-alpha2
```

After installing, you'll need to use appropriate tooling to use `node_modules/htmx.org/dist/htmx.js` (or `.min.js`).
For example, you might bundle htmx with some extensions and project-specific code.
