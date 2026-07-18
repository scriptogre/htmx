describe('__handleHeadersAndMaybeReturnEarly unit tests', function() {

    beforeEach(function() {
        setupTest();
    });

    afterEach(function() {
        cleanupTest();
    });

    it('handles the trigger action', function () {
        let triggerFired = false
        let listener = () => { triggerFired = true }

        let container = createProcessedHTML('<div></div>')
        container.addEventListener('myEvent', listener)

        let ctx = {
            actions: {
                trigger: 'myEvent'
            },
            sourceElement: container
        }

        let result = htmx.__handleHeadersAndMaybeReturnEarly(ctx)

        assert.isNotOk(result)
        assert.isTrue(triggerFired)
    })

    it('returns false when there are no actions to handle', function () {
        let ctx = {
            actions: {},
            sourceElement: createProcessedHTML('<div></div>')
        }

        let result = htmx.__handleHeadersAndMaybeReturnEarly(ctx)

        assert.isNotOk(result)
    })

    it('returns false when only trigger is present', function () {
        let container = createProcessedHTML('<div></div>')

        let ctx = {
            actions: {
                trigger: 'someEvent'
            },
            sourceElement: container
        }

        let result = htmx.__handleHeadersAndMaybeReturnEarly(ctx)

        assert.isNotOk(result)
    })

});
