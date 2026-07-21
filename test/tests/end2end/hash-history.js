describe('hash history scroll restoration', function() {

    beforeEach(() => { setupTest(this.currentTest); });

    afterEach(() => {
        window.scrollTo(0, 0);
        cleanupTest();
    });

    async function untilScrollY(y, timeout = 1500) {
        let start = performance.now();
        while (window.scrollY !== y && performance.now() - start < timeout) {
            await new Promise(resolve => requestAnimationFrame(resolve));
        }
    }

    it('back and forward restore their own scroll positions', async function() {
        playground().innerHTML = '<main hx-history-elt><div style="height:1200px">top</div><p id="section">section</p></main>';
        htmx.process(playground());
        window.scrollTo(0, 0);
        htmx.__replaceUrlInHistory('/hash-scroll');

        location.hash = '#section';
        await htmx.timeout(50);
        let hashY = window.scrollY;
        assert.isAbove(hashY, 500);

        let request = forRequest(150);
        history.back();
        assert.isNull(await request);
        await untilScrollY(0);
        assert.equal(window.scrollY, 0);

        request = forRequest(150);
        history.forward();
        assert.isNull(await request);
        await untilScrollY(hashY);
        assert.equal(window.scrollY, hashY);
    });
});
