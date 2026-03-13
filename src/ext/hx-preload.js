(() => {

    function parseInterval(str) {
        if (typeof str === 'number') return str
        if (!str) return undefined
        const m = str.match(/^(\d+\.?\d*)(ms|s|m)?$/)
        if (!m) return undefined
        const [, n, unit] = m
        return unit === 's' ? n * 1000 : unit === 'm' ? n * 60000 : +n
    }

    function parsePreloadSpec(spec) {
        let events = [], timeout = null
        if (!spec) return {events, timeout}
        for (const token of spec.trim().split(/\s+/)) {
            const timeoutMatch = token.match(/^timeout:(.+)$/)
            if (timeoutMatch) {
                timeout = parseInterval(timeoutMatch[1])
            } else if (token) {
                events.push(token)
            }
        }
        return {events, timeout}
    }

    function getPreloadUrl(elt, api) {
        return api.attr(elt, 'hx-get') || elt.getAttribute('href')
    }

    function initializePreload(elt, api) {
        let spec = api.attr(elt, 'hx-preload')
        let isBoosted = !spec && api.attr(elt, 'hx-boost')

        if (!spec && !isBoosted) return

        let preloadEvents = [], timeout = 5000

        if (spec) {
            let parsed = parsePreloadSpec(spec)
            if (parsed.events.length === 0) return
            preloadEvents = parsed.events
            if (parsed.timeout != null) timeout = parsed.timeout
        } else {
            // Boosted links only
            if (elt.tagName === 'A') {
                if (htmx.config?.preload?.boostTimeout) {
                    timeout = parseInterval(htmx.config.preload.boostTimeout)
                }
                preloadEvents.push(htmx.config?.preload?.boostEvent || 'mousedown')
                preloadEvents.push('touchstart')
            }
        }

        let state = api.state.elements(elt)

        for (let eventName of preloadEvents) {
            api.on(elt, eventName, async () => {
                let url = getPreloadUrl(elt, api)
                if (!url) return

                // Already preloaded and not expired
                if (state.preload) return

                url = url.replace(/#.*$/, '')

                // Collect form data as query params
                let form = elt.form || elt.closest('form')
                if (form) {
                    let params = new URLSearchParams(new FormData(form))
                    if (params.size) url += (/\?/.test(url) ? '&' : '?') + params
                }

                state.preload = {
                    prefetch: fetch(url, {method: 'GET'}),
                    url: url,
                    expiresAt: Date.now() + timeout
                }

                try {
                    await state.preload.prefetch
                } catch (error) {
                    delete state.preload
                }
            })
        }
    }

    htmx.register('hx-preload', {
        config: {
            attributeFilter: ['hx-preload']
        },

        on: {
            'htmx:after:init': (detail, api) => {
                initializePreload(detail.element, api)
            },

            'htmx:before:request': (detail, api) => {
                let elt = detail.element
                let state = api.state.elements(elt)

                if (state.preload &&
                    state.preload.url === detail.request.url &&
                    Date.now() < state.preload.expiresAt) {
                    let prefetch = state.preload.prefetch
                    detail.request.execute = () => prefetch
                    delete state.preload
                } else {
                    delete state.preload
                }
            }
        }
    })
})()
