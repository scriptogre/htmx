//==========================================================
// hx-alpine-compat.js
//
// Alpine.js compatibility extension for htmx
// Preserves Alpine state during morph operations
// and defers Alpine mutations during swaps
//==========================================================
(() => {
    let deferCount = 0;

    htmx.install('alpine-compat', {
        on: {
            'htmx:before:swap': (detail, api) => {
                if (!window.Alpine?.closestDataStack || !window.Alpine?.cloneNode || !window.Alpine?.deferMutations) {
                    return;
                }
                if (deferCount === 0) {
                    window.Alpine.deferMutations();
                }
                deferCount++;
            },

            'htmx:after:swap': (detail, api) => {
                if (deferCount > 0) {
                    deferCount--;
                }
                if (deferCount === 0 && window.Alpine?.flushAndStopDeferringMutations) {
                    window.Alpine.flushAndStopDeferringMutations();
                }
            },

            'htmx:before:morph:node': (detail, api) => {
                if (!window.Alpine?.closestDataStack || !window.Alpine?.cloneNode) {
                    return;
                }
                let {oldNode, newNode} = detail;

                let oldDataStack = window.Alpine.closestDataStack(oldNode);
                newNode._x_dataStack = oldDataStack;

                // Skip cloneNode for template children that are not connected,
                // as they cannot have reactive content
                if (!oldNode.isConnected) return;

                window.Alpine.cloneNode(oldNode, newNode);

                // If both have _x_teleport, morph the teleport target
                if (oldNode._x_teleport && newNode._x_teleport) {
                    let fragment = document.createDocumentFragment();
                    fragment.append(newNode._x_teleport);
                    api.morph(oldNode._x_teleport, fragment, false);
                }
            }
        }
    });
})();
