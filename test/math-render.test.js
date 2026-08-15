
import test from 'node:test';
import assert from 'node:assert/strict';
import { renderMathHtml, isMathEngineAvailable } from '../src/math-render.js';

test('isMathEngineAvailable() is false when window.katex was never set -- the actual state of every existing Node-based DOM-stub test in this project, since index.html\u2019s own <script> tag never runs there', () => {
  delete globalThis.window;
  assert.equal(isMathEngineAvailable(), false);
});

test('THE FIX: renderMathHtml() degrades gracefully (ok: false, html: null) rather than throwing when the engine isn\u2019t available at all', () => {
  delete globalThis.window;
  assert.deepEqual(renderMathHtml('x=y', false), { html: null, ok: false });
});

test('renderMathHtml() calls through to window.katex.renderToString when the engine IS available, passing displayMode through', () => {
  const calls = [];
  globalThis.window = {
    katex: {
      renderToString(source, opts) {
        calls.push({ source, opts });
        return `<span data-mode="${opts.displayMode}">${source}</span>`;
      },
    },
  };
  const result = renderMathHtml('a^2+b^2=c^2', false);
  assert.equal(result.ok, true);
  assert.equal(result.html, '<span data-mode="false">a^2+b^2=c^2</span>');
  assert.equal(calls.length, 1);
  assert.equal(calls[0].opts.displayMode, false);
});

test('renderMathHtml() passes throwOnError: true and strict: \'ignore\' to the engine -- a malformed-LaTeX rejection is caught here (see the next test), not silently swallowed by the engine itself producing a partial/garbled render', () => {
  let seenOpts = null;
  globalThis.window = {
    katex: {
      renderToString(source, opts) {
        seenOpts = opts;
        return '<span></span>';
      },
    },
  };
  renderMathHtml('x', false);
  assert.equal(seenOpts.throwOnError, true);
  assert.equal(seenOpts.strict, 'ignore');
});

test('THE FIX: malformed LaTeX (the engine throws) returns ok: false rather than propagating the exception -- a rendering failure must never break the surrounding paragraph\u2019s own render', () => {
  globalThis.window = {
    katex: {
      renderToString() {
        throw new Error('KaTeX parse error: Expected group after \'^\'');
      },
    },
  };
  assert.deepEqual(renderMathHtml('x^', false), { html: null, ok: false });
});

test('THE FIX: identical (source, displayMode) is cached -- the engine is called only once for two identical requests', () => {
  let callCount = 0;
  globalThis.window = {
    katex: {
      renderToString(source) {
        callCount++;
        return `<span>${source}</span>`;
      },
    },
  };
  const r1 = renderMathHtml('unique-source-for-cache-test', false);
  const r2 = renderMathHtml('unique-source-for-cache-test', false);
  assert.deepEqual(r1, r2);
  assert.equal(callCount, 1, 'the second call must be served from cache, not re-invoke the engine');
});

test('THE FIX: the SAME source with a DIFFERENT displayMode is NOT served from the same cache entry -- inline and display math for identical source text are genuinely different renders', () => {
  let callCount = 0;
  globalThis.window = {
    katex: {
      renderToString(source, opts) {
        callCount++;
        return `<span data-mode="${opts.displayMode}">${source}</span>`;
      },
    },
  };
  const inline = renderMathHtml('cache-key-distinguishes-mode', false);
  const display = renderMathHtml('cache-key-distinguishes-mode', true);
  assert.notEqual(inline.html, display.html);
  assert.equal(callCount, 2, 'a different displayMode must not hit the other mode\u2019s own cache entry');
});

test('a cached error result (ok: false) is also reused on a repeat request, rather than re-attempting and re-failing every time', () => {
  let callCount = 0;
  globalThis.window = {
    katex: {
      renderToString() {
        callCount++;
        throw new Error('always fails, for this specific source string');
      },
    },
  };
  renderMathHtml('always-fails-cache-test', false);
  renderMathHtml('always-fails-cache-test', false);
  assert.equal(callCount, 1, 'a failed render is cached too, not retried on every call');
});
