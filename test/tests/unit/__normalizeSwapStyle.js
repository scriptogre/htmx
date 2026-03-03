describe('normalizeSwapStyle unit tests', function () {
  it('normalizes before to beforebegin', function () {
    assert.equal(htmx.normalizeSwapStyle('before'), 'beforebegin')
  })

  it('normalizes after to afterend', function () {
    assert.equal(htmx.normalizeSwapStyle('after'), 'afterend')
  })

  it('normalizes prepend to afterbegin', function () {
    assert.equal(htmx.normalizeSwapStyle('prepend'), 'afterbegin')
  })

  it('normalizes append to beforeend', function () {
    assert.equal(htmx.normalizeSwapStyle('append'), 'beforeend')
  })

  it('passes through innerHTML unchanged', function () {
    assert.equal(htmx.normalizeSwapStyle('innerHTML'), 'innerHTML')
  })

  it('passes through outerHTML unchanged', function () {
    assert.equal(htmx.normalizeSwapStyle('outerHTML'), 'outerHTML')
  })

  it('passes through beforebegin unchanged', function () {
    assert.equal(htmx.normalizeSwapStyle('beforebegin'), 'beforebegin')
  })

  it('passes through afterbegin unchanged', function () {
    assert.equal(htmx.normalizeSwapStyle('afterbegin'), 'afterbegin')
  })

  it('passes through beforeend unchanged', function () {
    assert.equal(htmx.normalizeSwapStyle('beforeend'), 'beforeend')
  })

  it('passes through afterend unchanged', function () {
    assert.equal(htmx.normalizeSwapStyle('afterend'), 'afterend')
  })

  it('passes through delete unchanged', function () {
    assert.equal(htmx.normalizeSwapStyle('delete'), 'delete')
  })

  it('passes through none unchanged', function () {
    assert.equal(htmx.normalizeSwapStyle('none'), 'none')
  })

  it('passes through innerMorph unchanged', function () {
    assert.equal(htmx.normalizeSwapStyle('innerMorph'), 'innerMorph')
  })

  it('passes through outerMorph unchanged', function () {
    assert.equal(htmx.normalizeSwapStyle('outerMorph'), 'outerMorph')
  })

  it('passes through unknown values unchanged', function () {
    assert.equal(htmx.normalizeSwapStyle('unknown'), 'unknown')
    assert.equal(htmx.normalizeSwapStyle('custom'), 'custom')
  })
})
