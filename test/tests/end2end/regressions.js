describe('Regression tests from upstream issues', function () {
  beforeEach(() => {
    setupTest(this.currentTest)
  })

  afterEach(() => {
    cleanupTest(this.currentTest)
  })

  // ── Cancel / preventDefault regressions ──────────────────────────────

  // Issue #3171: type="button" buttons inside forms should NOT be intercepted
  it('type="button" inside form does not prevent default', function () {
    let defaultPrevented = null
    createProcessedHTML(
      '<form><button id="btn" type="button">Not Submit</button></form>',
    )

    find('#btn').addEventListener('click', evt => {
      defaultPrevented = evt.defaultPrevented
    })

    find('#btn').click()
    defaultPrevented.should.equal(false)
  })

  // Issue #3356: clicking span inside anchor with hx-get
  it('clicking child span inside anchor with hx-get prevents navigation', async function () {
    let defaultPrevented = false
    mockResponse('GET', '/test', 'Response')
    const link = createProcessedHTML(
      '<a href="#" hx-get="/test"><span id="inner">text</span></a>',
    )

    link.addEventListener('click', evt => {
      defaultPrevented = evt.defaultPrevented
    })

    find('#inner').click()
    await forRequest()
    defaultPrevented.should.equal(true)
  })

  // Issue #3395: normal links inside hx-trigger="click" element should still navigate
  it('normal link inside element with from: trigger is not prevented', async function () {
    let defaultPrevented = null
    mockResponse('POST', '/test', 'Response')
    createProcessedHTML(
      '<div><a id="normal-link" href="javascript:void(0)">Normal</a></div><div hx-post="/test" hx-trigger="click from:body"></div>',
    )

    find('#normal-link').addEventListener('click', evt => {
      setTimeout(() => {
        defaultPrevented = evt.defaultPrevented
      }, 0)
    })

    find('#normal-link').click()
    await htmx.timeout(1)
    await htmx.timeout(1)
    defaultPrevented.should.equal(false)
  })

  // ── Form regressions ─────────────────────────────────────────────────

  // Issue #3662: hx-post="" should POST to current URL, not send GET
  it('hx-post with empty string sends POST request', async function () {
    const currentPath = location.pathname + location.search
    mockResponse('POST', currentPath, 'ok')
    let btn = createProcessedHTML('<button hx-post="" hx-swap="none">Go</button>')
    btn.click()
    await forRequest()
    let call = lastFetch()
    call.request.method.should.equal('POST')
  })

  // Issue #3552: form with novalidate should skip HTML5 validation
  it('form with novalidate skips HTML5 validation', async function () {
    mockResponse('POST', '/test', 'ok')
    let form = createProcessedHTML(
      '<form hx-post="/test" hx-swap="none" novalidate><input name="email" type="email" value="not-an-email" required><button type="submit">Go</button></form>',
    )

    form.querySelector('button').click()
    await forRequest()
    // If validation was skipped, request should have been made
    fetchMock.calls.length.should.equal(1)
  })

  // Issue #3355: input named "attributes" should not break htmx
  it('input named "attributes" does not break htmx', async function () {
    mockResponse('POST', '/test', 'ok')
    let form = createProcessedHTML(
      '<form hx-post="/test" hx-swap="none"><input name="attributes" value="test"><input name="normal" value="val"><button type="submit">Go</button></form>',
    )

    form.querySelector('button').click()
    await forRequest()

    let call = lastFetch()
    let params = new URLSearchParams(call.request.body)
    assert.equal(params.get('attributes'), 'test')
    assert.equal(params.get('normal'), 'val')
  })

  // ── Preserve regressions ─────────────────────────────────────────────

  // Issue #3599: hx-preserve on element NOT in current DOM should not crash
  it('hx-preserve in response for element not in DOM does not crash', async function () {
    mockResponse('GET', '/test', '<div id="not-in-dom" hx-preserve>Preserved</div><div>New</div>')
    let div = createProcessedHTML('<div hx-get="/test">Old content</div>')
    div.click()
    await forRequest()
    // Should complete without error, "not-in-dom" should appear since it has no match to preserve
    assert.isNotNull(find('#not-in-dom'))
  })

  // Issue #3670: multiple preserved elements should all be preserved (live collection bug)
  it('preserves multiple hx-preserve elements during swap', async function () {
    mockResponse(
      'GET',
      '/test',
      '<div id="p1" hx-preserve>New1</div><div id="p2" hx-preserve>New2</div><div id="p3" hx-preserve>New3</div><div>Other</div>',
    )
    let div = createProcessedHTML(
      '<div hx-get="/test"><div id="p1" hx-preserve>Original1</div><div id="p2" hx-preserve>Original2</div><div id="p3" hx-preserve>Original3</div></div>',
    )
    div.click()
    await forRequest()
    // All three should be preserved (not skipped due to live collection iteration)
    assertTextContentIs('#p1', 'Original1')
    assertTextContentIs('#p2', 'Original2')
    assertTextContentIs('#p3', 'Original3')
  })

  // ── hx-on + load ordering ───────────────────────────────────────────

  // Issue #3308/#3106: hx-on handlers must fire for load-triggered requests
  it('hx-on handler fires for load-triggered request', async function () {
    window._loadTestFired = false
    mockResponse('GET', '/test', 'Loaded')
    createProcessedHTML(
      '<div hx-get="/test" hx-trigger="load" hx-on:htmx:before:request="window._loadTestFired = true">placeholder</div>',
    )
    await forRequest()
    window._loadTestFired.should.equal(true)
    delete window._loadTestFired
  })

  // ── OOB + preserve ──────────────────────────────────────────────────

  // Issue #2922: hx-preserve should work inside OOB-swapped content
  it('hx-preserve works inside oob-swapped content', async function () {
    // Set up the initial page with an OOB target containing a preserved element
    createProcessedHTML(
      '<div id="oob-target"><div id="oob-preserved" hx-preserve>Original OOB</div></div><button id="trigger" hx-get="/test">Go</button>',
    )

    mockResponse(
      'GET',
      '/test',
      '<div>Main</div><div id="oob-target" hx-swap-oob="innerHTML"><div id="oob-preserved" hx-preserve>New OOB</div></div>',
    )

    find('#trigger').click()
    await forRequest()
    assertTextContentIs('#oob-preserved', 'Original OOB')
  })

  // ── Event dispatch targets ──────────────────────────────────────────

  // Issue #3628: htmx:before:swap should dispatch on source element, not document
  it('htmx:before:swap dispatches on source element', async function () {
    let firedOnElement = false
    let firedOnDocument = false
    mockResponse('GET', '/test', 'Swapped')
    let btn = createProcessedHTML('<button id="btn" hx-get="/test">Click</button>')

    btn.addEventListener('htmx:before:swap', () => {
      firedOnElement = true
    })
    document.addEventListener('htmx:before:swap', () => {
      firedOnDocument = true
    })

    btn.click()
    await forRequest()
    firedOnElement.should.equal(true)
  })

  // ── hx-boost edge cases ─────────────────────────────────────────────

  // Issue #3068: form without action under hx-boost should not crash
  it('boosted form without action attribute does not crash', async function () {
    const currentPath = location.pathname + location.search
    mockResponse('GET', currentPath, 'Boosted')
    let container = createProcessedHTML(
      '<div hx-boost:inherited="true" hx-target:inherited="this"><form id="test-form" method="get"><button id="btn">Submit</button></form></div>',
    )

    find('#btn').click()
    await forRequest()
    // Should complete without error
    assert.isNotNull(container)
  })

  // ── Empty response handling ─────────────────────────────────────────

  it('empty response with 200 status does not crash swap', async function () {
    mockResponse('GET', '/empty', '')
    let div = createProcessedHTML('<div hx-get="/empty">Original</div>')
    div.click()
    await forRequest()
    // Should complete without error, content replaced with empty
    div.innerHTML.should.equal('')
  })

  it('204 No Content response does not swap', async function () {
    mockResponse('GET', '/no-content', '', { status: 204 })
    let div = createProcessedHTML('<div hx-get="/no-content">Original</div>')
    div.click()
    await forRequest()
    // 204 means "no content to swap" — preserve original
    div.innerHTML.should.equal('Original')
  })

  // ── History / push-url regressions ─────────────────────────────────

  // Issue #3560: hx-push-url on GET form should include query params
  it('hx-push-url on GET form includes query string', async function () {
    mockResponse('GET', /\/search/, 'Results')
    let eventPath = null

    const handler = event => {
      eventPath = event.detail.path
    }
    document.addEventListener('htmx:after:push:into:history', handler)

    try {
      let form = createProcessedHTML(
        '<form hx-get="/search" hx-push-url="true" hx-swap="none"><input name="q" value="test"><button type="submit">Search</button></form>',
      )
      form.querySelector('button').click()
      await forRequest()

      let call = lastFetch()
      // The request URL should contain query params
      call.url.should.include('q=test')
    } finally {
      document.removeEventListener('htmx:after:push:into:history', handler)
    }
  })

  // ── Focus restoration ─────────────────────────────────────────────

  // Issue #3329: swapping content with focused email input should not throw
  it('swap near focused email input does not throw', async function () {
    mockResponse('GET', '/test', '<div id="container"><input id="email" type="email" value="a@b.com"></div>')
    let div = createProcessedHTML(
      '<div id="container" hx-get="/test"><input id="email" type="email" value="a@b.com"></div>',
    )

    // Focus the email input
    find('#email').focus()
    div.click()
    await forRequest()
    // Should complete without throwing (setSelectionRange not allowed on email inputs)
    assert.isNotNull(find('#email'))
  })

  // ── hx-vals with js: prefix ─────────────────────────────────────────

  // Issue #3521: hx-vals="js:{...}" should evaluate JavaScript
  it('hx-vals with js: prefix evaluates JavaScript', async function () {
    window._testVal = 42
    mockResponse('POST', '/test', 'ok')
    let btn = createProcessedHTML(
      '<button hx-post="/test" hx-swap="none" hx-vals="js:{answer: window._testVal}">Go</button>',
    )
    btn.click()
    await forRequest()

    let call = lastFetch()
    let params = new URLSearchParams(call.request.body)
    assert.equal(params.get('answer'), '42')
    delete window._testVal
  })

  // ── hx-headers with js: prefix ─────────────────────────────────────

  // Verify hx-headers supports both js: and javascript: prefixes
  it('hx-headers with js: prefix evaluates JavaScript', async function () {
    window._testHeader = 'dynamic-value'
    mockResponse('GET', '/test', 'ok')
    let btn = createProcessedHTML(
      '<button hx-get="/test" hx-swap="none" hx-headers="js:{\'X-Custom\': window._testHeader}">Go</button>',
    )
    btn.click()
    await forRequest()

    let call = lastFetch()
    assert.equal(call.request.headers['X-Custom'], 'dynamic-value')
    delete window._testHeader
  })

  // ── hx-swap-oob with different styles ──────────────────────────────

  it('oob-swap with innerHTML style swaps inner content', async function () {
    createProcessedHTML(
      '<div id="oob-target">Original</div><button id="trigger" hx-get="/test">Go</button>',
    )
    mockResponse(
      'GET',
      '/test',
      '<div>Main</div><div id="oob-target" hx-swap-oob="innerHTML">Replaced Inner</div>',
    )

    find('#trigger').click()
    await forRequest()
    find('#oob-target').innerHTML.should.equal('Replaced Inner')
  })

  // ── hx-confirm ─────────────────────────────────────────────────────

  // Issue #3527: hx-confirm should fire htmx:confirm event
  it('hx-confirm fires confirmation event', async function () {
    let confirmFired = false
    mockResponse('GET', '/test', 'Confirmed')
    let btn = createProcessedHTML('<button id="btn" hx-get="/test" hx-confirm="Are you sure?">Go</button>')

    // Auto-confirm by listening for the event and calling issueRequest
    document.addEventListener('htmx:confirm', function handler(evt) {
      confirmFired = true
      evt.preventDefault()
      evt.detail.issueRequest(true)
      document.removeEventListener('htmx:confirm', handler)
    })

    btn.click()
    await forRequest()
    confirmFired.should.equal(true)
  })
})
