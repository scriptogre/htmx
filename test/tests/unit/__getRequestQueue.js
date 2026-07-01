describe('__getRequestQueue / RequestQueue unit tests', function() {

    beforeEach(function() {
        setupTest();
    });

    afterEach(function() {
        cleanupTest();
    });

    function requestQueue() {
        let div = createProcessedHTML('<div hx-get="/test"></div>')
        return htmx.__getRequestQueue(div)
    }

    it('allows first request when queue is empty', async function () {
        let queue = requestQueue()
        let slot = await queue.enter('queue first')

        assert.isOk(slot)
        slot.leave()
    })

    it('queues request with "queue all" strategy', async function () {
        let queue = requestQueue()
        let first = await queue.enter('queue all')
        let secondStarted = false
        let secondPromise = queue.enter('queue all').then(slot => {
            secondStarted = true
            return slot
        })

        await Promise.resolve()
        assert.isFalse(secondStarted)

        first.leave()
        let second = await secondPromise

        assert.isOk(second)
        second.leave()
    })

    it('drops request with "drop" strategy', async function () {
        let queue = requestQueue()
        let first = await queue.enter('drop')
        let second = await queue.enter('drop')

        assert.isNull(second)
        first.leave()
    })

    it('queues only last with "queue last" strategy', async function () {
        let queue = requestQueue()
        let first = await queue.enter('queue last')
        let secondPromise = queue.enter('queue last')
        let thirdStarted = false
        let thirdPromise = queue.enter('queue last').then(slot => {
            thirdStarted = true
            return slot
        })

        let second = await secondPromise
        assert.isNull(second)

        await Promise.resolve()
        assert.isFalse(thirdStarted)

        first.leave()
        let third = await thirdPromise

        assert.isOk(third)
        third.leave()
    })

    it('replaces current request with "replace" strategy', async function () {
        let queue = requestQueue()
        let aborted = false
        let first = await queue.enter('replace', () => { aborted = true })

        let second = await queue.enter('replace')

        assert.isOk(second)
        assert.isTrue(aborted)
        first.leave()
        second.leave()
    })

    it('defaults to "queue first" when strategy not specified', async function () {
        let queue = requestQueue()
        let first = await queue.enter('queue first')
        let secondStarted = false
        let secondPromise = queue.enter('queue first').then(slot => {
            secondStarted = true
            return slot
        })
        let third = await queue.enter('queue first')

        assert.isNull(third)

        await Promise.resolve()
        assert.isFalse(secondStarted)

        first.leave()
        let second = await secondPromise

        assert.isOk(second)
        second.leave()
    })

    it('waits until a queued request can run', async function () {
        let queue = requestQueue()
        let first = await queue.enter('queue all')
        let started = false
        let secondPromise = queue.enter('queue all').then(slot => {
            started = true
            return slot
        })

        await Promise.resolve()
        assert.isFalse(started)

        first.leave()
        let second = await secondPromise

        assert.isTrue(started)
        assert.isOk(second)
        second.leave()
    })

    it('abort() calls abort on current request', async function () {
        let queue = requestQueue()
        let aborted = false
        let slot = await queue.enter('queue first', () => { aborted = true })

        queue.abort()

        assert.isTrue(aborted)
        slot.leave()
    })

    it('returns same queue for same element', function () {
        let div = createProcessedHTML('<div hx-get="/test"></div>')

        assert.equal(htmx.__getRequestQueue(div), htmx.__getRequestQueue(div))
    })

    it('returns different queue for different elements', function () {
        let div1 = createProcessedHTML('<div hx-get="/test1"></div>')
        let div2 = createProcessedHTML('<div hx-get="/test2"></div>')

        assert.notEqual(htmx.__getRequestQueue(div1), htmx.__getRequestQueue(div2))
    })

    it('hx-sync="drop" without selector uses drop strategy', async function () {
        let div = createProcessedHTML('<div hx-get="/test" hx-sync="drop"></div>')
        let queue = htmx.__getRequestQueue(div)
        let strategy = htmx.__determineSyncStrategy(div)

        let first = await queue.enter(strategy)
        let second = await queue.enter(strategy)

        assert.isNull(second)
        first.leave()
    })

    it('hx-sync="abort" without selector uses abort strategy', async function () {
        let div = createProcessedHTML('<div hx-get="/test" hx-sync="abort"></div>')
        let queue = htmx.__getRequestQueue(div)
        let strategy = htmx.__determineSyncStrategy(div)

        let first = await queue.enter(strategy)
        let second = await queue.enter(strategy)

        assert.isNull(second)
        first.leave()
    })

    it('hx-sync="selector:drop" uses drop strategy', function () {
        let container = createProcessedHTML('<div id="c"><div id="btn" hx-get="/test" hx-sync="#c:drop"></div></div>')
        let btn = container.querySelector('#btn')

        assert.equal(htmx.__determineSyncStrategy(btn), 'drop')
    })

    it('uses selector from hx-sync for queue', function () {
        let container = createProcessedHTML('<div id="container"><div id="btn1" hx-get="/test1" hx-sync="#container:drop"></div><div id="btn2" hx-get="/test2" hx-sync="#container:drop"></div></div>')
        let btn1 = container.querySelector('#btn1')
        let btn2 = container.querySelector('#btn2')

        assert.equal(htmx.__getRequestQueue(btn1), htmx.__getRequestQueue(btn2))
    })

    it('inherited hx-sync="this:replace" resolves queue to declaring parent', function () {
        let parent = createProcessedHTML('<div id="parent" hx-sync:inherited="this:replace"><div id="a" hx-get="/a"></div><div id="b" hx-get="/b"></div></div>')
        let a = parent.querySelector('#a')
        let b = parent.querySelector('#b')

        assert.equal(htmx.__getRequestQueue(a), htmx.__getRequestQueue(b))
        assert.equal(htmx.__htmxState(parent).rq, htmx.__getRequestQueue(a))
        assert.equal(htmx.__determineSyncStrategy(a), 'replace')
    })

    it('abort strategy: allows first abort request when queue is empty', async function () {
        let queue = requestQueue()
        let slot = await queue.enter('abort')

        assert.isOk(slot)
        slot.leave()
    })

    it('abort strategy: any request can abort an abortable request', async function () {
        let queue = requestQueue()
        let aborted = false
        let first = await queue.enter('abort', () => { aborted = true })

        let second = await queue.enter('drop')

        assert.isOk(second)
        assert.isTrue(aborted)
        first.leave()
        second.leave()
    })

    it('abort strategy: another abort request drops when abort request is in flight', async function () {
        let queue = requestQueue()
        let aborted = false
        let first = await queue.enter('abort', () => { aborted = true })

        let second = await queue.enter('abort')

        assert.isNull(second)
        assert.isFalse(aborted)
        first.leave()
    })

    it('abort strategy: abort request drops itself if non-abortable request is in flight', async function () {
        let queue = requestQueue()
        let aborted = false
        let first = await queue.enter('drop', () => { aborted = true })

        let second = await queue.enter('abort')

        assert.isNull(second)
        assert.isFalse(aborted)
        first.leave()
    })

    it('abort strategy: replace request can abort an abortable request', async function () {
        let queue = requestQueue()
        let aborted = false
        let first = await queue.enter('abort', () => { aborted = true })

        let second = await queue.enter('replace')

        assert.isOk(second)
        assert.isTrue(aborted)
        first.leave()
        second.leave()
    })

    it('abort strategy: queue-all request can abort an abortable request', async function () {
        let queue = requestQueue()
        let aborted = false
        let first = await queue.enter('abort', () => { aborted = true })

        let second = await queue.enter('queue all')

        assert.isOk(second)
        assert.isTrue(aborted)
        first.leave()
        second.leave()
    })

    it('abort strategy: abort request drops itself when replace request is in flight', async function () {
        let queue = requestQueue()
        let aborted = false
        let first = await queue.enter('replace', () => { aborted = true })

        let second = await queue.enter('abort')

        assert.isNull(second)
        assert.isFalse(aborted)
        first.leave()
    })

    it('abort strategy: abort request drops itself when queue-first request is in flight', async function () {
        let queue = requestQueue()
        let aborted = false
        let first = await queue.enter('queue first', () => { aborted = true })

        let second = await queue.enter('abort')

        assert.isNull(second)
        assert.isFalse(aborted)
        first.leave()
    })

    it('hx-sync="this" defaults to queue first strategy', function () {
        let div = createProcessedHTML('<div hx-get="/test" hx-sync="this"></div>')

        assert.equal(htmx.__determineSyncStrategy(div), 'queue first')
    })

    it('hx-sync="this" uses same element for queue', function () {
        let div = createProcessedHTML('<div hx-get="/test" hx-sync="this"></div>')

        assert.isOk(htmx.__getRequestQueue(div))
    })

    it('hx-sync="this:drop" uses drop strategy', function () {
        let div = createProcessedHTML('<div hx-get="/test" hx-sync="this:drop"></div>')

        assert.equal(htmx.__determineSyncStrategy(div), 'drop')
    })

    it('hx-sync="this:replace" uses replace strategy', function () {
        let div = createProcessedHTML('<div hx-get="/test" hx-sync="this:replace"></div>')

        assert.equal(htmx.__determineSyncStrategy(div), 'replace')
    })

    it('hx-sync="this:queue last" uses queue last strategy', function () {
        let div = createProcessedHTML('<div hx-get="/test" hx-sync="this:queue last"></div>')

        assert.equal(htmx.__determineSyncStrategy(div), 'queue last')
    })

    it('hx-sync="closest form" uses closest form for queue with default strategy', function () {
        let form = createProcessedHTML('<form><div id="btn" hx-get="/test" hx-sync="closest form"></div></form>')
        let btn = form.querySelector('#btn')
        let queue = htmx.__getRequestQueue(btn)

        assert.equal(htmx.__determineSyncStrategy(btn), 'queue first')
        assert.equal(htmx.__htmxState(form).rq, queue)
    })

    it('hx-sync="closest form:replace" uses closest form with replace strategy', function () {
        let form = createProcessedHTML('<form><div id="btn" hx-get="/test" hx-sync="closest form:replace"></div></form>')
        let btn = form.querySelector('#btn')
        let queue = htmx.__getRequestQueue(btn)

        assert.equal(htmx.__determineSyncStrategy(btn), 'replace')
        assert.equal(htmx.__htmxState(form).rq, queue)
    })

    it('hx-sync with "this" shares queue between sibling elements synced to parent', function () {
        let container = createProcessedHTML('<div id="c"><div id="a" hx-get="/a" hx-sync="#c:drop"></div><div id="b" hx-get="/b" hx-sync="#c:drop"></div></div>')
        let a = container.querySelector('#a')
        let b = container.querySelector('#b')

        assert.equal(htmx.__getRequestQueue(a), htmx.__getRequestQueue(b))
    })

    it('abort strategy: clears queue when aborting current request', async function () {
        let queue = requestQueue()
        let aborted = false
        let first = await queue.enter('drop', () => { aborted = true })
        let secondPromise = queue.enter('queue all')
        let thirdPromise = queue.enter('queue all')

        let fourth = await queue.enter('replace')
        let second = await secondPromise
        let third = await thirdPromise

        assert.isOk(fourth)
        assert.isTrue(aborted)
        assert.isNull(second)
        assert.isNull(third)
        first.leave()
        fourth.leave()
    })

    it('ignores stale finishes from replaced requests', async function () {
        let queue = requestQueue()
        let aborted = false
        let first = await queue.enter('replace', () => { aborted = true })
        let second = await queue.enter('replace')
        let thirdStarted = false
        let thirdPromise = queue.enter('queue all').then(slot => {
            thirdStarted = true
            return slot
        })

        first.leave()
        await Promise.resolve()
        assert.isFalse(thirdStarted)

        second.leave()
        let third = await thirdPromise

        assert.isTrue(aborted)
        assert.isOk(third)
        third.leave()
    })

});
