---
title: "Client-Side Scripting"
description: "Add inline scripting with hx-on and event handlers"
---

# Client-Side Scripting

<details class="warning">
<summary>Changes in htmx 4.0</summary>

The htmx JavaScript API has changed in htmx 4.0.

</details>

While htmx encourages a hypermedia approach to building web applications, it offers many options for client scripting.
Scripting is included in the REST-ful description of web architecture,
see: [Code-On-Demand](https://www.ics.uci.edu/~fielding/pubs/dissertation/rest_arch_style.htm#sec_5_1_7). As much as is
feasible, we recommend a [hypermedia-friendly](/essays/hypermedia-friendly-scripting) approach to scripting in your web
application:

* [Respect HATEOAS](/essays/hypermedia-friendly-scripting#prime_directive)
* [Use events to communicate between components](/essays/hypermedia-friendly-scripting#events)
* [Use islands to isolate non-hypermedia components from the rest of your application](/essays/hypermedia-friendly-scripting#islands)
* [Consider inline scripting](/essays/hypermedia-friendly-scripting#inline)

The primary integration point between htmx and scripting solutions is the [events](#events) that htmx sends and can
respond to.

See the SortableJS example in the [3rd Party Javascript](#3rd-party) section for a good template for
integrating a JavaScript library with htmx via events.

We have an entire chapter entitled ["Client-Side Scripting"](https://hypermedia.systems/client-side-scripting/) in [our
book](https://hypermedia.systems) that looks at how scripting can be integrated into your htmx-based application.

### The `hx-on*` Attributes

HTML allows the embedding of inline scripts via the [
`onevent` properties](https://developer.mozilla.org/en-US/docs/Web/Events/Event_handlers#using_onevent_properties),
such as `onClick`:

<button onclick="alert('You clicked me!')">
    Click Me!
</button>
```

This feature allows scripting logic to be co-located with the HTML elements the logic applies to, giving good
[Locality of Behaviour (LoB)](/essays/locality-of-behaviour).

Unfortunately, HTML only allows `on*` attributes for a fixed
number of [specific DOM events](https://www.w3schools.com/tags/ref_eventattributes.asp) (e.g. `onclick`) and
doesn't provide a generalized mechanism for responding to arbitrary events on elements.

In order to address this shortcoming, htmx offers [`hx-on:*`](/reference/attributes/hx-on) attributes.

These attributes allow you to respond to any event in a manner that preserves the LoB of the standard `on*` properties,
and provide some nice quality of life improvements over the standard javascript API.

If you want to respond to the `click` event using an `hx-on` attribute, we would write this:

```html
<button hx-on:click="alert('You clicked me!')">
    Click Me!
</button>
```

So, the string `hx-on`, followed by a colon (or a dash), then by the name of the event.

#### The Scripting API

htmx provides some top level helper methods in `hx-on` handlers that make async scripting more enjoyable:

| function    | description                                                                                                                          |
|-------------|--------------------------------------------------------------------------------------------------------------------------------------|
| `find()`    | allows you to find content relative to the current element (e.g. `find('next div')` will find the next div after the current element |
| `findAll()` | allows you to find multiple elements relative to the current element                                                                 |
| `timeout()` | allows you to wait for a given amount of time (e.g. `await timeout(100)` before continuing                                           |

#### Scripting Examples

Here is an example that adds a parameter to an htmx request

{% construction_warning() %}
```html
 <p>Need to verify symbols</p>
{% end %}

<button hx-post="/example"
        hx-on:htmx:config:request="ctx.request.parameters.example = 'Hello Scripting!'">
    Post Me!
</button>
```

Here the `example` parameter is added to the `POST` request before it is issued, with the value 'Hello Scripting!'.

Another use case is to [reset user input](/patterns/reset-on-submit) on successful requests using the `htmx:after:swap`
event:

```html
<button hx-post="/example"
        hx-on:htmx:after:request="find('closest form').reset()">
    Post Me!
</button>
```

### 3rd Party Javascript 

Htmx integrates well with third party libraries.

If the library fires events on the DOM, you can use those events to trigger requests from htmx.

A good example of this is the [SortableJS demo](/patterns/drag-to-reorder):

```html
<form class="sortable" hx-post="/items" hx-trigger="end">
    <div class="htmx-indicator">Updating...</div>
    <div><input type='hidden' name='item' value='1'/>Item 1</div>
    <div><input type='hidden' name='item' value='2'/>Item 2</div>
    <div><input type='hidden' name='item' value='2'/>Item 3</div>
</form>
```

With Sortable, as with most javascript libraries, you need to initialize content at some point.

In htmx, the cleanest way to do this is using the `htmx.onLoad()` method to register a callback.

This callback will be called whenever htmx inserts new content into the DOM, allowing you to initialize
any widgets in the new content.

```js
htmx.onLoad((content) => {
    var sortables = content.querySelectorAll(".sortable");
    for (var i = 0; i < sortables.length; i++) {
        var sortable = sortables[i];
        new Sortable(sortable, {
            animation: 150,
            ghostClass: 'blue-background-class'
        });
    }
})
```

This will ensure that as new content is added to the DOM by htmx, sortable elements are properly initialized.
