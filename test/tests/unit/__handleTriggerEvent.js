describe('trigger event handling tests', function () {
  beforeEach(function () {
    setupTest()
  })

  afterEach(function () {
    cleanupTest()
  })

  it('does not issue request if element not connected', async function () {
    mockResponse('GET', '/test', 'response')
    let div = createProcessedHTML('<div hx-get="/test"></div>')
    div.remove()

    div.click()
    await new Promise(r => setTimeout(r, 50))

    let calls = fetchMock.getCalls()
    assert.equal(calls.length, 0)
  })

  it('prevents default on anchor click with hx-get', async function () {
    mockResponse('GET', '/test', 'response')
    let link = createProcessedHTML('<a href="/somewhere" hx-get="/test" hx-swap="none">Link</a>')

    let defaultPrevented = false
    link.addEventListener('click', e => {
      defaultPrevented = e.defaultPrevented
    }, { capture: false })

    link.click()
    await forRequest()

    assert.isTrue(defaultPrevented)
  })

  it('resolves hx-target correctly', async function () {
    mockResponse('GET', '/test', '<span>updated</span>')
    createProcessedHTML('<div id="target">original</div><button hx-get="/test" hx-target="#target">Click</button>')
    let button = find('button')

    button.click()
    await forRequest()

    assert.equal(find('#target').innerHTML, '<span>updated</span>')
  })

  it('collects form data from enclosing form for POST', async function () {
    mockResponse('POST', '/test', 'ok')
    let form = createProcessedHTML(
      '<form><input name="field" value="test"><button hx-post="/test" hx-swap="none">Submit</button></form>',
    )
    let button = form.querySelector('button')

    button.click()
    await forRequest()

    let call = lastFetch()
    let params = new URLSearchParams(call.request.body)
    assert.equal(params.get('field'), 'test')
  })

  it('applies hx-vals JSON to request body', async function () {
    mockResponse('POST', '/test', 'ok')
    let div = createProcessedHTML(
      '<div hx-post="/test" hx-swap="none" hx-vals=\'{"extra":"value"}\'>Click</div>',
    )

    div.click()
    await forRequest()

    let call = lastFetch()
    let params = new URLSearchParams(call.request.body)
    assert.equal(params.get('extra'), 'value')
  })

  it('returns early if htmx:before:request cancelled', async function () {
    mockResponse('GET', '/test', 'response')
    let div = createProcessedHTML('<div hx-get="/test" hx-swap="none">Click</div>')
    div.addEventListener('htmx:before:request', e => e.preventDefault())

    div.click()
    await new Promise(r => setTimeout(r, 50))

    let calls = fetchMock.getCalls()
    assert.equal(calls.length, 0)
  })

  it('collects form data for GET when element is a form', async function () {
    mockResponse('GET', /\/test\?.*/, 'ok')
    let form = createProcessedHTML(
      '<form hx-get="/test" hx-swap="none"><input name="q" value="search"><button type="submit">Search</button></form>',
    )

    form.querySelector('button').click()
    await forRequest()

    let call = lastFetch()
    assert.include(call.url, 'q=search')
  })

  it('sends body as URLSearchParams for POST', async function () {
    mockResponse('POST', '/test', 'ok')
    let form = createProcessedHTML(
      '<form><input name="field" value="test"><button hx-post="/test" hx-swap="none">Submit</button></form>',
    )
    let button = form.querySelector('button')

    button.click()
    await forRequest()

    let call = lastFetch()
    assert.isNotNull(call.request.body)
    let params = new URLSearchParams(call.request.body)
    assert.equal(params.get('field'), 'test')
  })

  it('keeps multipart form data as FormData when hx-encoding is set', async function () {
    mockResponse('POST', '/test', 'ok')
    let form = createProcessedHTML(
      '<form><input name="field" value="test"><button hx-post="/test" hx-swap="none" hx-encoding="multipart/form-data">Submit</button></form>',
    )
    let button = form.querySelector('button')

    button.click()
    await forRequest()

    let call = lastFetch()
    assert.instanceOf(call.request.body, FormData)
  })

  it('appends form data to existing query string for GET form', async function () {
    mockResponse('GET', /\/test\?.*/, 'ok')
    let form = createProcessedHTML(
      '<form hx-get="/test?existing=1" hx-swap="none"><input name="new" value="val"><button type="submit">Go</button></form>',
    )

    form.querySelector('button').click()
    await forRequest()

    let call = lastFetch()
    assert.include(call.url, 'existing=1')
    assert.include(call.url, 'new=val')
  })
})
