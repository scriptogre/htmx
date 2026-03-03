;(() => {
  function normalizeSwapStyle(style) {
    return style === 'before'
      ? 'beforebegin'
      : style === 'after'
        ? 'afterend'
        : style === 'prepend'
          ? 'afterbegin'
          : style === 'append'
            ? 'beforeend'
            : style
  }

  htmx.install('hx-optimistic', {
    config: { attributeFilter: ['hx-optimistic'] },
    on: {
      'htmx:before:request': (detail, api) => {
        const el = detail.element
        if (!el) return

        const optimistic = api.attr(el, 'hx-optimistic')
        if (!optimistic) return

        let sourceElt = document.querySelector(optimistic)
        if (!sourceElt) return

        // Resolve target: read hx-target, else use element itself
        const targetSelector = api.attr(el, 'hx-target')
        let target = targetSelector
          ? api.find(targetSelector, { from: el })
          : el
        if (!target) return

        // Resolve swap style
        const swapAttr = api.attr(el, 'hx-swap')
        let swapStyle = normalizeSwapStyle(swapAttr?.split(/\s+/)?.[0] || 'innerHTML')

        // Create optimistic div
        let optimisticDiv = document.createElement('div')
        optimisticDiv.style.cssText = 'all: initial'
        optimisticDiv.setAttribute('data-hx-optimistic', '')
        optimisticDiv.innerHTML = sourceElt.innerHTML

        detail._optHidden = []

        if (swapStyle === 'innerHTML') {
          for (let child of target.children) {
            child.style.display = 'none'
            child.setAttribute('data-hx-oh', '')
            detail._optHidden.push(child)
          }
          target.appendChild(optimisticDiv)
        } else if (['beforebegin', 'afterbegin', 'beforeend', 'afterend'].includes(swapStyle)) {
          target.insertAdjacentElement(swapStyle, optimisticDiv)
        } else {
          // outerHTML-like: hide target, insert after
          target.style.display = 'none'
          target.setAttribute('data-hx-oh', '')
          detail._optHidden.push(target)
          target.after(optimisticDiv)
        }
        detail._optimisticDiv = optimisticDiv
      },

      'htmx:error': (detail) => {
        if (!detail._optimisticDiv) return
        detail._optimisticDiv.remove()
        for (let elt of detail._optHidden || []) {
          elt.style.display = ''
          elt.removeAttribute('data-hx-oh')
        }
      },

      'htmx:before:swap': (detail) => {
        if (!detail._optimisticDiv) return
        detail._optimisticDiv.remove()
        for (let elt of detail._optHidden || []) {
          elt.style.display = ''
          elt.removeAttribute('data-hx-oh')
        }
      },
    },
  })
})()
