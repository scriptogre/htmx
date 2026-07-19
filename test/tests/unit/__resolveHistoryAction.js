describe('__resolveHistoryAction unit tests', function() {

    it('returns null when no push or replace is requested', function() {
        assert.isNull(
            htmx.__resolveHistoryAction(null, null, false, '/fallback')
        )
    })

    it('returns a push action', function() {
        assert.deepEqual(
            htmx.__resolveHistoryAction('/pushed', null, false, '/fallback'),
            {pushUrl: '/pushed'}
        )
    })

    it('returns a replace action', function() {
        assert.deepEqual(
            htmx.__resolveHistoryAction(null, '/replaced', false, '/fallback'),
            {replaceUrl: '/replaced'}
        )
    })

    it('ignores push false', function() {
        assert.isNull(
            htmx.__resolveHistoryAction('false', null, false, '/fallback')
        )
    })

    it('ignores replace false', function() {
        assert.isNull(
            htmx.__resolveHistoryAction(null, 'false', false, '/fallback')
        )
    })

    it('push false does not block replace', function() {
        assert.deepEqual(
            htmx.__resolveHistoryAction('false', '/new-path', false, '/fallback'),
            {replaceUrl: '/new-path'}
        )
    })

    it('replace false does not block push', function() {
        assert.deepEqual(
            htmx.__resolveHistoryAction('/new-path', 'false', false, '/fallback'),
            {pushUrl: '/new-path'}
        )
    })

    it('resolves push true from the final response URL', function() {
        assert.deepEqual(
            htmx.__resolveHistoryAction('true', null, false, 'http://localhost/resolved'),
            {pushUrl: '/resolved'}
        )
    })

    it('resolves push true from the request fallback URL', function() {
        assert.deepEqual(
            htmx.__resolveHistoryAction('true', null, false, '/fallback'),
            {pushUrl: '/fallback'}
        )
    })

    it('push takes precedence over replace', function() {
        assert.deepEqual(
            htmx.__resolveHistoryAction('/push-path', '/replace-path', false, '/fallback'),
            {pushUrl: '/push-path'}
        )
    })

    it('boosted requests push the final URL by default', function() {
        assert.deepEqual(
            htmx.__resolveHistoryAction(null, null, true, '/boosted'),
            {pushUrl: '/boosted'}
        )
    })

    it('adds the request anchor when resolving true', function() {
        assert.deepEqual(
            htmx.__resolveHistoryAction(true, null, false, '/resolved?tab=one', 'details'),
            {pushUrl: '/resolved?tab=one#details'}
        )
    })

});
