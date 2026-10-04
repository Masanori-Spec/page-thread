import {LIMITS,fail} from './limits.mjs';
const validCode=c=>c===9||c===10||c===13||c>=32&&c<=0xD7FF||c>=0xE000&&c<=0xFFFD||c>=0x10000&&c<=0x10FFFF;
function decodeEntities(s){if(/&(?!amp;|lt;|gt;|quot;|apos;|#\d+;|#x[\da-fA-F]+;)/.test(s))fail('xml-entity');return s.replace(/&([^;]+);/g,(_,e)=>{const named={amp:'&',lt:'<',gt:'>',quot:'"',apos:"'"};if(named[e])return named[e];const c=e[1]==='x'?Number.parseInt(e.slice(2),16):Number(e.slice(1));if(!validCode(c))fail('xml-character');return String.fromCodePoint(c);});}
export function parseXML(source){
 if(typeof source!=='string'||source.length>LIMITS.xmlBytes||new TextEncoder().encode(source).length>LIMITS.xmlBytes)fail('xml-size');
 for(const c of source)if(!validCode(c.codePointAt(0)))fail('xml-character');
 let i=source.charCodeAt(0)===0xFEFF?1:0,root=null,stack=[],count=0,textCount=0,decl=false;
 const documentStart=i;const text=(s,start)=>{if(!stack.length){if(/[^ \t\r\n]/.test(s))fail('xml-outside');}else{if(s.includes(']]>'))fail('xml-text');if(++textCount>LIMITS.textNodes)fail('xml-text-limit');const node=stack.at(-1),decoded=decodeEntities(s.replace(/\r\n?/g,'\n'));node.text+=decoded;node.textSegments.push({text:decoded,start,end:start+s.length,cdata:false,textNodeIndex:node.textSegments.length,parent:node});}};
 while(i<source.length){if(source[i]!=='<'){const end=source.indexOf('<',i);text(source.slice(i,end<0?source.length:end),i);i=end<0?source.length:end;continue;}
  if(source.startsWith('<!--',i)){const e=source.indexOf('-->',i+4);if(e<0||(source.slice(i+4,e).includes('--')||source.slice(i+4,e).endsWith('-')))fail('xml-comment');i=e+3;continue;}
  if(source.startsWith('<![CDATA[',i)){const e=source.indexOf(']]>',i+9);if(e<0||!stack.length)fail('xml-cdata');if(++textCount>LIMITS.textNodes)fail('xml-text-limit');const node=stack.at(-1),decoded=source.slice(i+9,e).replace(/\r\n?/g,'\n');node.text+=decoded;node.textSegments.push({text:decoded,start:i+9,end:e,cdata:true,textNodeIndex:node.textSegments.length,parent:node});i=e+3;continue;}
  if(source.startsWith('<?',i)){const e=source.indexOf('?>',i+2);if(e<0)fail('xml-pi');const body=source.slice(i+2,e),target=body.match(/^([A-Za-z_][\w.:-]*)(?:[ \t\r\n]|$)/)?.[1];if(!target)fail('xml-pi');if(target.toLowerCase()==='xml'){if(i!==documentStart||decl||root||stack.length||!/^xml[ \t\r\n]+version[ \t\r\n]*=[ \t\r\n]*(['"])1\.0\1(?:[ \t\r\n]+encoding[ \t\r\n]*=[ \t\r\n]*(['"])[Uu][Tt][Ff]-8\2)?(?:[ \t\r\n]+standalone[ \t\r\n]*=[ \t\r\n]*(['"])(?:yes|no)\3)?[ \t\r\n]*$/.test(body))fail('xml-declaration');decl=true;}i=e+2;continue;}
  if(source.startsWith('<!DOCTYPE',i))fail('xml-doctype');
  if(source.startsWith('<!',i))fail('xml-declaration');
  if(source.startsWith('</',i)){const m=source.slice(i).match(/^<\/([A-Za-z_][\w.:-]*)[ \t\r\n]*>/);if(!m||!stack.length||stack.at(-1).name!==m[1])fail('xml-close');const n=stack.pop();n.closeStart=i;i+=m[0].length;n.end=i;continue;}
  const start=i,m=source.slice(i).match(/^<([A-Za-z_][\w.:-]*)/);if(!m)fail('xml-tag');const name=m[1];if(name.length>LIMITS.xmlNameChars)fail('xml-name-limit');i+=m[0].length;const attrs=Object.create(null),attrInfo=Object.create(null);let attributeCount=0;
  while(true){const space=source.slice(i).match(/^[ \t\r\n]*/)[0];i+=space.length;if(source.startsWith('/>',i)||source[i]==='>')break;if(!space)fail('xml-attribute');const a=source.slice(i).match(/^([A-Za-z_][\w.:-]*)[ \t\r\n]*=[ \t\r\n]*(?:"([^"<]*)"|'([^'<]*)')/);if(!a||Object.hasOwn(attrs,a[1]))fail('xml-attribute');if(++attributeCount>LIMITS.xmlAttributes)fail('xml-attribute-limit');if(a[1].length>LIMITS.xmlNameChars)fail('xml-name-limit');const quoteAt=a[0].search(/["']/),raw=a[2]??a[3];attrs[a[1]]=decodeEntities(raw.replace(/\r\n/g,'\n').replace(/[\r\n\t]/g,' '));attrInfo[a[1]]={valueStart:i+quoteAt+1,valueEnd:i+quoteAt+1+raw.length,quote:a[0][quoteAt]};i+=a[0].length;}
  const empty=source.startsWith('/>',i),closeStart=i;i+=empty?2:1;const n={name,attrs,attrInfo,text:'',textSegments:[],children:[],start,openEnd:i,closeStart:empty?closeStart:null,end:empty?i:null};if(++count>LIMITS.xmlNodes||stack.length>=LIMITS.xmlDepth)fail('xml-limit');if(stack.length)stack.at(-1).children.push(n);else{if(root)fail('xml-roots');root=n;}if(!empty)stack.push(n);
 }
 if(!root||stack.length)fail('xml-incomplete');return {root};
}
export const kids=(node,name)=>node.children.filter(x=>x.name===name);
export const child=(node,name)=>kids(node,name)[0];
export const value=(node,name)=>child(node,name)?.text.trim()??'';
export function namespaces(root){
 const XML='http://www.w3.org/XML/1998/namespace',XMLNS='http://www.w3.org/2000/xmlns/';let work=0;
 const split=name=>{const a=name.split(':');if(a.length>2||a.some(p=>!/^[A-Za-z_][\w.-]*$/.test(p)))fail('xml-namespace');return a.length===2?a:['',a[0]];};
 const visit=(node,parentNS,parentCount,parent,path)=>{
  // Contexts are shared unless this element changes a binding. New frames contain
  // only local declarations; their prototype chain ends at a null-prototype map.
  let ns=parentNS,count=parentCount,changed=false;
  for(const [k,v]of Object.entries(node.attrs)){
   const [p,l]=split(k);
   if(k==='xmlns'||p==='xmlns'){
    const prefix=k==='xmlns'?'':l;
    if(prefix==='xmlns'||v===XMLNS||(prefix==='xml'&&v!==XML)||(prefix!=='xml'&&v===XML)||(prefix&&v===''))fail('xml-namespace');
    if(v.length>LIMITS.namespaceUriChars)fail('xml-namespace-limit');
    if(!(prefix in ns)||ns[prefix]!==v){
     if(!(prefix in ns)&&++count>LIMITS.namespaceBindings)fail('xml-namespace-limit');
     if(!changed){ns=Object.create(parentNS);changed=true;}
     Object.defineProperty(ns,prefix,{value:v,enumerable:true,configurable:true,writable:false});
    }
   }
  }
  const [prefix,local]=split(node.name);if(prefix==='xmlns'||prefix&&!(prefix in ns))fail('xml-namespace');
  node.ns=ns[prefix]||'';node.local=local;node.nsMap=ns;node.parent=parent;node.path=path;node.expandedAttrs=Object.create(null);
  for(const [k,v]of Object.entries(node.attrs)){
   if(k==='xmlns'||k.startsWith('xmlns:'))continue;
   const [p,l]=split(k);if(p&&!(p in ns))fail('xml-namespace');const uri=p?ns[p]:'';
   work+=uri.length+l.length+2;if(work>LIMITS.namespaceWorkUnits)fail('xml-namespace-limit');const key=`{${uri}}${l}`;
   if(Object.hasOwn(node.expandedAttrs,key))fail('xml-attribute');node.expandedAttrs[key]={value:v,name:k,...node.attrInfo[k]};
  }
  if(changed)Object.freeze(ns);
  node.children.forEach((c,i)=>visit(c,ns,count,node,[...path,i]));
 };
 const base=Object.create(null);base.xml=XML;Object.freeze(base);visit(root,base,1,null,[]);root.namespaceWorkUnits=work;return root;
}
export const is=(n,uri,local)=>n?.ns===uri&&n?.local===local;
export const direct=(n,uri,local)=>n.children.filter(c=>is(c,uri,local));
export const attr=(n,uri,local)=>n.expandedAttrs[`{${uri}}${local}`]?.value??null;
export const walk=root=>{const out=[],stack=[root];while(stack.length){const n=stack.pop();out.push(n);for(let i=n.children.length-1;i>=0;i--)stack.push(n.children[i]);}return out;};
export function xml(source){return namespaces(parseXML(source).root);}
