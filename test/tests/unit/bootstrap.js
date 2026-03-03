describe('bootstrap unit tests', function () {
  it('Test that fragment parsing works as expected', function () {
    var result = htmx.makeFragment('foo')
    var temp = document.createElement('div')
    temp.appendChild(result.fragment.cloneNode(true))
    assert.equal('foo', temp.textContent.trim())

    // Test that template partials are preserved in fragment
    result = htmx.makeFragment(`<template partial hx-target="#test">foo</template>`)
    temp = document.createElement('div')
    temp.appendChild(result.fragment.cloneNode(true))
    assert.include(temp.innerHTML, 'template')
  })

  it('makeFragment handles multiple partials', function () {
    var result = htmx.makeFragment(`
            <div>Main content</div>
            <template partial hx-target="#test1">Partial 1</template>
            <template partial hx-target="#test2" hx-swap="innerHTML">Partial 2</template>
        `)
    var temp = document.createElement('div')
    temp.appendChild(result.fragment.cloneNode(true))
    assert.include(temp.innerHTML, 'Main content')
    assert.include(temp.innerHTML, 'template')
  })

  it('makeFragment extracts title from HTML', function () {
    var result = htmx.makeFragment(`
            <html><head><title>Test Title</title></head><body>Content</body></html>
        `)
    assert.equal('Test Title', result.title)
  })

  it('makeFragment handles body tag response', function () {
    var result = htmx.makeFragment(`<body><div>Content</div></body>`)
    var temp = document.createElement('div')
    temp.appendChild(result.fragment.cloneNode(true))
    assert.include(temp.innerHTML, 'Content')
  })

  it('makeFragment handles fragment response', function () {
    var result = htmx.makeFragment(`<div>Fragment</div><span>More</span>`)
    var temp = document.createElement('div')
    temp.appendChild(result.fragment.cloneNode(true))
    assert.include(temp.innerHTML, 'Fragment')
    assert.include(temp.innerHTML, 'More')
  })

  it('parseTriggerSpecs parses simple event', function () {
    const result = htmx.parseTriggerSpecs('click')

    assert.equal(result.length, 1)
    assert.equal(result[0].name, 'click')
  })

  it('parseTriggerSpecs parses event with option', function () {
    const result = htmx.parseTriggerSpecs('click delay:500')

    assert.equal(result.length, 1)
    assert.equal(result[0].name, 'click')
    assert.equal(result[0].delay, '500')
  })

  it('parseTriggerSpecs parses event with multiple options', function () {
    const result = htmx.parseTriggerSpecs('click delay:500 throttle:100')

    assert.equal(result.length, 1)
    assert.equal(result[0].name, 'click')
    assert.equal(result[0].delay, '500')
    assert.equal(result[0].throttle, '100')
  })

  it('parseTriggerSpecs parses event with boolean opts', function () {
    const result = htmx.parseTriggerSpecs('click once changed')

    assert.equal(result.length, 1)
    assert.equal(result[0].name, 'click')
    assert.equal(result[0].once, true)
    assert.equal(result[0].changed, true)
  })

  it('parseTriggerSpecs parses event with options and boolean opts', function () {
    const result = htmx.parseTriggerSpecs('click delay:1s once changed')

    assert.equal(result.length, 1)
    assert.equal(result[0].name, 'click')
    assert.equal(result[0].delay, '1s')
    assert.equal(result[0].once, true)
    assert.equal(result[0].changed, true)
  })

  it('parseTriggerSpecs parses multiple events', function () {
    const result = htmx.parseTriggerSpecs('click, submit')

    assert.equal(result.length, 2)
    assert.equal(result[0].name, 'click')
    assert.equal(result[1].name, 'submit')
  })

  it('parseTriggerSpecs parses multiple events with options', function () {
    const result = htmx.parseTriggerSpecs('click delay:500, keyup changed')

    assert.equal(result.length, 2)
    assert.equal(result[0].name, 'click')
    assert.equal(result[0].delay, '500')
    assert.equal(result[1].name, 'keyup')
    assert.equal(result[1].changed, true)
  })

  it('parseTriggerSpecs parses event filter', function () {
    const result = htmx.parseTriggerSpecs('click[ctrlKey]')

    assert.equal(result.length, 1)
    assert.equal(result[0].name, 'click[ctrlKey]')
  })

  it('parseTriggerSpecs parses event filter with spaces', function () {
    const result = htmx.parseTriggerSpecs('click[target.value == "test"]')

    assert.equal(result.length, 1)
    assert.equal(result[0].name, 'click[target.value == "test"]')
  })

  it('parseTriggerSpecs parses event with from option', function () {
    const result = htmx.parseTriggerSpecs('click from:body')

    assert.equal(result.length, 1)
    assert.equal(result[0].name, 'click')
    assert.equal(result[0].from, 'body')
  })

  it('parseTriggerSpecs throws on unterminated filter', function () {
    assert.throws(() => {
      htmx.parseTriggerSpecs('click[ctrlKey')
    }, /unterminated/i)
  })

  it('parseTriggerSpecs handles complex real-world spec', function () {
    const result = htmx.parseTriggerSpecs(
      'keyup[target.value.length > 3] changed delay:500ms from:input',
    )

    assert.equal(result.length, 1)
    assert.equal(result[0].name, 'keyup[target.value.length > 3]')
    assert.equal(result[0].changed, true)
    assert.equal(result[0].delay, '500ms')
    assert.equal(result[0].from, 'input')
  })

  it('parseTriggerSpecs handles complex real-world spec w string and preserves spaces in string', function () {
    const result = htmx.parseTriggerSpecs(
      'keyup[target.value == "hello world"] changed delay:500ms from:input',
    )

    assert.equal(result.length, 1)
    assert.equal(result[0].name, 'keyup[target.value == "hello world"]')
    assert.equal(result[0].changed, true)
    assert.equal(result[0].delay, '500ms')
    assert.equal(result[0].from, 'input')
  })

  it('public API surface remains stable', function () {
    // This test ensures the key public API methods exist on htmx
    const expectedPublicMethods = [
      'ajax',
      'find',
      'findAll',
      'forEvent',
      'on',
      'onLoad',
      'parseInterval',
      'process',
      'swap',
      'takeClass',
      'timeout',
      'defineExtension',
      'trigger',
    ]

    for (const method of expectedPublicMethods) {
      assert.isFunction(
        htmx[method],
        `Expected htmx.${method} to be a function`,
      )
    }

    // Check config exists
    assert.isObject(htmx.config, 'Expected htmx.config to be an object')
  })
})
