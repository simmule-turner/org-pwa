// @ts-check
/**
 * Smart quotes (`#+OPTIONS: ':t`), as `org-export-activate-smart-quotes` does: every `"` in a run of text toggles a primary quote, and
 * a `'` inside an open primary quote is an opening or closing secondary quote by the characters around it, otherwise an apostrophe. The quotes
 * are Org's `org-export-smart-quotes-alist` for LaTeX; a language without an entry (or an apostrophe with none) keeps the plain character.
 */

/** @typedef {'latex' | 'html' | 'utf8'} QuoteTarget */
/** @typedef {Record<string, Partial<Record<QuoteTarget, string | null>>>} QuoteSet */

/** Org's `org-export-smart-quotes-alist`, generated from Emacs 29.3: per language, each kind of quote spelled for LaTeX, HTML and UTF-8. @type {Record<string, QuoteSet>} */
const QUOTES = {
 "ar": {
  "po": {
   "latex": "\\guillemotleft{}",
   "html": "&laquo;",
   "utf8": "«"
  },
  "pc": {
   "latex": "\\guillemotright{}",
   "html": "&raquo;",
   "utf8": "»"
  },
  "so": {
   "latex": "\\guilsinglleft{}",
   "html": "&lsaquo;",
   "utf8": "‹"
  },
  "sc": {
   "latex": "\\guilsinglright{}",
   "html": "&rsaquo;",
   "utf8": "›"
  },
  "ap": {
   "latex": null,
   "html": "&rsquo;",
   "utf8": "’"
  }
 },
 "da": {
  "po": {
   "latex": ">>",
   "html": "&raquo;",
   "utf8": "»"
  },
  "pc": {
   "latex": "<<",
   "html": "&laquo;",
   "utf8": "«"
  },
  "so": {
   "latex": "\\frq{}",
   "html": "&rsaquo;",
   "utf8": "›"
  },
  "sc": {
   "latex": "\\flq{}",
   "html": "&lsaquo;",
   "utf8": "‹"
  },
  "ap": {
   "latex": null,
   "html": "&rsquo;",
   "utf8": "’"
  }
 },
 "de": {
  "po": {
   "latex": "\"`",
   "html": "&bdquo;",
   "utf8": "„"
  },
  "pc": {
   "latex": "\"'",
   "html": "&ldquo;",
   "utf8": "“"
  },
  "so": {
   "latex": "\\glq{}",
   "html": "&sbquo;",
   "utf8": "‚"
  },
  "sc": {
   "latex": "\\grq{}",
   "html": "&lsquo;",
   "utf8": "‘"
  },
  "ap": {
   "latex": null,
   "html": "&rsquo;",
   "utf8": "’"
  }
 },
 "el": {
  "po": {
   "latex": "\\guillemotleft{}",
   "html": "&laquo;",
   "utf8": "«"
  },
  "pc": {
   "latex": "\\guillemotright{}",
   "html": "&raquo;",
   "utf8": "»"
  },
  "so": {
   "latex": "``",
   "html": "&ldquo;",
   "utf8": "“"
  },
  "sc": {
   "latex": "''",
   "html": "&rdquo;",
   "utf8": "”"
  },
  "ap": {
   "latex": null,
   "html": "&rsquo;",
   "utf8": "’"
  }
 },
 "en": {
  "po": {
   "latex": "``",
   "html": "&ldquo;",
   "utf8": "“"
  },
  "pc": {
   "latex": "''",
   "html": "&rdquo;",
   "utf8": "”"
  },
  "so": {
   "latex": "`",
   "html": "&lsquo;",
   "utf8": "‘"
  },
  "sc": {
   "latex": "'",
   "html": "&rsquo;",
   "utf8": "’"
  },
  "ap": {
   "latex": null,
   "html": "&rsquo;",
   "utf8": "’"
  }
 },
 "es": {
  "po": {
   "latex": "\\guillemotleft{}",
   "html": "&laquo;",
   "utf8": "«"
  },
  "pc": {
   "latex": "\\guillemotright{}",
   "html": "&raquo;",
   "utf8": "»"
  },
  "so": {
   "latex": "``",
   "html": "&ldquo;",
   "utf8": "“"
  },
  "sc": {
   "latex": "''",
   "html": "&rdquo;",
   "utf8": "”"
  },
  "ap": {
   "latex": null,
   "html": "&rsquo;",
   "utf8": "’"
  }
 },
 "fa": {
  "po": {
   "latex": "\\guillemotleft{}",
   "html": "&laquo;",
   "utf8": "«"
  },
  "pc": {
   "latex": "\\guillemotright{}",
   "html": "&raquo;",
   "utf8": "»"
  },
  "so": {
   "latex": "\\guilsinglleft{}",
   "html": "&lsaquo;",
   "utf8": "‹"
  },
  "sc": {
   "latex": "\\guilsinglright{}",
   "html": "&rsaquo;",
   "utf8": "›"
  },
  "ap": {
   "latex": null,
   "html": "&rsquo;",
   "utf8": "’"
  }
 },
 "fr": {
  "po": {
   "latex": "\\og ",
   "html": "&laquo;&nbsp;",
   "utf8": "« "
  },
  "pc": {
   "latex": "\\fg{}",
   "html": "&nbsp;&raquo;",
   "utf8": " »"
  },
  "so": {
   "latex": "``",
   "html": "&ldquo;",
   "utf8": "“"
  },
  "sc": {
   "latex": "''",
   "html": "&rdquo;",
   "utf8": "”"
  },
  "ap": {
   "latex": null,
   "html": "&rsquo;",
   "utf8": "’"
  }
 },
 "is": {
  "po": {
   "latex": "\"`",
   "html": "&bdquo;",
   "utf8": "„"
  },
  "pc": {
   "latex": "\"'",
   "html": "&ldquo;",
   "utf8": "“"
  },
  "so": {
   "latex": "\\glq{}",
   "html": "&sbquo;",
   "utf8": "‚"
  },
  "sc": {
   "latex": "\\grq{}",
   "html": "&lsquo;",
   "utf8": "‘"
  },
  "ap": {
   "latex": null,
   "html": "&rsquo;",
   "utf8": "’"
  }
 },
 "it": {
  "po": {
   "latex": "``",
   "html": "&ldquo;",
   "utf8": "“"
  },
  "pc": {
   "latex": "''",
   "html": "&rdquo;",
   "utf8": "”"
  },
  "so": {
   "latex": "`",
   "html": "&lsquo;",
   "utf8": "‘"
  },
  "sc": {
   "latex": "'",
   "html": "&rsquo;",
   "utf8": "’"
  },
  "ap": {
   "latex": null,
   "html": "&rsquo;",
   "utf8": "’"
  }
 },
 "no": {
  "po": {
   "latex": "\\guillemotleft{}",
   "html": "&laquo;",
   "utf8": "«"
  },
  "pc": {
   "latex": "\\guillemotright{}",
   "html": "&raquo;",
   "utf8": "»"
  },
  "so": {
   "latex": "`",
   "html": "&lsquo;",
   "utf8": "‘"
  },
  "sc": {
   "latex": "'",
   "html": "&rsquo;",
   "utf8": "’"
  },
  "ap": {
   "latex": null,
   "html": "&rsquo;",
   "utf8": "’"
  }
 },
 "nb": {
  "po": {
   "latex": "\\guillemotleft{}",
   "html": "&laquo;",
   "utf8": "«"
  },
  "pc": {
   "latex": "\\guillemotright{}",
   "html": "&raquo;",
   "utf8": "»"
  },
  "so": {
   "latex": "`",
   "html": "&lsquo;",
   "utf8": "‘"
  },
  "sc": {
   "latex": "'",
   "html": "&rsquo;",
   "utf8": "’"
  },
  "ap": {
   "latex": null,
   "html": "&rsquo;",
   "utf8": "’"
  }
 },
 "nn": {
  "po": {
   "latex": "\\guillemotleft{}",
   "html": "&laquo;",
   "utf8": "«"
  },
  "pc": {
   "latex": "\\guillemotright{}",
   "html": "&raquo;",
   "utf8": "»"
  },
  "so": {
   "latex": "`",
   "html": "&lsquo;",
   "utf8": "‘"
  },
  "sc": {
   "latex": "'",
   "html": "&rsquo;",
   "utf8": "’"
  },
  "ap": {
   "latex": null,
   "html": "&rsquo;",
   "utf8": "’"
  }
 },
 "ro": {
  "po": {
   "latex": "\"`",
   "html": "&bdquo;",
   "utf8": "„"
  },
  "pc": {
   "latex": "''",
   "html": "&rdquo;",
   "utf8": "”"
  },
  "so": {
   "latex": "\\guillemotleft{}",
   "html": "&laquo;",
   "utf8": "«"
  },
  "sc": {
   "latex": "\\guillemotright{}",
   "html": "&raquo;",
   "utf8": "»"
  },
  "ap": {
   "latex": null,
   "html": "&rsquo;",
   "utf8": "’"
  }
 },
 "ru": {
  "po": {
   "latex": "{}<<",
   "html": "&laquo;",
   "utf8": "«"
  },
  "pc": {
   "latex": ">>{}",
   "html": "&raquo;",
   "utf8": "»"
  },
  "so": {
   "latex": "\\glqq{}",
   "html": "&bdquo;",
   "utf8": "„"
  },
  "sc": {
   "latex": "\\grqq{}",
   "html": "&ldquo;",
   "utf8": "“"
  },
  "ap": {
   "latex": null,
   "html": null,
   "utf8": "’"
  }
 },
 "sl": {
  "po": {
   "latex": "{}<<",
   "html": "&laquo;",
   "utf8": "«"
  },
  "pc": {
   "latex": ">>{}",
   "html": "&raquo;",
   "utf8": "»"
  },
  "so": {
   "latex": "\\glqq{}",
   "html": "&bdquo;",
   "utf8": "„"
  },
  "sc": {
   "latex": "\\grqq{}",
   "html": "&ldquo;",
   "utf8": "“"
  },
  "ap": {
   "latex": null,
   "html": "&rsquo;",
   "utf8": "’"
  }
 },
 "sv": {
  "po": {
   "latex": "’’",
   "html": "&rdquo;",
   "utf8": "”"
  },
  "pc": {
   "latex": "’’",
   "html": "&rdquo;",
   "utf8": "”"
  },
  "so": {
   "latex": "’",
   "html": "&rsquo;",
   "utf8": "’"
  },
  "sc": {
   "latex": "’",
   "html": "&rsquo;",
   "utf8": "’"
  },
  "ap": {
   "latex": null,
   "html": "&rsquo;",
   "utf8": "’"
  }
 }
};

/** The syntax class Org's syntax table gives a character: whitespace, open or close bracket, word, symbol, punctuation or string quote. @param {string} c */
function syntaxClass(c) {
  if (c === '"') return 'q';
  if (/[\s\u00a0]/.test(c)) return ' ';
  if (/[([{<]/.test(c)) return '(';
  if (/[)\]}>]/.test(c)) return ')';
  if (/[\p{L}\p{N}$%']/u.test(c)) return 'w';
  if (/[&*+\-/=\\_|~\p{Sc}\p{Sm}\p{Sk}\p{So}]/u.test(c)) return '_';
  return '.';
}

/**
 * What each quote character in each text node of one run of siblings is: `po`, `pc`, `so`, `sc` or `ap` (apostrophe), in reading order.
 * @param {{ type: string, value?: string }[]} list
 * @returns {Map<object, string[]>}
 */
export function quoteStatuses(list) {
  /** @type {Map<object, string[]>} */
  const out = new Map();
  let open = false;
  list.forEach((n, i) => {
    if (n.type !== 'text' || typeof n.value !== 'string') return;
    const text = n.value;
    /** @type {string[]} */
    const status = [];
    for (let at = 0; at < text.length; at++) {
      const ch = text[at];
      if (ch !== '"' && ch !== "'") continue;
      if (ch === '"') {
        open = !open;
        status.push(open ? 'po' : 'pc');
      } else if (!open) status.push('ap');
      else {
        const previous = at > 0 ? text[at - 1] : i > 0 ? 'no-blank' : null;
        const next = at + 1 < text.length ? text[at + 1] : i + 1 < list.length ? 'no-blank' : null;
        const p = previous === null || previous === 'no-blank' ? previous : syntaxClass(previous);
        const x = next === null || next === 'no-blank' ? next : syntaxClass(next);
        const allowOpen = (typeof p === 'string' && p.length === 1 ? 'q ('.includes(p) : p === null) && (typeof x === 'string' && x.length === 1 ? 'w._'.includes(x) : x === 'no-blank');
        const allowClose = (typeof p === 'string' && p.length === 1 ? 'w._'.includes(p) : p === 'no-blank') && (typeof x === 'string' && x.length === 1 ? ' ).q'.includes(x) : x === null);
        status.push(allowOpen ? 'so' : allowClose ? 'sc' : 'ap');
      }
    }
    if (status.length) out.set(n, status);
  });
  return out;
}

/** The text with its quotes replaced. @param {string} text @param {string[]} status @param {string} language @param {QuoteTarget} [target] */
export function smartQuotes(text, status, language, target = 'latex') {
  const set = QUOTES[language];
  let k = 0;
  return text.replace(/['"]/g, (m) => {
    const kind = status[k++];
    const entry = set && set[kind];
    return (entry && entry[target]) || m;
  });
}
