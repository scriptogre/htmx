describe('HX response header handling tests', function () {
  beforeEach(function () {
    setupTest()
  })

  afterEach(function () {
    cleanupTest()
  })

  it('handles HX-Trigger header by firing event', async function () {
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

  it('handles HX-Retarget header by swapping into different target', async function () {
    mockResponse('GET', '/test', '<span>retargeted</span>', {
      headers: { 'HX-Retarget': '#alt-target' },
    })
    // No hx-target — the default target is the source element, HX-Retarget should override it
    createProcessedHTML(
      '<div id="source" hx-get="/test">original</div><div id="alt-target">alt</div>',
    )
    let source = find('#source')

    source.click()
    await forRequest()

    assert.equal(find('#alt-target').innerHTML, '<span>retargeted</span>')
  })

  it('handles HX-Reswap header by changing swap style', async function () {
    mockResponse('GET', '/test', '<span>appended</span>', {
      headers: { 'HX-Reswap': 'beforeend' },
    })
    let div = createProcessedHTML('<div id="target" hx-get="/test">existing</div>')

    div.click()
    await forRequest()

    assert.include(find('#target').innerHTML, 'existing')
    assert.include(find('#target').innerHTML, '<span>appended</span>')
  })

  it('handles HX-Reselect header by selecting specific content', async function () {
    mockResponse('GET', '/test', '<div id="keep">wanted</div><div id="discard">unwanted</div>', {
      headers: { 'HX-Reselect': '#keep' },
    })
    let div = createProcessedHTML('<div id="target" hx-get="/test">original</div>')

    div.click()
    await forRequest()

    assert.include(find('#target').textContent, 'wanted')
    assert.notInclude(find('#target').textContent, 'unwanted')
  })

  it('does not interfere when no HX headers are present', async function () {
    mockResponse('GET', '/test', 'normal response')
    let div = createProcessedHTML('<div id="target" hx-get="/test">original</div>')

    div.click()
    await forRequest()

    assert.equal(find('#target').textContent, 'normal response')
  })
})
