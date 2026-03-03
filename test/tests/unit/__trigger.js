describe('htmx.emit() unit tests', function() {

    beforeEach(function() {
        setupTest();
    });

    afterEach(function() {
        cleanupTest();
    });

    it('triggers event on element', function () {
        let div = createProcessedHTML('<div></div>')
        let called = false
        div.addEventListener('custom', () => called = true)
        htmx.emit(div, 'custom')
        assert.isTrue(called)
    })

    it('passes detail object', function () {
        let div = createProcessedHTML('<div></div>')
        let receivedDetail = null
        div.addEventListener('custom', (e) => receivedDetail = e.detail)
        htmx.emit(div, 'custom', {foo: 'bar'})
        assert.deepEqual(receivedDetail, {foo: 'bar'})
    })

    it('bubbles by default', function () {
        let parent = createProcessedHTML('<div><span id="child"></span></div>')
        let child = parent.querySelector('#child')
        let calledOnParent = false
        parent.addEventListener('custom', () => calledOnParent = true)
        htmx.emit(child, 'custom')
        assert.isTrue(calledOnParent)
    })

    it('returns true when not cancelled', function () {
        let div = createProcessedHTML('<div></div>')
        let result = htmx.emit(div, 'custom')
        assert.isTrue(result)
    })

    it('returns false when event prevented', function () {
        let div = createProcessedHTML('<div></div>')
        div.addEventListener('custom', (e) => e.preventDefault())
        let result = htmx.emit(div, 'custom')
        assert.isFalse(result)
    })

    it('handles colon in event name', function () {
        let div = createProcessedHTML('<div></div>')
        let receivedEventName = null
        div.addEventListener('htmx:custom', (e) => receivedEventName = e.type)
        htmx.emit(div, 'htmx:custom')
        assert.equal(receivedEventName, 'htmx:custom')
    })

    it('handles empty detail object by default', function () {
        let div = createProcessedHTML('<div></div>')
        let receivedDetail = null
        div.addEventListener('custom', (e) => receivedDetail = e.detail)
        htmx.emit(div, 'custom')
        assert.deepEqual(receivedDetail, {})
    })

    it('preserves detail properties', function () {
        let div = createProcessedHTML('<div></div>')
        let receivedDetail = null
        div.addEventListener('custom', (e) => receivedDetail = e.detail)
        let detail = {
            string: 'value',
            number: 42,
            boolean: true,
            object: {nested: 'prop'},
            array: [1, 2, 3]
        }
        htmx.emit(div, 'custom', detail)
        assert.deepEqual(receivedDetail, detail)
    })

    it('event is composed', function () {
        let shadowHost = createProcessedHTML('<div></div>')
        let shadowRoot = shadowHost.attachShadow({mode: 'open'})
        let shadowChild = document.createElement('div')
        shadowRoot.appendChild(shadowChild)

        let calledOnHost = false
        shadowHost.addEventListener('custom', (e) => {
            calledOnHost = true
            assert.isTrue(e.composed)
        })

        htmx.emit(shadowChild, 'custom')
        assert.isTrue(calledOnHost)
    })

    it('event is cancelable', function () {
        let div = createProcessedHTML('<div></div>')
        let wasCancelable = false
        div.addEventListener('custom', (e) => {
            wasCancelable = e.cancelable
            e.preventDefault()
        })
        htmx.emit(div, 'custom')
        assert.isTrue(wasCancelable)
    })

});
