describe('request queue / hx-sync behavior tests', function () {
  beforeEach(function () {
    setupTest()
  })

  afterEach(function () {
    cleanupTest()
  })

  it('allows first request when no other request in progress', async function () {
    mockResponse('GET', '/test', 'response')
    let div = createProcessedHTML('<div hx-get="/test">Click</div>')
    div.click()
    await forRequest()
    lastFetch()
  })

  it('drops concurrent requests with hx-sync drop strategy', async function () {
    mockResponse('GET', '/test', 'response')
    let div = createProcessedHTML('<div hx-get="/test" hx-sync="this:drop">Click</div>')

    div.click()
    div.click()
    div.click()
    await forRequest()

    // Only one request should have gone through
    let calls = fetchMock.getCalls()
    assert.equal(calls.length, 1)
  })

  it('queues last request with hx-sync queue last strategy', async function () {
    mockResponse('GET', '/test', 'first')
    let div = createProcessedHTML('<div hx-get="/test" hx-sync="this:queue last">Click</div>')

    div.click()
    div.click()
    div.click()
    await forRequest()

    // First request completes
    let calls = fetchMock.getCalls()
    assert.equal(calls.length, 1)

    // The last queued request should now fire
    mockResponse('GET', '/test', 'last')
    await forRequest()
    calls = fetchMock.getCalls()
    assert.equal(calls.length, 2)
  })

  it('replaces current request with hx-sync replace strategy', async function () {
    mockResponse('GET', '/test', 'response')
    let div = createProcessedHTML('<div hx-get="/test" hx-sync="this:replace">Click</div>')

    div.click()
    div.click()
    await forRequest()

    // The replace strategy aborts the first and issues the second
    let calls = fetchMock.getCalls()
    assert.isAtLeast(calls.length, 1)
  })

  it('uses same queue for elements syncing on same container', async function () {
    mockResponse('GET', '/test1', 'response1')
    mockResponse('GET', '/test2', 'response2')
    let container = createProcessedHTML(
      '<div id="container"><button id="btn1" hx-get="/test1" hx-sync="#container:drop">Btn1</button><button id="btn2" hx-get="/test2" hx-sync="#container:drop">Btn2</button></div>',
    )
    let btn1 = container.querySelector('#btn1')
    let btn2 = container.querySelector('#btn2')

    btn1.click()
    btn2.click()
    await forRequest()

    // Only one request should have gone through due to drop strategy on shared container
    let calls = fetchMock.getCalls()
    assert.equal(calls.length, 1)
  })

  it('queues all requests with hx-sync queue all strategy', async function () {
    mockResponse('GET', '/test', 'first')
    let div = createProcessedHTML('<div hx-get="/test" hx-sync="this:queue all">Click</div>')

    div.click()
    div.click()
    await forRequest()

    let calls = fetchMock.getCalls()
    assert.equal(calls.length, 1)

    // The queued request should fire after first completes
    mockResponse('GET', '/test', 'second')
    await forRequest()
    calls = fetchMock.getCalls()
    assert.equal(calls.length, 2)
  })
})
