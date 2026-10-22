// @ts-check
// The diary file (diary-file) for the Agenda: read once from its GitHub, WebDAV or local file, with the files it includes when
// diary-list-entries-hook names diary-include-other-diary-files. A tap on the Agenda's refresh button reads it again.
import { diaryOptionsFromVars, includedFiles } from '../src/diary-file.js';
import { serializeOrg } from '../src/org-parser.js';
import { isPlainTextFile } from '../src/plain-file.js';
import { getAgendaIncludeDiary, getDiaryFile } from '../src/local-variables.js';
import { filesystemAdapter, githubAdapter, webdavAdapter } from './adapters.js';
import { scheduleCalendarSync } from './calendar-sync.js';
import { S } from './app-state.js';
import { platform } from './platform.js';
import { render } from './render.js';
import { renderSettingsView } from './settings-view.js';

/** @typedef {{ key: string, status: 'loading' | 'ready' | 'error', spec: string, text: string, included: { text: string, spec: string }[], error: string }} DiaryState */
/** @type {{ diary: DiaryState | null, generation: number, vars: Record<string, string> | null }} */
const loaded = { diary: null, generation: 0, vars: null };

/** The variables the diary is read with: the open document's, else the global ones.
 * @returns {Record<string, string>} */
function currentVars() {
  if (S.state.doc && isPlainTextFile(S.state.documentId, S.state.storageKind)) {
    // a plain text file (the diary itself, say) has no variables of its own: the last Org file's still apply
    return loaded.vars || /** @type {Record<string, string>} */ (S.globalVariables) || {};
  }
  const vars = /** @type {Record<string, string>} */ (S.state.doc ? S.state.localVariables : S.globalVariables) || {};
  if (S.state.doc) loaded.vars = vars;
  return vars;
}

/**
 * Reads one file named like an agenda file ("github:diary").
 * @param {string} spec
 * @param {boolean} prompt  whether a local file may ask for its permission (only a tap on refresh does)
 * @returns {Promise<string>}
 */
export async function readSpec(spec, prompt) {
  const colon = spec.indexOf(':');
  const scheme = spec.slice(0, colon);
  const path = spec.slice(colon + 1);
  if (scheme === 'local') {
    const access = await filesystemAdapter.access(path);
    if (access === 'none') {
      throw new Error(
        platform.attachments.supported()
          ? `"${path}" hasn't been opened on this device yet. Open it once with File → Open → Local file.`
          : `"${path}" hasn't been opened on this device. Open it with File → Open → Local file.`
      );
    }
    if (access !== 'granted' && !prompt) throw new Error(`"${path}" needs permission to be read. Tap ↻ in the Agenda to allow it.`);
    const result = await filesystemAdapter.read(path, { prompt });
    if (!result) throw new Error(`"${path}" not found.`);
    return result.content;
  }
  const adapter = scheme === 'github' ? githubAdapter : webdavAdapter;
  const result = await adapter.read(path);
  if (!result) throw new Error(`"${path}" not found.`);
  return result.content;
}

/** The file an `#include "name"` line means, as an agenda-file name: a name with a scheme is used as it is, any other is looked for
 *  next to the file that includes it (a leading "/" means from the top of the same place).
 * @param {string} name
 * @param {string} fromSpec */
function resolveInclude(name, fromSpec) {
  if (/^(github|webdav|local):/.test(name)) return name;
  const colon = fromSpec.indexOf(':');
  const scheme = fromSpec.slice(0, colon);
  const dir = fromSpec.slice(colon + 1).split('/').slice(0, -1);
  const parts = name.startsWith('/') ? name.slice(1).split('/') : [...dir, ...name.split('/')];
  const out = [];
  for (const part of parts) {
    if (part === '..') out.pop();
    else if (part && part !== '.') out.push(part);
  }
  return `${scheme}:${out.join('/')}`;
}

/**
 * Reads the diary and the files it includes (to three levels, each once).
 * @param {string} spec
 * @param {boolean} withIncludes
 * @param {boolean} prompt
 */
async function readAll(spec, withIncludes, prompt) {
  const text = await readSpec(spec, prompt);
  /** @type {{ text: string, spec: string }[]} */ const included = [];
  if (withIncludes) {
    const seen = new Set([spec]);
    /** @param {string} from @param {string} body @param {number} depth */
    const follow = async (from, body, depth) => {
      if (depth > 3) return;
      for (const name of includedFiles(body, diaryOptionsFromVars(currentVars()))) {
        const next = resolveInclude(name, from);
        if (seen.has(next)) continue;
        seen.add(next);
        let nextText;
        try {
          nextText = await readSpec(next, prompt);
        } catch {
          continue; // a file that cannot be read adds nothing, as in Emacs
        }
        included.push({ text: nextText, spec: next });
        await follow(next, nextText, depth + 1);
      }
    };
    await follow(spec, text, 1);
  }
  return { text, included };
}

/**
 * Starts reading the diary if it is wanted (org-agenda-include-diary and diary-file) and not read yet. Cheap to call on every
 * render; a change of diary-file, or of whether includes are followed, reads again.
 * @param {{ prompt?: boolean, force?: boolean }} [options]
 */
export function ensureDiaryLoaded({ prompt = false, force = false } = {}) {
  const vars = currentVars();
  const spec = getAgendaIncludeDiary(vars) ? getDiaryFile(vars) : '';
  if (!spec) {
    loaded.diary = null;
    return;
  }
  const withIncludes = diaryOptionsFromVars(vars).hooks?.includes('diary-include-other-diary-files') === true;
  const key = `${spec}|${withIncludes}`;
  if (!force && loaded.diary && loaded.diary.key === key) return;
  const mine = ++loaded.generation;
  loaded.diary = { key, status: 'loading', spec, text: '', included: [], error: '' };
  readAll(spec, withIncludes, prompt)
    .then(({ text, included }) => {
      if (mine === loaded.generation) loaded.diary = { key, status: 'ready', spec, text, included, error: '' };
    })
    .catch((/** @type {Error} */ err) => {
      if (mine === loaded.generation) loaded.diary = { key, status: 'error', spec, text: '', included: [], error: err.message };
    })
    .finally(() => {
      if (mine !== loaded.generation) return;
      if (S.currentView === 'agenda' || S.currentView === 'tasklist') render();
      if (S.settingsOpen) renderSettingsView();
      scheduleCalendarSync(); // the diary's entries are in the calendar too
    });
}

/** Reads the diary again (the Agenda's refresh button). */
export function refreshDiary() {
  ensureDiaryLoaded({ prompt: true, force: true });
}

/** What the Agenda builds the Diary from, or null when it is off, still loading or failed.
 * @returns {import('../src/agenda-diary.js').DiarySource | null} */
export function diarySource() {
  const vars = currentVars();
  if (!getAgendaIncludeDiary(vars)) return null;
  ensureDiaryLoaded();
  const { diary } = loaded;
  if (!diary || diary.status !== 'ready') return null;
  return { text: openBufferText(diary.spec) ?? diary.text, included: diary.included.map((f) => ({ text: openBufferText(f.spec) ?? f.text })), options: diaryOptionsFromVars(vars) };
}

/** What to say about the diary above the Agenda: that it is loading, or why it could not be read; '' when there is nothing to say.
 * @returns {{ loading: boolean, error: string }} */
export function diaryStatus() {
  const vars = currentVars();
  if (!getAgendaIncludeDiary(vars)) return { loading: false, error: '' };
  if (!getDiaryFile(vars)) return { loading: false, error: 'org-agenda-include-diary is on, but diary-file is not set.' };
  ensureDiaryLoaded();
  const { diary } = loaded;
  return { loading: diary?.status === 'loading', error: diary?.status === 'error' ? `diary "${getDiaryFile(vars)}": ${diary.error}` : '' };
}

/** The storage kind a diary-file name's scheme means.
 * @param {string} scheme */
function kindOf(scheme) {
  return scheme === 'local' ? 'filesystem' : scheme;
}

/** "github:diary" as its pieces: the scheme, the storage kind and the path. @param {string} spec */
export function parseDiarySpec(spec) {
  const colon = spec.indexOf(':');
  const scheme = spec.slice(0, colon);
  return { scheme, kind: kindOf(scheme), path: spec.slice(colon + 1) };
}

/** The text of the file when it is open in a tab, with whatever has been typed into it; null when it is not open.
 * @param {string} spec
 * @returns {string | null} */
function openBufferText(spec) {
  const { kind, path } = parseDiarySpec(spec);
  if (S.state.doc && S.state.documentId === path && S.state.storageKind === kind) return serializeOrg(S.state.doc);
  const session = S.documentSessions.find((/** @type {import('../src/types.js').TabSession} */ s) => s.tabId !== S.activeTabId && s.state && s.state.doc && s.state.documentId === path && s.state.storageKind === kind);
  return session ? serializeOrg(session.state.doc) : null;
}

/** The files the diary is made of, the diary first, then the files it includes in the order the Agenda reads them; [] when it is not read.
 * @returns {string[]} */
export function diarySpecs() {
  const { diary } = loaded;
  return diary && diary.status === 'ready' ? [diary.spec, ...diary.included.map((f) => f.spec)] : [];
}

/** Whether a document is the diary file (or one it includes).
 * @param {string} documentId @param {string | null} storageKind */
export function isDiaryDocument(documentId, storageKind) {
  const spec = getDiaryFile(currentVars());
  if (!spec || !documentId) return false;
  const specs = [spec, ...diarySpecs().slice(1)];
  return specs.some((s) => {
    const parsed = parseDiarySpec(s);
    return parsed.path === documentId && parsed.kind === storageKind;
  });
}

/** The Agenda reads a diary file again once it is saved. @param {string} documentId @param {string | null} storageKind */
export function diarySaved(documentId, storageKind) {
  if (isDiaryDocument(documentId, storageKind)) ensureDiaryLoaded({ force: true });
}
