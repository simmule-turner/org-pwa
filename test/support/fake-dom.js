// A just-enough browser for loading the app's modules under Node and driving a flow that opens a dialog: elements record their children and click
// listeners, so a test can press a button by its text. Anything else a module touches (styles, observers, storage) is an inert stub.
// Import this before any src-browser module, and import those with `await import(...)`.

/** A value that answers every property with another inert stub and every call with one more. */
export function inert() {
  const target = function () {};
  return new Proxy(target, {
    get: (_t, key) => {
      if (key === Symbol.toPrimitive) return () => '';
      if (key === 'then') return undefined;
      if (key === 'length') return 0;
      if (key === Symbol.iterator) return function* () {};
      return inert();
    },
    apply: () => inert(),
    construct: () => inert(),
    set: () => true,
  });
}

export class FakeElement {
  constructor(tagName = 'div') {
    this.tagName = String(tagName).toUpperCase();
    this.children = [];
    this.listeners = {};
    this.style = new Proxy({}, { get: (t, k) => (k in t ? t[k] : ''), set: (t, k, v) => ((t[k] = v), true) });
    this.dataset = {};
    this.attributes = {};
    this.textContent = '';
    this.className = '';
    this.value = '';
    this.parentNode = null;
    this.classList = { add() {}, remove() {}, toggle() {}, contains: () => false };
    return new Proxy(this, { get: (t, k) => (k in t ? t[k] : typeof k === 'symbol' ? undefined : k === 'then' ? undefined : inert()), set: (t, k, v) => ((t[k] = v), true) });
  }
  get isConnected() {
    let node = this;
    while (node.parentNode) node = node.parentNode;
    return node === document.body || node === document.documentElement;
  }
  appendChild(child) {
    child.parentNode = this;
    this.children.push(child);
    return child;
  }
  append(...nodes) {
    for (const node of nodes) if (typeof node === 'object') this.appendChild(node);
  }
  removeChild(child) {
    this.children = this.children.filter((c) => c !== child);
    child.parentNode = null;
    return child;
  }
  remove() {
    if (this.parentNode) this.parentNode.removeChild(this);
  }
  setAttribute(name, value) {
    this.attributes[name] = String(value);
  }
  getAttribute(name) {
    return this.attributes[name] ?? null;
  }
  addEventListener(type, fn) {
    (this.listeners[type] ||= []).push(fn);
  }
  removeEventListener(type, fn) {
    this.listeners[type] = (this.listeners[type] || []).filter((f) => f !== fn);
  }
  click() {
    const event = { type: 'click', target: this, preventDefault() {}, stopPropagation() {}, stopImmediatePropagation() {} };
    if (typeof this.onclick === 'function') this.onclick(event);
    for (const fn of this.listeners.click || []) fn(event);
  }
  /** Every element below this one, depth first. */
  descendants() {
    return this.children.flatMap((c) => [c, ...c.descendants()]);
  }
  /** The text of this element and everything below it. */
  get allText() {
    return [this.textContent, ...this.children.map((c) => c.allText)].join(' ');
  }
}

/** Enough IndexedDB for the app's key-value adapter: one map, requests answered on the next tick. */
export function fakeIndexedDb() {
  const data = new Map();
  const answer = (result) => {
    const request = { result, error: null };
    setTimeout(() => request.onsuccess && request.onsuccess({ target: request }), 0);
    return request;
  };
  const store = {
    get: (key) => answer(data.get(key)),
    put: (value, key) => (data.set(key, value), answer(key)),
    delete: (key) => (data.delete(key), answer(undefined)),
    openCursor: () => {
      const keys = [...data.keys()];
      let i = -1;
      const request = { result: null, error: null };
      const step = () => {
        i++;
        request.result = i < keys.length ? { key: keys[i], continue: () => setTimeout(step, 0) } : null;
        if (request.onsuccess) request.onsuccess({ target: request });
      };
      setTimeout(step, 0);
      return request;
    },
  };
  const db = { objectStoreNames: { contains: () => true }, createObjectStore() {}, transaction: () => ({ objectStore: () => store }) };
  return {
    open: () => {
      const request = { result: db, error: null };
      setTimeout(() => request.onsuccess && request.onsuccess({ target: request }), 0);
      return request;
    },
  };
}

export function installFakeDom() {
  const body = new FakeElement('body');
  const documentElement = new FakeElement('html');
  const doc = new Proxy(
    { body, documentElement, createElement: (tag) => new FakeElement(tag), createTextNode: (text) => Object.assign(new FakeElement('#text'), { textContent: String(text) }), getElementById: () => new FakeElement('div'), addEventListener() {}, removeEventListener() {}, hidden: false, activeElement: null },
    { get: (t, k) => (k in t ? t[k] : typeof k === 'symbol' || k === 'then' ? undefined : inert()), set: (t, k, v) => ((t[k] = v), true) }
  );
  Object.assign(globalThis, {
    document: doc,
    window: globalThis,
    indexedDB: fakeIndexedDb(),
    localStorage: { getItem: () => null, setItem() {}, removeItem() {} },
    matchMedia: () => ({ matches: false, addEventListener() {} }),
    MutationObserver: class { observe() {} disconnect() {} },
    ResizeObserver: class { observe() {} disconnect() {} },
    IntersectionObserver: class { observe() {} disconnect() {} },
    requestAnimationFrame: (fn) => setTimeout(fn, 0),
    visualViewport: inert(),
    HTMLElement: FakeElement,
    addEventListener() {},
    removeEventListener() {},
    dispatchEvent() {},
    getComputedStyle: () => ({ getPropertyValue: () => '0' }),
    innerHeight: 800,
    innerWidth: 400,
  });
  Object.defineProperty(globalThis, 'navigator', { value: { userAgent: 'node', maxTouchPoints: 0, onLine: true }, configurable: true });
  return doc;
}

/** The button below the page body whose text contains `text`, or null. */
export function findButton(text) {
  return document.body.descendants().find((el) => el.tagName === 'BUTTON' && String(el.allText).includes(text)) ?? null;
}

/** Waits until a button with `text` is on screen, then presses it. */
export async function pressButton(text, tries = 40) {
  for (let i = 0; i < tries; i++) {
    const button = findButton(text);
    if (button) {
      button.click();
      return true;
    }
    await new Promise((r) => setTimeout(r, 5));
  }
  return false;
}
