describe('Sync Strategies and Concurrent Counting', function () {

    beforeEach(function () {
        setupTest()
    })

    afterEach(function () {
        cleanupTest()
    })

    // =========================================================================
    // hx-sync abort strategy
    // =========================================================================

    describe('hx-sync abort strategy', function () {

        it('first request proceeds normally', async function () {
            mockResponse('GET', '/test', 'Response')
            createProcessedHTML('<button id="btn" hx-get="/test" hx-sync="this:abort" hx-target="this">Click</button>')
            find('#btn').click()
            await forRequest()
            assert.equal(find('#btn').innerHTML, 'Response')
        })

        it('second request while first is in-flight is dropped', async function () {
            let seq = mockSequentialResponses('GET', '/test', 'Response')
            createProcessedHTML('<button id="btn" hx-get="/test" hx-sync="this:abort" hx-target="this">Click</button>')
            find('#btn').click()
            find('#btn').click()
            await htmx.timeout(20)
            assert.equal(fetchMock.calls.length, 1)
            let done = forRequest()
            await seq.next()
            await done
        })

        it('after first request completes, new request proceeds', async function () {
            let seq = mockSequentialResponses('GET', '/test', 'First')
            createProcessedHTML('<button id="btn" hx-get="/test" hx-sync="this:abort" hx-target="this">Click</button>')
            find('#btn').click()
            let done = forRequest()
            await seq.next()
            await done
            assert.equal(find('#btn').innerHTML, 'First')

            mockResponse('GET', '/test', 'Second')
            find('#btn').click()
            await forRequest()
            assert.equal(find('#btn').innerHTML, 'Second')
        })
    })

    // =========================================================================
    // Concurrent indicator counting
    // =========================================================================

    describe('concurrent indicator counting', function () {

        it('single request activates and deactivates indicator', async function () {
            let seq = mockSequentialResponses('GET', '/test', 'Done')
            createProcessedHTML(`
                <div>
                    <span id="ind" class="indicator">Loading</span>
                    <button id="btn" hx-get="/test" hx-indicator="#ind" hx-swap="none">Click</button>
                </div>
            `)
            find('#btn').click()
            await htmx.timeout(20)
            assert.isTrue(find('#ind').classList.contains('htmx-request'), 'indicator should be active during request')
            let done = forRequest()
            await seq.next()
            await done
            assert.isFalse(find('#ind').classList.contains('htmx-request'), 'indicator should be inactive after request')
        })

        it('indicator stays active until ALL concurrent requests complete', async function () {
            let seq1 = mockSequentialResponses('GET', '/test1', 'R1')
            let seq2 = mockSequentialResponses('GET', '/test2', 'R2')
            createProcessedHTML(`
                <div>
                    <span id="ind" class="indicator">Loading</span>
                    <button id="btn1" hx-get="/test1" hx-indicator="#ind" hx-swap="none">A</button>
                    <button id="btn2" hx-get="/test2" hx-indicator="#ind" hx-swap="none">B</button>
                </div>
            `)
            find('#btn1').click()
            find('#btn2').click()
            await htmx.timeout(20)
            assert.isTrue(find('#ind').classList.contains('htmx-request'), 'indicator active with 2 requests')

            // Complete first request — start listening before releasing
            let done1 = waitForEvent('htmx:finally')
            await seq1.next()
            await done1
            await htmx.timeout(10)
            assert.isTrue(find('#ind').classList.contains('htmx-request'), 'indicator still active with 1 request remaining')

            // Complete second request
            let done2 = waitForEvent('htmx:finally')
            await seq2.next()
            await done2
            await htmx.timeout(10)
            assert.isFalse(find('#ind').classList.contains('htmx-request'), 'indicator inactive after all requests complete')
        })
    })

    // =========================================================================
    // Concurrent disable counting
    // =========================================================================

    describe('concurrent disable counting', function () {

        it('single request disables and re-enables target', async function () {
            let seq = mockSequentialResponses('GET', '/test', 'Done')
            createProcessedHTML(`
                <div>
                    <button id="target">Target</button>
                    <button id="btn" hx-get="/test" hx-disable="#target" hx-swap="none">Click</button>
                </div>
            `)
            find('#btn').click()
            await htmx.timeout(20)
            assert.isTrue(find('#target').hasAttribute('disabled'), 'target should be disabled during request')
            let done = forRequest()
            await seq.next()
            await done
            assert.isFalse(find('#target').hasAttribute('disabled'), 'target should be re-enabled after request')
        })

        it('target stays disabled until ALL concurrent requests complete', async function () {
            let seq1 = mockSequentialResponses('GET', '/test1', 'R1')
            let seq2 = mockSequentialResponses('GET', '/test2', 'R2')
            createProcessedHTML(`
                <div>
                    <button id="target">Target</button>
                    <button id="btn1" hx-get="/test1" hx-disable="#target" hx-swap="none">A</button>
                    <button id="btn2" hx-get="/test2" hx-disable="#target" hx-swap="none">B</button>
                </div>
            `)
            find('#btn1').click()
            find('#btn2').click()
            await htmx.timeout(20)
            assert.isTrue(find('#target').hasAttribute('disabled'), 'disabled with 2 requests')

            let done1 = waitForEvent('htmx:finally')
            await seq1.next()
            await done1
            await htmx.timeout(10)
            assert.isTrue(find('#target').hasAttribute('disabled'), 'still disabled with 1 remaining')

            let done2 = waitForEvent('htmx:finally')
            await seq2.next()
            await done2
            await htmx.timeout(10)
            assert.isFalse(find('#target').hasAttribute('disabled'), 're-enabled after all complete')
        })
    })

    // =========================================================================
    // Request abort via event
    // =========================================================================

    describe('request abort via htmx:abort', function () {

        it('dispatching htmx:abort cancels in-flight request', async function () {
            let seq = mockSequentialResponses('GET', '/test', 'Should not appear')
            createProcessedHTML('<div id="d" hx-get="/test" hx-target="this">Original</div>')
            find('#d').click()
            await htmx.timeout(20)

            htmx.trigger(find('#d'), 'htmx:abort')
            await htmx.timeout(50)

            assert.include(find('#d').innerHTML, 'Original')
        })
    })
})
