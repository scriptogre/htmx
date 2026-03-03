describe('history update tests', function () {
  let originalUrl

  beforeEach(function () {
    setupTest()
    originalUrl = window.location.href
  })

  afterEach(function () {
    cleanupTest()
    history.replaceState(null, '', originalUrl)
  })

  it('does nothing when hx-push-url is not set', async function () {
    mockResponse('GET', '/test', 'response')
    let div = createProcessedHTML('<div hx-get="/test" hx-swap="none">Click</div>')

    div.click()
    await forRequest()

    assert.equal(window.location.href, originalUrl)
  })

  it('pushes URL when hx-push-url is set to true', async function () {
    mockResponse('GET', '/test-path', 'response')
    let div = createProcessedHTML('<div hx-get="/test-path" hx-swap="none" hx-push-url="true">Click</div>')

    div.click()
    await forRequest()

    assert.include(window.location.href, '/test-path')
  })

  it('replaces URL when hx-replace-url is set to true', async function () {
    mockResponse('GET', '/replace-path', 'response')
    let div = createProcessedHTML('<div hx-get="/replace-path" hx-swap="none" hx-replace-url="true">Click</div>')

    div.click()
    await forRequest()

    assert.include(window.location.href, '/replace-path')
  })

  it('pushes specific URL when hx-push-url is set to path', async function () {
    mockResponse('GET', '/test', 'response')
    let div = createProcessedHTML('<div hx-get="/test" hx-swap="none" hx-push-url="/custom-path">Click</div>')

    div.click()
    await forRequest()

    assert.include(window.location.href, '/custom-path')
  })

  it('does not push when hx-push-url is false', async function () {
    mockResponse('GET', '/test', 'response')
    let div = createProcessedHTML('<div hx-get="/test" hx-swap="none" hx-push-url="false">Click</div>')

    div.click()
    await forRequest()

    assert.equal(window.location.href, originalUrl)
  })
})
