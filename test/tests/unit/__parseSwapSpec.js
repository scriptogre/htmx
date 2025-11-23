describe('__parseSwapSpec unit tests', function () {
  it('parses basic swap styles', function () {
    assert.equal(htmx.__parseSwap('innerHTML').style, 'innerHTML')
    assert.equal(htmx.__parseSwap('outerHTML').style, 'outerHTML')
    assert.equal(htmx.__parseSwap('beforebegin').style, 'beforebegin')
    assert.equal(htmx.__parseSwap('afterbegin').style, 'afterbegin')
    assert.equal(htmx.__parseSwap('beforeend').style, 'beforeend')
    assert.equal(htmx.__parseSwap('afterend').style, 'afterend')
  })

  it('normalizes legacy swap styles', function () {
    assert.equal(htmx.__parseSwap('prepend').style, 'afterbegin')
    assert.equal(htmx.__parseSwap('append').style, 'beforeend')
    assert.equal(htmx.__parseSwap('before').style, 'beforebegin')
    assert.equal(htmx.__parseSwap('after').style, 'afterend')
  })

  it('parses swap delay modifier', function () {
    let spec = htmx.__parseSwap('innerHTML swap:100ms')
    assert.equal(spec.style, 'innerHTML')
    assert.equal(spec.swap, '100ms')
  })

  it('parses transition modifier', function () {
    assert.equal(htmx.__parseSwap('innerHTML transition:true').transition, true)
    assert.equal(htmx.__parseSwap('innerHTML transition:false').transition, false)
  })

  it('parses ignoreTitle modifier', function () {
    assert.equal(htmx.__parseSwap('innerHTML ignoreTitle:true').ignoreTitle, true)
    assert.equal(htmx.__parseSwap('innerHTML ignoreTitle:false').ignoreTitle, false)
  })

  it('parses strip modifier', function () {
    assert.equal(htmx.__parseSwap('innerHTML strip:true').strip, true)
    assert.equal(htmx.__parseSwap('innerHTML strip:false').strip, false)
  })

  it('parses focus-scroll modifier', function () {
    assert.equal(htmx.__parseSwap('innerHTML focus-scroll:true')['focus-scroll'], true)
    assert.equal(htmx.__parseSwap('innerHTML focus-scroll:false')['focus-scroll'], false)
  })

  it('parses scroll modifier', function () {
    assert.equal(htmx.__parseSwap('innerHTML scroll:top').scroll, 'top')
    assert.equal(htmx.__parseSwap('innerHTML scroll:bottom').scroll, 'bottom')
  })

  it('parses show modifier', function () {
    assert.equal(htmx.__parseSwap('innerHTML show:top').show, 'top')
    assert.equal(htmx.__parseSwap('innerHTML show:bottom').show, 'bottom')
  })

  it('parses target modifier', function () {
    assert.equal(htmx.__parseSwap('innerHTML target:#foo').target, '#foo')
  })

  it('parses target with spaces', function () {
    assert.equal(htmx.__parseSwap('innerHTML target:"#foo .bar"').target, '#foo .bar')
  })

  it('parses scroll with scrollTarget', function () {
    let spec = htmx.__parseSwap('innerHTML scroll:top scrollTarget:#container')
    assert.equal(spec.scroll, 'top')
    assert.equal(spec.scrollTarget, '#container')
  })

  it('parses show with showTarget', function () {
    let spec = htmx.__parseSwap('innerHTML show:bottom showTarget:.content')
    assert.equal(spec.show, 'bottom')
    assert.equal(spec.showTarget, '.content')
  })

  it('parses multiple modifiers', function () {
    let spec = htmx.__parseSwap('innerHTML swap:100ms transition:true')
    assert.equal(spec.style, 'innerHTML')
    assert.equal(spec.swap, '100ms')
    assert.equal(spec.transition, true)
  })

  it('uses default swap when empty', function () {
    let spec = htmx.__parseSwap('')
    assert.equal(spec.style, htmx.config.defaultSwap)
  })

  it('parses legacy style names with modifiers', function () {
    let spec = htmx.__parseSwap('prepend swap:10ms')
    assert.equal(spec.style, 'afterbegin')
    assert.equal(spec.swap, '10ms')
  })
})
