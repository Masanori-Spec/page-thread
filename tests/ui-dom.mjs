// Deliberately small DOM test double. It does not emulate rendering or make
// browser/accessibility claims; it exercises the application's actual handlers.
const decode = text => text.replace(/&(?:#(x[0-9a-f]+|[0-9]+)|([a-z]+));/gi, (all, numeric, name) => {
  if (numeric) return String.fromCodePoint(numeric[0].toLowerCase() === 'x' ? parseInt(numeric.slice(1), 16) : Number(numeric));
  return ({ amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" })[name] ?? all;
});
const voids = new Set(['input', 'br', 'hr', 'meta', 'link', 'img', 'col', 'area', 'base', 'embed', 'source', 'track', 'wbr']);
function matches(node, selector) {
  const id = selector.match(/^#([\w:-]+)/)?.[1];
  if (id && node.id !== id) return false;
  const cls = selector.match(/^\.([\w-]+)/)?.[1];
  if (cls && !node.className.split(/\s+/).includes(cls)) return false;
  const tag = selector.match(/^[a-z][\w-]*/i)?.[0];
  if (tag && node.tagName !== tag.toUpperCase()) return false;
  for (const [, name, value] of selector.matchAll(/\[([\w-]+)(?:="([^"]*)")?\]/g)) {
    if (!(name in node.attributes)) return false;
    if (value !== undefined && node.attributes[name] !== value) return false;
  }
  return true;
}
export class Element {
  constructor(tag, attributes = {}, ownerDocument) {
    this.tagName = tag.toUpperCase(); this.attributes = attributes; this.ownerDocument = ownerDocument;
    this.children = []; this.parentElement = null; this.listeners = new Map(); this._value = undefined;
    this.dataset = Object.fromEntries(Object.entries(attributes).filter(([name]) => name.startsWith('data-')).map(([name, value]) => [name.slice(5).replace(/-([a-z])/g, (_, c) => c.toUpperCase()), value]));
    this.disabled = Object.hasOwn(attributes, 'disabled'); this.hidden = Object.hasOwn(attributes, 'hidden'); this.open = Object.hasOwn(attributes, 'open'); this.tabIndex = Number(attributes.tabindex ?? -1);
    this.classList = { toggle: (name, force) => {
      const classes = new Set(this.className.split(/\s+/).filter(Boolean));
      const enabled = force ?? !classes.has(name); enabled ? classes.add(name) : classes.delete(name);
      this.className = [...classes].join(' '); return enabled;
    }, contains: name => this.className.split(/\s+/).includes(name) };
  }
  get id() { return this.attributes.id ?? ''; }
  get checked() { return this._checked ?? Object.hasOwn(this.attributes, 'checked'); }
  set checked(value) { this._checked = Boolean(value); }
  get className() { return this.attributes.class ?? ''; }
  set className(value) { this.attributes.class = value; }
  setAttribute(name, value) { this.attributes[name] = String(value); }
  getAttribute(name) { return this.attributes[name] ?? null; }
  get textContent() { return this.children.map(node => typeof node === 'string' ? node : node.textContent).join(''); }
  set textContent(value) { this.children = [String(value)]; }
  get innerHTML() { return this._html ?? ''; }
  set innerHTML(html) { this._html = html; this.children = []; if (this.tagName === 'SELECT' || this.tagName === 'TEXTAREA') this._value = undefined; parseHTML(html, this); }
  get value() {
    if (this._value !== undefined) return this._value;
    if (this.tagName === 'SELECT') {
      const options = this.querySelectorAll('option');
      return (options.find(option => Object.hasOwn(option.attributes, 'selected')) ?? options[0])?.attributes.value ?? '';
    }
    return this.tagName === 'TEXTAREA' ? this.textContent : (this.attributes.value ?? '');
  }
  set value(value) { this._value = String(value); }
  append(child) { this.children.push(child); if (typeof child !== 'string') child.parentElement = this; }
  remove() { if (this.parentElement) this.parentElement.children = this.parentElement.children.filter(child => child !== this); }
  querySelectorAll(selector) {
    const parts = selector.trim().split(/\s+(?=[^\]]*(?:\[|$))/);
    const found = [];
    const walk = node => {
      for (const child of node.children) if (typeof child !== 'string') {
        if (matches(child, parts.at(-1))) {
          let ancestor = child.parentElement, index = parts.length - 2;
          while (index >= 0 && ancestor) {
            if (matches(ancestor, parts[index])) index--;
            ancestor = ancestor.parentElement;
          }
          if (index < 0) found.push(child);
        }
        walk(child);
      }
    };
    walk(this); return found;
  }
  querySelector(selector) { return this.querySelectorAll(selector)[0] ?? null; }
  closest(selector) { let node = this; while (node) { if (matches(node, selector)) return node; node = node.parentElement; } return null; }
  addEventListener(type, callback, options = {}) { const listeners = this.listeners.get(type) ?? []; listeners.push({ callback, once: options.once }); this.listeners.set(type, listeners); }
  async emit(type, extras = {}) {
    const event = { target: this, preventDefault() { this.defaultPrevented = true; }, ...extras };
    const listeners = [...(this.listeners.get(type) ?? [])];
    this.listeners.set(type, (this.listeners.get(type) ?? []).filter(listener => !listener.once));
    await Promise.all(listeners.map(listener => listener.callback(event))); return event;
  }
  setSelectionRange() {}
  focus() { this.ownerDocument.activeElement = this; }
  click() { return this.emit('click'); }
  showModal() { this.open = true; }
  close(value = this.returnValue) { this.returnValue = value; this.open = false; return this.emit('close'); }
}
function parseHTML(html, root) {
  const stack = [root];
  for (const token of html.match(/<!--[\s\S]*?-->|<[^>]+>|[^<]+/g) ?? []) {
    if (token.startsWith('<!--')) continue;
    if (!token.startsWith('<')) { stack.at(-1).append(decode(token)); continue; }
    if (token.startsWith('</')) { const tag = token.slice(2, -1).trim().toUpperCase(); while (stack.length > 1) { if (stack.pop().tagName === tag) break; } continue; }
    const tag = token.match(/^<([a-z][\w-]*)/i)?.[1]; if (!tag) continue;
    const attributes = {};
    const attrsText = token.slice(tag.length + 1, -1);
    for (const [, name, quoted, bare] of attrsText.matchAll(/([^\s=/>]+)(?:\s*=\s*(?:"([^"]*)"|([^\s>]+)))?/g)) attributes[name] = decode(quoted ?? bare ?? '');
    const node = new Element(tag, attributes, root.ownerDocument); stack.at(-1).append(node);
    if (!voids.has(tag.toLowerCase()) && !token.endsWith('/>')) stack.push(node);
  }
}
export function createDOM() {
  const document = { activeElement: null };
  document.documentElement = new Element('html', {}, document);
  document.body = new Element('body', {}, document); document.documentElement.append(document.body);
  document.body.append(new Element('div', { id: 'app' }, document));
  document.getElementById = id => document.documentElement.querySelectorAll('[id]').find(node => node.id === id) ?? null;
  document.querySelectorAll = selector => document.documentElement.querySelectorAll(selector);
  document.querySelector = selector => document.documentElement.querySelector(selector);
  document.createElement = tag => new Element(tag, {}, document);
  const window = new Element('window', {}, document);
  return { document, window };
}
