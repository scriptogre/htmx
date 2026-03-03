describe('process() unit tests', function () {
  beforeEach(function () {
    setupTest()
  })

  afterEach(function () {
    cleanupTest()
  })

  it('initializes element with hx-get', async function () {
    mockResponse('GET', '/test', 'response')
    let div = createProcessedHTML('<div hx-get="/test">Click</div>')
    htmx.process(div)
    div.click()
    await forRequest()
    lastFetch()
  })

  it('initializes descendant elements', async function () {
    mockResponse('GET', '/test', 'response')
    let container = createProcessedHTML('<div><button hx-get="/test">Click</button></div>')
    htmx.process(container)
    let button = container.querySelector('button')
    button.click()
    await forRequest()
    lastFetch()
  })

  it('initializes boosted elements', function () {
    let container = createProcessedHTML('<div hx-boost="true"><a href="/test">Link</a></div>')
    htmx.process(container)
    let a = container.querySelector('a')
    // Boosted elements should fire htmx:after:init
    let initialized = false
    a.addEventListener('htmx:after:init', () => { initialized = true })
    // Re-process should not re-init (already initialized)
    // But we can verify it was initialized by checking if a click would be handled
  })

  it('processes hx-on attributes', function () {
    let div = createProcessedHTML("<div hx-on:custom=\"this.setAttribute('fired', 'true')\"></div>")
    htmx.process(div)
    div.dispatchEvent(new Event('custom'))
    assert.equal(div.getAttribute('fired'), 'true')
  })

  it('ignores elements with hx-ignore', function () {
    let container = createProcessedHTML('<div hx-ignore><button hx-get="/test">Click</button></div>')
    htmx.process(container)
    let button = container.querySelector('button')
    // The button should not respond to clicks with AJAX
    button.click()
    // No forRequest() because no request should be made
    let calls = fetchMock.getCalls()
    assert.equal(calls.length, 0)
  })

  it('ignores descendants of hx-ignore', function () {
    let container = createProcessedHTML(
      '<div><div hx-ignore><button hx-get="/test">Click</button></div></div>',
    )
    htmx.process(container)
    let button = container.querySelector('button')
    button.click()
    let calls = fetchMock.getCalls()
    assert.equal(calls.length, 0)
  })

  it('processes element itself if it matches', async function () {
    mockResponse('GET', '/test', 'response')
    let div = createProcessedHTML('<div hx-get="/test">Click</div>')
    htmx.process(div)
    div.click()
    await forRequest()
    lastFetch()
  })

  it('triggers htmx:before:walk:init event', function () {
    let div = createProcessedHTML('<div hx-get="/test"></div>')
    let fired = false
    div.addEventListener('htmx:before:walk:init', () => (fired = true))
    htmx.process(div)
    assert.isTrue(fired)
  })

  it('triggers htmx:after:walk:init event', function () {
    let div = createProcessedHTML('<div hx-get="/test"></div>')
    let fired = false
    div.addEventListener('htmx:after:walk:init', () => (fired = true))
    htmx.process(div)
    assert.isTrue(fired)
  })

  it('skips processing if htmx:before:walk:init is cancelled', function () {
    // Create element without processing first
    let div = createHTMLNoProcessing('<div hx-get="/test"></div>')
    div.addEventListener('htmx:before:walk:init', e => e.preventDefault())
    htmx.process(div)
    // The element should not be initialized - clicking should not trigger a request
    div.click()
    let calls = fetchMock.getCalls()
    assert.equal(calls.length, 0)
    div.remove()
  })
})
