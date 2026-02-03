/**
 * htmx focus-restore extension
 *
 * Restores focus after innerHTML/outerHTML swaps when the active element is replaced.
 * Only works if the focused element has an id that exists in the new content.
 *
 * Config:
 *   htmx.config.focusRestore.scroll = false  // whether focus() should scroll (default: no scroll)
 *
 * This is a "try hard but imperfect" solution for non-morph swaps. Morph swaps
 * naturally preserve focus since they mutate rather than replace the DOM.
 */
htmx.register('focusRestore', {
    on: {
        'htmx:ready': () => {
            htmx.config.focusRestore = {
                scroll: false,
                ...htmx.config.focusRestore,
            }
        },

        'htmx:swap': ({ trigger, swap }) => {
            // Only handle innerHTML/outerHTML - morph preserves focus naturally
            if (swap.method !== 'innerHTML' && swap.method !== 'outerHTML') return

            const active = document.activeElement
            if (!active?.id) return

            // Capture focus state before swap
            trigger.element.state.focusRestore = {
                id: active.id,
                selectionStart: active.selectionStart,
                selectionEnd: active.selectionEnd,
            }
        },

        'htmx:settle': ({ trigger }) => {
            const saved = trigger.element.state.focusRestore
            if (!saved) return

            // Clean up state
            delete trigger.element.state.focusRestore

            // Check if old element is gone
            const oldElement = document.getElementById(saved.id)
            if (oldElement === document.activeElement) return // Still focused, nothing to do

            // Find replacement element with same id
            const newElement = document.getElementById(saved.id)
            if (!newElement) return

            // Restore focus
            try {
                const preventScroll = !htmx.config.focusRestore.scroll
                newElement.focus({ preventScroll })

                // Restore cursor position if applicable
                if (saved.selectionStart != null && newElement.setSelectionRange) {
                    newElement.setSelectionRange(saved.selectionStart, saved.selectionEnd)
                }
            } catch (e) {
                // setSelectionRange or focus may fail on some elements (web components, etc.)
            }
        },
    },
})
