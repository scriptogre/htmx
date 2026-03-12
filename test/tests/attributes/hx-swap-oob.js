describe('hx-swap-oob', function() {

    beforeEach(() => {
        setupTest()
    })

    afterEach(() => {
        cleanupTest()
    })

    it('swaps oob element by id with default outerHTML', async function () {
        mockResponse('GET', '/test', '<div>Main</div><div id="oob1" hx-swap-oob="true">OOB Content</div>')
        createProcessedHTML('<div hx-get="/test">Click</div><div id="oob1">Original</div>');
        find('[hx-get]').click()
        await forRequest()
        assertTextContentIs('#oob1', 'OOB Content')
    })

    it('swaps oob element with innerHTML', async function () {
        mockResponse('GET', '/test', '<div>Main</div><div id="oob2" hx-swap-oob="innerHTML">New Inner</div>')
        createProcessedHTML('<div hx-get="/test">Click</div><div id="oob2"><span>Old</span></div>');
        find('[hx-get]').click()
        await forRequest()
        assertTextContentIs('#oob2', 'New Inner')
    })

    it('swaps oob element with custom selector', async function () {
        mockResponse('GET', '/test', '<div>Main</div><div id="x" hx-swap-oob="outerHTML:#target">OOB Target</div>')
        createProcessedHTML('<div hx-get="/test">Click</div><div id="target">Original Target</div>');
        find('[hx-get]').click()
        await forRequest()
        assertTextContentIs('#x', 'OOB Target')
    })

    it('swaps multiple oob elements', async function () {
        mockResponse('GET', '/test', '<div>Main</div><div id="a" hx-swap-oob="true">A</div><div id="b" hx-swap-oob="true">B</div>')
        createProcessedHTML('<div hx-get="/test">Click</div><div id="a">Old A</div><div id="b">Old B</div>');
        find('[hx-get]').click()
        await forRequest()
        assertTextContentIs('#a', 'A')
        assertTextContentIs('#b', 'B')
    })

    it('swaps oob with style and target selector', async function () {
        mockResponse('GET', '/test', '<div>Main</div><div id="x" hx-swap-oob="innerHTML:#custom">Target Content</div>')
        createProcessedHTML('<div hx-get="/test">Click</div><div id="custom">Original</div>');
        find('[hx-get]').click()
        await forRequest()
        assertTextContentIs('#custom', 'Target Content')
    })
})
