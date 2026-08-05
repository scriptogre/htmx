// hx-live extension: reactive live expressions + q() proxy + scope helpers.
// Hooks:
//   htmx:after:process  find new [hx-live] elements and register them
//   htmx:before:swap    increment swap depth (defer recomputes)
//   htmx:finally:swap   decrement, fire one consolidated recompute
//   htmx:scope          inject q, wait, trigger, debounce into JS expression scopes
(() => {
    let api;
    let fns = new Set();
    let pending = false;
    let dbSym = Symbol();
    let observer = null;
    let recomputeBound = null;
    let inputBound = null;
    let swaps = 0;
    let warned = false;

    const OBSERVE_OPTIONS = { childList: true, subtree: true, attributes: true, characterData: true };

    let inputDebounceId = null;

    function ensureActive() {
        if (observer) return;
        recomputeBound = () => schedule();
        let inputDelay = htmx.parseInterval(htmx.config.live?.inputDebounce ?? 100) ?? 100;
        inputBound = () => {
            clearTimeout(inputDebounceId);
            inputDebounceId = setTimeout(schedule, inputDelay);
        };
        document.addEventListener('input', inputBound, true);
        document.addEventListener('change', recomputeBound, true);
        observer = new MutationObserver(recomputeBound);
        observer.observe(document.documentElement, OBSERVE_OPTIONS);
    }

    function deactivate() {
        if (!observer) return;
        clearTimeout(inputDebounceId);
        inputDebounceId = null;
        document.removeEventListener('input', inputBound, true);
        inputBound = null;
        document.removeEventListener('change', recomputeBound, true);
        observer.disconnect();
        observer = null;
        recomputeBound = null;
        warned = false;
    }

    function schedule() {
        if (pending) return;
        if (swaps > 0) return;
        pending = true;
        queueMicrotask(() => {
            // Detach observer while writing so our own writes don't queue records.
            observer?.disconnect();
            let startedAt = performance.now();
            fns.forEach(f => f());
            let elapsed = performance.now() - startedAt;
            if (!warned && elapsed > 16) {
                console.warn(`htmx: hx-live expressions took ${elapsed.toFixed(1)}ms.`);
                warned = true;
            }
            if (fns.size === 0) {
                deactivate();
            } else {
                observer.observe(document.documentElement, OBSERVE_OPTIONS);
            }
            pending = false;
        });
    }

    let BOOLEAN_ATTRS = new Set([
        'disabled','hidden','required','readonly','open','inert',
        'multiple','autofocus','novalidate','default','reversed',
        'loop','muted','controls','autoplay','playsinline',
        'formnovalidate','async','defer','ismap','typemustmatch',
        'allowfullscreen','itemscope','nomodule','checked','selected'
    ]);
    let PROPERTY_BINDING_ATTRS = new Set(['checked','value','selected']);
    let STRINGY_BOOLEAN_ATTRS = new Set(['contenteditable','draggable','spellcheck']);
    let NUMERIC_INPUT_TYPES = new Set(['number', 'range']);
    let NUMERIC_ATTRS = new Set([
        'tabindex','colspan','rowspan','maxlength','minlength',
        'size','span','start','rows','cols','width','height'
    ]);

    /**
     * Get or set an attribute or property-backed value on one or more elements.
     *
     * @param {Element[]} elts - Target elements.
     * @param {string} name - Attribute name.
     * @param {*} [value] - Value to set. Omit for getter (reads from first element).
     * @returns {*} Getter result; setter returns nothing.
     *
     * @example
     * attr('hidden')                  // boolean: is hidden present?
     * attr('hidden', true)            // set hidden=""
     * attr('class', 'foo bar')        // raw class attribute
     * attr('aria-expanded', open)     // ARIA: raw string value
     * attr('value', 'hello')          // set the value attribute
     * attr('contenteditable', false)  // "false", not removed
     * attr('data-x', null)            // remove attribute
     */
    function applyAttr(elts, name, ...rest) {
        let isAria = name.startsWith('aria-');

        if (rest.length === 0) {
            let e = elts[0];
            if (!e) return undefined;
            if (name === 'value' && NUMERIC_INPUT_TYPES.has(e.type)) {
                return e.value === '' ? null : e.valueAsNumber;
            }
            if (PROPERTY_BINDING_ATTRS.has(name)) return e[name];
            if (BOOLEAN_ATTRS.has(name)) return e.hasAttribute(name);
            let raw = e.getAttribute(name);
            if (NUMERIC_ATTRS.has(name) && raw?.trim() && Number.isFinite(Number(raw))) return Number(raw);
            return raw;
        }

        let value = rest[0];
        for (let e of elts) {
            if (isAria) {
                if (value == null) e.removeAttribute(name);
                else e.setAttribute(name, String(value));
            } else if (PROPERTY_BINDING_ATTRS.has(name)) {
                applyPropertyBinding(e, name, value);
            } else if (BOOLEAN_ATTRS.has(name)) {
                if (value) e.setAttribute(name, '');
                else e.removeAttribute(name);
            } else if (STRINGY_BOOLEAN_ATTRS.has(name)) {
                if (value === null || value === undefined) e.removeAttribute(name);
                else if (value === true) e.setAttribute(name, 'true');
                else if (value === false) e.setAttribute(name, 'false');
                else e.setAttribute(name, String(value));
            } else {
                if (value === null || value === undefined) e.removeAttribute(name);
                else e.setAttribute(name, value === true ? '' : String(value));
            }
        }
    }

    function makeAttrProxy(elts) {
        return new Proxy({}, {
            get: (_, name) => typeof name === 'string' ? applyAttr(elts, name) : undefined,
            set: (_, name, value) => { applyAttr(elts, name, value); return true; },
            deleteProperty: (_, name) => { applyAttr(elts, name, null); return true; }
        });
    }

    function applyStyleBinding(elt, value) {
        let prop = api.htmxProp(elt);
        let oldManaged = prop.liveStyles || new Set();
        let styles = [];

        if (typeof value === 'string') {
            for (let decl of value.split(';')) {
                let idx = decl.indexOf(':');
                if (idx < 0) continue;
                let k = decl.slice(0, idx).trim();
                let v = decl.slice(idx + 1).trim();
                if (k) styles.push([k, v]);
            }
        } else if (value && typeof value === 'object') {
            for (let [k, v] of Object.entries(value)) {
                styles.push([camelToKebab(k), v == null || v === '' ? null : String(v)]);
            }
        }

        let newManaged = new Set(styles.map(([k]) => k));
        for (let k of oldManaged) if (!newManaged.has(k)) elt.style.removeProperty(k);
        for (let [k, v] of styles) {
            if (v == null) elt.style.removeProperty(k);
            else elt.style.setProperty(k, v);
        }
        if (elt.style.length === 0) elt.removeAttribute('style');
        prop.liveStyles = newManaged;
    }

    function camelToKebab(s) {
        return s.replace(/[A-Z]/g, m => '-' + m.toLowerCase());
    }

    function kebabToCamel(s) {
        return s.replace(/-([a-z0-9])/g, (_, c) => c.toUpperCase());
    }

    let CODE = new RegExp([
        /\/\/.*/,                                            // line comment
        /\/\*[\s\S]*?\*\//,                                  // block comment
        /'(?:[^'\\]|\\.)*'/,                                 // single-quoted string
        /"(?:[^"\\]|\\.)*"/,                                 // double-quoted string
        /\/(?:\\.|\[(?:\\.|[^\]])*\]|[^\/\\\n[])+\/[a-z]*/,  // regex literal
        /[@^]\.?[A-Za-z][\w-]*\*?/,                          // @ and ^ attribute sigils
        /[\w$]+/,                                            // identifier or number
        /\S/                                                 // any other character
    ].map(part => part.source).join('|'), 'g');
    let TEMPLATE_TEXT = /(?:\\.|\$(?!\{)|[^`\\$])*(`|\$\{|$)/y;
    let TOGGLE_OR_TAKE_CALL = /\b(?:toggle|take)\(\s*$/;
    let CLASS_ACCESS = /^\s*(?:[.[]|=[^=>])/;
    let ENDS_VALUE = /^(?:[\w$]+|[)\]}v])$/;
    let REGEX_WORDS = new Set(['return', 'typeof', 'instanceof', 'in', 'of', 'new', 'delete', 'void', 'throw', 'case', 'do', 'else', 'yield', 'await']);

    function member(key) {
        return /^[A-Za-z_$][\w$]*$/.test(key) ? '.' + key : `[${JSON.stringify(key)}]`;
    }

    // '@aria-expanded' -> 'aria.expanded', '@.active' -> '__hxLive.class.active'.
    // After a dot (q('#x').@hidden) the base is the q() proxy, not this.
    function sigilCode(name, afterDot, cascades) {
        let root = (afterDot ? '' : '__hxLive.q.') + (cascades ? 'closest.' : '');
        if (name === 'class') return root + 'class';
        if (name[0] === '.') return root + 'class' + member(name.slice(1));
        if (name.endsWith('-*')) return root + name.slice(0, -2);
        if (name.startsWith('aria-')) return root + 'aria' + member(name.slice(5));
        if (name.startsWith('data-')) return root + 'data' + member(kebabToCamel(name.slice(5)));
        return root + 'attr' + member(name);
    }

    function scanLive(src) {
        if (!/[@^]|\bclass\b/.test(src)) return src;
        let out = '';
        let stack = [];  // '`' template text, '$' inside ${...}, '{' block
        let prev = '';   // previous token, 'v' for any value
        let i = 0;

        while (i < src.length) {
            if (stack.at(-1) === '`') {
                TEMPLATE_TEXT.lastIndex = i;
                let [text, stop] = TEMPLATE_TEXT.exec(src);
                out += text;
                i += text.length;
                if (stop === '`') stack.pop();
                else if (stop) stack.push('$');
                prev = stop === '`' ? 'v' : '{';
                continue;
            }

            CODE.lastIndex = i;
            let match = CODE.exec(src);
            if (!match) { out += src.slice(i); break; }
            let token = match[0];
            out += src.slice(i, match.index);
            i = match.index + token.length;

            if (token[0] === '/' && (token[1] === '/' || token[1] === '*')) {
                out += token;  // comments do not update prev
            } else if (token[0] === '/' && token.length > 1 && ENDS_VALUE.test(prev) && !REGEX_WORDS.has(prev)) {
                out += '/';  // division, not a regex: re-read from the next character
                i = match.index + 1;
                prev = '/';
            } else if (token[0] === '^' && ENDS_VALUE.test(prev) && !REGEX_WORDS.has(prev)) {
                out += '^';
                i = match.index + 1;
                prev = '^';
            } else if (token[0] === '@' || token[0] === '^') {
                let name = token.slice(1);
                let afterDot = prev === '.' && !out.endsWith('...');
                out += TOGGLE_OR_TAKE_CALL.test(out)
                    ? `'${name}'`
                    : sigilCode(name, afterDot, token[0] === '^');
                prev = 'v';
            } else if (token === 'class' && prev !== '.' && CLASS_ACCESS.test(src.slice(i))) {
                out += '__hxLive.q.class';
                prev = 'v';
            } else {
                if (token === '`' || token === '{') stack.push(token);
                else if (token === '}') stack.pop();
                out += token;
                prev = /^['"/]/.test(token) ? 'v' : token;
            }
        }
        return out;
    }

    let booleanAria = new Set([
        'atomic',
        'busy',
        'checked',
        'current',
        'disabled',
        'expanded',
        'grabbed',
        'haspopup',
        'hidden',
        'invalid',
        'modal',
        'multiline',
        'multiselectable',
        'pressed',
        'readonly',
        'required',
        'selected'
    ]);
    let integerAria = new Set([
        'colcount',
        'colindex',
        'colspan',
        'level',
        'posinset',
        'rowcount',
        'rowindex',
        'rowspan',
        'setsize'
    ]);
    let numberAria = new Set([
        'valuemax',
        'valuemin',
        'valuenow'
    ]);
    let listAria = new Set([
        'controls',
        'describedby',
        'dropeffect',
        'flowto',
        'labelledby',
        'owns',
        'relevant'
    ]);
    function writeClass(elt, name, value) {
        elt.classList.toggle(name, !!value);
        if (!elt.classList.length) elt.removeAttribute('class');
    }

    function makeClassProxy(elt) {
        return new Proxy({}, {
            get: (_, name) => typeof name === 'string' ? elt.classList.contains(name) : undefined,
            set: (_, name, value) => {
                if (typeof name !== 'string') return false;
                writeClass(elt, name, value);
                return true;
            },
            deleteProperty: (_, name) => {
                if (typeof name !== 'string') return false;
                writeClass(elt, name, false);
                return true;
            },
            has: (_, name) => typeof name === 'string' && elt.classList.contains(name),
            ownKeys: () => [...elt.classList],
            getOwnPropertyDescriptor: (_, name) => elt.classList.contains(name)
                ? { enumerable: true, configurable: true }
                : undefined
        });
    }

    function makeClosestClassProxy(elt) {
        let owner = name => elt.closest('.' + CSS.escape(name));
        return new Proxy({}, {
            get: (_, name) => typeof name === 'string' ? !!owner(name) : undefined,
            set: (_, name, value) => {
                if (typeof name !== 'string') return false;
                writeClass(owner(name) || elt, name, value);
                return true;
            },
            deleteProperty: (_, name) => {
                if (typeof name !== 'string') return false;
                let found = owner(name);
                if (found) writeClass(found, name, false);
                return true;
            }
        });
    }

    function makeClosestAttrProxy(elt) {
        let owner = name => elt.closest('[' + CSS.escape(name) + ']') || elt;
        return new Proxy({}, {
            get: (_, name) => typeof name === 'string' ? applyAttr([owner(name)], name) : undefined,
            set: (_, name, value) => { applyAttr([owner(name)], name, value); return true; },
            deleteProperty: (_, name) => { applyAttr([owner(name)], name, null); return true; }
        });
    }

    function makeClosestScope(elt) {
        return {
            get data() { return makeDataProxy(elt, true); },
            get aria() { return makeAriaProxy(elt, true); },
            get class() { return makeClosestClassProxy(elt); },
            get attr() { return makeClosestAttrProxy(elt); }
        };
    }

    function writeAria(elt, key, value) {
        let name = 'aria-' + key;
        if (value == null) elt.removeAttribute(name);
        else elt.setAttribute(name, listAria.has(key) && Array.isArray(value) ? value.join(' ') : String(value));
    }

    function makeAriaProxy(elt, cascades = true) {
        let findOwner = name => cascades
            ? elt.closest('[' + name + ']')
            : elt.hasAttribute(name) ? elt : null;
        return new Proxy({}, {
            get: (_, prop) => {
                if (typeof prop !== 'string') return undefined;
                let key = prop.toLowerCase();
                let name = 'aria-' + key;
                let owner = findOwner(name);
                let value = owner?.getAttribute(name);
                if (booleanAria.has(key) && (value === 'true' || value === 'false')) return value === 'true';
                let number = Number(value);
                let validNumber = numberAria.has(key) || (integerAria.has(key) && Number.isInteger(number));
                if (validNumber && value?.trim() && Number.isFinite(number)) return number;
                if (listAria.has(key) && value != null) return value.trim() ? value.trim().split(/\s+/) : [];
                return value;
            },
            set: (_, prop, value) => {
                if (typeof prop !== 'string') return false;
                let key = prop.toLowerCase();
                let name = 'aria-' + key;
                writeAria(findOwner(name) || elt, key, value);
                return true;
            },
            deleteProperty: (_, prop) => {
                if (typeof prop !== 'string') return false;
                let name = 'aria-' + prop.toLowerCase();
                findOwner(name)?.removeAttribute(name);
                return true;
            }
        });
    }

    function writeData(elt, name, value) {
        if (value === undefined) elt.removeAttribute(name);
        else elt.setAttribute(name, typeof value === 'string' ? value : JSON.stringify(value));
    }

    // `data.foo` reads/writes to closest ancestor with `data-foo`.
    // `has` trap lets `hx-on:click="with (data) { x++; y-- }"` work: data-* keys
    // bind to the proxy, all other identifiers fall through to outer scope.
    function makeDataProxy(elt, cascades = true) {
        let findOwner = kebab => cascades
            ? elt.closest('[data-' + kebab + ']')
            : elt.hasAttribute('data-' + kebab) ? elt : null;
        return new Proxy({}, {
            get: (_, prop) => {
                if (typeof prop !== 'string') return undefined;
                let kebab = camelToKebab(prop);
                let ancestor = findOwner(kebab);
                if (!ancestor) return undefined;
                let raw = ancestor.dataset[prop];
                try { return JSON.parse(raw); } catch { return raw; }
            },
            set: (_, prop, val) => {
                if (typeof prop !== 'string') return false;
                let kebab = camelToKebab(prop);
                writeData(findOwner(kebab) || elt, 'data-' + kebab, val);
                return true;
            },
            deleteProperty: (_, prop) => {
                if (typeof prop !== 'string') return false;
                let kebab = camelToKebab(prop);
                findOwner(kebab)?.removeAttribute('data-' + kebab);
                return true;
            },
            has: (_, prop) => {
                if (typeof prop !== 'string') return false;
                let kebab = camelToKebab(prop);
                return !!findOwner(kebab);
            },
            ownKeys: () => {
                let result = [];
                let seen = new Set();
                for (let node = elt; node; node = cascades ? node.parentElement : null) {
                    for (let key of Object.keys(node.dataset)) {
                        if (key !== 'htmxPowered' && !seen.has(key)) {
                            seen.add(key);
                            result.push(key);
                        }
                    }
                }
                return result;
            },
            getOwnPropertyDescriptor: (_, prop) => {
                if (typeof prop !== 'string' || prop === 'htmxPowered') return;
                let kebab = camelToKebab(prop);
                if (findOwner(kebab)) return { enumerable: true, configurable: true };
            }
        });
    }

    function applyPropertyBinding(elt, name, value) {
        if (name === 'checked' || name === 'selected') {
            let present = !!value;
            elt[name] = present;
            elt.toggleAttribute(name, present);
        } else if (value === false || value == null) {
            elt[name] = typeof elt[name] === 'boolean' ? false : '';
            elt.removeAttribute(name);
        } else if (value === true) {
            elt[name] = true;
            elt.setAttribute(name, '');
        } else {
            elt[name] = value;
            elt.setAttribute(name, String(value));
        }
    }

    function applyClassBinding(elt, name, value) {
        if (name === 'class') {
            applyMultiClass(elt, value);
        } else {
            writeClass(elt, name.slice(1), value);
        }
    }

    function setClasses(elt, value) {
        if (!value || typeof value !== 'object') {
            console.warn(`htmx: class = expects an object, got ${typeof value}. Use attr('class', ...) to replace the attribute.`, { elt });
            return;
        }
        writeClasses(elt, value);
    }

    function writeClasses(elt, value) {
        let written = [];
        if (typeof value === 'string') {
            for (let c of value.trim().split(/\s+/).filter(Boolean)) {
                written.push(c);
                writeClass(elt, c, true);
            }
        } else if (value && typeof value === 'object') {
            for (let [key, cond] of Object.entries(value)) {
                for (let c of key.trim().split(/\s+/).filter(Boolean)) {
                    written.push(c);
                    writeClass(elt, c, cond);
                }
            }
        }
        return written;
    }

    function applyMultiClass(elt, value) {
        let prop = api.htmxProp(elt);
        let oldManaged = prop.liveClasses || new Set();
        let newManaged = new Set(writeClasses(elt, value));
        for (let c of oldManaged) if (!newManaged.has(c)) writeClass(elt, c, false);
        prop.liveClasses = newManaged;
    }

    function applyTake(targets, name, scope) {
        let isClass = name.startsWith('.');
        let key = isClass ? name.slice(1) : name;
        let isAria = name.startsWith('aria-');
        let auto = isClass ? '.' + key : '[' + name + ']';
        let root = scope == null ? targets[0]?.parentElement
            : scope.nodeType ? scope : null;
        let sources = root
            ? [root, ...root.querySelectorAll(auto)]
            : document.querySelectorAll(typeof scope === 'string' ? scope : scope?.from || auto);
        let targetSet = new Set(targets);
        for (let s of sources) {
            if (targetSet.has(s)) continue;
            if (isClass) {
                s.classList?.remove(key);
                if (s.classList?.length === 0) s.removeAttribute('class');
            } else if (isAria) {
                s.setAttribute(name, 'false');
            } else {
                s.removeAttribute(name);
            }
        }
        for (let t of targets) {
            if (isClass) t.classList?.add(key);
            else if (isAria) t.setAttribute(name, 'true');
            else t.setAttribute(name, '');
        }
    }

    function forEvent(elt, ...args) {
        let target = elt || document;
        for (let a of args) if (a?.nodeType) target = a;
        return new Promise(resolve => {
            let cleanups = [], done = false;
            let fire = v => { if (done) return; done = true; for (let c of cleanups) c(); resolve(v); };
            for (let a of args) {
                if (a == null || a?.nodeType) continue;
                let ms = typeof a === 'number' ? a
                    : (typeof a === 'string' ? htmx.parseInterval(a) : undefined);
                if (ms !== undefined && ms > 0) {
                    let id = setTimeout(() => fire(a), ms);
                    cleanups.push(() => clearTimeout(id));
                } else if (typeof a === 'string') {
                    let h = evt => fire(evt);
                    target.addEventListener(a, h, { once: true });
                    cleanups.push(() => target.removeEventListener(a, h));
                }
            }
        });
    }

    /**
     * Toggle or cycle a class, ARIA attribute, or attribute on an element.
     *
     * @param {string} name - Class (`.foo`) or attribute name.
     * @param {string|string[]} [values] - Cycle list (pipe-delimited string or array). Omit for binary flip.
     * @param {Element} element - DOM element to mutate.
     *
     * @example
     * toggle('.active')                      // toggle class
     * toggle('aria-expanded')                // flip "true" ↔ "false"
     * toggle('hidden')                       // toggle attribute presence
     * toggle('data-view', 'grid|list|table') // cycle attribute through values
     * toggle('.size', 'sm|md|lg')            // cycle classes (one at a time)
     * toggle('data-open', 'on|')             // 'on' ↔ absent slot
     */
    function applyToggle(name, values, element) {
        let isClass = name.startsWith('.');
        let key = isClass ? name.slice(1) : name;
        let isAria = name.startsWith('aria-');
        let asArray = values && (typeof values === 'string'
            ? values.split('|').map(v => v.trim())
            : values);

        if (!asArray) {
            if (isClass) element.classList.toggle(key);
            else if (isAria) {
                let cur = element.getAttribute(name);
                element.setAttribute(name, cur === 'true' ? 'false' : 'true');
            } else {
                element.toggleAttribute(name);
            }
            return;
        }
        if (isClass) {
            let cur = asArray.findIndex(v => v && element.classList.contains(v));
            if (cur >= 0) element.classList.remove(asArray[cur]);
            let next = asArray[(cur + 1) % asArray.length];
            if (next) element.classList.add(next);
        } else {
            let curVal = element.getAttribute(name) ?? '';
            let cur = asArray.indexOf(curVal);
            let next = asArray[(cur + 1) % asArray.length];
            if (next === '') element.removeAttribute(name);
            else element.setAttribute(name, next);
        }
    }

    function makeDebounce() {
        // Closure form keyed by fn.toString() (no async context to abort); promise form keyed null.
        let channels = new Map();
        let chan = key => channels.get(key) || (channels.set(key, { last: 0, reject: null }), channels.get(key));
        return (ms, fn) => {
            let ch = chan(fn ? fn.toString() : null);
            ch.reject?.(dbSym);
            ch.reject = null;
            let id = ++ch.last;
            if (fn) {
                setTimeout(() => id === ch.last && fn(), ms);
                return;
            }
            return new Promise((res, rej) => {
                ch.reject = rej;
                setTimeout(() => {
                    if (id !== ch.last) return;
                    ch.reject = null;
                    res();
                }, ms);
            });
        };
    }

    function getDebounce(elt) {
        let prop = api.htmxProp(elt);
        return prop.debounce || (prop.debounce = makeDebounce());
    }

    function makeQ(ctx, defaultRoot = document) {
        return selectorOrElt => {
            if (typeof selectorOrElt !== 'string') {
                return qProxy(
                    selectorOrElt?.nodeType ? [selectorOrElt] : [...(selectorOrElt || [])]
                );
            }
            let sel = selectorOrElt;
            let inMatch = sel.match(/^(.+)\s+in\s+(.+)$/);
            let roots = [defaultRoot];
            if (inMatch) {
                sel = inMatch[1];
                if (inMatch[2] === 'this' || inMatch[2] === 'me') {
                    roots = [ctx];
                } else {
                    roots = [...document.querySelectorAll(inMatch[2])];
                }
            }
            if (!roots.length) return qProxy([]);
            let qsa = s => {
                if (roots.length === 1) return [...roots[0].querySelectorAll(s)];
                let out = [], seen = new Set();
                for (let r of roots) for (let e of r.querySelectorAll(s)) {
                    if (!seen.has(e)) { seen.add(e); out.push(e); }
                }
                return out.sort((a, b) => a.compareDocumentPosition(b) & 4 ? -1 : 1);
            };
            let dirMatch = sel.match(/^(next|previous|closest|first|last)\s+(.+)$/);
            let elts;
            if (dirMatch) {
                let [, dir, s] = dirMatch;
                let cdp = e => ctx.compareDocumentPosition(e);
                if (dir === 'closest') {
                    let c = ctx.closest?.(s);
                    elts = c ? [c] : [];
                } else {
                    let all = qsa(s);
                    if (dir === 'first') elts = all.slice(0, 1);
                    else if (dir === 'last') elts = all.slice(-1);
                    else if (dir === 'next') {
                        let n = all.find(e => cdp(e) & 4);
                        elts = n ? [n] : [];
                    } else {
                        let p = all.reverse().find(e => cdp(e) & 2);
                        elts = p ? [p] : [];
                    }
                }
            } else {
                elts = qsa(sel);
            }
            return qProxy(elts);
        };
    }

    let arrayMethods = new Set(['map', 'filter', 'reduce', 'reduceRight', 'forEach', 'some', 'every',
        'find', 'findIndex', 'findLast', 'findLastIndex', 'flatMap', 'flat',
        'slice', 'indexOf', 'lastIndexOf', 'includes', 'join', 'at']);

    let positions = { before: 'beforebegin', after: 'afterend', start: 'afterbegin', end: 'beforeend' };

    function qProxy(elts) {
        let proxy = new Proxy({}, {
            get: (_, p) => {
                if (p === 'count') return elts.length;
                if (p === 'arr') return () => elts.slice();
                if (p === Symbol.iterator) return () => elts.values();
                if (p === 'q') return s => {
                    let out = new Set();
                    for (let e of elts) for (let r of makeQ(e, e)(s).arr()) out.add(r);
                    return qProxy([...out]);
                };
                if (p === 'trigger') return (t, d, b) => { elts.forEach(e => htmx.trigger(e, t, d, b)); return proxy; };
                if (p === 'insert') return (pos, s) => { elts.forEach(e => e.insertAdjacentHTML(positions[pos], s)); return proxy; };
                if (p === 'take') return (name, scope) => { applyTake(elts, name, scope); return proxy; };
                if (p === 'toggle') return (name, values) => { elts.forEach(e => applyToggle(name, values, e)); return proxy; };
                if (p === 'attr') return makeAttrProxy(elts);
                if (p === 'data') return elts[0] ? makeDataProxy(elts[0], false) : undefined;
                if (p === 'class') return elts[0] ? makeClassProxy(elts[0]) : undefined;
                if (p === 'closest') return elts[0] ? makeClosestScope(elts[0]) : undefined;
                if (arrayMethods.has(p)) return elts[p].bind(elts);
                if (p === 'aria') return elts[0] ? makeAriaProxy(elts[0], false) : undefined;
                let v = elts[0]?.[p];
                if (typeof v === 'function') return (...a) => elts.map(e => e[p](...a))[0];
                if (v && typeof v === 'object') return qProxy(elts.map(e => e[p]));
                return v;
            },
            set: (_, p, v) => {
                if (p === 'class') elts.forEach(e => setClasses(e, v));
                else elts.forEach(e => e[p] = v);
                schedule();
                return true;
            }
        });
        return proxy;
    }

    let liveQuery, bindPrefixes, bodyAttrs;

    function buildLiveQuery() {
        let mc = htmx.config.metaCharacter || ':';
        let p = htmx.config.prefix;
        bindPrefixes = ['hx-live' + mc];
        if (p) bindPrefixes.push(p + 'live' + mc);
        let extra = htmx.config.live?.bindPrefix;
        if (extra === undefined) {
            if (window.Alpine) {
                extra = '';
                console.warn('hx-live: Alpine.js detected — ":" short-form bindings disabled. Set htmx.config.live.bindPrefix to configure.');
            } else {
                extra = ':';
            }
        }
        if (extra) bindPrefixes.push(extra);
        bodyAttrs = ['hx-live'];
        if (p) bodyAttrs.push(p + 'live');
        let bind = bindPrefixes.map(bp => `starts-with(name(), "${bp}")`).join(' or ');
        let body = bodyAttrs.map(n => `@${n}`).join(' or ');
        liveQuery = new XPathEvaluator().createExpression(`.//*[@*[${bind}] or ${body}]`);
    }

    function extractBindingName(attrName) {
        for (let p of bindPrefixes) {
            if (attrName.startsWith(p) && attrName.length > p.length) return attrName.slice(p.length);
        }
    }

    function cleanupLive(elt) {
        let prop = elt._htmx;
        if (!prop?.liveRuns) return;
        for (let run of prop.liveRuns) fns.delete(run);
        delete prop.liveRuns;
        delete prop.liveRegistered;
        delete prop.liveAttrs;
    }

    function processElement(elt) {
        if (elt.closest('[hx-ignore]')) return;
        let prop = api.htmxProp(elt);
        if (!prop.liveRegistered) {
            let bodyAttr = bodyAttrs.find(n => elt.hasAttribute(n));
            if (bodyAttr) {
                prop.liveRegistered = true;
                ensureActive();
                let code = elt.getAttribute(bodyAttr)
                let debounce = getDebounce(elt);
                let exec;
                let run = async () => {
                    if (!elt.isConnected) {
                        fns.delete(run);
                        return;
                    }
                    try {
                        exec ||= api.executeJavaScript(elt, { debounce }, code, false, true, true);
                        await exec();
                    } catch (e) {
                        if (e !== dbSym) console.error('htmx: hx-live expression threw', e, { elt });
                    }
                };
                fns.add(run);
                prop.liveRuns = prop.liveRuns || new Set();
                prop.liveRuns.add(run);
                run();
            }
        }
        prop.liveAttrs ||= new Set();
        for (let a of elt.attributes) {
            let name = extractBindingName(a.name);
            if (!name || prop.liveAttrs.has(name)) continue;
            prop.liveAttrs.add(name);
            registerSimpleLive(elt, name, a.value);
        }
    }

    function processLive(root) {
        if (!liveQuery) buildLiveQuery();
        if (root.nodeType === 1) processElement(root);
        let iter = liveQuery.evaluate(root), node, nodes = [];
        while (node = iter.iterateNext()) nodes.push(node);
        for (node of nodes) processElement(node);
    }

    function registerSimpleLive(elt, attrName, code) {
        ensureActive();
        let debounce = getDebounce(elt);
        let isAsync = /\bawait\b/.test(code);
        let exec;
        let run = async () => {
            if (!elt.isConnected) {
                fns.delete(run);
                return;
            }
            try {
                exec ||= api.executeJavaScript(elt, { debounce }, code, true, isAsync, true);
                let value = isAsync ? await exec() : exec();
                writeAttrBinding(elt, attrName, value);
                if (isAsync) observer?.takeRecords();
            } catch (e) {
                if (e !== dbSym) console.error('htmx: hx-live expression threw', e, { elt, attr: attrName });
            }
        };
        fns.add(run);
        let prop = api.htmxProp(elt);
        prop.liveRuns = prop.liveRuns || new Set();
        prop.liveRuns.add(run);
        run();
    }

    function writeAttrBinding(elt, attrName, value) {
        if (attrName === 'text') {
            let s = value == null ? '' : String(value);
            if (elt.textContent !== s) elt.textContent = s;
            return;
        }
        if (attrName === 'html') {
            let s = value == null ? '' : String(value);
            if (elt.innerHTML !== s) elt.innerHTML = s;
            return;
        }
        if (attrName === 'style') { applyStyleBinding(elt, value); return; }
        if (attrName === 'class' || attrName.startsWith('.')) {
            applyClassBinding(elt, attrName, value);
            return;
        }
        if (PROPERTY_BINDING_ATTRS.has(attrName)) {
            applyPropertyBinding(elt, attrName, value);
            return;
        }
        // Always write aria-* attrs because their getter and setter types differ.
        if (!attrName.startsWith('aria-') && applyAttr([elt], attrName) === value) return;
        applyAttr([elt], attrName, value);
    }

    let asTargets = t => t == null ? []
        : typeof t === 'string' ? document.querySelectorAll(t)
        : t.nodeType ? [t]
        : t;

    htmx.live = {
        q: s => makeQ(document.documentElement)(s),
        debounce: makeDebounce(),
        refresh: () => schedule(),
        take: (target, name, scope) => applyTake([...asTargets(target)], name, scope),
        toggle: (target, name, values) => [...asTargets(target)].forEach(e => applyToggle(name, values, e)),
        attr: (target, name, ...rest) => applyAttr([...asTargets(target)], name, ...rest),
        forEvent: (...args) => forEvent(null, ...args),
        nextFrame: () => new Promise(r => requestAnimationFrame(r))
    };
    htmx.live.$ = htmx.live.q;

    htmx.registerExtension('hx-live', {
        init: (internalAPI) => {
            api = internalAPI;
        },
        htmx_before_cleanup: (elt) => {
            cleanupLive(elt);
        },
        htmx_before_morph_attr: (elt, detail) => {
            if (bindPrefixes.some(p => detail.attrName.startsWith(p))) cleanupLive(elt);
        },
        htmx_after_process: (elt) => {
            processLive(elt);
        },
        htmx_before_swap: () => {
            swaps++;
        },
        htmx_finally_swap: () => {
            if (--swaps === 0 && fns.size > 0) schedule();
        },
        htmx_scope: (elt, detail) => {
            Object.assign(detail.scope, {
                q: makeQ(elt),
                forEvent: (...args) => forEvent(elt, ...args),
                nextFrame: () => new Promise(r => requestAnimationFrame(r)),
                trigger: (type, detail, bubbles) => htmx.trigger(elt, type, detail, bubbles),
                debounce: getDebounce(elt),
                take: (name, scope) => applyTake([elt], name, scope),
                toggle: (name, values) => applyToggle(name, values, elt),
                attr: makeAttrProxy([elt]),
                insert: (pos, html) => elt.insertAdjacentHTML(positions[pos], html),
                matches: (sel) => elt.matches(sel),
                style: elt.style,
                data: makeDataProxy(elt),
                aria: makeAriaProxy(elt),
                closest: makeClosestScope(elt),
                __hxLive: { q: qProxy([elt]) }
            });
            if (htmx.config.live?.useDollar) detail.scope.$ = detail.scope.q;
            detail.code = scanLive(detail.code);
        }
    });
})();
