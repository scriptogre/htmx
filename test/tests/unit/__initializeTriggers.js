describe('trigger initialization behavior tests', function () {
  beforeEach(function () {
    setupTest()
  })

  afterEach(function () {
    cleanupTest()
  })

  it('basic click trigger should work', async function () {
    mockResponse('GET', '/test', 'response')
    let btn = createProcessedHTML('<button hx-get="/test">Demo</button>')
    btn.click()
    await forRequest()
    lastFetch()
  })

  it('once should only trigger once', async function () {
    mockResponse('GET', '/test', 'response')
    let btn = createProcessedHTML('<button hx-get="/test" hx-trigger="click once">Demo</button>')
    btn.click()
    await forRequest()
    let calls = fetchMock.getCalls()
    assert.equal(calls.length, 1)

    // Second click should not trigger a request
    btn.click()
    await htmx.timeout(50)
    calls = fetchMock.getCalls()
    assert.equal(calls.length, 1)
  })

  it('default trigger for button is click', async function () {
    mockResponse('GET', '/test', 'response')
    let btn = createProcessedHTML('<button hx-get="/test">Test</button>')
    btn.click()
    await forRequest()
    lastFetch()
  })

  it('default trigger for form is submit', async function () {
    mockResponse('POST', '/test', 'response')
    let form = createProcessedHTML('<form hx-post="/test"><button type="submit">Submit</button></form>')
    form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))
    await forRequest()
    lastFetch()
  })

  it('default trigger for input is change', async function () {
    mockResponse('GET', '/test', 'response')
    let input = createProcessedHTML('<input type="text" hx-get="/test">')
    input.dispatchEvent(new Event('change'))
    await forRequest()
    lastFetch()
  })

  it('default trigger for select is change', async function () {
    mockResponse('GET', '/test', 'response')
    let select = createProcessedHTML('<select hx-get="/test"></select>')
    select.dispatchEvent(new Event('change'))
    await forRequest()
    lastFetch()
  })

  it('default trigger for textarea is change', async function () {
    mockResponse('GET', '/test', 'response')
    let textarea = createProcessedHTML('<textarea hx-get="/test"></textarea>')
    textarea.dispatchEvent(new Event('change'))
    await forRequest()
    lastFetch()
  })

  it('delay modifier delays execution', async function () {
    mockResponse('GET', '/test', 'response')
    let btn = createProcessedHTML('<button hx-get="/test" hx-trigger="click delay:50ms">Demo</button>')

    // Start waiting for the request before clicking
    let requestPromise = forRequest(300)
    btn.click()

    // Should not have fired yet
    let calls = fetchMock.getCalls()
    assert.equal(calls.length, 0)

    await requestPromise
    lastFetch()
  })

  it('delay modifier resets on subsequent triggers (debounce)', async function () {
    mockResponse('GET', '/test', 'response')
    let btn = createProcessedHTML('<button hx-get="/test" hx-trigger="click delay:50ms">Demo</button>')

    let requestPromise = forRequest(300)
    btn.click()
    await htmx.timeout(30)
    btn.click()

    await requestPromise

    // Only one request should have been made (debounce behavior)
    let calls = fetchMock.getCalls()
    assert.equal(calls.length, 1)
  })

  it('throttle modifier limits execution frequency', async function () {
    mockResponse('GET', '/test', 'response')
    let btn = createProcessedHTML('<button hx-get="/test" hx-trigger="click throttle:100ms">Demo</button>')

    // First click fires immediately
    btn.click()
    await forRequest(300)
    let calls = fetchMock.getCalls()
    assert.equal(calls.length, 1)

    // Rapid clicks during throttle window - should be dropped (leading-edge throttle)
    btn.click()
    btn.click()
    await htmx.timeout(50)
    calls = fetchMock.getCalls()
    assert.equal(calls.length, 1, 'clicks during throttle window should be dropped')

    // After throttle window expires, a new click should fire
    await htmx.timeout(100)
    btn.click()
    await forRequest(300)
    calls = fetchMock.getCalls()
    assert.equal(calls.length, 2, 'click after throttle window should fire')
  })

  // TODO: consume modifier not yet implemented in kernel+core architecture
  it.skip('consume modifier stops event propagation', function () {
  })

  // TODO: changed modifier not yet implemented in kernel+core architecture
  it.skip('changed modifier only triggers when value changes', function () {
  })

  // TODO: event filters (bracket syntax) not yet implemented in kernel+core architecture
  it.skip('event filter evaluates condition', function () {
  })

  it('from modifier listens on different element', async function () {
    mockResponse('GET', '/test', 'response')
    let container = createProcessedHTML(
      '<div><button id="source">Source</button><div id="target" hx-get="/test" hx-trigger="click from:#source"></div></div>',
    )

    let target = container.querySelector('#target')
    let source = container.querySelector('#source')

    // Clicking target should not trigger
    target.click()
    await htmx.timeout(50)
    let calls = fetchMock.getCalls()
    assert.equal(calls.length, 0)

    // Clicking source should trigger
    source.click()
    await forRequest()
    lastFetch()
  })

  it('multiple triggers separated by comma', async function () {
    mockResponse('GET', '/test', 'response')
    let btn = createProcessedHTML('<button hx-get="/test" hx-trigger="click, mouseenter">Demo</button>')

    btn.click()
    await forRequest()

    mockResponse('GET', '/test', 'response2')
    btn.dispatchEvent(new Event('mouseenter'))
    await forRequest()

    let calls = fetchMock.getCalls()
    assert.equal(calls.length, 2)
  })

  it('every trigger polls at interval', async function () {
    mockResponse('GET', '/test', 'response')
    createProcessedHTML('<div hx-get="/test" hx-trigger="every 10ms">Demo</div>')
    await htmx.timeout(50)
    let calls = fetchMock.getCalls()
    assert.isAtLeast(calls.length, 2)
  })
})
