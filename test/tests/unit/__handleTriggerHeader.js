describe('HX-Trigger response header tests', function () {
  beforeEach(function () {
    setupTest()
  })

  afterEach(function () {
    cleanupTest()
  })

  it('triggers single event from simple string', async function () {
    mockResponse('GET', '/test', 'ok', {
      headers: { 'HX-Trigger': 'myEvent' },
    })
    let div = createProcessedHTML('<div hx-get="/test" hx-swap="none">Click</div>')

    let eventFired = false
    div.addEventListener('myEvent', () => {
      eventFired = true
    })

    div.click()
    await forRequest()

    assert.isTrue(eventFired)
  })

  it('triggers event with detail from JSON object', async function () {
    mockResponse('GET', '/test', 'ok', {
      headers: { 'HX-Trigger': '{"myEvent": {"key": "value", "num": 42}}' },
    })
    let div = createProcessedHTML('<div hx-get="/test" hx-swap="none">Click</div>')

    let eventDetail = null
    div.addEventListener('myEvent', e => {
      eventDetail = e.detail
    })

    div.click()
    await forRequest()

    assert.isNotNull(eventDetail)
    assert.equal(eventDetail.key, 'value')
    assert.equal(eventDetail.num, 42)
  })

  it('triggers multiple events from JSON object', async function () {
    mockResponse('GET', '/test', 'ok', {
      headers: {
        'HX-Trigger': '{"event1": {"data": "first"}, "event2": {"data": "second"}}',
      },
    })
    let div = createProcessedHTML('<div hx-get="/test" hx-swap="none">Click</div>')

    let event1Detail = null
    let event2Detail = null
    div.addEventListener('event1', e => {
      event1Detail = e.detail
    })
    div.addEventListener('event2', e => {
      event2Detail = e.detail
    })

    div.click()
    await forRequest()

    assert.isNotNull(event1Detail)
    assert.equal(event1Detail.data, 'first')
    assert.isNotNull(event2Detail)
    assert.equal(event2Detail.data, 'second')
  })

  it('triggers event on source element', async function () {
    mockResponse('GET', '/test', 'ok', {
      headers: { 'HX-Trigger': 'myEvent' },
    })
    let div = createProcessedHTML('<div id="source" hx-get="/test" hx-swap="none">Click</div>')

    let eventTarget = null
    div.addEventListener('myEvent', e => {
      eventTarget = e.target
    })

    div.click()
    await forRequest()

    assert.equal(eventTarget, div)
  })

  it('does not fire trigger event when no HX-Trigger header', async function () {
    mockResponse('GET', '/test', 'ok')
    let div = createProcessedHTML('<div hx-get="/test" hx-swap="none">Click</div>')

    let eventFired = false
    div.addEventListener('myEvent', () => {
      eventFired = true
    })

    div.click()
    await forRequest()

    assert.isFalse(eventFired)
  })
})
