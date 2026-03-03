describe('parseSwap unit tests', function () {
  it('parses basic swap styles', function () {
    assert.equal(htmx.parseSwap('innerHTML').style, 'innerHTML')
    assert.equal(htmx.parseSwap('outerHTML').style, 'outerHTML')
    assert.equal(htmx.parseSwap('beforebegin').style, 'beforebegin')
    assert.equal(htmx.parseSwap('afterbegin').style, 'afterbegin')
    assert.equal(htmx.parseSwap('beforeend').style, 'beforeend')
    assert.equal(htmx.parseSwap('afterend').style, 'afterend')
  })

  it('normalizes legacy swap styles', function () {
    assert.equal(htmx.parseSwap('prepend').style, 'afterbegin')
    assert.equal(htmx.parseSwap('append').style, 'beforeend')
    assert.equal(htmx.parseSwap('before').style, 'beforebegin')
    assert.equal(htmx.parseSwap('after').style, 'afterend')
  })

  it('parses swap delay modifier', function () {
    let spec = htmx.parseSwap('innerHTML swap:100ms')
    assert.equal(spec.style, 'innerHTML')
    assert.equal(spec.swap, '100ms')
  })

  it('parses transition modifier', function () {
    assert.equal(htmx.parseSwap('innerHTML transition:true').transition, true)
    assert.equal(htmx.parseSwap('innerHTML transition:false').transition, false)
  })

  it('parses ignoreTitle modifier', function () {
    assert.equal(htmx.parseSwap('innerHTML ignoreTitle:true').ignoreTitle, true)
    assert.equal(htmx.parseSwap('innerHTML ignoreTitle:false').ignoreTitle, false)
  })

  it('parses strip modifier', function () {
    assert.equal(htmx.parseSwap('innerHTML strip:true').strip, true)
    assert.equal(htmx.parseSwap('innerHTML strip:false').strip, false)
  })

  it('parses focus-scroll modifier', function () {
    assert.equal(htmx.parseSwap('innerHTML focus-scroll:true')['focus-scroll'], true)
    assert.equal(htmx.parseSwap('innerHTML focus-scroll:false')['focus-scroll'], false)
  })

  it('parses scroll modifier', function () {
    assert.equal(htmx.parseSwap('innerHTML scroll:top').scroll, 'top')
    assert.equal(htmx.parseSwap('innerHTML scroll:bottom').scroll, 'bottom')
  })

  it('parses show modifier', function () {
    assert.equal(htmx.parseSwap('innerHTML show:top').show, 'top')
    assert.equal(htmx.parseSwap('innerHTML show:bottom').show, 'bottom')
  })

  it('parses target modifier', function () {
    assert.equal(htmx.parseSwap('innerHTML target:#foo').target, '#foo')
  })

  it('parses target with spaces', function () {
    assert.equal(htmx.parseSwap('innerHTML target:"#foo .bar"').target, '#foo .bar')
  })

  it('parses scroll with scrollTarget', function () {
    let spec = htmx.parseSwap('innerHTML scroll:top scrollTarget:#container')
    assert.equal(spec.scroll, 'top')
    assert.equal(spec.scrollTarget, '#container')
  })

  it('parses show with showTarget', function () {
    let spec = htmx.parseSwap('innerHTML show:bottom showTarget:.content')
    assert.equal(spec.show, 'bottom')
    assert.equal(spec.showTarget, '.content')
  })

  it('parses multiple modifiers', function () {
    let spec = htmx.parseSwap('innerHTML swap:100ms transition:true')
    assert.equal(spec.style, 'innerHTML')
    assert.equal(spec.swap, '100ms')
    assert.equal(spec.transition, true)
  })

  it('uses default swap when empty', function () {
    let spec = htmx.parseSwap('')
    assert.equal(spec.style, htmx.config.defaultSwap)
  })

  it('parses legacy style names with modifiers', function () {
    let spec = htmx.parseSwap('prepend swap:10ms')
    assert.equal(spec.style, 'afterbegin')
    assert.equal(spec.swap, '10ms')
  })
})
