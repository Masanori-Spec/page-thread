// Actual app handlers with a deliberately limited DOM double and stateless
// worker transport. These are regression tests, not browser or visual evidence.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import vm from 'node:vm';
import {createHash} from 'node:crypto';
import {createDOM} from './ui-dom.mjs';
import * as demo from '../src/demo-data.mjs';
import {UI,errorMessage} from '../src/i18n.mjs';
import {VERSION} from '../src/limits.mjs';
import {parseJSON} from '../src/json.mjs';
import {inspectBook,findCandidates,previewMapping,applyMapping} from '../src/core.mjs';
import {reportHTML} from '../src/report.mjs';

const source = (await fs.readFile(new URL('../src/app.mjs',import.meta.url),'utf8')).replace(/^import[^\n]+\n/gm,'');
const textFile = (text,name='mapping.json') => ({name,size:Buffer.byteLength(text),arrayBuffer:async()=>new TextEncoder().encode(text).buffer});
const deferred = () => { let resolve; const promise=new Promise(done=>{resolve=done;}); return {promise,resolve}; };

function harness() {
  const {document,window}=createDOM();
  const workers=[],blobs=new Map(),downloads=[],hold=new Set(); let blobId=0;
  class FakeWorker {
    constructor(){workers.push(this);this.dead=false;}
    terminate(){this.dead=true;}
    postMessage(raw) {
      // The production Worker transport creates realm-local plain objects.
      const d=structuredClone(raw); this.request=d; this.callback=this.onmessage; this.errorCallback=this.onerror;
      this.deliver=async()=>{
        try {
          const ctx=await inspectBook(d.bytes,d.name);let response;
          if(d.type==='inspect')response={id:d.id,type:'inspected',model:ctx.model};
          if(d.type==='search')response={id:d.id,type:'searched',results:findCandidates(ctx,d.records)};
          if(d.type==='preview')response={id:d.id,type:'previewed',preview:previewMapping(ctx,d.mapping)};
          if(d.type==='export'){const result=await applyMapping(ctx,d.mapping);response={id:d.id,type:'exported',...result,reportHTML:reportHTML(result.receipt)};}
          if(!this.dead)this.onmessage?.({data:response});
        }catch(error){if(!this.dead)this.onmessage?.({data:{id:d.id,type:'error',error:{code:error.code??'internal'}}});}
      };
      if(!hold.has(d.type))Promise.resolve().then(this.deliver);
    }
  }
  const makeElement=document.createElement;
  document.createElement=tag=>{const node=makeElement(tag);if(tag==='a')node.click=()=>downloads.push({name:node.download,blob:blobs.get(node.href)});return node;};
  const context=vm.createContext({document,window,UI,errorMessage,parseJSON,...demo,WORKER_SOURCE:'Worker transport replaced only in this test double',VERSION,Worker:FakeWorker,Blob,URL:{createObjectURL(blob){const id=`blob:${++blobId}`;blobs.set(id,blob);return id;},revokeObjectURL(id){blobs.delete(id);}},Uint8Array,TextDecoder,atob,Date,Map,Set,setTimeout:callback=>{callback();}});
  const run=code=>vm.runInContext(code,context);
  vm.runInContext(source,context);
  return {document,window,run,context,workers,blobs,downloads,hold,id:id=>document.getElementById(id)};
}

async function sampleToPreview(h) {
  await h.run('importEPUB(null,true)');await h.run('search()');h.id('demo-selection').onclick();await h.run('requestPreview()');
  assert.equal(h.run('prepared.rows.length'),demo.DEMO_RECORDS.length);
}

test('sample requires explicit choices and exports four independently usable files',async()=>{
  const h=harness();await h.run('importEPUB(null,true)');
  assert.equal(h.run('model.input.sha256'),demo.DEMO_SHA256);
  assert.equal(h.run('paginationSource'),demo.DEMO_SOURCE);
  await h.run('search()');assert.equal(h.run('choices.size'),0);assert.equal(h.id('preview').disabled,true);
  assert.ok(h.run('results.some(row=>row.candidateCount>1)'));
  assert.ok(h.document.querySelectorAll('input[data-row]').every(radio=>!radio.checked));
  h.id('demo-selection').onclick();assert.equal(h.run('chosenCount()'),8);assert.equal(h.id('preview').disabled,false);
  await h.run('requestPreview()');await h.run('requestExport()');
  assert.ok(h.run('exported.output.byteLength>0'));assert.equal(h.run('busy'),null);
  for(const name of ['epub','mapping','receipt','report'])h.id(`download-${name}`).onclick();
  assert.deepEqual(h.downloads.map(item=>item.name),['pagethread-pages.epub','pagethread-mapping.json','pagethread-receipt.json','pagethread-report.html']);
  const mapping=await h.downloads[1].blob.text();
  assert.ok(mapping.endsWith('\n'));assert.equal(createHash('sha256').update(mapping).digest('hex'),h.run('exported.receipt.mappingSha256'));
  assert.equal(JSON.parse(await h.downloads[2].blob.text()).outputSha256,h.run('exported.receipt.outputSha256'));
  assert.ok((await h.downloads[3].blob.text()).includes('<!doctype html>'));
  assert.equal(h.blobs.size,0,'worker and completed download URLs are revoked');
});

test('zero matches remain unresolved, and native candidate radio handlers invalidate preview',async()=>{
  const h=harness();await sampleToPreview(h);
  const radio=h.document.querySelector('input[data-row]');radio.checked=true;radio.onchange();
  assert.equal(h.run('prepared'),null);assert.equal(h.document.activeElement.id,radio.id);
  h.id('clear-choices').onclick();assert.equal(h.run('choices.size'),0);assert.equal(h.id('preview').disabled,true);
  h.run('recordText="9\\tUnfindable quotation 490238";recordIds=[]');await h.run('search()');
  assert.equal(h.run('results[0].candidateCount'),0);assert.equal(h.id('preview').disabled,true);
  assert.match(h.document.querySelector('#app').textContent,/候補がありません/);
});

test('sample shortcut matches exact label and phrase after TSV paste, preserving page label whitespace',async()=>{
  const h=harness();await h.run('importEPUB(null,true)');
  h.run('recordIds=[]');await h.run('search()');assert.equal(h.run('results[0].decisionId'),'page-1');
  h.id('demo-selection').onclick();assert.equal(h.run('chosenCount()'),demo.DEMO_RECORDS.length);
  assert.equal(h.run('parseRecords("  iv \\tField notes begin",[])[0].label'),'  iv ');
  h.run('recordText="custom\\tA shared beginning";recordIds=[]');await h.run('search()');h.id('demo-selection').onclick();
  assert.equal(h.run('chosenCount()'),0,'a different label cannot use a sample decision');
});

test('failed EPUB replacement retains the previously committed book and exports',async()=>{
  const h=harness();await sampleToPreview(h);await h.run('requestExport()');
  const original=h.run('model'),previousOutput=h.run('exported');
  h.context.badFile={size:20,name:'broken.epub',arrayBuffer:async()=>new ArrayBuffer(20)};await h.run('importEPUB(badFile)');
  assert.equal(h.run('model'),original);assert.equal(h.run('exported'),previousOutput);assert.ok(h.run('error'));assert.equal(h.run('busy'),null);
});

test('saved mapping revalidates all locations and preserves choices across language changes',async()=>{
  const h=harness();await sampleToPreview(h);
  const mapping=h.run('JSON.stringify(prepared.mapping)');h.context.mappingFile=textFile(mapping);
  h.id('clear-choices').onclick();await h.run('restoreMapping(mappingFile)');
  assert.equal(h.run('chosenCount()'),8);assert.equal(h.run('notice'),'restored');
  h.document.querySelector('[data-lang="en"]').onclick();assert.equal(h.document.documentElement.lang,'en');assert.equal(h.run('chosenCount()'),8);assert.ok(h.run('prepared'));
  const validPreview=h.run('prepared');h.context.staleFile=textFile(mapping.replace(demo.DEMO_SHA256,'0'.repeat(64)));
  await h.run('restoreMapping(staleFile)');assert.equal(h.run('prepared'),validPreview);assert.equal(h.run('error.code'),'stale-mapping');
});

test('reset and cancellation make delayed EPUB reads inert',async()=>{
  const h=harness();await h.run('importEPUB(null,true)');
  const slow=deferred();h.context.slowFile={size:30,name:'slow.epub',arrayBuffer:()=>slow.promise};
  const pending=h.run('importEPUB(slowFile)');h.id('reset').onclick();slow.resolve(new ArrayBuffer(30));await pending;
  assert.equal(h.run('model'),null);assert.equal(h.run('busy'),null);assert.equal(h.run('notice'),'cleared');
  await h.run('importEPUB(null,true)');const retained=h.run('model');
  const cancelled=deferred();h.context.cancelledFile={size:30,name:'cancelled.epub',arrayBuffer:()=>cancelled.promise};
  const pending2=h.run('importEPUB(cancelledFile)');h.id('cancel').onclick();cancelled.resolve(new ArrayBuffer(30));await pending2;
  assert.equal(h.run('model'),retained);assert.equal(h.run('notice'),'cancelled');
});

test('cancelled export and stale worker success/error cannot overwrite the workspace',async()=>{
  const h=harness();await sampleToPreview(h);const preview=h.run('prepared');
  h.hold.add('export');const pending=h.run('requestExport()');const stale=h.workers.at(-1);
  h.id('cancel').onclick();await pending;assert.equal(h.run('prepared'),preview);assert.equal(h.run('exported'),null);assert.equal(stale.dead,true);
  stale.callback({data:{id:stale.request.id,type:'exported',output:new Uint8Array([1]),receipt:{}}});stale.errorCallback();
  assert.equal(h.run('prepared'),preview);assert.equal(h.run('exported'),null);assert.equal(h.run('error'),null);assert.equal(h.run('notice'),'cancelled');
});

test('delayed mapping read cannot restore state after reset or a newer import',async()=>{
  const h=harness();await sampleToPreview(h);const mapping=h.run('JSON.stringify(prepared.mapping)');
  const read=deferred();h.context.delayedMapping={size:mapping.length,arrayBuffer:()=>read.promise};
  const pending=h.run('restoreMapping(delayedMapping)');h.id('reset').onclick();await h.run('importEPUB(null,true)');
  read.resolve(new TextEncoder().encode(mapping).buffer);await pending;
  assert.equal(h.run('prepared'),null);assert.equal(h.run('choices.size'),0);assert.equal(h.run('notice'),'demoLoaded');
});

test('imported text is escaped and TSV/source/date limits are enforced',async()=>{
  const h=harness();await h.run('importEPUB(null,true)');
  h.id('records').value='1\t<script>alert(1)</script>';h.id('records').selectionStart=4;h.id('records').selectionEnd=4;h.id('records').oninput({target:h.id('records')});
  assert.equal(h.document.querySelectorAll('script').length,0);assert.ok(h.document.querySelector('#app').innerHTML.includes('&lt;script&gt;'));assert.equal(h.run('results'),null);
  assert.equal(h.run('parseRecords("1\\talpha",[])[0].phrase'),'alpha');
  assert.throws(()=>h.run('parseRecords("missing tab",[])'),error=>error.code==='records-format');
  assert.throws(()=>h.run('parseRecords("1\\t"+"😀".repeat(257),[])'),error=>error.code==='phrase-limit');
  assert.throws(()=>h.run('validateSource(" ","2026-10-04T09:00:00Z")'),error=>error.code==='source-limit');
  assert.throws(()=>h.run('validateSource("edition","2026-02-30T09:00:00Z")'),error=>error.code==='modified-format');
});
