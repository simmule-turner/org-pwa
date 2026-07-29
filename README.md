# org-pwa

A single-file, offline-capable, mobile-first outliner for editing `.org` files in the browser. No server, no account required to use it locally — just a static site you can install as a PWA and point at a file.

This document describes what org-pwa actually does today, how to use it, and — since that's usually the more useful question for anyone coming from Emacs — **where it deliberately or incidentally diverges from real org-mode.**

---

## Contents

- [What org-pwa is (and isn't)](#what-org-pwa-is-and-isnt)
- [Getting started](#getting-started)
- [Editing your outline](#editing-your-outline)
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
- **Archive**: tags the heading `:ARCHIVE:` and stamps an `ARCHIVE_TIME` property with the current timestamp — real org's own archive-in-place convention (org's *other* archiving method, moving the subtree to a separate sibling file via `C-c C-x A`, isn't implemented). The button relabels to **Unarchive** once a heading is archived, which removes the tag; the `ARCHIVE_TIME` property is left in place rather than deleted, matching real org's own behavior (archiving again later just adds a fresh timestamp). `ARCHIVE_TIME` shows up in the general editor's properties list like any other property — editable or removable by hand from there if you ever need to.
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

## Lists, tables, and body text

- **Lists**: ordered, unordered, checkboxes (tap to cycle unchecked → in-progress → done), description lists (`term :: description`), and nested sub-lists. Tap a list item's text to reveal edit/add-item-below/delete actions.
- **Checkboxes**: cycle through the three states org supports. Progress cookies in a heading's title (`[3/8]` or `[40%]`, including the blank `[/]`/`[/8]` form) are recalculated automatically whenever a checkbox in that heading's subtree is toggled, added, or removed — matching real org-mode's default hierarchical counting (a heading's cookie counts checkboxes in its own list *and* every descendant heading's, not just its direct list).
- **Tables**: tap a cell to edit it directly. Row/column add and remove controls sit below the table, always visible (not tap-to-reveal, since you need them to actually use the table). `#+TBLFM:` formula lines are preserved on save but **not evaluated** — org-pwa doesn't compute tables, Emacs does.
- **Paragraphs**: tap text to reveal edit/add-paragraph-below/delete.

Every delete action asks for confirmation and states plainly that it can't be undone — there is no undo/redo in this app (see limitations).

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

**Regex mode**: the **[Regex]** button next to the search box switches from plain substring matching to a real regular expression, case-insensitive either way. Off (the default) is a literal, "find this exact text" search — a query containing `.` or `(` matches that character literally, with no escaping needed, which is what most searches actually want. On, the query is compiled as a JavaScript RegExp; an invalid pattern shows a clear error message in the results area rather than crashing or silently showing "no matches," so a mistyped pattern and a genuinely empty result set are never confused for each other.

**Filter tokens**: the same search box also recognizes a small set of structured tokens — a persistent hint (`Hints: +tag  -tag  todo:X  priority:A  key:value`), right-justified on the same line as the **[Regex]** button, so this doesn't have to be memorized. They combine with each other and with any leftover plain text as an implicit AND:

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
- Internal links resolve by heading title (`[[*Some Heading]]`), by `CUSTOM_ID` property (`[[#my-id]]`), or fall back to a title search for bare text — tapping one expands ancestors and scrolls to the target heading. Set a heading's `CUSTOM_ID` via the properties section of its general editor (see [Editing your outline](#editing-your-outline)) — it's a property like any other, no dedicated action for it.
- **`http://`/`https://` image links** render inline as actual images, if `#+STARTUP: inlineimages` is set (off by default — see below).
- **Local/relative image paths** always show as a `[image: path]` placeholder, since resolving them to real pixels would need a registered filesystem directory handle this app doesn't have.
- Links to other files (`file:./notes.org`) show a status message when tapped but don't navigate — multi-file navigation isn't built.

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

- **`org-agenda-start-on-weekday`** — which weekday the agenda's Week view starts on. `0` = Sunday, `1` = Monday (the default, matching real org), `2` = Tuesday, and so on through `6` = Saturday. An out-of-range value falls back to Monday rather than producing a nonsensical week.
- **`org-cycle-open-archived-trees`** — `t` or `nil` (Lisp booleans, not JavaScript truthiness — the string `"true"` is not `t` and won't be treated as one). `nil` (the default, matching real org) means an archived heading (tagged `:ARCHIVE:`) starts folded regardless of the `#+STARTUP:` visibility mode, and **the slide-left swipe gesture refuses to open it** — whether cascading into it from a parent or swiping directly on it. This matches real org-mode's own stated behavior exactly (confirmed against the actual org.el source: the `ARCHIVE` tag's docstring says plainly "An archived subtree does not open during visibility cycling"). The **chevron is different on purpose**: tapping it still opens an archived heading regardless of this setting. Real Emacs has separate force-open mechanisms outside of TAB/cycling for exactly this situation (`C-c C-TAB`, a universal-argument TAB, `outline-show-all`) — a touch UI with no keyboard modifiers doesn't have anywhere else to put that, so the chevron fills that role here instead of being a second implementation of the swipe gesture. Without it, archived content would have no way to ever become visible again. Set `org-cycle-open-archived-trees` to `t` to make archived headings behave like any other heading for the swipe gesture too — the chevron behavior doesn't change either way, since it was never gated by this setting.
- **`org-agenda-skip-comment-trees`** — `t` or `nil`. `t` (the default, matching real org) excludes "commented" headings from agenda views — a heading whose *title* starts with `# ` (or is just `#`), real org's own definition of a comment line applied to a heading title, e.g. `** # draft, not ready yet`. This is a heading-title convention, distinct from `#+STARTUP:`'s archive-cycling setting above and from a `#+BEGIN_COMMENT` block — it just means "don't show this on the agenda," while the heading stays a completely normal, visible entry in the outline itself. Set to `nil` to include commented headings in the agenda after all.
- **`org-agenda-skip-archived-trees`** — `t` or `nil`. `t` (the default, matching real org) excludes archived headings (tagged `:ARCHIVE:`) from agenda views. Set to `nil` to include them.
- **`org-contacts-birthday-property`** — which property key holds a heading's birthday/anniversary date+description for [`org-contacts-anniversaries`](#agenda). A plain string, not a Lisp boolean — e.g. `# org-contacts-birthday-property: EVENT`. Default `BIRTHDAY`, matching real org-contacts.el's own default exactly.
- **`org-use-sub-superscripts`** — one of `t`, `{}`, or `nil` (not a plain boolean — three real values, matching real org exactly). See [Inline text markup](#inline-text-markup) for what each one does. An unrecognized value falls back to `t`, real org's own default, rather than silently disabling the feature.

More variables will likely be added here over time; the parser itself is general-purpose (it captures whatever `# key: value` lines it finds in the block, whether or not this app currently acts on that particular key), so recognizing a new one is a small, additive change rather than a redesign.

---

## Archiving

Headings tagged `:ARCHIVE:` are treated specially for folding (see [Local Variables](#local-variables) above) throughout the outline view. Tap a heading's title, then **Archive**, to add the tag and stamp an `ARCHIVE_TIME` property — see [Editing your outline](#editing-your-outline) for the full behavior, including what Unarchive does and doesn't remove.

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

Scope, stated plainly: this covers the currently open file only. The underlying engine can aggregate across multiple documents at once (it takes a list of `{documentId, doc}` pairs, built with a future cross-file agenda in mind), but there's no multi-file-open UI yet to actually feed it more than one — see [Differences from Emacs org-mode](#differences-from-emacs-org-mode).

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
  "emptyLines": 1
}
```
- **`key`** — must be unique; shown next to the description in the picker.
- **`type`** — one of `item` (plain bullet), `checkitem` (checkbox item), `plain` (raw text, parsed as its own org fragment and merged in — the only type that can itself contain heading syntax, properties drawers, TODO keywords, etc.), or `table-line` (one row, appended to the nearest existing table under the target or creating a new one).
- **`olp`** — the outline path to insert into, found or created heading by heading. A segment wrapped in `%<FORMAT>` (e.g. `"%<%Y-%m>"`) expands dynamically — real org's own `,(format-time-string ...)` idea, translated into this app's %-escape syntax so a monthly table can target "2026-07" without you creating that heading by hand every month. Any other segment is used completely literally, with no escape processing at all.
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
- **Opening from GitHub or WebDAV browses a real folder/file listing** — no more needing to already know the exact path from some other source. Folders (📁) are tappable to navigate into; only `.org` files (📄) are shown among files, since that's the only thing this app can actually do anything with — other files in the same folder are filtered out rather than cluttering the list. An **↑ Up** button appears once you're below the root. GitHub uses its Contents API (the same one reads/writes already used); WebDAV uses the standard `PROPFIND` method, which most servers (Nextcloud, ownCloud, Apache `mod_dav`) support out of the box. If listing ever fails — a server that doesn't support `PROPFIND` well, a token without list permission on a specific folder — **"Type a path instead…"** is always available as a fallback, the same manual entry this replaced as the default path.
- **Save** always writes back to whichever backend the current file came from — you don't get asked again.
- **Save As** lets you pick a new destination, possibly on a different backend than the one you opened from.
- If a file has local edits that were never saved when you try to open it again, you're asked whether to **resume** those edits or **discard** them and load the current version — either choice actually opens the file; there's no dead-end confirmation.
- **Conflict handling**: if the on-disk/remote version changed since this app last synced it, Save asks you to keep your version or the other one, via a plain confirm dialog — there's no diff or merge view.

---

## Docs

Tap **More → ?** to read this very README inside the app — same "replaces the outline" treatment as Settings, not a popup. It's fetched once per session and cached in memory, so re-opening it doesn't re-fetch; it's also cached by the service worker, so it's available offline the same as everything else here. The table of contents links actually work — tapping one scrolls to that section within the doc, it doesn't try to navigate anywhere (there's no routing in this app). External links (anything not starting with `#`) open in a real new tab.

Rendered by a small, dependency-free markdown parser built specifically for this file — not a general-purpose implementation, just the subset this README actually uses (headings, bold/italic/inline code, fenced code blocks, bullet/numbered lists, links, horizontal rules). If you edit this README and add a construct it doesn't handle, the in-app Docs view is what'll look wrong first.

---

## Settings

Reached via the ⚙ button, which replaces the outline with the settings screen — same as switching to Text or Agenda view, not a popup over the outline. Tap ⚙ again, or any of File/More/View, to leave settings and return to whatever was showing before (there's no separate "Done" button; those are already the way out).

- **GitHub** — personal access token, repo owner, repo name, branch. Use a fine-grained token scoped to just that repo with Contents read/write only, not a broad classic token.
- **WebDAV** — server URL, username, password (an app-specific password if your server supports one, not your main account password). Most WebDAV servers don't send CORS headers by default; if Open/Save fails with a network error, that's very likely a server-side CORS setting to fix, not a bug in this app.
- **Appearance** — theme (System/Light/Dark), font (System/Serif/Monospace), and two independently adjustable font sizes on the same row: the main size (everything else) and **Other** (currently just tables, which have their own size rather than inheriting the main one — a table at the same size as prose text tends to feel cramped or oversized depending on column count).
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
- Priority cookies (`[#A]`) are parsed and preserved on round-trip, but there's **no dedicated UI to set or change one** — editing a heading's title through the outline UI treats the whole string as literal title text rather than re-parsing it for a priority cookie. Use the plain-text editor for this.

**Tags**
- Tags have dedicated UI now (the heading action menu), but it's a full-replace prompt (type the whole tag list, space-separated), not an org-mode-style per-tag add/remove or completion against tags used elsewhere in the file. One related quirk, still true: if you type something that *happens* to look like a tag — ending in `:word:` — into the *title* field specifically, it'll be re-interpreted as a tag on next parse, since org-pwa can't tell "literal colons in a title" from "a tag" once it's back in the file as text. Editing tags through the dedicated tag action doesn't have this problem.

**Properties**
- Property drawers have dedicated UI now — the heading action menu's properties editor shows every property as an editable `key: value` line. It's a full-replace text block, not a real org-mode-style per-property add/edit/delete with value completion, and there's no special handling or validation for the properties org itself treats specially (`CUSTOM_ID` still has its own separate, simpler action; things like `ARCHIVE_*` properties round-trip fine but aren't surfaced with any particular UI meaning here).

**Checkbox progress cookies**
- `[2/5]` or `[40%]` now auto-recalculates on toggle/add/delete, matching real org-mode's default hierarchical counting. One difference worth knowing: org-pwa always counts hierarchically (a heading's cookie counts its whole subtree); real Emacs org lets you override this per-heading with a `:COOKIE_DATA:` property (e.g. to count only direct children, or only todo-keyword items) — org-pwa doesn't read or act on `:COOKIE_DATA:` at all, so that override has no effect here.

**Tables**
- `#+TBLFM:` formula lines round-trip but are never evaluated. org-pwa is not a spreadsheet engine.

**Archiving**
- No UI action archives a heading for you (adds `:ARCHIVE:`) or moves it to a sibling archive file, even though the underlying engine has functions for both. Folding *respects* the archive tag once it's there; nothing in the UI *sets* it.

**Agenda**
- Day/Week/Month views, repeating-timestamp expansion, completed-item exclusion, SCHEDULED/DEADLINE carry-forward with a visible overdue count, and the delay/warning-period suffix making a deadline show up early are all built now (see [Agenda](#agenda)). What's still different from real org: it only ever looks at the currently open file (see "Single document at a time" below); the three repeater marks (`+`, `++`, `.+`) all expand identically here, since this is a read-only display with no notion of "when was this marked done" driving a catch-up/restart calculation; and there's no support for org's diary-sexp entries (`%%(diary-...)`), other than `org-contacts-anniversaries` (see [Agenda](#agenda)).

**No babel, no command palette.** These were scoped early on as possible future work and never built.

**No undo/redo.** Deletions ask for confirmation and are irreversible from within the app (your version-control/sync history is the real undo, if you have one). Headings *can* be reordered now (see above) — but only via the dedicated Move/Promote/Demote actions, not by dragging.

**Search** looks at the whole document (see [Searching](#searching)), with an optional regex mode, but no search-and-replace and no filtering the outline view down to just the matches (it's a separate results list, not a live-filtered tree).

**No export** — Markdown, HTML, and PDF export were discussed early on and never implemented. The plain-text editor gives you the raw org source, which is the only export path today.

**Single document at a time.** The storage engine supports tracking multiple open documents (built for a future cross-file agenda), but there's no UI for switching between several open files — opening a new one replaces what's showing.

**Conflict resolution** is a plain confirm dialog (keep mine / keep the other version), not a diff or three-way merge view.

---

## Known limitations / not built yet

Restated in one place for scanning:

- No Markdown/HTML/PDF export
- Search regex mode is JavaScript RegExp, not Emacs regex syntax — no search-and-replace, no filtered tree view
- `:COOKIE_DATA:` overrides for checkbox counting scope aren't read — counting is always hierarchical
- No table formula evaluation
- No undo/redo
- No drag-to-reorder (button-based Move/Promote/Demote actions exist instead — see [Editing your outline](#editing-your-outline))
- No multi-file switching UI (Agenda and the TODO view are therefore single-file, too — see [Agenda](#agenda))
- Agenda doesn't distinguish the three repeater marks (`+`/`++`/`.+`), and has no diary-sexp support
- Local/relative images show as a placeholder, never resolve to real pixels
- File-to-file links don't navigate
- Conflict resolution has no diff/merge view
- No File System Access support on iOS (by platform limitation, not a bug — see [Platform support](#platform-support))

## Development

Pure static site — `index.html` + ES modules, no build step. Serve any way you like (including directly from the filesystem via `python3 -m http.server`, or GitHub Pages).

Engine code (`src/`) and browser-specific adapters (`src-browser/`) are unit tested with Node's built-in test runner, zero external dependencies:

```
node --test
```

697 tests as of this writing, covering the parser, every editing operation, fold/visibility logic (including the `showall`/`showeverything` distinction — confirmed against real org-mode's actual documented behavior: properties and block content stay folded in `showall`, revealed only in `showeverything` — and a real bug this caught: `isFullyExpanded` never checked `bodyHidden`/`drawersHidden`, so a heading loaded with either still hidden was incorrectly treated as already fully expanded), checkbox-cookie recalculation, search (plain and regex modes, including an invalid-pattern error path; matching against properties/TODO keyword/priority/SCHEDULED/DEADLINE, not just prose text; and filter-token parsing and integration -- +tag/-tag/todo:/priority:/key:value, AND-combining with each other and with free text, no tag inheritance to children, and URL/time false-positive exclusions), agenda/repeater expansion (including week/day boundary alignment, SCHEDULED/DEADLINE carry-forward with delay-based early warning, commented/archived-heading exclusion, the date-independent TODO view, and `org-contacts-anniversaries` — property parsing (including the nil-year and unparseable-value cases), age calculation and the "(xx)" unknown-age display, per-occurrence expansion across a multi-year range, the trigger line activating the scan regardless of its own position in the file, and full `buildAgendaItems` integration including a custom `org-contacts-birthday-property` key), correct resolution of a file with multiple `#+TODO:` lines, capture-template expansion and insertion (all four types, OLP target resolution, the sequential-table-mutation bug this coverage originally caught, and a serious data-loss bug where editing a just-captured item could silently overwrite unrelated pre-existing content elsewhere in the same heading), the in-app Docs view's markdown parser (including against this actual README's real content, catching a slug-generation mismatch against GitHub's own anchor algorithm that would otherwise have silently broken a table-of-contents link; GFM pipe table parsing with alignment; and a real bug this coverage caught: an indented fenced code block, nested under a bullet list item exactly as this README's own `org-contacts-anniversaries` example is, silently fell through to garbled paragraph text because the fence-detection regex required zero leading whitespace), heading move/promote/demote (including whole-subtree relocation, recursive level shifts, and every natural-boundary no-op case), priority setting/clearing/validation and its round-trip through serialization, horizontal-rule detection (including that it correctly interrupts a paragraph rather than being swallowed as literal text -- a real bug this coverage caught), inline sub/superscript parsing across all three `org-use-sub-superscripts` modes (including disambiguation from the pre-existing `_underline_` marker, which shares the same `_` character), timestamp building/delay parsing and plain-timestamp-in-title editing for the structured SCHEDULED/DEADLINE editor, Local Variables parsing, sync/conflict handling, and all three storage adapters (mocking `fetch` for GitHub/WebDAV so tests never touch the network, including `list()` for both -- GitHub's Contents-API array response, and WebDAV's hand-rolled PROPFIND multistatus XML parser covering cross-server namespace-prefix variation, percent-encoded filenames, and a real bug this coverage caught: self-reference detection for a subdirectory listing, which only worked correctly for the root before the fix). `app.js` itself (UI wiring) isn't unit tested — it has no logic that doesn't ultimately call into the tested engine — but is checked for syntax validity as part of every change, and the capture UI flow, the More-menu restructuring, the data-loss fix, the Docs view, heading reordering, the action-menu stay-open/tap-to-close behavior, properties/block-content rendering across all four `#+STARTUP:` modes, archive-tree cycling (the swipe gesture correctly refusing to open an archived heading whether cascading from a parent or acting on it directly, matching real org-mode's unconditional rule -- a genuine bug fixed here, since the direct case previously opened the whole subtree -- while the chevron deliberately keeps working on an archived heading either way, this app's stand-in for Emacs's own separate force-open mechanisms that a touch UI has nowhere else to put), and the `org-contacts-anniversaries` agenda display (default and custom birthday-property configurations both verified), and the search panel (regex toggle, filter tokens combining correctly through real input events, property-match navigation correctly revealing drawers, and the invalid-regex error path) and the GitHub/WebDAV file browser (folder navigation, .org filtering, opening a file, the "type a path instead" fallback correctly falling all the way back to the normal button row rather than getting stuck on stale state -- a real bug this testing caught and fixed, and the listing-failure error path), the general editor (structured tags/priority/properties editing alongside SCHEDULED/DEADLINE, all six fields committing together on Save or discarding together on Cancel, verified including that Cancel genuinely discards everything and not just the timestamp fields), the Archive/Unarchive action, the restructured 6-column action menu and centered button grids at every menu size, and the keyboard shortcuts (focus navigation, fold-cycling, TODO-cycling, move/promote/demote, all correctly disabled while typing in a field, Ctrl/Cmd combinations never triggering a shortcut) were additionally verified via DOM-stub integration tests exercising the real button/prompt/edit/insertion/fetch/swipe-gesture/keydown paths end to end, not just the underlying engine in isolation.
