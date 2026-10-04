import test from 'node:test';
import assert from 'node:assert/strict';
import {installWorkerGate} from './browser/worker-gate.mjs';
function fixture() {
  class NativeWorker {
    constructor(url) {this.url=url;this.listeners=[];this.stopped=false;}
    addEventListener(type,fn) {assert.equal(type,'message');this.listeners.push(fn);}
    emit(data) {const event={data};for(const fn of this.listeners)fn(event);return event;}
    terminate() {this.stopped=true;}
  }
  const surface={Worker:NativeWorker};installWorkerGate(surface);return {surface,NativeWorker};
}
test('browser response gate holds the real event until explicit release after termination',()=>{
  const {surface,NativeWorker}=fixture(),worker=new surface.Worker('blob:test'),calls=[];
  worker.onmessage=function(event){calls.push({event,self:this});};
  const event=worker.emit({id:7,type:'inspected'});
  assert.ok(worker instanceof NativeWorker);assert.deepEqual(calls,[]);
  assert.deepEqual(surface.__workerGate.status(),[{queued:1,terminated:false,received:1,released:0}]);
  worker.terminate();worker.onmessage=null;assert.equal(worker.stopped,true);assert.deepEqual(calls,[]);
  assert.equal(surface.__workerGate.release(0),1);assert.equal(calls[0].event,event);assert.equal(calls[0].self,worker);
  assert.deepEqual(surface.__workerGate.status(),[{queued:0,terminated:true,received:1,released:1}]);
  assert.throws(()=>surface.__workerGate.release(0),/No captured/);
});
test('browser response gate isolates worker generations and restores the native constructor',()=>{
  const {surface,NativeWorker}=fixture(),a=new surface.Worker('a'),b=new surface.Worker('b'),seen=[];
  a.onmessage=e=>seen.push(e.data);b.onmessage=e=>seen.push(e.data);
  a.emit('old');b.emit('new');a.terminate();surface.__workerGate.release(1);assert.deepEqual(seen,['new']);
  surface.__workerGate.release(0);assert.deepEqual(seen,['new','old']);
  surface.__workerGate.restore();assert.equal(surface.Worker,NativeWorker);assert.equal(surface.__workerGate,undefined);
});
