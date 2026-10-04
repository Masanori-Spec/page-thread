import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import vm from 'node:vm';
import { inspectBook, findCandidates, previewMapping, applyMapping, mappingText } from '../src/core.mjs';
import { openZip, decode } from '../src/zip.mjs';
import { createDOM } from './ui-dom.mjs';
import * as demo from '../src/demo-data.mjs';
import { UI, errorMessage } from '../src/i18n.mjs';
import { VERSION } from '../src/limits.mjs';
import { parseJSON } from '../src/json.mjs';
import { reportHTML } from '../src/report.mjs';

const fixturePath = new URL('./fixtures/field-notes.epub', import.meta.url);
const fixture = new Uint8Array(await readFile(fixturePath));
const preface = 'EPUB/text/zz-preface.xhtml';
const python = (code, input, expectSuccess = true) => {
  const p = spawnSync('python3', ['-c', code], { input: JSON.stringify(input), encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 });
  assert.equal(p.error, undefined); if (!expectSuccess) { assert.notEqual(p.status, 0, 'independent oracle must reject corrupted content'); return { rejected: true }; } assert.equal(p.status, 0, p.stderr); return JSON.parse(p.stdout);
};
function changed(parts, input = fixture) {
  return Uint8Array.from(Buffer.from(python(String.raw`
import sys,json,base64,io,zipfile
x=json.load(sys.stdin); out=io.BytesIO()
with zipfile.ZipFile(io.BytesIO(base64.b64decode(x['source']))) as src, zipfile.ZipFile(out,'w') as dst:
 for info in src.infolist():
  data=x['parts'][info.filename] if info.filename in x['parts'] else src.read(info.filename)
  if info.filename in x['parts']:info.compress_type=zipfile.ZIP_STORED
  dst.writestr(info,data)
print(json.dumps(base64.b64encode(out.getvalue()).decode()))
`, { source: Buffer.from(input).toString('base64'), parts }), 'base64'));
}
async function original(part) { return decode((await openZip(fixture)).entries.get(part).bytes); }
function draft(ctx, records) {
  const found = findCandidates(ctx, records);
  return { schema: 'page-thread-mapping-v1', inputSha256: ctx.model.input.sha256, paginationSource: 'Reviewer edition', modifiedAfter: '2026-10-04T00:00:00Z', whitespace: 'xml-s-collapse-v1', boundaries: records.map((r, i) => ({ ...r, candidateId: found[i].candidates[0]?.id })) };
}

// A separate Python DOM verifier removes precisely the new marker/nav/meta
// additions, restores the timestamp, and compares every original structure and
// string. It also checks the marker against a hand-authored node/offset identity.
const verifyPython = String.raw`
import json,sys,base64,zipfile,io
from xml.dom import minidom,Node
x=json.load(sys.stdin); src=zipfile.ZipFile(io.BytesIO(base64.b64decode(x['source']))); out=zipfile.ZipFile(io.BytesIO(base64.b64decode(x['output'])))
X='http://www.w3.org/1999/xhtml'; O='http://www.idpf.org/2007/opf'; E='http://www.idpf.org/2007/ops'
assert src.namelist()==out.namelist()
def elems(n): return [c for c in n.childNodes if c.nodeType==Node.ELEMENT_NODE]
def descend(n,path):
 for index in path:n=elems(n)[index]
 return n
def signature(n):
 if n.nodeType==Node.DOCUMENT_NODE:return tuple(signature(c) for c in n.childNodes)
 if n.nodeType==Node.ELEMENT_NODE:
  children=[]
  for c in n.childNodes:
   v=signature(c)
   if c.nodeType==Node.TEXT_NODE and children and children[-1][0]=='text':children[-1]=('text',children[-1][1]+c.data)
   else:children.append(v)
  return ('element',n.namespaceURI,n.localName,tuple(sorted((n.attributes.item(i).namespaceURI or '',n.attributes.item(i).name,n.attributes.item(i).value) for i in range(n.attributes.length))),tuple(children))
 if n.nodeType==Node.TEXT_NODE:return ('text',n.data)
 return (n.nodeType,n.nodeName,n.nodeValue)
for name in src.namelist():
 a=src.read(name);b=out.read(name)
 if name not in [x['part'],'EPUB/nav.xhtml','EPUB/package.opf']: assert a==b,name;continue
 old=minidom.parseString(a);new=minidom.parseString(b)
 if name==x['part']:
  markers=[n for n in new.getElementsByTagNameNS(X,'span') if n.getAttribute('id')=='pt-page-0001'];assert len(markers)==1
  marker=markers[0];assert marker.getAttributeNS(E,'type')=='pagebreak';assert marker.getAttribute('role')=='doc-pagebreak';assert marker.getAttribute('aria-label')==x['label'];assert not marker.childNodes
  parent=descend(new.documentElement,x['path']);assert marker.parentNode is parent
  segments=[];prefix=''
  for c in parent.childNodes:
   if c is marker:break
   if c.nodeType==Node.TEXT_NODE:prefix+=c.data
   else:
    if prefix:segments.append(prefix);prefix=''
  original_parent=descend(old.documentElement,x['path']); texts=[c for c in original_parent.childNodes if c.nodeType in [Node.TEXT_NODE,Node.CDATA_SECTION_NODE]]
  assert prefix==texts[x['textNode']].data[:x['offset']],(prefix,texts[x['textNode']].data,x['offset'])
  marker.parentNode.removeChild(marker)
 elif name=='EPUB/nav.xhtml':
  nav=[n for n in new.getElementsByTagNameNS(X,'nav') if n.getAttribute('id')=='pt-page-list'];assert len(nav)==1
  assert nav[0].getAttributeNS(E,'type')=='page-list';links=nav[0].getElementsByTagNameNS(X,'a');assert len(links)==1
  assert ''.join(c.data for c in links[0].childNodes if c.nodeType==Node.TEXT_NODE)==x['label']
  nav[0].parentNode.removeChild(nav[0])
 else:
  metadata=new.getElementsByTagNameNS(O,'metadata')[0]; additions=elems(metadata)[-3:]
  assert [n.getAttribute('property') for n in additions]==['pageBreakSource','schema:accessibilityFeature','schema:accessibilityFeature']
  assert ''.join(c.data for c in additions[0].childNodes if c.nodeType==Node.TEXT_NODE)==x['paginationSource']
  for n in additions:metadata.removeChild(n)
  before=[n for n in old.getElementsByTagNameNS(O,'meta') if n.getAttribute('property')=='dcterms:modified'][0]
  after=[n for n in new.getElementsByTagNameNS(O,'meta') if n.getAttribute('property')=='dcterms:modified'][0]
  after.firstChild.data=before.firstChild.data
 assert signature(old)==signature(new),name
print(json.dumps({'restored':True}))
`;

test('reviewer: independent DOM restoration verifies 24 entity/Unicode/inline/comment boundary variants', async () => {
  const base = await original(preface);
  const variants = [
    { xml: 'target<em> middle</em> end', phrase: 'target middle end', path: [1, 0], textNode: 0, offset: 0 },
    { xml: '😀 target<em> middle</em> end', phrase: 'target middle end', path: [1, 0], textNode: 0, offset: 2 },
    { xml: '&#x1F9ED;&amp;&#13;target<em> middle</em> end', phrase: 'target middle end', path: [1, 0], textNode: 0, offset: 3 },
    { xml: '  \r\n\ttarget<em> middle</em> end', phrase: 'target middle end', path: [1, 0], textNode: 0, offset: 4 },
    { xml: 'lead <em>target &amp; middle</em> end', phrase: 'target & middle end', path: [1, 0, 0], textNode: 0, offset: 0 },
    { xml: 'lead<!--keep-->target<?review keep?> end', phrase: 'target end', path: [1, 0], textNode: 1, offset: 0 },
    { xml: 'é&#160;target<em>　middle</em> end', phrase: 'target　middle end', path: [1, 0], textNode: 0, offset: 3 },
    { xml: 'lead <em>😀&amp;target</em> end', phrase: 'target end', path: [1, 0, 0], textNode: 0, offset: 2 },
  ];
  for (const item of variants) for (const label of ['iv', '0<&"😀', ' \tiv\r\n ']) {
    const input = changed({ [preface]: base.replace(/<body>[\s\S]*<\/body>/, `<body><p>${item.xml}</p></body>`) });
    const ctx = await inspectBook(input);
    const record = { decisionId: 'reviewer', label, phrase: item.phrase };
    const found = findCandidates(ctx, [record])[0]; assert.equal(found.candidateCount, 1);
    const candidate = found.candidates[0]; assert.deepEqual(candidate.sourcePath, item.path); assert.equal(candidate.textNodeIndex, item.textNode); assert.equal(candidate.offset, item.offset);
    const mapping = draft(ctx, [record]); mapping.paginationSource = 'Edition\r2026\n東京\t& copy';
    const before = structuredClone(mapping); const result = await applyMapping(ctx, mapping); assert.deepEqual(mapping, before);
    const verified = python(verifyPython, { source: Buffer.from(input).toString('base64'), output: Buffer.from(result.output).toString('base64'), part: preface, ...item, label, paginationSource: mapping.paginationSource });
    assert.equal(verified.restored, true);
  }
});

test('reviewer: hidden, inert and aria-hidden document roots are excluded from candidate search', async () => {
  const base = await original(preface);
  for (const marker of ['hidden="hidden"', 'inert=""', 'aria-hidden="true"']) {
    const ctx = await inspectBook(changed({ [preface]: base.replace('<html ', `<html ${marker} `) }));
    const result = findCandidates(ctx, [{ decisionId: 'x', label: '1', phrase: 'Field notes begin' }])[0];
    assert.equal(result.candidateCount, 0, marker);
    assert.ok(ctx.model.spine[0].unsupportedBlocks > 0);
  }
});

test('reviewer: malformed navigation placement is refused before an invalid EPUB can be returned', async () => {
  const nav = await original('EPUB/nav.xhtml');
  const input = changed({ 'EPUB/nav.xhtml': nav.replace('<body>', '').replace('</body>', '<body/>') });
  await assert.rejects(inspectBook(input), error => error.name === 'InputError');
});

test('reviewer: public record and mapping validation rejects getters, sparse arrays and custom prototypes', async () => {
  const ctx = await inspectBook(fixture); let calls = 0;
  const record = { decisionId: 'x', label: '1', phrase: 'Field notes begin' };
  for (const records of [
    [{ decisionId: 'x', label: '1', get phrase() { calls++; return 'Field notes begin'; } }],
    Array(1), Object.setPrototypeOf([record], Object.create(Array.prototype)),
    Object.assign([record], { toJSON() { calls++; return []; } }),
  ]) assert.throws(() => findCandidates(ctx, records), e => e.name === 'InputError');
  const mapping = draft(ctx, [record]);
  Object.defineProperty(mapping, 'boundaries', { enumerable: true, get() { calls++; return [record]; } });
  assert.throws(() => previewMapping(ctx, mapping), e => e.name === 'InputError'); assert.equal(calls, 0);
});

let serial = 0;
async function harness() {
  const source = (await readFile(new URL('../src/app.mjs', import.meta.url), 'utf8')).replace(/^import[^\n]+\n/gm, '');
  const { document, window } = createDOM(); const workers = [], hold = new Set(), downloads = [], blobs = new Map();
  class FakeWorker {
    constructor() { workers.push(this); }
    terminate() { this.dead = true; }
    postMessage(raw) {
      const data = structuredClone(raw); this.request = data; this.callback = this.onmessage; this.errorCallback = this.onerror;
      this.deliver = async () => {
        let result;
        try {
          const ctx = await inspectBook(data.bytes, data.name);
          if (data.type === 'inspect') result = { type: 'inspected', model: ctx.model };
          if (data.type === 'search') result = { type: 'searched', results: findCandidates(ctx, data.records) };
          if (data.type === 'preview') result = { type: 'previewed', preview: previewMapping(ctx, data.mapping) };
          if (data.type === 'export') { const mapped = await applyMapping(ctx, data.mapping); result = { type: 'exported', ...mapped, reportHTML: reportHTML(mapped.receipt) }; }
        } catch (e) { result = { type: 'error', error: { code: e.code || 'internal' } }; }
        if (!this.dead) this.onmessage?.({ data: { id: data.id, ...result } });
      };
      if (!hold.has(data.type)) Promise.resolve().then(this.deliver);
    }
  }
  const create = document.createElement;
  document.createElement = tag => { const element = create(tag); if (tag === 'a') element.click = () => downloads.push(blobs.get(element.href)); return element; };
  const context = vm.createContext({ document, window, UI, errorMessage, parseJSON, ...demo, WORKER_SOURCE: 'test transport', VERSION, Worker: FakeWorker, Blob, Uint8Array, TextDecoder, TextEncoder, atob, Date, Map, Set, URL: { createObjectURL(blob) { const id = `blob:reviewer-${++serial}`; blobs.set(id, blob); return id; }, revokeObjectURL(id) { blobs.delete(id); } }, setTimeout: fn => { fn(); } });
  vm.runInContext(source, context);
  return { document, context, workers, hold, downloads, run: code => vm.runInContext(code, context), id: id => document.getElementById(id) };
}
const file = text => ({ name: 'mapping.json', size: Buffer.byteLength(text), arrayBuffer: async () => new TextEncoder().encode(text).buffer });
async function ready(h) { await h.run('importEPUB(null,true)'); await h.run('search()'); h.id('demo-selection').onclick(); await h.run('requestPreview()'); }

test('reviewer: duplicate mapping keys reject atomically instead of selecting the last value', async () => {
  const h = await harness(); await ready(h);
  const before = h.run('prepared');
  const raw = h.run('JSON.stringify(prepared.mapping)').replace('"label":"iv"', '"label":"wrong","label":"iv"');
  h.context.mappingFile = file(raw); await h.run('restoreMapping(mappingFile)');
  assert.ok(h.run('error'), 'duplicate decisions must not be silently accepted'); assert.equal(h.run('prepared'), before);
});

test('reviewer: restored multiline quotes remain reusable without lossy TSV reconstruction', async () => {
  const h = await harness(); await ready(h);
  const mapping = JSON.parse(h.run('JSON.stringify(prepared.mapping)'));
  mapping.boundaries[0].phrase = mapping.boundaries[0].phrase.replace(' ', '\r\n');
  h.context.mappingFile = file(JSON.stringify(mapping)); await h.run('restoreMapping(mappingFile)');
  assert.equal(h.run('error'), null); assert.equal(h.run('prepared.mapping.boundaries[0].phrase'), mapping.boundaries[0].phrase);
  await h.run('search()');
  assert.equal(h.run('error'), null); assert.equal(h.run('results[0].phrase'), mapping.boundaries[0].phrase);
});

test('reviewer: independent restoration rejects text, navigation-label and unrelated-resource changes', async () => {
  const ctx = await inspectBook(fixture), mapping = draft(ctx, [{ decisionId: 'x', label: '1', phrase: 'Field notes begin' }]);
  const result = await applyMapping(ctx, mapping), zip = await openZip(result.output);
  const expected = { source: Buffer.from(fixture).toString('base64'), part: preface, path: [1, 1], textNode: 0, offset: 0, label: '1', paginationSource: mapping.paginationSource };
  const mutations = [
    [preface, decode(zip.entries.get(preface).bytes).replace('Field notes begin', 'Forged notes begin')],
    ['EPUB/nav.xhtml', decode(zip.entries.get('EPUB/nav.xhtml').bytes).replace('>1</a>', '>wrong label</a>')],
    ['EPUB/styles/book.css', '/* forbidden change */'],
  ];
  assert.ok(zip.entries.has('EPUB/styles/book.css'));
  for (const [part, value] of mutations) {
    const mutated = changed({ [part]: value }, result.output);
    python(verifyPython, { ...expected, output: Buffer.from(mutated).toString('base64') }, false);
  }
});

test('reviewer: 500 selected boundaries export in a large XML part without repeating whole-document work', async () => {
  const base = await original(preface);
  const body = '<body><!--' + 'x'.repeat(1_000_000) + '-->' + '<div/>'.repeat(5000) + Array.from({ length: 500 }, (_, i) => `<p>boundary-${String(i).padStart(3, '0')}</p>`).join('') + '</body>';
  const input = changed({ [preface]: base.replace(/<body>[\s\S]*<\/body>/, body) });
  const ctx = await inspectBook(input);
  const records = Array.from({ length: 500 }, (_, i) => ({ decisionId: `r${i}`, label: String(i), phrase: `boundary-${String(i).padStart(3, '0')}` }));
  const mapping = draft(ctx, records), before = structuredClone(mapping);
  const out = await applyMapping(ctx, mapping);
  assert.equal(out.receipt.boundaries.length, 500); assert.deepEqual(mapping, before);
  assert.equal(out.receipt.changedParts.length, 3);
  const bytes = await openZip(out.output);
  assert.equal((decode(bytes.entries.get(preface).bytes).match(/role="doc-pagebreak"/g) ?? []).length, 500);
  assert.equal((decode(bytes.entries.get('EPUB/nav.xhtml').bytes).match(/#pt-page-/g) ?? []).length, 500);
  for (const item of out.receipt.unchangedParts) assert.deepEqual(bytes.entries.get(item.part).bytes, ctx.zip.entries.get(item.part).bytes);
  assert.deepEqual(JSON.parse(mappingText(out.mapping)), out.mapping);
});

test('reviewer: JSON rejects escaped duplicate keys and bounded deep/container explosions', () => {
  for (const raw of ['{"label":"first","la\\u0062el":"second"}', '['.repeat(65) + '0' + ']'.repeat(65), '[' + '0,'.repeat(20000) + '0]']) {
    assert.throws(() => parseJSON(raw), e => e.name === 'InputError');
  }
  const exact = { text: 'Literal \ufffd and 🧭', nested: [{ label: ' x\t y ' }] };
  assert.deepEqual(parseJSON(JSON.stringify(exact)), exact);
});

test('reviewer: oversized record arrays reject before index enumeration', async () => {
  const ctx = await inspectBook(fixture); let enumerations = 0;
  const records = new Proxy(Array(501), { ownKeys() { enumerations++; throw new Error('must reject length before walking indexes'); } });
  assert.throws(() => findCandidates(ctx, records), e => e.name === 'InputError' && e.code === 'boundary-limit');
  assert.equal(enumerations, 0);
});

test('reviewer: huge invalid API strings reject normally under a 128 MiB heap', () => {
  const run = spawnSync(process.execPath, ['--max-old-space-size=128', '--input-type=module', '-e', `
    import assert from 'node:assert/strict';import {readFile} from 'node:fs/promises';
    import {inspectBook,findCandidates,previewMapping} from './src/core.mjs';
    const ctx=await inspectBook(await readFile('tests/fixtures/field-notes.epub'));
    const huge='x'.repeat(16*1024*1024);
    assert.throws(()=>findCandidates(ctx,[{decisionId:'x',label:'1',phrase:huge}]),e=>e.code==='phrase');
    assert.throws(()=>previewMapping(ctx,{schema:'page-thread-mapping-v1',inputSha256:ctx.model.input.sha256,whitespace:'xml-s-collapse-v1',paginationSource:huge}),e=>e.code==='pagination-source');
    console.log('bounded invalid strings');
  `], { encoding: 'utf8', cwd: new URL('..', import.meta.url), timeout: 30_000 });
  assert.equal(run.error, undefined, run.error?.message); assert.equal(run.status, 0, run.stderr); assert.match(run.stdout, /bounded invalid strings/);
});

test('reviewer: actual worker-thread preview/export matches module results and retains caller input', async () => {
  const { Worker } = await import('node:worker_threads');
  const { workerSource } = await import('../scripts/worker-bundle.mjs');
  const worker = new Worker(`const {parentPort}=require('node:worker_threads');globalThis.self={postMessage:(message,transfer)=>parentPort.postMessage(message,transfer)};\n${await workerSource()}\nparentPort.on('message',data=>self.onmessage({data}));`, { eval: true });
  let id = 0;
  const ask = payload => new Promise((resolve, reject) => {
    const requestId = ++id;
    const onMessage = data => { if (data.id !== requestId) return; worker.off('message', onMessage); worker.off('error', onError); resolve(data); };
    const onError = error => { worker.off('message', onMessage); reject(error); };
    worker.once('error', onError); worker.on('message', onMessage); worker.postMessage({ ...payload, id: requestId, bytes: fixture, name: 'reviewer.epub' });
  });
  try {
    const ctx = await inspectBook(fixture, 'reviewer.epub');
    const records = [{ decisionId: 'x', label: ' \tiv\r\n ', phrase: 'Field notes begin' }];
    const mapping = draft(ctx, records); mapping.paginationSource = 'Edition\r2026';
    const before = fixture.slice(), preview = await ask({ type: 'preview', mapping });
    assert.equal(preview.type, 'previewed'); assert.deepEqual(preview.preview, previewMapping(ctx, mapping));
    const result = await ask({ type: 'export', mapping }), expected = await applyMapping(ctx, mapping);
    assert.equal(result.type, 'exported'); assert.deepEqual(result.output, expected.output); assert.deepEqual(result.receipt, expected.receipt); assert.equal(result.reportHTML, reportHTML(expected.receipt));
    assert.deepEqual(fixture, before);
    const failure = await ask({ type: 'preview', mapping: { ...mapping, inputSha256: '0'.repeat(64) } });
    assert.equal(failure.type, 'error'); assert.equal(failure.error.code, 'stale-mapping');
  } finally { await worker.terminate(); }
});

test('reviewer: prefixed XHTML and OPF retain original namespace declarations around additions', async () => {
  const parts = {};
  for (const part of [preface, 'EPUB/nav.xhtml', 'EPUB/package.opf']) {
    const ns = part.endsWith('.opf') ? 'http://www.idpf.org/2007/opf' : 'http://www.w3.org/1999/xhtml';
    parts[part] = (await original(part)).replace(`xmlns="${ns}"`, `xmlns="urn:unused" xmlns:review="${ns}"`).replace(/<(\/?)([A-Za-z][\w.-]*)(?=[\s/>])/g, '<$1review:$2');
  }
  const input = changed(parts), ctx = await inspectBook(input), mapping = draft(ctx, [{ decisionId: 'x', label: '1', phrase: 'Field notes begin' }]);
  const result = await applyMapping(ctx, mapping);
  assert.equal(python(verifyPython, { source: Buffer.from(input).toString('base64'), output: Buffer.from(result.output).toString('base64'), part: preface, path: [1, 1], textNode: 0, offset: 0, label: '1', paginationSource: mapping.paginationSource }).restored, true);
});

test('reviewer: central-directory permutations retain the required first physical mimetype entry', async () => {
  for (const reverse of [true, false]) {
    const input = fixture.slice(), view = new DataView(input.buffer);
    let end = input.length - 22;
    while (view.getUint32(end, true) !== 0x06054b50) end--;
    const start = view.getUint32(end + 16, true), count = view.getUint16(end + 10, true), records = [];
    let cursor = start;
    for (let i = 0; i < count; i++) {
      const size = 46 + view.getUint16(cursor + 28, true) + view.getUint16(cursor + 30, true) + view.getUint16(cursor + 32, true);
      records.push(input.slice(cursor, cursor + size)); cursor += size;
    }
    const order = reverse ? records.reverse() : [...records.slice(1), records[0]];
    cursor = start; for (const record of order) { input.set(record, cursor); cursor += record.length; }
    const ctx = await inspectBook(input), mapping = draft(ctx, [{ decisionId: 'x', label: '1', phrase: 'Field notes begin' }]);
    const result = await applyMapping(ctx, mapping), zip = await openZip(result.output);
    const physical = new DataView(result.output.buffer, result.output.byteOffset, result.output.byteLength);
    assert.equal(physical.getUint32(0, true), 0x04034b50);
    assert.equal(new TextDecoder().decode(result.output.subarray(30, 30 + physical.getUint16(26, true))), 'mimetype');
    assert.equal(physical.getUint16(8, true), 0);
    assert.equal(zip.entries.get('mimetype').offset, 0, 'EPUB OCF requires the first physical member to be mimetype');
    assert.equal(zip.entries.get('mimetype').method, 0);
    assert.equal(decode(zip.entries.get('mimetype').bytes), 'application/epub+zip');
    assert.deepEqual([...zip.entries.keys()], [...ctx.zip.entries.keys()], 'central-directory presentation order is retained independently');
    for (const item of result.receipt.unchangedParts) assert.deepEqual(zip.entries.get(item.part).bytes, ctx.zip.entries.get(item.part).bytes);
    await assert.rejects(inspectBook(result.output), e => e.code === 'existing-pagination', 'output must pass container checks before its intentional pagination rejection');
  }
});
