describe('Out of Band Swaps', function () {
    beforeEach(function () {
        setupTest(this.currentTest)
    })

    afterEach(function () {
        cleanupTest()
    })

    // =========================================================================
    // hx-swap-oob
    // =========================================================================

    it('hx-swap-oob="true" swaps by element id', async function () {
        mockResponse('GET', '/test', '<div>Main</div><div id="d2" hx-swap-oob="true">OOB</div>')
        createProcessedHTML('<div id="d2">Original</div><button id="btn" hx-get="/test" hx-target="#d1">Click</button><div id="d1"></div>')
        find('#btn').click()
        await forRequest()
        find('#d1').innerText.trim().should.equal('Main')
        find('#d2').innerText.should.equal('OOB')
    })

    it('hx-swap-oob="outerHTML" replaces element', async function () {
        mockResponse('GET', '/test', '<div>Main</div><div id="d2" hx-swap-oob="outerHTML">OOB</div>')
        createProcessedHTML('<div id="d2">Original</div><button id="btn" hx-get="/test" hx-target="#d1">Click</button><div id="d1"></div>')
        find('#btn').click()
        await forRequest()
        find('#d2').innerText.should.equal('OOB')
    })

    it('hx-swap-oob="innerHTML" swaps inner content', async function () {
        mockResponse('GET', '/test', '<div>Main</div><div id="d2" hx-swap-oob="innerHTML">OOB</div>')
        createProcessedHTML('<div id="d2"><span>Old</span></div><button id="btn" hx-get="/test" hx-target="#d1">Click</button><div id="d1"></div>')
        find('#btn').click()
        await forRequest()
        find('#d2').innerText.should.equal('OOB')
        find('#d2').tagName.should.equal('DIV')
    })

    it('hx-swap-oob with target selector', async function () {
        mockResponse('GET', '/test', '<div>Main</div><div hx-swap-oob="innerHTML:#target">OOB Content</div>')
        createProcessedHTML('<div id="target">Original</div><button id="btn" hx-get="/test" hx-target="#d1">Click</button><div id="d1"></div>')
        find('#btn').click()
        await forRequest()
        find('#target').innerText.should.equal('OOB Content')
    })

    it('removes hx-swap-oob attribute after processing', async function () {
        mockResponse('GET', '/test', '<div>Main</div><div id="d2" hx-swap-oob="true">OOB</div>')
        createProcessedHTML('<div id="d2">Original</div><button id="btn" hx-get="/test" hx-target="#d1">Click</button><div id="d1"></div>')
        find('#btn').click()
        await forRequest()
        assert.isFalse(find('#d2').hasAttribute('hx-swap-oob'))
    })

    it('oob elements are removed from main swap content', async function () {
        mockResponse('GET', '/test', '<div id="main">Main</div><div id="d2" hx-swap-oob="true">OOB</div>')
        createProcessedHTML('<div id="d2">Original</div><button id="btn" hx-get="/test" hx-target="#d1">Click</button><div id="d1"></div>')
        find('#btn').click()
        await forRequest()
        assert.isNull(find('#d1').querySelector('[hx-swap-oob]'))
    })

    it('skips main swap when response is only oob elements', async function () {
        mockResponse('GET', '/test', '<div id="d2" hx-swap-oob="true">OOB Only</div>')
        createProcessedHTML('<div id="d2">Original</div><div id="d1">Keep</div><button id="btn" hx-get="/test" hx-target="#d1">Click</button>')
        find('#btn').click()
        await forRequest()
        find('#d2').innerText.should.equal('OOB Only')
    })

    // =========================================================================
    // hx-select-oob
    // =========================================================================

    it('hx-select-oob selects elements from response', async function () {
        mockResponse('GET', '/test', '<div>Main</div><div id="sidebar">New Sidebar</div>')
        createProcessedHTML('<div id="sidebar">Original</div><button id="btn" hx-get="/test" hx-target="#d1" hx-select-oob="#sidebar">Click</button><div id="d1"></div>')
        find('#btn').click()
        await forRequest()
        find('#sidebar').innerText.should.equal('New Sidebar')
    })

    it('hx-select-oob with swap style', async function () {
        mockResponse('GET', '/test', '<div>Main</div><div id="sidebar">New Content</div>')
        createProcessedHTML('<div id="sidebar">Original</div><button id="btn" hx-get="/test" hx-target="#d1" hx-select-oob="#sidebar:innerHTML">Click</button><div id="d1"></div>')
        find('#btn').click()
        await forRequest()
        find('#sidebar').innerText.should.equal('New Content')
    })

    // =========================================================================
    // hx-partial
    // =========================================================================

    it('hx-partial swaps to target', async function () {
        mockResponse('GET', '/test', '<hx-partial hx-target="#d2">Partial Content</hx-partial>')
        createProcessedHTML('<div id="d2">Original</div><button id="btn" hx-get="/test" hx-target="#d1">Click</button><div id="d1"></div>')
        find('#btn').click()
        await forRequest()
        find('#d2').innerText.should.equal('Partial Content')
    })

    it('hx-partial with custom swap style', async function () {
        mockResponse('GET', '/test', '<hx-partial hx-target="#d1" hx-swap="beforeend">Appended</hx-partial>')
        createProcessedHTML('<div id="d1">Existing</div><button id="btn" hx-get="/test" hx-target="#d1">Click</button>')
        find('#btn').click()
        await forRequest()
        find('#d1').innerText.should.equal('ExistingAppended')
    })

    it('hx-partial with main content', async function () {
        mockResponse('GET', '/test', '<div>Main Content</div><hx-partial hx-target="#d2"><div>OOB Content</div></hx-partial>')
        createProcessedHTML('<div id="d2">Original</div><button id="btn" hx-get="/test" hx-target="#d1">Click</button><div id="d1"></div>')
        find('#btn').click()
        await forRequest()
        find('#d1').innerText.trim().should.equal('Main Content')
        find('#d2').innerText.should.equal('OOB Content')
    })

    it('skips main swap when response is only partials', async function () {
        mockResponse('GET', '/test', '<hx-partial hx-target="#d2"><div>OOB Updated</div></hx-partial>')
        createProcessedHTML('<div id="d1">Keep</div><div id="d2">Original</div><button id="btn" hx-get="/test" hx-target="#d1">Click</button>')
        find('#btn').click()
        await forRequest()
        find('#d2').innerText.should.equal('OOB Updated')
    })

    it('hx-partial tags never leak into the DOM', async function () {
        mockResponse('GET', '/test', '<div>Main</div><hx-partial hx-target="#d2"><p>Partial</p></hx-partial>')
        createProcessedHTML('<div id="d2">Original</div><button id="btn" hx-get="/test" hx-target="#d1">Click</button><div id="d1"></div>')
        find('#btn').click()
        await forRequest()
        // No <hx-partial> element should exist anywhere in the document
        assert.isNull(document.querySelector('hx-partial'))
        // Partial content should be in #d2, not in #d1
        find('#d2').innerText.should.equal('Partial')
        assert.isNull(find('#d1').querySelector('p'))
    })

    it('hx-partial content does not duplicate into main swap target', async function () {
        mockResponse('GET', '/test', '<span>Main Only</span><hx-partial hx-target="#d2"><span>Partial Only</span></hx-partial>')
        createProcessedHTML('<div id="d2">Original</div><button id="btn" hx-get="/test" hx-target="#d1" hx-swap="innerHTML">Click</button><div id="d1"></div>')
        find('#btn').click()
        await forRequest()
        // Main target should only have "Main Only"
        find('#d1').textContent.trim().should.equal('Main Only')
        find('#d1').querySelectorAll('span').length.should.equal(1)
        // Partial target should only have "Partial Only"
        find('#d2').textContent.should.equal('Partial Only')
    })

    it('multiple hx-partials all extracted before main swap', async function () {
        mockResponse('GET', '/test', '<div>Main</div><hx-partial hx-target="#p1"><em>P1</em></hx-partial><hx-partial hx-target="#p2"><em>P2</em></hx-partial>')
        createProcessedHTML('<div id="p1">Old1</div><div id="p2">Old2</div><button id="btn" hx-get="/test" hx-target="#d1">Click</button><div id="d1"></div>')
        find('#btn').click()
        await forRequest()
        assert.isNull(document.querySelector('hx-partial'))
        find('#p1').textContent.should.equal('P1')
        find('#p2').textContent.should.equal('P2')
        find('#d1').textContent.trim().should.equal('Main')
    })

    it('basic OOB swap with hx-partial and hx-action', async function () {
        mockResponse('GET', '/demo', '<div id="result">Success!</div><hx-partial hx-target="#d2"><div id="d3">Success OOB!</div></hx-partial>')
        createProcessedHTML('<button id="btn1" hx-action="/demo">Button</button><div id="d1">Div 1</div><div id="d2">Div 2</div>')
        find('#btn1').click()
        await forRequest()
        find('#d3').innerText.should.equal('Success OOB!')
    })
})
