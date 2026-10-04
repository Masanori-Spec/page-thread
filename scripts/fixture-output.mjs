import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {inspectBook,findCandidates,applyMapping,mappingText} from '../src/core.mjs';
import {reportHTML} from '../src/report.mjs';
import {DEMO_RECORDS,DEMO_CHOICES,DEMO_SOURCE} from '../src/demo-data.mjs';
const bytes=await readFile('tests/fixtures/field-notes.epub'),ctx=await inspectBook(bytes,'field-notes.epub');
const mapping={schema:'page-thread-mapping-v1',inputSha256:ctx.model.input.sha256,paginationSource:DEMO_SOURCE,modifiedAfter:'2026-10-04T00:00:00Z',whitespace:'xml-s-collapse-v1',boundaries:DEMO_RECORDS.map(r=>({...r,candidateId:DEMO_CHOICES[r.decisionId]}))};
const result=await applyMapping(ctx,mapping);await mkdir('tests/generated',{recursive:true});await writeFile('tests/generated/paginated.epub',result.output);await writeFile('tests/generated/mapping.json',mappingText(result.mapping));await writeFile('tests/generated/receipt.json',JSON.stringify(result.receipt,null,2)+'\n');await writeFile('tests/generated/review.html',reportHTML(result.receipt));
console.log(JSON.stringify({input:ctx.model.input,counts:ctx.model.stats,candidateCounts:findCandidates(ctx,DEMO_RECORDS).map(r=>r.candidateCount),boundaries:result.receipt.boundaries.length,changedParts:result.receipt.changedParts.map(p=>p.part),outputSha256:result.receipt.outputSha256},null,2));
