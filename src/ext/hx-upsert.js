;(() => {
  function doUpsert(target, fragment, opts = {}) {
    let keyAttr = opts.key || 'id'
    let desc = opts.sort === 'desc'
    let shouldSort = opts.sort != null && opts.sort !== false
    let firstChild = target.firstChild

    let getKey = (el) => el.getAttribute?.(keyAttr) || el.id

    let compare = (a, b) => {
      let result = a.localeCompare(b, undefined, { numeric: true })
      return desc ? -result : result
    }

    for (let newEl of Array.from(fragment.children)) {
      let id = newEl.id
      if (id) {
        let existing = target.querySelector('#' + CSS.escape(id))
        if (existing) {
          existing.outerHTML = newEl.outerHTML
          continue
        }
      }

      let newKey = getKey(newEl)
      if (!newKey || !shouldSort) {
        if (opts.prepend) {
          target.insertBefore(newEl, firstChild)
        } else {
          target.appendChild(newEl)
        }
        continue
      }

      let inserted = false
      for (let child of target.children) {
        let childKey = getKey(child)
        if (childKey && compare(newKey, childKey) < 0) {
          target.insertBefore(newEl, child)
          inserted = true
          break
        }
      }

      if (!inserted) {
        target.appendChild(newEl)
      }
    }
  }

  function parseUpsertModifiers(str) {
    const opts = {}
    if (!str) return opts
    const parts = str.trim().split(/\s+/)
    for (const part of parts) {
      if (part === 'upsert') continue
      if (part === 'prepend') { opts.prepend = true; continue }
      if (part === 'sort') { opts.sort = true; continue }
      if (part.startsWith('sort:')) { opts.sort = part.slice(5); continue }
      if (part.startsWith('key:')) { opts.key = part.slice(4); continue }
    }
    return opts
  }

  htmx.install('hx-upsert', {
    config: { attributeFilter: ['hx-upsert'] },
    on: {
      'htmx:before:swap': (detail, api) => {
        const swap = detail.swap
        if (!swap) return
        const originalExecute = swap.execute
        if (!originalExecute) return

        swap.execute = () => {
          // Parse content to check for hx-upsert tags and handle upsert style
          let content = swap.content
          if (typeof content === 'string') {
            const template = document.createElement('template')
            template.innerHTML = content
            content = template.content
          }

          // Process hx-upsert custom tags in the content
          if (content instanceof DocumentFragment) {
            const upsertTags = content.querySelectorAll('hx-upsert')
            for (const tag of upsertTags) {
              const targetSelector = tag.getAttribute('hx-target')
              const target = targetSelector ? api.find(targetSelector) : null
              if (!target) continue
              const tagOpts = {}
              const key = tag.getAttribute('key')
              const sort = tag.getAttribute('sort')
              const prepend = tag.hasAttribute('prepend')
              if (key) tagOpts.key = key
              if (sort !== null) tagOpts.sort = sort || true
              if (prepend) tagOpts.prepend = true
              doUpsert(target, tag, tagOpts)
              tag.remove()
            }
            // Update content to the modified fragment (tags removed)
            swap.content = content
            // If all content was hx-upsert tags, skip the normal swap
            if (upsertTags.length > 0 && content.childNodes.length === 0) {
              htmx.init(detail.element || document.body)
              return
            }
          }

          // Handle upsert swap style
          if (swap.style === 'upsert') {
            let target = swap.target
            if (typeof target === 'string') target = api.find(target)
            target ??= detail.element
            if (!target) return

            if (!(content instanceof DocumentFragment)) return

            const el = detail.element
            const rawSwap = el?.getAttribute?.('hx-swap') || ''
            const opts = parseUpsertModifiers(rawSwap)
            doUpsert(target, content, opts)
            htmx.init(target)
            return
          }

          // For non-upsert swaps, call original execute
          originalExecute()
        }
      },
    },
  })
})()
