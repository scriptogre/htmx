(() =>{

    // TODO - this needs to be updated to use the new internal API

    function normalizeSwapStyle(style) {
        return style === 'before' ? 'beforebegin' :
            style === 'after' ? 'afterend' :
                style === 'prepend' ? 'afterbegin' :
                    style === 'append' ? 'beforeend' : style;
    }

    function insertOptimisticContent(detail) {
        // TODO - handle htmx.config.prefix
        detail._optimistic = detail.element.getAttribute("hx-optimistic");
        if (!detail._optimistic) {
            return
        }

        // TODO - handle inheritance?
        let sourceElt = document.querySelector(detail._optimistic);
        if (!sourceElt) return;

        let target = detail.swap?.target;
        if (!target) return;

        if (typeof target === 'string') {
            target = document.querySelector(target);
        }

        // Create optimistic div with reset styling
        let optimisticDiv = document.createElement('div');
        optimisticDiv.style.cssText = 'all: initial';
        optimisticDiv.innerHTML = sourceElt.innerHTML;

        let swapStyle = normalizeSwapStyle(detail.swap?.style);
        detail._optHidden = [];

        if (swapStyle === 'innerHTML') {
            // Hide children of target
            for (let child of target.children) {
                child.style.display = 'none';
                detail._optHidden.push(child)
            }
            target.appendChild(optimisticDiv);
            detail._optimisticDiv = optimisticDiv;
        } else if (['beforebegin', 'afterbegin', 'beforeend', 'afterend'].includes(swapStyle)) {
            target.insertAdjacentElement(swapStyle, optimisticDiv);
            detail._optimisticDiv = optimisticDiv;
        } else {
            // Assume outerHTML-like behavior, Hide target and insert div after it
            target.style.display = 'none';
            detail._optHidden.push(target)
            target.after(optimisticDiv)
            detail._optimisticDiv = optimisticDiv;
        }
    }

    function removeOptimisticContent(detail) {
        if (!detail._optimisticDiv) return;

        // Remove optimistic div
        detail._optimisticDiv.remove();

        // Unhide any hidden elements
        for (let elt of detail._optHidden) {
            elt.style.display = '';
        }
    }

    htmx.registerExtension('hx-optimistic', {
        htmx_before_request : (elt, detail) => {
            insertOptimisticContent(detail);
        },
        htmx_error : (elt, detail) => {
            removeOptimisticContent(detail)
        },
        htmx_before_swap : (elt, detail) => {
            removeOptimisticContent(detail)
        }
    });
})();