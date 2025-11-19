---
title: "Scripting and Events"
---

## Extensions

In htmx 4, extensions hook into standard events rather than callback extension points. They are lightweight with no performance penalty.

Extensions apply page-wide without requiring `hx-ext` on parent elements. They activate via custom attributes where needed.

To restrict which extensions can register, use an allow list:

```html
<meta name="htmx:config" content='{"extensions": "my-ext,another-ext"}'>
```

### Core Extensions

htmx supports a few core extensions, which are supported by the htmx development team:

* [head-support](/extensions/head-support) - support for merging head tag information (styles, etc.) in htmx requests
* [ws](/extensions/ws) - support for [Web Sockets](https://developer.mozilla.org/en-US/docs/Web/API/WebSockets_API/Writing_WebSocket_client_applications)

You can see all available extensions on the [Extensions](/extensions) page.

### Creating Extensions

If you are interested in adding your own extension to htmx, please [see the extension docs](/extensions/building).

## Events & Logging {#events}

<details class="migration-note">
<summary>htmx 2.0 to 4.0 Changes</summary>

htmx 4.0 changed event names significantly when compared with htmx 2.0, making them much more standardized.

See the full event mapping in the [Changes in htmx 4.0](/migration-guide-htmx-4#event-changes) document.

**Note:** All events now provide a consistent `ctx` object with request/response information.

</details>

Htmx has an extensive [events mechanism](/reference.md#events), which doubles as the logging system.

If you want to register for a given htmx event you can use

```js
document.body.addEventListener('htmx:after:init', function(evt) {
    myJavascriptLib.init(evt.detail.elt);
});
```

or, if you would prefer, you can use the following htmx helper:

```javascript
htmx.on("htmx:after:init", function(evt) {
    myJavascriptLib.init(evt.detail.elt);
});
```

The `htmx:load` event is fired every time an element is loaded into the DOM by htmx, and is effectively the equivalent
 to the normal `load` event.

Some common uses for htmx events are:

### Initialize A 3rd Party Library With Events {#init_3rd_party_with_events}

Using the `htmx:load` event to initialize content is so common that htmx provides a helper function:

```javascript
htmx.onLoad(function(target) {
    myJavascriptLib.init(target);
});
```
This does the same thing as the first example, but is a little cleaner.

### Configure a Request With Events {#config_request_with_events}

You can handle the [`htmx:config:request`](/events.md#htmx:config:request) event in order to modify an AJAX request before it is issued:

```javascript
document.body.addEventListener('htmx:config:request', function(evt) {
    evt.detail.ctx.request.parameters['auth_token'] = getAuthToken(); // add a new parameter into the request
    evt.detail.ctx.request.headers['Authentication-Token'] = getAuthToken(); // add a new header into the request
});
```

Here we add a parameter and header to the request before it is sent.

## Debugging

Declarative and event driven programming with htmx (or any other declarative language) can be a wonderful and highly productive
activity, but one disadvantage when compared with imperative approaches is that it can be trickier to debug.

Figuring out why something *isn't* happening, for example, can be difficult if you don't know the tricks.

Here are some tips:

The first debugging tool you can use is to set `htmx.config.logAll` to `true`.  This will log every event that htmx
triggers and will allow you to see exactly what the library is doing.

```javascript
htmx.config.logAll = true;
```

Of course, that won't tell you why htmx *isn't* doing something.  You might also not know *what* events a DOM
element is firing to use as a trigger.  To address this, you can use the
[`monitorEvents()`](https://developers.google.com/web/updates/2015/05/quickly-monitor-events-from-the-console-panel) method available in the
browser console:

```javascript
monitorEvents(htmx.find("#theElement"));
```

This will spit out all events that are occurring on the element with the id `theElement` to the console, and allow you
to see exactly what is going on with it.

Note that this *only* works from the console, you cannot embed it in a script tag on your page.

Finally, push come shove, you might want to just debug `htmx.js` by loading up the unminimized version.

You would most likely want to set a break point in the  methods to see what's going on.

And always feel free to jump on the [Discord](https://htmx.org/discord) if you need help.

## Scripting {#scripting}

<details class="migration-note">
<summary>htmx 2.0 to 4.0 Changes</summary>

The htmx JavaScript API has changed in htmx 4.0.

</details>

While htmx encourages a hypermedia approach to building web applications, it offers many options for client scripting. Scripting is included in the REST-ful description of web architecture, see: [Code-On-Demand](https://www.ics.uci.edu/~fielding/pubs/dissertation/rest_arch_style.htm#sec_5_1_7). As much as is feasible, we recommend a [hypermedia-friendly](/essays/hypermedia-friendly-scripting) approach to scripting in your web application:

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

### <a name="hx-on"></a>[The `hx-on*` Attributes](#hx-on)

HTML allows the embedding of inline scripts via the [`onevent` properties](https://developer.mozilla.org/en-US/docs/Web/Events/Event_handlers#using_onevent_properties),
such as `onClick`:

```html
<button onclick="alert('You clicked me!')">
    Click Me!
</button>
```

This feature allows scripting logic to be co-located with the HTML elements the logic applies to, giving good
[Locality of Behaviour (LoB)](/essays/locality-of-behaviour).

Unfortunately, HTML only allows `on*` attributes for a fixed
number of [specific DOM events](https://www.w3schools.com/tags/ref_eventattributes.asp) (e.g. `onclick`) and
doesn't provide a generalized mechanism for responding to arbitrary events on elements.

In order to address this shortcoming, htmx offers [`hx-on:*`](/attributes/hx-on) attributes.

These attributes allow you to respond to any event in a manner that preserves the LoB of the standard `on*` properties,
and provide some nice quality of life improvements over the standard javascript API.

If you want to respond to the `click` event using an `hx-on` attribute, we would write this:

```html
<button hx-on:click="alert('You clicked me!')">
    Click Me!
</button>
```

So, the string `hx-on`, followed by a colon (or a dash), then by the name of the event.

#### <a name="htmx-scripting-api"></a>[The Scripting API](#htmx-scripting-api)

htmx provides some top level helper methods in `hx-on` handlers that make async scripting more enjoyable:

| function    | description                                                                                                                          |
|-------------|--------------------------------------------------------------------------------------------------------------------------------------|
| `find()`    | allows you to find content relative to the current element (e.g. `find('next div')` will find the next div after the current element |
| `findAll()` | allows you to find multiple elements relative to the current element                                                                 |
| `timeout()` | allows you to wait for a given amount of time (e.g. `await timeout(100)` before continuing                                           |


#### <a name="htmx-scripting-examples"></a>[Scripting Examples](#htmx-scripting-examples)

Here is an example that adds a parameter to an htmx request

{% construction_warning() %}
 <p>Need to verify symbols</p>
{% end %}

```html
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

### 3rd Party Javascript {#3rd-party}

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

### Web Components {#web-components}

htmx doesn't automatically scan inside web components' shadow DOM. You must manually initialize it.

After creating your shadow DOM, call [`htmx.process`](/api.md#process):
```javascript
customElements.define('my-counter', class extends HTMLElement {
    connectedCallback() {
        const shadow = this.attachShadow({ mode: 'open' })
        shadow.innerHTML = `
          <button hx-post="/increment" hx-target="#count">+1</button>
          <div id="count">0</div>
        `
        htmx.process(shadow) // Initialize htmx for this shadow DOM
    }
})

```

#### Targeting Elements Outside Shadow DOM

Selectors like [`hx-target`](/attributes/hx-target) only see elements inside the same shadow DOM.

To break out:

1. Target the host element, using `host`:
   ```html
   <button hx-get="..." hx-target="host">
     ...
   </button>
   ```
2. Target elements in main document, using `global:<selector>`:
   ```html
   <button hx-get="..." hx-target="global:#target">
     ...
   </button>
   ```

#### Components Without Shadow DOM

Still call [`htmx.process`](/api.md#process) on the component:
```javascript
customElements.define('simple-widget', class extends HTMLElement {
  connectedCallback() {
    this.innerHTML = `Load`
    htmx.process(this)
  }
})
```
