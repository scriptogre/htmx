//==========================================================
// hx-targets.js
//
// An extension that adds an 'hx-targets' attribute to target
// multiple elements with the same swap content.
//
// Usage:
//   <button hx-get="/api" hx-targets=".card">Click</button>
//
// The response will be swapped into all elements matching
// the selector. The hx-targets attribute is inherited.
//==========================================================
(() => {
    let api;

    htmx.registerExtension('hx-targets', {
        init: (internalAPI) => {
            api = internalAPI;
        },
        htmx_before_swap: (elt, detail) => {
            let element = detail.element || elt;
            let selector = api.attributeValue(element, 'hx-targets');
            if (!selector) return;

            let targets = htmx.findAll(element, selector);
            if (!targets.length) {
                console.warn(`htmx: '${selector}' on hx-targets did not match any elements`);
                return;
            }

            // Replace execute to run the swap against every matched target
            let originalFragment = detail.swap.fragment;
            detail.swap.execute = async () => {
                for (let [i, target] of targets.entries()) {
                    let frag = i < targets.length - 1
                        ? originalFragment.cloneNode(true)
                        : originalFragment;
                    await api.insertContent(target, frag, detail.swap.style, true);
                }
            };
        }
    });
})();