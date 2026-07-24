# org-pwa

A single-file, offline-capable, mobile-first outliner for editing `.org` files in the browser. No server, no account required to use it locally — just a static site you can install as a PWA and point at a file.

This document describes what org-pwa actually does today, how to use it, and — since that's usually the more useful question for anyone coming from Emacs — **where it deliberately or incidentally diverges from real org-mode.**

---

## Contents

- [What org-pwa is (and isn't)](#what-org-pwa-is-and-isnt)
- [Getting started](#getting-started)
- [Editing your outline](#editing-your-outline)
- [Lists, tables, and body text](#lists-tables-and-body-text)
- [Searching](#searching)
- [Links and images](#links-and-images)
- [Folding and `#+STARTUP`](#folding-and-startup)
- [Local Variables](#local-variables)
- [Archiving](#archiving)
- [The plain-text editor](#the-plain-text-editor)
- [Agenda](#agenda)
- [TODO view](#todo-view)
- [File management](#file-management)
- [Settings](#settings)
- [Offline behavior and sync](#offline-behavior-and-sync)
- [Platform support](#platform-support)
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
   - **GitHub** — reads/writes a file in a repo you've configured in Settings.
   - **WebDAV** — reads/writes a file on a WebDAV server you've configured in Settings.
   - **Import file** (shown instead of "Local file" on platforms without File System Access, i.e. everything on iOS) — picks a file once and reads it; there's no live link back to the original, so Save downloads a new copy you place back manually. See [Platform support](#platform-support).
3. Edit. Every edit is applied instantly to an in-memory copy and cached locally in the background — nothing is lost if you close the tab, even before you hit Save.
4. Tap **Save** when you want it written back to wherever it came from. **Save As** lets you choose a different destination or backend.

The header shows the current filename, which backend it came from, and a **`• modified`** indicator whenever there are edits that haven't been saved yet.

---

## Editing your outline

- **Headings**: tap the title text to reveal a row of actions — edit title, edit the heading's own body text, add a table, add a sub-heading, set a link ID, edit tags, edit properties, set SCHEDULED/DEADLINE, delete. Nothing is shown until you tap; this keeps the row itself uncluttered.
- **TODO state**: tap the TODO badge to cycle through the sequence defined by `#+TODO:` (or `TODO`/`DONE` by default).
- **Fold/unfold**: tap the chevron to toggle a heading's whole subtree, or swipe left on a heading to cycle through collapsed → children-only → fully expanded → collapsed.
- **Tags**: the tag action prompts for a space-separated list (`urgent home01`) and replaces the heading's tags outright.
- **Properties**: the properties action opens the whole `:PROPERTIES:` drawer as one editable block of `key: value` lines — add a line for a new property, remove a line to delete one, edit a value in place. This is a full replace on save, not a merge: a property you delete from the text stays deleted.
- **SCHEDULED / DEADLINE / plain timestamp** (the 📅 action): a structured form, not a raw text box — real date and time pickers, a repeat selector (mark + amount + unit: every N hours/days/weeks/months/years), and an optional "warn ahead by" delay (real org syntax, e.g. `-3d`, for seeing a deadline coming a few days early instead of only on the day it's due). SCHEDULED, DEADLINE, and a plain timestamp (see [Agenda](#agenda) for the difference — a plain timestamp doesn't carry forward and lives in the title, not a planning line) are three independent instances of the exact same form — set any combination, and Cancel discards without touching the heading. Each has its own **Clear** button for explicitly removing that timestamp, separate from the Save/Cancel that applies to the whole form. This is what actually builds the underlying `SCHEDULED:`/`DEADLINE:`/title-timestamp syntax, so there's no need to know org's raw format to use it correctly.
- **Reordering and priority**: not directly editable through the outline UI — see [Differences from Emacs org-mode](#differences-from-emacs-org-mode).

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

## Searching

Tap the 🔍 button to search the whole file — headings, tags, paragraphs, list items, table cells, and block content, case-insensitively. Results update live as you type and show a short snippet with the match, grouped under the heading each one belongs to.

Search looks at the entire document regardless of current fold state — a match inside a collapsed heading, or inside body text hidden by `#+STARTUP: content`, still shows up. Tapping a result expands whatever's necessary to actually reveal it (including the target heading's own body, not just its ancestors) and scrolls to it with a brief highlight.

---

## Links and images

- **`[[target][description]]`** links render as tappable text.
- Internal links resolve by heading title (`[[*Some Heading]]`), by `CUSTOM_ID` property (`[[#my-id]]`), or fall back to a title search for bare text — tapping one expands ancestors and scrolls to the target heading.
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
- **`content`** — every heading line unfolded, but body text (paragraphs/lists/tables) stays hidden until you tap a heading open — a genuinely separate visibility axis from "is this heading's subtree folded," not just an alias for `showall`.
- **`showall` / `showeverything`** — fully expanded, body included.

These defaults are chosen to match real Emacs org-mode's actual out-of-the-box behavior (no `#+STARTUP` line means fully shown, not folded), not an arbitrary choice. (Archived-heading cycling behavior used to be documented here as `#+STARTUP: archived`/`noarchived` — that was a mistake; it's not real org syntax. See [Local Variables](#local-variables) for the actual, corrected mechanism.)

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

- **`org-agenda-start-on-weekday`** — which weekday the agenda's Week view starts on. `0` = Sunday, `1` = Monday (the default, matching real org), `2` = Tuesday, and so on through `6` = Saturday. An out-of-range value falls back to Monday rather than producing a nonsensical week.
- **`org-cycle-open-archived-trees`** — `t` or `nil` (Lisp booleans, not JavaScript truthiness — the string `"true"` is not `t` and won't be treated as one). `nil` (the default, matching real org) means an archived heading (tagged `:ARCHIVE:`) starts folded regardless of the `#+STARTUP:` visibility mode, and swiping to expand a subtree skips cascading into archived children, though you can still tap directly into one. Set to `t` to make archived headings behave like any other heading for folding purposes.
- **`org-agenda-skip-comment-trees`** — `t` or `nil`. `t` (the default, matching real org) excludes "commented" headings from agenda views — a heading whose *title* starts with `# ` (or is just `#`), real org's own definition of a comment line applied to a heading title, e.g. `** # draft, not ready yet`. This is a heading-title convention, distinct from `#+STARTUP:`'s archive-cycling setting above and from a `#+BEGIN_COMMENT` block — it just means "don't show this on the agenda," while the heading stays a completely normal, visible entry in the outline itself. Set to `nil` to include commented headings in the agenda after all.
- **`org-agenda-skip-archived-trees`** — `t` or `nil`. `t` (the default, matching real org) excludes archived headings (tagged `:ARCHIVE:`) from agenda views. Set to `nil` to include them.

More variables will likely be added here over time; the parser itself is general-purpose (it captures whatever `# key: value` lines it finds in the block, whether or not this app currently acts on that particular key), so recognizing a new one is a small, additive change rather than a redesign.

---

## Archiving

Headings tagged `:ARCHIVE:` are treated specially for folding (see [Local Variables](#local-variables) above) throughout the outline view. There is currently **no UI action to add or remove the archive tag** — you archive a heading by adding `:ARCHIVE:` yourself, most easily via the plain-text editor.

---

## The plain-text editor

Tap **View → Text** to switch the entire outline view for one full-width textarea containing the whole document as raw org text — everything, including `#+STARTUP:`, `#+TODO:`, a [Local Variables](#local-variables) block, and any syntax the structured view still doesn't have dedicated UI for (priority cookies, archive tags). Tap **View → Org** to switch back; the text is reparsed from scratch at that point, so any changes — including to `#+STARTUP`/`#+TODO`/Local Variables — take effect immediately.

This is the escape hatch for everything the tap-driven UI doesn't cover yet.

---

## Agenda

Tap **View → Agenda** for a list of everything with a date attached, grouped into Day, Week, or Month views. **‹**/**›** step the view backward or forward by whatever unit is currently active — a day, a week, or a month — and **Today** jumps back to the current date. Tapping an item switches back to the Org view and scrolls straight to it.

**Week view always aligns to an actual calendar week** — Monday through Sunday by default (configurable, see below), regardless of which day of that week you happened to open the agenda on. It resolves to the same 7-day window whether you're looking at it from Monday or Friday, not "whatever day is currently open, plus the next six."

Three kinds of dated entry show up, and **they behave differently from each other in an important way** — this is real org-mode semantics, not an app-specific choice:
- **`SCHEDULED:`** — when you intend to do something. Shows on its date, and if the heading isn't marked done, **keeps reappearing on every day after that** (as overdue) right up through today, until you mark it done. This is what makes "I meant to do this last week and never did" actually visible instead of quietly vanishing off the agenda the day after its original date. The overdue count shows directly on the item ("3 days overdue").
- **`DEADLINE:`** — same carry-forward behavior as SCHEDULED once the date passes with the heading still not done. It also supports a **delay/warning-period** suffix (real org syntax: `DEADLINE: <2026-01-10 Sat -3d>`), which makes it start appearing *before* its date too — 3 days early in that example, showing "due in 3 days," counting down each day until it either gets marked done or becomes overdue (at which point it switches to counting up instead). Without a delay, a DEADLINE only ever shows on its date or after — real org's own default.
- **A plain, *active* timestamp written directly in a heading's title** — the standard org convention for tracking something like a recurring birthday right on its own heading line (`**** Jennifer <1989-11-02 Thu +1y>`), a genuinely separate source from SCHEDULED/DEADLINE, not a fallback for it. This one does **not** carry forward, ever, regardless of done status — matching real org's own distinction ("if you didn't go to your doctor's appointment yesterday, that doesn't mean you still have one today"). Only counted when the heading has no SCHEDULED/DEADLINE of its own (to avoid a confusing double entry), and only *active* `<...>` timestamps count — an inactive `[...]` one is excluded, same reasoning: a dated record, not a reminder. This only looks at the title, not body text, to avoid pulling in unrelated dates mentioned in ordinary prose elsewhere in a journal-heavy file.

Other behavior:
- **Completed items are excluded** — using the file's own `#+TODO:` sequence (whatever keywords you've actually defined as "done"), not a hardcoded check for the literal word `DONE`.
- **Repeating timestamps expand properly**, for any of the sources above. `<1989-11-02 Thu +1y>` shows up every year on the anniversary within whatever range is currently displayed, not just its one literal stored date — switch to Month view and it correctly shows up in whichever month it falls in. Carry-forward, delay, and repetition don't combine — a *repeating* SCHEDULED/DEADLINE shows on its own repeat dates only, with no additional carry-forward or early-warning between them (org's actual interaction between a repeater and completion history is more involved than a read-only agenda needs to model).
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

## File management

**File menu**: New, Open, Save, Save As.

- **New** and **Open** ask which backend to use (Local/Import, GitHub, or WebDAV).
- **Save** always writes back to whichever backend the current file came from — you don't get asked again.
- **Save As** lets you pick a new destination, possibly on a different backend than the one you opened from.
- If a file has local edits that were never saved when you try to open it again, you're asked whether to **resume** those edits or **discard** them and load the current version — either choice actually opens the file; there's no dead-end confirmation.
- **Conflict handling**: if the on-disk/remote version changed since this app last synced it, Save asks you to keep your version or the other one, via a plain confirm dialog — there's no diff or merge view.

---

## Settings

Reached via the ⚙ button, which replaces the outline with the settings screen — same as switching to Text or Agenda view, not a popup over the outline. Tap ⚙ again, or any of File/Search/+/View, to leave settings and return to whatever was showing before (there's no separate "Done" button; those are already the way out).

- **GitHub** — personal access token, repo owner, repo name, branch. Use a fine-grained token scoped to just that repo with Contents read/write only, not a broad classic token.
- **WebDAV** — server URL, username, password (an app-specific password if your server supports one, not your main account password). Most WebDAV servers don't send CORS headers by default; if Open/Save fails with a network error, that's very likely a server-side CORS setting to fix, not a bug in this app.
- **Appearance** — theme (System/Light/Dark) and font (System/Serif/Monospace, adjustable size).

---

## Offline behavior and sync

Every edit applies to an in-memory copy and is cached to IndexedDB in the background immediately — the UI never waits on a write to feel responsive, and nothing is lost by closing the tab before hitting Save. Writing back to disk/GitHub/WebDAV only happens on an explicit Save. Local File System Access reads are unaffected by network connectivity (it's not a network call); GitHub and WebDAV obviously do need a connection.

---

## Platform support

Local file access (the "Local" option, with a live, writable handle) requires the File System Access API — Chrome and Edge, desktop or Android. **No browser on iOS supports this**, because Apple requires every iOS browser to use WebKit, which has never implemented it — that's not fixable by switching browsers on that platform.

On unsupported platforms, **Import** replaces "Local": pick a file once via the native file picker, edit it, and Save triggers a download of the new version, which you then move into place yourself (e.g. overwriting the original in the Files app). GitHub and WebDAV work the same everywhere, including iOS, since they're plain HTTPS requests rather than filesystem access.

---

## Differences from Emacs org-mode

This is the section to read if you know org-mode well and want to know exactly where org-pwa is a subset, a simplification, or just plain different.

**Interaction model**
- No keybindings at all. Everything is tap-to-reveal actions and gestures (swipe-left to cycle fold). There's no command equivalent to `M-x` or a keyboard-driven workflow, by design — this is built for touch first.

**Folding**
- org-pwa's fold model is two flags per heading (`collapsed`, and a separate `bodyHidden`), not Emacs's richer subtree-visibility state machine. It's enough to implement `overview`/`content`/`showall`/`showeverything` correctly, but doesn't have a direct equivalent to cycling through every intermediate visibility Emacs supports.
- `content` mode's real org semantics also fold away **drawers** specifically (`:PROPERTIES:` etc.) independent of body text; org-pwa doesn't have a separate drawer-visibility concept, so drawers follow the same `bodyHidden` flag as everything else in a heading's body.

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
- Day/Week/Month views, repeating-timestamp expansion, completed-item exclusion, SCHEDULED/DEADLINE carry-forward with a visible overdue count, and the delay/warning-period suffix making a deadline show up early are all built now (see [Agenda](#agenda)) — this used to be engine-only with no UI at all, and repeaters and delays used to be parsed but never expanded or acted on. What's still different from real org: it only ever looks at the currently open file (see "Single document at a time" below); the three repeater marks (`+`, `++`, `.+`) all expand identically here, since this is a read-only display with no notion of "when was this marked done" driving a catch-up/restart calculation; and there's no support for org's diary-sexp entries (`%%(diary-...)`) at all.

**No capture templates, no babel, no command palette.** These were scoped early on as possible future work and never built.

**No undo/redo, no drag-to-reorder headings.** Deletions ask for confirmation and are irreversible from within the app (your version-control/sync history is the real undo, if you have one).

**Search** looks at the whole document (see [Searching](#searching)), but it's substring matching only — no regex, no search-and-replace, no filtering the outline view down to just the matches (it's a separate results list, not a live-filtered tree).

**No export** — Markdown, HTML, and PDF export were discussed early on and never implemented. The plain-text editor gives you the raw org source, which is the only export path today.

**Single document at a time.** The storage engine supports tracking multiple open documents (built for a future cross-file agenda), but there's no UI for switching between several open files — opening a new one replaces what's showing.

**Conflict resolution** is a plain confirm dialog (keep mine / keep the other version), not a diff or three-way merge view.

---

## Known limitations / not built yet

Restated in one place for scanning:

- No capture templates
- No Markdown/HTML/PDF export
- No archive UI action (tag it manually via plain-text mode)
- No priority editing UI (tags, properties, and SCHEDULED/DEADLINE now have dedicated UI — see above)
- Search is substring-only: no regex, no search-and-replace, no filtered tree view
- `:COOKIE_DATA:` overrides for checkbox counting scope aren't read — counting is always hierarchical
- No table formula evaluation
- No undo/redo
- No drag-to-reorder
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

445 tests as of this writing, covering the parser, every editing operation, fold/visibility logic, checkbox-cookie recalculation, search, agenda/repeater expansion (including week/day boundary alignment, SCHEDULED/DEADLINE carry-forward with delay-based early warning, commented/archived-heading exclusion, and the date-independent TODO view), correct resolution of a file with multiple `#+TODO:` lines, timestamp building/delay parsing and plain-timestamp-in-title editing for the structured SCHEDULED/DEADLINE editor, Local Variables parsing, sync/conflict handling, and all three storage adapters (mocking `fetch` for GitHub/WebDAV so tests never touch the network). `app.js` itself (UI wiring) isn't unit tested — it has no logic that doesn't ultimately call into the tested engine — but is checked for syntax validity as part of every change.
