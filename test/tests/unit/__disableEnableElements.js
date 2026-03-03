describe('disable/enable element behavior tests', function () {
  beforeEach(function () {
    setupTest()
  })

  afterEach(function () {
    cleanupTest()
  })

  it('disables element during request', async function () {
    mockResponse('GET', '/test', 'response')
    let container = createProcessedHTML(
      '<div><button hx-get="/test" hx-disable=".disable-me">Click</button><input class="disable-me"></div>',
    )
    let input = container.querySelector('input')
    let btn = container.querySelector('button')

    let wasDisabled = false
    btn.addEventListener('htmx:before:request', () => {
      wasDisabled = input.disabled
    })

    btn.click()
    await forRequest()

    assert.isTrue(wasDisabled)
  })

  it('enables element after request completes', async function () {
    mockResponse('GET', '/test', 'response')
    let container = createProcessedHTML(
      '<div><button hx-get="/test" hx-disable=".disable-me">Click</button><input class="disable-me"></div>',
    )
    let input = container.querySelector('input')
    let btn = container.querySelector('button')

    btn.click()
    await forRequest()

    assert.isFalse(input.disabled)
  })

  it('handles multiple disabled elements', async function () {
    mockResponse('GET', '/test', 'response')
    let container = createProcessedHTML(
      '<div><button hx-get="/test" hx-disable=".disable-me">Click</button><input class="disable-me"><select class="disable-me"></select></div>',
    )
    let input = container.querySelector('input')
    let select = container.querySelector('select')
    let btn = container.querySelector('button')

    let inputDisabled = false
    let selectDisabled = false
    btn.addEventListener('htmx:before:request', () => {
      inputDisabled = input.disabled
      selectDisabled = select.disabled
    })

    btn.click()
    await forRequest()

    assert.isTrue(inputDisabled)
    assert.isTrue(selectDisabled)
  })

  it('does not disable when no hx-disable is set', async function () {
    mockResponse('GET', '/test', 'response')
    let container = createProcessedHTML(
      '<div><button hx-get="/test">Click</button><input class="disable-me"></div>',
    )
    let input = container.querySelector('input')
    let btn = container.querySelector('button')

    btn.click()
    await forRequest()

    assert.isFalse(input.disabled)
  })

  it('includes element itself when it matches selector', async function () {
    mockResponse('GET', '/test', 'response')
    let btn = createProcessedHTML(
      '<button class="disable-me" hx-get="/test" hx-disable=".disable-me">Click</button>',
    )

    let wasDisabled = false
    btn.addEventListener('htmx:before:request', () => {
      wasDisabled = btn.disabled
    })

    btn.click()
    await forRequest()

    assert.isTrue(wasDisabled)
  })

  it('re-enables all elements after request completes for nested elements', async function () {
    mockResponse('GET', '/test', 'response')
    let container = createProcessedHTML(
      '<div class="disable-me"><button hx-get="/test" hx-disable=".disable-me">Click</button><input class="disable-me"></div>',
    )
    let outer = container
    let input = container.querySelector('input')
    let btn = container.querySelector('button')

    btn.click()
    await forRequest()

    assert.isFalse(outer.disabled)
    assert.isFalse(input.disabled)
  })
})
