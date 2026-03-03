describe('parse() unit tests', function () {
  it('parses simple key-value pair', function () {
    let config = htmx.parse('delay:100ms')
    assert.equal(config.delay, 100)
  })

  it('parses bare value as value property', function () {
    let config = htmx.parse('click')
    assert.equal(config.value, 'click')
  })

  it('parses boolean true value', function () {
    let config = htmx.parse('once:true')
    assert.equal(config.once, true)
  })

  it('parses boolean false value', function () {
    let config = htmx.parse('once:false')
    assert.equal(config.once, false)
  })

  it('parses integer value', function () {
    let config = htmx.parse('count:42')
    assert.equal(config.count, 42)
  })

  it('parses multiple key-value pairs', function () {
    let config = htmx.parse('delay:100ms throttle:200ms')
    assert.equal(config.delay, 100)
    assert.equal(config.throttle, 200)
  })

  it('parses comma-separated pairs', function () {
    let config = htmx.parse('delay:100ms, throttle:200ms')
    assert.equal(config.delay, 100)
    assert.equal(config.throttle, 200)
  })

  it('parses double-quoted string', function () {
    let config = htmx.parse('target:"#foo .bar"')
    assert.equal(config.target, '#foo .bar')
  })

  it('parses single-quoted string', function () {
    let config = htmx.parse("target:'#foo .bar'")
    assert.equal(config.target, '#foo .bar')
  })

  it('parses nested object with dot notation', function () {
    let config = htmx.parse('sse.mode:once')
    assert.equal(config.sse.mode, 'once')
  })

  it('parses multiple nested properties', function () {
    let config = htmx.parse('sse.mode:once sse.maxRetries:5')
    assert.equal(config.sse.mode, 'once')
    assert.equal(config.sse.maxRetries, 5)
  })

  it('parses flag-style boolean options', function () {
    // When a bare token is not the first token, it becomes a boolean flag
    let config = htmx.parse('delay:100ms once changed')
    assert.equal(config.delay, 100)
    assert.equal(config.once, true)
    assert.equal(config.changed, true)
  })

  it('returns null for empty string', function () {
    let config = htmx.parse('')
    assert.isNull(config)
  })

  it('handles whitespace', function () {
    let config = htmx.parse('  delay:100ms  ')
    assert.equal(config.delay, 100)
  })

  it('coerces duration values with seconds unit', function () {
    let config = htmx.parse('delay:2s')
    assert.equal(config.delay, 2000)
  })

  it('coerces duration values with minute unit', function () {
    let config = htmx.parse('delay:1m')
    assert.equal(config.delay, 60000)
  })
})
