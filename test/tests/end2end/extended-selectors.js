describe('Extended Selectors', function () {

    beforeEach(function () {
        setupTest()
    })

    afterEach(function () {
        cleanupTest()
    })

    // =========================================================================
    // next keyword
    // =========================================================================

    it('hx-target="next div" targets the next sibling matching selector', async function () {
        mockResponse('GET', '/test', 'Swapped')
        createProcessedHTML(`
            <div>
                <button id="btn" hx-get="/test" hx-target="next div">Click</button>
                <span id="skip">Not this</span>
                <div id="target">Original</div>
            </div>
        `)
        find('#btn').click()
        await forRequest()
        assert.equal(find('#target').innerHTML, 'Swapped')
        assert.equal(find('#skip').innerHTML, 'Not this')
    })

    it('hx-target="next" targets the immediate next element sibling', async function () {
        mockResponse('GET', '/test', 'Swapped')
        createProcessedHTML(`
            <div>
                <button id="btn" hx-get="/test" hx-target="next">Click</button>
                <div id="target">Original</div>
            </div>
        `)
        find('#btn').click()
        await forRequest()
        assert.equal(find('#target').innerHTML, 'Swapped')
    })

    // =========================================================================
    // previous keyword
    // =========================================================================

    it('hx-target="previous div" targets the previous sibling matching selector', async function () {
        mockResponse('GET', '/test', 'Swapped')
        createProcessedHTML(`
            <div>
                <div id="target">Original</div>
                <span id="skip">Not this</span>
                <button id="btn" hx-get="/test" hx-target="previous div">Click</button>
            </div>
        `)
        find('#btn').click()
        await forRequest()
        assert.equal(find('#target').innerHTML, 'Swapped')
        assert.equal(find('#skip').innerHTML, 'Not this')
    })

    it('hx-target="previous" targets the immediate previous element sibling', async function () {
        mockResponse('GET', '/test', 'Swapped')
        createProcessedHTML(`
            <div>
                <div id="target">Original</div>
                <button id="btn" hx-get="/test" hx-target="previous">Click</button>
            </div>
        `)
        find('#btn').click()
        await forRequest()
        assert.equal(find('#target').innerHTML, 'Swapped')
    })

    // =========================================================================
    // find keyword (scoped search)
    // =========================================================================

    it('hx-target="find .inner" finds first match within the element', async function () {
        mockResponse('GET', '/test', 'Swapped')
        createProcessedHTML(`
            <div id="container" hx-get="/test" hx-target="find .inner" hx-trigger="click">
                <div class="inner" id="target">Original</div>
                <div class="inner" id="second">Also inner</div>
            </div>
        `)
        find('#container').click()
        await forRequest()
        assert.equal(find('#target').innerHTML, 'Swapped')
        assert.equal(find('#second').innerHTML, 'Also inner')
    })

    it('hx-target="find .inner" does not find elements outside the element', async function () {
        mockResponse('GET', '/test', 'Found')
        createProcessedHTML(`
            <div>
                <div class="inner" id="outside">Outside</div>
                <div id="container" hx-get="/test" hx-target="find .inner" hx-trigger="click">
                    <div class="inner" id="inside">Inside</div>
                </div>
            </div>
        `)
        find('#container').click()
        await forRequest()
        assert.equal(find('#inside').innerHTML, 'Found')
        assert.equal(find('#outside').innerHTML, 'Outside')
    })

    // =========================================================================
    // global prefix
    // =========================================================================

    // global prefix only supported in htmx.findAllExt, not in api.find/hx-target
    it.skip('hx-target="global .target" finds element anywhere in the document', async function () {
        mockResponse('GET', '/test', 'Swapped')
        createProcessedHTML(`
            <div>
                <div id="far-away">
                    <span class="target" id="global-target">Original</span>
                </div>
                <div id="nested">
                    <button id="btn" hx-get="/test" hx-target="global .target">Click</button>
                </div>
            </div>
        `)
        find('#btn').click()
        await forRequest()
        assert.equal(find('#global-target').innerHTML, 'Swapped')
    })

    // =========================================================================
    // closest keyword
    // =========================================================================

    it('hx-target="closest div" targets the nearest ancestor div', async function () {
        mockResponse('GET', '/test', 'Swapped')
        createProcessedHTML(`
            <div id="outer">
                <div id="inner">
                    <button id="btn" hx-get="/test" hx-target="closest div">Click</button>
                </div>
            </div>
        `)
        find('#btn').click()
        await forRequest()
        assert.equal(find('#inner').innerHTML, 'Swapped')
    })

    // =========================================================================
    // comma-separated selectors
    // =========================================================================

    it('hx-indicator with comma-separated selectors activates multiple indicators', async function () {
        let seq = mockSequentialResponses('GET', '/test', 'Done')
        createProcessedHTML(`
            <div>
                <span id="ind1" class="indicator">Loading 1</span>
                <span id="ind2" class="indicator">Loading 2</span>
                <button id="btn" hx-get="/test" hx-indicator="#ind1, #ind2" hx-swap="none">Click</button>
            </div>
        `)
        find('#btn').click()
        await htmx.timeout(20)
        assert.isTrue(find('#ind1').classList.contains('htmx-request'), 'ind1 should have htmx-request')
        assert.isTrue(find('#ind2').classList.contains('htmx-request'), 'ind2 should have htmx-request')
        let done = forRequest()
        await seq.next()
        await done
    })

    // =========================================================================
    // hyperscript-style selectors
    // =========================================================================

    // hyperscript-style selectors only supported in htmx.findAllExt, not in api.find/hx-target
    it.skip('hx-target with hyperscript-style <.foo/> selector works', async function () {
        mockResponse('GET', '/test', 'Swapped')
        createProcessedHTML(`
            <div>
                <div class="foo" id="target">Original</div>
                <button id="btn" hx-get="/test" hx-target="<.foo/>">Click</button>
            </div>
        `)
        find('#btn').click()
        await forRequest()
        assert.equal(find('#target').innerHTML, 'Swapped')
    })

    // =========================================================================
    // edge cases
    // =========================================================================

    it('next .nonexistent does not crash', async function () {
        mockResponse('GET', '/test', 'Response')
        createProcessedHTML(`
            <div>
                <button id="btn" hx-get="/test" hx-target="next .nonexistent">Click</button>
            </div>
        `)
        find('#btn').click()
        await htmx.timeout(50)
    })

    it('next with no following siblings does not crash', async function () {
        mockResponse('GET', '/test', 'Response')
        createProcessedHTML(`
            <div>
                <button id="btn" hx-get="/test" hx-target="next">Click</button>
            </div>
        `)
        find('#btn').click()
        await htmx.timeout(50)
    })
})
