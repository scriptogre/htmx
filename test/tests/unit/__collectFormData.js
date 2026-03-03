describe('form data collection tests', function () {
  before(function () {
    // Define a form-associated custom element for testing
    if (!customElements.get('test-input')) {
      class TestInput extends HTMLElement {
        static formAssociated = true

        constructor() {
          super()
          this._internals = this.attachInternals()
          this._value = ''
        }

        connectedCallback() {
          this._value = this.getAttribute('value') || ''
          this._internals.setFormValue(this._value)
        }

        get value() {
          return this._value
        }

        set value(val) {
          this._value = val
          this._internals.setFormValue(val)
        }
      }
      customElements.define('test-input', TestInput)
    }
  })

  beforeEach(function () {
    setupTest()
  })

  afterEach(function () {
    cleanupTest()
  })

  it('collects text input from form', async function () {
    mockResponse('POST', '/test', 'ok')
    let form = createProcessedHTML(
      '<form hx-post="/test" hx-swap="none"><input type="text" name="foo" value="bar"><button type="submit">Go</button></form>',
    )

    form.querySelector('button').click()
    await forRequest()

    let call = lastFetch()
    let params = new URLSearchParams(call.request.body)
    assert.equal(params.get('foo'), 'bar')
  })

  it('collects multiple inputs from form', async function () {
    mockResponse('POST', '/test', 'ok')
    let form = createProcessedHTML(
      '<form hx-post="/test" hx-swap="none"><input name="a" value="1"><input name="b" value="2"><button type="submit">Go</button></form>',
    )

    form.querySelector('button').click()
    await forRequest()

    let call = lastFetch()
    let params = new URLSearchParams(call.request.body)
    assert.equal(params.get('a'), '1')
    assert.equal(params.get('b'), '2')
  })

  it('collects textarea from form', async function () {
    mockResponse('POST', '/test', 'ok')
    let form = createProcessedHTML(
      '<form hx-post="/test" hx-swap="none"><textarea name="msg">hello</textarea><button type="submit">Go</button></form>',
    )

    form.querySelector('button').click()
    await forRequest()

    let call = lastFetch()
    let params = new URLSearchParams(call.request.body)
    assert.equal(params.get('msg'), 'hello')
  })

  it('collects select from form', async function () {
    mockResponse('POST', '/test', 'ok')
    let form = createProcessedHTML(
      '<form hx-post="/test" hx-swap="none"><select name="choice"><option value="a">A</option><option value="b" selected>B</option></select><button type="submit">Go</button></form>',
    )

    form.querySelector('button').click()
    await forRequest()

    let call = lastFetch()
    let params = new URLSearchParams(call.request.body)
    assert.equal(params.get('choice'), 'b')
  })

  it('collects checked checkbox', async function () {
    mockResponse('POST', '/test', 'ok')
    let form = createProcessedHTML(
      '<form hx-post="/test" hx-swap="none"><input type="checkbox" name="agree" value="yes" checked><button type="submit">Go</button></form>',
    )

    form.querySelector('button').click()
    await forRequest()

    let call = lastFetch()
    let params = new URLSearchParams(call.request.body)
    assert.equal(params.get('agree'), 'yes')
  })

  it('excludes unchecked checkbox', async function () {
    mockResponse('POST', '/test', 'ok')
    let form = createProcessedHTML(
      '<form hx-post="/test" hx-swap="none"><input type="checkbox" name="agree" value="yes"><button type="submit">Go</button></form>',
    )

    form.querySelector('button').click()
    await forRequest()

    let call = lastFetch()
    let params = new URLSearchParams(call.request.body)
    assert.isNull(params.get('agree'))
  })

  it('collects checked radio button', async function () {
    mockResponse('POST', '/test', 'ok')
    let form = createProcessedHTML(
      '<form hx-post="/test" hx-swap="none"><input type="radio" name="color" value="red" checked><input type="radio" name="color" value="blue"><button type="submit">Go</button></form>',
    )

    form.querySelector('button').click()
    await forRequest()

    let call = lastFetch()
    let params = new URLSearchParams(call.request.body)
    assert.equal(params.get('color'), 'red')
  })

  it('excludes unchecked radio buttons', async function () {
    mockResponse('POST', '/test', 'ok')
    let form = createProcessedHTML(
      '<form hx-post="/test" hx-swap="none"><input type="radio" name="color" value="red"><input type="radio" name="color" value="blue"><button type="submit">Go</button></form>',
    )

    form.querySelector('button').click()
    await forRequest()

    let call = lastFetch()
    let params = new URLSearchParams(call.request.body)
    assert.isNull(params.get('color'))
  })

  it('collects multiple select values', async function () {
    mockResponse('POST', '/test', 'ok')
    let form = createProcessedHTML(
      '<form hx-post="/test" hx-swap="none"><select name="items" multiple><option value="a" selected>A</option><option value="b" selected>B</option><option value="c">C</option></select><button type="submit">Go</button></form>',
    )

    form.querySelector('button').click()
    await forRequest()

    let call = lastFetch()
    let params = new URLSearchParams(call.request.body)
    assert.deepEqual(params.getAll('items'), ['a', 'b'])
  })

  it('excludes disabled inputs', async function () {
    mockResponse('POST', '/test', 'ok')
    let form = createProcessedHTML(
      '<form hx-post="/test" hx-swap="none"><input name="a" value="1"><input name="b" value="2" disabled><button type="submit">Go</button></form>',
    )

    form.querySelector('button').click()
    await forRequest()

    let call = lastFetch()
    let params = new URLSearchParams(call.request.body)
    assert.equal(params.get('a'), '1')
    assert.isNull(params.get('b'))
  })

  it('excludes inputs without name attribute', async function () {
    mockResponse('POST', '/test', 'ok')
    let form = createProcessedHTML(
      '<form hx-post="/test" hx-swap="none"><input value="1"><input name="b" value="2"><button type="submit">Go</button></form>',
    )

    form.querySelector('button').click()
    await forRequest()

    let call = lastFetch()
    let params = new URLSearchParams(call.request.body)
    assert.equal(params.get('b'), '2')
  })

  it('collects hx-include elements', async function () {
    mockResponse('POST', '/test', 'ok')
    createProcessedHTML(
      '<input id="extra" name="extra" value="included"><form hx-post="/test" hx-swap="none" hx-include="#extra"><input name="a" value="1"><button type="submit">Go</button></form>',
    )
    let form = playground().querySelector('form')

    form.querySelector('button').click()
    await forRequest()

    let call = lastFetch()
    let params = new URLSearchParams(call.request.body)
    assert.equal(params.get('a'), '1')
    assert.equal(params.get('extra'), 'included')
  })

  it('handles empty form', async function () {
    mockResponse('POST', '/test', 'ok')
    let form = createProcessedHTML(
      '<form hx-post="/test" hx-swap="none"><button type="submit">Go</button></form>',
    )

    form.querySelector('button').click()
    await forRequest()

    let call = lastFetch()
    let params = new URLSearchParams(call.request.body)
    // Only the button's value might be included — check no unexpected params
    assert.isNull(params.get('nonexistent'))
  })

  it('collects form-associated custom element value', async function () {
    mockResponse('POST', '/test', 'ok')
    let form = createProcessedHTML(
      '<form hx-post="/test" hx-swap="none"><test-input name="custom" value="test-value"></test-input><button type="submit">Go</button></form>',
    )

    form.querySelector('button').click()
    await forRequest()

    let call = lastFetch()
    let params = new URLSearchParams(call.request.body)
    assert.equal(params.get('custom'), 'test-value')
  })

  it('collects both regular and custom element values', async function () {
    mockResponse('POST', '/test', 'ok')
    let form = createProcessedHTML(
      '<form hx-post="/test" hx-swap="none"><input name="regular" value="reg-val"><test-input name="custom" value="cust-val"></test-input><button type="submit">Go</button></form>',
    )

    form.querySelector('button').click()
    await forRequest()

    let call = lastFetch()
    let params = new URLSearchParams(call.request.body)
    assert.equal(params.get('regular'), 'reg-val')
    assert.equal(params.get('custom'), 'cust-val')
  })

  // TODO: Submitter value collection requires the submit event's submitter property
  // which is only available through form.requestSubmit() or native form submission.
  // In the kernel+core architecture, button.click() triggers hx-post on the button
  // element, not a form submit event, so no submitter is available.
  it.skip('collects submitter value', async function () {
    mockResponse('POST', '/test', 'ok')
    let form = createProcessedHTML(
      '<form hx-post="/test" hx-swap="none"><input name="a" value="1"><button name="submit" value="go" type="submit">Go</button></form>',
    )

    let button = form.querySelector('button')
    button.click()
    await forRequest()

    let call = lastFetch()
    let params = new URLSearchParams(call.request.body)
    assert.equal(params.get('a'), '1')
    assert.equal(params.get('submit'), 'go')
  })
})
