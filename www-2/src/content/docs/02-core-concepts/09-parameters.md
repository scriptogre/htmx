---
title: "Parameters"
description: "Control which form values are included in requests"
---

# Parameters

By default, an element that causes a request will include its `value` if it has one. If the element is a form it
will include the values of all inputs within it.

As with HTML forms, the `name` attribute of the input is used as the parameter name in the request that htmx sends.

Additionally, if the element causes a non-`GET` request, the values of all the inputs of the associated form will be
included (typically this is the nearest enclosing form, but could be different if e.g. `<button form="associated-form">`
is used).

If you wish to include the values of other elements, you can use the [hx-include](/reference/attributes/hx-include) attribute
with a CSS selector of all the elements whose values you want to include in the request.

Finally, if you want to programmatically modify the parameters, you can use the [htmx:config:request](/events.md#)
event.

### File Upload 

If you wish to upload files via an htmx request, you can set the [hx-encoding](/reference/attributes/hx-encoding) attribute to
`multipart/form-data`. This will use a `FormData` object to submit the request, which will properly include the file
in the request.

Note that depending on your server-side technology, you may have to handle requests with this type of body content very
differently.
