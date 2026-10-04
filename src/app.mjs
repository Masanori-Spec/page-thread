import { UI, errorMessage } from './i18n.mjs';
import { DEMO_BASE64, DEMO_SHA256, DEMO_RECORDS, DEMO_CHOICES, DEMO_SOURCE } from './demo-data.mjs';
import { WORKER_SOURCE } from './worker-source.mjs';
import { VERSION } from './limits.mjs';
import { parseJSON } from './json.mjs';

const MAX_INPUT = 25 * 1024 * 1024, MAX_MAPPING = 1024 * 1024;
const root = document.querySelector('#app');
const el = id => document.getElementById(id);
const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const xmlTrim = value => value.replace(/^[\x20\t\r\n]+|[\x20\t\r\n]+$/g, '');
const length = value => [...value].length;
const nowUTC = () => new Date().toISOString().replace(/\.\d{3}Z$/, 'Z');
let lang = 'ja', model = null, sourceBytes = null, paginationSource = '', recordText = '', recordIds = [], modifiedAfter = nowUTC();
let restoredRecords = null, restoredText = null;
const restoredSpecial = () => restoredRecords && restoredText === recordText && restoredRecords.some(row=>/[\t\r\n]/.test(row.label)||/[\r\n]/.test(row.phrase));
const recordCount = () => restoredRecords && restoredText === recordText ? restoredRecords.length : recordText.split(/\r?\n/).filter(line=>xmlTrim(line)).length;
let results = null, choices = new Map(), prepared = null, exported = null, busy = null, notice = null, error = null;
let generation = 0, worker = null, workerURL = null, rejectPending = null;
const downloadURLs = new Set();
const t = key => UI[lang][key] ?? key;
const countBlocks = key => (model?.spine ?? []).reduce((sum, item) => sum + (Number(item[key]) || 0), 0);
const chosenCount = () => results?.filter(row => row.candidates.some(candidate => candidate.id === choices.get(row.decisionId))).length ?? 0;
const allChosen = () => Boolean(results?.length && chosenCount() === results.length);
const pathText = path => Array.isArray(path) ? path.join('.') : String(path ?? '—');
const sampleChoice = row => {
  const originals = DEMO_RECORDS.filter(original => original.label === row.label && original.phrase === row.phrase);
  return originals.length === 1 ? DEMO_CHOICES[originals[0].decisionId] : null;
};

function render(focus = null, caret = null) {
  document.documentElement.lang = lang;
  document.title = lang === 'ja' ? 'PageThread · 紙のページを、電子の本文へ' : 'PageThread · Print pages, connected';
  const stage = exported ? 5 : prepared ? 4 : results ? 3 : model ? 2 : 1;
  root.innerHTML = `
    <header class="topbar"><a class="brand" href="./" aria-label="PageThread"><span class="brand-mark" aria-hidden="true"><i></i><i></i></span>PageThread<span class="version">${esc(VERSION)}</span></a><div class="top-tools"><span class="local-indicator"><i aria-hidden="true"></i>${esc(t('noStorage'))}</span><div class="language" role="group" aria-label="Language / 言語"><button data-lang="ja" aria-pressed="${lang === 'ja'}">日本語</button><button data-lang="en" aria-pressed="${lang === 'en'}">EN</button></div></div></header>
    <main>
      <section class="hero"><div class="hero-copy"><p class="eyebrow">${t('tag')}</p><h1>${esc(t('title')).replace(/\n/g, '<br>')}</h1><p class="intro">${esc(t('intro'))}</p><ul class="principles"><li>${esc(t('local'))}</li><li>${esc(t('explicit'))}</li><li>${esc(t('evidence'))}</li></ul></div><div class="paper-diagram" aria-hidden="true"><div class="diagram-label">PRINT → EPUB</div><div class="paper-leaf"><span class="leaf-label">AN EDITOR-CHOSEN BOUNDARY</span><span class="folio">027</span><div class="text-lines"><i></i><i></i><i></i><i></i></div><div class="page-thread"><span></span><b>page 27</b></div><div class="text-lines bottom"><i></i><i></i><i></i></div></div><p>THE LOCATION IS YOUR DECISION.</p></div></section>
      <ol class="steps" aria-label="${lang === 'ja' ? '作業の流れ' : 'Workflow'}">${['stepImport','stepRecords','stepReview','stepPreview','stepExport'].map((key,index) => `<li class="${stage === index+1 ? 'current' : stage > index+1 ? 'complete' : ''}" ${stage === index+1 ? 'aria-current="step"' : ''}><span>0${index+1}</span>${esc(t(key))}</li>`).join('')}</ol>
      <section class="import-panel" aria-labelledby="import-heading"><div><p class="eyebrow">01 / EPUB</p><h2 id="import-heading">${esc(t('importTitle'))}</h2><p>${esc(t('importBody'))}</p><small>${esc(t('limits'))}</small></div><div class="import-controls"><div class="actions"><label class="file-button primary" for="file"><span aria-hidden="true">↑</span> ${esc(t('open'))}<input id="file" type="file" accept=".epub,application/epub+zip"></label><button id="demo">${esc(t('demo'))}</button><button id="reset" class="text-button" ${!model && !busy ? 'disabled' : ''}>${esc(t('reset'))}</button></div><p>${esc(t('replace'))}</p></div></section>
      <div id="status" class="status ${error ? 'error' : ''}" role="status" aria-live="polite" aria-atomic="true">${error ? `<span class="status-dot" aria-hidden="true"></span><div><strong>${esc(t('error'))}</strong><span>${esc(errorMessage(error,lang))}</span>${error.code ? `<small>${esc(error.code)}</small>` : ''}</div>` : notice ? `<span class="status-dot" aria-hidden="true"></span><span>${esc(t(notice))}</span>` : ''}</div>
      <div id="busy" class="processing" ${busy ? '' : 'hidden'} role="status" aria-live="polite"><span class="spinner" aria-hidden="true"></span><span>${esc(t(({inspect:'loading',search:'searching',preview:'previewing',export:'exporting',restore:'restoring'})[busy] ?? 'loading'))}</span><button id="cancel">${esc(t('cancel'))}</button></div>
      <section id="workspace" tabindex="-1" aria-busy="${Boolean(busy)}">${model ? workspace() : `<div class="empty-state"><div class="empty-symbol" aria-hidden="true">¶<span>↗</span></div><h2>${esc(t('emptyTitle'))}</h2><p>${esc(t('emptyBody'))}</p></div>`}</section>
      <section class="scope" aria-labelledby="scope-heading"><div><p class="eyebrow">SCOPE & CARE</p><h2 id="scope-heading">${esc(t('scope'))}</h2><a href="./guide.html">${esc(t('guide'))} <span aria-hidden="true">↗</span></a></div><div><p>${esc(t('scopeProfile'))}</p><p>${esc(t('scopeExclusions'))}</p><p>${esc(t('scopeStandards'))}</p><p>${esc(t('scopeVerification'))}</p><p class="privacy">${esc(t('privacy'))}</p></div></section>
      <footer><span>PageThread · ${esc(t('footer'))}</span><span>LOCAL EDITORIAL WORKBENCH / v${esc(VERSION)}</span></footer>
    </main>`;
  bind();
  if (focus) {
    el(focus)?.focus({preventScroll: caret !== null});
    if (caret !== null && el(focus)?.setSelectionRange) el(focus).setSelectionRange(caret.start, caret.end);
  }
}

function workspace() {
  return `<section class="book-summary" aria-labelledby="book-heading"><div class="book-title"><p class="eyebrow">${esc(t('book'))}</p><h2 id="book-heading">${esc(model.title || t('untitled'))}</h2><p>${esc(model.input.name)} · ${(model.input.bytes / 1024).toLocaleString(lang, {maximumFractionDigits:1})} KiB</p></div><dl class="book-counts"><div><dt>${esc(t('spine'))}</dt><dd>${model.spine.length}</dd></div><div><dt>${esc(t('supported'))}</dt><dd>${countBlocks('eligibleBlocks')}</dd></div><div><dt>${esc(t('unsupported'))}</dt><dd>${countBlocks('unsupportedBlocks')}</dd></div></dl></section>
    <details class="coverage"><summary>${esc(t('inspectDetails'))}</summary><div class="chapter-list">${model.spine.map(chapter => `<div><span class="chapter-order">${esc(chapter.order)}</span><div><strong>${esc(chapter.title || chapter.part)}</strong><small>${esc(chapter.part)}</small></div><span>${esc(t('supported'))} ${esc(chapter.eligibleBlocks ?? 0)} · ${esc(t('unsupported'))} ${esc(chapter.unsupportedBlocks ?? 0)}</span></div>`).join('')}</div><p>${esc(t('sourceTextCaveat'))}</p><h3>${esc(t('inputHash'))}</h3><p class="hash">${esc(model.input.sha256)}</p></details>
    <section class="record-panel" aria-labelledby="record-heading"><div class="section-heading"><p class="eyebrow">02 / SOURCE & RECORDS</p><h2 id="record-heading">${esc(t('sourceTitle'))}</h2><p>${esc(t('sourceIntro'))}</p></div><div class="record-grid"><div class="source-fields"><label for="source">${esc(t('paginationSource'))}</label><textarea id="source" rows="3" placeholder="${esc(t('sourcePlaceholder'))}" aria-describedby="source-hint" ${busy ? 'disabled' : ''}>${esc(paginationSource)}</textarea><p class="field-hint" id="source-hint">${esc(t('sourceHint'))}</p><details class="settings"><summary>${esc(t('exportSettings'))}</summary><label for="modified">${esc(t('modified'))}</label><input id="modified" type="text" value="${esc(modifiedAfter)}" spellcheck="false" aria-describedby="modified-hint" ${busy ? 'disabled' : ''}><p id="modified-hint" class="field-hint">${esc(t('modifiedHint'))}</p></details><label class="file-button mapping-button" for="mapping-file">↗ ${esc(t('restore'))}<input id="mapping-file" type="file" accept=".json,application/json" ${busy ? 'disabled' : ''}></label><p class="field-hint">${esc(t('restoreHint'))}</p></div><div class="record-fields"><div class="label-row"><label for="records">${esc(t('records'))}</label><span>${recordCount()} ${esc(t('parsedRows'))}</span></div><textarea id="records" rows="8" spellcheck="false" placeholder="${esc(t('recordsPlaceholder'))}" aria-describedby="records-hint" ${busy ? 'disabled' : ''}>${esc(recordText)}</textarea><p class="field-hint" id="records-hint">${esc(t('recordsHint'))}${restoredSpecial()?'<br>'+esc(t('restoredSpecial')):''}</p><div class="actions"><button id="search" class="primary" ${busy || !xmlTrim(recordText) ? 'disabled' : ''}>${esc(t('search'))} <span aria-hidden="true">→</span></button></div></div></div><aside class="exact-note"><strong>${esc(t('exactTitle'))}</strong><p>${esc(t('exactBody'))}</p></aside></section>
    ${results ? reviewUI() : ''}${prepared ? previewUI() : ''}${exported ? exportUI() : ''}`;
}

function reviewUI() {
  return `<section id="review-panel" class="review-panel" tabindex="-1" aria-labelledby="review-heading"><div class="section-heading review-heading"><div><p class="eyebrow">03 / CANDIDATE REVIEW</p><h2 id="review-heading">${esc(t('reviewTitle'))}</h2><p>${esc(t('reviewIntro'))}</p></div><div class="selection-count"><strong>${chosenCount()}<span> / ${results.length}</span></strong><span>${esc(t('chosen'))}</span></div></div><div class="review-actions"><button id="clear-choices" ${busy || !choices.size ? 'disabled' : ''}>${esc(t('clearChoices'))}</button>${model.input.sha256 === DEMO_SHA256 ? `<div><button id="demo-selection" ${busy || !results.some(row => row.candidates.some(candidate => candidate.id === sampleChoice(row))) ? 'disabled' : ''}>${esc(t('demoChoices'))}</button><small>${esc(t('demoChoicesHint'))}</small></div>` : ''}</div><div class="boundary-list">${results.map((row, rowIndex) => `<fieldset class="boundary ${choices.has(row.decisionId) ? 'has-choice' : ''}" ${busy ? 'disabled' : ''}><legend><span class="page-label">${esc(t('page'))} <b>${esc(row.label)}</b></span><span class="match-count ${row.candidateCount === 0 ? 'zero' : row.candidateCount > 1 ? 'many' : ''}">${row.candidateCount} ${esc(t('candidate'))}</span></legend><p class="search-quote">${esc(row.phrase)}</p><p class="match-help">${esc(t(row.candidateCount === 0 ? 'noCandidates' : row.candidateCount > 1 ? 'multiple' : 'one'))}</p><div class="candidates">${row.candidates.map((candidate, candidateIndex) => `<div class="candidate ${choices.get(row.decisionId) === candidate.id ? 'is-chosen' : ''}"><label class="candidate-choice" for="candidate-${rowIndex}-${candidateIndex}"><input id="candidate-${rowIndex}-${candidateIndex}" type="radio" name="boundary-${rowIndex}" data-row="${rowIndex}" data-candidate="${candidateIndex}" ${choices.get(row.decisionId) === candidate.id ? 'checked' : ''}><span class="candidate-body"><span class="candidate-meta"><b>${esc(candidate.chapterTitle || candidate.sourcePart)}</b><span>${esc(t('occurrence'))} ${candidateIndex + 1} · ${esc(t('paragraph'))} ${esc(candidate.blockOrdinal)}</span></span><span class="context">${esc(candidate.contextBefore)}<mark>${esc(candidate.matchText)}</mark>${esc(candidate.contextAfter)}</span></span></label><details class="candidate-location"><summary>${esc(t('candidateDetails'))}</summary><dl><dt>${esc(t('sourcePart'))}</dt><dd>${esc(candidate.sourcePart)}</dd><dt>${esc(t('sourcePath'))}</dt><dd>${esc(pathText(candidate.sourcePath))}</dd><dt>${esc(t('textNode'))} / ${esc(t('offset'))}</dt><dd>${esc(candidate.textNodeIndex)} / ${esc(candidate.offset)}</dd><dt>${esc(t('sourcePartHash'))}</dt><dd class="hash">${esc(candidate.sourcePartSha256)}</dd></dl></details></div>`).join('')}</div></fieldset>`).join('')}</div><div class="review-bottom"><span>${esc(t('chosen'))}: ${chosenCount()} ${esc(t('of'))} ${results.length}</span><button id="preview" class="primary" ${busy || !allChosen() ? 'disabled' : ''}>${esc(t('preview'))} <span aria-hidden="true">→</span></button></div></section>`;
}

function previewUI() {
  return `<section id="preview-panel" class="preview-panel" tabindex="-1" aria-labelledby="preview-heading"><div class="section-heading"><p class="eyebrow">04 / ORDERED PREVIEW</p><h2 id="preview-heading">${esc(t('previewTitle'))}</h2><p>${esc(t('previewIntro'))}</p></div><div class="preview-source"><span>${esc(t('previewSource'))}</span><strong>${esc(prepared.mapping.paginationSource)}</strong></div><ol class="preview-list">${prepared.rows.map(row => `<li><span class="preview-page"><small>${esc(t('page'))}</small><b>${esc(row.label)}</b></span><div><strong>${esc(row.chapterTitle || row.sourcePart)}</strong><p>${esc(row.contextBefore)}<mark>${esc(row.matchText ?? row.phrase)}</mark>${esc(row.contextAfter)}</p><small>${esc(row.sourcePart)} · ${esc(t('occurrence'))} ${esc(row.selectedOccurrence ?? '—')} / ${esc(row.candidateCount)}</small></div><span class="verified-mark" aria-hidden="true">↳</span></li>`).join('')}</ol><div class="preview-bottom"><p>${esc(t(exported ? 'ready' : 'previewNoChanges'))}</p><button id="export" class="primary" ${busy ? 'disabled' : ''}>${esc(t('export'))} <span aria-hidden="true">↓</span></button></div></section>`;
}

function exportUI() {
  const outputHash = exported.receipt?.outputSha256 ?? exported.receipt?.output?.sha256;
  return `<section id="export-result" class="export-result" tabindex="-1" aria-labelledby="export-heading"><p class="eyebrow">05 / EXPORT</p><h2 id="export-heading">${esc(t('ready'))}</h2><p>${esc(t('readyBody'))}</p><div class="download-grid"><button id="download-epub" class="primary"><span>01 / EPUB</span>${esc(t('downloadEpub'))}<b aria-hidden="true">↓</b></button><button id="download-mapping"><span>02 / JSON</span>${esc(t('downloadMapping'))}<b aria-hidden="true">↓</b></button><button id="download-receipt"><span>03 / JSON</span>${esc(t('downloadReceipt'))}<b aria-hidden="true">↓</b></button><button id="download-report"><span>04 / HTML</span>${esc(t('downloadReport'))}<b aria-hidden="true">↓</b></button></div><p class="field-hint">${esc(t('exportNote'))}</p>${outputHash ? `<details><summary>${esc(t('outputHash'))}</summary><p class="hash">${esc(outputHash)}</p></details>` : ''}</section>`;
}

function bind() {
  root.querySelectorAll('[data-lang]').forEach(button => { button.onclick = () => { lang = button.dataset.lang; render(); root.querySelector(`[data-lang="${lang}"]`)?.focus(); }; });
  el('file').onchange = event => { const file = event.target.files?.[0]; event.target.value = ''; if (file) importEPUB(file); };
  el('demo').onclick = () => importEPUB(null, true);
  el('cancel').onclick = () => { generation++; stopWorker(); busy = null; error = null; notice = 'cancelled'; render(model ? 'workspace' : 'demo'); };
  el('reset').onclick = () => { generation++; stopWorker(); model = sourceBytes = results = prepared = exported = null; recordText = paginationSource = ''; recordIds = []; restoredRecords = restoredText = null; choices = new Map(); modifiedAfter = nowUTC(); busy = error = null; notice = 'cleared'; render('demo'); };
  if (!model) return;
  for (const id of ['source','records','modified']) el(id).oninput = event => {
    const value = event.target.value, caret = {start:event.target.selectionStart, end:event.target.selectionEnd};
    if (id === 'source') paginationSource = value;
    if (id === 'records') { recordText = value; recordIds = []; restoredRecords = restoredText = null; }
    if (id === 'modified') modifiedAfter = value;
    invalidate(id === 'records'); render(id, caret);
  };
  el('search').onclick = search;
  el('mapping-file').onchange = event => { const file = event.target.files?.[0]; event.target.value = ''; if (file) restoreMapping(file); };
  if (results) {
    root.querySelectorAll('input[data-row]').forEach(radio => { radio.onchange = () => {
      if (!radio.checked || busy) return;
      const row = results[Number(radio.dataset.row)], candidate = row?.candidates[Number(radio.dataset.candidate)];
      if (!candidate) return;
      choices.set(row.decisionId, candidate.id); invalidate(false); render(radio.id);
    }; });
    el('clear-choices').onclick = () => { choices.clear(); invalidate(false); render('clear-choices'); };
    if (el('demo-selection')) el('demo-selection').onclick = () => {
      if (busy || model.input.sha256 !== DEMO_SHA256) return;
      choices = new Map(results.filter(row => row.candidates.some(candidate => candidate.id === sampleChoice(row))).map(row => [row.decisionId, sampleChoice(row)]));
      invalidate(false); notice = 'selectedDemo'; render('demo-selection');
    };
    el('preview').onclick = requestPreview;
  }
  if (prepared) el('export').onclick = requestExport;
  if (exported) {
    el('download-epub').onclick = () => download(exported.output, 'pagethread-pages.epub', 'application/epub+zip');
    el('download-mapping').onclick = () => download(JSON.stringify(exported.mapping, null, 2) + '\n', 'pagethread-mapping.json', 'application/json');
    el('download-receipt').onclick = () => download(JSON.stringify(exported.receipt, null, 2) + '\n', 'pagethread-receipt.json', 'application/json');
    el('download-report').onclick = () => download(exported.reportHTML, 'pagethread-report.html', 'text/html;charset=utf-8');
  }
}

function invalidate(clearResults) {
  generation++; stopWorker(); busy = null; prepared = exported = null; error = null; notice = null;
  if (clearResults) { results = null; choices = new Map(); }
}

function parseRecords(text = recordText, ids = recordIds) {
  if (restoredRecords && text === restoredText && text === recordText && ids === recordIds) return restoredRecords.map(row=>({...row}));
  const lines = text.split(/\r?\n/).filter(line => xmlTrim(line));
  if (!lines.length || lines.length > 500) throw {code:'records-limit'};
  return lines.map((line, index) => {
    const tab = line.indexOf('\t');
    if (tab < 0) throw {code:'records-format'};
    const label = line.slice(0, tab), phrase = line.slice(tab + 1);
    if (!xmlTrim(label) || length(label) > 64) throw {code:'label-limit'};
    if (!xmlTrim(phrase) || length(phrase) > 256) throw {code:'phrase-limit'};
    return {decisionId:ids[index] ?? `page-${index + 1}`, label, phrase};
  });
}

function validateSource(source = paginationSource, time = modifiedAfter) {
  if (!xmlTrim(source) || length(source) > 512) throw {code:'source-limit'};
  if (!/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\dZ$/.test(time) || !Number.isFinite(Date.parse(time)) || new Date(time).toISOString().replace('.000Z','Z') !== time) throw {code:'modified-format'};
}

function mappingFromChoices() {
  validateSource();
  if (!allChosen()) throw {code:'selection-required'};
  return {schema:'page-thread-mapping-v1', inputSha256:model.input.sha256, paginationSource, modifiedAfter, whitespace:'xml-s-collapse-v1', boundaries:results.map(row => ({decisionId:row.decisionId, label:row.label, phrase:row.phrase, candidateId:choices.get(row.decisionId)}))};
}

function stopWorker() {
  const reject = rejectPending; rejectPending = null;
  if (worker) { worker.onmessage = worker.onerror = worker.onmessageerror = null; worker.terminate(); worker = null; }
  if (workerURL) { URL.revokeObjectURL(workerURL); workerURL = null; }
  reject?.({code:'cancelled'});
}

function begin(type) {
  const token = ++generation;
  stopWorker(); busy = type; error = notice = null; render(); return token;
}

function runWorker(type, token, {bytes = sourceBytes, name = model?.input.name, ...payload} = {}) {
  return new Promise((resolve, reject) => {
    if (token !== generation) { reject({code:'cancelled'}); return; }
    let ownedWorker, ownedURL, settled = false;
    const cleanup = () => {
      ownedWorker.onmessage = ownedWorker.onerror = ownedWorker.onmessageerror = null;
      ownedWorker.terminate(); URL.revokeObjectURL(ownedURL);
      if (worker === ownedWorker) { worker = workerURL = rejectPending = null; }
    };
    try {
      ownedURL = URL.createObjectURL(new Blob([WORKER_SOURCE], {type:'text/javascript'}));
      ownedWorker = new Worker(ownedURL); workerURL = ownedURL; worker = ownedWorker;
      rejectPending = reason => { if (!settled) { settled = true; reject(reason); } };
      ownedWorker.onmessage = ({data}) => {
        if (settled || token !== generation || worker !== ownedWorker || data?.id !== token) return;
        settled = true; cleanup();
        if (data.type === 'error') reject(data.error ?? {code:'worker'});
        else if (data.type !== ({inspect:'inspected',search:'searched',preview:'previewed',export:'exported'})[type]) reject({code:'worker'});
        else resolve(data);
      };
      ownedWorker.onerror = ownedWorker.onmessageerror = () => {
        if (settled || token !== generation || worker !== ownedWorker) return;
        settled = true; cleanup(); reject({code:'worker'});
      };
      // Deliberately do not transfer: the committed original remains owned by this tab.
      ownedWorker.postMessage({id:token, type, bytes, name, ...payload});
    } catch {
      if (ownedWorker) cleanup(); else if (ownedURL) URL.revokeObjectURL(ownedURL);
      settled = true; reject({code:'worker'});
    }
  });
}

function fail(cause, token, focus = null) {
  if (token !== generation) return;
  stopWorker(); busy = null; error = cause?.code ? cause : {code:'worker'}; notice = null; render(focus);
}

async function importEPUB(file, demo = false) {
  const token = begin('inspect');
  try {
    if (!demo && file.size > MAX_INPUT) throw {code:'input-size'};
    let bytes;
    if (demo) bytes = Uint8Array.from(atob(DEMO_BASE64), c => c.charCodeAt(0));
    else { try { bytes = new Uint8Array(await file.arrayBuffer()); } catch { throw {code:'file-read'}; } }
    if (token !== generation) return;
    if (bytes.byteLength > MAX_INPUT) throw {code:'input-size'};
    const data = await runWorker('inspect', token, {bytes, name:demo ? 'pagethread-sample.epub' : file.name});
    if (token !== generation) return;
    model = data.model; sourceBytes = bytes; choices = new Map(); results = prepared = exported = null; restoredRecords = restoredText = null;
    paginationSource = demo ? DEMO_SOURCE : ''; recordText = demo ? DEMO_RECORDS.map(row => `${row.label}\t${row.phrase}`).join('\n') : ''; recordIds = demo ? DEMO_RECORDS.map(row => row.decisionId) : [];
    modifiedAfter = nowUTC(); busy = null; error = null; notice = demo ? 'demoLoaded' : 'loaded'; render('workspace');
  } catch (cause) { fail(cause, token); }
}

async function search() {
  let records;
  try { records = parseRecords(); } catch (cause) { error = cause; notice = null; render('records'); return; }
  const token = begin('search');
  try {
    const data = await runWorker('search', token, {records});
    if (token !== generation) return;
    results = data.results; choices = new Map(); prepared = exported = null; busy = null; notice = 'searched'; render('review-panel');
  } catch (cause) { fail(cause, token); }
}

async function requestPreview() {
  let mapping;
  try { mapping = mappingFromChoices(); } catch (cause) { error = cause; notice = null; render(); return; }
  const token = begin('preview');
  try {
    const data = await runWorker('preview', token, {mapping});
    if (token !== generation) return;
    prepared = data.preview; exported = null; busy = null; notice = 'previewed'; render('preview-panel');
  } catch (cause) { fail(cause, token); }
}

async function requestExport() {
  if (!prepared || busy) return;
  const token = begin('export');
  try {
    const data = await runWorker('export', token, {mapping:prepared.mapping});
    if (token !== generation) return;
    exported = data; busy = null; notice = 'ready'; render('export-result');
  } catch (cause) { fail(cause, token); }
}

async function restoreMapping(file) {
  const token = begin('restore');
  const ownedModel = model, ownedBytes = sourceBytes;
  try {
    if (file.size > MAX_MAPPING) throw {code:'mapping-limit'};
    let buffer; try { buffer = await file.arrayBuffer(); } catch { throw {code:'file-read'}; }
    if (token !== generation || ownedModel !== model) return;
    if (buffer.byteLength > MAX_MAPPING) throw {code:'mapping-limit'};
    let raw; try { raw = new TextDecoder('utf-8', {fatal:true}).decode(buffer); } catch { throw {code:'encoding'}; }
    let mapping; try { mapping = parseJSON(raw); } catch { throw {code:'mapping-json'}; }
    if (mapping?.schema !== 'page-thread-mapping-v1' || mapping.inputSha256 !== ownedModel.input.sha256) throw {code:'stale-mapping'};
    if (!Array.isArray(mapping.boundaries) || !mapping.boundaries.length || mapping.boundaries.length > 500 || typeof mapping.paginationSource !== 'string' || typeof mapping.modifiedAfter !== 'string') throw {code:'mapping-invalid'};
    validateSource(mapping.paginationSource, mapping.modifiedAfter);
    const records = mapping.boundaries.map(row => {
      if (!row || typeof row.decisionId !== 'string' || typeof row.label !== 'string' || typeof row.phrase !== 'string' || typeof row.candidateId !== 'string') throw {code:'mapping-invalid'};
      return {decisionId:row.decisionId, label:row.label, phrase:row.phrase};
    });
    // Validate the entire saved mapping before replacing any committed UI state.
    const previewData = await runWorker('preview', token, {bytes:ownedBytes, name:ownedModel.input.name, mapping});
    if (token !== generation || ownedModel !== model) return;
    const searchData = await runWorker('search', token, {bytes:ownedBytes, name:ownedModel.input.name, records});
    if (token !== generation || ownedModel !== model) return;
    const restoredChoices = new Map(mapping.boundaries.map(row => [row.decisionId, row.candidateId]));
    if (searchData.results.some(row => !row.candidates.some(candidate => candidate.id === restoredChoices.get(row.decisionId)))) throw {code:'mapping-invalid'};
    paginationSource = mapping.paginationSource; modifiedAfter = mapping.modifiedAfter;
    recordText = records.map(row => `${row.label}\t${row.phrase}`).join('\n'); recordIds = records.map(row => row.decisionId); restoredRecords = records.map(row=>({...row})); restoredText = recordText;
    results = searchData.results; choices = restoredChoices; prepared = previewData.preview; exported = null; busy = null; error = null; notice = 'restored'; render('preview-panel');
  } catch (cause) { fail(cause, token); }
}

function download(content, name, type) {
  const url = URL.createObjectURL(new Blob([content], {type})); downloadURLs.add(url);
  const anchor = document.createElement('a'); anchor.href = url; anchor.download = name; anchor.hidden = true; document.body.append(anchor); anchor.click(); anchor.remove();
  setTimeout(() => { URL.revokeObjectURL(url); downloadURLs.delete(url); }, 30000);
}

window.addEventListener('pagehide', () => { generation++; stopWorker(); for (const url of downloadURLs) URL.revokeObjectURL(url); downloadURLs.clear(); });
render();
