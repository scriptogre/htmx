describe('hx-preload attribute', function() {

    beforeEach(function () {
        setupTest(this.currentTest)
    })

    afterEach(function () {
        cleanupTest()
    })

    it('preloads on specified event', async function () {
        let fetchCount = 0
        const originalFetch = window.fetch
        const wrappedFetch = function (...args) {
            fetchCount++
            return originalFetch.apply(this, args)
        }
        window.fetch = wrappedFetch

        mockResponse('GET', '/preload-test-1', 'Preloaded')
        let btn = createProcessedHTML('<button hx-get="/preload-test-1" hx-preload="mouseenter">Click</button>')
        btn.dispatchEvent(new Event('mouseenter'))
        await htmx.timeout(20)
        assert.equal(fetchCount, 1, 'fetch should have been called for preload')
        window.fetch = originalFetch
    })

    it('does not preload non-GET requests', async function () {
        let fetchCount = 0
        const originalFetch = window.fetch
        window.fetch = function (...args) { fetchCount++; return originalFetch.apply(this, args) }

        mockResponse('POST', '/preload-test-2', 'Posted')
        let btn = createProcessedHTML('<button hx-post="/preload-test-2" hx-preload="mouseenter">Click</button>')
        btn.dispatchEvent(new Event('mouseenter'))
        await htmx.timeout(20)
        assert.equal(fetchCount, 0, 'fetch should not be called for POST preload')
        window.fetch = originalFetch
    })

    it('uses preloaded response for actual request', async function () {
        let fetchCount = 0
        const originalFetch = window.fetch
        window.fetch = function (...args) { fetchCount++; return originalFetch.apply(this, args) }

        mockResponse('GET', '/preload-test-3', '<div>Cached</div>')
        let div = createProcessedHTML('<div hx-get="/preload-test-3" hx-swap="innerHTML" hx-preload="mouseenter" hx-trigger="click">Load</div>')
        div.dispatchEvent(new Event('mouseenter'))
        await htmx.timeout(20)
        assert.equal(fetchCount, 1, 'preload should have triggered one fetch')
        div.click()
        await forRequest()
        // The actual request should reuse the cached fetch, so total count should still be 1
        assert.equal(fetchCount, 1, 'actual request should reuse cached fetch')
        window.fetch = originalFetch
    })

    it('works with different event types', async function () {
        let fetchCount = 0
        const originalFetch = window.fetch
        window.fetch = function (...args) { fetchCount++; return originalFetch.apply(this, args) }

        mockResponse('GET', '/preload-test-4', 'Response')
        let btn = createProcessedHTML('<button hx-get="/preload-test-4" hx-preload="focus">Click</button>')
        btn.dispatchEvent(new Event('focus'))
        await htmx.timeout(20)
        assert.equal(fetchCount, 1, 'focus event should trigger preload')
        window.fetch = originalFetch
    })

    it('skips duplicate preload events', async function () {
        let fetchCount = 0
        const originalFetch = window.fetch
        window.fetch = function (...args) { fetchCount++; return originalFetch.apply(this, args) }

        mockResponse('GET', '/preload-test-5', 'Response')
        let btn = createProcessedHTML('<button hx-get="/preload-test-5" hx-preload="mouseenter">Click</button>')
        btn.dispatchEvent(new Event('mouseenter'))
        await htmx.timeout(10)
        btn.dispatchEvent(new Event('mouseenter'))
        await htmx.timeout(10)
        assert.equal(fetchCount, 1, 'second mouseenter should not trigger another fetch')
        window.fetch = originalFetch
    })

    it('builds URL with form params', async function () {
        let fetchedUrl = null
        const originalFetch = window.fetch
        window.fetch = function (url, ...args) {
            fetchedUrl = url
            return originalFetch.call(this, url, ...args)
        }

        mockResponse('GET', '/preload-test-6?name=test', 'Response')
        let form = createProcessedHTML('<form><input name="name" value="test"><button hx-get="/preload-test-6" hx-preload="mouseenter">Click</button></form>')
        let btn = form.querySelector('button')
        btn.dispatchEvent(new Event('mouseenter'))
        await htmx.timeout(20)
        assert.include(fetchedUrl, 'name=test')
        window.fetch = originalFetch
    })
})
