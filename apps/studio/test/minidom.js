// minidom.js — 够 morph 用的最小 DOM（施工令-048）
// 为什么自造：仓里没有 jsdom，而 morph 的全部价值恰恰在「哪个节点被动过、哪个没被动过」——
// 这件事只有拿真节点对象的身份（===）去验才算数，拿字符串比对是验不出来的。
// 只实现 morph 触碰到的那一小圈 API，多一个都不写，免得这份桩自己长成需要维护的东西。

const VOID = new Set(['br', 'hr', 'img', 'input', 'meta', 'link', 'i-void']);
const 字段类 = /^(INPUT|TEXTAREA|SELECT)$/;

class Txt {
  constructor(v) { this.nodeType = 3; this.nodeValue = v; this.parentNode = null; }
  get outerHTML() { return this.nodeValue; }
}
class El {
  constructor(tag) {
    this.nodeType = 1; this.tagName = String(tag).toUpperCase();
    this.attrs = new Map(); this.childNodes = []; this.parentNode = null;
  }
  get attributes() { return [...this.attrs].map(([name, value]) => ({ name, value })); }
  hasAttribute(n) { return this.attrs.has(n); }
  getAttribute(n) { return this.attrs.has(n) ? this.attrs.get(n) : null; }
  setAttribute(n, v) { this.attrs.set(n, String(v)); }
  removeAttribute(n) { this.attrs.delete(n); }
  get id() { return this.getAttribute('id') || ''; }
  // 表单值：属性是初值、属性被人改过之后以 .value 为准（照浏览器的 dirty value 语义）
  get value() { return this._value !== undefined ? this._value : (this.getAttribute('value') || ''); }
  set value(v) { this._value = String(v); }
  appendChild(c) { if (c.parentNode) c.parentNode.removeChild(c); c.parentNode = this; this.childNodes.push(c); return c; }
  removeChild(c) { const i = this.childNodes.indexOf(c); if (i >= 0) this.childNodes.splice(i, 1); c.parentNode = null; return c; }
  replaceChild(nw, od) {
    const i = this.childNodes.indexOf(od); if (i < 0) return od;
    if (nw.parentNode) nw.parentNode.removeChild(nw);
    this.childNodes[i] = nw; nw.parentNode = this; od.parentNode = null; return od;
  }
  focus() { doc.activeElement = this; }
  setSelectionRange(a, b) { this.selectionStart = a; this.selectionEnd = b; }
  get innerHTML() { return this.childNodes.map((c) => c.outerHTML).join(''); }
  set innerHTML(h) { this.childNodes = []; for (const n of parse(h)) this.appendChild(n); }
  get outerHTML() {
    const tag = this.tagName.toLowerCase();
    const a = [...this.attrs].map(([k, v]) => (v === '' ? ` ${k}` : ` ${k}="${v}"`)).join('');
    return VOID.has(tag) ? `<${tag}${a}>` : `<${tag}${a}>${this.innerHTML}</${tag}>`;
  }
  querySelectorAll() { return []; }
}

// 极简解析：标签 / 属性 / 文本。测试夹具都是自己写的规整 HTML，不追求容错。
function parse(html) {
  const out = []; const stack = [];
  const push = (n) => (stack.length ? stack[stack.length - 1].appendChild(n) : out.push(n));
  const re = /<\/?([a-zA-Z][\w-]*)((?:\s+[^\s=>]+(?:=(?:"[^"]*"|'[^']*'|[^\s>]*))?)*)\s*\/?>/g;
  let last = 0, m;
  while ((m = re.exec(html))) {
    if (m.index > last) push(new Txt(html.slice(last, m.index)));
    last = re.lastIndex;
    if (m[0][1] === '/') { stack.pop(); continue; }
    const el = new El(m[1]);
    const ar = /([^\s=]+)(?:=("([^"]*)"|'([^']*)'|([^\s]+)))?/g;
    let a;
    while ((a = ar.exec(m[2] || ''))) el.setAttribute(a[1], a[3] !== undefined ? a[3] : a[4] !== undefined ? a[4] : a[5] !== undefined ? a[5] : '');
    push(el);
    if (!VOID.has(m[1].toLowerCase()) && !/\/>$/.test(m[0])) stack.push(el);
  }
  if (last < html.length) push(new Txt(html.slice(last)));
  return out;
}

const doc = {
  activeElement: null,
  createElement: (t) => new El(t),
  getElementById(id) {
    const 找 = (n) => {
      if (n.nodeType === 1 && n.id === id) return n;
      for (const c of n.childNodes || []) { const r = 找(c); if (r) return r; }
      return null;
    };
    return this.body ? 找(this.body) : null;
  },
  querySelector: () => null,
};
const win = { scrollY: 0, scrollTo(x, y) { this.scrollY = y; } };

module.exports = { El, Txt, parse, doc, win, 字段类 };
