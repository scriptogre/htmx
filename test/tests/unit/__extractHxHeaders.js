describe('__extractHxHeaders unit tests', function() {

    beforeEach(function() {
        setupTest();
    });

    afterEach(function() {
        cleanupTest();
    });

    it('extracts HX headers from response headers', function () {
        let result = htmx.__extractHxHeaders(new Headers({
            'HX-Trigger': 'myEvent',
            'HX-Redirect': '/new-page',
            'Content-Type': 'text/html'
        }))

        assert.equal(result.trigger, 'myEvent')
        assert.equal(result.redirect, '/new-page')
        assert.isUndefined(result.contenttype)
    })

    it('converts header names to camelCase', function () {
        let result = htmx.__extractHxHeaders(new Headers({
            'HX-Push-Url': '/new-url',
            'HX-Replace-Url': '/replace-url',
            'HX-Reswap': 'outerHTML'
        }))

        assert.equal(result.pushUrl, '/new-url')
        assert.equal(result.replaceUrl, '/replace-url')
        assert.equal(result.reswap, 'outerHTML')
    })

    it('handles empty headers', function () {
        let result = htmx.__extractHxHeaders(new Headers())

        assert.deepEqual(result, {})
    })

    it('only extracts headers that start with HX-', function () {
        let result = htmx.__extractHxHeaders(new Headers({
            'HX-Trigger': 'myEvent',
            'X-Custom-Header': 'value',
            'Content-Type': 'text/html',
            'HX-Refresh': 'true'
        }))

        assert.equal(result.trigger, 'myEvent')
        assert.equal(result.refresh, 'true')
        assert.isUndefined(result.customheader)
        assert.isUndefined(result.contenttype)
    })

    it('handles case-insensitive HX- prefix', function () {
        let result = htmx.__extractHxHeaders(new Headers({
            'hx-trigger': 'lowercase',
            'Hx-Redirect': 'mixedcase',
            'HX-REFRESH': 'uppercase'
        }))

        assert.equal(result.trigger, 'lowercase')
        assert.equal(result.redirect, 'mixedcase')
        assert.equal(result.refresh, 'uppercase')
    })

    it('handles plain objects and Headers instances the same way', function () {
        let objectResult = htmx.__extractHxHeaders({
            'HX-Push-Url': '/new-url',
            'HX-Request-Type': 'partial'
        })
        let headersResult = htmx.__extractHxHeaders(new Headers({
            'HX-Push-Url': '/new-url',
            'HX-Request-Type': 'partial'
        }))

        assert.deepEqual(objectResult, headersResult)
        assert.deepEqual(objectResult, {
            pushUrl: '/new-url',
            requestType: 'partial'
        })
    })

    it('returns a fresh object for each extraction', function () {
        let first = htmx.__extractHxHeaders(new Headers({
            'HX-Trigger': 'oldEvent'
        }))
        let second = htmx.__extractHxHeaders(new Headers({
            'HX-Redirect': '/new-page'
        }))

        assert.equal(first.trigger, 'oldEvent')
        assert.equal(second.redirect, '/new-page')
        assert.isUndefined(second.trigger)
    })

});
