describe('hx-live-hyperscript extension', function () {

    let extBackup;
    let liveConfigBackup;

    before(async () => {
        extBackup = backupExtensions();
        liveConfigBackup = htmx.config.live;
        htmx.config.live = { ...liveConfigBackup, inputDebounce: 0 };
        clearExtensions();
        htmx.config.extensions = 'hx-live,hx-live-hyperscript';
        htmx.__approvedExt = 'hx-live,hx-live-hyperscript';

        for (let src of ['../src/ext/hx-live.js', '../src/ext/hx-live-hyperscript.js']) {
            let script = document.createElement('script');
            script.src = src;
            await new Promise(resolve => {
                script.onload = resolve;
                document.head.appendChild(script);
            });
        }
    });

    after(() => {
        restoreExtensions(extBackup);
        if (liveConfigBackup === undefined) delete htmx.config.live;
        else htmx.config.live = liveConfigBackup;
    });

    beforeEach(() => { setupTest(this.currentTest); });
    afterEach(() => { cleanupTest(); });

    // -------------------------------------------------------------------------
    // @ sigil scanner
    // -------------------------------------------------------------------------

    describe('@ sigil', function() {

        it('reads and writes typed ARIA through @aria-name', function() {
            let button = createProcessedHTML(`
                <button aria-pressed="false" hx-on:click="@aria-pressed = !@aria-pressed">Mute</button>
            `);
            button.click();
            button.getAttribute('aria-pressed').should.equal('true');
            button.click();
            button.getAttribute('aria-pressed').should.equal('false');
        });

        it('^aria-name finds the closest owner', function() {
            playground().innerHTML = `
                <div aria-busy="false">
                    <button hx-on:click="^aria-busy = !^aria-busy">Go</button>
                </div>
            `;
            htmx.process(playground());
            playground().querySelector('button').click();
            playground().querySelector('div').getAttribute('aria-busy').should.equal('true');
        });

        it('reads and writes typed JSON through ^data-name', function() {
            playground().innerHTML = `
                <div data-count="0">
                    <button hx-on:click="^data-count++">Vote</button>
                </div>
            `;
            htmx.process(playground());
            let button = playground().querySelector('button');
            button.click();
            button.click();
            playground().querySelector('div').dataset.count.should.equal('2');
        });

        it('converts hyphenated data names to dataset keys', function() {
            let button = createProcessedHTML(`
                <button data-item-id="3" hx-on:click="@data-item-id = @data-item-id + 1"></button>
            `);
            button.click();
            button.getAttribute('data-item-id').should.equal('4');
        });

        it('@.name toggles class membership', function() {
            let button = createProcessedHTML(`
                <button hx-on:click="@.active = !@.active"></button>
            `);
            button.click();
            button.classList.contains('active').should.equal(true);
            button.click();
            button.classList.contains('active').should.equal(false);
        });

        it('@.name accepts non-identifier class names', function() {
            let button = createProcessedHTML(`
                <button hx-on:click="@.is-active = true"></button>
            `);
            button.click();
            button.classList.contains('is-active').should.equal(true);
        });

        it('@class.assign assigns several classes at once', function() {
            let button = createProcessedHTML(`
                <button class="loading" hx-on:click="@class.assign({ active: true, loading: false })"></button>
            `);
            button.click();
            button.classList.contains('active').should.equal(true);
            button.classList.contains('loading').should.equal(false);
        });

        it('@class.assign leaves classes it does not mention', function() {
            let button = createProcessedHTML(`
                <button class="htmx-request keep" hx-on:click="@class.assign({ active: true })"></button>
            `);
            button.click();
            button.classList.contains('active').should.equal(true);
            button.classList.contains('htmx-request').should.equal(true);
            button.classList.contains('keep').should.equal(true);
        });

        it('@class.assign refuses a string and warns', function() {
            let warnings = [];
            let realWarn = console.warn;
            console.warn = (...args) => warnings.push(args[0]);
            try {
                let button = createProcessedHTML(`
                    <button class="keep" hx-on:click="@class.assign('active')"></button>
                `);
                button.click();
                button.classList.contains('active').should.equal(false);
                button.classList.contains('keep').should.equal(true);
            } finally {
                console.warn = realWarn;
            }
            warnings.length.should.equal(1);
            warnings[0].should.contain("class.assign expects an object");
        });

        it('reaches attributes that have no matching DOM property', function() {
            let input = createProcessedHTML(`
                <input hx-on:click="@readonly = true">
            `);
            input.click();
            input.hasAttribute('readonly').should.equal(true);
            input.readOnly.should.equal(true);
        });

        it('reads attributes that have no matching DOM property', function() {
            let input = createProcessedHTML(`
                <input readonly tabindex="3" hx-on:click="window.__attrRead = [@readonly, @tabindex]">
            `);
            input.click();
            window.__attrRead.should.deep.equal([true, 3]);
            delete window.__attrRead;
        });

        it('types numeric attributes as numbers', function() {
            let div = createProcessedHTML(`
                <div colspan="3" tabindex="2" hx-on:click="window.__nums = [@colspan, @tabindex, @colspan + 1]"></div>
            `);
            div.click();
            window.__nums.should.deep.equal([3, 2, 4]);
            delete window.__nums;
        });

        it('leaves non-numeric text in a numeric attribute alone', function() {
            let div = createProcessedHTML(`
                <div colspan="auto" hx-on:click="window.__num = @colspan"></div>
            `);
            div.click();
            window.__num.should.equal('auto');
            delete window.__num;
        });

        it('writes false rather than removing the attribute', function() {
            let div = createProcessedHTML(`
                <div my-flag="on" hx-on:click="@my-flag = false"></div>
            `);
            div.click();
            div.getAttribute('my-flag').should.equal('false');
        });

        it('removes an attribute with delete', function() {
            let div = createProcessedHTML(`
                <div my-flag="on" hx-on:click="delete @my-flag"></div>
            `);
            div.click();
            div.hasAttribute('my-flag').should.equal(false);
        });

        it('reads number and range inputs as numbers', function() {
            playground().innerHTML = `
                <input id="n" type="number" value="18">
                <input id="r" type="range" min="0" max="100" value="50">
                <button hx-on:click="window.__vals = [q('#n').@value, q('#r').@value, q('#n').@value + 1]"></button>
            `;
            htmx.process(playground());
            playground().querySelector('button').click();
            window.__vals.should.deep.equal([18, 50, 19]);
            delete window.__vals;
        });

        it('leaves other input types as strings', function() {
            playground().innerHTML = `
                <input id="t" type="text" value="007">
                <button hx-on:click="window.__val = q('#t').@value"></button>
            `;
            htmx.process(playground());
            playground().querySelector('button').click();
            window.__val.should.equal('007');
            delete window.__val;
        });

        it('reads an empty number input as null', function() {
            playground().innerHTML = `
                <input id="n" type="number">
                <button hx-on:click="window.__val = q('#n').@value"></button>
            `;
            htmx.process(playground());
            playground().querySelector('button').click();
            assert.isNull(window.__val);
            delete window.__val;
        });

        it('renders an empty number input as empty text', async function() {
            playground().innerHTML = `
                <input id="n" type="number">
                <output :text="q('#n').@value"></output>
            `;
            htmx.process(playground());
            await htmx.timeout(5);
            playground().querySelector('output').textContent.should.equal('');
        });

        it('reaches custom attributes', function() {
            let div = createProcessedHTML(`
                <div hx-on:click="@my-attr = 'on'; window.__custom = @my-attr"></div>
            `);
            div.click();
            div.getAttribute('my-attr').should.equal('on');
            window.__custom.should.equal('on');
            delete window.__custom;
        });

        it('keeps property and attribute in sync for checked', function() {
            let box = createProcessedHTML(`
                <input type="checkbox" hx-on:click="@checked = true">
            `);
            box.checked = false;
            box.removeAttribute('checked');
            box.click();
            box.checked.should.equal(true);
            box.hasAttribute('checked').should.equal(true);
        });

        it('reads the live value, not the default attribute', function() {
            playground().innerHTML = `
                <input id="field" value="default">
                <button hx-on:click="window.__liveValue = q('#field').@value"></button>
            `;
            htmx.process(playground());
            playground().querySelector('#field').value = 'typed';
            playground().querySelector('button').click();
            window.__liveValue.should.equal('typed');
            delete window.__liveValue;
        });

        it('writes value to both property and attribute', function() {
            let input = createProcessedHTML(`
                <input value="default" hx-on:click="@value = 'set'">
            `);
            input.value = 'dirty';
            input.click();
            input.value.should.equal('set');
            input.getAttribute('value').should.equal('set');
        });

        it('writes native reflected properties', function() {
            let button = createProcessedHTML(`
                <button hx-on:click="@hidden = true"></button>
            `);
            button.click();
            button.hasAttribute('hidden').should.equal(true);
        });

        it('emits string arguments inside toggle() and take()', function() {
            let button = createProcessedHTML(`
                <button aria-expanded="false" hx-on:click="toggle(@aria-expanded)"></button>
            `);
            button.click();
            button.getAttribute('aria-expanded').should.equal('true');
        });

        it('works after q()', function() {
            playground().innerHTML = `
                <div id="cart" data-count="1"></div>
                <span class="row"></span>
                <button hx-on:click="q('#cart').@data-count++; q('.row').@hidden = true"></button>
            `;
            htmx.process(playground());
            playground().querySelector('button').click();
            playground().querySelector('#cart').dataset.count.should.equal('2');
            playground().querySelector('.row').hasAttribute('hidden').should.equal(true);
        });

        it('@ reads this element only, ^ walks up', function() {
            playground().innerHTML = `
                <section data-count="7">
                    <button hx-on:click="window.__both = [@data-count, ^data-count]"></button>
                </section>
            `;
            htmx.process(playground());
            playground().querySelector('button').click();
            window.__both.should.deep.equal([undefined, 7]);
            delete window.__both;
        });

        it('^ writes to the owner, @ writes to this element', function() {
            playground().innerHTML = `
                <section data-count="1">
                    <button hx-on:click="^data-count++; @data-count = 'mine'"></button>
                </section>
            `;
            htmx.process(playground());
            let button = playground().querySelector('button');
            button.click();
            playground().querySelector('section').dataset.count.should.equal('2');
            button.dataset.count.should.equal('mine');
        });

        it('^.name finds a class on an ancestor', function() {
            playground().innerHTML = `
                <section class="active">
                    <button hx-on:click="window.__cls = [@.active, ^.active]"></button>
                </section>
            `;
            htmx.process(playground());
            playground().querySelector('button').click();
            window.__cls.should.deep.equal([false, true]);
            delete window.__cls;
        });

        it('^name finds a plain attribute on an ancestor', function() {
            playground().innerHTML = `
                <fieldset my-flag="on">
                    <button hx-on:click="window.__flag = [@my-flag, ^my-flag]"></button>
                </fieldset>
            `;
            htmx.process(playground());
            playground().querySelector('button').click();
            window.__flag.should.deep.equal([null, 'on']);
            delete window.__flag;
        });

        it('^ works after q()', function() {
            playground().innerHTML = `
                <section data-count="4">
                    <span id="inner"></span>
                </section>
                <button hx-on:click="q('#inner').^data-count++"></button>
            `;
            htmx.process(playground());
            playground().querySelector('button').click();
            playground().querySelector('section').dataset.count.should.equal('5');
        });

        it('^name and closest.* are the same thing', function() {
            playground().innerHTML = `
                <section data-count="9">
                    <button hx-on:click="window.__same = [^data-count, closest.data.count]"></button>
                </section>
            `;
            htmx.process(playground());
            playground().querySelector('button').click();
            window.__same.should.deep.equal([9, 9]);
            delete window.__same;
        });

        it('spreads a whole namespace with @data-* and ^data-*', function() {
            playground().innerHTML = `
                <section data-x="1" data-y="2">
                    <button data-y="3" hx-on:click="
                        window.__spread = [JSON.stringify({...@data-*}), JSON.stringify({...^data-*})]
                    "></button>
                </section>
            `;
            htmx.process(playground());
            playground().querySelector('button').click();
            window.__spread[0].should.equal('{"y":3}');
            let all = JSON.parse(window.__spread[1]);
            all.y.should.equal(3);
            all.x.should.equal(1);
            delete window.__spread;
        });

        it('aria is local, data cascades', function() {
            playground().innerHTML = `
                <section aria-busy="true" data-count="7">
                    <button hx-on:click="
                        window.__defaults = [aria.busy, data.count, ^aria-busy, @data-count]
                    "></button>
                </section>
            `;
            htmx.process(playground());
            playground().querySelector('button').click();
            window.__defaults.should.deep.equal([undefined, 7, true, undefined]);
            delete window.__defaults;
        });

        it('leaves bitwise XOR alone', function() {
            let button = createProcessedHTML(`
                <button hx-on:click="window.__xor = [5 ^ 3, (2) ^ 1, 6 ^ ^data-x]" data-x="1"></button>
            `);
            button.click();
            window.__xor.should.deep.equal([6, 3, 7]);
            delete window.__xor;
        });

        it('leaves strings, comments, regex, and template text alone', function() {
            let button = createProcessedHTML(`
                <button hx-on:click="
                    let parts = ['@data-x', &quot;@data-y&quot;, \`raw @data-z\`];
                    // @data-comment
                    /* @data-block */
                    if (/@data-re/.test('@data-re')) parts.push('re');
                    window.__scanParts = parts.join('|');
                "></button>
            `);
            button.click();
            window.__scanParts.should.equal('@data-x|@data-y|raw @data-z|re');
            delete window.__scanParts;
        });

        it('scans template literal interpolations', function() {
            let elt = createProcessedHTML(`
                <div data-name="ada" :text="\`hi \${@data-name} @data-name\`"></div>
            `);
            elt.textContent.should.equal('hi ada @data-name');
        });

        it('does not rewrite class used as an object key', function() {
            let button = createProcessedHTML(`
                <button hx-on:click="window.__scanKey = ({ class: 'x' }).class"></button>
            `);
            button.click();
            window.__scanKey.should.equal('x');
            delete window.__scanKey;
        });

        it('does not rewrite a member named class', function() {
            playground().innerHTML = `
                <div id="menu"></div>
                <button hx-on:click="q('#menu').class.open = true"></button>
            `;
            htmx.process(playground());
            playground().querySelector('button').click();
            playground().querySelector('#menu').classList.contains('open').should.equal(true);
        });

        it('works in :attr bindings', async function() {
            let elt = createProcessedHTML(`
                <div data-count="3" :text="@data-count * 2"></div>
            `);
            elt.textContent.should.equal('6');
        });

    });

    describe('selector literals', function() {

        it('#id selects by id', function() {
            playground().innerHTML = `
                <div id="cart" data-count="1"></div>
                <button hx-on:click="#cart.@data-count++"></button>
            `;
            htmx.process(playground());
            playground().querySelector('button').click();
            playground().querySelector('#cart').dataset.count.should.equal('2');
        });

        it('#id accepts hyphens', function() {
            playground().innerHTML = `
                <div id="tab-one"></div>
                <button hx-on:click="#tab-one.@.active = true"></button>
            `;
            htmx.process(playground());
            playground().querySelector('button').click();
            playground().querySelector('#tab-one').classList.contains('active').should.equal(true);
        });

        it('<.class/> selects every match', function() {
            playground().innerHTML = `
                <span class="row"></span>
                <span class="row"></span>
                <button hx-on:click="<.row/>.@hidden = true"></button>
            `;
            htmx.process(playground());
            playground().querySelector('button').click();
            [...playground().querySelectorAll('.row')].every(e => e.hidden).should.equal(true);
        });

        it('<previous input/> resolves htmx relative selectors', function() {
            playground().innerHTML = `
                <input value="typed">
                <button hx-on:click="window.__near = <previous input/>.@value"></button>
            `;
            htmx.process(playground());
            playground().querySelector('button').click();
            window.__near.should.equal('typed');
            delete window.__near;
        });

        it('<...> accepts combinators and attribute selectors', function() {
            playground().innerHTML = `
                <div class="a"><b class="c" data-x="1"></b></div>
                <button hx-on:click="window.__hits = [
                    <.a > .c/>.count,
                    <[data-x='1']/>.count
                ]"></button>
            `;
            htmx.process(playground());
            playground().querySelector('button').click();
            window.__hits.should.deep.equal([1, 1]);
            delete window.__hits;
        });

        it('leaves less-than comparisons alone', function() {
            let button = createProcessedHTML(`
                <button hx-on:click="window.__cmp = [1 < 2, 5 < 3, (8) < 9/3]"></button>
            `);
            button.click();
            window.__cmp.should.deep.equal([true, false, false]);
            delete window.__cmp;
        });

        it('leaves # and < inside strings, comments and templates alone', function() {
            let button = createProcessedHTML(`
                <button hx-on:click="window.__raw = [
                    '#cart', '<.row/>', \`#a <.b/>\`, /* #c <.d/> */ 1 // #e
                ]"></button>
            `);
            button.click();
            window.__raw.should.deep.equal(['#cart', '<.row/>', '#a <.b/>', 1]);
            delete window.__raw;
        });

        it("'s reads a property from a selector literal", function() {
            playground().innerHTML = `
                <div id="cart" data-count="1"></div>
                <button hx-on:click="#cart's @data-count++"></button>
            `;
            htmx.process(playground());
            playground().querySelector('button').click();
            playground().querySelector('#cart').dataset.count.should.equal('2');
        });

        it("'s works after <.../> and chains", function() {
            playground().innerHTML = `
                <input class="f" value="typed">
                <button hx-on:click="window.__poss = <.f/>'s @value"></button>
            `;
            htmx.process(playground());
            playground().querySelector('button').click();
            window.__poss.should.equal('typed');
            delete window.__poss;
        });

        it("'s reaches native properties too", function() {
            playground().innerHTML = `
                <div id="box" class="a b"></div>
                <button hx-on:click="window.__n = #box's className"></button>
            `;
            htmx.process(playground());
            playground().querySelector('button').click();
            window.__n.should.equal('a b');
            delete window.__n;
        });

        it("leaves ordinary strings starting with s alone", function() {
            let button = createProcessedHTML(`
                <button hx-on:click="window.__s = ['s x', 'submit', 'so', ['s a'].join('')]"></button>
            `);
            button.click();
            window.__s.should.deep.equal(['s x', 'submit', 'so', 's a']);
            delete window.__s;
        });

        it('works alongside q()', function() {
            playground().innerHTML = `
                <div id="cart" data-count="1"></div>
                <button hx-on:click="#cart.@data-count = q('#cart').@data-count + 4"></button>
            `;
            htmx.process(playground());
            playground().querySelector('button').click();
            playground().querySelector('#cart').dataset.count.should.equal('5');
        });

        it('works in :attr bindings', function() {
            playground().innerHTML = `
                <div id="src" data-count="3"></div>
                <output :text="#src.@data-count * 2"></output>
            `;
            htmx.process(playground());
            playground().querySelector('output').textContent.should.equal('6');
        });

    });
});
