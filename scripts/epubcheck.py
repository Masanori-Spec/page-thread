"""Run the official EPUBCheck 5.4.0 CLI on the exact original/output fixtures."""
from pathlib import Path
import subprocess,json,hashlib,os
root=Path(__file__).resolve().parents[1];out=root/'docs/epubcheck-evidence';out.mkdir(parents=True,exist_ok=True)
jar=Path(os.environ.get('EPUBCHECK_JAR','/tmp/pagethread-epubcheck/epubcheck-5.4.0/epubcheck.jar'))
if not jar.is_file():raise SystemExit('Official EPUBCheck 5.4.0 is unavailable; set EPUBCHECK_JAR. This stage was not run.')
results=[]
for name,part in [('source','tests/fixtures/field-notes.epub'),('output','tests/generated/paginated.epub')]:
 target=out/(name+'.json');run=subprocess.run(['java','-jar',str(jar),part,'-j',str(target)],cwd=root,capture_output=True,text=True,timeout=60)
 if not target.is_file():raise SystemExit('EPUBCheck produced no JSON: '+run.stderr+run.stdout)
 report=json.loads(target.read_text());checker=report['checker']
 if run.returncode or checker['checkerVersion']!='5.4.0' or any(checker[k] for k in ['nFatal','nError','nWarning']):raise SystemExit('EPUBCheck failed: '+run.stderr+run.stdout)
 results.append({'fixture':part,'sha256':hashlib.sha256((root/part).read_bytes()).hexdigest(),'report':name+'.json','reportSha256':hashlib.sha256(target.read_bytes()).hexdigest(),'checkerVersion':checker['checkerVersion'],'validatorPublicationVersion':report['publication']['ePubVersion'],'fatal':checker['nFatal'],'error':checker['nError'],'warning':checker['nWarning'],'usage':checker.get('nUsage',0)})
record={'status':'passed','officialRelease':'https://github.com/w3c/epubcheck/releases/tag/v5.4.0','releaseArchiveSha256':'33350c61038e71dfb3d45a76aed04bf5481e6d5500cb780f6e98db8bbd15a28c','jarSha256':hashlib.sha256(jar.read_bytes()).hexdigest(),'scope':'EPUBCheck 5.4.0 validates the current EPUB 3.4 Candidate Recommendation profile. This is not a claim of a final 3.4 standard, universal reader behavior, editorial boundary correctness or overall accessibility.','results':results}
(out/'results.json').write_text(json.dumps(record,indent=2)+'\n');print(json.dumps(record,indent=2))
