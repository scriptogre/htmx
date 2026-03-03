describe('htmx.config.metaCharacter functionality', function () {
  beforeEach(function () {
    setupTest(this)
    htmx.config.metaCharacter = '-'
  })

  afterEach(function () {
    cleanupTest()
    htmx.config.metaCharacter = null
  })

  it('works with hx-on events using custom meta character', async function () {
    createProcessedHTML('<button id="btn" hx-on-click="window.testEvent = true">Click</button>')

    find('#btn').click()
    await htmx.timeout(50)

    assert.equal(window.testEvent, true)
    delete window.testEvent
  })

  it('reads direct attribute with colon when metaCharacter is set', function () {
    const btn = createDisconnectedHTML('<button hx-get="/test">Click</button>')
    const result = htmx.attr(btn, 'hx-get')
    assert.equal(result, '/test')
  })

  it('reads attribute using meta character replacement on direct element', function () {
    // Element has hx-vals-inherited (dash form), we ask for hx-vals:inherited (colon form)
    // The meta character wrap converts the colon to dash and finds the attribute
    const btn = createDisconnectedHTML(
      '<button hx-vals-inherited="test-value">Click</button>',
    )
    // The inheritance wrap sees hasAttribute('hx-vals:inherited') is false,
    // but hasAttribute('hx-vals') is also false, so we need the element to have the bare attr too
    // to trigger inheritance's original() call path. Instead, test via a direct read
    // where inheritance passes through to metaCharacter.
    const result = htmx.attr(btn, 'hx-vals:inherited', {inherit: false})
    // With inherit:false, inheritance wrap is skipped, metaCharacter reads 'hx-vals-inherited'
    assert.equal(result, 'test-value')
  })
})
