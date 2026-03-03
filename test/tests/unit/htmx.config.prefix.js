describe('htmx.config.prefix functionality', function () {
  beforeEach(function () {
    setupTest(this)
  })

  afterEach(function () {
    cleanupTest()
  })

  it('default prefix (empty string) works normally', async function () {
    htmx.config.prefix = ''
    mockResponse('GET', '/test', 'Success')

    createProcessedHTML('<button id="btn" hx-get="/test">Click</button>')
    find('#btn').click()
    await forRequest()

    let lastCall = lastFetch()
    assert.equal(lastCall.url, '/test')
  })

  it('custom prefix prefers prefixed attribute over bare attribute', function () {
    htmx.config.prefix = 'data-'

    let btn = createDisconnectedHTML(
      '<button hx-get="/bare" data-hx-get="/prefixed">Click</button>',
    )
    // When prefix is set, the prefix wrap tries the prefixed version first
    let getValue = htmx.attr(btn, 'hx-get')
    assert.equal(getValue, '/prefixed')

    htmx.config.prefix = ''
  })

  it('empty prefix reads unprefixed attributes', function () {
    htmx.config.prefix = ''

    let btn = createDisconnectedHTML('<button hx-get="/test">Click</button>')
    let result = htmx.attr(btn, 'hx-get')
    assert.equal(result, '/test')
  })
})
