describe('hx-multipart extension', function() {

    let extBackup;
    let configExtensions;
    let partsDescriptor;

    before(async () => {
        extBackup = backupExtensions();
        configExtensions = htmx.config.extensions;
        partsDescriptor = Object.getOwnPropertyDescriptor(Response.prototype, 'parts');
        clearExtensions();

        htmx.config.extensions = 'multipart,accept-test';
        htmx.__approvedExt = 'multipart,accept-test';

        let script = document.createElement('script');
        script.src = '../src/ext/hx-multipart.js';
        await new Promise(resolve => {
            script.onload = resolve;
            document.head.appendChild(script);
        });

        if (!htmx.__registeredExt.has('multipart')) {
            throw new Error('multipart extension failed to register - check approval');
        }
    });

    after(() => {
        restoreExtensions(extBackup);
        htmx.config.extensions = configExtensions;
        if (partsDescriptor) {
            Object.defineProperty(Response.prototype, 'parts', partsDescriptor);
        } else {
            delete Response.prototype.parts;
        }
    });

    beforeEach(function() {
        setupTest();
    });

    afterEach(function() {
        cleanupTest();
    });

    it('installs Response.prototype.parts', function() {
        assert.equal(typeof Response.prototype.parts, 'function');
    });

    it('adds multipart types to Accept without clobbering existing values', async function() {
        htmx.registerExtension('accept-test', {
            htmx_config_request: (element, detail) => {
                detail.ctx.request.headers.set('Accept', 'text/html, text/event-stream');
            }
        });

        mockResponse('GET', '/test', 'OK');
        let button = createProcessedHTML('<button hx-get="/test" hx-swap="none">Go</button>');

        button.click();
        await forRequest();

        assert.equal(
            lastFetch().request.headers.get('Accept'),
            'text/html, text/event-stream, multipart/mixed, multipart/parallel'
        );
    });

    async function waitUntil(condition, timeout = 200) {
        let start = Date.now();
        while (Date.now() - start < timeout) {
            if (condition()) return true;
            await htmx.timeout(5);
        }
        return false;
    }

    it('handles multipart/mixed parts with their own HX headers', async function() {
        let button = createProcessedHTML('<button hx-get="/stream">Go</button><div id="one">one</div><div id="two">two</div>');
        let triggered = false;
        let afterRequestCount = 0;
        button.addEventListener('partEvent', () => triggered = true);
        button.addEventListener('htmx:after:request', () => afterRequestCount++);

        let body = [
            '--updates\r\n',
            'Content-Type: text/html\r\n',
            'HX-Retarget: #one\r\n',
            '\r\n',
            'First',
            '\r\n--updates\r\n',
            'Content-Type: text/html\r\n',
            'HX-Retarget: #two\r\n',
            'HX-Trigger: partEvent\r\n',
            '\r\n',
            'Second',
            '\r\n--updates--\r\n'
        ].join('');

        fetchMock.mockResponse('GET', '/stream', new Response(body, {
            headers: {'Content-Type': 'multipart/mixed; boundary=updates'}
        }));

        button.click();
        await forRequest();

        assertTextContentIs('#one', 'First');
        assertTextContentIs('#two', 'Second');
        assert.isTrue(triggered);
        assert.equal(afterRequestCount, 1);
        assert.equal(button.textContent, 'Go');
    });

    it('swaps multipart/mixed parts before the response stream closes', async function() {
        let button = createProcessedHTML('<button hx-get="/stream">Go</button><div id="one">one</div><div id="two">two</div>');
        let controller;
        let encoder = new TextEncoder();
        let stream = new ReadableStream({
            start(c) { controller = c; }
        });

        fetchMock.mockResponse('GET', '/stream', new Response(stream, {
            headers: {'Content-Type': 'multipart/mixed; boundary=updates'}
        }));

        button.click();
        await htmx.timeout(0);

        controller.enqueue(encoder.encode([
            '--updates\r\n',
            'Content-Type: text/html\r\n',
            'HX-Retarget: #one\r\n',
            '\r\n',
            'First',
            '\r\n--updates\r\n',
            'Content-Type: text/html\r\n',
            'HX-Retarget: #two\r\n',
            '\r\n'
        ].join('')));

        assert.isTrue(await waitUntil(() => htmx.find('#one').textContent === 'First', 500));
        assertTextContentIs('#two', 'two');

        let requestFinished = false;
        let done = forRequest(500).then(() => requestFinished = true);
        await htmx.timeout(20);
        assert.isFalse(requestFinished);

        controller.enqueue(encoder.encode('Second\r\n--updates--\r\n'));
        controller.close();
        await done;

        assertTextContentIs('#one', 'First');
        assertTextContentIs('#two', 'Second');
    });
});
