import {execFileSync} from 'node:child_process';import {readFile,writeFile,mkdir,copyFile} from 'node:fs/promises';
const out='../page-thread-output';await mkdir(out,{recursive:true});
const log=execFileSync('npm',['run','check'],{encoding:'utf8',maxBuffer:16*1024*1024});await writeFile(out+'/local-check.log',log);const count=Number(log.match(/^(?:ℹ |# )tests (\d+)/m)?.[1]);if(!count)throw Error('Node test count missing');
execFileSync(process.execPath,['scripts/check-validator-evidence.mjs'],{stdio:'inherit'});
for(const [src,dest]of [['tests/fixtures/field-notes.epub','field-notes-original.epub'],['tests/generated/paginated.epub','field-notes-paginated.epub'],['tests/generated/mapping.json','mapping.json'],['tests/generated/receipt.json','receipt.json'],['tests/generated/review.html','review.html']])await copyFile(src,out+'/'+dest);
execFileSync('python3',['-c',`from pathlib import Path
import hashlib,json,zipfile
root=Path('.');out=Path('../page-thread-output');files=[]
for p in sorted(root.rglob('*')):
 if not p.is_file() or any(x in {'.git','node_modules','dist','__pycache__','artifacts','generated'} for x in p.parts) or p.suffix=='.pyc':continue
 files.append(p)
with zipfile.ZipFile(out/'page-thread-source.zip','w',zipfile.ZIP_DEFLATED,compresslevel=9) as z:
 for p in files:
  i=zipfile.ZipInfo('page-thread/'+p.as_posix(),(2026,10,4,0,0,0));i.compress_type=zipfile.ZIP_DEFLATED;i.external_attr=0o100644<<16;z.writestr(i,p.read_bytes())
a=out/'page-thread-source.zip';manifest={'schema':'page-thread-source-manifest-v1','version':'0.1.0','status':'frozen-after-independent-review','files':[{'path':p.as_posix(),'bytes':p.stat().st_size,'sha256':hashlib.sha256(p.read_bytes()).hexdigest()} for p in files],'verification':{'nodeTests':${count},'independentOracle':'8 literal intended boundaries, original XML restored, 5 changed XML parts, 4 untouched members, exact mapping hash','mutationOracle':'33 refreshed-hash output rejections, 11 invalid-input vocabulary cases, valid dcterms-alias and harmless XML reserialization positives','independentReview':'14 reviewer tests including 24 Python restoration cases, 500-boundary fixture and real worker-thread parity; see docs/INDEPENDENT_REVIEW.md','officialEPUBCheck':'5.4.0 passed exact source/output with no errors or warnings; reports and input hashes rechecked, see docs/epubcheck-evidence/results.json','validatorProfile':'Current EPUB 3.4 Candidate Recommendation; not a final-standard conformance claim','browser':'14 sandbox-enabled scenarios authored, unrun','hostedCI':'six jobs authored, unrun','readerAndVisual':'unrun','editorialBoundaryCorrectness':'unverified; editor supplied','publication':'not performed'},'archive':{'name':a.name,'bytes':a.stat().st_size,'sha256':hashlib.sha256(a.read_bytes()).hexdigest()}}
(out/'source-manifest.json').write_text(json.dumps(manifest,indent=2)+'\\n')
with zipfile.ZipFile(a) as z:
 assert z.testzip() is None
 for f in manifest['files']:assert hashlib.sha256(z.read('page-thread/'+f['path'])).hexdigest()==f['sha256']
(out/'archive-verification.json').write_text(json.dumps({'status':'passed','files':len(files),'archiveSha256':manifest['archive']['sha256']},indent=2)+'\\n')
print(json.dumps({'files':len(files),'archive':manifest['archive']},indent=2))
`],{stdio:'inherit'});
