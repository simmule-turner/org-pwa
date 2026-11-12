import React, { useState } from 'react';
export default class Widget extends Base {
  static count = 0;
  #secret = 42;
  constructor(props) { super(props); this.state = { open: false, items: [] }; }
  async load(url = "/api", { retries = 3 } = {}) {
    for (let i = 0; i < retries; i++) {
      try {
        const res = await fetch(`${url}?n=${i}`);
        if (!res.ok) throw new Error('bad ' + res.status);
        return await res.json();
      } catch (e) { console.error(e); } finally { this.done = true; }
    }
  }
}
const re = /ab+c\/d[a-z]*/gi, n = 0xFF + 1.5e3, t = true ? null : undefined;
function* gen(a, b) { yield a; yield* b; }
const arrow = (x) => x ** 2, obj = { key: 'v', [computed]: typeof x === 'number', get g() { return 1; } };
label: while (!done) { if (x instanceof Y) break label; else continue; }
/* block comment */ // line
let { a, b: [c, d] } = obj;
var s = new Set(), m = new Map(); delete obj.key; void 0;
