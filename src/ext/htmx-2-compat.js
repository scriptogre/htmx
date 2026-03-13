(()=>{
    //========================================================
    // htmx 2.0 compatibility extension
    //========================================================

    function maybeRetrigger(element, evtName, detail) {
        if (htmx.config.compat?.doNotTriggerOldEvents) return
        const el = element || document.body
        el.dispatchEvent(new CustomEvent(evtName, { detail, bubbles: true, cancelable: true, composed: true }))
    }

    htmx.register('compat', {
        on: {
            'htmx:boot': function (detail, api) {
                // revert inheritance
                if (!htmx.config.compat?.useExplicitInheritace) {
                    htmx.config.implicitInheritance = true;
                }

                // do not swap 4xx and 5xx responses
                if (!htmx.config.compat?.swapErrorResponseCodes) {
                    htmx.config.noSwap.push("4xx", "5xx");
                }

                // htmx:config:request is dispatched via DOM, so listen and re-fire with old name
                document.body.addEventListener("htmx:config:request", function (evt) {
                    maybeRetrigger(evt.target, "htmx:configRequest", evt.detail);
                });
            },
            'htmx:after:init': function (detail, api) {
                maybeRetrigger(detail.element, "htmx:afterOnLoad", detail);
                maybeRetrigger(detail.element, "htmx:afterProcessNode", detail);
                maybeRetrigger(detail.element, "htmx:load", detail);
            },
            'htmx:after:request': function (detail, api) {
                maybeRetrigger(detail.element, "htmx:afterRequest", detail);
            },
            'htmx:after:swap': function (detail, api) {
                maybeRetrigger(detail.element, "htmx:afterSettle", detail);
                maybeRetrigger(detail.element, "htmx:afterSwap", detail);
            },
            'htmx:before:cleanup': function (detail, api) {
                maybeRetrigger(detail.element, "htmx:beforeCleanupElement", detail);
            },
            'htmx:before:history:update': function (detail, api) {
                maybeRetrigger(detail.element, "htmx:beforeHistoryUpdate", detail);
                maybeRetrigger(detail.element, "htmx:beforeHistorySave", detail);
            },
            'htmx:before:init': function (detail, api) {
                maybeRetrigger(detail.element, "htmx:beforeOnLoad", detail);
            },
            'htmx:before:walk:init': function (detail, api) {
                maybeRetrigger(detail.element, "htmx:beforeProcessNode", detail);
            },
            'htmx:before:request': function (detail, api) {
                maybeRetrigger(detail.element, "htmx:beforeRequest", detail);
                maybeRetrigger(detail.element, "htmx:beforeSend", detail);
            },
            'htmx:before:swap': function (detail, api) {
                maybeRetrigger(detail.element, "htmx:beforeSwap", detail);
            },
            'htmx:before:viewTransition': function (detail, api) {
                maybeRetrigger(detail.element, "htmx:beforeTransition", detail);
            },
            'htmx:before:history:restore': function (detail, api) {
                maybeRetrigger(detail.element, "htmx:historyRestore", detail);
            },
            'htmx:after:history:push': function (detail, api) {
                maybeRetrigger(detail.element, "htmx:pushedIntoHistory", detail);
            },
            'htmx:after:history:replace': function (detail, api) {
                maybeRetrigger(detail.element, "htmx:replacedInHistory", detail);
            },
            'htmx:error': function (detail, api) {
                maybeRetrigger(detail.element, "htmx:targetError", detail);
            },
        }
    });
})()
