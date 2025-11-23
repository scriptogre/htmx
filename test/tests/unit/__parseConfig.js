describe('__parseConfig unit tests', function () {
  it('parses simple key-value pair', function () {
    let config = htmx.__parseHJSON('delay:100ms')
    assert.equal(config.delay, '100ms')
  })

  it('parses boolean true', function () {
    let config = htmx.__parseHJSON('once')
    assert.equal(config.once, true)
  })

  it('parses boolean false', function () {
    let config = htmx.__parseHJSON('once:false')
    assert.equal(config.once, false)
  })

  it('parses integer value', function () {
    let config = htmx.__parseHJSON('count:42')
    assert.equal(config.count, 42)
  })

  it('parses multiple key-value pairs', function () {
    let config = htmx.__parseHJSON('delay:100ms throttle:200ms')
    assert.equal(config.delay, '100ms')
    assert.equal(config.throttle, '200ms')
  })

  it('parses comma-separated pairs', function () {
    let config = htmx.__parseHJSON('delay:100ms, throttle:200ms')
    assert.equal(config.delay, '100ms')
    assert.equal(config.throttle, '200ms')
  })

  it('parses double-quoted string', function () {
    let config = htmx.__parseHJSON('target:"#foo .bar"')
    assert.equal(config.target, '#foo .bar')
  })

  it('parses single-quoted string', function () {
    let config = htmx.__parseHJSON("target:'#foo .bar'")
    assert.equal(config.target, '#foo .bar')
  })

  it('parses nested object with dot notation', function () {
    let config = htmx.__parseHJSON('sse.mode:once')
    assert.equal(config.sse.mode, 'once')
  })

  it('parses multiple nested properties', function () {
    let config = htmx.__parseHJSON('sse.mode:once sse.maxRetries:5')
    assert.equal(config.sse.mode, 'once')
    assert.equal(config.sse.maxRetries, 5)
  })

  it('parses JSON object', function () {
    let config = htmx.__parseHJSON('{"delay":"100ms","throttle":"200ms"}')
    assert.equal(config.delay, '100ms')
    assert.equal(config.throttle, '200ms')
  })

  it('parses JSON with nested object', function () {
    let config = htmx.__parseHJSON('{"sse":{"mode":"once","maxRetries":5}}')
    assert.equal(config.sse.mode, 'once')
    assert.equal(config.sse.maxRetries, 5)
  })

  it('parses JSON with boolean', function () {
    let config = htmx.__parseHJSON('{"once":true,"changed":false}')
    assert.equal(config.once, true)
    assert.equal(config.changed, false)
  })

  it('handles empty string', function () {
    let config = htmx.__parseHJSON('')
    assert.deepEqual(config, {})
  })

  it('handles whitespace', function () {
    let config = htmx.__parseHJSON('  delay:100ms  ')
    assert.equal(config.delay, '100ms')
  })
})
