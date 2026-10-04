import {readdir,readFile} from 'node:fs/promises';import {execFileSync} from 'node:child_process';
for(const dir of ['src','scripts','tests','tests/browser'])for(const f of await readdir(dir))if(f.endsWith('.mjs'))execFileSync(process.execPath,['--check',`${dir}/${f}`],{stdio:'inherit'});
// Guard actual primitive-use syntax; explanatory UI copy may name storage APIs.
const forbidden=/\b(?:eval|fetch)\s*\(|\bnew\s+(?:Function|XMLHttpRequest)\s*\(|\b(?:localStorage|sessionStorage|indexedDB)\s*(?:\.|\[|=)/;
for(const f of await readdir('src'))if(f.endsWith('.mjs')&&!f.includes('demo-data')){const s=await readFile('src/'+f,'utf8');if(forbidden.test(s))throw Error('Forbidden runtime primitive: '+f);}
console.log('Syntax and runtime network/storage primitive guards passed');
