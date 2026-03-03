describe('HX header extraction tests', function () {
  beforeEach(function () {
    setupTest()
  })

  afterEach(function () {
    cleanupTest()
  })

  it('extracts HX-Trigger header from response', async function () {
    mockResponse('GET', '/test', 'ok', {
      headers: { 'HX-Trigger': 'myEvent' },
    })
    let div = createProcessedHTML('<div hx-get="/test" hx-swap="none">Click</div>')

    let triggerFired = false
    div.addEventListener('myEvent', () => {
      triggerFired = true
    })

    div.click()
    await forRequest()

    assert.isTrue(triggerFired)
  })

  it('extracts HX headers and exposes them on htmx:after:request detail', async function () {
    mockResponse('GET', '/test', 'ok', {
      headers: { 'HX-Trigger': 'myEvent', 'HX-Reswap': 'outerHTML' },
    })
    let div = createProcessedHTML('<div hx-get="/test" hx-swap="none">Click</div>')

    let hxDetails = null
    div.addEventListener('htmx:after:request', e => {
      hxDetails = e.detail.hx
    })

    div.click()
    await forRequest()

    assert.isNotNull(hxDetails)
    assert.equal(hxDetails.trigger, 'myEvent')
    assert.equal(hxDetails.reswap, 'outerHTML')
  })

  it('does not extract non-HX headers', async function () {
    mockResponse('GET', '/test', 'ok', {
      headers: {
        'HX-Trigger': 'myEvent',
        'X-Custom-Header': 'value',
      },
    })
    let div = createProcessedHTML('<div hx-get="/test" hx-swap="none">Click</div>')

    let hxDetails = null
    div.addEventListener('htmx:after:request', e => {
      hxDetails = e.detail.hx
    })

    div.click()
    await forRequest()

    assert.isNotNull(hxDetails)
    assert.equal(hxDetails.trigger, 'myEvent')
    assert.isUndefined(hxDetails['custom-header'])
  })

  it('handles responses with no HX headers', async function () {
    mockResponse('GET', '/test', 'ok')
    let div = createProcessedHTML('<div hx-get="/test" hx-swap="none">Click</div>')

    let afterRequestFired = false
    div.addEventListener('htmx:after:request', e => {
      afterRequestFired = true
    })

    div.click()
    await forRequest()

    assert.isTrue(afterRequestFired)
  })

  it('extracts HX-Retarget header from response', async function () {
    mockResponse('GET', '/test', '<span>content</span>', {
      headers: { 'HX-Retarget': '#other' },
    })
    createProcessedHTML('<div id="other"></div><div id="target" hx-get="/test">original</div>')
    let div = find('#target')

    let hxDetails = null
    div.addEventListener('htmx:after:request', e => {
      hxDetails = e.detail.hx
    })

    div.click()
    await forRequest()

    assert.isNotNull(hxDetails)
    assert.equal(hxDetails.retarget, '#other')
  })

  // TODO: Testing HX-Redirect extraction causes actual page navigation because
  // the responseHeaders extension sets location.href before DOM event listeners
  // can preventDefault. This test would need a way to mock location.href in the
  // test environment.
  it.skip('extracts HX-Redirect header from response and exposes it on detail', async function () {
    // Cannot test without causing page navigation
  })
})
