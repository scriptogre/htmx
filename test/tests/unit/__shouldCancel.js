describe('event cancellation behavior tests', function () {
  beforeEach(function () {
    setupTest()
  })

  afterEach(function () {
    cleanupTest()
  })

  it('anchor with href cancels click default when boosted', async function () {
    mockResponse('GET', '/foo', 'response')
    let container = createProcessedHTML('<div hx-boost="true"><a href="/foo">Link</a></div>')
    let link = container.querySelector('a')
    let defaultPrevented = false
    link.addEventListener('click', e => { defaultPrevented = e.defaultPrevented }, { capture: false })
    link.click()
    await forRequest()
    assert.isTrue(defaultPrevented)
  })

  it('anchor with hx-get cancels click default', async function () {
    mockResponse('GET', '/foo', 'response')
    let link = createProcessedHTML('<a href="/foo" hx-get="/foo">Link</a>')
    let defaultPrevented = false
    link.addEventListener('click', e => { defaultPrevented = e.defaultPrevented }, { capture: false })
    link.click()
    await forRequest()
    assert.isTrue(defaultPrevented)
  })

  it('form with hx-post cancels submit default', async function () {
    mockResponse('POST', '/submit', 'response')
    let form = createProcessedHTML('<form hx-post="/submit"><button type="submit">Submit</button></form>')
    let defaultPrevented = false
    form.addEventListener('submit', e => { defaultPrevented = e.defaultPrevented }, { capture: false })
    form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))
    await forRequest()
    assert.isTrue(defaultPrevented)
  })

  it('div with hx-get cancels click default', async function () {
    mockResponse('GET', '/test', 'response')
    let div = createProcessedHTML('<div hx-get="/test">Click</div>')
    let defaultPrevented = false
    div.addEventListener('click', e => { defaultPrevented = e.defaultPrevented }, { capture: false })
    div.click()
    await forRequest()
    assert.isTrue(defaultPrevented)
  })

  it('boosted form submit cancels default', async function () {
    mockResponse('POST', '/submit', 'response')
    let container = createProcessedHTML(
      '<div hx-boost="true"><form method="post" action="/submit"><button type="submit">Submit</button></form></div>',
    )
    let form = container.querySelector('form')
    let defaultPrevented = false
    form.addEventListener('submit', e => { defaultPrevented = e.defaultPrevented }, { capture: false })
    form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))
    await forRequest()
    assert.isTrue(defaultPrevented)
  })
})
