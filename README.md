# org-pwa

A single-file, offline-capable, mobile-first outliner for editing `.org` files in the browser. No server, no account required to use it locally — just a static site you can install as a PWA and point at a file.

This document describes what org-pwa actually does today, how to use it, and — since that's usually the more useful question for anyone coming from Emacs — **where it deliberately or incidentally diverges from real org-mode.**

---

## Contents

- [What org-pwa is (and isn't)](#what-org-pwa-is-and-isnt)
- [Getting started](#getting-started)
- [Editing your outline](#editing-your-outline)
- [Undo/redo and History](#undoredo-and-history)
- [Lists, tables, and body text](#lists-tables-and-body-text)
- [Inline text markup](#inline-text-markup)
- [Searching](#searching)
- [Links and images](#links-and-images)
- [Folding and `#+STARTUP`](#folding-and-startup)
- [Local Variables](#local-variables)
- [Archiving](#archiving)
- [The plain-text editor](#the-plain-text-editor)
- [Agenda](#agenda)
- [TODO view](#todo-view)
- [Capture Templates](#capture-templates)
- [Docs](#docs)
- [File management](#file-management)
- [Export](#export)
- [Settings](#settings)
- [Offline behavior and sync](#offline-behavior-and-sync)
- [Platform support](#platform-support)
- [Keybindings](#keybindings)
- [Differences from Emacs org-mode](#differences-from-emacs-org-mode)
- [Known limitations / not built yet](#known-limitations--not-built-yet)
- [Development](#development)

---

## What org-pwa is (and isn't)

org-pwa is a **touch-first outline editor**, not a port of Emacs. It reads and writes real `.org` files — round-trip fidelity is a hard requirement, so content it doesn't specifically understand is preserved verbatim rather than mangled or dropped. But the *editing model* is built from scratch around tapping and gestures, not Emacs keybindings, and it deliberately implements a useful subset of org-mode rather than all of it.

If you're looking for org-mode-in-the-browser with full parity — babel, capture templates, the agenda, LaTeX export — this isn't that (yet, and possibly not ever; see [Known limitations](#known-limitations--not-built-yet)). If you want to open a real org file on your phone, reorganize your outline, check off tasks, edit tables, and get it saved back to disk, GitHub, or a WebDAV server, that's what this is for.

---

## Getting started

1. Open the app. If no file is open, tap **File → Open**.
2. Choose where to open from:
   - **Local file** — uses the browser's native file picker and keeps a live handle, so Save writes straight back to the same file. Requires a browser with File System Access support (Chrome/Edge on desktop and Android).
   - **GitHub** — browse folders and `.org` files in a repo you've configured in Settings, tap one to open it. A "Type a path instead…" option is always available too, for a path that doesn't show up in the listing (e.g. permissions on a specific subfolder) or if listing fails outright.
   - **WebDAV** — same idea, browsing a WebDAV server you've configured in Settings via the standard `PROPFIND` directory-listing method. Same "Type a path instead…" fallback available here too.
   - **Import file** (shown instead of "Local file" on platforms without File System Access, i.e. everything on iOS) — picks a file once and reads it; there's no live link back to the original, so Save downloads a new copy you place back manually. See [Platform support](#platform-support).
3. Edit. Every edit is applied instantly to an in-memory copy and cached locally in the background — nothing is lost if you close the tab, even before you hit Save.
4. Tap **Save** when you want it written back to wherever it came from. **Save As** lets you choose a different destination or backend.

The header shows the current filename and which backend it came from, turning **red** whenever there are edits that haven't been saved yet (normal color otherwise).

---

## Editing your outline

- **Headings**: tap the title text to reveal a row of twelve actions — edit title, edit the heading's own body text, edit details (the general editor — see below), add a sub-heading, move up/down, mark as TODO, add a table, archive, delete, promote/demote. Nothing is shown until you tap; this keeps the row itself uncluttered. Most actions close the row back up after running; Move up/down and Promote/Demote deliberately don't, since repeating one of those a few times in a row is a normal thing to want to do — tap elsewhere on the row (or in the empty space after the buttons themselves) to close it manually when you're done.
- **TODO state**: tap the TODO badge to cycle through the sequence defined by `#+TODO:` (or `TODO`/`DONE` by default).
- **Fold/unfold**: tap the chevron to toggle a heading's whole subtree, or swipe left on a heading to cycle through collapsed → children-only → fully expanded → collapsed.
- **Archive** (becomes **Unarchive** once a heading is already archived, a different icon for each): moves the whole subtree to its configured `org-archive-location`, or back to its original location — real org's `org-archive-subtree`, not just a tag added in place. Confirms first by default (`org-archive-confirm`, see [Local Variables](#local-variables)). See [Archiving](#archiving) for the full behavior, the `org-archive-location` syntax, the transaction-safety guarantee, and the platform limitation for local files. The `:ARCHIVE:` tag and `ARCHIVE_TIME`/`ARCHIVE_FILE`/`ARCHIVE_OLPATH`/`ARCHIVE_CATEGORY` properties are all still just an ordinary tag and ordinary properties once the move lands — editable or removable by hand from the general editor like any other, if you ever need to.
- **The general editor** (📋 **Edit details**): one structured form covering everything that used to be spread across several separate actions:
  - **SCHEDULED / DEADLINE / plain timestamp** — real date and time pickers, a repeat selector (mark + amount + unit: every N hours/days/weeks/months/years), and an optional "warn ahead by" delay (real org syntax, e.g. `-3d`, for seeing a deadline coming a few days early instead of only on the day it's due). These three are independent instances of the same field group — set any combination; each has its own **Clear** button for explicitly removing that one timestamp, separate from the form's overall Save/Cancel. See [Agenda](#agenda) for how a plain timestamp differs from SCHEDULED/DEADLINE (it doesn't carry forward, and lives in the title rather than a planning line).
  - **Tags** — existing tags shown as removable chips (tap a chip to remove it), plus an input and Add button for a new one. Not a raw space-separated prompt.
  - **Priority** — a row of buttons (A / B / C / None), the currently-set one highlighted. Covers real org's own conventional default range directly with one tap; anything outside A–C isn't reachable from this UI, a stated scope limit rather than a full A–Z picker for a rarely-used case.
  - **Properties** — each existing property as its own editable key/value row, with a per-row remove button and an "Add property" row to append a new, initially-blank one. A row left with a blank key is silently dropped on save rather than erroring — "I tapped Add then changed my mind" is a normal path, not a mistake to flag. This is also how you set a `CUSTOM_ID` for `[[#id]]`-style linking (see [Links and images](#links-and-images)) — there's no longer a dedicated action just for that, since it's a property like any other.

  All fields across all four sections are committed together on **Save**, or discarded together on **Cancel** — nothing is written until you actually save. When not editing, existing properties still show as a small read-only line under the heading, but only when drawers are actually visible for that heading (`#+STARTUP: showeverything`, or manually cycled to "fully expanded" — see [Folding and `#+STARTUP`](#folding-and-startup)); tapping it opens the same general editor as tapping the title. Collapsing the heading again correctly hides them too, whether via swipe or chevron.
- **Block content** (`#+BEGIN_SRC`/`#+BEGIN_QUOTE`/`#+BEGIN_EXAMPLE`/etc.): shown read-only, gated by the same drawer-visibility rule as properties above. When folded, an honest "collapsed block" label is shown rather than nothing — tap it to reveal the actual content (code, quoted text, whatever the block holds); tap the label again once expanded to re-fold it. No in-app editing of block content yet — this is visibility only.
- **Moving headings** (↑ / ↓ / ← / → in the action row): ↑ and ↓ reorder a heading among its own siblings without touching its level or its subtree — everything nested under it moves as one unit automatically. ← (promote/outdent) moves a heading up one level, making it a sibling of its former parent, inserted right after it. → (demote/indent) moves it down one level, making it the last child of whichever heading immediately precedes it. All four are no-ops at a natural boundary (already first/last, already top-level, no preceding sibling to demote under) — tapping one there shows a brief status message rather than silently doing nothing or corrupting the outline. This is the actual replacement for switching to Text view and cutting/pasting raw lines, which used to be the only way to reorder anything.

### A heading's "text"

Org has no separate description field — anything following a heading (until the next heading) belongs to it, and that can include multiple paragraphs, lists, and tables in any order. The **Edit text** action opens all of that heading's content as one editable block of raw org syntax, not just the first paragraph. Typing `- [ ] ` at the start of a line turns it into a checklist item on save, exactly as it would in the underlying file.

---

## Undo/redo and History

Every edit in this app — heading/paragraph/list-item/table-cell text, TODO/priority/tags/properties, moving, promoting, archiving, capturing, all of it — can be undone and redone. **More (\u22ee) \u2192 History** opens a panel with three things: quick **\u2039 Undo** / **Redo \u203a** buttons for stepping one change at a time, a scrollable list of every step taken since the file was opened (oldest to newest, with the current position marked), and a **diff** toggle on each entry showing exactly what that one step changed \u2014 added lines and removed lines, color-coded, diffed against the step right before it.

The list isn't just for stepping through one at a time \u2014 tap **any** entry to jump straight there, forward or back, skipping however many steps are in between. Entries past your current position (available to redo) show dimmer than the ones already applied. Making a genuinely new edit from a point you'd undone to discards whatever was ahead of it, the same way undo/redo works in virtually every editor \u2014 but simply *browsing* the history list, including jumping backward and then forward again, never discards anything.

**How it's built, and the trade-offs that come with it**: each step is a full snapshot of the document's text at that point, not a record of "how to reverse this specific edit." That's what makes undo comprehensive here \u2014 every edit type gets it for free, rather than each of this app's many different edit operations needing its own individually-implemented undo and redo. The trade-off is granularity: one step per *completed* edit action (finishing typing in a title and tapping away, toggling a checkbox, archiving a heading), not per keystroke \u2014 matching how this app already treats a "finished edit" everywhere else (a title commits on blur, not per character). An edit that turns out not to have changed anything at all (toggling something and toggling it back) doesn't get its own step, so the list doesn't fill up with no-ops.

**Scope, stated plainly**: history is kept for as long as the current file stays open \u2014 unlimited steps, no cap, by explicit design choice \u2014 and is **not** persisted or carried over if you close the file and reopen it later. That's a deliberate simplification, not an oversight: trying to make old undo history meaningful against a file that may have changed on disk since it was last open is real complexity for a benefit that's mostly invisible day to day. Undoing or redoing also doesn't try to preserve exactly how things were folded/collapsed across the jump \u2014 it reapplies the file's own `#+STARTUP` visibility fresh each time, the same as reopening the file or switching documents already does elsewhere in this app.

---

## Lists, tables, and body text

- **Lists**: ordered, unordered, checkboxes (tap to cycle unchecked → in-progress → done), description lists (`term :: description`), and nested sub-lists. Tap a list item's text to reveal edit/add-item-below/delete actions.
- **Checkboxes**: cycle through the three states org supports. Progress cookies in a heading's title (`[3/8]` or `[40%]`, including the blank `[/]`/`[/8]` form) are recalculated automatically whenever a checkbox in that heading's subtree is toggled, added, or removed — matching real org-mode's default hierarchical counting (a heading's cookie counts checkboxes in its own list *and* every descendant heading's, not just its direct list).
- **Tables**: tap a cell to edit it directly. Row/column add and remove controls sit below the table, always visible (not tap-to-reveal, since you need them to actually use the table). `#+TBLFM:` formula lines are preserved on save but **not evaluated** — org-pwa doesn't compute tables, Emacs does.
- **Paragraphs**: tap text to reveal edit/add-paragraph-below/delete.

Every delete action still asks for confirmation — but is no longer irreversible: **Undo/redo now covers every edit in this app** (see [Undo/redo and History](#undoredo-and-history)).

---

## Inline text markup

All six of org's emphasis markers work, in headings, paragraphs, and list items:

| Markup | Syntax | Renders as |
|---|---|---|
| Bold | `*bold text*` | **bold text** |
| Italic | `/italic text/` | *italic text* |
| Underline | `_underline text_` | underlined |
| Strikethrough | `+strikethrough text+` | ~~strikethrough text~~ |
| Verbatim | `=verbatim text=` | `verbatim text` (literal, not further parsed) |
| Code | `~code text~` | `code text` (literal, not further parsed) |

A marker only opens where it's preceded by the start of a line, whitespace, or one of `-({'"`, and not immediately followed by whitespace; it only closes where it's not immediately preceded by whitespace, and is followed by the end of the line, whitespace, or closing punctuation — matching real org's own border rules for the common cases, not a full reproduction of org's complete border-character tables. Bold/italic/underline/strikethrough nest inside each other (`*bold /italic/ bold*` works); verbatim and code never do — their content is always literal, exactly matching org's own rule that these must be the innermost markers.

**Horizontal rule**: a line consisting of only dashes, at least 5 of them (`-----`), renders as a horizontal rule. Whitespace around the dashes is fine; anything else on the line (a 6th character that isn't a dash) means it's just a paragraph, not a rule.

**Subscript and superscript**: `_` and `^` mark sub/superscript — `x_i` and `x^2` both work without braces, and braces (`x_{alpha}`, `10^{100}`) are always accepted too, mainly useful for readability once the script itself is more than a couple of characters. Controlled by `org-use-sub-superscripts` (see [Local Variables](#local-variables)):

| Value | Behavior |
|---|---|
| `t` (default) | Both `x_i` and `x_{i}` are interpreted |
| `{}` | Only the braced form `x_{i}` is interpreted; a bare `x_i` stays literal text |
| `nil` | Disabled entirely; `_`/`^` are always literal characters |

`_` doubles as both the underline marker and the subscript marker — org's own overload, not a conflict introduced here. The two are disambiguated by what comes immediately before the `_`: underline needs whitespace/start-of-line/certain punctuation before it (`_underlined_`), subscript needs a non-whitespace character immediately before it (`a_b`) — the opposite condition, so in practice they essentially never collide. Sub/superscript content is always literal — `x_{*bold*}` doesn't further interpret the `*bold*` inside it, the same way verbatim/code content doesn't.

Table cells currently render as plain text — none of the markup on this page is interpreted inside a table cell yet.

---

## Searching

Tap **More → Search** to search the whole file — headings, tags, TODO keyword, priority, properties (key or value), SCHEDULED/DEADLINE timestamps, paragraphs, list items, table cells, and block content, case-insensitively. Results update live as you type and show a short snippet with the match, grouped under the heading each one belongs to.

Search looks at the entire document regardless of current fold state — a match inside a collapsed heading, inside body text hidden by `#+STARTUP: content`, or inside properties/block content folded by `#+STARTUP: showall`, still shows up. Tapping a result expands whatever's necessary to actually reveal it (including the target heading's own body and, for a property or block match, its drawers too — not just its ancestors) and scrolls to it with a brief highlight.

**Regex mode**: the **Regex** button next to the search box switches from plain substring matching to a real regular expression, case-insensitive either way. Off (the default) is a literal, "find this exact text" search — a query containing `.` or `(` matches that character literally, with no escaping needed, which is what most searches actually want. On, the query is compiled as a JavaScript RegExp; an invalid pattern shows a clear error message in the results area rather than crashing or silently showing "no matches," so a mistyped pattern and a genuinely empty result set are never confused for each other.

**Filter tokens**: the same search box also recognizes a small set of structured tokens — a persistent hint (`Hints: +tag  -tag  todo:X  priority:A  key:value`), right-justified on the same line as the **Regex** button, so this doesn't have to be memorized. They combine with each other and with any leftover plain text as an implicit AND:

- **`+tag`** — heading must have this tag
- **`-tag`** — heading must NOT have this tag
- **`todo:KEYWORD`** — heading's TODO state must equal this exactly (case-insensitive) — e.g. `todo:WAITING`
- **`priority:X`** — heading's priority must equal this exactly (case-insensitive) — e.g. `priority:A`
- **`key:value`** — anything else in `key:value` form matches a property named `key` whose value contains `value` (substring, case-insensitive) — e.g. `spouse:Jennifer`

Example: `+work todo:WAITING budget` — tagged `work`, in WAITING state, and containing "budget" somewhere. A pure filter query with no leftover text (`+work -someday`) returns the matching headings directly, one result each, rather than needing something to highlight.

This is **deliberately not a faithful subset of real org-mode's own search**, which is actually several separate, fragmented tools — sparse trees (`C-c /`, several sub-commands), a real boolean match-syntax with `&`/`|`/exact `=` matching for custom searches, and `org-search-view` as yet another, separate command. Reproducing that fragmentation felt like importing a limitation of Emacs's keybinding-driven UI rather than a strength worth preserving; one unified box that reaches tags/TODO/priority/properties *and* free text together, with simpler AND-only combining and `key:value` instead of quoted `=` (fewer shift-key characters on a phone keyboard for the same meaning), is the deliberate tradeoff made here. Concretely out of scope: no OR/boolean logic, no exact property-value matching (always substring), and no sparse-tree-style refolding of the buffer to show matches in structural context — this produces a flat results list instead.

**Known, accepted parsing ambiguity**: a word that happens to start with `+`/`-` (a negative number, a hyphenated word) or matches the `word:word` shape (most commonly a `mailto:` link) can get read as a filter token instead of literal text. `http://` and `https://` URLs are specifically excluded from this, since they're the single most likely false positive — `see https://example.com` searches correctly as free text — but the general case isn't fully avoidable in a single combined box, and is a stated tradeoff rather than a bug to report.

Tags and properties are read from a heading's own line only — **no inheritance from ancestor headings**, unlike real org's default behavior of a child heading inheriting its parents' tags. A parent tagged `:work:` doesn't make an untagged child match `+work`.

---

## Links and images

- **`[[target][description]]`** links render as tappable text.
- **A bare URL auto-links too**, matching real org's own documented behavior — `https://example.com` typed directly in a sentence (no `[[...]]` brackets at all) renders as a tappable link, same as the bracketed form. `<https://example.com>` (angle-bracket wrapped) works the same way, and is org's other recognized plain-URI form. Recognized schemes: `http`, `https`, `ftp`, `mailto`, `doi`, `file`, `github`, `webdav` — a well-defined set, not arbitrary `word:word` text (so a time like `10:30` or a ratio like `3:4` is never misread as a link). Trailing sentence punctuation (`.`, `,`, `)`, etc.) is excluded from a bare match — `see https://example.com/page.` links just the URL, not the period; wrap it in `<...>` or `[[...]]` if a URL genuinely needs to end in one of those characters.
- **`doi:10.1145/1327452.1327492`** — a Digital Object Identifier, common in academic citations — resolves to the standard `https://doi.org/...` resolver URL and opens like any other external link. Works both bracketed and as a bare auto-link.
- Internal links resolve by heading title (`[[*Some Heading]]`), by `CUSTOM_ID` property (`[[#my-id]]`), or fall back to a title search for bare text — tapping one expands ancestors and scrolls to the target heading. Set a heading's `CUSTOM_ID` via the properties section of its general editor (see [Editing your outline](#editing-your-outline)) — it's a property like any other, no dedicated action for it.
- **`http://`/`https://` image links** render inline as actual images, if `#+STARTUP: inlineimages` is set (off by default — see below).
- **Local/relative image paths load and render on GitHub and WebDAV** — `[[photo.png]]`, `[[images/photo.png]]`, `[[file:photo.png]]`, `[[github:images/photo.png]]` all resolve relative to the current document's own path (a bare filename lands beside it, same convention as capture-to-file and archiving below), get read as binary and base64-encoded into a `data:` URL, and appear as real images — same `#+STARTUP: inlineimages` gate as `http(s)` images above. Cached per session once loaded, so re-rendering the outline (any edit, anywhere) doesn't re-fetch the same image again. **Local files (File System Access) and iOS import still show the `[image: path]` placeholder** — same picker-permission wall as archiving and capture-to-file: reading an arbitrary sibling file needs a handle the browser hasn't granted, and can't be granted silently mid-render.
- **`file:`/`github:`/`webdav:` links are recognized, parsed, and navigate** — absolute path (`file:/home/user/documents/notes.org`), relative path (`file:projects/todo.org`), a specific headline (`file:~/notes.org::*Project Alpha`), and a text search (`file:~/notes.org::exact phrase`) all parse correctly into a scheme, a path, and an optional in-file target, matching real org's own `::` convention. `github:path/in/repo.org` and `webdav:path/on/server.org` follow the same rules for their own backend. Tapping one opens the target document (the same mechanism File → Open already uses, including its own unsaved-changes handling) and jumps straight to the headline or text match if one was specified. A bare `file:`/relative-path link with no explicit scheme uses whichever backend the *current* document itself came from; an explicit `github:`/`webdav:` always targets that backend directly, regardless of what's currently open. **Local files and iOS import are the one exception** — same picker-permission wall as archiving, capture-to-file, and image loading below: opening an arbitrary path needs a fresh picker gesture the browser requires per file, which can't happen from a link tap, so those show a clear message instead of attempting (and failing) a silent open.

---

## Folding and `#+STARTUP`

org-pwa reads and applies `#+STARTUP:` directives, typically on the first line of the file. None, some, or both of the following can be present on one line, or spread across several — the last matching keyword wins if there's a conflict:

| Category | Keywords | Default |
|---|---|---|
| Heading visibility | `overview`, `content`, `showall`, `showeverything` | `showeverything` |
| Inline images | `inlineimages`, `noinlineimages` | `noinlineimages` |

- **`overview`** — only top-level headings shown, everything else folded.
- **`content`** — every heading line unfolded, but body text (paragraphs/lists/tables) and properties stay hidden until you tap a heading open — a genuinely separate visibility axis from "is this heading's subtree folded," not just an alias for `showall`.
- **`showall`** — body text, lists, and tables all shown. Property drawers (`:PROPERTIES: ... :END:`) and block content (`#+BEGIN_SRC`/`#+BEGIN_QUOTE`/etc.) stay folded — matching real org-mode's own distinction, confirmed against the org manual: `showall` unfolds headlines and body text, but drawers and blocks remain collapsed as a single line regardless.
- **`showeverything`** — everything `showall` shows, plus property drawers and block content, both fully expanded. This is the actual, sole structural difference between the two modes.

Manually cycling a heading to "fully expanded" (the slide-left gesture, or tapping through the fold states) always reveals everything about that heading — properties and block content included — regardless of what the file's `#+STARTUP:` line says. So a `showall` file still lets you open any specific heading's properties or block content by hand; you're never stuck needing to change the file's own directive just to peek at one thing. This reverses cleanly too: collapsing the heading again — swipe, or the chevron — correctly re-hides whatever was revealed, rather than leaving it stuck visible.

These defaults are chosen to match real Emacs org-mode's actual out-of-the-box behavior (no `#+STARTUP` line means fully shown, not folded), not an arbitrary choice. See [Local Variables](#local-variables) for archived-heading cycling behavior, which is a separate mechanism from `#+STARTUP:` entirely.

---

## Local Variables

Separate from `#+STARTUP:` — this is a general *Emacs* mechanism (works in any file type Emacs edits), not an org-specific directive, conventionally placed at the end of the file:

```
# Local Variables:
# org-agenda-start-on-weekday: 1
# org-cycle-open-archived-trees: nil
# org-agenda-skip-comment-trees: t
# org-agenda-skip-archived-trees: t
# End:
```

Currently recognized:

| Variable | Default | What it does |
|---|---|---|
| `org-agenda-start-on-weekday` | `1` (Monday) | Which weekday the agenda's Week view starts on |
| `org-cycle-open-archived-trees` | `nil` | Whether the swipe gesture can open an archived heading |
| `org-agenda-skip-comment-trees` | `t` | Whether a commented heading (`** # ...`) is excluded from the agenda |
| `org-agenda-skip-archived-trees` | `t` | Whether an archived heading is excluded from the agenda |
| `org-contacts-birthday-property` | `BIRTHDAY` | Which property key `org-contacts-anniversaries` reads |
| `org-use-sub-superscripts` | `t` | Whether/how `_`/`^` are interpreted as sub/superscript |
| `org-archive-confirm` | `t` | Whether archiving/unarchiving asks for confirmation first |
| `org-use-tag-inheritance` | `t` | Whether a search filter's `+tag`/`-tag` also matches a tag inherited from an ancestor |
| `org-use-property-inheritance` | `nil` | Whether a search filter's `key:value` also matches a value inherited from an ancestor |

- **`org-agenda-start-on-weekday`** — which weekday the agenda's Week view starts on. `0` = Sunday, `1` = Monday (the default, matching real org), `2` = Tuesday, and so on through `6` = Saturday. An out-of-range value falls back to Monday rather than producing a nonsensical week.
- **`org-cycle-open-archived-trees`** — `t` or `nil` (Lisp booleans, not JavaScript truthiness — the string `"true"` is not `t` and won't be treated as one). `nil` (the default, matching real org) means an archived heading (tagged `:ARCHIVE:`) starts folded regardless of the `#+STARTUP:` visibility mode, and **the slide-left swipe gesture refuses to open it** — whether cascading into it from a parent or swiping directly on it. This matches real org-mode's own stated behavior exactly (confirmed against the actual org.el source: the `ARCHIVE` tag's docstring says plainly "An archived subtree does not open during visibility cycling"). The **chevron is different on purpose**: tapping it still opens an archived heading regardless of this setting. Real Emacs has separate force-open mechanisms outside of TAB/cycling for exactly this situation (`C-c C-TAB`, a universal-argument TAB, `outline-show-all`) — a touch UI with no keyboard modifiers doesn't have anywhere else to put that, so the chevron fills that role here instead of being a second implementation of the swipe gesture. Without it, archived content would have no way to ever become visible again. Set `org-cycle-open-archived-trees` to `t` to make archived headings behave like any other heading for the swipe gesture too — the chevron behavior doesn't change either way, since it was never gated by this setting.
- **`org-agenda-skip-comment-trees`** — `t` or `nil`. `t` (the default, matching real org) excludes "commented" headings from agenda views — a heading whose *title* starts with `# ` (or is just `#`), real org's own definition of a comment line applied to a heading title, e.g. `** # draft, not ready yet`. This is a heading-title convention, distinct from `#+STARTUP:`'s archive-cycling setting above and from a `#+BEGIN_COMMENT` block — it just means "don't show this on the agenda," while the heading stays a completely normal, visible entry in the outline itself. Set to `nil` to include commented headings in the agenda after all.
- **`org-agenda-skip-archived-trees`** — `t` or `nil`. `t` (the default, matching real org) excludes archived headings (tagged `:ARCHIVE:`) from agenda views. Set to `nil` to include them.
- **`org-contacts-birthday-property`** — which property key holds a heading's birthday/anniversary date+description for [`org-contacts-anniversaries`](#agenda). A plain string, not a Lisp boolean — e.g. `# org-contacts-birthday-property: EVENT`. Default `BIRTHDAY`, matching real org-contacts.el's own default exactly.
- **`org-use-sub-superscripts`** — one of `t`, `{}`, or `nil` (not a plain boolean — three real values, matching real org exactly). See [Inline text markup](#inline-text-markup) for what each one does. An unrecognized value falls back to `t`, real org's own default, rather than silently disabling the feature.
- **`org-archive-confirm`** — `t` or `nil`. `t` (the default, matching real org) shows a confirmation dialog naming the actual destination before archiving or unarchiving a heading; `nil` skips it and proceeds immediately. See [Archiving](#archiving).
- **`org-use-tag-inheritance`** — `t` or `nil`. `t` (the default, matching real org's own actual default — confirmed directly against org's own manual) means a `+tag`/`-tag` search filter also matches a heading whose tag comes from an ancestor, not just its own — structural inheritance down the outline, the same as real org's tags always working this way unless explicitly turned off. `nil` restricts a filter to a heading's own tags only. A simpler `t`/`nil` boolean here than real org's fuller value space (a specific tag list, or a regexp, are both also valid values for the real Emacs variable) — this app only supports the on/off case. Search-time only — doesn't change what tags are *displayed* on a heading.
- **`org-use-property-inheritance`** — `t` or `nil`. `nil` (the default, matching real org's own actual default — property inheritance is opt-in in real org too, "because it can slow down property searches and is often not needed") means a `key:value` search filter only looks at a heading's own properties. `t` also falls back to the nearest ancestor's value when the heading doesn't define that property itself — a heading's own value always wins if it has one, inheritance only fills the gap. Same `t`/`nil` simplification as `org-use-tag-inheritance` above, versus real org's fuller list/regexp value space.

More variables will likely be added here over time; the parser itself is general-purpose (it captures whatever `# key: value` lines it finds in the block, whether or not this app currently acts on that particular key), so recognizing a new one is a small, additive change rather than a redesign.

---

## Archiving

Tap a heading's title, then **Archive**, to move the whole subtree to its configured archive location — real org's `org-archive-subtree` (`C-c C-x C-s` / the friendlier `C-c $`), not just tagging something in place. The moved copy gets `:ARCHIVE:` added to its tags and four properties stamped on it recording where it came from: `ARCHIVE_TIME`, `ARCHIVE_FILE`, `ARCHIVE_OLPATH` (the titles of its ancestor headings, joined by `/`), and `ARCHIVE_CATEGORY`. The original is only removed from the current file after the move to its destination has actually succeeded — a network failure or permission problem leaves the heading exactly where it was, with a clear error shown, rather than losing it.

**Confirmation**: with `org-archive-confirm` at its default `t` (see [Local Variables](#local-variables)), archiving shows a confirmation dialog naming the actual destination — the file, and the heading it'll be filed under if the location has one — before anything happens. Cancel and nothing changes at all. Confirm and, once the move actually completes, the status line reads `--- Archive complete.` Set `org-archive-confirm` to `nil` to skip the dialog and archive immediately.

**Where things get archived to** is controlled by `org-archive-location`, checked in the same priority order real org uses: a heading's own `ARCHIVE` property first, then the file's `#+ARCHIVE:` keyword, then the default `"%s_archive::"`. The value is two parts joined by `::`:

- **File part** (before `::`) — the destination file. `%s` becomes the current file's own name, extension included (`notes.org` → `notes.org_archive`, matching real org's own well-known convention for the default). Left empty, archiving happens within the *current* file instead of a separate one.
- **Headline part** (after `::`) — a heading to file entries under, e.g. `* Archived Tasks`. Left empty, entries go to that file's top level. Only a single heading level is supported as a target (every example in org's own documentation for this variable is one level) — a multi-level outline path isn't.

| Location | Behavior |
|---|---|
| `%s_archive::` (default) | Sibling file `notes.org_archive`, top-level entries |
| `::* Archived Tasks` | Same file, filed under a top-level `* Archived Tasks` heading (created if it doesn't exist yet) |
| `~/org/archive.org::` | One central file, top-level entries |
| `~/org/archive.org::* %s` | One central file, filed under a heading named after the source file |

Set `#+ARCHIVE: location` at the top of a file to apply it to every heading in that file, or an `:ARCHIVE:` property on a specific heading to override it for just that subtree.

**Platform limitation, stated plainly rather than silently failing**: archiving to a *different* file only works automatically on GitHub and WebDAV, which can read/write an arbitrary path directly. A local file (opened via File System Access) or an iOS import can't — the browser's own security model requires an explicit file picker gesture per file, which can't happen silently mid-archive. Attempting a cross-file archive on those backends shows a clear message instead of a confusing low-level permission error, and archiving *within* the current file (an empty file part, e.g. `::* Archived Tasks`) works everywhere regardless of backend.

### Restoring (unarchive)

Open the archive file itself — the **File → Open** browser now shows `_archive` files alongside `.org` ones (🗄️ icon), so there's no need to already know or type the exact filename — and tap the archived heading's title. Its properties record exactly where it came from, so the action row shows **Unarchive** (📤) in place of Archive: tap it, and the heading moves back to its original file and location, `:ARCHIVE:` and all four `ARCHIVE_*` properties stripped, and its original TODO state restored if it was changed to DONE on archiving.

Same confirmation behavior as archiving (`org-archive-confirm`, naming the actual destination this time — where it's going *back* to), and the same **write-before-remove transaction safety**: the destination is written first, and the archived heading is only removed from the archive file once that write has actually succeeded — a network failure can't lose it partway through. Success shows `--- Restore complete.` A heading tagged `:ARCHIVE:` by hand (or via an earlier version of this app's own in-place tag toggle) with no recorded `ARCHIVE_FILE` has nowhere on record to go back to — restoring it just strips the tag and properties in place, at the top level of whichever file it's currently in, rather than guessing.

There's no separate "browse the archive and restore something without opening it" list view — restoring is done from within the archive file itself, the same action-row interaction as everything else in this app.

There's no restore-from-archive UI yet — moving something back means opening the archive file directly and moving the heading by hand.

---

## The plain-text editor

Tap **View → Text** to switch the entire outline view for one full-width textarea containing the whole document as raw org text — everything, including `#+STARTUP:`, `#+TODO:`, a [Local Variables](#local-variables) block, and any syntax the structured view still doesn't have dedicated UI for (editing block content, changing the `#+TODO:` sequence itself). Tap **View → Org** to switch back; the text is reparsed from scratch at that point, so any changes — including to `#+STARTUP`/`#+TODO`/Local Variables — take effect immediately.

**Switching in lands near wherever you last navigated to**, not always the top of the file — tap a search result or an internal link, then switch to Text, and the cursor and scroll position land at that same heading's line rather than losing the context you just found. This only tracks explicit "jump to X" navigation (search, internal links, agenda items), not manual scrolling within the outline; scroll around on your own and switch to Text, and it opens at the top as before. The scroll position itself is an approximation (proportional to the target line's position in the file), not a pixel-exact one — a wrapped line's real rendered height varies with content, so "near the same line" is the actual guarantee here, not perfect alignment.

This is the escape hatch for everything the tap-driven UI doesn't cover yet.

---

## Agenda

Tap **View → Agenda** for a list of everything with a date attached, grouped into Day, Week, or Month views. **‹**/**›** step the view backward or forward by whatever unit is currently active — a day, a week, or a month — and **Today** jumps back to the current date. Tapping an item switches back to the Org view and scrolls straight to it.

**Week view always aligns to an actual calendar week** — Monday through Sunday by default (configurable, see below), regardless of which day of that week you happened to open the agenda on. It resolves to the same 7-day window whether you're looking at it from Monday or Friday, not "whatever day is currently open, plus the next six."

Four kinds of dated entry show up, and **they behave differently from each other in an important way** — this is real org-mode semantics, not an app-specific choice:
- **`SCHEDULED:`** — when you intend to do something. Shows on its date, and if the heading isn't marked done, **keeps reappearing on every day after that** (as overdue) right up through today, until you mark it done. This is what makes "I meant to do this last week and never did" actually visible instead of quietly vanishing off the agenda the day after its original date. The overdue count shows directly on the item ("3 days overdue").
- **`DEADLINE:`** — same carry-forward behavior as SCHEDULED once the date passes with the heading still not done. It also supports a **delay/warning-period** suffix (real org syntax: `DEADLINE: <2026-01-10 Sat -3d>`), which makes it start appearing *before* its date too — 3 days early in that example, showing "due in 3 days," counting down each day until it either gets marked done or becomes overdue (at which point it switches to counting up instead). Without a delay, a DEADLINE only ever shows on its date or after — real org's own default.
- **A plain, *active* timestamp written directly in a heading's title** — the standard org convention for tracking something like a recurring birthday right on its own heading line (`**** Jennifer <1989-11-02 Thu +1y>`), a genuinely separate source from SCHEDULED/DEADLINE, not a fallback for it. This one does **not** carry forward, ever, regardless of done status — matching real org's own distinction ("if you didn't go to your doctor's appointment yesterday, that doesn't mean you still have one today"). Only counted when the heading has no SCHEDULED/DEADLINE of its own (to avoid a confusing double entry), and only *active* `<...>` timestamps count — an inactive `[...]` one is excluded, same reasoning: a dated record, not a reminder. This only looks at the title, not body text, to avoid pulling in unrelated dates mentioned in ordinary prose elsewhere in a journal-heavy file.
- **`org-contacts-anniversaries`** — real org-contacts' own mechanism for recurring yearly events (birthdays, anniversaries), read directly from a heading's own property rather than a separate, duplicated line of text — one source of truth for a date you might also want recorded as a property for other reasons (vCard export, contact lookup). A contact heading gets a property (default key `BIRTHDAY`, matching real org-contacts' own default exactly — configurable via [Local Variables](#local-variables)) formatted `YYYY-MM-DD Description`:
  ```org
  * John Doe
    :PROPERTIES:
    :BIRTHDAY: 1990-05-15 Birthday
    :END:

  * Mary & Jim
    :PROPERTIES:
    :BIRTHDAY: 2015-08-22 Wedding Anniversary
    :END:
  ```
  Placing the trigger line `%%(org-contacts-anniversaries)` anywhere in the file activates the scan — its own position doesn't matter beyond "present somewhere"; it's a switch, not itself an event, so it's usually placed under its own heading (`* Anniversaries & Birthdays`) purely for organization. Every heading anywhere in the file carrying the configured property gets checked, producing a line like `John Doe: Birthday (36)` — the age is computed fresh for whichever year's occurrence is being shown, so the same entry correctly shows a different number across a multi-year Month or Week view, not one age frozen in. `YYYY` can be the literal word `nil` when the actual year isn't known — the age then can't be computed, and `(xx)` is shown instead of a number, exactly as asked for rather than a bare dash or omitting the parentheses. Shown with a 🎂 icon in the agenda to tell it apart from the other three kinds at a glance. A heading with the property in an unparseable format, or no description text after the date, is silently skipped rather than erroring — an empty scan result and a broken one are treated the same way here, since there's no per-item feedback channel in an agenda list to report a parse failure through.

  Deliberately does **not** additionally require an `:EMAIL:` property to count as a valid contact, unlike real org-contacts' own default — confirmed directly against the org-contacts.el source before diverging, not assumed. Requiring it here would silently exclude anyone whose birthday is tracked without an email on file, which wasn't part of what this was built for.

Other behavior:
- **Completed items are excluded** — using the file's own `#+TODO:` sequence (whatever keywords you've actually defined as "done"), not a hardcoded check for the literal word `DONE`.
- **Repeating timestamps expand properly**, for SCHEDULED/DEADLINE/title-timestamp (the first three sources above — `org-contacts-anniversaries` recurs by its own inherent yearly mechanism instead, described above, not this repeater syntax). `<1989-11-02 Thu +1y>` shows up every year on the anniversary within whatever range is currently displayed, not just its one literal stored date — switch to Month view and it correctly shows up in whichever month it falls in. Carry-forward, delay, and repetition don't combine — a *repeating* SCHEDULED/DEADLINE shows on its own repeat dates only, with no additional carry-forward or early-warning between them (org's actual interaction between a repeater and completion history is more involved than a read-only agenda needs to model).
- Archived headings are excluded, same as everywhere else in the app.
- **Commented headings are excluded too** — a heading whose title starts with `# ` (or is just `#`), real org's own comment-line convention applied to a heading title (e.g. `** # draft, not ready yet`). Both this and archived-heading exclusion are configurable via [Local Variables](#local-variables) (`org-agenda-skip-comment-trees` / `org-agenda-skip-archived-trees`), matching real org's own two separate settings for this.
- **Week view's start day is configurable** via `org-agenda-start-on-weekday` in a [Local Variables](#local-variables) block — Monday by default, matching real org.

One thing worth knowing if a title timestamp isn't showing the way you expect: **a trailing tag needs a space before it to actually parse as a tag** (`<1989-11-02 Thu +1y> :BDAY:`, not `+1y>:BDAY:`) — this matches real Emacs org-mode's own heading-parsing rules, not a gap specific to this app. Without the space, the tag stays as literal title text instead of becoming a real, filterable tag — but the *timestamp itself* is still found and still shows up in the agenda either way, since that scan doesn't care about tag formatting.

**Agenda Files** (real org's `org-agenda-files` idea): configure additional files in **Settings → Agenda Files** — a JSON array of `{scheme, path}`, e.g. `[{"scheme": "github", "path": "journal/2026.org"}]` — and the Agenda and TODO views scan across all of them, not just the currently open file. **Only `github` and `webdav` are supported** — the same reasoning as archiving, capture-to-file, and image loading: those two backends can read an arbitrary path directly, while a local (File System Access) or iOS-import file needs a fresh picker gesture per file that can't happen silently in the background. If the currently open file is also in the configured list, its live in-memory version (including anything not yet saved) is used instead of a separately fetched, possibly-stale copy of the same file — no double-fetching, no double-counting.

Configured files are fetched once per session and cached, not refetched on every single agenda interaction (switching Day/Week/Month, stepping the date) — a **↻** button appears in the agenda controls once any files are configured, for pulling fresh copies on demand. The agenda renders immediately with whatever's already loaded and updates again as each configured file's fetch completes, rather than blocking on all of them together; a file that fails to load (network error, wrong path, missing permissions) shows a clear message above the agenda list rather than silently vanishing.

---

## TODO view

Tap **View → TODO** for every active TODO-state heading in the file, **completely independent of any date** — matching real org-mode's own global TODO list (`C-c a t`, distinct from `C-c a a`, the calendar-style agenda). A TODO with no SCHEDULED, DEADLINE, or timestamp attached never shows up in Agenda at all — by design, not by omission — so this is where it lives instead.

It's a flat list, in document order, each item showing its TODO keyword and title, tap to jump straight to it in the outline. Same exclusions as Agenda: completed items (via the file's own `#+TODO:` sequence), archived headings, and commented headings, using the same [Local Variables](#local-variables) overrides where relevant.

---

## Capture Templates

Tap **More → Capture** (the ⋮ button next to the filename) for real org-mode's own `org-capture-templates` system, for quickly filing a note, task, or table row into a specific spot in the outline without navigating there by hand. Pick a template, answer whatever prompts it asks, and the expanded result gets inserted at that template's target — creating the target heading(s) if they don't exist yet.

Four example templates are the default, so this works immediately with no setup: **b**ullet list item, **c**heck list item, **m**eeting notes, and a **t**able row. Edit or replace them any time in **Settings → Capture Templates** — configured as JSON (an array of template objects), not a visual builder, matching how this app already handles GitHub/WebDAV config.

**Template shape:**
```json
{
  "key": "b",
  "description": "Bullet List",
  "type": "item",
  "olp": ["heading 1", "heading n"],
  "template": "%? [The captured text or note]",
  "emptyLines": 1,
  "file": "journal.org"
}
```
- **`key`** — must be unique; shown next to the description in the picker.
- **`type`** — one of `item` (plain bullet), `checkitem` (checkbox item), `plain` (raw text, parsed as its own org fragment and merged in — the only type that can itself contain heading syntax, properties drawers, TODO keywords, etc.), or `table-line` (one row, appended to the nearest existing table under the target or creating a new one).
- **`olp`** — the outline path to insert into, found or created heading by heading. A segment wrapped in `%<FORMAT>` (e.g. `"%<%Y-%m>"`) expands dynamically — real org's own `,(format-time-string ...)` idea, translated into this app's %-escape syntax so a monthly table can target "2026-07" without you creating that heading by hand every month. Any other segment is used completely literally, with no escape processing at all.
- **`file`** *(optional)* — capture into a DIFFERENT file than the one currently open, real org's own `(file+olp "target-file.org" ...)` idea. A bare filename (`"journal.org"`) lands as a sibling of whatever file is currently open — same convention as archiving's `%s_archive`; a path containing `/` is used as-is. **The currently open file is never switched or touched** — this reads the target file via whichever backend (GitHub/WebDAV/local) the current document already uses, inserts, and writes it back directly, the same read-write-safely pattern archiving uses (nothing is changed if the write fails). Omit `file` entirely to capture into the currently open file, exactly as before this existed. Same local-file picker-permission limitation as archiving: a target file on GitHub/WebDAV works automatically; a local (File System Access) or iOS-import target needs that file opened/saved once first, or you'll get a clear message explaining why instead of a silent failure.
- **`emptyLines`** — parsed and stored, matching real org's `:empty-lines N`, but **not yet acted on** — stated plainly rather than silently: no blank lines get inserted after captured content yet.

**Template text — the %-escape language, local time throughout:**
- `%<FORMAT>` — a practical `format-time-string` subset: `%Y %y %m %d %e %H %I %M %S %p %A %a %B %b %F %R %T %j`, plus `%%` for a literal percent. An unrecognized specifier is left visible (e.g. `%Z` stays as `%Z`) rather than silently dropped.
- `%t` / `%T` — an active timestamp, date-only / date-and-time.
- `%u` / `%U` — the same, but inactive (`[...]` instead of `<...>`).
- `%^{Prompt}` — asks a question via a simple prompt dialog. `%^{Prompt|default}` pre-fills an answer; `%^{Prompt|default|choice1|choice2}` also lists the choices in the prompt text (there's no dropdown here — real org's completion-table equivalent is just shown as text to pick from). Multiple prompts in one template are asked in the order they appear; cancelling any single one aborts the whole capture — nothing partial gets inserted.
- `%N` — the row number, for `table-line` captures only (empty otherwise).
- `%?` — not text — marks where the cursor should land afterward. Precise only for `item`/`checkitem`: those open the captured item for editing with the cursor exactly there. For `plain`/`table-line`, capture instead just navigates to the target heading — those two can produce multi-part content (a whole subtree, or a table row with several cells) with no single obvious place to put a cursor, so this doesn't try to fake precision it can't actually deliver.

---

## File management

**File menu**: New, Open, Save, Save As.

- **New** and **Open** ask which backend to use (Local/Import, GitHub, or WebDAV).
- **Opening from GitHub or WebDAV browses a real folder/file listing** — no more needing to already know the exact path from some other source. Folders (📁) are tappable to navigate into; among files, `.org` files (📄) and `_archive` files (🗄️, real org's own archive-file naming convention — see [Archiving](#archiving)) are shown, other files in the same folder are filtered out rather than cluttering the list. An **↑ Up** button appears once you're below the root. GitHub uses its Contents API (the same one reads/writes already used); WebDAV uses the standard `PROPFIND` method, which most servers (Nextcloud, ownCloud, Apache `mod_dav`) support out of the box. If listing ever fails — a server that doesn't support `PROPFIND` well, a token without list permission on a specific folder — **"Type a path instead…"** is always available as a fallback, the same manual entry this replaced as the default path.
- **Save** always writes back to whichever backend the current file came from — you don't get asked again.
- **Save As** lets you pick a new destination, possibly on a different backend than the one you opened from.
- If a file has local edits that were never saved when you try to open it again, you're asked whether to **resume** those edits or **discard** them and load the current version — either choice actually opens the file; there's no dead-end confirmation.
- **Conflict handling**: if the on-disk/remote version changed since this app last synced it, Save asks you to keep your version or the other one, via a plain confirm dialog — there's no diff or merge view.

---

## Export

**File \u2192 Export\u2026** gets a document out of org-pwa as Markdown or HTML, for the whole file or just one heading's subtree. Both walk the same parsed structure the app already renders from, not a text-level reparse.

**Scope**: **Whole file** exports everything; **Choose a heading\u2026** shows every heading in the document \u2014 regardless of current fold state, so something folded away is still pickable \u2014 and exports just that heading and its descendants. The selected heading becomes the new top level (`#`/`<h1>`) in the output, not its original depth, so a level-3 heading exported on its own doesn't produce a dangling `###`/`<h3>` with nothing above it.

**Markdown** is GFM-flavored: checkboxes become real task-list syntax (`- [ ]`/`- [x]`), tables become pipe tables, fenced code blocks keep their language hint. TODO keyword, priority, and tags stay as plain text on the heading line (`# TODO [#A] Buy milk`) since Markdown has no native syntax for any of the three \u2014 matching org's own source convention rather than inventing one. Underline and sub/superscript fall back to raw `<u>`/`<sub>`/`<sup>` HTML passthrough, since Markdown has no native syntax for those either (both CommonMark and GFM allow embedded HTML, so this renders correctly wherever the output is actually viewed).

**HTML** is a complete, standalone document \u2014 open it directly, no other files needed. TODO keywords and priority get small styled badges (a done-state keyword like `DONE` or a custom one like `KILL`, correctly read from the file's own `#+TODO:` line, renders in green rather than red). Checkboxes are real disabled `<input type="checkbox">` elements. **This is also the path to PDF**: the exported HTML includes print-aware CSS (headings and tables don't split awkwardly across a page break), so opening it and using the browser's own Print \u2192 Save as PDF produces a properly paginated PDF with no separate export path needed \u2014 a browser's print engine handles pagination far better than a hand-rolled PDF generator would, and needs no new dependency to get there.

**What's dropped on export, deliberately**: property drawers (an implementation detail, not reader-facing content) and the `ARCHIVE_*` properties specifically, even if present \u2014 their meaning is entirely internal to this app's own archiving feature (see [Archiving](#archiving)). SCHEDULED/DEADLINE render as a small italicized line under the heading instead. Internal links (`[[*Some Heading]]`, `[[#custom-id]]`) are **not** resolved to anchors in the output \u2014 the target renderer's own heading-slug algorithm can't be predicted from here, so guessing at an anchor that might not actually match would be worse than keeping the raw org target as the link's href verbatim.

---

## Docs

Tap **More → ?** to read this very README inside the app — same "replaces the outline" treatment as Settings, not a popup. It's fetched once per session and cached in memory, so re-opening it doesn't re-fetch; it's also cached by the service worker, so it's available offline the same as everything else here. The table of contents links actually work — tapping one scrolls to that section within the doc, it doesn't try to navigate anywhere (there's no routing in this app). External links (anything not starting with `#`) open in a real new tab.

Rendered by a small, dependency-free markdown parser built specifically for this file — not a general-purpose implementation, just the subset this README actually uses (headings, bold/italic/inline code, fenced code blocks, bullet/numbered lists, links, horizontal rules). If you edit this README and add a construct it doesn't handle, the in-app Docs view is what'll look wrong first.

---

## Settings

Reached via the ⚙ button, which replaces the outline with the settings screen — same as switching to Text or Agenda view, not a popup over the outline. Tap ⚙ again, or any of File/More/View, to leave settings and return to whatever was showing before (there's no separate "Done" button; those are already the way out).

- **GitHub** — personal access token, repo owner, repo name, branch. Use a fine-grained token scoped to just that repo with Contents read/write only, not a broad classic token.
- **WebDAV** — server URL, username, password (an app-specific password if your server supports one, not your main account password). Most WebDAV servers don't send CORS headers by default; if Open/Save fails with a network error, that's very likely a server-side CORS setting to fix, not a bug in this app.
- **Appearance** — theme (System/Light/Dark), font (System/Serif/Monospace), and two independently adjustable font sizes on the same row: the main size (headings, paragraphs, and lists/checkboxes all share this one) and **Tables** (tables have their own size rather than inheriting the main one — a table at the same size as prose text tends to feel cramped or oversized depending on column count). Headings render bold, matching real org-mode's own actual default (`org-level-N` faces are bold, not size-scaled, out of the box) — that's a fixed style choice, not a separate adjustable size.
- **Backup** — **Export Settings** bundles everything on this page — appearance, capture templates, GitHub, and WebDAV, including credentials — into one downloadable JSON file, for moving settings to another device. A confirmation is shown first if the export would include a token or password, since the file contains them in plain text. **Import Settings…** picks a previously-exported file and merges its contents into what's already configured here — a setting the file doesn't mention is left completely untouched, so importing an older or partial export can never silently wipe out something it simply doesn't know about. Anything with an immediate visual effect (theme, fonts) applies right away, no reload needed.

---

## Offline behavior and sync

Every edit applies to an in-memory copy and is cached to IndexedDB in the background immediately — the UI never waits on a write to feel responsive, and nothing is lost by closing the tab before hitting Save. Writing back to disk/GitHub/WebDAV only happens on an explicit Save. Local File System Access reads are unaffected by network connectivity (it's not a network call); GitHub and WebDAV obviously do need a connection.

---

## Platform support

Local file access (the "Local" option, with a live, writable handle) requires the File System Access API — Chrome and Edge, desktop or Android. **No browser on iOS supports this**, because Apple requires every iOS browser to use WebKit, which has never implemented it — that's not fixable by switching browsers on that platform.

**Android specifically**: the file picker filters by MIME type through the OS's own Storage Access Framework, and `.org` has no MIME type registered on Android (unlike `.txt`, which maps cleanly to `text/plain`), so `.org` files could be invisible in the open picker even though they're right there. The obvious-looking fix — filtering on the `.org` extension directly via `accept: {'*/*': ['.org']}` instead of a specific MIME type — was tried first and directly confirmed *not* to resolve it; `.org` files stayed invisible while `.txt` kept working. The open picker has no `types` filter at all now, showing every file rather than continuing to guess at an `accept` shape that satisfies Android's filtering — if file visibility ever regresses here, that's the first thing to check, and re-adding any MIME-based filter to the open picker specifically should be treated with suspicion given this history.

On unsupported platforms, **Import** replaces "Local": pick a file once via the native file picker, edit it, and Save triggers a download of the new version, which you then move into place yourself (e.g. overwriting the original in the Files app). GitHub and WebDAV work the same everywhere, including iOS, since they're plain HTTPS requests rather than filesystem access.

**Screen size**: this was built mobile-first — 44px touch targets, swipe-to-cycle-visibility, tap-to-reveal action menus instead of hover/right-click — and stays that way below 900px wide, byte-for-byte the same layout it's always had. Above 900px (a laptop or desktop browser window), two things change: the app widens from its 480px mobile cap up to 1100px instead of sitting in a narrow column with empty space on either side, and opening Settings or Docs shows them in a **side panel** next to the outline instead of replacing it outright — there's room to see both at once, so replacing the whole screen for something like settings stopped making sense. The side panel scrolls independently from the outline. Every other interaction — swipe, tap-to-reveal, the action menus — works identically at any width; this is a layout change, not a second UI. Resizing a browser window across the breakpoint while Settings/Docs is open switches between the two modes correctly rather than getting stuck in whichever one it started in.

---

## Keybindings

A practical subset for a keyboard/mouse device — genuinely inert on a phone or tablet (nothing to press these on), except a Bluetooth keyboard paired to a tablet, which they work correctly for too, same code path either way.

**Not a faithful reproduction of real org's own bindings**, deliberately: org leans heavily on the `C-c` prefix (`C-c C-t`, `C-c C-s`, `C-c C-d`, ...), and `C-c`/`C-v`/`C-a`/`C-f` and friends are universally reserved by every browser for copy/paste/select-all/find — they can't be reliably intercepted from a web page, and building shortcuts on that prefix would mean silently breaking copy-paste rather than a reasonable tradeoff. Real org's `M-←`/`M-→` (promote/demote) collide with the browser's own back/forward navigation the same way. Where the real org key is actually safe to use, it's used as-is; everywhere else this substitutes a different, safe key rather than pretending the conflict doesn't exist.

| Key | Action | Matches real org? |
|---|---|---|
| `↓` or `j` | Move keyboard focus to the next visible heading | No direct equivalent — the web/vim-style analog |
| `↑` or `k` | Move keyboard focus to the previous visible heading | Same |
| `Tab` | Cycle the focused heading's fold state | **Yes** — `org-cycle`, exactly |
| `Enter` | Open/close the focused heading's action row | No equivalent (org has no "action menu" concept) |
| `t` | Cycle the focused heading's TODO state | Matches the underlying action of `C-c C-t` |
| `Alt+↑` | Move the focused heading up among its siblings | **Yes** — `org-move-subtree-up` (`M-↑`) |
| `Alt+↓` | Move the focused heading down among its siblings | **Yes** — `org-move-subtree-down` (`M-↓`) |
| `[` | Promote (outdent) the focused heading | Stands in for `org-promote-subtree` (`M-←`, unsafe in a browser) |
| `]` | Demote (indent) the focused heading | Stands in for `org-demote-subtree` (`M-→`, unsafe in a browser) |
| `n` | New top-level heading | No direct equivalent (org uses `M-RET`, often reserved by window managers/browsers for fullscreen) |
| `/` | Focus the search box | Common web convention, not org-specific |
| `Escape` | Clear keyboard focus | Not an org concept — a web convention |

Keyboard focus is a separate concept from tapping a heading open — a thin highlight around the focused row, moved with `↓`/`↑`/`j`/`k`, that the rest of the table's shortcuts act on. It starts unset; the first arrow/`j`/`k` press picks the first (or last) visible heading, and every shortcut after that requiring "the focused heading" simply does nothing until one exists. `Tab` here follows the same archived-heading rule as the swipe gesture (see [Local Variables](#local-variables)), not the chevron's force-open behavior — there's no keyboard equivalent to tapping the chevron specifically. None of this ever fires while actually typing in a text field — every shortcut above is disabled the moment any input or textarea has focus, and Ctrl/Cmd-held combinations are never treated as one of these shortcuts either, so the browser's own copy/paste/find/new-tab bindings are never at risk of a silent double-action.

---

## Differences from Emacs org-mode

This is the section to read if you know org-mode well and want to know exactly where org-pwa is a subset, a simplification, or just plain different.

**Interaction model**
- Touch-first, primarily: tap-to-reveal actions and gestures (swipe-left to cycle fold) are the primary interaction model, not a keyboard-driven one. A practical subset of keyboard shortcuts exists for non-touch devices (see [Keybindings](#keybindings)) — but there's still no command equivalent to `M-x`, no modal editing, and nothing close to Emacs's own keyboard-first depth.

**Folding**
- org-pwa's fold model is three flags per heading (`collapsed`, `bodyHidden`, and `drawersHidden`), not Emacs's richer subtree-visibility state machine. It's enough to implement `overview`/`content`/`showall`/`showeverything` correctly — including the real distinction between `showall` (drawers/blocks still folded) and `showeverything` (everything open) — but doesn't have a direct equivalent to cycling through every intermediate visibility Emacs supports.

**Priority**
- Priority cookies (`[#A]`) have dedicated UI in the general editor (A/B/C/None buttons — see [Editing your outline](#editing-your-outline)), not just parsed-and-preserved on round-trip. Editing a heading's title directly through the outline UI still treats the whole string as literal title text rather than re-parsing it for a priority cookie — set priority through the dedicated buttons, not by typing `[#A]` into the title field.

**Tags**
- Tags have dedicated UI in the general editor — removable chips plus an add button, not a full-replace prompt where you'd retype the whole space-separated list. Not org-mode-style completion against tags used elsewhere in the file, though. One related quirk, still true: if you type something that *happens* to look like a tag — ending in `:word:` — into the *title* field specifically, it'll be re-interpreted as a tag on next parse, since org-pwa can't tell "literal colons in a title" from "a tag" once it's back in the file as text. Editing tags through the dedicated chips doesn't have this problem.

**Properties**
- Property drawers have dedicated UI too — individual key/value rows in the general editor, each with its own add/remove, not a full-replace text block. Not real org-mode-style value completion, and no special handling or validation for the properties org itself treats specially (`CUSTOM_ID` still has its own separate, simpler action; things like `ARCHIVE_*` properties round-trip fine and are surfaced with real meaning for archiving/restoring — see [Archiving](#archiving) — but nothing else treats them specially).

**Inheritance**
- Tags and properties both support ancestor inheritance for search/filter purposes, matching real org's own actual defaults exactly (confirmed against org's own manual): tag inheritance is **on** by default (`org-use-tag-inheritance`) — a `+tag`/`-tag` search filter matches a heading whose tag comes from an ancestor, not just its own, the same as real org's `if a heading has a certain tag, all subheadings inherit the tag as well`. Property inheritance is **off** by default (`org-use-property-inheritance`) — a `key:value` filter only looks at a heading's own properties unless turned on, since real org itself doesn't enable this by default either ("it can slow down property searches and is often not needed"). Both are simple `t`/`nil` booleans here rather than real org's fuller list-of-tags/regexp value space for either variable — a stated simplification covering the common on/off case. Inheritance is a search-time concept only, matching real org's own UX — it doesn't change what's *displayed* on a heading (no inherited tag badges shown inline), only what a filter search matches against. See [Local Variables](#local-variables).

**Archiving**
- The `org-archive-subtree` move, confirmation dialog, and full restore/unarchive are all built now — see [Archiving](#archiving) for the complete behavior. What's different from real Emacs: no `org-refile`-style interactive "pick from a list of candidate headings" restore flow — restoring means opening the archive file itself and tapping the archived heading's own Unarchive button, not choosing a destination from an arbitrary refile-targets list. `org-archive-location`'s multi-level outline-path targets (`* A/** B`) aren't supported, only a single heading level, though every example in org's own documentation for that variable is one level anyway.

**Checkbox progress cookies**
- `[2/5]` or `[40%]` now auto-recalculates on toggle/add/delete, matching real org-mode's default hierarchical counting. One difference worth knowing: org-pwa always counts hierarchically (a heading's cookie counts its whole subtree); real Emacs org lets you override this per-heading with a `:COOKIE_DATA:` property (e.g. to count only direct children, or only todo-keyword items) — org-pwa doesn't read or act on `:COOKIE_DATA:` at all, so that override has no effect here.

**Tables**
- `#+TBLFM:` formula lines round-trip but are never evaluated. org-pwa is not a spreadsheet engine.

**Agenda**
- Day/Week/Month views, repeating-timestamp expansion, completed-item exclusion, SCHEDULED/DEADLINE carry-forward with a visible overdue count, the delay/warning-period suffix making a deadline show up early, and multi-file aggregation via `org-agenda-files` are all built now (see [Agenda](#agenda)). What's still different from real org: the three repeater marks (`+`, `++`, `.+`) all expand identically here, since this is a read-only display with no notion of "when was this marked done" driving a catch-up/restart calculation; there's no support for org's diary-sexp entries (`%%(diary-...)`), other than `org-contacts-anniversaries`; and `org-agenda-files` only supports GitHub/WebDAV entries, not a local file, for the same picker-permission reason stated throughout this document (see [Agenda](#agenda) for the details).

**No babel, no command palette.** These were scoped early on as possible future work and never built.

**Undo/redo** covers every edit now (see [Undo/redo and History](#undoredo-and-history)) — snapshot-based (one step per completed edit action, not per keystroke), not persisted across a reopen, by explicit design choice. What's different from real Emacs: no per-buffer undo tied to Emacs's own undo-tree machinery, and no attempt to preserve fold state across an undo/redo jump (it reapplies the file's own `#+STARTUP` visibility fresh each time instead, same as reopening the file does). Headings *can* be reordered now (see above) — but only via the dedicated Move/Promote/Demote actions, not by dragging.

**Search** looks at the whole document (see [Searching](#searching)), with an optional regex mode, but no search-and-replace and no filtering the outline view down to just the matches (it's a separate results list, not a live-filtered tree).

**Export** (see [Export](#export) for the full behavior) covers Markdown and HTML \u2014 the whole file or a single heading's subtree \u2014 with PDF available via the browser's own print dialog on the exported HTML rather than a separate hand-rolled PDF path. What's different from real org's own export backends: no LaTeX/ODT/other formats, and internal links aren't resolved to anchors in the output (the raw org target is kept as the link's href verbatim, rather than guessing at a heading-slug algorithm the eventual renderer might not actually match).

**Single document at a time.** Opening a different document — via a `file:`/`github:`/`webdav:` link, or File → Open — always replaces what's currently showing; there's no true simultaneous multi-document editing (several documents open/dirty/rendered at once, tab-bar style). `org-agenda-files` (see [Agenda](#agenda)) and capture-to-file (see [Capture Templates](#capture-templates)) both work across multiple files without this limitation applying to them at all, since neither needs its target file to become the active one.

**Conflict resolution** is a plain confirm dialog (keep mine / keep the other version), not a diff or three-way merge view.

---

## Known limitations / not built yet

Restated in one place for scanning:

- No LaTeX/ODT/other export formats beyond Markdown and HTML (PDF is covered via the browser's own print dialog on the exported HTML, see [Export](#export)); internal links aren't resolved to anchors in exported output
- Search regex mode is JavaScript RegExp, not Emacs regex syntax — no search-and-replace, no filtered tree view
- `:COOKIE_DATA:` overrides for checkbox counting scope aren't read — counting is always hierarchical
- No table formula evaluation
- No drag-to-reorder (button-based Move/Promote/Demote actions exist instead — see [Editing your outline](#editing-your-outline))
- No dedicated "browse your recently-opened documents" switcher UI — switching between documents happens by tapping a `file:`/`github:`/`webdav:` link or File → Open, not a tab bar or history list; and no true simultaneous multi-document editing (see [Differences from Emacs org-mode](#differences-from-emacs-org-mode) for the full explanation)
- Agenda doesn't distinguish the three repeater marks (`+`/`++`/`.+`), and has no diary-sexp support other than `org-contacts-anniversaries`
- Local/relative images resolve and render on GitHub/WebDAV; on local files (File System Access) and iOS import, still a placeholder (same picker-permission limitation as archiving/capture-to-file)
- Conflict resolution has no diff/merge view
- No File System Access support on iOS (by platform limitation, not a bug — see [Platform support](#platform-support))

## Development

Pure static site — `index.html` + ES modules, no build step. Serve any way you like (including directly from the filesystem via `python3 -m http.server`, or GitHub Pages).

Engine code (`src/`) and browser-specific adapters (`src-browser/`) are unit tested with Node's built-in test runner, zero external dependencies:

```
node --test
```

887 tests as of this writing, covering the parser, every editing operation, fold/visibility logic (including the `showall`/`showeverything` distinction — confirmed against real org-mode's actual documented behavior: properties and block content stay folded in `showall`, revealed only in `showeverything` — and a real bug this caught: `isFullyExpanded` never checked `bodyHidden`/`drawersHidden`, so a heading loaded with either still hidden was incorrectly treated as already fully expanded), checkbox-cookie recalculation, search (plain and regex modes, including an invalid-pattern error path; matching against properties/TODO keyword/priority/SCHEDULED/DEADLINE, not just prose text; and filter-token parsing and integration -- +tag/-tag/todo:/priority:/key:value, AND-combining with each other and with free text, tag/property inheritance from ancestor headings (multi-level, an inherited tag still respecting a -tag exclusion, a heading's own property value always winning over an inherited one, and both correctly defaulting to real org's own actual defaults -- tags on, properties off), and URL/time false-positive exclusions), agenda/repeater expansion (including week/day boundary alignment, SCHEDULED/DEADLINE carry-forward with delay-based early warning, commented/archived-heading exclusion, the date-independent TODO view, and `org-contacts-anniversaries` — property parsing (including the nil-year and unparseable-value cases), age calculation and the "(xx)" unknown-age display, per-occurrence expansion across a multi-year range, the trigger line activating the scan regardless of its own position in the file, and full `buildAgendaItems` integration including a custom `org-contacts-birthday-property` key), correct resolution of a file with multiple `#+TODO:` lines, capture-template expansion and insertion (all four types, OLP target resolution, the sequential-table-mutation bug this coverage originally caught, and a serious data-loss bug where editing a just-captured item could silently overwrite unrelated pre-existing content elsewhere in the same heading), the in-app Docs view's markdown parser (including against this actual README's real content, catching a slug-generation mismatch against GitHub's own anchor algorithm that would otherwise have silently broken a table-of-contents link; GFM pipe table parsing with alignment; and a real bug this coverage caught: an indented fenced code block, nested under a bullet list item exactly as this README's own `org-contacts-anniversaries` example is, silently fell through to garbled paragraph text because the fence-detection regex required zero leading whitespace), heading move/promote/demote (including whole-subtree relocation, recursive level shifts, and every natural-boundary no-op case), priority setting/clearing/validation and its round-trip through serialization, horizontal-rule detection (including that it correctly interrupts a paragraph rather than being swallowed as literal text -- a real bug this coverage caught), inline sub/superscript parsing across all three `org-use-sub-superscripts` modes (including disambiguation from the pre-existing `_underline_` marker, which shares the same `_` character), timestamp building/delay parsing and plain-timestamp-in-title editing for the structured SCHEDULED/DEADLINE editor, Local Variables parsing, sync/conflict handling, and all three storage adapters (mocking `fetch` for GitHub/WebDAV so tests never touch the network, including `list()` for both -- GitHub's Contents-API array response, and WebDAV's hand-rolled PROPFIND multistatus XML parser covering cross-server namespace-prefix variation, percent-encoded filenames, and a real bug this coverage caught: self-reference detection for a subdirectory listing, which only worked correctly for the root before the fix), and the Markdown/HTML export converters (every inline formatting type, lists including nested/ordered/checkbox/description-list items, tables with a real org-syntax rule row correctly excluded rather than becoming a phantom row, blocks including a COMMENT block correctly dropped entirely, subtree-scope level normalization making the selected heading the new top level, HTML escaping specifically verified to neutralize a literal `<script>` tag rather than passing it through as real markup, and a real bug this coverage caught in the exporter's own escaping: several ordinary punctuation characters were being needlessly backslash-escaped in Markdown output, and a `doneKeywords`-styling bug in the HTML exporter where every TODO keyword would have rendered in the same "active" color regardless of the file's own `#+TODO:` sequence). `app.js` itself (UI wiring) isn't unit tested — it has no logic that doesn't ultimately call into the tested engine — but is checked for syntax validity as part of every change, and the capture UI flow, the More-menu restructuring, the data-loss fix, the Docs view, heading reordering, the action-menu stay-open/tap-to-close behavior, properties/block-content rendering across all four `#+STARTUP:` modes, archive-tree cycling (the swipe gesture correctly refusing to open an archived heading whether cascading from a parent or acting on it directly, matching real org-mode's unconditional rule -- a genuine bug fixed here, since the direct case previously opened the whole subtree -- while the chevron deliberately keeps working on an archived heading either way, this app's stand-in for Emacs's own separate force-open mechanisms that a touch UI has nowhere else to put), and the `org-contacts-anniversaries` agenda display (default and custom birthday-property configurations both verified), and the search panel (regex toggle, filter tokens combining correctly through real input events, property-match navigation correctly revealing drawers, and the invalid-regex error path) and the GitHub/WebDAV file browser (folder navigation, .org filtering, opening a file, the "type a path instead" fallback correctly falling all the way back to the normal button row rather than getting stuck on stale state -- a real bug this testing caught and fixed, and the listing-failure error path), the general editor (structured tags/priority/properties editing alongside SCHEDULED/DEADLINE, all six fields committing together on Save or discarding together on Cancel, verified including that Cancel genuinely discards everything and not just the timestamp fields), the `org-archive-subtree` move (same-file archiving under a target heading, cross-file archiving via a mocked GitHub backend with the archive file created fresh and correctly stamped, and the local-filesystem permission limitation producing a clear error with nothing lost from the current file), a real bug this coverage caught where the archived clone's stamped properties were correct but the `:ARCHIVE:` tag itself was never actually added -- meaning the Unarchive-button detection that depends on it would silently never have worked --, the restore/unarchive feature (the dynamic Archive/Unarchive button swap, the confirmation dialog naming the actual destination and the cancel case doing nothing, `org-archive-confirm: nil` skipping the dialog entirely, and the full restore transaction verified end to end: opening an archive file, tapping Unarchive, and confirming the original file is written with the restored heading correctly filed under its recorded `ARCHIVE_OLPATH` before the archived copy is removed), the restructured 6-column action menu and centered button grids at every menu size, and the keyboard shortcuts (focus navigation, fold-cycling, TODO-cycling, move/promote/demote, all correctly disabled while typing in a field, Ctrl/Cmd combinations never triggering a shortcut), file-link navigation (a headline-target and a text-search-target link each confirmed switching documents and landing on the correct heading, including one nested two levels deep with ancestors correctly expanded), and `org-agenda-files` (multi-file aggregation rendering immediately with the current file's own items and updating again once a configured file's async fetch resolves, the loading/error indicator, and the current-file-also-in-the-list dedup), and the File \u2192 Export flow (format choice, scope choice, the heading picker listing every heading regardless of fold state, a real bug this testing caught where the file menu never visually closed after a successful export since `render()` alone never touches that separate panel, and a real filename bug this testing caught where the source file's own extension wasn't stripped before appending the new one, producing "notes.org.md" instead of "notes.md") were additionally verified via DOM-stub integration tests exercising the real button/prompt/edit/insertion/fetch/swipe-gesture/keydown paths end to end, not just the underlying engine in isolation. The undo/redo history model (`src/undo-history.js`) and its line-diff engine (`src/text-diff.js`) are both unit tested in full \u2014 the history model specifically covering that a genuinely new edit after undoing discards the redo "future" while merely browsing the history list never discards anything, the exact distinction the whole feature depends on getting right \u2014 and the full undo/redo/History-panel flow was separately verified end to end through the real app: toggling a TODO state and undoing/redoing it correctly, opening the History panel and confirming its list and labels, the diff view showing the actual change, jumping directly to an arbitrary entry rather than stepping one at a time, a genuinely new edit after an undo correctly discarding the stale redo branch (down to confirming the entry count itself, not just a label), and history correctly resetting to empty on a freshly opened document rather than carrying over from whatever was open before.
