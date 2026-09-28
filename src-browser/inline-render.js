// Extracted from app.js: inline render.
import { isAudioFilename } from '../src/attach.js';
import { findFootnoteDefinition, guessAudioMimeType, guessImageMimeType, isExternalUrl, resolveAttachmentTarget, resolveImagePath, resolveLinkTarget } from '../src/link-resolve.js';
import { getUseSubSuperscripts } from '../src/local-variables.js';
import { S } from './app-state.js';
import { openAttachmentLink } from './attachments-flow.js';
import { INLINE_LINK_ATTR } from './constants.js';
import { openFileLink } from './documents-io.js';
import { setStatus } from './editing.js';
import { activeDiskAdapter } from './external-sync.js';
import { navigateToHeading } from './navigation.js';
import { imagePlaceholder, renderLatexNode } from './render-helpers.js';
import { render } from './render.js';
import { imageDataUrlCache } from './singletons.js';

export function renderImageNode(node, heading = null) {
  const inlineImagesOn = S.state.startupConfig && S.state.startupConfig.imageVisibility === 'inlineimages';

  if (inlineImagesOn && /^https?:\/\//i.test(node.target)) {
    const img = document.createElement('img');
    img.src = node.target;
    img.alt = '';
    img.style.maxWidth = '100%';
    img.style.display = 'block';
    img.style.margin = '4px 0';
    img.style.borderRadius = '4px';
    return img;
  }

  const isAttachment = /^attachment:/i.test(node.target);

  // A local/relative image, an explicit file:/github:/webdav: scheme,
  // or an attachment: link -- only resolvable to real pixels when the
  // CURRENT document's own backend can read an arbitrary path without
  // a fresh picker gesture (GitHub, WebDAV) -- attachments themselves
  // are only ever stored on those same two backends in the first
  // place (see src/attach.js's own docs), so this same gate already
  // covers both cases correctly. Local filesystem/iOS import hit the
  // same File System Access permission wall already documented for
  // archiving and capture-to-file, so those keep the honest
  // placeholder below rather than attempting (and failing) a read.
  const canReadArbitraryPaths = S.state.storageKind === 'github' || S.state.storageKind === 'webdav';
  if (inlineImagesOn && canReadArbitraryPaths && (isAttachment || !isExternalUrl(node.target))) {
    const resolvedPath = isAttachment ? resolveAttachmentTarget(S.state.doc, heading, node.target, S.state.documentId) : resolveImagePath(node.target, S.state.documentId);
    if (!resolvedPath) {
      // An attachment: link with no owning heading in its own
      // ancestor chain carrying an :ID: at all -- nothing to resolve
      // against (a hand-written or otherwise-orphaned attachment:
      // link, not one this app's own Attach action produced).
      return imagePlaceholder(node.target, 'no :ID: found to resolve this attachment against');
    }
    const cacheKey = S.state.storageKind + ':' + resolvedPath;

    const img = document.createElement('img');
    img.alt = node.target;
    img.style.maxWidth = '100%';
    img.style.display = 'block';
    img.style.margin = '4px 0';
    img.style.borderRadius = '4px';

    if (imageDataUrlCache.has(cacheKey)) {
      img.src = imageDataUrlCache.get(cacheKey);
      return img;
    }

    // Not loaded yet -- show a placeholder box immediately (avoiding a
    // zero-height flash), then swap in the real image once the async
    // read resolves.
    img.style.minHeight = '24px';
    img.style.background = 'var(--surface)';

    const adapter = activeDiskAdapter();
    adapter
      .readBinary(resolvedPath)
      .then((result) => {
        if (!result) {
          img.replaceWith(imagePlaceholder(node.target, 'not found'));
          return;
        }
        const dataUrl = `data:${guessImageMimeType(resolvedPath)};base64,${result.base64}`;
        imageDataUrlCache.set(cacheKey, dataUrl);
        img.src = dataUrl;
        img.style.background = '';
        img.style.minHeight = '';
      })
      .catch((err) => {
        img.replaceWith(imagePlaceholder(node.target, err.message));
      });

    return img;
  }

  // Either inline images are off (#+STARTUP: noinlineimages, the
  // default) or this is a local/relative path on a backend that can't
  // read an arbitrary path without a fresh picker gesture.
  return imagePlaceholder(node.target);
}

export function renderLinkNode(node, linkContext = null, heading = null) {
  const label = node.description || node.target;
  const targetDoc = linkContext ? linkContext.doc : S.state.doc;
  const resolution = resolveLinkTarget(targetDoc, node.target);

  if (resolution.type === 'external') {
    const a = document.createElement('a');
    a.href = resolution.url;
    a.target = '_blank';
    a.rel = 'noopener noreferrer';
    a.textContent = label;
    a.style.color = 'var(--accent)';
    a.setAttribute(INLINE_LINK_ATTR, '1');
    return a;
  }

  if (resolution.type === 'heading') {
    const a = document.createElement('a');
    a.href = '#';
    a.textContent = label;
    a.style.color = 'var(--accent)';
    a.setAttribute(INLINE_LINK_ATTR, '1');
    a.onclick = (e) => {
      e.preventDefault();
      e.stopPropagation();
      if (linkContext) {
        linkContext.onHeadingLinkClick(resolution.heading);
      } else {
        navigateToHeading(resolution.heading);
      }
    };
    return a;
  }

  if (resolution.type === 'attachment' && !linkContext) {
    const filename = resolution.target.replace(/^attachment:/i, '');
    if (isAudioFilename(filename)) {
      return renderAudioAttachmentLink(resolution.target, filename, heading);
    }
    const a = document.createElement('a');
    a.href = '#';
    a.textContent = label;
    a.style.color = 'var(--accent)';
    a.setAttribute(INLINE_LINK_ATTR, '1');
    a.onclick = (e) => {
      e.preventDefault();
      e.stopPropagation();
      openAttachmentLink(resolution.target, heading);
    };
    return a;
  }

  if (resolution.type === 'file' && !linkContext) {
    const a = document.createElement('a');
    a.href = '#';
    a.textContent = label;
    a.style.color = 'var(--accent)';
    a.setAttribute(INLINE_LINK_ATTR, '1');
    a.onclick = (e) => {
      e.preventDefault();
      e.stopPropagation();
      openFileLink(resolution, heading);
    };
    return a;
  }

  // Unresolved: e.g. a *Heading or #custom-id link with no matching
  // heading (renamed heading, typo, or a link meant for a different
  // file) -- or a file:/github:/webdav:/attachment: link encountered
  // while a linkContext is active (a read-only overlay like Docs
  // deliberately never switches the active document). Shown distinctly
  // rather than silently rendered as plain text, since "this link is
  // broken" is useful information.
  const span = document.createElement('span');
  span.textContent = label;
  span.style.color = 'var(--text-muted, #888)';
  span.style.textDecoration = 'underline wavy';
  span.title = 'Unresolved link: ' + node.target;
  span.setAttribute(INLINE_LINK_ATTR, '1');
  return span;
}

/** An audio attachment's own inline playback UI -- starts as a
 *  compact "\u25b6\ufe0f filename" button; tapping it fetches the actual
 *  bytes (the same adapter.readBinary/resolveAttachmentTarget path
 *  renderImageNode already uses for images, lazily here -- only once
 *  actually tapped, unlike an inline image's own eager fetch, since
 *  an audio recording is often considerably larger and there's no
 *  reason to pull it down before someone's actually asked to hear
 *  it) and replaces itself with a real, native
 *  `<audio controls autoplay>` element -- the browser's own actual
 *  play/pause/seek/scrub UI, rather than a hand-built equivalent. */
export function renderAudioAttachmentLink(target, filename, heading) {
  const btn = document.createElement('a');
  btn.href = '#';
  btn.textContent = `\u25b6\ufe0f ${filename}`;
  btn.style.color = 'var(--accent)';
  btn.setAttribute(INLINE_LINK_ATTR, '1');
  btn.onclick = async (e) => {
    e.preventDefault();
    e.stopPropagation();
    if (S.state.storageKind !== 'github' && S.state.storageKind !== 'webdav') {
      setStatus(
        "Can't play this attachment \u2014 only available with GitHub or WebDAV connected, the same backends attachments themselves are only ever stored on."
      );
      render();
      return;
    }
    const resolvedPath = resolveAttachmentTarget(S.state.doc, heading, target, S.state.documentId);
    if (!resolvedPath) {
      setStatus("Can't resolve this attachment \u2014 no heading in its own ancestor chain has an :ID: property.");
      render();
      return;
    }
    btn.textContent = `\u23f3 ${filename}`;
    try {
      const adapter = activeDiskAdapter();
      const result = await adapter.readBinary(resolvedPath);
      if (!result) {
        btn.textContent = `\u26a0\ufe0f ${filename} (not found)`;
        return;
      }
      const audio = document.createElement('audio');
      audio.controls = true;
      audio.autoplay = true;
      audio.src = `data:${guessAudioMimeType(filename)};base64,${result.base64}`;
      audio.style.width = '100%';
      audio.style.display = 'block';
      audio.style.margin = '4px 0';
      btn.replaceWith(audio);
    } catch (err) {
      btn.textContent = `\u26a0\ufe0f ${filename}: ${err.message}`;
    }
  };
  return btn;
}

/** A bare [fn:label] footnote reference: tappable, jumping to (and
 *  highlighting) wherever the actual definition lives in the document
 *  -- reusing findFootnoteDefinition the same way renderLinkNode reuses
 *  resolveLinkTarget. In the main app, jumps with navigateToHeading's
 *  own targetNode precision (the exact paragraph/list-item, not just
 *  the right heading); in a linkContext (the read-only Docs view),
 *  falls back to the heading-level onHeadingLinkClick unless a more
 *  precise onFootnoteRefClick was explicitly provided -- Docs' own
 *  content doesn't currently use footnotes, so this is a deliberately
 *  simpler fallback rather than building full paragraph-level jump
 *  precision for a case that isn't actually exercised there yet.
 *  Unresolved (no definition found anywhere) renders inert, matching
 *  renderLinkNode's own "no dead-end click target" convention. */
export function renderFootnoteRefNode(node, linkContext = null) {
  const targetDoc = linkContext ? linkContext.doc : S.state.doc;
  const result = findFootnoteDefinition(targetDoc, node.label);
  const sup = document.createElement('sup');
  sup.textContent = '[' + node.label + ']';
  sup.setAttribute(INLINE_LINK_ATTR, '1');
  if (!result) {
    sup.style.color = 'var(--text-muted, #888)';
    sup.title = 'No definition found for footnote "' + node.label + '"';
    return sup;
  }
  sup.style.color = 'var(--accent)';
  sup.style.cursor = 'pointer';
  sup.onclick = (e) => {
    e.preventDefault();
    e.stopPropagation();
    if (linkContext) {
      if (linkContext.onFootnoteRefClick) linkContext.onFootnoteRefClick(result);
      else linkContext.onHeadingLinkClick(result.heading);
    } else {
      navigateToHeading(result.heading, { revealOwnBody: true, targetNode: result.node });
    }
  };
  return sup;
}

/** An inline [fn:label:definition] (or anonymous [fn::definition]):
 *  shows the actual definition text right there, styled distinctly
 *  (smaller, italic, a superscript label) rather than making it
 *  something to tap and jump to -- it already IS the definition, not a
 *  reference to one elsewhere. */
export function renderFootnoteDefNode(node, linkContext = null, heading = null) {
  const wrap = document.createElement('span');
  const labelEl = document.createElement('sup');
  labelEl.textContent = node.label ? '[' + node.label + ']' : '[*]';
  labelEl.style.color = 'var(--text-muted, #888)';
  wrap.appendChild(labelEl);
  const content = document.createElement('span');
  content.style.fontSize = '0.9em';
  content.style.fontStyle = 'italic';
  content.style.opacity = '0.85';
  renderInlineNodes(node.children, content, linkContext, heading);
  wrap.appendChild(content);
  return wrap;
}

/** Inline-parsing options reflecting the current document's Local
 *  Variables -- currently just subSuperscriptMode, but centralized here
 *  so a future option doesn't need updating at every parseInline call
 *  site individually. */
export function currentInlineOpts() {
  return { subSuperscriptMode: getUseSubSuperscripts(S.state.localVariables) };
}

/** Renders a parseInline() node array into `container`. Recurses into
 *  emphasis spans' children; code/verbatim/comment/image/link are leaves.
 *  `heading`, when known (the main outline's own paragraph/list-item/
 *  table-cell rendering -- not the read-only Docs overlay, which has
 *  no heading-owned attachments of its own to resolve), is threaded
 *  through to renderImageNode so an attachment: link can resolve
 *  against the right heading's own :ID: (or an ancestor's, via
 *  resolveAttachmentTarget's own inheritance). */
export function renderInlineNodes(nodes, container, linkContext = null, heading = null) {
  for (const node of nodes) {
    switch (node.type) {
      case 'text':
        container.appendChild(document.createTextNode(node.value));
        break;
      case 'bold': {
        const el = document.createElement('b');
        renderInlineNodes(node.children, el, linkContext, heading);
        container.appendChild(el);
        break;
      }
      case 'italic': {
        const el = document.createElement('i');
        renderInlineNodes(node.children, el, linkContext, heading);
        container.appendChild(el);
        break;
      }
      case 'underline': {
        const el = document.createElement('u');
        renderInlineNodes(node.children, el, linkContext, heading);
        container.appendChild(el);
        break;
      }
      case 'strikethrough': {
        const el = document.createElement('s');
        renderInlineNodes(node.children, el, linkContext, heading);
        container.appendChild(el);
        break;
      }
      case 'code':
      case 'verbatim': {
        const el = document.createElement('code');
        el.textContent = node.value;
        el.style.background = 'rgba(128,128,128,0.15)';
        el.style.padding = '1px 4px';
        el.style.borderRadius = '3px';
        el.style.fontSize = '0.9em';
        container.appendChild(el);
        break;
      }
      case 'subscript': {
        const el = document.createElement('sub');
        el.textContent = node.value;
        container.appendChild(el);
        break;
      }
      case 'superscript': {
        const el = document.createElement('sup');
        el.textContent = node.value;
        container.appendChild(el);
        break;
      }
      case 'image':
        container.appendChild(renderImageNode(node, heading));
        break;
      case 'latex':
        container.appendChild(renderLatexNode(node));
        break;
      case 'link':
        container.appendChild(renderLinkNode(node, linkContext, heading));
        break;
      case 'footnote-ref':
        container.appendChild(renderFootnoteRefNode(node, linkContext));
        break;
      case 'footnote-def':
        container.appendChild(renderFootnoteDefNode(node, linkContext, heading));
        break;
      case 'comment':
        // Org excludes comments from rendered/exported output; skipped here too.
        break;
      default:
        container.appendChild(document.createTextNode(node.value || ''));
    }
  }
}
