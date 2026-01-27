---
title: "Swaps"
description: "Control how responses replace existing content"
---

# Swaps

htmx offers many different ways to swap the HTML returned into the DOM. By default, the content replaces the
[innerHTML](https://developer.mozilla.org/en-US/docs/Web/API/Element/innerHTML) of the target element, which is called
an `innerHTML` swap.

This is similar to how the `target` attribute on links and forms works, placing the retrieved document within an iframe.

You can modify this by using the [hx-swap](/reference/attributes/hx-swap) attribute with any of the following values:

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

### Morph Swaps 

In addition to the standard swap mechanisms above, htmx also supports _morphing_ swaps, via extensions. Morphing swaps
attempt to _merge_ new content into the existing DOM, rather than simply replacing it. They often do a better job
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

Then htmx will "morph" the existing content to the new structure. Note that the `h1` element has moved below the
video. With the `outerHTML` swap this will cause the video to stop playing and reset. However, the morphing algorithm
uses ID elements to intelligently mutate the DOM and preserve the existing video element, keeping the video playing
smoothly.

Note that a similar effect can be achieved with the `hx-preserve` attribute, discussed below.

#### Excluding Elements from Morphing

Exclude specific elements from morphing using config options:

- [`htmx.config.morphSkip`](/reference/javascript-api/htmx-config-morphskip) - Completely skip morphing specific elements (they stay frozen)
- [`htmx.config.morphSkipChildren`](/reference/javascript-api/htmx-config-morphskipchildren) - Update element attributes but preserve children

Useful for third-party widgets, custom web components, or active animations.

### View Transitions 

The [View Transitions API](https://developer.mozilla.org/en-US/docs/Web/API/View_Transitions_API)
gives developers a way to create an animated transition between different DOM states.

```html
<!-- TODO - is this going to be true? -->
By default, htmx uses the viewTransition() API when swapping in content.

### Swap Options

The [hx-swap](/reference/attributes/hx-swap) attribute also supports options for tuning the swapping behavior of htmx. For
example, by default htmx will swap in the title of a title tag found anywhere in the new content. You can turn this
behavior off by setting the `ignoreTitle` modifier to true:

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

See the [hx-swap](/reference/attributes/hx-swap) documentation for more details on these options.
