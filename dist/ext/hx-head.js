//==========================================================
// head-support.js
//
// An extension to add head tag merging.
//==========================================================
;(() => {

    function mergeHead(api, newContent, defaultMergeStrategy) {

    if (newContent && newContent.indexOf('<head') > -1) {
        const htmlDoc = document.createElement("html")
        // remove svgs to avoid conflicts
        let contentWithSvgsRemoved = newContent.replace(/<svg(\s[^>]*>|>)([\s\S]*?)<\/svg>/gim, '')
        // extract head tag
        let headTag = contentWithSvgsRemoved.match(/(<head(\s[^>]*>|>)([\s\S]*?)<\/head>)/im)

        // if the  head tag exists...
        if (headTag) {

            let added = []
            let removed = []
            let preserved = []
            let nodesToAppend = []

            htmlDoc.innerHTML = headTag
            let newHeadTag = htmlDoc.querySelector("head")
            let currentHead = document.head

            if (newHeadTag == null) {
                return
            }

            // put all new head elements into a Map, by their outerHTML
            let srcToNewHeadNodes = new Map()
            for (const newHeadChild of newHeadTag.children) {
                srcToNewHeadNodes.set(newHeadChild.outerHTML, newHeadChild)
            }

            // determine merge strategy
            let mergeStrategy = newHeadTag.getAttribute("hx-head") || defaultMergeStrategy

            // get the current head
            for (const currentHeadElt of currentHead.children) {

                // If the current head element is in the map
                let inNewContent = srcToNewHeadNodes.has(currentHeadElt.outerHTML)
                let isReAppended = currentHeadElt.getAttribute("hx-head") === "re-eval"
                let isPreserved = currentHeadElt.getAttribute("hx-preserve") === "true"
                if (inNewContent || isPreserved) {
                    if (isReAppended) {
                        // remove the current version and let the new version replace it and re-execute
                        removed.push(currentHeadElt)
                    } else {
                        // this element already exists and should not be re-appended, so remove it from
                        // the new content map, preserving it in the DOM
                        srcToNewHeadNodes.delete(currentHeadElt.outerHTML)
                        preserved.push(currentHeadElt)
                    }
                } else {
                    if (mergeStrategy === "append") {
                        // we are appending and this existing element is not new content
                        // so if and only if it is marked for re-append do we do anything
                        if (isReAppended) {
                            removed.push(currentHeadElt)
                            nodesToAppend.push(currentHeadElt)
                        }
                    } else {
                        // if this is a merge, we remove this content since it is not in the new head
                        if (api.emit(document.body, "htmx:before:head:remove", {headElement: currentHeadElt}) !== false) {
                            removed.push(currentHeadElt)
                        }
                    }
                }
            }

            // Push the remaining new head elements in the Map into the
            // nodes to append to the head tag
            nodesToAppend.push(...srcToNewHeadNodes.values())

            for (const newNode of nodesToAppend) {
                let newElt = document.createRange().createContextualFragment(newNode.outerHTML)
                if (api.emit(document.body, "htmx:before:head:add", {headElement: newElt}) !== false) {
                    currentHead.appendChild(newElt)
                    added.push(newElt)
                }
            }

            // remove all removed elements, after we have appended the new elements to avoid
            // additional network requests for things like style sheets
            for (const removedElement of removed) {
                if (api.emit(document.body, "htmx:before:head:remove", {headElement: removedElement}) !== false) {
                    currentHead.removeChild(removedElement)
                }
            }

            api.emit(document.body, "htmx:after:head:merge", {
                added: added,
                kept: preserved,
                removed: removed
            })
        }
    }
}

    htmx.install("hx-head", {
        requires: ['swaps'],
        on: {
            'htmx:after:swap': (detail, api) => {
                let target = detail.swap?.target
                let defaultMergeStrategy = target === document.body ? "merge" : "append"
                if (api.emit(document.body, "htmx:before:head:merge", detail)) {
                    mergeHead(api, detail.response?.text, defaultMergeStrategy)
                }
            }
        }
    })

})()
