describe('Strip Modifier', function () {
  beforeEach(function () {
    setupTest(this.currentTest)
  })

  afterEach(function () {
    cleanupTest()
  })

  // ========================================================================
  // Main Swap Tests
  // ========================================================================

  it('Main swap with strip:true extracts children', async function () {
    mockResponse('GET', '/api', '<wrapper><p>A</p><p>B</p></wrapper>')
    createProcessedHTML(
      '<button id="btn" hx-get="/api" hx-target="#target" hx-swap="innerHTML strip:true">Get</button><div id="target"></div>',
    )
    find('#btn').click()
    await forRequest()

    // Should have both paragraphs, no wrapper
    const target = find('#target')
    assert.equal(target.children.length, 2)
    assert.equal(target.children[0].tagName, 'P')
    assert.equal(target.children[0].textContent, 'A')
    assert.equal(target.children[1].tagName, 'P')
    assert.equal(target.children[1].textContent, 'B')
    assert.isNull(find('#target wrapper'))
  })

  it('Main swap with strip:false keeps wrapper', async function () {
    mockResponse('GET', '/api', '<wrapper><p>A</p><p>B</p></wrapper>')
    createProcessedHTML(
      '<button id="btn" hx-get="/api" hx-target="#target" hx-swap="innerHTML strip:false">Get</button><div id="target"></div>',
    )
    find('#btn').click()
    await forRequest()

    // Should have wrapper
    const wrapper = find('#target wrapper')
    assert.exists(wrapper)
    assert.equal(wrapper.children.length, 2)
  })

  it('Main swap without strip modifier keeps wrapper (default)', async function () {
    mockResponse('GET', '/api', '<wrapper><p>A</p><p>B</p></wrapper>')
    createProcessedHTML(
      '<button id="btn" hx-get="/api" hx-target="#target" hx-swap="innerHTML">Get</button><div id="target"></div>',
    )
    find('#btn').click()
    await forRequest()

    // Should have wrapper (default is no strip)
    const wrapper = find('#target wrapper')
    assert.exists(wrapper)
  })

  // ========================================================================
  // hx-select Tests
  // ========================================================================

  it('hx-select with strip:true extracts children', async function () {
    mockResponse('GET', '/api', '<div class="content"><span>X</span><span>Y</span></div>')
    createProcessedHTML(
      '<button id="btn" hx-get="/api" hx-target="#target" hx-select=".content" hx-swap="innerHTML strip:true">Get</button><div id="target"></div>',
    )
    find('#btn').click()
    await forRequest()

    const target = find('#target')
    assert.equal(target.children.length, 2)
    assert.equal(target.children[0].tagName, 'SPAN')
    assert.isNull(find('#target .content'))
  })

  it('hx-select with default keeps selected element', async function () {
    mockResponse('GET', '/api', '<div class="content"><span>X</span><span>Y</span></div>')
    createProcessedHTML(
      '<button id="btn" hx-get="/api" hx-target="#target" hx-select=".content">Get</button><div id="target"></div>',
    )
    find('#btn').click()
    await forRequest()

    const content = find('#target .content')
    assert.exists(content)
    assert.equal(content.children.length, 2)
  })

  // ========================================================================
  // OOB Swap Tests
  // ========================================================================

  it('OOB innerHTML swaps inner content', async function () {
    mockResponse(
      'GET', '/api',
      '<div id="main">Main</div><div id="oob" hx-swap-oob="innerHTML"><p>OOB A</p><p>OOB B</p></div>',
    )
    createProcessedHTML(
      '<button id="btn" hx-get="/api" hx-target="#main">Get</button><div id="oob">Original</div>',
    )
    find('#btn').click()
    await forRequest()

    const oob = find('#oob')
    assert.equal(oob.children.length, 2)
    assert.equal(oob.children[0].tagName, 'P')
    assert.equal(oob.children[0].textContent, 'OOB A')
  })

  it('OOB innerHTML with target selector', async function () {
    mockResponse(
      'GET', '/api',
      '<div id="main">Main</div><div hx-swap-oob="innerHTML:#oob"><p>OOB A</p><p>OOB B</p></div>',
    )
    createProcessedHTML(
      '<button id="btn" hx-get="/api" hx-target="#main">Get</button><div id="oob">Original</div>',
    )
    find('#btn').click()
    await forRequest()

    const oob = find('#oob')
    assert.equal(oob.children.length, 2)
    assert.equal(oob.children[0].tagName, 'P')
  })

  it('OOB outerHTML keeps wrapper by default', async function () {
    mockResponse(
      'GET', '/api',
      '<div id="main">Main</div><div id="target" hx-swap-oob="true"><section>A</section><section>B</section></div>',
    )
    createProcessedHTML(
      '<button id="btn" hx-get="/api" hx-target="#main">Get</button><div id="target">Old</div>',
    )
    find('#btn').click()
    await forRequest()

    const target = find('#target')
    assert.exists(target)
    assert.equal(target.children.length, 2)
  })

  // ========================================================================
  // Partial Tests
  // ========================================================================

  it('Partial with strip:true extracts children', async function () {
    mockResponse(
      'GET', '/api',
      '<div id="main">Main</div><hx-partial hx-target="#target" hx-swap="innerHTML strip:true"><wrapper><span>A</span><span>B</span></wrapper></hx-partial>',
    )
    createProcessedHTML(
      '<button id="btn" hx-get="/api" hx-target="#main">Get</button><div id="target">Original</div>',
    )
    find('#btn').click()
    await forRequest()

    const target = find('#target')
    assert.equal(target.children.length, 2)
    assert.equal(target.children[0].tagName, 'SPAN')
    assert.isNull(find('#target wrapper'))
  })

  it('Partial with strip:false keeps wrapper', async function () {
    mockResponse(
      'GET', '/api',
      '<div id="main">Main</div><hx-partial hx-target="#target" hx-swap="innerHTML strip:false"><wrapper><span>A</span><span>B</span></wrapper></hx-partial>',
    )
    createProcessedHTML(
      '<button id="btn" hx-get="/api" hx-target="#main">Get</button><div id="target">Original</div>',
    )
    find('#btn').click()
    await forRequest()

    const wrapper = find('#target wrapper')
    assert.exists(wrapper)
    assert.equal(wrapper.children.length, 2)
  })

  it('Partial without strip modifier keeps wrapper (default)', async function () {
    mockResponse(
      'GET', '/api',
      '<div id="main">Main</div><hx-partial hx-target="#target" hx-swap="innerHTML"><wrapper><span>A</span><span>B</span></wrapper></hx-partial>',
    )
    createProcessedHTML(
      '<button id="btn" hx-get="/api" hx-target="#main">Get</button><div id="target">Original</div>',
    )
    find('#btn').click()
    await forRequest()

    const wrapper = find('#target wrapper')
    assert.exists(wrapper)
    assert.equal(wrapper.children.length, 2)
  })

  // ========================================================================
  // Edge Cases
  // ========================================================================

  it('Strip with single text node extracts text', async function () {
    mockResponse('GET', '/api', '<wrapper>Just text</wrapper>')
    createProcessedHTML(
      '<button id="btn" hx-get="/api" hx-target="#target" hx-swap="innerHTML strip:true">Get</button><div id="target"></div>',
    )
    find('#btn').click()
    await forRequest()

    const target = find('#target')
    assert.equal(target.textContent, 'Just text')
    assert.equal(target.children.length, 0)
  })

  it('Strip only removes one level', async function () {
    mockResponse('GET', '/api', '<outer><inner><p>Content</p></inner></outer>')
    createProcessedHTML(
      '<button id="btn" hx-get="/api" hx-target="#target" hx-swap="innerHTML strip:true">Get</button><div id="target"></div>',
    )
    find('#btn').click()
    await forRequest()

    const target = find('#target')
    const inner = find('#target inner')
    assert.exists(inner)
    assert.isNull(find('#target outer'))
    assert.equal(inner.children[0].tagName, 'P')
  })
})
