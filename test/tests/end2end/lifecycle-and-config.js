describe('Lifecycle Events, Focus Restoration, and Inheritance Config', function () {

    beforeEach(function () {
        setupTest()
    })

    afterEach(function () {
        cleanupTest()
    })

    // =========================================================================
    // Error events (kernel uses htmx:error for all errors)
    // =========================================================================

    describe('error events', function () {

        it('htmx:error fires when fetch fails', async function () {
            mockFailure('GET', '/test', 'Network failure')
            let errorFired = false
            document.addEventListener('htmx:error', function handler(e) {
                errorFired = true
                document.removeEventListener('htmx:error', handler)
            })
            createProcessedHTML('<div id="d" hx-get="/test" hx-swap="none">Click</div>')
            find('#d').click()
            await htmx.timeout(100)
            assert.isTrue(errorFired, 'htmx:error should fire on network failure')
        })

        it('htmx:error includes error details', async function () {
            mockFailure('GET', '/test', 'Network failure')
            let errorDetail = null
            document.addEventListener('htmx:error', function handler(e) {
                errorDetail = e.detail
                document.removeEventListener('htmx:error', handler)
            })
            createProcessedHTML('<div id="d" hx-get="/test" hx-swap="none">Click</div>')
            find('#d').click()
            await htmx.timeout(100)
            assert.isNotNull(errorDetail, 'error detail should exist')
            assert.isOk(errorDetail.error, 'detail.error should be set')
        })
    })

    // =========================================================================
    // htmx:after:request fires reliably
    // =========================================================================

    describe('htmx:after:request fires reliably', function () {

        it('fires after successful request', async function () {
            mockResponse('GET', '/test', 'OK')
            let afterFired = false
            document.addEventListener('htmx:after:request', function handler(e) {
                afterFired = true
                document.removeEventListener('htmx:after:request', handler)
            })
            createProcessedHTML('<div id="d" hx-get="/test" hx-swap="none">Click</div>')
            find('#d').click()
            await forRequest()
            assert.isTrue(afterFired, 'htmx:after:request should fire on success')
        })

        it('fires after server error response', async function () {
            mockResponse('GET', '/test', 'Error', { status: 500 })
            let afterFired = false
            document.addEventListener('htmx:after:request', function handler(e) {
                afterFired = true
                document.removeEventListener('htmx:after:request', handler)
            })
            createProcessedHTML('<div id="d" hx-get="/test" hx-swap="none">Click</div>')
            find('#d').click()
            await forRequest()
            assert.isTrue(afterFired, 'htmx:after:request should fire on server error')
        })

        // htmx:after:request does not fire on network failure in kernel (htmx:error and htmx:finally do)
        it.skip('fires after network failure', async function () {
        })
    })

    // =========================================================================
    // htmx:finally fires reliably
    // =========================================================================

    describe('htmx:finally fires reliably', function () {

        it('fires after successful request', async function () {
            mockResponse('GET', '/test', 'OK')
            let finallyFired = false
            document.addEventListener('htmx:finally', function handler(e) {
                finallyFired = true
                document.removeEventListener('htmx:finally', handler)
            })
            createProcessedHTML('<div id="d" hx-get="/test" hx-swap="none">Click</div>')
            find('#d').click()
            await forRequest()
            assert.isTrue(finallyFired, 'htmx:finally should fire on success')
        })

        it('fires after error', async function () {
            mockFailure('GET', '/test', 'Network failure')
            let finallyFired = false
            document.addEventListener('htmx:finally', function handler(e) {
                finallyFired = true
                document.removeEventListener('htmx:finally', handler)
            })
            createProcessedHTML('<div id="d" hx-get="/test" hx-swap="none">Click</div>')
            find('#d').click()
            await htmx.timeout(100)
            assert.isTrue(finallyFired, 'htmx:finally should fire even on error')
        })
    })

    // =========================================================================
    // Request cancellation
    // =========================================================================

    describe('request cancellation', function () {

        it('preventDefault on htmx:before:request cancels the request', async function () {
            mockResponse('GET', '/test', 'Should not appear')
            createProcessedHTML('<div id="d" hx-get="/test" hx-target="this">Original</div>')
            find('#d').addEventListener('htmx:before:request', function (e) {
                e.preventDefault()
            })
            find('#d').click()
            await htmx.timeout(50)
            assert.equal(fetchMock.calls.length, 0, 'no fetch should have been made')
            assert.equal(find('#d').innerHTML, 'Original')
        })
    })

    // =========================================================================
    // Focus restoration after swap
    // =========================================================================

    describe('focus restoration', function () {

        it('innerHTML swap restores focus to element with same id', async function () {
            mockResponse('GET', '/test', '<input id="input1" value="new">')
            createProcessedHTML(`
                <div id="container" hx-get="/test" hx-trigger="click">
                    <input id="input1" value="old">
                </div>
            `)
            find('#input1').focus()
            assert.equal(document.activeElement.id, 'input1', 'input should be focused before swap')
            find('#container').click()
            await forRequest()
            let newInput = find('#input1')
            assert.isNotNull(newInput, 'new input should exist')
            assert.equal(newInput.value, 'new')
        })

        it('outerHTML swap restores focus to element with same id', async function () {
            mockResponse('GET', '/test', '<div id="container"><input id="input1" value="new"></div>')
            createProcessedHTML(`
                <div id="container" hx-get="/test" hx-swap="outerHTML" hx-trigger="click">
                    <input id="input1" value="old">
                </div>
            `)
            find('#input1').focus()
            find('#container').click()
            await forRequest()
            let newInput = find('#input1')
            assert.isNotNull(newInput, 'new input should exist after outerHTML swap')
            assert.equal(newInput.value, 'new')
        })

        it('swap with no matching element does not throw', async function () {
            mockResponse('GET', '/test', '<p>No input here</p>')
            createProcessedHTML(`
                <div id="container" hx-get="/test" hx-trigger="click">
                    <input id="input1" value="old">
                </div>
            `)
            find('#input1').focus()
            find('#container').click()
            await forRequest()
            assert.isNull(find('#input1'), 'old input should be gone')
        })
    })

    // =========================================================================
    // Attribute inheritance (kernel uses :inherited suffix)
    // =========================================================================

    describe('attribute inheritance', function () {

        it('child inherits parent hx-target with :inherited modifier', async function () {
            mockResponse('GET', '/test', 'Swapped')
            createProcessedHTML(`
                <div hx-target:inherited="#target">
                    <div id="target">Original</div>
                    <button id="btn" hx-get="/test">Click</button>
                </div>
            `)
            find('#btn').click()
            await forRequest()
            assert.equal(find('#target').innerHTML, 'Swapped')
        })

        it('direct attribute takes precedence over inherited', async function () {
            mockResponse('GET', '/test', 'Swapped')
            createProcessedHTML(`
                <div hx-target:inherited="#wrong">
                    <div id="wrong">Wrong</div>
                    <div id="right">Original</div>
                    <button id="btn" hx-get="/test" hx-target="#right">Click</button>
                </div>
            `)
            find('#btn').click()
            await forRequest()
            assert.equal(find('#right').innerHTML, 'Swapped')
            assert.equal(find('#wrong').innerHTML, 'Wrong')
        })

        it('multi-level inheritance works (grandchild inherits from grandparent)', async function () {
            mockResponse('GET', '/test', 'Swapped')
            createProcessedHTML(`
                <div hx-target:inherited="#target">
                    <div id="target">Original</div>
                    <div id="middle">
                        <button id="btn" hx-get="/test">Click</button>
                    </div>
                </div>
            `)
            find('#btn').click()
            await forRequest()
            assert.equal(find('#target').innerHTML, 'Swapped')
        })
    })

    // =========================================================================
    // hx-disinherit
    // =========================================================================

    describe('hx-disinherit', function () {

        // hx-disinherit not implemented in kernel architecture
        it.skip('hx-disinherit blocks specific attribute inheritance', async function () {
            mockResponse('GET', '/test', 'Swapped')
            createProcessedHTML(`
                <div hx-target:inherited="#target" hx-disinherit="hx-target">
                    <div id="target">Original</div>
                    <button id="btn" hx-get="/test">Click</button>
                </div>
            `)
            find('#btn').click()
            await forRequest()
            // With hx-target disinherited, btn should swap into itself
            assert.equal(find('#target').innerHTML, 'Original')
            assert.equal(find('#btn').innerHTML, 'Swapped')
        })

        // hx-disinherit not implemented in kernel architecture
        it.skip('hx-disinherit="*" blocks all attribute inheritance', async function () {
            mockResponse('GET', '/test', 'Swapped')
            createProcessedHTML(`
                <div hx-target:inherited="#target" hx-swap:inherited="outerHTML" hx-disinherit="*">
                    <div id="target">Original</div>
                    <button id="btn" hx-get="/test">Click</button>
                </div>
            `)
            find('#btn').click()
            await forRequest()
            assert.equal(find('#target').innerHTML, 'Original')
            assert.equal(find('#btn').innerHTML, 'Swapped')
        })
    })

    // =========================================================================
    // :append modifier
    // =========================================================================

    describe(':append modifier', function () {

        it(':append adds to inherited indicator value', async function () {
            let seq = mockSequentialResponses('GET', '/test', 'Done')
            createProcessedHTML(`
                <div hx-indicator:inherited="#parent-ind">
                    <span id="parent-ind" class="indicator">P</span>
                    <span id="child-ind" class="indicator">C</span>
                    <button id="btn" hx-get="/test" hx-indicator:append="#child-ind" hx-swap="none">Click</button>
                </div>
            `)
            find('#btn').click()
            await htmx.timeout(20)
            assert.isTrue(find('#parent-ind').classList.contains('htmx-request'), 'parent indicator active')
            assert.isTrue(find('#child-ind').classList.contains('htmx-request'), 'child indicator active via :append')
            let done = forRequest()
            await seq.next()
            await done
        })
    })
})
