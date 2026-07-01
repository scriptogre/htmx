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
        htmx_before_swaps: (elt, detail) => {
            let {ctx} = detail;
            let selector = api.attributeValue(ctx.sourceElement, 'hx-targets');
            if (!selector) return;

            let targets = htmx.findAll(ctx.sourceElement, selector);
            if (!targets.length) {
                console.warn(`htmx: '${selector}' on hx-targets did not match any elements`, { selector });
                return;
            }

            // Replace main swap with one swap per target
            let mainIndex = ctx.swaps.findIndex(s => s.type === 'main');
            if (mainIndex === -1) return;

            let mainSwap = ctx.swaps[mainIndex];
            let newSwaps = Array.from(targets).map(target => ({
                ...mainSwap,
                fragment: mainSwap.fragment.cloneNode(true),
                target
            }));

            ctx.swaps.splice(mainIndex, 1, ...newSwaps);
        }
    });
})();
