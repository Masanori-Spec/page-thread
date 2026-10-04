// Verify retained evidence, not a new hosted execution. The manifest pins the
// inspected commit/run; later documentation heads require their own CI audit.
import {readFile,readdir} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import assert from 'node:assert/strict';
import {inspectBook,applyMapping,mappingText} from '../src/core.mjs';
import {parseJSON} from '../src/json.mjs';
import {reportHTML} from '../src/report.mjs';

const base='docs/hosted-evidence/',hash=b=>createHash('sha256').update(b).digest('hex');
const record=JSON.parse(await readFile(base+'evidence.json','utf8'));
assert.equal(record.schema,'page-thread-hosted-evidence-v1');
assert.equal(record.commit,'11411ee7836a7001735b9db9bfb9117baa2a47d6');
assert.equal(record.runId,37195622780);assert.equal(record.status,'passed');
const names=new Set();
for(const file of record.files){
 assert.match(file.path,/^(browser|epubcheck)\/[a-z0-9.-]+$/);assert.ok(!names.has(file.path));names.add(file.path);
 const bytes=await readFile(base+file.path);assert.equal(bytes.length,file.bytes,file.path);assert.equal(hash(bytes),file.sha256,file.path);
}
for(const group of ['browser','epubcheck'])for(const name of await readdir(base+group))assert.ok(names.has(group+'/'+name),'Unrecorded evidence file');
for(const file of record.sourceBindings)assert.equal(hash(await readFile(file.path)),file.sha256,'Tested source changed; refresh evidence: '+file.path);
const browser=JSON.parse(await readFile(base+'browser/results.json','utf8'));
assert.equal(browser.status,'passed');assert.equal(browser.chromiumSandbox,true);assert.equal(browser.checks.length,14);assert.equal(new Set(browser.checks).size,14);assert.deepEqual(browser.uncaughtErrors,[]);
assert.equal(browser.readingSystemTested,false);assert.equal(browser.editorialBoundaryCorrectnessTested,false);
const original=new Uint8Array(await readFile('tests/fixtures/field-notes.epub'));
const mappingBytes=await readFile(base+'browser/mapping.json'),mapping=parseJSON(new TextDecoder('utf-8',{fatal:true}).decode(mappingBytes));
const replay=await applyMapping(await inspectBook(original),mapping);
assert.deepEqual(Buffer.from(replay.output),await readFile(base+'browser/paginated.epub'));
assert.equal(mappingText(replay.mapping),mappingBytes.toString('utf8'));
assert.deepEqual(replay.receipt,JSON.parse(await readFile(base+'browser/receipt.json','utf8')));
assert.equal(reportHTML(replay.receipt),await readFile(base+'browser/review.html','utf8'));
const validator=JSON.parse(await readFile(base+'epubcheck/results.json','utf8'));
assert.equal(validator.status,'passed');assert.equal(validator.results.length,2);
assert.equal(validator.releaseArchiveSha256,'33350c61038e71dfb3d45a76aed04bf5481e6d5500cb780f6e98db8bbd15a28c');
for(const item of validator.results){
 const bytes=await readFile(base+'epubcheck/'+item.report),report=JSON.parse(bytes.toString('utf8'));
 assert.equal(hash(bytes),item.reportSha256);assert.equal(item.sha256,hash(await readFile(item.fixture)));
 assert.equal(report.checker.checkerVersion,'5.4.0');assert.equal(report.publication.ePubVersion,'3.4');
 for(const field of ['nFatal','nError','nWarning','nUsage'])assert.equal(report.checker[field],0);
 assert.deepEqual(report.messages,[]);
}
execFileSync('python3',['tests/oracle.py','tests/fixtures/field-notes.epub',base+'browser/paginated.epub',base+'browser/receipt.json','--expected-selection','tests/fixtures/expected-selection.json','--mapping',base+'browser/mapping.json'],{stdio:'inherit'});
console.log('Pinned hosted evidence hashes, tested source bindings, actual export replay and independent oracle passed (run 37195622780; no hosted jobs rerun)');
