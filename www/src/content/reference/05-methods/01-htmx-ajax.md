---
title: "htmx.ajax()"
description: "Issues an htmx request"
---

The `htmx.ajax()` function runs the request, response, action, and swap lifecycle.

## Syntax

```javascript
htmx.ajax(method, url)
htmx.ajax(method, url, target)
htmx.ajax(method, url, options)
```

```javascript
// Target selector
await htmx.ajax('GET', '/messages', '#messages')

// Target element
await htmx.ajax(
  'GET',
  '/messages',
  document.querySelector('#messages')
)

// Options
await htmx.ajax(
  'POST',
  '/messages',
  {
    target: '#messages',
    swap: 'beforeend',
    values: {
      body: 'Hello'
    }
  }
)
```

## Parameters

### `method`

The HTTP method.

```javascript
await htmx.ajax('GET', '/messages')
await htmx.ajax('POST', '/messages')
await htmx.ajax('DELETE', '/messages/42')
await htmx.ajax('QUERY', '/messages/search')
```

### `url`

The request URL.

```javascript
await htmx.ajax('GET', '/messages?limit=10')
```

### `target`

Pass an element or selector as the third argument.

```javascript
await htmx.ajax('GET', '/messages', '#messages')

await htmx.ajax(
  'GET',
  '/messages',
  document.querySelector('#messages')
)
```

### `options`

Use an object to configure the request and swap.

```javascript
await htmx.ajax(
  'POST',
  '/messages',
  {
    source: '#new-message',
    target: '#messages',
    swap: 'beforeend',
    headers: {
      'X-Requested-By': 'compose-form'
    },
    values: {
      body: 'Hello'
    }
  }
)
```

## Swap

Pass `swap` as an [`hx-swap`](/reference/attributes/hx-swap) specification.

```javascript
await htmx.ajax(
  'GET',
  '/messages',
  {
    target: '#messages',
    swap: 'innerHTML transition:true'
  }
)
```

Or pass canonical swap fields.

```javascript
await htmx.ajax(
  'GET',
  '/messages',
  {
    target: '#messages',
    swap: {
      style: 'innerHTML',
      transition: true
    }
  }
)
```

Supported fields include:

- `style`
- [`select`](/reference/attributes/hx-select)
- [`selectOOB`](/reference/attributes/hx-select-oob)
- `transition`
- `swapDelay`
- `settleDelay`
- Other [`hx-swap` modifiers](/reference/attributes/hx-swap)

## Source

Pass `source` as an element or selector.

```javascript
let form = document.querySelector('#new-message')

await htmx.ajax(
  'POST',
  '/messages',
  {
    source: form,
    target: '#messages',
    swap: 'beforeend'
  }
)
```

The source provides inherited attributes, form values, relative selector context, and the element used for lifecycle events.

## Values

Pass request values with `values`.

```javascript
await htmx.ajax(
  'POST',
  '/messages',
  {
    values: {
      body: 'Hello',
      draft: false
    }
  }
)
```

Source form values are collected automatically.

```javascript
await htmx.ajax(
  'POST',
  '/messages',
  {
    source: '#new-message'
  }
)
```

Explicit values override collected form values.

```javascript
await htmx.ajax(
  'POST',
  '/messages',
  {
    source: '#new-message',
    values: {
      draft: false
    }
  }
)
```

## Headers

Pass request headers with `headers`.

```javascript
await htmx.ajax(
  'GET',
  '/messages',
  {
    headers: {
      'X-Request-Source': 'inbox'
    }
  }
)
```

## Event

Pass the triggering event when calling `htmx.ajax()` from an event handler.

```javascript
button.addEventListener('click', event => {
  htmx.ajax(
    'POST',
    '/messages',
    {
      source: button,
      event
    }
  )
})
```

## Return Value

Returns a `Promise` that resolves after the request lifecycle finishes.

```javascript
await htmx.ajax('GET', '/messages', '#messages')
console.log('Request complete')
```

## See Also

- [`htmx.swap()`](/reference/methods/htmx-swap)
- [`hx-swap`](/reference/attributes/hx-swap)
- [`hx-target`](/reference/attributes/hx-target)
- [`hx-select`](/reference/attributes/hx-select)
