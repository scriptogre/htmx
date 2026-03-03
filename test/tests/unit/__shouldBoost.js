describe('hx-boost behavior tests', function () {
  beforeEach(function () {
    setupTest()
  })

  afterEach(function () {
    cleanupTest()
  })

  // Anchor tag tests
  describe('Anchor tags', function () {
    it('should boost same-origin link with no target', async function () {
      mockResponse('GET', '/test', '<div>Boosted</div>')
      let container = createProcessedHTML(
        '<div hx-boost="true"><a href="/test">Link</a></div>',
      )
      let link = container.querySelector('a')
      link.click()
      await forRequest()
      let call = lastFetch()
      assert.include(call.url, '/test')
    })

    it('should boost same-origin link with target="_self"', async function () {
      mockResponse('GET', '/test', '<div>Boosted</div>')
      let container = createProcessedHTML(
        '<div hx-boost="true"><a href="/test" target="_self">Link</a></div>',
      )
      let link = container.querySelector('a')
      link.click()
      await forRequest()
      let call = lastFetch()
      assert.include(call.url, '/test')
    })

    it('should not boost hash-only links', function () {
      let container = createProcessedHTML(
        '<div hx-boost="true"><a href="#section">Link</a></div>',
      )
      let link = container.querySelector('a')
      // Hash-only links should not have htmx processing
      assert.isFalse(link.hasAttribute('data-htmx-powered'))
    })

    it('should not boost links with target="_blank"', function () {
      let container = createProcessedHTML(
        '<div hx-boost="true"><a href="/test" target="_blank">Link</a></div>',
      )
      let link = container.querySelector('a')
      assert.isFalse(link.hasAttribute('data-htmx-powered'))
    })

    it('should not boost links with target="_parent"', function () {
      let container = createProcessedHTML(
        '<div hx-boost="true"><a href="/test" target="_parent">Link</a></div>',
      )
      let link = container.querySelector('a')
      assert.isFalse(link.hasAttribute('data-htmx-powered'))
    })

    it('should not boost links with target="_top"', function () {
      let container = createProcessedHTML(
        '<div hx-boost="true"><a href="/test" target="_top">Link</a></div>',
      )
      let link = container.querySelector('a')
      assert.isFalse(link.hasAttribute('data-htmx-powered'))
    })

    it('should not boost links with named target', function () {
      let container = createProcessedHTML(
        '<div hx-boost="true"><a href="/test" target="myframe">Link</a></div>',
      )
      let link = container.querySelector('a')
      assert.isFalse(link.hasAttribute('data-htmx-powered'))
    })

    it('should not boost cross-origin links', function () {
      let container = createProcessedHTML(
        '<div hx-boost="true"><a href="https://example.com/test">Link</a></div>',
      )
      let link = container.querySelector('a')
      assert.isFalse(link.hasAttribute('data-htmx-powered'))
    })

    it('should boost links with hash after path', async function () {
      mockResponse('GET', '/test', '<div>Boosted</div>')
      let container = createProcessedHTML(
        '<div hx-boost="true"><a href="/test#section">Link</a></div>',
      )
      let link = container.querySelector('a')
      link.click()
      await forRequest()
      let call = lastFetch()
      assert.include(call.url, '/test')
    })

    it('should not boost javascript: URLs', function () {
      let container = createProcessedHTML(
        '<div hx-boost="true"><a href="javascript:void(0)">Link</a></div>',
      )
      let link = container.querySelector('a')
      assert.isFalse(link.hasAttribute('data-htmx-powered'))
    })
  })

  // Form tag tests
  describe('Form tags', function () {
    it('should boost same-origin form with no action', function () {
      let container = createProcessedHTML(
        '<div hx-boost="true"><form><button type="submit">Submit</button></form></div>',
      )
      let form = container.querySelector('form')
      // A boosted form should be marked as htmx-powered
      assert.isTrue(form._htmxBoosted === true)
    })

    it('should boost same-origin form with relative action', async function () {
      mockResponse('POST', '/submit', '<div>Boosted</div>')
      let container = createProcessedHTML(
        '<div hx-boost="true"><form method="post" action="/submit"><button type="submit">Submit</button></form></div>',
      )
      let form = container.querySelector('form')
      form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))
      await forRequest()
      let call = lastFetch()
      assert.include(call.url, '/submit')
    })

    it('should not boost form with method="dialog"', function () {
      let container = createProcessedHTML(
        '<div hx-boost="true"><form method="dialog"><button type="submit">Submit</button></form></div>',
      )
      let form = container.querySelector('form')
      assert.isFalse(form.hasAttribute('data-htmx-powered'))
    })

    it('should not boost form with cross-origin action', function () {
      let container = createProcessedHTML(
        '<div hx-boost="true"><form action="https://example.com/submit"><button type="submit">Submit</button></form></div>',
      )
      let form = container.querySelector('form')
      assert.isFalse(form.hasAttribute('data-htmx-powered'))
    })
  })

  // Other element tests
  describe('Other elements', function () {
    it('should not boost non-anchor, non-form elements', function () {
      let container = createProcessedHTML(
        '<div hx-boost="true"><span>Text</span></div>',
      )
      let span = container.querySelector('span')
      assert.isFalse(span.hasAttribute('data-htmx-powered'))
    })
  })
})
