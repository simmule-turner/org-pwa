// The Tangle command: the document's source blocks written out as files (see src/tangle.js), handed over as one file
// or, when there are several or one needs a folder or a file mode, as a zip.
import { createZip } from '../src/zip-writer.js';
import { tangleDocument } from '../src/tangle.js';
import { S } from './app-state.js';
import { suggestedSaveAsName } from './documents-io.js';
import { setStatus } from './editing.js';
import { saveOut } from './save-out.js';

const baseOf = (path) => String(path).split('/').pop();

export function tangleCurrentDocument() {
  const documentName = baseOf(suggestedSaveAsName('untitled.org')).replace(/(\.org)?$/, '.org');
  let result;
  try {
    result = tangleDocument(S.state.doc, { documentName });
  } catch (err) {
    setStatus('Tangle failed: ' + err.message);
    return;
  }
  if (!result.files.length) {
    setStatus('Nothing to tangle: no source block has a :tangle header argument (try :tangle yes, or #+PROPERTY: header-args :tangle yes).');
    return;
  }
  const note = result.warnings.length ? ` (${result.warnings.length} warning${result.warnings.length === 1 ? '' : 's'}: ${result.warnings[0]})` : '';
  const single = result.files.length === 1 && !result.files[0].path.includes('/') && !result.files[0].mode;
  if (single) {
    const f = result.files[0];
    saveOut(f.path, f.text, 'text/plain');
    setStatus(`Tangled ${f.blockCount} block${f.blockCount === 1 ? '' : 's'} into ${f.path}${note}`);
    return;
  }
  const zip = createZip(result.files.map((f) => ({ name: f.path, content: f.text, mode: f.mode || 0o644 })));
  saveOut(documentName.replace(/\.org$/, '') + '-tangled.zip', zip, 'application/zip');
  setStatus(`Tangled ${result.blockCount} blocks into ${result.files.length} files (zip)${note}`);
}
