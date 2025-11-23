// noinspection ES6ConvertVarToLetConst
var htmx = (() => {
  // RelaxedJSON: Default format for parsing attribute values
  const RelaxedJSON = {
    parse(str) {
      if (str[0] === '{') return JSON.parse(str)
      let pattern = /([^\s,]+?)(?:\s*:\s*(?:"([^"]*)"|'([^']*)'|<([^>]+)\/>|([^\s,]+)))?(?=\s|,|$)/g
      return [...str.matchAll(pattern)].reduce((result, match) => {
        let keyPath = match[1].split('.')
        let value = (match[2] ?? match[3] ?? match[4] ?? match[5] ?? 'true').trim()
        if (value === 'true') value = true
        else if (value === 'false') value = false
        else if (/^\d+$/.test(value)) value = parseInt(value)
        keyPath.slice(0, -1).reduce((obj, key) => (obj[key] ??= {}), result)[keyPath.at(-1)] = value
        return result
      }, {})
    },
    stringify(obj) {
      return Object.entries(obj)
        .map(([k, v]) => {
          if (v === true) return k
          if (typeof v === 'string' && v.includes(' ')) return `${k}:"${v}"`
          return `${k}:${v}`
        })
        .join(' ')
    },
  }

  // FEATURES: Event-driven declarative features
  const FEATURES = {
    noSwapOn204: {
      on: {
        'htmx:after:request': ({ response, swap }) =>
          response.status === 204 && (swap.strategy = 'none'),
      },
    },
    noSwapOn304: {
      on: {
        'htmx:after:request': ({ response, swap }) =>
          response.status === 304 && (swap.strategy = 'none'),
      },
    },
    applyReswapHeader: {
      on: {
        'htmx:after:request': ({ response, swap }) =>
          response.headers['HX-Reswap'] && (swap.strategy = response.headers['HX-Reswap']),
      },
    },
    applyRetargetHeader: {
      on: {
        'htmx:after:request': ({ response, swap }) =>
          response.headers['HX-Retarget'] && (swap.target = response.headers['HX-Retarget']),
      },
    },
    applyReselectHeader: {
      on: {
        'htmx:after:request': ({ response, swap }) =>
          response.headers['HX-Reselect'] && (swap.select = response.headers['HX-Reselect']),
      },
    },
    applyRedirectHeader: {
      on: {
        'htmx:after:request': ({ response }) =>
          response.headers['HX-Redirect'] &&
          ((location.href = response.headers['HX-Redirect']), false),
      },
    },
    applyRefreshHeader: {
      on: {
        'htmx:after:request': ({ response }) =>
          response.headers['HX-Refresh'] === 'true' && location.reload(),
      },
    },
    etag: {
      on: {
        'htmx:before:request': ({ request }) => {
          const etag = request.element._htmx?.etag
          if (etag) request.headers['If-None-Match'] = etag
        },
        'htmx:after:request': function ({ response, element }) {
          const etag = response.headers['ETag']
          if (etag) this.#setElementState(element, { etag })
        },
      },
    },
    applyTriggerHeader: {
      on: {
        'htmx:after:request': function ({ response, elt }) {
          if (response.headers['HX-Trigger']) {
            // Need access to htmx instance - will be bound in #registerConfigEventHandlers
            this.#handleTriggerHeader(response.headers['HX-Trigger'], elt)
          }
        },
      },
    },
    applyLocationHeader: {
      on: {
        'htmx:after:request': function ({ response }) {
          if (response.headers['HX-Location']) {
            let path = response.headers['HX-Location'],
              opts = {}
            if (path[0] === '{' || /[\s,]/.test(path)) {
              opts = this.#parse(path)
              path = opts.path
              delete opts.path
            }
            opts.push = opts.push || 'true'
            this.ajax('GET', path, opts)
            return false // Abort swap
          }
        },
      },
    },
    replaceTitle: {
      on: {
        'htmx:after:swap': ({ swaps }) => {
          let mainSwap = swaps?.find(s => s.type === 'main')
          if (mainSwap?.fragment) {
            let title = mainSwap.fragment.querySelector('title')
            if (title) document.title = title.textContent
          }
        },
      },
    },
    executeScripts: {
      on: {
        'htmx:after:response': function ({ swaps }) {
          const nonce = this.config.behaviors.executeScripts?.nonce

          for (let swap of swaps) {
            if (!swap.fragment) continue

            // Execute scripts by replacing them (makes them run)
            let scripts = this.#queryAll(swap.fragment, 'script')
            for (let oldScript of scripts) {
              let newScript = document.createElement('script')
              for (let attr of oldScript.attributes) {
                newScript.setAttribute(attr.name, attr.value)
              }
              if (nonce) {
                newScript.nonce = nonce
              }
              newScript.textContent = oldScript.textContent
              oldScript.replaceWith(newScript)
            }
          }
        },
      },
    },

    // hx-ignore: Cancel activation of elements inside [hx-ignore] containers
    'hx-ignore': {
      attribute: /^hx-ignore$/,
      on: {
        'htmx:before:element:activate': function ({ element }) {
          const attr = this.#attrName('hx-ignore')
          if (element.closest(`[${attr}]`)) return false
        },
      },
    },

    // hx-boost: Progressively enhance links and forms
    'hx-boost': {
      attribute: /^hx-boost$/,
      on: {
        'htmx:after:activate': function ({ element }) {
          const attr = this.#attrName('hx-boost')
          const selector = `[${attr}="true"] a:not([target="_blank"]), [${attr}="true"] form:not([method="dialog"]), a[${attr}="true"]:not([target="_blank"]), form[${attr}="true"]:not([method="dialog"])`
          for (let elt of element.querySelectorAll(selector)) {
            if (elt._htmx) continue
            const url = elt.href || elt.action
            if (url?.startsWith('#') || !this.#isSameOrigin(url)) continue

            this.#setElementState(elt, { boosted: true })
            const handler = this.#createHtmxEventHandler(elt)
            elt.addEventListener(elt.matches('a') ? 'click' : 'submit', handler)
            try {
              this.emit('htmx:after:element:activate', { element: elt }, elt)
            } catch (e) {
              if (e !== CANCELLED) throw e
            }
          }
        },
      },
    },

    // hx-on: Declarative event handlers in HTML attributes
    // TODO: Add cleanup on htmx:before:element:deactivate (remove listeners)
    'hx-on': {
      attribute: /^hx-on[:\.]/, // matches hx-on:click, hx-on.click, etc.
      shorthands: {
        request: 'htmx:before:request',
        response: 'htmx:after:response',
        swap: 'htmx:before:swap',
        error: 'htmx:error',
        'element:activate': 'htmx:before:element:activate',
        'element:deactivate': 'htmx:before:element:deactivate',
        'history:push': 'htmx:before:history:push',
        'history:replace': 'htmx:before:history:replace',
        'history:restore': 'htmx:before:history:restore',
        sse: 'htmx:before:sse',
        'sse:message': 'htmx:before:sse:message',
        transition: 'htmx:before:transition',
      },
      on: {
        'htmx:after:element:activate': function ({ element }) {
          const attributeName = this.#attrName('hx-on')
          const delimiter = this.config.syntax.delimiter
          const shorthands = FEATURES['hx-on'].shorthands

          for (let attr of element.getAttributeNames()) {
            if (!attr.startsWith(attributeName + delimiter)) continue

            let eventName = attr.slice(attributeName.length + 1) // +1 for delimiter
            let code = element.getAttribute(attr)

            // Handle :: shorthand (drops htmx: prefix)
            if (eventName.startsWith(delimiter)) {
              eventName = eventName.slice(1) // Remove leading delimiter

              // Check for shorthand (e.g., ::request -> htmx:before:request)
              if (!eventName.startsWith('before:') && !eventName.startsWith('after:')) {
                eventName = shorthands[eventName] || 'htmx:before:' + eventName
              } else {
                eventName = 'htmx:' + eventName
              }
            }

            element.addEventListener(eventName, async event => {
              try {
                await this.#executeJavaScriptAsync(element, { event }, code, false)
              } catch (e) {
                if (e !== CANCELLED) console.error(e)
              }
            })
          }
        },
      },
    },
  }

  const CANCELLED = Symbol('cancelled')

  const DEFAULT_CONFIG = {
    version: '4.0.0-alpha3',

    // Core Settings
    debug: false,
    implicitInheritance: false,

    // Syntax Configuration
    syntax: {
      prefix: 'hx-', // Attribute prefix: hx-get -> data-hx-get
      delimiter: ':', // Attribute delimiter: hx-on:click -> hx-on.click
      format: RelaxedJSON, // Parser for attribute values (.parse/.stringify)
    },

    // History
    history: {
      enabled: true,
      reload: false,
    },

    // Request Configuration
    request: {
      timeout: 60000,
      credentials: 'same-origin',
      mode: 'same-origin',
      vals: {},
      headers: {
        // Static
        'HX-Request': 'true',
        Accept: 'text/html, text/event-stream',
        // Dynamic (resolved at runtime)
        'HX-Current-URL': () => location.href,
        'HX-Source': request => request.element.id || request.element.name,
        // null = remove header
        'HX-Boosted': request => (request.element._htmx?.boosted ? 'true' : null),
      },
    },

    // Feature toggles (implementations in FEATURES constant above)
    features: FEATURES,

    // Swap Configuration
    swap: {
      strategy: 'innerHTML',
      target: 'this',
      select: null,
      selectOOB: null,

      modifiers: {
        delay: 0, // delay before swap (ms)
        scroll: null, // {direction: 'top'|'bottom', target: selector}
        show: null, // {direction: 'top'|'bottom', target: selector}
        focus: null, // {scroll: bool}
        transition: true,
        async: false, // run swap in parallel with others?
      },
    },

    // Element state configuration
    elementStateAttribute: 'data-htmx',
    elementStateConfig: {
      // States always serialized to data-htmx (for styling/debugging)
      always: ['active', 'boosted', 'requesting', 'loading', 'error'],
      // Additional states serialized only in debug mode
      debug: ['status', 'verb', 'url', 'etag'],
      // States never serialized (runtime only)
      never: ['eventHandler', 'triggerSpecs', 'listeners', 'interval', 'timeout', 'requests'],
    },

    injectStyles: (htmx, config) => {
      let attr = config.elementStateAttribute
      return (
        `[${attr}~="loading"]{opacity:0;visibility:hidden} ` +
        `[${attr}~="requesting"] [${attr}~="loading"], ` +
        `[${attr}~="requesting"][${attr}~="loading"]{opacity:1;visibility:visible;transition:opacity 200ms ease-in}`
      )
    },

    // CSS selectors that identify:
    selectors: {
      // What selectors need to be present for htmx.activate() to activate an element
      activation: ['get', 'post', 'put', 'patch', 'delete', 'stream', 'sse']
        .map(verb => `[hx-${verb}]`)
        .concat(['[hx-action]'])
        .join(','),

      // What should be ignored by htmx
      ignore: '[hx-ignore], [hx-ignore] *',

      // What contributes to form data / `hx-vals`
      formInput: 'input:not([disabled]), select:not([disabled]), textarea:not([disabled])',
    },

    // Allowlist: Only these keys can be overridden via attributes
    _allowRuntimeOverrides: new Set([
      'history.enabled',
      'history.reload',
      'swap.strategy',
      'swap.target',
      'swap.select',
      'swap.selectOOB',
      'swap.modifiers.delay',
      'swap.modifiers.scroll',
      'swap.modifiers.show',
      'swap.modifiers.focus',
      'swap.modifiers.transition',
      'swap.modifiers.async',
      'request.timeout',
      'request.headers',
      'request.vals',
      'elementStateAttribute',
      'injectStyles',
    ]),
  }

  // CONFIG_ATTRIBUTES: Maps attributes to config paths
  // All swap-related attributes (hx-swap, hx-target, hx-select) map to the same "swap" namespace
  // because they're all just different ways to configure the swap operation
  const CONFIG_ALIASES = new Map([
    ['hx-headers', 'request.headers'],
    ['hx-vals', 'request.vals'],
    ['hx-timeout', 'request.timeout'],
    ['hx-history', 'history.enabled'],
    ['hx-swap', 'swap'], // Can set any swap.* property
    ['hx-target', 'swap'], // Sugar for swap.target (but can include modifiers)
    ['hx-select', 'swap'], // Sugar for swap.select (but can include modifiers)
  ])

  class ReqQ {
    #c = null
    #q = []

    issue(ctx, queueStrategy) {
      if (!this.#c) {
        this.#c = ctx
        return true
      } else {
        // Update ctx.status properly for replaced request contexts
        if (queueStrategy === 'replace') {
          this.#q.map(value => (value.status = 'dropped'))
          this.#q = []
          if (this.#c) {
            this.#c.abort()
          }
          return true
        } else if (queueStrategy === 'queue all') {
          this.#q.push(ctx)
          ctx.status = 'queued'
        } else if (queueStrategy === 'drop') {
          // ignore the request
          ctx.status = 'dropped'
        } else if (queueStrategy === 'queue last') {
          this.#q.map(value => (value.status = 'dropped'))
          this.#q = [ctx]
          ctx.status = 'queued'
        } else if (this.#q.length === 0) {
          // default queue first
          this.#q.push(ctx)
          ctx.status = 'queued'
        } else {
          ctx.status = 'dropped'
        }
        return false
      }
    }

    finish() {
      this.#c = null
    }

    next() {
      return this.#q.shift()
    }

    abort() {
      this.#c?.abort?.()
    }

    more() {
      return this.#q?.length
    }
  }

  class HtmxRequest {
    constructor({ element, event, action, verb, headers = {}, body = null, config }) {
      Object.assign(this, { element, event, action, verb, headers, body, config })
      this.abortController = new AbortController()
    }

    async execute() {
      // Build fetch request
      const fetchOptions = {
        method: this.verb,
        headers: this.headers,
        signal: this.abortController.signal,
        credentials: this.config.request.credentials,
        mode: this.config.request.mode,
      }

      // Add body if not GET
      if (this.verb !== 'GET' && this.body) {
        fetchOptions.body = this.body
      }

      // Setup timeout
      const timeout = this.config.request.timeout
      const timeoutId = timeout ? setTimeout(() => this.abort(), timeout) : null

      try {
        // Execute fetch
        const rawResponse = await fetch(this.action, fetchOptions)

        // Clear timeout
        if (timeoutId) clearTimeout(timeoutId)

        // Create and return HtmxResponse
        return new HtmxResponse({
          request: this,
          raw: rawResponse,
        })
      } catch (error) {
        // Clear timeout on error
        if (timeoutId) clearTimeout(timeoutId)
        throw error
      }
    }

    abort() {
      this.abortController.abort()
    }
  }

  class HtmxResponse {
    #text

    constructor({ request, raw }) {
      this.request = request
      this.raw = raw
      this.status = raw.status
      this.headers = Object.fromEntries(raw.headers)
    }

    async text() {
      if (!this.#text) {
        this.#text = await this.raw.text()
      }
      return this.#text
    }

    isSSE() {
      return this.raw.headers.get('content-type')?.includes('text/event-stream')
    }
  }

  class Swap {
    modifiers = {
      delay: 0,
      scroll: null,
      show: null,
      focus: null,
      transition: true,
      async: false,
    }

    constructor({ type, response, fragment, strategy, target, select, modifiers = {} }) {
      Object.assign(this, { type, response, fragment, strategy, target, select })
      this.modifiers = { ...this.modifiers, ...modifiers }
    }

    async execute(htmx) {
      const targetElement = this.getTargetElement(htmx)
      if (!targetElement) return

      // Apply select filter to fragment if specified
      let fragment = this.fragment
      if (this.select) {
        const selected = fragment.querySelectorAll(this.select)
        fragment = document.createDocumentFragment()
        fragment.append(...selected)
      }

      // Apply delay
      if (this.modifiers.delay > 0) {
        await new Promise(resolve => setTimeout(resolve, this.modifiers.delay))
      }

      // Execute the swap strategy
      const parentNode = targetElement.parentNode

      if (this.strategy === 'innerHTML') {
        targetElement.replaceChildren(...fragment.childNodes)
      } else if (this.strategy === 'outerHTML') {
        if (parentNode) {
          targetElement.replaceWith(...fragment.childNodes)
        }
      } else if (this.strategy === 'beforebegin') {
        if (parentNode) {
          targetElement.before(...fragment.childNodes)
        }
      } else if (this.strategy === 'afterbegin') {
        targetElement.prepend(...fragment.childNodes)
      } else if (this.strategy === 'beforeend') {
        targetElement.append(...fragment.childNodes)
      } else if (this.strategy === 'afterend') {
        if (parentNode) {
          targetElement.after(...fragment.childNodes)
        }
      } else if (this.strategy === 'delete') {
        if (parentNode) {
          parentNode.removeChild(targetElement)
        }
        return
      } else if (this.strategy === 'none') {
        return
      } else {
        throw new Error(`Unknown swap strategy: ${this.strategy}`)
      }

      // Process new elements
      const newElements = [...targetElement.querySelectorAll('*')]
      for (const elt of newElements) {
        htmx.activate(elt)
      }
    }

    getTargetElement(htmx) {
      const requestElement = this.response.request.element

      // Already an element
      if (this.target instanceof Element) {
        return this.target
      }

      // "this" keyword
      if (this.target === 'this') {
        return requestElement
      }

      // CSS selector
      if (this.target != null) {
        return htmx.find(requestElement, this.target)
      }

      // Boosted elements target body
      if (requestElement?._htmx?.boosted) {
        return document.body
      }

      // Default to request element
      return requestElement
    }
  }

  /**
   * Extract Swap instances from an HtmxResponse
   * Returns array of Swap objects: [main swap, ...oob swaps, ...partial swaps]
   */
  async function extractSwapsFromResponse(response, htmx) {
    const swaps = []
    const text = await response.text()

    // Parse HTML (convert <hx-*> tags to <template> tags)
    let html = text
      .replace(/<hx-([a-z]+)(\s+|>)/gi, '<template hx type="$1"$2')
      .replace(/<\/hx-[a-z]+>/gi, '</template>')

    // Remove <head> content
    let htmlWithNoHead = html.replace(/<head(\s[^>]*)?>[\s\S]*?<\/head>/i, '')
    let startTag = htmlWithNoHead.match(/<([a-z][^\/>\x20\t\r\n\f]*)/i)?.[1]?.toLowerCase()

    // Parse into fragment
    let doc, fragment
    if (startTag === 'html') {
      doc = htmx.#parseHTML(html)
      fragment = doc.body
    } else if (startTag === 'body') {
      doc = htmx.#parseHTML(htmlWithNoHead)
      fragment = doc.body
    } else {
      doc = htmx.#parseHTML(`<template>${htmlWithNoHead}</template>`)
      fragment = doc.querySelector('template').content
    }

    // Extract OOB swaps from selectOOB config
    const config = response.request.config
    if (config.swap.selectOOB) {
      for (let spec of config.swap.selectOOB.split(',')) {
        let [selector, oobValue = 'true'] = spec.trim().split(/:(.*)/)
        for (let elt of fragment.querySelectorAll(selector)) {
          let target = elt.id ? '#' + CSS.escape(elt.id) : null

          // Parse oobValue: could be "true", a swap strategy, or "strategy:target"
          let strategy = 'outerHTML'
          if (oobValue !== 'true' && oobValue && !oobValue.includes(' ')) {
            ;[oobValue, target = target] = oobValue.split(/:(.*)/)
          }
          if (oobValue && oobValue !== 'true') strategy = oobValue

          if (!target) continue

          let oobFragment = document.createDocumentFragment()
          oobFragment.append(elt)

          swaps.push(
            new Swap({
              type: 'oob',
              response,
              fragment: oobFragment,
              strategy,
              target,
              select: null,
              modifiers: { ...config.swap.modifiers },
            }),
          )
        }
      }
    }

    // Extract OOB swaps from hx-swap-oob attributes
    for (let oobElt of fragment.querySelectorAll(`[${this.#attrName('hx-swap-oob')}]`)) {
      let oobValue = oobElt.getAttribute(this.#attrName('hx-swap-oob'))
      oobElt.removeAttribute(this.#attrName('hx-swap-oob'))

      let target = oobElt.id ? '#' + CSS.escape(oobElt.id) : null

      // Parse oobValue: could be "true", a swap strategy, or "strategy:target"
      let strategy = 'outerHTML'
      if (oobValue !== 'true' && oobValue && !oobValue.includes(' ')) {
        ;[oobValue, target = target] = oobValue.split(/:(.*)/)
      }
      if (oobValue && oobValue !== 'true') strategy = oobValue

      if (!target) continue

      let oobFragment = document.createDocumentFragment()
      oobFragment.append(oobElt)

      swaps.push(
        new Swap({
          type: 'oob',
          response,
          fragment: oobFragment,
          strategy,
          target,
          select: null,
          modifiers: { ...config.swap.modifiers },
        }),
      )
    }

    // Extract partial swaps (template elements with hx type="partial")
    for (let templateElt of fragment.querySelectorAll('template[hx]')) {
      let type = templateElt.getAttribute('type')

      if (type === 'partial') {
        let partialStrategy =
          templateElt.getAttribute(this.#attrName('hx-swap')) || config.swap.strategy
        let partialTarget = templateElt.getAttribute(this.#attrName('hx-target'))

        swaps.push(
          new Swap({
            type: 'partial',
            response,
            fragment: templateElt.content.cloneNode(true),
            strategy: partialStrategy,
            target: partialTarget,
            select: null,
            modifiers: { ...config.swap.modifiers },
          }),
        )

        templateElt.remove()
      } else {
        // Other template types handled by extensions
        htmx.#triggerExtensions(templateElt, 'htmx:process:' + type, { response, swaps })
      }
    }

    // Create main swap
    const mainSwap = new Swap({
      type: 'main',
      response,
      fragment,
      strategy: config.swap.strategy,
      target: config.swap.target,
      select: config.swap.select,
      modifiers: { ...config.swap.modifiers },
    })
    swaps.push(mainSwap)

    return swaps
  }

  class Htmx {
    #config
    #extMethods = new Map()
    #approvedExt = ''
    #registeredExt = new Set()
    #internalAPI
    #verbs = ['get', 'post', 'put', 'patch', 'delete']
    #hxOnQuery
    #transitionQueue
    #processingTransition

    constructor() {
      this.#initConfig()
      this.#registerConfigEventHandlers()
      this.#injectStateStyles()
      this.#hxOnQuery = new XPathEvaluator().createExpression(
        `.//*[@*[ starts-with(name(), "${this.#attrName('hx-on')}")]]`,
      )
      this.#internalAPI = {
        attributeValue: this.#attrValue.bind(this),
        parseTriggerSpecs: this.#parseTriggerSpecs.bind(this),
        determineVerbAndAction: this.#determineVerbAndAction.bind(this),
        createRequestContext: this.#createRequestContext.bind(this),
        collectFormData: this.#collectFormData.bind(this),
        handleHxVals: this.#handleHxVals.bind(this),
      }
      document.addEventListener('DOMContentLoaded', () => {
        this.#initHistoryHandling()
        this.activate(document.body)
      })
    }

    #initConfig() {
      // Start with defaults
      this.config = { ...DEFAULT_CONFIG }

      // Merge <meta> overrides
      let metaConfig = document.querySelector('meta[name="htmx:config"]')
      if (metaConfig) {
        let overrides = this.#parse(metaConfig.content)
        this.#mergeConfig(this.config, overrides)
      }
    }

    #registerConfigEventHandlers() {
      // Register behaviours from config
      for (let [name, behaviour] of Object.entries(this.config.behaviours || {})) {
        if (behaviour.enabled !== false) {
          for (let [eventName, handler] of Object.entries(behaviour.on || {})) {
            document.addEventListener(eventName, evt => {
              // Bind htmx instance as 'this' for handlers that need it
              let result = handler.call(this, evt.detail || {})
              if (result === false) evt.preventDefault()
            })
          }
        }
      }
    }

    #mergeConfig(target, source) {
      for (const key in source) {
        const sVal = source[key]
        // Deep merge objects (like 'headers' or 'sse')
        if (sVal && typeof sVal === 'object' && !Array.isArray(sVal)) {
          if (!target[key]) target[key] = {}
          this.#mergeConfig(target[key], sVal)
        }
        // Escape hatch: null deletes the key
        else if (sVal === null) {
          delete target[key]
        } else {
          target[key] = sVal
        }
      }
      return target
    }

    #resolve(value, ...args) {
      if (typeof value === 'function') {
        return value(...args)
      }
      return value
    }

    #setElementState(elt, updates) {
      // Initialize _htmx if needed
      elt._htmx ??= {}

      let attr = this.config.elementStateAttribute
      let stateConfig = this.config.elementStateConfig
      let serializable = this.#parse(elt.getAttribute(attr) || '')

      for (let [key, value] of Object.entries(updates)) {
        if (value === null || value === undefined) {
          delete elt._htmx[key]
          delete serializable[key]
        } else {
          elt._htmx[key] = value

          // Determine if this state should be serialized to data-htmx
          let shouldSerialize = false

          // Never serialize these (runtime only)
          if (stateConfig.never.includes(key)) {
            shouldSerialize = false
          }
          // Always serialize these
          else if (stateConfig.always.includes(key)) {
            shouldSerialize = true
          }
          // Debug-only states
          else if (stateConfig.debug.includes(key) && this.config.debug) {
            shouldSerialize = true
          }
          // For any other primitives not in config, serialize them
          else if (
            typeof value === 'string' ||
            typeof value === 'number' ||
            typeof value === 'boolean'
          ) {
            shouldSerialize = true
          }

          if (shouldSerialize) {
            serializable[key] = value
          }
        }
      }

      let str = this.#stringify(serializable)
      if (str) {
        elt.setAttribute(attr, str)
      } else {
        elt.removeAttribute(attr)
      }
    }

    #getElementState(elt, key) {
      let attr = this.config.elementStateAttribute
      let current = this.#parse(elt.getAttribute(attr) || '')
      return current[key]
    }

    #buildScopedConfig(elt) {
      // 1. Start with Global Defaults (cached/cloned)
      let scope = { ...this.#config }

      // 2. Iterate attributes ONCE
      for (let attr of elt.attributes) {
        let name = this.#attrName(attr.name) // Handle prefixes if used
        let value = attr.value
        let configKey = null

        // A. Check for Shorthands (O(1) lookup)
        if (CONFIG_ALIASES.has(name)) {
          configKey = CONFIG_ALIASES.get(name)
        }

        // B. Check for explicit Namespaces (hx-config:headers)
        else if (name.startsWith('hx-config:')) {
          configKey = name.substring(10) // len("hx-config:")
        }

        // C. Check for Root Config (hx-config="{...}")
        else if (name === 'hx-config') {
          let overrides = this.#parse(value)
          this.#mergeConfig(scope, overrides)
          continue
        }

        // 3. Process the Config Key (If found)
        if (configKey) {
          // Handle nested paths like "fetch.headers"
          let keys = configKey.split('.')
          let target = scope

          // Navigate to the parent object
          for (let i = 0; i < keys.length - 1; i++) {
            if (!target[keys[i]]) target[keys[i]] = {}
            target = target[keys[i]]
          }

          let finalKey = keys[keys.length - 1]

          // Check allowlist with the full path
          if (DEFAULT_CONFIG._allowRuntimeOverrides.has(configKey)) {
            // Is the target an object (headers, vals)? -> MERGE
            if (target[finalKey] && typeof target[finalKey] === 'object') {
              // hx-headers="a:1" -> parses to object -> merges
              let overrides = this.#parse(value)
              this.#mergeConfig(target[finalKey], overrides)
            }
            // Is the target a primitive (timeout, indicator)? -> REPLACE
            else {
              // hx-timeout="5000" -> raw string logic
              target[finalKey] = value
            }
          }
        }
      }

      return scope
    }

    #injectStateStyles() {
      if (this.config.elementState?.injectStyles) {
        let nonceAttribute = ''
        if (this.config.inlineStyleNonce) {
          nonceAttribute = ` nonce="${this.config.inlineStyleNonce}"`
        }
        let styles = this.#resolve(this.config.elementState.injectStyles, null, this, this.config)
        document.head.insertAdjacentHTML('beforeend', `<style${nonceAttribute}>${styles}</style>`)
      }
    }

    defineExtension(name, extension) {
      if (this.#approvedExt && !this.#approvedExt.split(/,\s*/).includes(name)) return false
      if (this.#registeredExt.has(name)) return false
      this.#registeredExt.add(name)
      if (extension.init) extension.init(this.#internalAPI)
      Object.entries(extension).forEach(([key, value]) => {
        if (!this.#extMethods.get(key)?.push(value)) this.#extMethods.set(key, [value])
      })
    }

    #attrName(name) {
      const { prefix, delimiter } = this.config.syntax
      return name.replace('hx-', prefix).replace(/:/g, delimiter)
    }

    #attrValue(elt, name, defaultVal, returnElt) {
      name = this.#attrName(name)
      let appendName = this.#attrName(name + ':append')
      let inheritName = this.#attrName(name + (this.config.implicitInheritance ? '' : ':inherited'))
      let inheritAppendName = this.#attrName(name + ':inherited:append')

      if (elt.hasAttribute(name)) {
        return returnElt ? elt : elt.getAttribute(name)
      }

      if (elt.hasAttribute(inheritName)) {
        return returnElt ? elt : elt.getAttribute(inheritName)
      }

      if (elt.hasAttribute(appendName) || elt.hasAttribute(inheritAppendName)) {
        let appendValue = elt.getAttribute(appendName) || elt.getAttribute(inheritAppendName)
        let parent = elt.parentNode?.closest?.(
          `[${CSS.escape(inheritName)}],[${CSS.escape(inheritAppendName)}]`,
        )
        if (parent) {
          let inherited = this.#attrValue(parent, name, undefined, returnElt)
          return returnElt ? inherited : inherited ? inherited + ',' + appendValue : appendValue
        } else {
          return returnElt ? elt : appendValue
        }
      }

      let parent = elt.parentNode?.closest?.(
        `[${CSS.escape(inheritName)}],[${CSS.escape(inheritAppendName)}]`,
      )
      if (parent) {
        let val = this.#attrValue(parent, name, undefined, returnElt)
        if (!returnElt && val && this.config.implicitInheritance) {
          this.#triggerExtensions(elt, 'htmx:after:implicitInheritance', { elt, parent })
        }
        return val
      }
      return returnElt ? elt : defaultVal
    }

    #parse(value) {
      return this.config.syntax.format.parse(value)
    }

    #stringify(obj) {
      return this.config.syntax.format.stringify(obj)
    }

    #queryAll(elt, selector) {
      let results = [...elt.querySelectorAll(selector)]
      if (elt.matches?.(selector)) {
        results.unshift(elt)
      }
      return results
    }

    #normalizeSwapStyle(style) {
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

    /**
     * Universal attribute value parser
     *
     * Format: item1 || item2 || item3
     * Where each item is: <value> <modifier1>:<val1>, <modifier2>:<val2>
     *
     * Rules:
     * - || separates multiple items (for multi-value attributes like hx-trigger)
     * - Within an item: everything before first key:value pattern is the value
     * - Commas within items are optional separators for readability
     * - Values can have spaces (no quotes needed)
     *
     * Examples:
     * - "innerHTML scroll:top" -> [{value: "innerHTML", scroll: "top"}]
     * - "closest form, strategy:drop" -> [{value: "closest form", strategy: "drop"}]
     * - "click || keyup delay:500ms" -> [{value: "click"}, {value: "keyup", delay: "500ms"}]
     */
    #parseAttributeValue(value) {
      if (!value?.trim()) return []

      // Split by || for multi-item attributes
      let items = value
        .split('||')
        .map(s => s.trim())
        .filter(Boolean)

      return items
        .map(item => {
          // Split by spaces and commas
          let tokens = item.split(/[\s,]+/).filter(Boolean)

          // Find first token containing ':' (start of modifiers)
          let modifierIndex = tokens.findIndex(t => t.includes(':'))

          if (modifierIndex === -1) {
            // No modifiers - entire item is the value
            return { value: item.replace(/\s*,\s*/g, ' ').trim() }
          }

          if (modifierIndex === 0) {
            // Starts with modifier (no value)
            return {
              value: null,
              ...this.#parse(tokens.join(' ')),
            }
          }

          // Split between value and modifiers
          let value = tokens.slice(0, modifierIndex).join(' ')
          let modifierStr = tokens.slice(modifierIndex).join(' ')

          return {
            value,
            ...this.#parse(modifierStr),
          }
        })
        .filter(Boolean)
    }

    /**
     * Parse swap-related attributes (hx-swap, hx-target, hx-select)
     * All map to the swap config namespace but have different "primary" properties
     *
     * @param {string} attrName - The attribute name (e.g., "hx-swap")
     * @param {string} attrValue - The attribute value (e.g., "#foo scroll:top")
     * @returns {object} - Parsed config object mapping to swap namespace
     *
     * Examples:
     * - parseSwapAttribute("hx-target", "#foo scroll:top")
     *   → {target: "#foo", scroll: {direction: "top", ...}}
     * - parseSwapAttribute("hx-swap", "innerHTML target:#foo")
     *   → {strategy: "innerHTML", target: "#foo"}
     */
    #parseSwapAttribute(attrName, attrValue) {
      // Parse using universal parser (returns array, we take first item)
      let parsed = this.#parseAttributeValue(attrValue)
      if (!parsed.length) return {}

      let item = parsed[0] // Swap attributes don't use || syntax

      // Determine primary property based on attribute name
      const PRIMARY_PROPERTIES = {
        'hx-swap': 'strategy',
        'hx-target': 'target',
        'hx-select': 'select',
      }

      let primaryProp = PRIMARY_PROPERTIES[attrName]
      if (!primaryProp) return item // Unknown attribute, return as-is

      // Build result: primary property + all modifiers
      let result = { ...item }
      delete result.value
      result[primaryProp] = item.value

      return result
    }

    #parseTriggerSpecs(spec) {
      // Use universal parser, but add 'name' for backward compatibility
      return this.#parseAttributeValue(spec).map(item => {
        // Check for unterminated brackets (old validation)
        if (item.value?.includes('[') && !item.value.includes(']')) {
          throw new Error('Unterminated bracket in: ' + item.value)
        }
        return { name: item.value, ...item }
      })
    }

    #determineVerbAndAction(elt, evt) {
      if (this.#isBoosted(elt)) {
        return this.#boostedVerbAndAction(elt, evt)
      } else {
        let verb = this.#attrValue(elt, 'hx-verb') || 'GET'
        let action = this.#attrValue(elt, 'hx-action')
        if (!action) {
          for (let v of this.#verbs) {
            let verbAction = this.#attrValue(elt, 'hx-' + v)
            if (verbAction) {
              action = verbAction
              verb = v
              break
            }
          }
        }
        verb = verb.toUpperCase()
        return { activation: action, verb }
      }
    }

    #boostedVerbAndAction(elt, evt) {
      if (elt.matches('a')) {
        return { activation: elt.getAttribute('href'), verb: 'GET' }
      } else {
        let action = evt.submitter?.getAttribute?.('formAction') || elt.getAttribute('action')
        let verb =
          evt.submitter?.getAttribute?.('formMethod') || elt.getAttribute('method') || 'GET'
        return { activation: action, verb }
      }
    }

    #createHtmxEventHandler(elt) {
      return async evt => {
        try {
          let ctx = this.#createRequestContext(elt, evt)
          await this.#handleTriggerEvent(ctx)
        } catch (e) {
          if (e !== CANCELLED) console.error(e)
        }
      }
    }

    #createRequestContext(sourceElement, sourceEvent) {
      // Build scoped config using the harvester pattern
      let scopedConfig = this.#buildScopedConfig(sourceElement)

      // Build request context
      let { action, verb } = this.#determineVerbAndAction(sourceElement, sourceEvent)

      // Resolve headers from scoped config
      let headers = {}
      for (let [key, value] of Object.entries(scopedConfig.request.headers)) {
        let resolved = this.#resolve(value, sourceElement, this, scopedConfig)
        if (resolved !== null) {
          headers[key] = resolved
        }
      }

      // Create Swap instance with resolved values
      let swap = new Swap({
        strategy: this.#resolve(
          scopedConfig.swap.strategy.resolve,
          sourceElement,
          this,
          scopedConfig,
        ),
        target: this.#resolve(scopedConfig.swap.target.resolve, sourceElement, this, scopedConfig),
        select: this.#resolve(scopedConfig.swap.select.resolve, sourceElement, this, scopedConfig),
        sourceElement,
        modifiers: {
          selectOOB: this.#attrValue(sourceElement, 'hx-select-oob'),
          push: this.#attrValue(sourceElement, 'hx-push-url'),
          replace: this.#attrValue(sourceElement, 'hx-replace-url'),
          transition: this.config.transitions,
        },
      })

      let ctx = {
        sourceElement,
        sourceEvent,
        config: scopedConfig,
        status: 'created',
        swap,
        confirm: this.#attrValue(sourceElement, 'hx-confirm'),
        request: {
          ...scopedConfig.request,
          validate:
            'true' ===
            this.#attrValue(
              sourceElement,
              'hx-validate',
              sourceElement.matches('form') ? 'true' : 'false',
            ),
          action,
          verb,
          headers,
        },
      }

      return ctx
    }

    #resolveTarget(elt, selector) {
      if (selector instanceof Element) {
        return selector
      } else if (selector === 'this') {
        return this.#attrValue(elt, 'hx-target', undefined, true)
      } else if (selector != null) {
        return this.find(elt, selector)
      } else if (this.#isBoosted(elt)) {
        return document.body
      } else {
        return elt
      }
    }

    #isBoosted(elt) {
      return elt?._htmx?.boosted
    }

    async #handleTriggerEvent(ctx) {
      let elt = ctx.sourceElement
      let evt = ctx.sourceEvent
      if (!elt.isConnected) return

      if (this.#isModifierKeyClick(evt)) return

      if (this.#shouldCancel(evt)) evt.preventDefault()

      // Build request body
      let form = elt.form || elt.closest('form')
      let body = this.#collectFormData(elt, form, evt.submitter)
      let valsResult = this.#handleHxVals(elt, body)
      if (valsResult) await valsResult // Only await if it returned a promise
      if (ctx.values) {
        for (let k in ctx.values) {
          body.delete(k)
          body.append(k, ctx.values[k])
        }
      }

      // Setup abort controller and action
      let ac = new AbortController()
      let action = ctx.request.action.replace?.(/#.*$/, '')
      // TODO - consider how this works with hx-config, move most to #createRequestContext?
      Object.assign(ctx.request, {
        originalAction: ctx.request.action,
        action,
        form,
        submitter: evt.submitter,
        abort: ac.abort.bind(ac),
        body,
        credentials: 'same-origin',
        signal: ac.signal,
        mode: this.config.mode,
      })

      this.emit('htmx:config:request', { ctx }, elt)
      if (!this.#verbs.includes(ctx.request.verb.toLowerCase())) return
      if (ctx.request.validate && ctx.request.form && !ctx.request.form.reportValidity()) return

      let javascriptContent = this.#extractJavascriptContent(ctx.request.action)
      if (javascriptContent) {
        let data = Object.fromEntries(ctx.request.body)
        await this.#executeJavaScriptAsync(ctx.sourceElement, data, javascriptContent, false)
        return
      } else if (/GET|DELETE/.test(ctx.request.verb)) {
        let params = new URLSearchParams(ctx.request.body)
        if (params.size) ctx.request.action += (/\?/.test(ctx.request.action) ? '&' : '?') + params
        ctx.request.body = null
      } else if (this.#attrValue(elt, 'hx-encoding') !== 'multipart/form-data') {
        ctx.request.body = new URLSearchParams(ctx.request.body)
      }

      await this.#issueRequest(ctx)
    }

    async #issueRequest(ctx) {
      let elt = ctx.sourceElement
      let syncStrategy = this.#determineSyncStrategy(elt)
      let requestQueue = this.#getRequestQueue(elt)

      if (!requestQueue.issue(ctx, syncStrategy)) return

      ctx.status = 'issuing'
      this.#setElementState(elt, { requesting: true })
      this.#initTimeout(ctx)

      let indicatorsSelector = this.#attrValue(elt, 'hx-indicator')
      let indicators = this.#showIndicators(elt, indicatorsSelector)
      let disableSelector = this.#attrValue(elt, 'hx-disable')
      let disableElements = this.#disableElements(elt, disableSelector)

      try {
        // Handle confirmation
        if (ctx.confirm) {
          let issueRequest = null
          let confirmed = await new Promise(resolve => {
            issueRequest = resolve
            try {
              this.emit(
                'htmx:confirm',
                { ctx, issueRequest: skip => issueRequest?.(skip !== false) },
                elt,
              )
              let js = this.#extractJavascriptContent(ctx.confirm)
              resolve(
                js ? this.#executeJavaScriptAsync(elt, {}, js, true) : window.confirm(ctx.confirm),
              )
            } catch (e) {
              if (e === CANCELLED) resolve(false)
              else throw e
            }
          })
          if (!confirmed) return
        }

        ctx.fetch ||= window.fetch.bind(window)
        this.emit('htmx:before:request', { ctx }, elt)

        let response = await ctx.fetch(ctx.request.activation, ctx.request)

        ctx.response = {
          raw: response,
          status: response.status,
          headers: response.headers,
        }
        this.#extractHxHeaders(ctx)
        ctx.isSSE = response.headers.get('Content-Type')?.includes('text/event-stream')
        if (!ctx.isSSE) {
          ctx.text = await response.text()
        }

        // Convert headers to object for event handlers
        let headers = {}
        for (let [k, v] of ctx.response.headers) {
          headers[k] = v
        }

        // Prepare event data for htmx:after:request handlers
        let eventData = {
          response: {
            status: ctx.response.status,
            headers: headers,
            text: ctx.text,
          },
          swap: ctx.swap,
          elt: elt,
        }

        this.emit('htmx:after:request', eventData, elt)

        // Check if behaviors set swap.strategy to "none" (via noSwapOn204/304 etc)
        if (ctx.swap.strategy === 'none') return

        // Handle advanced hx-status:XXX attribute overrides
        this.#applyStatusCodeOverrides(ctx)
        if (ctx.swap.strategy === 'none') return

        let isSSE = response.headers.get('Content-Type')?.includes('text/event-stream')
        if (isSSE) {
          // SSE response
          await this.#handleSSE(ctx, elt, response)
        } else {
          // HTTP response
          if (ctx.status === 'issuing') {
            ctx.status = 'response received'
            await this.swap(ctx)
            ctx.status = 'swapped'
          }
        }
      } catch (error) {
        if (error === CANCELLED) return
        ctx.status = 'error: ' + error
        // Set error state with debug details if debug mode is enabled
        if (this.config.debug) {
          this.#setElementState(elt, { error: `${error.name} - ${error.message}` })
        } else {
          this.#setElementState(elt, { error: true })
        }
        this.emit('htmx:error', { ctx, error }, elt)
      } finally {
        this.#setElementState(elt, { requesting: null, error: null })
        this.#hideIndicators(indicators)
        this.#enableElements(disableElements)
        this.emit('htmx:finally:request', { ctx }, elt)

        requestQueue.finish()
        if (requestQueue.more()) {
          // TODO is it OK to not await here?  try/catch?
          this.#issueRequest(requestQueue.next())
        }
      }
    }

    // Extract HX-* headers into ctx.hx (used for SSE and other legacy needs)
    #extractHxHeaders(ctx) {
      ctx.hx = {}
      for (let [k, v] of ctx.response.raw.headers) {
        if (k.toLowerCase().startsWith('hx-')) {
          ctx.hx[k.slice(3).toLowerCase().replace(/-/g, '')] = v
        }
      }
    }

    async #handleSSE(ctx, elt, response) {
      let config = { ...this.config.sse, ...ctx.request.sse }

      let waitForVisible = () =>
        new Promise(r => {
          let onVisible = () =>
            !document.hidden && (document.removeEventListener('visibilitychange', onVisible), r())
          document.addEventListener('visibilitychange', onVisible)
        })

      let lastEventId = null,
        attempt = 0,
        currentResponse = response

      while (elt.isConnected) {
        // Handle reconnection for subsequent iterations
        if (attempt > 0) {
          if (!config.reconnect || attempt > config.reconnectMaxAttempts) break

          if (config.pauseInBackground && document.hidden) {
            await waitForVisible()
            if (!elt.isConnected) break
          }

          let delay = Math.min(
            this.parseInterval(config.reconnectDelay) * Math.pow(2, attempt - 1),
            this.parseInterval(config.reconnectMaxDelay),
          )
          if (config.reconnectJitter > 0) {
            let jitterRange = delay * config.reconnectJitter
            let jitter = (Math.random() * 2 - 1) * jitterRange
            delay = Math.max(0, delay + jitter)
          }
          let reconnect = { attempt, delay, lastEventId, cancelled: false }

          ctx.status = 'reconnecting to stream'
          try {
            this.emit('htmx:before:sse:reconnect', { ctx, reconnect }, elt)
          } catch (e) {
            if (e === CANCELLED) break
            throw e
          }
          if (reconnect.cancelled) break

          await new Promise(r => setTimeout(r, reconnect.delay))
          if (!elt.isConnected) break

          try {
            if (lastEventId)
              (ctx.request.headers = ctx.request.headers || {})['Last-Event-ID'] = lastEventId
            currentResponse = await fetch(ctx.request.activation, ctx.request)
          } catch (e) {
            ctx.status = 'stream error'
            this.emit('htmx:error', { ctx, error: e }, elt)
            attempt++
            continue
          }
        }

        // Core streaming logic
        try {
          this.emit('htmx:before:sse:stream', { ctx }, elt)
        } catch (e) {
          if (e === CANCELLED) break
          throw e
        }
        ctx.status = 'streaming'

        attempt = 0 // Reset on successful connection

        try {
          for await (const sseMessage of this.#parseSSE(currentResponse)) {
            if (!elt.isConnected) break

            if (config.pauseInBackground && document.hidden) {
              await waitForVisible()
              if (!elt.isConnected) break
            }

            let msg = {
              data: sseMessage.data,
              event: sseMessage.event,
              id: sseMessage.id,
              cancelled: false,
            }
            try {
              this.emit('htmx:before:sse:message', { ctx, message: msg }, elt)
            } catch (e) {
              if (e === CANCELLED) continue
              throw e
            }
            if (msg.cancelled) continue

            if (sseMessage.id) lastEventId = sseMessage.id

            // Trigger custom event if `event:` line is present
            if (sseMessage.event) {
              this.emit(sseMessage.event, { data: sseMessage.data, id: sseMessage.id }, elt)
              // Skip swap for custom events
              this.emit('htmx:after:sse:message', { ctx, message: msg }, elt)
              continue
            }

            ctx.text = sseMessage.data
            ctx.status = 'stream message received'

            if (!ctx.response.cancelled) {
              await this.swap(ctx)
              ctx.status = 'swapped'
            }
            this.emit('htmx:after:sse:message', { ctx, message: msg }, elt)
          }
        } catch (e) {
          if (e === CANCELLED) continue
          ctx.status = 'stream error'
          this.emit('htmx:error', { ctx, error: e }, elt)
        }

        if (!elt.isConnected) break
        this.emit('htmx:after:sse:stream', { ctx }, elt)

        attempt++
      }
    }

    async *#parseSSE(response) {
      let reader = response.body.getReader()
      let decoder = new TextDecoder()
      let buffer = ''
      let message = { data: '', event: '', id: '', retry: null }

      try {
        while (true) {
          let { done, value } = await reader.read()
          if (done) break

          // Decode chunk and add to buffer
          buffer += decoder.decode(value, { stream: true })
          let lines = buffer.split('\n')
          // Keep incomplete line in buffer
          buffer = lines.pop() || ''

          for (let line of lines) {
            // Empty line or carriage return indicates end of message
            if (!line || line === '\r') {
              if (message.data) {
                yield message
                message = { data: '', event: '', id: '', retry: null }
              }
              continue
            }

            // Parse field: value
            let colonIndex = line.indexOf(':')
            if (colonIndex <= 0) continue

            let field = line.slice(0, colonIndex)
            let value = line.slice(colonIndex + 1).trimStart()

            if (field === 'data') {
              message.data += (message.data ? '\n' : '') + value
            } else if (field === 'event') {
              message.event = value
            } else if (field === 'id') {
              message.id = value
            } else if (field === 'retry') {
              let retryValue = parseInt(value, 10)
              if (!isNaN(retryValue)) {
                message.retry = retryValue
              }
            }
          }
        }
      } finally {
        reader.releaseLock()
      }
    }

    #initTimeout(ctx) {
      let timeoutInterval
      if (ctx.request.timeout) {
        timeoutInterval = this.parseInterval(ctx.request.timeout)
      } else {
        timeoutInterval = this.config.request.timeout
      }
      ctx.requestTimeout = setTimeout(() => ctx.abort?.(), timeoutInterval)
    }

    #determineSyncStrategy(elt) {
      let syncValue = this.#attrValue(elt, 'hx-sync')
      return syncValue?.split(':')[1] || 'queue first'
    }

    #getRequestQueue(elt) {
      let syncValue = this.#attrValue(elt, 'hx-sync')
      let syncElt = elt
      if (syncValue && syncValue.includes(':')) {
        let strings = syncValue.split(':')
        let selector = strings[0]
        syncElt = this.#findExt(selector)
      }
      return (syncElt._htmxRequestQueue ||= new ReqQ())
    }

    #isModifierKeyClick(evt) {
      return evt.type === 'click' && (evt.ctrlKey || evt.metaKey || evt.shiftKey)
    }

    #shouldCancel(evt) {
      let elt = evt.currentTarget
      let isSubmit = evt.type === 'submit' && elt?.tagName === 'FORM'
      if (isSubmit) return true

      let isClick = evt.type === 'click' && evt.button === 0
      if (!isClick) return false

      let btn = elt?.closest?.('button, input[type="submit"], input[type="image"]')
      let form = btn?.form || btn?.closest('form')
      let isSubmitButton =
        btn &&
        !btn.disabled &&
        form &&
        (btn.type === 'submit' || btn.type === 'image' || (!btn.type && btn.tagName === 'BUTTON'))
      if (isSubmitButton) return true

      let link = elt?.closest?.('a')
      if (!link || !link.href) return false

      let href = link.getAttribute('href')
      let isFragmentOnly = href && href.startsWith('#') && href.length > 1
      return !isFragmentOnly
    }

    #initTriggers(elt, initialHandler = this.#createHtmxEventHandler(elt)) {
      let specString = this.#attrValue(elt, 'hx-trigger')
      if (!specString) {
        specString = elt.matches('form')
          ? 'submit'
          : elt.matches('input:not([type=button]),select,textarea')
            ? 'change'
            : 'click'
      }
      this.#setElementState(elt, {
        triggerSpecs: this.#parseTriggerSpecs(specString),
        listeners: [],
      })
      for (let spec of elt._htmx.triggerSpecs) {
        spec.handler = initialHandler
        spec.listeners = []
        spec.values = {}

        let [eventName, filter] = this.#extractFilter(spec.name)

        // should be first so logic is called only when all other filters pass
        if (spec.once) {
          let original = spec.handler
          spec.handler = evt => {
            original(evt)
            for (let listenerInfo of spec.listeners) {
              listenerInfo.fromElt.removeEventListener(listenerInfo.eventName, listenerInfo.handler)
            }
          }
        }

        if (eventName === 'intersect' || eventName === 'revealed') {
          let observerOptions = {}
          if (spec.opts?.root) {
            observerOptions.root = this.#findExt(elt, spec.opts.root)
          }
          if (spec.opts?.threshold) {
            observerOptions.threshold = parseFloat(spec.opts.threshold)
          }
          let isRevealed = eventName === 'revealed'
          spec.observer = new IntersectionObserver(entries => {
            for (let i = 0; i < entries.length; i++) {
              let entry = entries[i]
              if (entry.isIntersecting) {
                this.trigger(elt, 'intersect', {}, false)
                if (isRevealed) {
                  spec.observer.disconnect()
                }
                break
              }
            }
          }, observerOptions)
          eventName = 'intersect'
          spec.observer.observe(elt)
        }

        if (spec.delay) {
          let original = spec.handler
          spec.handler = evt => {
            clearTimeout(spec.timeout)
            spec.timeout = setTimeout(() => original(evt), this.parseInterval(spec.delay))
          }
        }

        if (spec.throttle) {
          let original = spec.handler
          spec.handler = evt => {
            if (spec.throttled) {
              spec.throttledEvent = evt
            } else {
              spec.throttled = true
              original(evt)
              spec.throttleTimeout = setTimeout(() => {
                spec.throttled = false
                if (spec.throttledEvent) {
                  // implement trailing-edge throttling
                  let throttledEvent = spec.throttledEvent
                  spec.throttledEvent = null
                  spec.handler(throttledEvent)
                }
              }, this.parseInterval(spec.throttle))
            }
          }
        }

        if (spec.target) {
          let original = spec.handler
          spec.handler = evt => {
            if (evt.target?.matches?.(spec.target)) {
              original(evt)
            }
          }
        }

        if (eventName === 'every') {
          let interval = Object.keys(spec).find(k => k !== 'name')
          spec.interval = setInterval(() => {
            if (elt.isConnected) {
              try {
                this.emit('every', {}, elt, false)
              } catch (e) {
                if (e !== CANCELLED) throw e
              }
            } else {
              clearInterval(spec.interval)
            }
          }, this.parseInterval(interval))
        }

        if (filter) {
          let original = spec.handler
          spec.handler = evt => {
            if (this.#shouldCancel(evt)) evt.preventDefault()
            if (this.#executeFilter(elt, evt, filter)) {
              original(evt)
            }
          }
        }

        let fromElts = [elt]
        if (spec.from) {
          fromElts = this.#findAllExt(elt, spec.from)
        }

        if (spec.consume) {
          let original = spec.handler
          spec.handler = evt => {
            evt.stopPropagation()
            original(evt)
          }
        }

        if (spec.changed) {
          let original = spec.handler
          spec.handler = evt => {
            let trigger = false
            for (let fromElt of fromElts) {
              if (spec.values[fromElt] !== fromElt.value) {
                trigger = true
                spec.values[fromElt] = fromElt.value
              }
            }
            if (trigger) {
              original(evt)
            }
          }
        }

        for (let fromElt of fromElts) {
          let listenerInfo = { fromElt, eventName, handler: spec.handler }
          elt._htmx.listeners.push(listenerInfo)
          spec.listeners.push(listenerInfo)
          fromElt.addEventListener(eventName, spec.handler)
        }
      }
    }

    #extractFilter(str) {
      let match = str.match(/^([^\[]*)\[([^\]]*)]/)
      if (!match) return [str, null]
      return [match[1], match[2]]
    }

    #handleTriggerHeader(value, elt) {
      if (value[0] === '{') {
        let triggers = this.#parse(value)
        for (let name in triggers) {
          let detail = triggers[name]
          if (detail?.target) elt = this.find(detail.target) || elt
          this.trigger(elt, name, typeof detail === 'object' ? detail : { value: detail })
        }
      } else {
        value.split(',').forEach(name => this.trigger(elt, name.trim(), {}))
      }
    }

    #apiMethods(thisArg) {
      let bound = {}
      let proto = Object.getPrototypeOf(this)
      for (let name of Object.getOwnPropertyNames(proto)) {
        if (name !== 'constructor' && typeof this[name] === 'function') {
          if (['find', 'findAll'].includes(name)) {
            bound[name] = (arg1, arg2) => {
              if (arg2 === undefined) {
                return this[name](thisArg, arg1)
              } else {
                return this[name](arg1, arg2)
              }
            }
          } else {
            bound[name] = this[name].bind(this)
          }
        }
      }
      return bound
    }

    async #executeJavaScriptAsync(thisArg, obj, code, expression = true) {
      let args = {}
      Object.assign(args, this.#apiMethods(thisArg))
      Object.assign(args, obj)
      // Inject cancel/stop to allow hx-on handlers to prevent default behavior
      args.cancel = args.stop = () => {
        throw CANCELLED
      }
      let keys = Object.keys(args)
      let values = Object.values(args)
      let AsyncFunction = Object.getPrototypeOf(async function () {}).constructor
      let func = new AsyncFunction(...keys, expression ? `return (${code})` : code)
      return await func.call(thisArg, ...values)
    }

    #executeFilter(thisArg, event, code) {
      let args = {}
      Object.assign(args, this.#apiMethods(thisArg))
      for (let key in event) {
        args[key] = event[key]
      }
      let keys = Object.keys(args)
      let values = Object.values(args)
      let func = new Function(...keys, `return (${code})`)
      return func.call(thisArg, ...values)
    }

    activate(elt) {
      if (!elt) return
      try {
        this.emit('htmx:before:activate', { element: elt }, elt)

        // Activate all elements with htmx attributes
        for (let child of this.#queryAll(elt, this.#activationSelector)) {
          if (child._htmx) continue // Already activated

          try {
            this.emit('htmx:before:element:activate', { element: child }, child)
            this.#setElementState(child, { active: true })
            this.#initTriggers(child)
            this.#initAbortListener(child)
            this.emit('htmx:after:element:activate', { element: child }, child)
            this.emit('load', {}, child, false)
          } catch (e) {
            if (e !== CANCELLED) throw e
          }
        }

        // TODO: Remove once FEATURES['hx-on'] is wired up
        this.#handleHxOnAttributes(elt)
        let iter = this.#hxOnQuery.evaluate(elt)
        let node = null
        while ((node = iter.iterateNext())) this.#handleHxOnAttributes(node)

        this.emit('htmx:after:activate', { element: elt }, elt)
      } catch (e) {
        if (e !== CANCELLED) throw e
      }
    }

    #isSameOrigin(url) {
      try {
        // URL constructor handles both relative and absolute URLs
        const parsed = new URL(url, window.location.href)
        return parsed.origin === window.location.origin
      } catch (e) {
        // If URL parsing fails, assume not same-origin
        return false
      }
    }

    #cleanup(elt) {
      if (elt._htmx) {
        try {
          this.emit('htmx:before:cleanup', { element: elt }, elt)
        } catch (e) {
          if (e !== CANCELLED) throw e
        }
        if (elt._htmx.interval) clearInterval(elt._htmx.interval)
        for (let spec of elt._htmx.triggerSpecs || []) {
          if (spec.interval) clearInterval(spec.interval)
          if (spec.timeout) clearTimeout(spec.timeout)
        }
        for (let listenerInfo of elt._htmx.listeners || []) {
          listenerInfo.fromElt.removeEventListener(listenerInfo.eventName, listenerInfo.handler)
        }
        try {
          this.emit('htmx:after:cleanup', { element: elt }, elt)
        } catch (e) {
          if (e !== CANCELLED) throw e
        }
      }
      for (let child of elt.querySelectorAll(`[${this.config.elementStateAttribute}]`)) {
        this.#cleanup(child)
      }
    }

    #handlePreservedElements(fragment) {
      let pantry = document.createElement('div')
      pantry.style.display = 'none'
      document.body.appendChild(pantry)
      let newPreservedElts = fragment.querySelectorAll?.(`[${this.#attrName('hx-preserve')}]`) || []
      for (let preservedElt of newPreservedElts) {
        let currentElt = document.getElementById(preservedElt.id)
        if (pantry.moveBefore) {
          pantry.moveBefore(currentElt, null)
        } else {
          pantry.appendChild(currentElt)
        }
      }
      return pantry
    }

    #restorePreservedElements(pantry) {
      for (let preservedElt of pantry.children) {
        let newElt = document.getElementById(preservedElt.id)
        if (newElt.parentNode.moveBefore) {
          newElt.parentNode.moveBefore(preservedElt, newElt)
        } else {
          newElt.replaceWith(preservedElt)
        }
        this.#cleanup(newElt)
        newElt.remove()
      }
      pantry.remove()
    }

    #parseHTML(resp) {
      return Document.parseHTMLUnsafe?.(resp) || new DOMParser().parseFromString(resp, 'text/html')
    }

    #makeFragment(text) {
      let response = text
        .replace(/<hx-([a-z]+)(\s+|>)/gi, '<template hx type="$1"$2')
        .replace(/<\/hx-[a-z]+>/gi, '</template>')
      let title = ''
      response = response.replace(
        /<title[^>]*>[\s\S]*?<\/title>/i,
        m => ((title = this.#parseHTML(m).title), ''),
      )
      let responseWithNoHead = response.replace(/<head(\s[^>]*)?>[\s\S]*?<\/head>/i, '')
      let startTag = responseWithNoHead.match(/<([a-z][^\/>\x20\t\r\n\f]*)/i)?.[1]?.toLowerCase()

      let doc, fragment
      if (startTag === 'html') {
        doc = this.#parseHTML(response)
        fragment = doc.body
      } else if (startTag === 'body') {
        doc = this.#parseHTML(responseWithNoHead)
        fragment = doc.body
      } else {
        doc = this.#parseHTML(`<template>${responseWithNoHead}</template>`)
        fragment = doc.querySelector('template').content
      }
      this.#processScripts(fragment)

      return {
        fragment,
        title,
      }
    }

    #createOOBTask(tasks, elt, oobValue, sourceElement) {
      let target = elt.id ? '#' + CSS.escape(elt.id) : null
      if (oobValue !== 'true' && oobValue && !oobValue.includes(' ')) {
        ;[oobValue, target = target] = oobValue.split(/:(.*)/)
      }
      if (oobValue === 'true' || !oobValue) oobValue = 'outerHTML'

      let swapSpec = this.#parseSwapSpec(oobValue)
      target = swapSpec.target || target
      swapSpec.strip ??= !swapSpec.style.startsWith('outer')
      if (!target) return
      let fragment = document.createDocumentFragment()
      fragment.append(elt)
      tasks.push({ type: 'oob', fragment, target, swapSpec, sourceElement })
    }

    #processOOB(fragment, sourceElement, selectOOB) {
      let tasks = []

      // Process hx-select-oob first (select elements from response)
      if (selectOOB) {
        for (let spec of selectOOB.split(',')) {
          let [selector, oobValue = 'true'] = spec.split(/:(.*)/)
          for (let elt of fragment.querySelectorAll(selector)) {
            this.#createOOBTask(tasks, elt, oobValue, sourceElement)
          }
        }
      }

      // Process elements with hx-swap-oob attribute
      for (let oobElt of fragment.querySelectorAll(`[${this.#attrName('hx-swap-oob')}]`)) {
        let oobValue = oobElt.getAttribute(this.#attrName('hx-swap-oob'))
        oobElt.removeAttribute(this.#attrName('hx-swap-oob'))
        this.#createOOBTask(tasks, oobElt, oobValue, sourceElement)
      }

      return tasks
    }

    #insertNodes(parent, before, fragment) {
      if (before) {
        before.before(...fragment.childNodes)
      } else {
        parent.append(...fragment.childNodes)
      }
    }

    #parseSwapSpec(swapStr) {
      swapStr = swapStr.trim()
      let style = this.config.swap.default
      if (swapStr && !/^\S*:/.test(swapStr)) {
        let m = swapStr.match(/^(\S+)\s*(.*)$/)
        style = m[1]
        swapStr = m[2]
      }
      return { style: this.#normalizeSwapStyle(style), ...this.#parse(swapStr) }
    }

    #processPartials(fragment, ctx) {
      let tasks = []

      for (let templateElt of fragment.querySelectorAll('template[hx]')) {
        let type = templateElt.getAttribute('type')

        if (type === 'partial') {
          let swapSpec = this.#parseSwapSpec(
            templateElt.getAttribute(this.#attrName('hx-swap')) || this.config.swap.default,
          )

          tasks.push({
            type: 'partial',
            fragment: templateElt.content.cloneNode(true),
            target: templateElt.getAttribute(this.#attrName('hx-target')),
            swapSpec,
            sourceElement: ctx.sourceElement,
          })
        } else {
          this.#triggerExtensions(templateElt, 'htmx:process:' + type, { ctx, tasks })
        }
        templateElt.remove()
      }

      return tasks
    }

    #handleAutoFocus(elt) {
      let autofocus = this.find(elt, '[autofocus]')
      autofocus?.focus?.()
    }

    #handleScroll(task) {
      if (task.swapSpec.scroll) {
        let target = task.swapSpec.scrollTarget
          ? this.#findExt(task.swapSpec.scrollTarget)
          : task.target
        if (task.swapSpec.scroll === 'top') {
          target.scrollTop = 0
        } else if (task.swapSpec.scroll === 'bottom') {
          target.scrollTop = target.scrollHeight
        }
      }
      if (task.swapSpec.show) {
        let target = task.swapSpec.showTarget
          ? this.#findExt(task.swapSpec.showTarget)
          : task.target
        target.scrollIntoView(task.swapSpec.show === 'top')
      }
    }

    #handleAnchorScroll(ctx) {
      let anchor = ctx.request?.originalAction?.split('#')[1]
      if (anchor) {
        document.getElementById(anchor)?.scrollIntoView({ block: 'start', behavior: 'auto' })
      }
    }

    #processScripts(container) {
      let scripts = this.#queryAll(container, 'script')
      for (let oldScript of scripts) {
        let newScript = document.createElement('script')
        for (let attr of oldScript.attributes) {
          newScript.setAttribute(attr.name, attr.value)
        }
        if (this.config.inlineScriptNonce) {
          newScript.nonce = this.config.inlineScriptNonce
        }
        newScript.textContent = oldScript.textContent
        oldScript.replaceWith(newScript)
      }
    }

    //============================================================================================
    // Public JS API
    //============================================================================================

    async swap(ctx) {
      this.#handleHistoryUpdate(ctx)
      let { fragment, title } = this.#makeFragment(ctx.text)
      ctx.title = title
      let tasks = []

      // Process OOB and partials
      let oobTasks = this.#processOOB(fragment, ctx.sourceElement, ctx.selectOOB)
      let partialTasks = this.#processPartials(fragment, ctx)
      tasks.push(...oobTasks, ...partialTasks)

      // Process main swap
      let mainSwap = this.#processMainSwap(ctx, fragment, partialTasks)
      if (mainSwap) {
        tasks.push(mainSwap)
      }

      // TODO - can we remove this and just let the function complete?
      if (tasks.length === 0) return

      // Separate transition/nonTransition tasks
      let transitionTasks = tasks.filter(t => t.transition)
      let nonTransitionTasks = tasks.filter(t => !t.transition)

      this.emit('htmx:before:swap', { ctx, tasks })

      // insert non-transition tasks immediately or with delay
      for (let task of nonTransitionTasks) {
        if (task.swapSpec?.swap) {
          setTimeout(() => this.#insertContent(task), this.parseInterval(task.swapSpec.swap))
        } else {
          this.#insertContent(task)
        }
      }

      // insert transition tasks in the transition queue
      if (transitionTasks.length > 0) {
        let tasksWrapper = () => {
          for (let task of transitionTasks) {
            this.#insertContent(task)
          }
        }
        await this.#submitTransitionTask(tasksWrapper)
      }

      this.emit('htmx:after:swap', { ctx })
      if (ctx.title && !mainSwap?.swapSpec?.ignoreTitle) document.title = ctx.title
      await this.timeout(1)
      // invoke restore tasks
      for (let task of tasks) {
        for (let restore of task.restoreTasks || []) {
          restore()
        }
      }
      this.emit('htmx:after:restore', { ctx })
      this.#handleAnchorScroll(ctx)
      // TODO this stuff should be an extension
      // if (ctx.hx?.triggerafterswap) this.#handleTriggerHeader(ctx.hx.triggerafterswap, ctx.sourceElement);
    }

    #processMainSwap(ctx, fragment, partialTasks) {
      // Create main task if needed
      let swapSpec = this.#parseSwapSpec(ctx.swap || this.config.swap.default)
      // skip creating main swap if extracting partials resulted in empty response except for delete style
      if (
        swapSpec.style === 'delete' ||
        /\S/.test(fragment.innerHTML || '') ||
        !partialTasks.length
      ) {
        if (ctx.select) {
          let selected = fragment.querySelectorAll(ctx.select)
          fragment = document.createDocumentFragment()
          fragment.append(...selected)
        }
        if (this.#isBoosted(ctx.sourceElement)) {
          swapSpec.show ||= 'top'
        }
        let mainSwap = {
          type: 'main',
          fragment,
          target: this.#resolveTarget(
            ctx.sourceElement || document.body,
            swapSpec.target || ctx.target,
          ),
          swapSpec,
          sourceElement: ctx.sourceElement,
          transition: ctx.transition !== false && swapSpec.transition !== false,
        }
        return mainSwap
      }
    }

    #insertContent(task) {
      let { target, swapSpec, fragment } = task
      if (typeof target === 'string') {
        target = document.querySelector(target)
      }
      if (!target) return
      if (swapSpec.strip && fragment.firstElementChild) {
        task.unstripped = fragment
        fragment = document.createDocumentFragment()
        fragment.append(
          ...(task.fragment.firstElementChild.content || task.fragment.firstElementChild)
            .childNodes,
        )
      }

      let pantry = this.#handlePreservedElements(fragment)
      let parentNode = target.parentNode
      let newContent = [...fragment.childNodes]
      if (swapSpec.style === 'innerHTML') {
        this.#captureCSSTransitions(task, target)
        for (const child of target.children) {
          this.#cleanup(child)
        }
        target.replaceChildren(...fragment.childNodes)
      } else if (swapSpec.style === 'outerHTML') {
        if (parentNode) {
          this.#captureCSSTransitions(task, parentNode)
          this.#insertNodes(parentNode, target, fragment)
          this.#cleanup(target)
          parentNode.removeChild(target)
        }
      } else if (swapSpec.style === 'innerMorph') {
        this.#morph(target, fragment, true)
      } else if (swapSpec.style === 'outerMorph') {
        this.#morph(target, fragment, false)
      } else if (swapSpec.style === 'beforebegin') {
        if (parentNode) {
          this.#insertNodes(parentNode, target, fragment)
        }
      } else if (swapSpec.style === 'afterbegin') {
        this.#insertNodes(target, target.firstChild, fragment)
      } else if (swapSpec.style === 'beforeend') {
        this.#insertNodes(target, null, fragment)
      } else if (swapSpec.style === 'afterend') {
        if (parentNode) {
          this.#insertNodes(parentNode, target.nextSibling, fragment)
        }
      } else if (swapSpec.style === 'delete') {
        if (parentNode) {
          this.#cleanup(target)
          parentNode.removeChild(target)
        }
        return
      } else if (swapSpec.style === 'none') {
        return
      } else {
        task.target = target
        task.fragment = fragment
        if (!this.#triggerExtensions(target, 'htmx:handle:swap', task)) return
        throw new Error(`Unknown swap style: ${swapSpec.style}`)
      }
      this.#restorePreservedElements(pantry)
      for (const elt of newContent) {
        this.activate(elt)
        this.#handleAutoFocus(elt)
      }
      this.#handleScroll(task)
    }

    emit(eventName, detail = {}, element = document, bubbles = true) {
      element = this.#normalizeElement(element)
      if (this.config.debug) console.log(eventName, detail, element)
      this.#triggerExtensions(element, eventName, detail)
      if (!this.trigger(element, eventName, detail, bubbles)) throw CANCELLED
    }

    #triggerExtensions(elt, eventName, detail = {}) {
      let methods = this.#extMethods.get(eventName.replace(/:/g, '_'))
      if (methods) {
        detail.cancelled = false
        for (const fn of methods) {
          if (fn(elt, detail) === false || detail.cancelled) {
            detail.cancelled = true
            return false
          }
        }
      }
      return true
    }

    timeout(time) {
      time = this.parseInterval(time)
      if (time > 0) {
        return new Promise(resolve => setTimeout(resolve, time))
      }
    }

    forEvent(event, timeout, on = document) {
      return new Promise((resolve, reject) => {
        let handler = evt => {
          clearTimeout(timeoutId)
          resolve(evt)
        }

        let timeoutId =
          timeout &&
          setTimeout(() => {
            on.removeEventListener(event, handler)
            resolve(null)
          }, timeout)

        on.addEventListener(event, handler, { once: true })
      })
    }

    onLoad(callback) {
      this.on('htmx:after:activate', evt => {
        callback(evt.target)
      })
    }

    takeClass(element, className, container = element.parentElement) {
      for (let elt of this.findAll(this.#normalizeElement(container), '.' + className)) {
        elt.classList.remove(className)
      }
      element.classList.add(className)
    }

    on(eventOrElt, eventOrCallback, callback) {
      let event
      let elt = document
      if (callback === undefined) {
        event = eventOrElt
        callback = eventOrCallback
      } else {
        elt = this.#normalizeElement(eventOrElt)
        event = eventOrCallback
      }
      elt.addEventListener(event, callback)
      return callback
    }

    find(selectorOrElt, selector) {
      return this.#findExt(selectorOrElt, selector)
    }

    findAll(selectorOrElt, selector) {
      return this.#findAllExt(selectorOrElt, selector)
    }

    parseInterval(str) {
      if (typeof str === 'number') return str
      let m = { ms: 1, s: 1000, m: 60000 }
      let [, n, u] = str?.match(/^([\d.]+)(ms|s|m)?$/) || []
      let v = parseFloat(n) * (m[u] || 1)
      return isNaN(v) ? undefined : v
    }

    trigger(on, eventName, detail = {}, bubbles = true) {
      on = this.#normalizeElement(on)
      let evt = new CustomEvent(eventName, {
        detail,
        cancelable: true,
        bubbles,
        composed: true,
        originalTarget: on,
      })
      let target = on.isConnected ? on : document
      let result = !detail.cancelled && target.dispatchEvent(evt)
      return result
    }
    // TODO - make async
    ajax(verb, path, context) {
      // Normalize context to object
      if (!context || context instanceof Element || typeof context === 'string') {
        context = { target: context }
      }

      let sourceElt =
        typeof context.source === 'string' ? document.querySelector(context.source) : context.source

      // If source selector was provided but didn't match, reject
      if (typeof context.source === 'string' && !sourceElt) {
        return Promise.reject(new Error('Source not found'))
      }

      // Resolve target, defaulting to body only if no source or target provided
      let target = this.#resolveTarget(document.body, context.target || sourceElt)
      if (!target) {
        return Promise.reject(new Error('Target not found'))
      }

      sourceElt ||= target

      let ctx = this.#createRequestContext(sourceElt, context.event || {})
      Object.assign(ctx, context, { target })
      Object.assign(ctx.request, { activation: path, verb: verb.toUpperCase() })
      if (context.headers) Object.assign(ctx.request.headers, context.headers)

      return this.#handleTriggerEvent(ctx)
    }

    //============================================================================================
    // History Support
    //============================================================================================

    #initHistoryHandling() {
      if (!this.config.history.enabled) return
      if (!history.state) {
        history.replaceState({ htmx: true }, '', location.pathname + location.search)
      }
      window.addEventListener('popstate', event => {
        if (event.state && event.state.htmx) {
          this.#restoreHistory()
        }
      })
    }

    #pushUrlIntoHistory(path) {
      if (!this.config.history.enabled) return
      this.emit('htmx:before:history:push', { path })
      history.pushState({ htmx: true }, '', path)
      this.emit('htmx:after:history:push', { path })
    }

    #replaceUrlInHistory(path) {
      if (!this.config.history.enabled) return
      history.replaceState({ htmx: true }, '', path)
      this.emit('htmx:after:history:replace', { path })
    }

    #restoreHistory(path) {
      path = path || location.pathname + location.search
      try {
        this.emit('htmx:before:history:restore', { path, cacheMiss: true })
        if (this.config.history.reload) {
          location.reload()
        } else {
          this.ajax('GET', path, {
            target: 'body',
            request: { headers: { 'HX-History-Restore-Request': 'true' } },
          })
        }
      } catch (e) {
        if (e !== CANCELLED) throw e
      }
    }

    #handleHistoryUpdate(ctx) {
      let { sourceElement, push, replace, hx, response } = ctx
      if (hx?.push || hx?.pushurl || hx?.replaceurl) {
        push = hx.push || hx.pushurl
        replace = hx.replaceurl
      }

      if (!push && !replace && this.#isBoosted(sourceElement)) {
        push = 'true'
      }

      let path = push || replace
      if (!path || path === 'false' || path === false) return

      if (path === 'true') {
        path = ctx.request.originalAction
      }

      let type = push ? 'push' : 'replace'

      let historyDetail = {
        history: { type, path },
        sourceElement,
        response,
      }
      this.emit('htmx:before:history:update', historyDetail)
      if (type === 'push') {
        this.#pushUrlIntoHistory(path)
      } else {
        this.#replaceUrlInHistory(path)
      }
      this.emit('htmx:after:history:update', historyDetail)
    }

    // TODO: Remove once htmx:after:element:activate is wired up - logic moved to FEATURES['hx-on']
    #handleHxOnAttributes(node) {
      for (let attr of node.getAttributeNames()) {
        var searchString = this.#attrName('hx-on:')
        if (attr.startsWith(searchString)) {
          let evtName = attr.substring(searchString.length)
          let code = node.getAttribute(attr)
          node.addEventListener(evtName, async evt => {
            try {
              await this.#executeJavaScriptAsync(node, { event: evt }, code, false)
            } catch (e) {
              console.log(e)
            }
          })
        }
      }
    }

    #showIndicators(elt, indicatorsSelector) {
      let indicatorElements = []
      if (indicatorsSelector) {
        indicatorElements = [elt, ...this.#queryAll(elt, indicatorsSelector)]
        for (const indicator of indicatorElements) {
          indicator._htmxReqCount ||= 0
          indicator._htmxReqCount++
          this.#setElementState(indicator, { loading: true })
        }
      }
      return indicatorElements
    }

    #hideIndicators(indicatorElements) {
      for (let indicator of indicatorElements) {
        if (indicator._htmxReqCount) {
          indicator._htmxReqCount--
          if (indicator._htmxReqCount <= 0) {
            this.#setElementState(indicator, { loading: null })
            delete indicator._htmxReqCount
          }
        }
      }
    }

    #disableElements(elt, disabledSelector) {
      let disabledElements = []
      if (disabledSelector) {
        disabledElements = this.#queryAll(elt, disabledSelector)
        for (let indicator of disabledElements) {
          indicator._htmxDisableCount ||= 0
          indicator._htmxDisableCount++
          indicator.disabled = true
        }
      }
      return disabledElements
    }

    #enableElements(disabledElements) {
      for (const indicator of disabledElements) {
        if (indicator._htmxDisableCount) {
          indicator._htmxDisableCount--
          if (indicator._htmxDisableCount <= 0) {
            indicator.disabled = false
            delete indicator._htmxDisableCount
          }
        }
      }
    }

    #collectFormData(elt, form, submitter) {
      let formData = form ? new FormData(form) : new FormData()
      let included = form ? new Set(form.elements) : new Set()
      if (!form && elt.name) {
        formData.append(elt.name, elt.value)
        included.add(elt)
      }
      if (submitter && submitter.name) {
        formData.append(submitter.name, submitter.value)
        included.add(submitter)
      }
      let includeSelector = this.#attrValue(elt, 'hx-include')
      if (includeSelector) {
        let includeNodes = this.#findAllExt(elt, includeSelector)
        for (let node of includeNodes) {
          this.#addInputValues(node, included, formData)
        }
      }
      return formData
    }

    #addInputValues(elt, included, formData) {
      let inputs = this.#queryAll(
        elt,
        'input:not([disabled]), select:not([disabled]), textarea:not([disabled])',
      )

      for (let input of inputs) {
        if (!input.name || included.has(input)) continue
        included.add(input)

        let type = input.type
        if (type === 'checkbox' || type === 'radio') {
          // Only add if checked
          if (input.checked) {
            formData.append(input.name, input.value)
          }
        } else if (type === 'file') {
          // Add all selected files
          for (let file of input.files) {
            formData.append(input.name, file)
          }
        } else if (type === 'select-multiple') {
          // Add all selected options
          for (let option of input.selectedOptions) {
            formData.append(input.name, option.value)
          }
        } else if (input.matches('select, textarea, input')) {
          // Regular inputs, single selects, textareas
          formData.append(input.name, input.value)
        }
      }
    }

    #handleHxVals(elt, body) {
      let hxValsValue = this.#attrValue(elt, 'hx-vals')
      if (hxValsValue) {
        let javascriptContent = this.#extractJavascriptContent(hxValsValue)
        if (javascriptContent) {
          // Return promise for async evaluation
          return this.#executeJavaScriptAsync(elt, {}, javascriptContent, true).then(obj => {
            for (let key in obj) {
              body.append(key, obj[key])
            }
          })
        } else {
          // Synchronous path
          let obj = this.#parse(hxValsValue)
          for (let key in obj) {
            body.append(key, obj[key])
          }
        }
      }
    }

    #stringHyperscriptStyleSelector(selector) {
      let s = selector.trim()
      return s.startsWith('<') && s.endsWith('/>') ? s.slice(1, -2) : s
    }

    #findAllExt(eltOrSelector, maybeSelector, global) {
      let selector = maybeSelector ?? eltOrSelector
      let elt = maybeSelector ? this.#normalizeElement(eltOrSelector) : document
      if (selector.startsWith('global ')) {
        return this.#findAllExt(elt, selector.slice(7), true)
      }
      let parts = selector
        ? selector
            .replace(/<[^>]+\/>/g, m => m.replace(/,/g, '%2C'))
            .split(',')
            .map(p => p.replace(/%2C/g, ','))
        : []
      let result = []
      let unprocessedParts = []
      for (const part of parts) {
        let selector = this.#stringHyperscriptStyleSelector(part)
        let item
        if (selector.startsWith('closest ')) {
          item = elt.closest(selector.slice(8))
        } else if (selector.startsWith('find ')) {
          item = document.querySelector(elt, selector.slice(5))
        } else if (selector === 'next' || selector === 'nextElementSibling') {
          item = elt.nextElementSibling
        } else if (selector.startsWith('next ')) {
          item = this.#scanForwardQuery(elt, selector.slice(5), !!global)
        } else if (selector === 'previous' || selector === 'previousElementSibling') {
          item = elt.previousElementSibling
        } else if (selector.startsWith('previous ')) {
          item = this.#scanBackwardsQuery(elt, selector.slice(9), !!global)
        } else if (selector === 'document') {
          item = document
        } else if (selector === 'window') {
          item = window
        } else if (selector === 'body') {
          item = document.body
        } else if (selector === 'root') {
          item = this.#getRootNode(elt, !!global)
        } else if (selector === 'host') {
          item = elt.getRootNode().host
        } else {
          unprocessedParts.push(selector)
        }

        if (item) {
          result.push(item)
        }
      }

      if (unprocessedParts.length > 0) {
        let standardSelector = unprocessedParts.join(',')
        let rootNode = this.#getRootNode(elt, !!global)
        result.push(...rootNode.querySelectorAll(standardSelector))
      }

      return result
    }

    #scanForwardQuery(start, match, global) {
      return this.#scanUntilComparison(
        this.#getRootNode(start, global).querySelectorAll(match),
        start,
        Node.DOCUMENT_POSITION_PRECEDING,
      )
    }

    #scanBackwardsQuery(start, match, global) {
      let results = [...this.#getRootNode(start, global).querySelectorAll(match)].reverse()
      return this.#scanUntilComparison(results, start, Node.DOCUMENT_POSITION_FOLLOWING)
    }

    #scanUntilComparison(results, start, comparison) {
      for (const elt of results) {
        if (elt.compareDocumentPosition(start) === comparison) {
          return elt
        }
      }
    }

    #getRootNode(elt, global) {
      if (elt.isConnected && elt.getRootNode) {
        return elt.getRootNode?.({ composed: global })
      } else {
        return document
      }
    }

    #findExt(eltOrSelector, selector) {
      return this.#findAllExt(eltOrSelector, selector)[0]
    }

    #extractJavascriptContent(string) {
      if (string != null) {
        if (string.startsWith('js:')) {
          return string.substring(3)
        } else if (string.startsWith('javascript:')) {
          return string.substring(11)
        }
      }
    }

    #initAbortListener(elt) {
      elt.addEventListener('htmx:abort', () => {
        let requestQueue = this.#getRequestQueue(elt)
        requestQueue.abort()
      })
    }

    #morph(oldNode, fragment, innerHTML) {
      let { persistentIds, idMap } = this.#createIdMaps(oldNode, fragment)
      let pantry = document.createElement('div')
      pantry.hidden = true
      document.body.after(pantry)
      let ctx = { target: oldNode, idMap, persistentIds, pantry }

      if (innerHTML) {
        this.#morphChildren(ctx, oldNode, fragment)
      } else {
        this.#morphChildren(ctx, oldNode.parentNode, fragment, oldNode, oldNode.nextSibling)
      }
      this.#cleanup(pantry)
      pantry.remove()
    }

    #morphChildren(ctx, oldParent, newParent, insertionPoint = null, endPoint = null) {
      if (oldParent instanceof HTMLTemplateElement && newParent instanceof HTMLTemplateElement) {
        oldParent = oldParent.content
        newParent = newParent.content
      }
      insertionPoint ||= oldParent.firstChild

      for (const newChild of newParent.childNodes) {
        if (insertionPoint && insertionPoint != endPoint) {
          let bestMatch = this.#findBestMatch(ctx, newChild, insertionPoint, endPoint)
          if (bestMatch) {
            if (bestMatch !== insertionPoint) {
              let cursor = insertionPoint
              while (cursor && cursor !== bestMatch) {
                let tempNode = cursor
                cursor = cursor.nextSibling
                this.#removeNode(ctx, tempNode)
              }
            }
            this.#morphNode(bestMatch, newChild, ctx)
            insertionPoint = bestMatch.nextSibling
            continue
          }
        }

        if (newChild instanceof Element && ctx.persistentIds.has(newChild.id)) {
          let target =
            (ctx.target.id === newChild.id && ctx.target) ||
            ctx.target.querySelector(`[id="${newChild.id}"]`) ||
            ctx.pantry.querySelector(`[id="${newChild.id}"]`)
          let elementId = target.id
          let element = target
          while ((element = element.parentNode)) {
            let idSet = ctx.idMap.get(element)
            if (idSet) {
              idSet.delete(elementId)
              if (!idSet.size) ctx.idMap.delete(element)
            }
          }
          this.#moveBefore(oldParent, target, insertionPoint)
          this.#morphNode(target, newChild, ctx)
          insertionPoint = target.nextSibling
          continue
        }

        let tempChild
        if (ctx.idMap.has(newChild)) {
          tempChild = document.createElement(newChild.tagName)
          oldParent.insertBefore(tempChild, insertionPoint)
          this.#morphNode(tempChild, newChild, ctx)
        } else {
          tempChild = document.importNode(newChild, true)
          oldParent.insertBefore(tempChild, insertionPoint)
        }
        insertionPoint = tempChild.nextSibling
      }

      while (insertionPoint && insertionPoint != endPoint) {
        let tempNode = insertionPoint
        insertionPoint = insertionPoint.nextSibling
        this.#removeNode(ctx, tempNode)
      }
    }

    #findBestMatch(ctx, node, startPoint, endPoint) {
      let softMatch = null,
        nextSibling = node.nextSibling,
        siblingSoftMatchCount = 0,
        displaceMatchCount = 0
      let newSet = ctx.idMap.get(node),
        nodeMatchCount = newSet?.size || 0
      let cursor = startPoint
      while (cursor && cursor != endPoint) {
        let oldSet = ctx.idMap.get(cursor)
        if (this.#isSoftMatch(cursor, node)) {
          if (oldSet && newSet && [...oldSet].some(id => newSet.has(id))) return cursor
          if (softMatch === null && !oldSet) {
            if (!nodeMatchCount) return cursor
            else softMatch = cursor
          }
        }
        displaceMatchCount += oldSet?.size || 0
        if (displaceMatchCount > nodeMatchCount) break
        if (softMatch === null && nextSibling && this.#isSoftMatch(cursor, nextSibling)) {
          siblingSoftMatchCount++
          nextSibling = nextSibling.nextSibling
          if (siblingSoftMatchCount >= 2) softMatch = undefined
        }
        if (cursor.contains(document.activeElement)) break
        cursor = cursor.nextSibling
      }
      return softMatch || null
    }

    #isSoftMatch(oldNode, newNode) {
      return (
        oldNode.nodeType === newNode.nodeType &&
        oldNode.tagName === newNode.tagName &&
        (!oldNode.id || oldNode.id === newNode.id)
      )
    }

    #removeNode(ctx, node) {
      if (ctx.idMap.has(node)) {
        this.#moveBefore(ctx.pantry, node, null)
      } else {
        this.#cleanup(node)
        node.remove()
      }
    }

    #moveBefore(parentNode, element, after) {
      if (parentNode.moveBefore) {
        try {
          parentNode.moveBefore(element, after)
          return
        } catch (e) {
          // ignore and insertBefore insteat
        }
      }
      parentNode.insertBefore(element, after)
    }

    #morphNode(oldNode, newNode, ctx) {
      let type = newNode.nodeType

      if (type === 1) {
        let noMorph = this.config.morphIgnore || []
        this.#copyAttributes(oldNode, newNode, noMorph)
        if (
          oldNode instanceof HTMLTextAreaElement &&
          oldNode.defaultValue != newNode.defaultValue
        ) {
          oldNode.value = newNode.value
        }
      }

      if ((type === 8 || type === 3) && oldNode.nodeValue !== newNode.nodeValue) {
        oldNode.nodeValue = newNode.nodeValue
      }
      if (!oldNode.isEqualNode(newNode)) this.#morphChildren(ctx, oldNode, newNode)
    }

    #copyAttributes(destination, source, attributesToIgnore = []) {
      for (const attr of source.attributes) {
        if (
          !attributesToIgnore.includes(attr.name) &&
          destination.getAttribute(attr.name) !== attr.value
        ) {
          destination.setAttribute(attr.name, attr.value)
          if (
            attr.name === 'value' &&
            destination instanceof HTMLInputElement &&
            destination.type !== 'file'
          ) {
            destination.value = attr.value
          }
        }
      }
      for (let i = destination.attributes.length - 1; i >= 0; i--) {
        let attr = destination.attributes[i]
        if (attr && !source.hasAttribute(attr.name) && !attributesToIgnore.includes(attr.name)) {
          destination.removeAttribute(attr.name)
        }
      }
    }

    #populateIdMapWithTree(idMap, persistentIds, root, elements) {
      for (const elt of elements) {
        if (persistentIds.has(elt.id)) {
          let current = elt
          while (current && current !== root) {
            let idSet = idMap.get(current)
            if (idSet == null) {
              idSet = new Set()
              idMap.set(current, idSet)
            }
            idSet.add(elt.id)
            current = current.parentElement
          }
        }
      }
    }

    #createIdMaps(oldNode, newContent) {
      let oldIdElements = this.#queryAll(oldNode, '[id]')
      let newIdElements = newContent.querySelectorAll('[id]')
      let persistentIds = this.#createPersistentIds(oldIdElements, newIdElements)
      let idMap = new Map()
      this.#populateIdMapWithTree(idMap, persistentIds, oldNode.parentElement, oldIdElements)
      this.#populateIdMapWithTree(idMap, persistentIds, newContent, newIdElements)
      return { persistentIds, idMap }
    }

    #createPersistentIds(oldIdElements, newIdElements) {
      let duplicateIds = new Set(),
        oldIdTagNameMap = new Map()
      for (const { id, tagName } of oldIdElements) {
        if (oldIdTagNameMap.has(id)) duplicateIds.add(id)
        else oldIdTagNameMap.set(id, tagName)
      }
      let persistentIds = new Set()
      for (const { id, tagName } of newIdElements) {
        if (persistentIds.has(id)) duplicateIds.add(id)
        else if (oldIdTagNameMap.get(id) === tagName) persistentIds.add(id)
      }
      for (const id of duplicateIds) persistentIds.delete(id)
      return persistentIds
    }

    #submitTransitionTask(task) {
      return new Promise(resolve => {
        this.#transitionQueue ||= []
        this.#transitionQueue.push({ task, resolve })
        if (!this.#processingTransition) {
          this.#processTransitionQueue()
        }
      })
    }

    async #processTransitionQueue() {
      if (this.#transitionQueue.length === 0 || this.#processingTransition) {
        return
      }

      this.#processingTransition = true
      let { task, resolve } = this.#transitionQueue.shift()

      try {
        if (document.startViewTransition) {
          this.emit('htmx:before:transition', { task })
          await document.startViewTransition(task).finished
          this.emit('htmx:after:transition', { task })
        } else {
          task()
        }
      } catch (e) {
        // Transitions can be skipped/aborted - this is normal
        if (e !== CANCELLED) throw e
      } finally {
        this.#processingTransition = false
        resolve()
        this.#processTransitionQueue()
      }
    }

    #captureCSSTransitions(task, root) {
      let idElements = root.querySelectorAll('[id]')
      let existingElementsById = Object.fromEntries([...idElements].map(e => [e.id, e]))
      let newElementsWithIds = task.fragment.querySelectorAll('[id]')
      task.restoreTasks = []
      for (let elt of newElementsWithIds) {
        let existing = existingElementsById[elt.id]
        if (existing?.tagName === elt.tagName) {
          let clone = elt.cloneNode(false) // shallow clone node
          this.#copyAttributes(elt, existing, this.config.morphIgnore)
          task.restoreTasks.push(() => {
            this.#copyAttributes(elt, clone, this.config.morphIgnore)
          })
        }
      }
    }

    #normalizeElement(cssOrElement) {
      if (typeof cssOrElement === 'string') {
        return this.find(cssOrElement)
      } else {
        return cssOrElement
      }
    }
  }

  return new Htmx()
})()
