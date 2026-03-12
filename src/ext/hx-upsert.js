//==========================================================
// hx-upsert.js
//
// An extension to add 'upsert' swap style that updates
// existing elements by ID and inserts new ones.
//
// Usage: Include <hx-upsert hx-target="#list" key="data-id" sort prepend>
// tags in your response HTML.
//
// Attributes on <hx-upsert>:
//   hx-target - CSS selector for the target container
//   key       - attribute name for matching/sorting (default: id)
//   sort      - sort ascending (or sort="desc" for descending)
//   prepend   - prepend elements without keys (default: append)
//==========================================================
htmx.install("hx-upsert", {
    requires: ['swaps'],
    on: {
        'htmx:after:response': (detail, api) => {
            const text = detail.response?.text
            if (!text) return
            const template = document.createElement('template')
            template.innerHTML = text
            const fragment = template.content
            const upserts = [...fragment.querySelectorAll('hx-upsert')]
            if (!upserts.length) return
            for (const upsert of upserts) {
                upsert.remove()
                const target = upsert.getAttribute('hx-target')
                    ? document.querySelector(upsert.getAttribute('hx-target')) : null
                if (!target) continue
                const frag = document.createDocumentFragment()
                while (upsert.childNodes.length) frag.appendChild(upsert.firstChild)
                const swapOptions = {content: frag, style: 'upsert', target}
                // Copy modifiers from the tag attributes
                if (upsert.getAttribute('key')) swapOptions.key = upsert.getAttribute('key')
                if (upsert.hasAttribute('sort')) swapOptions.sort = upsert.getAttribute('sort') || true
                if (upsert.hasAttribute('prepend')) swapOptions.prepend = true
                api.swap(swapOptions)
            }
            // Update remaining text if partials were removed
            if (fragment.childNodes.length === 0) detail.response.text = null
            else {
                const t = document.createElement('template')
                t.content.appendChild(fragment)
                detail.response.text = t.innerHTML
            }
        },

        'htmx:before:swap': (detail) => {
            if (detail.swap?.style !== 'upsert') return
            // Replace execute with custom upsert logic
            detail.swap.execute = () => {
                // Resolve target: string selector → element
                let target = detail.swap.target
                if (typeof target === 'string') target = document.querySelector(target)
                target ??= detail.element
                if (!target) return

                // Parse content: string → DocumentFragment
                let content = detail.swap.content
                if (typeof content === 'string') {
                    const template = document.createElement('template')
                    template.innerHTML = content
                    content = template.content
                }

                const keyAttr = detail.swap.key || 'id'
                const desc = detail.swap.sort === 'desc'
                const firstChild = target.firstChild
                const getKey = (el) => el.getAttribute?.(keyAttr) || el.id
                const compare = (a, b) => {
                    let result = a.localeCompare(b, undefined, {numeric: true})
                    return desc ? -result : result
                }
                for (let newEl of Array.from(content.children)) {
                    let id = newEl.id
                    if (id) {
                        let existing = document.getElementById(id)
                        if (existing) { existing.outerHTML = newEl.outerHTML; continue }
                    }
                    let newKey = getKey(newEl)
                    if (!newKey) {
                        if (detail.swap.prepend) target.insertBefore(newEl, firstChild)
                        else target.appendChild(newEl)
                        continue
                    }
                    let inserted = false
                    for (let child of target.children) {
                        let childKey = getKey(child)
                        if (childKey && compare(newKey, childKey) < 0) { target.insertBefore(newEl, child); inserted = true; break }
                    }
                    if (!inserted) target.appendChild(newEl)
                }
                detail.swap._insertedNodes = [...content.childNodes]
            }
        }
    }
})
