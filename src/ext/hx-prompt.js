//==========================================================
// hx-prompt.js
//
// Restores htmx 2's `hx-prompt` attribute. Prompts the user
// before the request, sends the answer as `HX-Prompt` header,
// aborts on cancel. Override `window.htmxPrompt` for a custom
// (sync) dialog.
//==========================================================
(() => {
    let api;
    htmx.registerExtension('hx-prompt', {
        init(internalAPI) { api = internalAPI },

        htmx_config_request(elt, {ctx}) {
            let question = api.attributeValue(ctx.sourceElement, 'hx-prompt');
            if (question == null) return;
            let answer = (window.htmxPrompt || window.prompt)(question);
            if (answer === null) return false;
            let target = api.resolveTarget(ctx.sourceElement, ctx.swap.target);
            if (!htmx.trigger(ctx.sourceElement, 'htmx:prompt', { prompt: answer, target })) return false;
            ctx.request.headers['HX-Prompt'] = encodeURI(answer);
        }
    });
})();
