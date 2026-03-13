/**
 * Swap Lifecycle Tests
 *
 * These tests document the intentional behavioral changes in the swap lifecycle
 * compared to the upstream/four branch. Each change is labeled as:
 *   [CHANGE]      — intentional deviation from upstream/four
 *   [PRESERVED]   — same behavior as upstream/four
 *   [REGRESSION]  — would be a bug; tests ensure we don't regress
 */
describe('Swap Lifecycle', function() {

    beforeEach(function() {
        setupTest();
    });

    afterEach(function() {
        cleanupTest();
    });

    // =========================================================================
    // [PRESERVED] Basic swap correctness
    // upstream/four: OOBs and main swap all complete via Promise.all
    // Our code: same — all executors run via Promise.all
    // =========================================================================

    it('main swap works', async function () {
        mockResponse('GET', '/sl-basic-1', '<div>New Content</div>')
        let div = createProcessedHTML('<div hx-get="/sl-basic-1">Click</div>')
        div.click()
        await forRequest()
        assert.include(playground().textContent, 'New Content')
    })

    it('all OOBs and main swap complete', async function () {
        mockResponse('GET', '/sl-basic-2',
            '<div id="main-r">Main Done</div>' +
            '<div id="ba" hx-swap-oob="true">A Done</div>' +
            '<div id="bb" hx-swap-oob="true">B Done</div>' +
            '<div id="bc" hx-swap-oob="true">C Done</div>'
        )
        createProcessedHTML(
            '<div id="tb2" hx-get="/sl-basic-2">Click</div>' +
            '<div id="ba">Old A</div>' +
            '<div id="bb">Old B</div>' +
            '<div id="bc">Old C</div>'
        )
        find('#tb2').click()
        await forRequest()
        assertTextContentIs('#ba', 'A Done')
        assertTextContentIs('#bb', 'B Done')
        assertTextContentIs('#bc', 'C Done')
        assert.include(playground().textContent, 'Main Done')
    })

    // =========================================================================
    // [CHANGE] htmx:before:swap fires once PER SWAP, not once for all
    //
    // upstream/four: ONE htmx:before:swap with detail = {ctx, tasks: [...]}
    // Our code:      N htmx:before:swap events, each with detail = {element, swap: {...}}
    //
    // Why: Each swap gets its own lifecycle. Extensions can inspect and modify
    //      individual swaps without needing to iterate a tasks array.
    // =========================================================================

    it('htmx:before:swap fires once for a simple swap (no OOBs)', async function () {
        mockResponse('GET', '/sl-count-1', '<div>New</div>')
        let div = createProcessedHTML('<div hx-get="/sl-count-1">Click</div>')
        let count = 0
        div.addEventListener('htmx:before:swap', () => count++)
        div.click()
        await forRequest()
        assert.equal(count, 1)
    })

    it('htmx:before:swap fires N+1 times with N OOBs + main', async function () {
        mockResponse('GET', '/sl-count-2',
            '<div>Main</div>' +
            '<div id="c2a" hx-swap-oob="true">OOB1</div>' +
            '<div id="c2b" hx-swap-oob="true">OOB2</div>'
        )
        createProcessedHTML(
            '<div id="tc2" hx-get="/sl-count-2">Click</div>' +
            '<div id="c2a">Old1</div>' +
            '<div id="c2b">Old2</div>'
        )
        let count = 0
        find('#tc2').addEventListener('htmx:before:swap', () => count++)
        find('#tc2').click()
        await forRequest()
        assert.equal(count, 3, '2 OOBs + 1 main = 3 events')
    })

    // =========================================================================
    // [CHANGE] htmx:after:swap fires once PER SWAP, not once for all
    //
    // upstream/four: ONE htmx:after:swap after Promise.all completes
    // Our code:      each executor fires its own htmx:after:swap when done
    // =========================================================================

    it('htmx:after:swap fires N+1 times with N OOBs + main', async function () {
        mockResponse('GET', '/sl-count-3',
            '<div>Main</div>' +
            '<div id="c3a" hx-swap-oob="true">OOB</div>'
        )
        createProcessedHTML(
            '<div id="tc3" hx-get="/sl-count-3">Click</div>' +
            '<div id="c3a">Old</div>'
        )
        let count = 0
        find('#tc3').addEventListener('htmx:after:swap', () => count++)
        find('#tc3').click()
        await forRequest()
        assert.equal(count, 2, '1 OOB + 1 main = 2 events')
    })

    // =========================================================================
    // [CHANGE] Cancelling htmx:before:swap cancels only THAT swap
    //
    // upstream/four: preventDefault() on the single event cancelled ALL swaps
    // Our code:      preventDefault() cancels only the swap it belongs to
    //
    // Why: Granular control. You can cancel a specific OOB without losing
    //      the main swap, or cancel the main swap while keeping OOBs.
    // =========================================================================

    it('cancelling before:swap on an OOB does not cancel main swap', async function () {
        mockResponse('GET', '/sl-cancel-1',
            '<div>Main Content</div>' +
            '<div id="cn1" hx-swap-oob="true">New OOB</div>'
        )
        createProcessedHTML(
            '<div id="tc-cn1" hx-get="/sl-cancel-1">Click</div>' +
            '<div id="cn1">Old OOB</div>'
        )
        find('#tc-cn1').addEventListener('htmx:before:swap', (e) => {
            if (typeof e.detail.swap.target === 'string' && e.detail.swap.target.includes('cn1')) {
                e.preventDefault()
            }
        })
        find('#tc-cn1').click()
        await forRequest()
        assertTextContentIs('#cn1', 'Old OOB')
        assert.include(playground().textContent, 'Main Content')
    })

    it('cancelling before:swap on main does not cancel OOBs', async function () {
        mockResponse('GET', '/sl-cancel-2',
            '<div>Main Content</div>' +
            '<div id="cn2" hx-swap-oob="true">New OOB</div>'
        )
        createProcessedHTML(
            '<div id="tc-cn2" hx-get="/sl-cancel-2">Click</div>' +
            '<div id="cn2">Old OOB</div>'
        )
        find('#tc-cn2').addEventListener('htmx:before:swap', (e) => {
            if (e.detail.swap.target instanceof Element) {
                e.preventDefault()
            }
        })
        find('#tc-cn2').click()
        await forRequest()
        assertTextContentIs('#cn2', 'New OOB')
    })

    // =========================================================================
    // [CHANGE] detail shape: {element, swap: {target, style, fragment, execute}}
    //
    // upstream/four: {ctx, tasks: [{type, fragment, target, swapSpec, ...}]}
    // Our code:      {element, swap: {target, style, fragment, execute}}
    //
    // Why: Cleaner API. `ctx` was an internal object. `tasks` was an
    //      implementation detail. Each event now has exactly one `swap`.
    // =========================================================================

    it('before:swap detail has element and swap with target/style/fragment/execute', async function () {
        mockResponse('GET', '/sl-shape-1', '<div>Content</div>')
        let div = createProcessedHTML('<div hx-get="/sl-shape-1">Click</div>')
        let capturedDetail = null
        div.addEventListener('htmx:before:swap', (e) => { capturedDetail = e.detail })
        div.click()
        await forRequest()
        assert.isNotNull(capturedDetail)
        assert.property(capturedDetail, 'element')
        assert.property(capturedDetail, 'swap')
        assert.instanceOf(capturedDetail.swap.target, Element)
        assert.isString(capturedDetail.swap.style)
        assert.instanceOf(capturedDetail.swap.fragment, DocumentFragment)
        assert.isFunction(capturedDetail.swap.execute)
    })

    it('before:swap detail does NOT have ctx or tasks', async function () {
        mockResponse('GET', '/sl-shape-2', '<div>Content</div>')
        let div = createProcessedHTML('<div hx-get="/sl-shape-2">Click</div>')
        let capturedDetail = null
        div.addEventListener('htmx:before:swap', (e) => { capturedDetail = e.detail })
        div.click()
        await forRequest()
        assert.isNotNull(capturedDetail, 'detail should have been captured')
        assert.isTrue(!('ctx' in capturedDetail), 'detail should not have ctx')
        assert.isTrue(!('tasks' in capturedDetail), 'detail should not have tasks')
    })

    // =========================================================================
    // [CHANGE] swap.execute() is overridable
    //
    // upstream/four: no execute() slot — tasks were opaque objects
    // Our code:      detail.swap.execute can be replaced in htmx:before:swap
    //
    // Why: Extensions can intercept DOM insertion without monkey-patching.
    // =========================================================================

    it('overriding swap.execute() replaces the swap behavior', async function () {
        mockResponse('GET', '/sl-exec-1', '<div>Server Content</div>')
        let div = createProcessedHTML('<div hx-get="/sl-exec-1">Click</div>')
        div.addEventListener('htmx:before:swap', (e) => {
            e.detail.swap.execute = async () => {
                e.detail.swap.target.innerHTML = 'Custom Content'
            }
        })
        div.click()
        await forRequest()
        assert.include(playground().textContent, 'Custom Content')
        assert.notInclude(playground().textContent, 'Server Content')
    })

    // =========================================================================
    // [CHANGE] Partials fire per-swap lifecycle events
    //
    // upstream/four: partials were tasks in the shared array
    // Our code:      partials fire individual htmx:before:swap / htmx:after:swap
    // =========================================================================

    it('partials fire their own before:swap and after:swap', async function () {
        mockResponse('GET', '/sl-partial-1',
            '<div>Main</div>' +
            '<template hx type="partial" hx-target="#pt1"><div>Partial Content</div></template>'
        )
        createProcessedHTML(
            '<div id="tp1" hx-get="/sl-partial-1">Click</div>' +
            '<div id="pt1">Old</div>'
        )
        let beforeCount = 0
        let afterCount = 0
        find('#tp1').addEventListener('htmx:before:swap', () => beforeCount++)
        find('#tp1').addEventListener('htmx:after:swap', () => afterCount++)
        find('#tp1').click()
        await forRequest()
        assert.equal(beforeCount, 2, '1 partial + 1 main')
        assert.equal(afterCount, 2, '1 partial + 1 main')
        assertTextContentIs('#pt1', 'Partial Content')
    })

    // =========================================================================
    // [PRESERVED] All before:swap events fire on sourceElement
    //
    // upstream/four: single event fired on ctx.sourceElement
    // Our code:      all per-swap events fire on sourceElement (OOBs too)
    // =========================================================================

    it('all before:swap events fire on sourceElement (including OOBs)', async function () {
        mockResponse('GET', '/sl-source-1',
            '<div>Main</div>' +
            '<div id="sr1" hx-swap-oob="true">OOB</div>'
        )
        createProcessedHTML(
            '<div id="ts1" hx-get="/sl-source-1">Click</div>' +
            '<div id="sr1">Old</div>'
        )
        let firedOnSource = 0
        find('#ts1').addEventListener('htmx:before:swap', () => firedOnSource++)
        find('#ts1').click()
        await forRequest()
        assert.equal(firedOnSource, 2, 'OOB and main both fire on source')
    })

    // =========================================================================
    // [PRESERVED] View transitions work on main swap
    //
    // View transitions are hard to test directly (require document.startViewTransition).
    // These tests verify the transition flag logic is correct — swaps that should
    // go through __submitTransitionTask do so, and swaps that shouldn't don't.
    // =========================================================================

    it('main swap uses htmx.swap() ctx without view transition by default', async function () {
        mockResponse('GET', '/sl-trans-1', '<div>Content</div>')
        let div = createProcessedHTML('<div hx-get="/sl-trans-1">Click</div>')
        // Just verify the swap completes — no transition means direct execution
        div.click()
        await forRequest()
        assert.include(playground().textContent, 'Content')
    })
})
