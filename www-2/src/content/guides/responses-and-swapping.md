---
title: "Responses and Swapping"
---

### Targets

If you want the response to be loaded into a different element other than the one that made the request, you can
use the [`hx-target`](/attributes/hx-target) attribute, which takes a CSS selector.

Looking back at our Live Search example:

```html
<input type="text" name="q"
       hx-get="/search"
       hx-trigger="input delay:500ms, keyup[key=='Enter']"
       hx-target="#search-results"
       placeholder="Search...">
<div id="search-results"></div>
```

You can see that the results from the search are going to be loaded into the element with
the id `search-results`, rather than into the input tag itself.

#### Extended CSS Selectors {#extended-css-selectors}

`hx-target`, and most attributes that take a CSS selector, support an "extended" CSS syntax:

* You can use the `this` keyword, which indicates that the element that the `hx-target` attribute is on is the target
* The `closest <CSS selector>` syntax will find the [closest](https://developer.mozilla.org/docs/Web/API/Element/closest)
  ancestor element or itself, that matches the given CSS selector.
  (e.g. `closest tr` will target the closest table row to the element)
* The `next <CSS selector>` syntax will find the next element in the DOM matching the given CSS selector.
* The `previous <CSS selector>` syntax will find the previous element in the DOM matching the given CSS selector.
* `find <CSS selector>` which will find the first child descendant element that matches the given CSS selector.
  (e.g `find tr` would target the first child descendant row to the element)

In addition, a CSS selector may be wrapped in `<` and `/>` characters, mimicking the
[query literal](https://hyperscript.org/expressions/query-reference/) syntax of hyperscript.

Relative targets like this can be useful for creating flexible user interfaces without peppering your DOM with lots
of `id` attributes.

### Swapping {#swapping}

htmx offers many different ways to swap the HTML returned into the DOM.  By default, the content replaces the
[innerHTML](https://developer.mozilla.org/en-US/docs/Web/API/Element/innerHTML) of the target element, which is called
an `innerHTML` swap.

This is similar to how the `target` attribute on links and forms works, placing the retrieved document within an iframe.

You can modify this by using the [hx-swap](/attributes/hx-swap) attribute with any of the following values:

| Name                        | Description                                                                                                                               |
|-----------------------------|-------------------------------------------------------------------------------------------------------------------------------------------|
| `outerHTML`                 | the default, replaces the entire target element with the returned content                                                                 |
| `innerHTML`                 | puts the content inside the target element                                                                                                |
| `beforebegin` (or `before`) | prepends the content before the target in the target's parent element                                                                     |
| `afterbegin` (or `prepend`) | prepends the content before the first child inside the target                                                                             |
| `beforeend` (or `append`)   | appends the content after the last child inside the target                                                                                |
| `afterend` (or `after`)     | appends the content after the target in the target's parent element                                                                       |
| `delete`                    | deletes the target element regardless of the response                                                                                     |
| `none`                      | does not append content from response ([Out of Band Swaps](#oob_swaps) and [Response Headers](#response-headers) will still be processed) |
| `innerMorph`                | morphs the children of the target element, preserving as much of the existing DOM as possible                                             |
| `outerMorph`                | morphs the target element itself, preserving as much of the existing DOM as possible                                                      |

#### Morph Swaps {#morphing}

In addition to the standard swap mechanisms above, htmx also supports _morphing_ swaps, via extensions.  Morphing swaps
attempt to _merge_ new content into the existing DOM, rather than simply replacing it.  They often do a better job
preserving things like focus, video state, etc. by mutating existing nodes in-place during the swap operation, at the
cost of more CPU.

Consider this HTML:

```html
<div id="video-elt">
    <h1>Title</h1>
    <iframe id="video" width="791" height="445" src="https://www.youtube.com/embed/dQw4w9WgXcQ"></iframe>
</div>
<button hx-get="/swap"
        hx-target="#video-elt"
        hx-swap="outerMorph">
    Swap Header To Bottom
</button>
```

If the response content for this looks like this:

```html
<div id="video-elt">
    <iframe id="video" width="791" height="445" src="https://www.youtube.com/embed/dQw4w9WgXcQ"></iframe>
    <h1>Title</h1>
</div>
```
Then htmx will "morph" the existing content to the new structure.  Note that the `h1` element has moved below the
video.  With the `outerHTML` swap this will cause the video to stop playing and reset.  However, the morphing algorithm
uses ID elements to intelligently mutate the DOM and preserve the existing video element, keeping the video playing
smoothly.

Note that a similar effect can be achieved with the `hx-preserve` attribute, discussed below.

#### View Transitions {#view-transitions}

The [View Transitions API](https://developer.mozilla.org/en-US/docs/Web/API/View_Transitions_API)
gives developers a way to create an animated transition between different DOM states.

<!-- TODO - is this going to be true? -->
By default, htmx uses the viewTransition() API when swapping in content.

#### Swap Options

The [hx-swap](/attributes/hx-swap) attribute also supports options for tuning the swapping behavior of htmx.  For
example, by default htmx will swap in the title of a title tag found anywhere in the new content.  You can turn this
behavior off by setting the `ignoreTitle` modifier to true:

```html
    <button hx-post="/like" hx-swap="outerHTML ignoreTitle:true">Like</button>
```

The modifiers available on `hx-swap` are:

| Option       | Description                                                                                          |
|--------------|------------------------------------------------------------------------------------------------------|
| swap         | A time interval (e.g., 100ms, 1s) to delay the swap operation                                        |
| transition   | true or false, whether to use the view transition API for this swap                                  |
| ignoreTitle  | If set to true, any title found in the new content will be ignored and not update the document title |
| strip        | true or false, whether to strip the outer element when swapping (unwrap the content)                 |
| focus-scroll | true or false, whether to scroll focused elements into view                                          |
| scroll       | top or bottom, will scroll the target element to its top or bottom                                   |
| show         | top or bottom, will scroll the target element's top or bottom into view                              |
| target       | A selector to retarget the swap to a different element                                               |


All swap modifiers appear after the swap style is specified, and are colon-separated.

See the [hx-swap](/attributes/hx-swap) documentation for more details on these options.

### Out of Band Swaps {#oob_swaps}

<details class="migration-note">
<summary>htmx 2.0 to 4.0 Changes</summary>

In htmx 2.0, out of band swaps were the only way to send additional content with a response.  In htmx 4.0 the `<hx-partial>`
tag provides a more general, cleaner mechanism for swapping new content in to targets.  Although the older syntax for
more elaborate out-of-band swaps is still supported in htmx 4.0, we strongly recommend you only use out-of-band swaps
for direct id replacement, and use `<hx-partial>` for your other needs.

</details>

<details class="migration-note">
<summary>htmx 2.0 to 4.0 Changes</summary>

In htmx 2.0, out of band swaps were the only way to send additional content with a response.  In htmx 4.0 the `<hx-partial>`
tag provides a more general, cleaner mechanism for swapping new content in to targets.  Although the older syntax for
more elaborate out-of-band swaps is still supported in htmx 4.0, we strongly recommend you only use out-of-band swaps
for direct id replacement, and use `<hx-partial>` for your other needs.

</details>

If you want to swap content from a response directly into the DOM by using the `id` attribute you can use the
[hx-swap-oob](/attributes/hx-swap-oob) attribute in the *response* html:

```html
<div id="message" hx-swap-oob="true">Swap me directly!</div>
Additional Content
```

In this response, `div#message` would be swapped directly into the matching DOM element, while the additional content
would be swapped into the target in the normal manner.

You can use this technique to "piggy-back" updates on other requests.

#### Selecting Content To Swap

If you want to select a subset of the response HTML to swap into the target, you can use the [hx-select](/attributes/hx-select)
attribute, which takes a CSS selector and selects the matching elements from the response.

You can also pick out pieces of content for an out-of-band swap by using the [hx-select-oob](#)
attribute, which takes a list of element IDs to pick out and swap.

#### Preserving Content During A Swap

If there is content that you wish to be preserved across swaps (e.g. a video player that you wish to remain playing
even if a swap occurs) you can use the [hx-preserve](/attributes/hx-preserve)
attribute on the elements you wish to be preserved.

### CSS Transitions {#css_transitions}

htmx makes it easy to use [CSS Transitions](https://developer.mozilla.org/en-US/docs/Web/CSS/CSS_Transitions/Using_CSS_transitions) without
javascript.  Consider this HTML content:

```html
<div id="div1">Original Content</div>
```

Imagine this content is replaced by htmx via an ajax request with this new content:

```html
<div id="div1" class="red">New Content</div>
```

Note two things:

* The div has the *same* id in the original and in the new content
* The `red` class has been added to the new content

Given this situation, we can write a CSS transition from the old state to the new state:

```css
.red {
    color: red;
    transition: all ease-in 1s ;
}
```

When htmx swaps in this new content, it will do so in such a way that the CSS transition will apply to the new content,
giving you a nice, smooth transition to the new state.

So, in summary, all you need to do to use CSS transitions for an element is keep its `id` stable across requests!

### Partial Tags

The `<hx-partial>` tag (internally represented as `<template htmx-partial>`) allows you to include multiple targeted content
fragments in a single server response. This provides a cleaner, more explicit alternative to [out-of-band swaps](#oob_swaps)
when you want to update multiple parts of the page from one request.

#### Basic Usage

A `<hx-partial>` tag wraps content that should be swapped into a specific target on the page:

```html
<hx-partial hx-target="#messages" hx-swap="beforeend">
  <div>New message content</div>
</hx-partial>

<hx-partial hx-target="#notifications" hx-swap="innerHTML">
  <span class="badge">5</span>
</hx-partial>
```

Each `<hx-partial>` specifies:
- `hx-target` - A CSS selector identifying where to place the content (required)
- `hx-swap` - (optional) The swap strategy to use (defaults to `innerHTML`)

The content inside the `<hx-partial>` tag will be extracted and swapped into the specified target using the specified swap method.

#### Comparison with Out-of-Band Swaps

Both partials and out-of-band swaps allow updating multiple targets from a single response, but they differ in approach:

- **Out-of-band swaps** rely on matching `id` attributes between the response and existing DOM elements
- **Partial tags** explicitly specify their target via `hx-target`, providing more control and clarity

Use partials when you want explicit control over targeting, and out-of-band swaps when you have a consistent `id` scheme.
