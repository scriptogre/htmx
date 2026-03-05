describe('Basic Functionality', () => {

    afterEach(() => {
        cleanupTest();
    })

    it('Button click triggers fetch and swaps content', async ()=> {
        mockResponse('GET', '/demo', '<div id="result">Success!</div>');
        createProcessedHTML('<button id="test-btn" hx-action="/demo" hx-target="#target">Click</button><div id="target">Original</div>');
        find("#test-btn").click()
        await forRequest();
        assertTextContentIs("#target", "Success!");
    })

    it('validation errors prevent submission of a form', async function() {
        mockResponse('POST', '/demo', '<div id="result">Success!</div>');
        createProcessedHTML('<form><input id="i1" required/><button id="b1" hx-post="/demo" hx-validate="true">Demo</button></form>');

        find('#b1').click();
        assert.equal(fetchMock.calls.length, 0);

        find("#i1").value = "foo"
        find('#b1').click()
        await forRequest();

        assert.isNull(find('#target'));
        assertTextContentIs("#result", "Success!");
    })

    it('validation errors do not prevent submission of an element within a form marked as hx-validate=false', async function() {
        mockResponse('POST', '/demo', new MockResponse('<div id="result">Success!</div>'));
        createProcessedHTML('<form><input id="i1" required/><button id="b1" hx-post="/demo" hx-validate="false">Demo</button></form>');

        find('#b1').click()
        await forRequest();

        assert.isNull(find('#target'));
        assertTextContentIs("#result", "Success!");
    })

    it('validation errors prevent submission of a single input with hx-validate=true', async function() {
        mockResponse('POST', '/demo', '<div id="result">Success!</div>');
        createProcessedHTML('<input id="i1" required hx-post="/demo" hx-validate="true" name="test" hx-trigger="click"/>');

        find('#i1').click();
        assert.equal(fetchMock.calls.length, 0);

        find("#i1").value = "foo"
        find('#i1').click()
        await forRequest();

        assertTextContentIs("#result", "Success!");
    })

    // TODO: Validating included inputs outside a form requires per-element validation
    it.skip('validation errors prevent submission of hx-included inputs', async function() {
        mockResponse('POST', '/demo', '<div id="result">Success!</div>');
        createProcessedHTML('<input id="i1" required name="test1"/><button id="b1" hx-post="/demo" hx-validate="true" hx-include="#i1">Submit</button>');

        find('#b1').click();
        assert.equal(fetchMock.calls.length, 0);

        find("#i1").value = "foo"
        find('#b1').click()
        await forRequest();

        assertTextContentIs("#result", "Success!");
    })

    it('form with noValidate does not validate by default', async function() {
        mockResponse('POST', '/demo', '<div id="result">Success!</div>');
        createProcessedHTML('<form novalidate><input id="i1" required name="test"/><button id="b1" hx-post="/demo">Submit</button></form>');

        find('#b1').click();
        await forRequest();

        assertTextContentIs("#result", "Success!");
    })

    it('form with noValidate can be overridden with hx-validate=true', async function() {
        mockResponse('POST', '/demo', '<div id="result">Success!</div>');
        createProcessedHTML('<form novalidate><input id="i1" required name="test"/><button id="b1" hx-post="/demo" hx-validate="true">Submit</button></form>');

        find('#b1').click();
        assert.equal(fetchMock.calls.length, 0);

        find("#i1").value = "foo"
        find('#b1').click()
        await forRequest();

        assertTextContentIs("#result", "Success!");
    })

    it('submit button with formNoValidate skips validation', async function() {
        mockResponse('POST', '/demo', '<div id="result">Success!</div>');
        createProcessedHTML('<form><input id="i1" required name="test"/><button id="b1" hx-post="/demo" formnovalidate>Submit</button></form>');

        find('#b1').click();
        await forRequest();

        assertTextContentIs("#result", "Success!");
    })

    it('form validates by default without hx-validate attribute', async function() {
        mockResponse('POST', '/demo', '<div id="result">Success!</div>');
        createProcessedHTML('<form hx-post="/demo"><input id="i1" required name="test"/><button id="b1" type="submit">Submit</button></form>');

        find('#b1').click();
        assert.equal(fetchMock.calls.length, 0);

        find("#i1").value = "foo"
        find('#b1').click()
        await forRequest();

        assertTextContentIs("#result", "Success!");
    })
})
