describe('indicator show/hide behavior tests', function () {
  beforeEach(function () {
    setupTest()
  })

  afterEach(function () {
    cleanupTest()
  })

  it('shows indicator by adding request class during request', async function () {
    mockResponse('GET', '/test', 'response')
    let container = createProcessedHTML(
      '<div><button hx-get="/test" hx-indicator=".indicator">Click</button><span class="indicator"></span></div>',
    )
    let span = container.querySelector('span')
    let btn = container.querySelector('button')

    let indicatorShown = false
    btn.addEventListener('htmx:before:request', () => {
      indicatorShown = span.classList.contains('htmx-request')
    })

    btn.click()
    await forRequest()

    assert.isTrue(indicatorShown)
  })

  it('hides indicator by removing request class after request completes', async function () {
    mockResponse('GET', '/test', 'response')
    let container = createProcessedHTML(
      '<div><button hx-get="/test" hx-indicator=".indicator">Click</button><span class="indicator"></span></div>',
    )
    let span = container.querySelector('span')
    let btn = container.querySelector('button')

    btn.click()
    await forRequest()

    assert.isFalse(span.classList.contains('htmx-request'))
  })

  it('handles multiple indicators', async function () {
    mockResponse('GET', '/test', 'response')
    let container = createProcessedHTML(
      '<div><button hx-get="/test" hx-indicator=".indicator">Click</button><span class="indicator"></span><div class="indicator"></div></div>',
    )
    let span = container.querySelector('span')
    let innerDiv = container.querySelector('div.indicator')
    let btn = container.querySelector('button')

    let spanShown = false
    let divShown = false
    btn.addEventListener('htmx:before:request', () => {
      spanShown = span.classList.contains('htmx-request')
      divShown = innerDiv.classList.contains('htmx-request')
    })

    btn.click()
    await forRequest()

    assert.isTrue(spanShown)
    assert.isTrue(divShown)
  })

  it('does not show indicator when no hx-indicator is set', async function () {
    mockResponse('GET', '/test', 'response')
    let container = createProcessedHTML(
      '<div><button hx-get="/test">Click</button><span class="indicator"></span></div>',
    )
    let span = container.querySelector('span')
    let btn = container.querySelector('button')

    btn.click()
    await forRequest()

    assert.isFalse(span.classList.contains('htmx-request'))
  })

  it('includes element itself in indicators', async function () {
    mockResponse('GET', '/test', 'response')
    let div = createProcessedHTML(
      '<div class="indicator" hx-get="/test" hx-indicator=".indicator">Click</div>',
    )

    let indicatorShown = false
    div.addEventListener('htmx:before:request', () => {
      indicatorShown = div.classList.contains('htmx-request')
    })

    div.click()
    await forRequest()

    assert.isTrue(indicatorShown)
  })

  it('removes class after request completes for nested indicators', async function () {
    mockResponse('GET', '/test', 'response')
    let container = createProcessedHTML(
      '<div class="indicator"><button hx-get="/test" hx-indicator=".indicator">Click</button><span class="indicator"></span></div>',
    )
    let outer = container
    let inner = container.querySelector('span')
    let btn = container.querySelector('button')

    btn.click()
    await forRequest()

    assert.isFalse(outer.classList.contains('htmx-request'))
    assert.isFalse(inner.classList.contains('htmx-request'))
  })
})
