// line comment
/* block
   comment */
/** doc */
import { a, b as c } from './mod.js';
const PI = 3.14, hex = 0xFF, big = 10n, e = 1e-3;
let s = 'single', t = "double \"q\"", u = `tpl ${a + 1} x`, re = /ab+c/gi;
var undef = undefined, nul = null, nan = NaN, ok = true;
export default class Foo extends Bar {
  static count = 0;
  #priv = 1;
  constructor(x) { super(x); this.x = x; }
  get value() { return this.x; }
  async run() { await fetch('/x'); }
}
function add(a, b = 2) { return a + b; }
const arrow = (x) => x * 2;
label: for (const k of Object.keys(window)) { if (!k) continue label; else break; }
try { throw new Error("x"); } catch (err) { console.log(err); } finally {}
switch (typeof s) { case 'string': break; default: void 0; }
document.getElementById("a").addEventListener("click", () => {});
