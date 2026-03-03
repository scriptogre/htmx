describe('request lifecycle tests', function () {
  beforeEach(function () {
    setupTest()
  })

  afterEach(function () {
    cleanupTest()
  })

  it('triggers htmx:before:request event', async function () {
    mockResponse('GET', '/test', 'response')
    let div = createProcessedHTML('<div id="target" hx-get="/test" hx-swap="none"></div>')

    let beforeRequestFired = false
    div.addEventListener('htmx:before:request', () => (beforeRequestFired = true))

    div.click()
    await forRequest()
    assert.isTrue(beforeRequestFired)
  })

  it('triggers htmx:after:request event', async function () {
    mockResponse('GET', '/test', 'response')
    let div = createProcessedHTML('<div id="target" hx-get="/test" hx-swap="none"></div>')

    let afterRequestFired = false
    div.addEventListener('htmx:after:request', () => (afterRequestFired = true))

    div.click()
    await forRequest()
    assert.isTrue(afterRequestFired)
  })

  it('makes a fetch call to the correct URL', async function () {
    mockResponse('GET', '/test', 'response')
    let div = createProcessedHTML('<div hx-get="/test" hx-swap="none"></div>')

    div.click()
    await forRequest()

    let call = lastFetch()
    assert.include(call.url, '/test')
  })

  it('does not execute when hx-sync drop blocks request', async function () {
    mockResponse('GET', '/test', 'response')
    let div = createProcessedHTML('<div hx-get="/test" hx-swap="none" hx-sync="drop"></div>')

    // Click twice rapidly — second should be dropped
    div.click()
    div.click()
    await forRequest()

    // Only one fetch call should have been made
    let calls = fetchMock.getCalls()
    assert.equal(calls.length, 1)
  })

  it('returns early if htmx:before:request is cancelled', async function () {
    mockResponse('GET', '/test', 'response')
    let div = createProcessedHTML('<div hx-get="/test" hx-swap="none"></div>')

    div.addEventListener('htmx:before:request', e => e.preventDefault())

    div.click()
    // Give time for a potential request
    await new Promise(r => setTimeout(r, 50))

    let calls = fetchMock.getCalls()
    assert.equal(calls.length, 0)
  })

  // TODO: hx-confirm is installed after hx-get in extension order, so it currently
  // cannot prevent the request from being issued. This test should pass once
  // hx-confirm is installed before hx-get/hx-post/etc.
  it.skip('returns early if confirm returns false', async function () {
    let originalConfirm = window.confirm
    window.confirm = () => false

    try {
      mockResponse('GET', '/test', 'response')
      let div = createProcessedHTML(
        '<div hx-get="/test" hx-swap="none" hx-confirm="Are you sure?"></div>',
      )

      div.click()
      // Give time for a potential request
      await new Promise(r => setTimeout(r, 50))

      let calls = fetchMock.getCalls()
      assert.equal(calls.length, 0)
    } finally {
      window.confirm = originalConfirm
    }
  })

  it('catches errors and triggers htmx:error event', async function () {
    // Mock a network failure
    mockFailure('GET', '/test', 'fetch failed')
    let div = createProcessedHTML('<div hx-get="/test" hx-swap="none"></div>')

    let errorFired = false
    div.addEventListener('htmx:error', e => {
      errorFired = true
    })

    div.click()
    await forRequest()

    assert.isTrue(errorFired)
  })

  it('always triggers htmx:finally', async function () {
    mockFailure('GET', '/test', 'fail')
    let div = createProcessedHTML('<div hx-get="/test" hx-swap="none"></div>')

    let finallyFired = false
    div.addEventListener('htmx:finally', () => (finallyFired = true))

    div.click()
    await forRequest()
    assert.isTrue(finallyFired)
  })

  it('processes queued requests after completion with hx-sync queue all', async function () {
    let requestCount = 0
    mockResponse('GET', '/test', () => {
      requestCount++
      return new MockResponse('response ' + requestCount)
    })
    let div = createProcessedHTML('<div hx-get="/test" hx-swap="none" hx-sync="queue all"></div>')

    // Issue two clicks — second should be queued
    div.click()
    div.click()

    // Wait for both requests to complete
    await forRequest()
    // Wait for the queued request
    await forRequest()

    assert.isTrue(requestCount >= 2)
  })
})
