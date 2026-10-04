"""Create an original, deterministic EPUB; no external/customer book is used."""
from pathlib import Path
import base64,hashlib,json,zipfile
root=Path(__file__).resolve().parents[1];out=root/'tests/fixtures';out.mkdir(parents=True,exist_ok=True)
X='http://www.w3.org/1999/xhtml';E='http://www.idpf.org/2007/ops'
def document(title,body,lang='en'):
 return f'''<?xml version="1.0" encoding="UTF-8"?>
<html xmlns="{X}" xmlns:epub="{E}" xml:lang="{lang}" lang="{lang}"><head><title>{title}</title><link rel="stylesheet" type="text/css" href="../styles/book.css"/></head><body>{body}</body></html>'''
parts={
'mimetype':'application/epub+zip',
'META-INF/container.xml':'''<?xml version="1.0" encoding="UTF-8"?><container xmlns="urn:oasis:names:tc:opendocument:xmlns:container" version="1.0"><rootfiles><rootfile full-path="EPUB/package.opf" media-type="application/oebps-package+xml"/></rootfiles></container>''',
'EPUB/package.opf':'''<?xml version="1.0" encoding="UTF-8"?><package xmlns="http://www.idpf.org/2007/opf" xmlns:dc="http://purl.org/dc/elements/1.1/" version="3.0" unique-identifier="book-id" xml:lang="en"><metadata><dc:identifier id="book-id">urn:uuid:8e2ed33d-8fc9-4b68-a1bf-b1a77e246890</dc:identifier><dc:title>Field Notes Along the River</dc:title><dc:language>en</dc:language><dc:creator>PageThread synthetic fixture</dc:creator><meta property="dcterms:modified">2026-01-01T00:00:00Z</meta></metadata><manifest><item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/><item id="river" href="text/aa-river.xhtml" media-type="application/xhtml+xml"/><item id="intro" href="text/zz-preface.xhtml" media-type="application/xhtml+xml"/><item id="trail" href="text/mm-trail.xhtml" media-type="application/xhtml+xml"/><item id="style" href="styles/book.css" media-type="text/css"/><item id="map" href="images/river.svg" media-type="image/svg+xml"/></manifest><spine><itemref idref="intro"/><itemref idref="trail"/><itemref idref="river"/></spine></package>''',
'EPUB/nav.xhtml':f'''<?xml version="1.0" encoding="UTF-8"?><html xmlns="{X}" xmlns:epub="{E}" xml:lang="en" lang="en"><head><title>Contents</title></head><body><nav epub:type="toc" id="toc"><h1>Contents</h1><ol><li><a href="text/zz-preface.xhtml">Before the walk</a></li><li><a href="text/mm-trail.xhtml">The woodland trail</a></li><li><a href="text/aa-river.xhtml">By the river</a></li></ol></nav><!-- Keep the original navigation exactly. --></body></html>''',
'EPUB/text/zz-preface.xhtml':document('Before the walk','''<h1>Before the walk</h1><p>Field notes begin with looking closely, then writing a little.</p><p>A shared beginning can belong to more than one chapter.</p><p>Reading ruby <ruby>川<rt>かわ</rt></ruby> is outside the insertion profile.</p><p hidden="hidden">Hidden source text is not an eligible boundary.</p><p><![CDATA[Literal <angle> and & text stays exactly in its CDATA section.]]></p><figure><img src="../images/river.svg" alt="A simple river line and two paths"/><figcaption>An original diagram for this synthetic book.</figcaption></figure>'''),
'EPUB/text/mm-trail.xhtml':document('The woodland trail','''<h1>The woodland trail</h1><p>The trail opened with <em>quiet attention</em> and a deliberate first step.</p><p>A shared beginning leads east. A shared beginning leads west.</p><p>An ampersand &amp; a <strong>bold step</strong> continue the story without changing its words.</p><p>Emoji 🧭 and café meet at the old gate.</p><p>Nonbreaking space remains distinct; ideographic　space remains distinct.</p>'''),
'EPUB/text/aa-river.xhtml':document('By the river','''<h1>By the river / 川のそば</h1><p>川沿いを歩く。風が水面をゆっくり渡っていく。</p><p>A shared beginning returns in the last chapter.</p><p>Closing <!--retain-comment-->words stay in place<?editor retain-pi?> while the page reference is added.</p>'''),
'EPUB/styles/book.css':'body{font-family:serif;line-height:1.6;margin:1.5em;color:#173b39}h1{font-family:sans-serif;font-weight:600}figure{margin:2em 0}img{max-width:100%}em{font-style:italic}strong{font-weight:bold}\n',
'EPUB/images/river.svg':'''<svg xmlns="http://www.w3.org/2000/svg" width="600" height="180" viewBox="0 0 600 180"><title>River and paths</title><rect width="600" height="180" fill="#f7f0dc"/><path d="M0 130 Q150 20 300 100 T600 60" fill="none" stroke="#447f78" stroke-width="16"/><path d="M0 30 Q180 120 300 30 T600 140" fill="none" stroke="#b97549" stroke-width="3"/></svg>'''
}
with zipfile.ZipFile(out/'field-notes.epub','w') as z:
 for name,body in parts.items():
  info=zipfile.ZipInfo(name,(2026,1,1,0,0,0));info.compress_type=zipfile.ZIP_STORED if name=='mimetype' else zipfile.ZIP_DEFLATED;info.external_attr=0o100644<<16;z.writestr(info,body.encode())
records=[
 {'decisionId':'prelim','label':'iv','phrase':'Field notes begin'},
 {'decisionId':'trail','label':'1','phrase':'quiet attention and a deliberate'},
 {'decisionId':'repeat','label':'2','phrase':'A shared beginning'},
 {'decisionId':'entity','label':'3','phrase':'ampersand & a bold step'},
 {'decisionId':'unicode','label':'4','phrase':'and café'},
 {'decisionId':'spaces','label':'5','phrase':'Nonbreaking space'},
 {'decisionId':'japanese','label':'6','phrase':'風が水面をゆっくり'},
 {'decisionId':'closing','label':'A-1','phrase':'words stay in place'}
]
# Literal editor decisions authored from the source above, not production search.
locations=[('EPUB/text/zz-preface.xhtml','intro',[1,1],0,0,1,1),('EPUB/text/mm-trail.xhtml','trail',[1,1,0],0,0,1,1),('EPUB/text/mm-trail.xhtml','trail',[1,2],0,len('A shared beginning leads east. '),4,3),('EPUB/text/mm-trail.xhtml','trail',[1,3],0,3,1,1),('EPUB/text/mm-trail.xhtml','trail',[1,4],0,8,1,1),('EPUB/text/mm-trail.xhtml','trail',[1,5],0,0,1,1),('EPUB/text/aa-river.xhtml','river',[1,1],0,len('川沿いを歩く。'),1,1),('EPUB/text/aa-river.xhtml','river',[1,3],1,0,1,1)]
source='PageThread Field Notes, synthetic editorial edition, 2026; page labels supplied for demonstration'
expected=[];choices={}
for i,(record,location) in enumerate(zip(records,locations),1):
 part,idref,path,index,offset,count,occurrence=location;marker=f'pt-page-{i:04d}';expected.append({**record,'sourcePart':part,'spineIdref':idref,'sourcePath':path,'textNodeIndex':index,'offset':offset,'markerId':marker,'candidateCount':count,'selectedOccurrence':occurrence})
 choices[record['decisionId']]=part+'#'+'.'.join(map(str,path))+f'/{index}:{offset}'
(out/'records.json').write_text(json.dumps(records,ensure_ascii=False,indent=2)+'\n')
(out/'expected-selection.json').write_text(json.dumps({'paginationSource':source,'modifiedAfter':'2026-10-04T00:00:00Z','boundaries':expected},ensure_ascii=False,indent=2)+'\n')
raw=(out/'field-notes.epub').read_bytes();demo={'DEMO_BASE64':base64.b64encode(raw).decode(),'DEMO_SHA256':hashlib.sha256(raw).hexdigest(),'DEMO_RECORDS':records,'DEMO_CHOICES':choices,'DEMO_SOURCE':source}
(root/'src/demo-data.mjs').write_text('// Original synthetic EPUB, generated by scripts/prepare-fixture.py.\n'+'\n'.join('export const '+k+'='+json.dumps(v,ensure_ascii=False,separators=(',',':'))+';' for k,v in demo.items())+'\n')
print(json.dumps({'epubBytes':len(raw),'sha256':demo['DEMO_SHA256'],'records':len(records)}))
