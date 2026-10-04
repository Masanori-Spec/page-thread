// Test-only response gate. No timers: real worker work finishes, but the app's
// callback is held until the test explicitly delivers it, even after terminate.
// This exercises the app's generation guard instead of relying only on the
// browser dropping messages from a terminated worker.
export function installWorkerGate(surface = window) {
  if (surface.__workerGate) throw new Error('Worker gate already installed');
  const NativeWorker = surface.Worker, records = [], byWorker = new WeakMap();
  class GatedWorker extends NativeWorker {
    constructor(...args) {
      super(...args);
      const record = {worker:this, handler:null, queued:[], terminated:false, received:0, released:0};
      records.push(record); byWorker.set(this, record);
      this.addEventListener('message', event => {record.queued.push({event,handler:record.handler});record.received++;});
    }
    set onmessage(handler) {byWorker.get(this).handler = handler;}
    get onmessage() {return byWorker.get(this).handler;}
    terminate() {byWorker.get(this).terminated = true;super.terminate();}
  }
  surface.Worker = GatedWorker;
  surface.__workerGate = {
    status: () => records.map(r => ({queued:r.queued.length, terminated:r.terminated, received:r.received, released:r.released})),
    release(index) {
      const record = records[index];
      if (!record || !record.queued.length || record.queued.some(item=>typeof item.handler!=='function')) throw new Error('No captured worker response to release');
      const events = record.queued.splice(0);
      for (const {event,handler} of events) {record.released++;handler.call(record.worker, event);}
      return events.length;
    },
    restore() {surface.Worker = NativeWorker;delete surface.__workerGate;}
  };
}
