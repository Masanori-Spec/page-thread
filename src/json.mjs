import {LIMITS,fail} from './limits.mjs';
// A bounded lexical preflight rejects duplicate decoded member names before
// native JSON parsing. JSON.parse alone would silently select the final value.
export function parseJSON(text){
 if(typeof text!=='string'||text.length>LIMITS.mappingBytes||new TextEncoder().encode(text).length>LIMITS.mappingBytes)fail('mapping-size');
 let i=0,tokens=0;const primitive=/(?:true|false|null|-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?)/y;const whitespace=()=>{while(/[ \t\r\n]/.test(text[i]??'!'))i++;};
 const string=()=>{const start=i;if(text[i++]!=='"')fail('mapping-json');while(i<text.length){const c=text[i++];if(c==='"'){try{return JSON.parse(text.slice(start,i));}catch{fail('mapping-json');}}if(c==='\\'){if(i>=text.length)fail('mapping-json');const escape=text[i++];if(escape==='u'){if(!/^[\da-fA-F]{4}$/.test(text.slice(i,i+4)))fail('mapping-json');i+=4;}else if(!'"\\/bfnrt'.includes(escape))fail('mapping-json');}else if(c.charCodeAt(0)<32)fail('mapping-json');}fail('mapping-json');};
 const value=depth=>{if(depth>LIMITS.jsonDepth||++tokens>LIMITS.jsonTokens)fail('mapping-json-limit');whitespace();const c=text[i];if(c==='"'){string();return;}if(c==='{'){i++;whitespace();if(text[i]==='}'){i++;return;}const keys=new Set();while(true){whitespace();const key=string();if(keys.has(key))fail('mapping-json-duplicate');keys.add(key);whitespace();if(text[i++]!==':')fail('mapping-json');value(depth+1);whitespace();if(text[i]==='}'){i++;return;}if(text[i++]!==',')fail('mapping-json');}}else if(c==='['){i++;whitespace();if(text[i]===']'){i++;return;}while(true){value(depth+1);whitespace();if(text[i]===']'){i++;return;}if(text[i++]!==',')fail('mapping-json');}}else{primitive.lastIndex=i;const match=primitive.exec(text);if(!match)fail('mapping-json');i+=match[0].length;}};
 value(0);whitespace();if(i!==text.length)fail('mapping-json');try{return JSON.parse(text);}catch{fail('mapping-json');}
}
