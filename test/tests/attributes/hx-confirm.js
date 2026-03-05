describe('hx-confirm attribute', function() {

    beforeEach(() => {
        setupTest(this.currentTest)
    })

    afterEach(() => {
        cleanupTest(this.currentTest)
    })

    it('blocks request when window.confirm returns false', async function () {
        let originalConfirm = window.confirm
        window.confirm = () => false

        mockResponse('GET', '/test', 'Success')
        let btn = createProcessedHTML('<button hx-get="/test" hx-confirm="Are you sure?">Click</button>')
        btn.click()
        // No request is issued when confirm returns false, so htmx:finally never fires.
        // Use a short delay instead.
        await htmx.timeout(50)

        btn.innerText.should.equal('Click')
        window.confirm = originalConfirm
    })

    it('allows request when window.confirm returns true', async function () {
        let originalConfirm = window.confirm
        window.confirm = () => true

        mockResponse('GET', '/test', 'Success')
        let btn = createProcessedHTML('<button hx-get="/test" hx-confirm="Are you sure?">Click</button>')
        btn.click()
        await forRequest()

        playground().innerText.should.equal('Success')
        window.confirm = originalConfirm
    })

    it('fires htmx:confirm event', async function () {
        let originalConfirm = window.confirm
        window.confirm = () => true

        mockResponse('GET', '/test', 'Success')
        let confirmFired = false
        let btn = createProcessedHTML('<button hx-get="/test" hx-confirm="Delete this?">Click</button>')
        btn.addEventListener('htmx:confirm', () => confirmFired = true)
        btn.click()
        await forRequest()

        assert.isTrue(confirmFired)
        window.confirm = originalConfirm
    })

    it('provides ctx in htmx:confirm event detail', async function () {
        let originalConfirm = window.confirm
        window.confirm = () => true

        mockResponse('GET', '/test', 'Success')
        let capturedCtx = null
        let btn = createProcessedHTML('<button hx-get="/test" hx-confirm="Proceed?">Click</button>')
        btn.addEventListener('htmx:confirm', (e) => capturedCtx = e.detail.ctx)
        btn.click()
        await forRequest()

        assert.isNotNull(capturedCtx)
        assert.equal(capturedCtx.confirm, 'Proceed?')
        window.confirm = originalConfirm
    })

    it('provides issueRequest callback in event detail', async function () {
        let originalConfirm = window.confirm
        window.confirm = () => true

        mockResponse('GET', '/test', 'Success')
        let issueRequestCallback = null
        let btn = createProcessedHTML('<button hx-get="/test" hx-confirm="Continue?">Click</button>')
        btn.addEventListener('htmx:confirm', (e) => issueRequestCallback = e.detail.issueRequest)
        btn.click()
        await forRequest()

        assert.isFunction(issueRequestCallback)
        window.confirm = originalConfirm
    })

    it('allows custom confirmation UI with issueRequest callback', async function () {
        mockResponse('GET', '/test', 'Custom confirmed')
        let btn = createProcessedHTML('<button hx-get="/test" hx-confirm="Custom?">Click</button>')

        btn.addEventListener('htmx:confirm', (e) => {
            e.preventDefault()
            // Call issueRequest asynchronously to simulate custom confirmation UI
            setTimeout(() => e.detail.issueRequest(), 10)
        })

        // Start listening for htmx:finally BEFORE clicking, since the async
        // issueRequest fires after 10ms and the request may complete before
        // we get a chance to call forRequest()
        let done = forRequest()
        btn.click()
        await done

        playground().innerText.should.equal('Custom confirmed')
    })

    it('cancels request when issueRequest called with false', async function () {
        mockResponse('GET', '/test', 'Success')
        let btn = createProcessedHTML('<button hx-get="/test" hx-confirm="Cancel?">Click</button>')

        btn.addEventListener('htmx:confirm', (e) => {
            e.preventDefault()
            // In kernel architecture, issueRequest(false) cancels instead of dropRequest()
            e.detail.issueRequest(false)
        })

        btn.click()
        // No request issued, so htmx:finally never fires
        await htmx.timeout(50)

        btn.innerText.should.equal('Click')
    })

    it('supports js: expressions', async function () {
        mockResponse('GET', '/test', 'JS confirmed')
        let btn = createProcessedHTML('<button hx-get="/test" hx-confirm="js:true">Click</button>')
        btn.click()
        await forRequest()

        playground().innerText.should.equal('JS confirmed')
    })

    it('blocks request with js: returning false', async function () {
        mockResponse('GET', '/test', 'Success')
        let btn = createProcessedHTML('<button hx-get="/test" hx-confirm="js:false">Click</button>')
        btn.click()
        // No request issued when js: returns false
        await htmx.timeout(50)

        btn.innerText.should.equal('Click')
    })

    it('can modify ctx.confirm in htmx:config:request', async function () {
        let originalConfirm = window.confirm
        window.confirm = (msg) => {
            assert.equal(msg, 'Modified message')
            return true
        }

        mockResponse('GET', '/test', 'Success')
        let btn = createProcessedHTML('<button hx-get="/test" hx-confirm="Original">Click</button>')
        btn.addEventListener('htmx:config:request', (e) => {
            e.detail.ctx.confirm = 'Modified message'
        })
        btn.click()
        await forRequest()

        playground().innerText.should.equal('Success')
        window.confirm = originalConfirm
    })

    it('can disable confirmation by setting ctx.confirm to null', async function () {
        mockResponse('GET', '/test', 'No confirm')
        let btn = createProcessedHTML('<button hx-get="/test" hx-confirm="Should not see">Click</button>')
        
        let confirmFired = false
        btn.addEventListener('htmx:confirm', () => confirmFired = true)
        btn.addEventListener('htmx:config:request', (e) => {
            e.detail.ctx.confirm = null
        })
        
        btn.click()
        await forRequest()

        assert.isFalse(confirmFired)
        playground().innerText.should.equal('No confirm')
    })

    it('works with forms', async function () {
        let originalConfirm = window.confirm
        window.confirm = () => true

        mockResponse('POST', '/submit', 'Form submitted')
        let form = createProcessedHTML('<form hx-post="/submit" hx-confirm="Submit form?"><button>Submit</button></form>')
        form.requestSubmit()
        await forRequest()

        playground().innerText.should.equal('Form submitted')
        window.confirm = originalConfirm
    })

    it('cleans up indicators when confirmation cancelled', async function () {
        let originalConfirm = window.confirm
        window.confirm = () => false

        mockResponse('GET', '/test', 'Success')
        let btn = createProcessedHTML('<button hx-get="/test" hx-confirm="Cancel?" hx-indicator="#ind">Click</button>')
        createProcessedHTML('<div id="ind" class="htmx-indicator">Loading...</div>')

        btn.click()
        // No request issued when confirm returns false
        await htmx.timeout(50)

        let indicator = find('#ind')
        assert.isFalse(indicator.classList.contains('htmx-request'))
        window.confirm = originalConfirm
    })

    it('re-enables disabled elements when confirmation cancelled', async function () {
        let originalConfirm = window.confirm
        window.confirm = () => false

        mockResponse('GET', '/test', 'Success')
        let btn = createProcessedHTML('<button hx-get="/test" hx-confirm="Cancel?" hx-disable>Click</button>')

        btn.click()
        // No request issued when confirm returns false
        await htmx.timeout(50)

        assert.isFalse(btn.disabled)
        window.confirm = originalConfirm
    })
})
