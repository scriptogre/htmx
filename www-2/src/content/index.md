---
title: "htmx - high power tools for HTML"
description: "htmx gives you access to AJAX, CSS Transitions, WebSockets and Server Sent Events directly in HTML, using attributes, so you can build modern user interfaces with the simplicity and power of hypertext"
---

## introduction

htmx gives you access to [fetch()](/docs#ajax), [CSS](/docs#css_transitions) & [View](/docs#) Transitions, [SSE](/docs) and more
directly in HTML, using [attributes](/reference#attributes), so you can build
[interactive interfaces](/patterns) with the [simplicity](https://en.wikipedia.org/wiki/HATEOAS) and
[power](https://www.ics.uci.edu/~fielding/pubs/dissertation/rest_arch_style.htm) of HTML.

htmx is small ([~10k min.br'd](https://cdn.jsdelivr.net/npm/htmx.org/dist/)),
[dependency-free](https://github.com/bigskysoftware/htmx/blob/master/package.json),
[extendable](https://htmx.org/extensions) & has reduced code base sizes by  up to [67% when compared with react](/essays/a-real-world-react-to-htmx-port)

## motivation

* Why should only [`<a>`](https://developer.mozilla.org/en-US/docs/Web/HTML/Element/a) & [`<form>`](https://developer.mozilla.org/en-US/docs/Web/HTML/Element/form) be able to make HTTP requests?
* Why should only [`click`](https://developer.mozilla.org/en-US/docs/Web/API/Element/click_event) & [`submit`](https://developer.mozilla.org/en-US/docs/Web/API/HTMLFormElement/submit_event) events trigger them?
* Why should only [`GET`](https://developer.mozilla.org/en-US/docs/Web/HTTP/Methods/GET) & [`POST`](https://developer.mozilla.org/en-US/docs/Web/HTTP/Methods/POST) methods be [available](https://developer.mozilla.org/en-US/docs/Web/HTTP/Methods)?
* Why should you only be able to replace the **entire** screen?

By removing these constraints, htmx completes HTML as a [hypertext](https://en.wikipedia.org/wiki/Hypertext)

## quick start

```html
<script src="https://cdn.jsdelivr.net/npm/htmx.org@4.0.0-alpha2/dist/htmx.min.js"></script>

<!-- have a button POST a click via AJAX -->
<button hx-post="/clicked" hx-swap="outerHTML">
    Click Me
</button>
```

The [`hx-post`](@/reference/attributes/hx-post) and [`hx-swap`](@/reference/attributes/hx-swap) attributes on this button tell htmx:

> When a user clicks on this button, issue an AJAX request to /clicked, and replace the entire button with the HTML response

htmx is the successor to [intercooler.js](http://intercoolerjs.org)

Read the [docs introduction](/docs#introduction) for a more in-depth... introduction.