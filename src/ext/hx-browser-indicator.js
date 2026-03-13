(() => {

    if (typeof navigation === 'undefined') return;

    let activeCount = 0;
    let activeAborts = new Set();
    let historyUpdating = false;
    let cleanupNavigation = null;

    function shouldShowIndicator(elt, api) {
        if (api.attr(elt, 'hx-browser-indicator') === 'true') return true;
        if (htmx.config.boostBrowserIndicator && api.attr(elt, 'hx-boost') === 'true') return true;
        return false;
    }

    function listenForNavigate() {
        navigation.addEventListener('navigate', (event) => {
            let hideBrowserIndicator;
            event.intercept({
                handler: () => new Promise(r => { hideBrowserIndicator = r }),
                scroll: 'manual',
                focusReset: 'manual'
            });
            let abortHandler = () => {
                if (historyUpdating) {
                    // History update, re-hijack the navigation
                    listenForNavigate();
                } else {
                    // User clicked the browser stop button - abort all in-flight requests
                    activeAborts.forEach( abort => abort() );
                    activeAborts.clear();
                    activeCount = 0;
                    cleanupNavigation = null;
                }
            };
            event.signal.addEventListener('abort', abortHandler);
            cleanupNavigation = () => {
                event.signal.removeEventListener('abort', abortHandler);
                hideBrowserIndicator();
            };
        }, {once: true});
    }

    function startIndicator() {
        listenForNavigate();
        navigation.navigate(location.href, { history: 'replace' });
    }

    function stopIndicator() {
        if (cleanupNavigation) {
            cleanupNavigation();
            cleanupNavigation = null;
        }
    }

    htmx.register('browser-indicator', {
        config: {
            attributeFilter: ['hx-browser-indicator']
        },

        on: {
            'htmx:before:history:update': () => {
                historyUpdating = true;
            },

            'htmx:after:history:update': () => {
                historyUpdating = false;
            },

            'htmx:before:request': (detail, api) => {
                if (!shouldShowIndicator(detail.element, api)) return;
                detail._browserIndicator = true;
                if (detail.request?.abort) activeAborts.add(detail.request.abort);
                activeCount++;
                if (activeCount === 1) startIndicator();
            },

            'htmx:finally': (detail, api) => {
                if (!detail._browserIndicator) return;
                if (detail.request?.abort) activeAborts.delete(detail.request.abort);
                if (activeCount === 0) return;
                activeCount--;
                if (activeCount === 0) stopIndicator();
            }
        }
    });
})();
