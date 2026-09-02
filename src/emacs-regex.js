/**
 * Converts an Emacs-style regular expression into an equivalent JavaScript
 * RegExp. Emacs regexes are "basic" in the POSIX sense with a handful of
 * common extensions: grouping `\( \)`, alternation `\|`, and interval
 * counts `\{n,m\}` all require a backslash to become special -- the bare,
 * unescaped characters `( ) { } |` are ordinary, literal text. This is
 * the single biggest practical difference from JS regex (and from most
 * other regex dialects), and it's exactly what makes plain, unescaped
 * search terms containing parentheses "just work": something a person
 * typing an ordinary phrase relies on without ever thinking about it.
 *
 * Supported constructs:
 *   .  * + ? ^ $  [...] [^...]        -- same meaning as JS
 *   \( \)                              -- grouping (capturing)
 *   \(?: \)                            -- shy (non-capturing) group, real
 *                                          Emacs's own actual syntax for it
 *   \|                                  -- alternation
 *   \{n\} \{n,\} \{n,m\}               -- interval/repeat count
 *   \1 - \9                            -- backreferences
 *   \w \W \s- \sw \b \B                -- word/whitespace/boundary classes
 *   \< \>                              -- start/end of word
 *   \_< \_>                            -- start/end of symbol (word
 *                                          chars plus - and _)
 *   \` \'                              -- start/end of string (Emacs's
 *                                          own "buffer" anchors -- this
 *                                          module always operates on a
 *                                          single string, so buffer and
 *                                          string are the same thing here)
 *   [[:alpha:]] [[:digit:]] [[:alnum:]]
 *   [[:space:]] [[:upper:]] [[:lower:]]
 *   [[:punct:]] [[:word:]]             -- POSIX classes, recognized
 *                                          anywhere inside a [...] class,
 *                                          not just as the class's own
 *                                          sole content
 *
 * Deliberately NOT supported (throws a clear error rather than silently
 * producing a wrong pattern): syntax-table-dependent constructs that have
 * no real string-level equivalent at all (\sc for comment syntax, \s<
 * \s> for comment delimiters, \S- and other negated syntax classes) --
 * these depend on a live buffer's own major-mode syntax table, which
 * doesn't exist in this context; guessing a mapping would be worse than
 * refusing.
 *
 * `^`/`$` are always anchored to line boundaries (JS's own 'm' flag),
 * matching real Emacs's own default behavior in a multi-line buffer --
 * not "start/end of the whole string," which is what JS defaults to.
 * `\`` / `\'` are what map to "the whole string," matching Emacs's own
 * actual distinction between the two.
 */

class EmacsRegexError extends Error {}

const POSIX_CLASSES = {
  alpha: 'a-zA-Z',
  digit: '0-9',
  alnum: 'a-zA-Z0-9',
  space: ' \\t\\n\\r\\f\\v',
  upper: 'A-Z',
  lower: 'a-z',
  punct: '!-/:-@\\[-`{-~',
  word: 'a-zA-Z0-9_',
  blank: ' \\t',
  cntrl: '\\x00-\\x1f',
  xdigit: '0-9a-fA-F',
  graph: '!-~',
  print: ' -~',
};

/** Converts the inside of a `[...]` character class. Emacs's own bracket
 *  syntax mostly matches JS already (a leading `]` or `^]` is a literal
 *  `]`, ranges use `-`, `^` right after `[` negates) -- the one thing
 *  genuinely different is POSIX classes like `[:digit:]`, which can
 *  appear anywhere inside the brackets, not just as the sole content. */
function convertCharClass(inner) {
  let out = '';
  let i = 0;
  while (i < inner.length) {
    if (inner[i] === '[' && inner[i + 1] === ':') {
      const end = inner.indexOf(':]', i + 2);
      if (end !== -1) {
        const name = inner.slice(i + 2, end);
        if (Object.prototype.hasOwnProperty.call(POSIX_CLASSES, name)) {
          out += POSIX_CLASSES[name];
          i = end + 2;
          continue;
        }
        throw new EmacsRegexError(`Unknown POSIX class [:${name}:]`);
      }
    }
    if (inner[i] === ']') {
      out += '\\]';
      i++;
      continue;
    }
    // JS treats these as special inside a class too when unescaped in a
    // position where they'd be ambiguous; Emacs's own literal-inside-
    // brackets behavior for `\` specifically differs (a backslash is NOT
    // an escape character inside an Emacs bracket expression at all --
    // it's a literal backslash), so it's escaped here for JS's sake,
    // not passed through as if it were already an escape sequence.
    if (inner[i] === '\\') {
      out += '\\\\';
      i++;
      continue;
    }
    out += inner[i];
    i++;
  }
  return out;
}

/** The core translation. Walks the pattern once, left to right. */
function translate(pattern) {
  let out = '';
  let i = 0;
  const n = pattern.length;
  let groupDepth = 0;

  while (i < n) {
    const ch = pattern[i];

    if (ch === '[') {
      // Character class: copy through to the matching close bracket,
      // converting only its own contents, then continue the outer scan
      // right after it -- nothing inside a class needs the backslash
      // handling below applied to it (Emacs's own bracket syntax has no
      // escape character inside it at all).
      let j = i + 1;
      let negate = false;
      if (pattern[j] === '^') {
        negate = true;
        j++;
      }
      let start = j;
      if (pattern[j] === ']') j++; // a ] immediately after [ or [^ is a literal member, not the closer
      while (j < n && pattern[j] !== ']') {
        if (pattern[j] === '[' && pattern[j + 1] === ':') {
          const close = pattern.indexOf(':]', j + 2);
          j = close === -1 ? j + 1 : close + 2;
        } else {
          j++;
        }
      }
      if (j >= n) throw new EmacsRegexError('Unterminated character class -- missing ]');
      const inner = pattern.slice(start, j);
      out += '[' + (negate ? '^' : '') + convertCharClass(inner) + ']';
      i = j + 1;
      continue;
    }

    if (ch === '\\') {
      const next = pattern[i + 1];
      if (next === undefined) throw new EmacsRegexError('Trailing backslash at end of pattern');

      if (next === '(') {
        // Emacs's own shy-group syntax is \(?: -- the ? immediately
        // follows the backslash-paren, not the paren alone the way a
        // stray literal "?" would be read anywhere else in the pattern.
        if (pattern[i + 2] === '?' && pattern[i + 3] === ':') {
          out += '(?:';
          i += 4;
        } else {
          out += '(';
          i += 2;
        }
        groupDepth++;
        continue;
      }
      if (next === ')') {
        if (groupDepth === 0) throw new EmacsRegexError('Unmatched \\) with no preceding \\(');
        groupDepth--;
        out += ')';
        i += 2;
        continue;
      }
      if (next === '|') {
        out += '|';
        i += 2;
        continue;
      }
      if (next === '{') {
        const close = pattern.indexOf('\\}', i + 2);
        if (close === -1) throw new EmacsRegexError('Unterminated \\{ interval -- missing \\}');
        const body = pattern.slice(i + 2, close);
        if (!/^\d+(,\d*)?$/.test(body)) throw new EmacsRegexError(`Invalid interval \\{${body}\\}`);
        out += '{' + body + '}';
        i = close + 2;
        continue;
      }
      if (/[1-9]/.test(next)) {
        out += '\\' + next; // backreference -- same bare digit syntax in both dialects
        i += 2;
        continue;
      }
      if (next === 'w') {
        out += '\\w';
        i += 2;
        continue;
      }
      if (next === 'W') {
        out += '\\W';
        i += 2;
        continue;
      }
      if (next === 'b') {
        out += '\\b';
        i += 2;
        continue;
      }
      if (next === 'B') {
        out += '\\B';
        i += 2;
        continue;
      }
      if (next === '<') {
        out += '\\b(?=\\w)';
        i += 2;
        continue;
      }
      if (next === '>') {
        out += '(?<=\\w)\\b';
        i += 2;
        continue;
      }
      if (next === '_' && pattern[i + 2] === '<') {
        out += '(?<![\\w-])(?=[\\w-])';
        i += 3;
        continue;
      }
      if (next === '_' && pattern[i + 2] === '>') {
        out += '(?<=[\\w-])(?![\\w-])';
        i += 3;
        continue;
      }
      if (next === '`') {
        out += '(?<![\\s\\S])';
        i += 2;
        continue;
      }
      if (next === "'") {
        out += '(?![\\s\\S])';
        i += 2;
        continue;
      }
      if (next === 's') {
        const code = pattern[i + 2];
        if (code === '-' || code === ' ') {
          out += '\\s';
          i += 3;
          continue;
        }
        if (code === 'w' || code === '_') {
          out += '\\w';
          i += 3;
          continue;
        }
        throw new EmacsRegexError(`\\s${code || ''} depends on a live buffer's own syntax table and has no equivalent here`);
      }
      if (next === 'S') {
        throw new EmacsRegexError('\\S (negated syntax class) depends on a live buffer\'s own syntax table and has no equivalent here');
      }
      // Anything else escaped (\. \* \+ \? \^ \$ \[ \] \\ and any other
      // character) passes straight through: an escaped metacharacter
      // means the same literal thing in both dialects, and an escaped
      // ordinary letter is Emacs's own way of writing that same literal
      // character (harmless to pass through as an escape in JS too,
      // since \q and 'q' match identically there).
      out += '\\' + next;
      i += 2;
      continue;
    }

    if (ch === '(' || ch === ')' || ch === '{' || ch === '}' || ch === '|') {
      // Unescaped in Emacs = literal text, but special in JS -- escape
      // it so JS treats it the same, literal way.
      out += '\\' + ch;
      i++;
      continue;
    }

    // . * + ? ^ $ [ and every ordinary character mean the same thing
    // unescaped in both dialects (case handled above), or are already
    // consumed by the character-class branch above.
    out += ch;
    i++;
  }

  if (groupDepth > 0) throw new EmacsRegexError('Unmatched \\( with no closing \\)');
  return out;
}

/** Converts an Emacs regular expression string into a native RegExp.
 *  `flags` are the usual JS flags; 'm' is always included so that ^/$
 *  mean "line boundary," matching Emacs's own default in a buffer, and
 *  'i' is NOT added automatically -- case sensitivity is the caller's
 *  own decision (real Emacs's own case-fold-search default varies by
 *  context; callers here should pass 'i' explicitly when they want it).
 *  Throws EmacsRegexError with a specific, human-readable reason for
 *  anything unsupported or malformed, rather than silently miscompiling
 *  a pattern into something that matches the wrong thing. */
function emacsRegexToJs(emacsPattern, flags = '') {
  const translated = translate(emacsPattern);
  const finalFlags = flags.includes('m') ? flags : flags + 'm';
  try {
    return new RegExp(translated, finalFlags);
  } catch (err) {
    throw new EmacsRegexError(`Invalid pattern: ${err.message}`);
  }
}

export { emacsRegexToJs, EmacsRegexError };
