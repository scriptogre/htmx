describe('Request Headers', function() {

    beforeEach(function() {
        setupTest();
    });

    afterEach(function() {
        cleanupTest();
    });

    describe('Default headers', function() {

        it('sends HX-Request header', async function() {
            mockResponse('GET', '/test', 'response');
            let btn = createProcessedHTML('<button hx-get="/test" hx-swap="none">Click</button>');
            btn.click();
            await forRequest();
            let call = lastFetch();
            call.request.headers['HX-Request'].should.equal('true');
        });

        it('sends HX-Current-URL header', async function() {
            mockResponse('GET', '/test', 'response');
            let btn = createProcessedHTML('<button hx-get="/test" hx-swap="none">Click</button>');
            btn.click();
            await forRequest();
            let call = lastFetch();
            assert.isOk(call.request.headers['HX-Current-URL']);
        });

    });

    describe('HX-Source header', function() {

        it('formats element with id', async function() {
            mockResponse('GET', '/test', 'response');
            let btn = createProcessedHTML('<button id="test-btn" hx-get="/test" hx-swap="none">Click</button>');
            btn.click();
            await forRequest();
            let call = lastFetch();
            call.request.headers['HX-Source'].should.equal('button#test-btn');
        });

        it('formats element with neither id nor name', async function() {
            mockResponse('GET', '/test', 'response');
            let btn = createProcessedHTML('<button hx-get="/test" hx-swap="none">Click</button>');
            btn.click();
            await forRequest();
            let call = lastFetch();
            call.request.headers['HX-Source'].should.equal('button');
        });

        it('formats div element', async function() {
            mockResponse('GET', '/test', 'response');
            let div = createProcessedHTML('<div id="content" hx-get="/test" hx-swap="none">Click</div>');
            div.click();
            await forRequest();
            let call = lastFetch();
            call.request.headers['HX-Source'].should.equal('div#content');
        });

        it('formats form element', async function() {
            mockResponse('POST', '/test', 'response');
            let form = createProcessedHTML('<form id="my-form" name="contact" hx-post="/test" hx-swap="none"><button type="submit">Submit</button></form>');
            form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
            await forRequest();
            let call = lastFetch();
            call.request.headers['HX-Source'].should.equal('form#my-form');
        });

    });

    describe('HX-Target header', function() {

        it('formats target element with id', async function() {
            mockResponse('GET', '/test', 'response');
            createProcessedHTML('<div id="result"></div><button hx-get="/test" hx-target="#result" hx-swap="none">Click</button>');
            let btn = document.querySelector('button');
            btn.click();
            await forRequest();
            let call = lastFetch();
            call.request.headers['HX-Target'].should.equal('div#result');
        });

        it('formats target when targeting self', async function() {
            mockResponse('GET', '/test', 'response');
            let btn = createProcessedHTML('<button id="self-btn" hx-get="/test" hx-swap="none">Click</button>');
            btn.click();
            await forRequest();
            let call = lastFetch();
            call.request.headers['HX-Target'].should.equal('button#self-btn');
        });

        it('formats body target', async function() {
            let headers = {}
            let btn = createProcessedHTML('<button hx-get="/test" hx-target="body">Click</button>');
            btn.addEventListener('htmx:before:request', (e) => {
                headers = {...e.detail.request.headers}
                e.preventDefault()
            });
            btn.click();
            await new Promise(r => setTimeout(r, 50));
            headers['HX-Target'].should.equal('body');
        });

    });

    describe('HX-Request-Type header', function() {

        it('sets to partial for regular element target', async function() {
            mockResponse('GET', '/test', 'response');
            createProcessedHTML('<div id="result"></div><button hx-get="/test" hx-target="#result" hx-swap="none">Click</button>');
            let btn = document.querySelector('button');
            btn.click();
            await forRequest();
            let call = lastFetch();
            call.request.headers['HX-Request-Type'].should.equal('partial');
        });

        it('sets to partial when targeting self', async function() {
            mockResponse('GET', '/test', 'response');
            let btn = createProcessedHTML('<button hx-get="/test" hx-swap="none">Click</button>');
            btn.click();
            await forRequest();
            let call = lastFetch();
            call.request.headers['HX-Request-Type'].should.equal('partial');
        });

        it('sets to full when targeting body', async function() {
            let headers = {}
            let btn = createProcessedHTML('<button hx-get="/test" hx-target="body">Click</button>');
            btn.addEventListener('htmx:before:request', (e) => {
                headers = {...e.detail.request.headers}
                e.preventDefault()
            });
            btn.click();
            await new Promise(r => setTimeout(r, 50));
            headers['HX-Request-Type'].should.equal('full');
        });

        it('sets to full when hx-select is present', async function() {
            let headers = {}
            let btn = createProcessedHTML('<button hx-get="/test" hx-select="#content">Click</button>');
            btn.addEventListener('htmx:before:request', (e) => {
                headers = {...e.detail.request.headers}
                e.preventDefault()
            });
            btn.click();
            await new Promise(r => setTimeout(r, 50));
            headers['HX-Request-Type'].should.equal('full');
        });

        it('sets to full when hx-select and body target both present', async function() {
            let headers = {}
            let btn = createProcessedHTML('<button hx-get="/test" hx-target="body" hx-select="#content">Click</button>');
            btn.addEventListener('htmx:before:request', (e) => {
                headers = {...e.detail.request.headers}
                e.preventDefault()
            });
            btn.click();
            await new Promise(r => setTimeout(r, 50));
            headers['HX-Request-Type'].should.equal('full');
        });

    });

});
