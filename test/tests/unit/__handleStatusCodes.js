describe('status code handling tests', function () {
  beforeEach(function () {
    setupTest()
  })

  afterEach(function () {
    cleanupTest()
  })

  it('sets swap to none for 204 status', async function () {
    mockResponse('GET', '/test', '', { status: 204 })
    let div = createProcessedHTML('<div id="target" hx-get="/test">Original</div>')

    div.click()
    await forRequest()

    // 204 should not swap any content
    assert.equal(find('#target').textContent, 'Original')
  })

  it('does not change swap for 200 status', async function () {
    mockResponse('GET', '/test', 'Updated')
    let div = createProcessedHTML('<div id="target" hx-get="/test">Original</div>')

    div.click()
    await forRequest()

    assert.equal(find('#target').textContent, 'Updated')
  })

  // TODO: hx-status:NNN attribute is not yet implemented in the kernel+core architecture.
  // The following tests are skipped until hx-status support is added.

  it.skip('applies hx-status:404 override', async function () {
    mockResponse('GET', '/test', '<div id="result">Error</div>', { status: 404 })
    createProcessedHTML(
      '<div id="target">Original</div><button hx-get="/test" hx-target="#target" hx-status:404="swap:outerHTML">Click</button>',
    )
    let button = find('button')
    button.click()
    await forRequest()
    assert.isUndefined(find('#target'))
    assert.equal(find('#result').innerText, 'Error')
  })

  it.skip('applies hx-status:4xx pattern match', async function () {
    mockResponse('GET', '/test', '<div>Forbidden</div>', { status: 403 })
    createProcessedHTML(
      '<div id="target">Original</div><button hx-get="/test" hx-target="#target" hx-status:4xx="swap:delete">Click</button>',
    )
    let button = find('button')
    button.click()
    await forRequest()
  })

  it.skip('applies hx-status:5xx pattern match', async function () {
    mockResponse('GET', '/test', '<div>Server Error</div>', { status: 500 })
    createProcessedHTML(
      '<div id="target">Original</div><button hx-get="/test" hx-target="#target" hx-status:5xx="swap:none">Click</button>',
    )
    let button = find('button')
    button.click()
    await forRequest()
    assert.equal(find('#target').textContent, 'Original')
  })

  it.skip('prefers exact match over pattern match', async function () {
    mockResponse('GET', '/test', '<div id="result">Error</div>', { status: 404 })
    createProcessedHTML(
      '<div id="target">Original</div><button hx-get="/test" hx-target="#target" hx-status:404="swap:outerHTML" hx-status:4xx="swap:delete">Click</button>',
    )
    let button = find('button')
    button.click()
    await forRequest()
  })

  it.skip('parses target modifier in hx-status value', async function () {
    mockResponse('GET', '/test', '<span>Not Found</span>', { status: 404 })
    createProcessedHTML(
      '<div id="error-target"></div><div id="target">Original</div><button hx-get="/test" hx-target="#target" hx-status:4xx="swap:innerHTML target:#error-target">Click</button>',
    )
    let button = find('button')
    button.click()
    await forRequest()
    assert.equal(find('#error-target').innerText, 'Not Found')
  })

  it.skip('can set multiple ctx properties with hx-status', async function () {
    mockResponse('GET', '/test', '<div id="error">Invalid</div>', { status: 500 })
    createProcessedHTML(
      '<div id="target">Original</div><button hx-get="/test" hx-target="#target" hx-status:500="swap:none select:#error push:false">Click</button>',
    )
    let button = find('button')
    button.click()
    await forRequest()
    assert.equal(find('#target').textContent, 'Original')
  })
})
