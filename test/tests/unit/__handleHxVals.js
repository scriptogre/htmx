describe('hx-vals processing tests', function () {
  beforeEach(function () {
    setupTest()
  })

  afterEach(function () {
    cleanupTest()
  })

  it('handles JSON object values', async function () {
    mockResponse('POST', '/test', 'ok')
    let btn = createProcessedHTML(
      '<button hx-post="/test" hx-swap="none" hx-vals=\'{"foo":"bar","baz":"qux"}\'>Click</button>',
    )

    btn.click()
    await forRequest()

    let call = lastFetch()
    let params = new URLSearchParams(call.request.body)
    assert.equal(params.get('foo'), 'bar')
    assert.equal(params.get('baz'), 'qux')
  })

  it('handles empty vals (no hx-vals attribute)', async function () {
    mockResponse('POST', '/test', 'ok')
    let btn = createProcessedHTML(
      '<button hx-post="/test" hx-swap="none">Click</button>',
    )

    btn.click()
    await forRequest()

    let call = lastFetch()
    let params = new URLSearchParams(call.request.body)
    assert.equal([...params.keys()].length, 0)
  })

  it('handles numeric values in JSON', async function () {
    mockResponse('POST', '/test', 'ok')
    let btn = createProcessedHTML(
      '<button hx-post="/test" hx-swap="none" hx-vals=\'{"count":123,"price":456}\'>Click</button>',
    )

    btn.click()
    await forRequest()

    let call = lastFetch()
    let params = new URLSearchParams(call.request.body)
    assert.equal(params.get('count'), '123')
    assert.equal(params.get('price'), '456')
  })

  it('handles boolean values in JSON', async function () {
    mockResponse('POST', '/test', 'ok')
    let btn = createProcessedHTML(
      '<button hx-post="/test" hx-swap="none" hx-vals=\'{"enabled":true,"disabled":false}\'>Click</button>',
    )

    btn.click()
    await forRequest()

    let call = lastFetch()
    let params = new URLSearchParams(call.request.body)
    assert.equal(params.get('enabled'), 'true')
    assert.equal(params.get('disabled'), 'false')
  })

  it('includes hx-vals on GET requests as query params', async function () {
    mockResponse('GET', /\/test\?.*/, 'ok')
    let btn = createProcessedHTML(
      '<button hx-get="/test" hx-swap="none" hx-vals=\'{"key":"value"}\'>Click</button>',
    )

    btn.click()
    await forRequest()

    let call = lastFetch()
    assert.include(call.url, 'key=value')
  })

  // TODO: The following tests are skipped because the new architecture only supports
  // JSON format for hx-vals. Config syntax (key:value) and js:/javascript: prefix
  // are not implemented in the kernel+core hx-vals extension.

  it.skip('handles basic key-value config syntax', async function () {
    mockResponse('POST', '/test', 'ok')
    let btn = createProcessedHTML(
      '<button hx-post="/test" hx-swap="none" hx-vals="foo:bar">Click</button>',
    )

    btn.click()
    await forRequest()

    let call = lastFetch()
    let params = new URLSearchParams(call.request.body)
    assert.equal(params.get('foo'), 'bar')
  })

  it.skip('handles multiple key-value pairs in config syntax', async function () {
    mockResponse('POST', '/test', 'ok')
    let btn = createProcessedHTML(
      '<button hx-post="/test" hx-swap="none" hx-vals="a:1, b:2, c:3">Click</button>',
    )

    btn.click()
    await forRequest()

    let call = lastFetch()
    let params = new URLSearchParams(call.request.body)
    assert.equal(params.get('a'), '1')
    assert.equal(params.get('b'), '2')
    assert.equal(params.get('c'), '3')
  })

  it.skip('handles quoted string values in config syntax', async function () {
    mockResponse('POST', '/test', 'ok')
    let btn = createProcessedHTML(
      '<button hx-post="/test" hx-swap="none" hx-vals=\'name:"John Doe", age:30\'>Click</button>',
    )

    btn.click()
    await forRequest()

    let call = lastFetch()
    let params = new URLSearchParams(call.request.body)
    assert.equal(params.get('name'), 'John Doe')
    assert.equal(params.get('age'), '30')
  })

  it.skip('handles js: prefix with object return', async function () {
    mockResponse('POST', '/test', 'ok')
    let btn = createProcessedHTML(
      '<button hx-post="/test" hx-swap="none" hx-vals="js:{foo: \'bar\', num: 42}">Click</button>',
    )

    btn.click()
    await forRequest()

    let call = lastFetch()
    let params = new URLSearchParams(call.request.body)
    assert.equal(params.get('foo'), 'bar')
    assert.equal(params.get('num'), '42')
  })

  it.skip('handles js: prefix with dynamic values', async function () {
    window.testValue = 'dynamic'
    mockResponse('POST', '/test', 'ok')
    let btn = createProcessedHTML(
      '<button hx-post="/test" hx-swap="none" hx-vals="js:{key: window.testValue}">Click</button>',
    )

    btn.click()
    await forRequest()

    let call = lastFetch()
    let params = new URLSearchParams(call.request.body)
    assert.equal(params.get('key'), 'dynamic')
    delete window.testValue
  })

  it.skip('handles javascript: prefix', async function () {
    mockResponse('POST', '/test', 'ok')
    let btn = createProcessedHTML(
      '<button hx-post="/test" hx-swap="none" hx-vals="javascript:{foo: \'baz\'}">Click</button>',
    )

    btn.click()
    await forRequest()

    let call = lastFetch()
    let params = new URLSearchParams(call.request.body)
    assert.equal(params.get('foo'), 'baz')
  })
})
