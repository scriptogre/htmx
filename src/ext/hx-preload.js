;(() => {
  htmx.install('hx-preload', {
    config: { attributeFilter: ['hx-preload'] },
    on: {
      'htmx:after:init': (detail, api) => {
        const elt = detail.element
        if (!elt) return

        let preloadSpec = api.attr(elt, 'hx-preload')
        if (!preloadSpec) return

        // Parse the preload spec as a trigger spec (e.g., "mouseenter timeout:5s")
        let eventName = 'mousedown'
        let timeout = 5000
        let specs = htmx.parseTriggerSpecs?.(preloadSpec) || []
        if (specs.length > 0) {
          eventName = specs[0].name
          if (specs[0].timeout) timeout = htmx.parseInterval(specs[0].timeout)
        } else {
          // Simple event name
          eventName = preloadSpec.trim().split(/\s+/)[0]
        }

        elt._htmx ??= {}

        let preloadListener = async () => {
          // Only preload GET requests
          const url = api.attr(elt, 'hx-get')
          if (!url) return

          if (elt._htmx?.preload) return

          // Build action URL with form data
          let action = url.replace(/#.*$/, '')
          let form = elt.form || elt.closest('form')
          if (form) {
            let formData = new FormData(form)
            let params = new URLSearchParams(formData)
            if (params.toString()) {
              action += (/\?/.test(action) ? '&' : '?') + params
            }
          }

          // Also merge hx-vals if present
          const hxVals = api.attr(elt, 'hx-vals')
          if (hxVals) {
            try {
              const vals = JSON.parse(hxVals)
              let params = new URLSearchParams(vals)
              if (params.toString()) {
                action += (/\?/.test(action) ? '&' : '?') + params
              }
            } catch (e) { /* ignore parse errors */ }
          }

          elt._htmx.preload = {
            prefetch: fetch(action, { method: 'GET' }),
            action: action,
            expiresAt: Date.now() + timeout,
          }

          try {
            await elt._htmx.preload.prefetch
          } catch (error) {
            delete elt._htmx.preload
          }
        }

        elt.addEventListener(eventName, preloadListener)
        elt._htmx.preloadListener = preloadListener
        elt._htmx.preloadEvent = eventName
      },

      'htmx:before:request': (detail, api) => {
        const elt = detail.element
        if (!elt?._htmx?.preload) return
        if (
          elt._htmx.preload.action === detail.request?.url &&
          Date.now() < elt._htmx.preload.expiresAt
        ) {
          let prefetch = elt._htmx.preload.prefetch
          detail.request.execute = async () => prefetch
          delete elt._htmx.preload
        } else {
          delete elt._htmx.preload
        }
      },

      'htmx:cleanup': (detail, api) => {
        const elt = detail.element
        if (elt?._htmx?.preloadListener) {
          elt.removeEventListener(elt._htmx.preloadEvent, elt._htmx.preloadListener)
        }
      },
    },
  })
})()
