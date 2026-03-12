(() => {

    const state = new WeakMap();

    function normalizeSwapStyle(style) {
        return style === 'before' ? 'beforebegin' :
            style === 'after' ? 'afterend' :
                style === 'prepend' ? 'afterbegin' :
                    style === 'append' ? 'beforeend' : style;
    }

    function insertOptimisticContent(element, api) {
        let optimistic = api.attr(element, 'hx-optimistic');
        if (!optimistic) return;

        let sourceElt = document.querySelector(optimistic);
        if (!sourceElt) return;

        // Resolve target from hx-target attribute or fall back to element itself
        let targetSelector = api.attr(element, 'hx-target');
        let target = targetSelector ? document.querySelector(targetSelector) : element;
        if (!target) return;

        // Create optimistic div with reset styling
        let optimisticDiv = document.createElement('div');
        optimisticDiv.style.cssText = 'all: initial';
        optimisticDiv.innerHTML = sourceElt.innerHTML;

        // Resolve swap style from hx-swap attribute
        let rawStyle = api.attr(element, 'hx-swap');
        let swapStyle = normalizeSwapStyle(rawStyle ? rawStyle.split(/\s+/)[0] : htmx.config.defaultSwap);
        let optHidden = [];

        if (swapStyle === 'innerHTML') {
            // Hide children of target
            for (let child of target.children) {
                child.style.display = 'none';
                optHidden.push(child);
            }
            target.appendChild(optimisticDiv);
        } else if (['beforebegin', 'afterbegin', 'beforeend', 'afterend'].includes(swapStyle)) {
            target.insertAdjacentElement(swapStyle, optimisticDiv);
        } else {
            // Assume outerHTML-like behavior, hide target and insert div after it
            target.style.display = 'none';
            optHidden.push(target);
            target.after(optimisticDiv);
        }

        state.set(element, { optimisticDiv, optHidden });
    }

    function removeOptimisticContent(element) {
        let s = state.get(element);
        if (!s?.optimisticDiv) return;

        // Remove optimistic div
        s.optimisticDiv.remove();

        // Unhide any hidden elements
        for (let elt of s.optHidden) {
            elt.style.display = '';
        }

        state.delete(element);
    }

    htmx.install('hx-optimistic', {
        config: {
            attributeFilter: ['hx-optimistic']
        },

        on: {
            'htmx:before:request': (detail, api) => {
                insertOptimisticContent(detail.element, api);
            },

            'htmx:error': (detail) => {
                removeOptimisticContent(detail.element);
            },

            'htmx:before:swap': (detail) => {
                removeOptimisticContent(detail.element);
            }
        }
    });
})();
