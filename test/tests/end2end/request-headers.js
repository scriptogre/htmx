describe('Request Headers', function () {

    beforeEach(function () {
        setupTest()
    })

    afterEach(function () {
        cleanupTest()
    })

    // =========================================================================
    // HX-Request header
    // =========================================================================

    it('every htmx request includes HX-Request: true', async function () {
        mockResponse('GET', '/test', 'OK')
        createProcessedHTML('<div id="d" hx-get="/test" hx-swap="none">Click</div>')
        find('#d').click()
        await forRequest()
        assert.equal(lastFetch().request.headers['HX-Request'], 'true')
    })

    // =========================================================================
    // HX-Source header (kernel uses HX-Source instead of HX-Trigger)
    // =========================================================================

    it('request from element with id sends HX-Source with tag#id format', async function () {
        mockResponse('GET', '/test', 'OK')
        createProcessedHTML('<button id="my-btn" hx-get="/test" hx-swap="none">Click</button>')
        find('#my-btn').click()
        await forRequest()
        assert.equal(lastFetch().request.headers['HX-Source'], 'button#my-btn')
    })

    it('request from element without id sends HX-Source with tag name only', async function () {
        mockResponse('GET', '/test', 'OK')
        let btn = createProcessedHTML('<button hx-get="/test" hx-swap="none">Click</button>')
        btn.click()
        await forRequest()
        assert.equal(lastFetch().request.headers['HX-Source'], 'button')
    })

    // =========================================================================
    // HX-Target header (kernel uses tag#id format)
    // =========================================================================

    it('request with hx-target sends HX-Target with tag#id format', async function () {
        mockResponse('GET', '/test', 'OK')
        createProcessedHTML(`
            <div>
                <div id="target">Original</div>
                <button id="btn" hx-get="/test" hx-target="#target" hx-swap="none">Click</button>
            </div>
        `)
        find('#btn').click()
        await forRequest()
        assert.equal(lastFetch().request.headers['HX-Target'], 'div#target')
    })

    it('request targeting self sends HX-Target with own tag#id', async function () {
        mockResponse('GET', '/test', 'OK')
        createProcessedHTML('<div id="self-target" hx-get="/test" hx-swap="none">Click</div>')
        find('#self-target').click()
        await forRequest()
        assert.equal(lastFetch().request.headers['HX-Target'], 'div#self-target')
    })

    it('request targeting element without id sends HX-Target with tag name', async function () {
        mockResponse('GET', '/test', 'OK')
        createProcessedHTML(`
            <div>
                <span>No id target</span>
                <button id="btn" hx-get="/test" hx-target="previous" hx-swap="none">Click</button>
            </div>
        `)
        find('#btn').click()
        await forRequest()
        assert.equal(lastFetch().request.headers['HX-Target'], 'span')
    })

    // =========================================================================
    // HX-Request-Type header (kernel-specific)
    // =========================================================================

    it('regular request sends HX-Request-Type: partial', async function () {
        mockResponse('GET', '/test', 'OK')
        createProcessedHTML('<div id="d" hx-get="/test" hx-swap="none">Click</div>')
        find('#d').click()
        await forRequest()
        assert.equal(lastFetch().request.headers['HX-Request-Type'], 'partial')
    })

    it('request with hx-select sends HX-Request-Type: full', async function () {
        mockResponse('GET', '/test', '<div id="d">OK</div>')
        createProcessedHTML('<div id="d" hx-get="/test" hx-select="#d">Click</div>')
        find('#d').click()
        await forRequest()
        assert.equal(lastFetch().request.headers['HX-Request-Type'], 'full')
    })

    // =========================================================================
    // HX-Current-URL header
    // =========================================================================

    it('request includes HX-Current-URL with current page URL', async function () {
        mockResponse('GET', '/test', 'OK')
        createProcessedHTML('<div id="d" hx-get="/test" hx-swap="none">Click</div>')
        find('#d').click()
        await forRequest()
        assert.equal(lastFetch().request.headers['HX-Current-URL'], window.location.href)
    })

    // =========================================================================
    // HX-Boosted header
    // =========================================================================

    it('boosted element sends HX-Boosted: true', async function () {
        mockResponse('GET', '/test', 'OK')
        createProcessedHTML(`
            <div hx-boost:inherited="true">
                <a id="link" href="/test">Link</a>
            </div>
        `)
        find('#link').click()
        await forRequest()
        assert.equal(lastFetch().request.headers['HX-Boosted'], 'true')
    })

    it('non-boosted element does not send HX-Boosted', async function () {
        mockResponse('GET', '/test', 'OK')
        createProcessedHTML('<div id="d" hx-get="/test" hx-swap="none">Click</div>')
        find('#d').click()
        await forRequest()
        let headers = lastFetch().request.headers
        assert.isNotOk(headers['HX-Boosted'], 'HX-Boosted should not be set')
    })
})
