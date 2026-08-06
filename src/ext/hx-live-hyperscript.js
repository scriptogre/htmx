// hx-live-hyperscript extension: hyperscript-flavored sugar for hx-live expressions.
// Rewrites source into plain hx-live code before it compiles. Requires hx-live.
// Hooks:
//   htmx:scope          rewrite sigils and selector literals in the expression
(() => {
    let CODE = new RegExp([
        /\/\/.*/,                                            // line comment
        /\/\*[\s\S]*?\*\//,                                  // block comment
        /'(?:[^'\\]|\\.)*'/,                                 // single-quoted string
        /"(?:[^"\\]|\\.)*"/,                                 // double-quoted string
        /\/(?:\\.|\[(?:\\.|[^\]])*\]|[^\/\\\n[])+\/[a-z]*/,  // regex literal
        /[@^]\.?[A-Za-z][\w-]*\*?/,                          // @ and ^ attribute sigils
        /<[^<\n]*?\/>/,                                      // query literal
        /#[A-Za-z_][\w-]*/,                                  // id selector
        /[\w$]+/,                                            // identifier or number
        /\S/                                                 // any other character
    ].map(part => part.source).join('|'), 'g');
    let TEMPLATE_TEXT = /(?:\\.|\$(?!\{)|[^`\\$])*(`|\$\{|$)/y;
    let TOGGLE_OR_TAKE_CALL = /\b(?:toggle|take)\(\s*$/;
    // `class` is a reserved word, so only property access on it is rewritten.
    // The bare `class = {...}` object-assignment form was removed in favor of
    // class.assign({...}); it now stays a reserved word and fails to parse.
    let CLASS_ACCESS = /^\s*[.[]/;
    let ENDS_VALUE = /^(?:[\w$]+|[)\]}v])$/;
    let POSSESSIVE = /^'s[\s@]/;
    let REGEX_WORDS = new Set(['return', 'typeof', 'instanceof', 'in', 'of', 'new', 'delete', 'void', 'throw', 'case', 'do', 'else', 'yield', 'await']);

    // The rewrite targets public hx-live surface only, so `q` must resolve to
    // hx-live's q(). Anything that shadows it also shadows the sugar.
    let SELF = '__hxLiveQ(this)';

    function kebabToCamel(s) {
        return s.replace(/-([a-z0-9])/g, (_, c) => c.toUpperCase());
    }

    function member(key) {
        return /^[A-Za-z_$][\w$]*$/.test(key) ? '.' + key : `[${JSON.stringify(key)}]`;
    }

    function find(selector) {
        return `__hxLiveQ(${JSON.stringify(selector)})`;
    }

    // '@aria-expanded' -> 'q(this).aria.expanded', '@.active' -> 'q(this).class.active'.
    // After a dot (q('#x').@hidden) the base is that proxy, not this.
    function sigilCode(name, afterDot, cascades) {
        let root = (afterDot ? '' : SELF + '.') + (cascades ? 'closest.' : '');
        if (name === 'class') return root + 'class';
        if (name[0] === '.') return root + 'class' + member(name.slice(1));
        if (name.endsWith('-*')) return root + name.slice(0, -2);
        if (name.startsWith('aria-')) return root + 'aria' + member(name.slice(5));
        if (name.startsWith('data-')) return root + 'data' + member(kebabToCamel(name.slice(5)));
        return root + 'attr' + member(name);
    }

    function rewrite(src) {
        if (!/[@^#<]|'s|\bclass\b/.test(src)) return src;
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
            } else if (POSSESSIVE.test(src.slice(match.index, match.index + 3)) && ENDS_VALUE.test(prev) && !REGEX_WORDS.has(prev)) {
                // A string never follows a value in valid JS, so this `'s` is possessive.
                out += '.';
                i = match.index + 2;
                prev = '.';
            } else if (token[0] === '/' && token.length > 1 && ENDS_VALUE.test(prev) && !REGEX_WORDS.has(prev)) {
                out += '/';  // division, not a regex: re-read from the next character
                i = match.index + 1;
                prev = '/';
            } else if (token[0] === '^' && ENDS_VALUE.test(prev) && !REGEX_WORDS.has(prev)) {
                out += '^';
                i = match.index + 1;
                prev = '^';
            } else if (token[0] === '<' && token.length > 1) {
                // `<` is only ever binary in JS, so a value before it rules out a query literal.
                if (ENDS_VALUE.test(prev) && !REGEX_WORDS.has(prev)) {
                    out += '<';
                    i = match.index + 1;
                    prev = '<';
                } else {
                    out += find(token.slice(1, -2).trim());
                    prev = 'v';
                }
            } else if (token[0] === '#') {
                out += find(token);
                prev = 'v';
            } else if (token[0] === '@' || token[0] === '^') {
                let name = token.slice(1);
                let afterDot = prev === '.' && !out.endsWith('...');
                out += TOGGLE_OR_TAKE_CALL.test(out)
                    ? `'${name}'`
                    : sigilCode(name, afterDot, token[0] === '^');
                prev = 'v';
            } else if (token === 'class' && prev !== '.' && CLASS_ACCESS.test(src.slice(i))) {
                out += SELF + '.class';
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

    htmx.registerExtension('hx-live-hyperscript', {
        htmx_scope: (elt, detail) => {
            if (!detail.scope.q) {
                console.warn('htmx: hx-live-hyperscript needs the hx-live extension.', { elt });
                return;
            }
            detail.scope.__hxLiveQ = detail.scope.q;
            detail.code = rewrite(detail.code);
        }
    });
})();
