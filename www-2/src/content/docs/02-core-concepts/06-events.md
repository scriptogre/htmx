---
title: "Events"
description: "Hook into htmx's event system for custom behavior"
---

# Events

<details class="warning">
<summary>Changes in htmx 4.0</summary>

htmx 4.0 changed event names significantly when compared with htmx 2.0, making them much more standardized.

See the full event mapping in the [Changes in htmx 4.0](/migration-guide-htmx-4#event-changes) document.

**Note:** All events now provide a consistent `ctx` object with request/response information.

</details>

Htmx has an extensive [events mechanism](/reference.md#events), which doubles as the logging system.

If you want to register for a given htmx event you can use

```javascript
document.body.addEventListener('htmx:after:init', function (evt) {
    myJavascriptLib.init(evt.detail.elt);
});
```

or, if you would prefer, you can use the following htmx helper:

```javascript
htmx.on("htmx:after:init", function (evt) {
    myJavascriptLib.init(evt.detail.elt);
});
```

The `htmx:load` event is fired every time an element is loaded into the DOM by htmx, and is effectively the equivalent
to the normal `load` event.

Some common uses for htmx events are:

### Initialize A 3rd Party Library With Events 

Using the `htmx:load` event to initialize content is so common that htmx provides a helper function:

```javascript
htmx.onLoad(function (target) {
    myJavascriptLib.init(target);
});
```

This does the same thing as the first example, but is a little cleaner.

### Configure a Request With Events 

You can handle the [`htmx:config:request`](/events.md#htmx:config:request) event in order to modify an AJAX request
before it is issued:

```javascript
document.body.addEventListener('htmx:config:request', function (evt) {
    evt.detail.ctx.request.parameters['auth_token'] = getAuthToken(); // add a new parameter into the request
    evt.detail.ctx.request.headers['Authentication-Token'] = getAuthToken(); // add a new header into the request
});
```

Here we add a parameter and header to the request before it is sent.
