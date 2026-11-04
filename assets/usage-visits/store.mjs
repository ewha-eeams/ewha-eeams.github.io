import {advanceSession,validateEvent} from './model.mjs';
const ttl=72*3600000;
export const randomId=()=>Array.from(crypto.getRandomValues(new Uint8Array(16)),n=>n.toString(16).padStart(2,'0')).join('');
export function openQueue(factory=globalThis.indexedDB){
 return new Promise((resolve,reject)=>{
  const q=factory.open('eeams-interest-live-v1',1);
  q.onupgradeneeded=()=>{q.result.createObjectStore('state');q.result.createObjectStore('events',{keyPath:'eventId'});};
  q.onerror=()=>reject(Error('STORAGE_UNAVAILABLE'));q.onblocked=()=>reject(Error('STORAGE_BLOCKED'));q.onsuccess=()=>resolve(q.result);
 });
}
export function createQueue(db,{registry,startedAt,clock=Date.now,id=randomId,maxEvents=400}={}){
 const start=Date.parse(startedAt);if(!Number.isFinite(start)||!Number.isInteger(maxEvents)||maxEvents<2||maxEvents>400)throw Error('INVALID_QUEUE_CONFIG');
 const transact=(names,operation)=>new Promise((resolve,reject)=>{
  const tx=db.transaction(names,'readwrite');let result,error;
  tx.oncomplete=()=>resolve(result);tx.onerror=tx.onabort=()=>reject(error||tx.error||Error('QUEUE_TRANSACTION'));
  try{operation(tx,value=>{result=value;},e=>{error=e;tx.abort();});}catch(e){error=e;tx.abort();}
 });
 return{
  record(action){if(action?.kind!=='visit')return Promise.reject(Error('VISITS_ONLY'));return transact(['state','events'],(tx,done,fail)=>{
   const state=tx.objectStore('state'),events=tx.objectStore('events');let previous,rows,remaining=2;
   const ready=()=>{if(--remaining)return;try{
    for(const row of rows)if(row.kind!=='visit')events.delete(row.eventId);rows=rows.filter(row=>row.kind==='visit');
    const now=clock();if(now<start){done({recorded:false,reason:'BEFORE_START'});return;}
    const next=advanceSession(previous?.startedAt>=start?previous:null,now,id());
    if(next.session.startedAt<start){done({recorded:false,reason:'WRONG_START'});return;}
    const iso=n=>new Date(n).toISOString();
    const make=(kind,category,contentId)=>({version:1,eventId:id(),sessionId:next.session.id,sessionStartedAt:iso(next.session.startedAt),occurredAt:iso(now),kind,category,contentId});
    const candidates=[];if(next.isNew)candidates.push(make('visit',null,null));
    if(action.kind!=='visit')candidates.push(make(action.kind,action.category,action.contentId));
    candidates.forEach(event=>validateEvent(event,registry));
    if(rows.length+candidates.length>maxEvents){done({recorded:false,reason:'LOCAL_CAPACITY'});return;}
    state.put(next.session,'session');for(const event of candidates)events.add(event);
    done({recorded:candidates.length>0,events:candidates.length});
   }catch(e){fail(e);}};
   const a=state.get('session');a.onsuccess=()=>{previous=a.result;ready();};const b=events.getAll();b.onsuccess=()=>{rows=b.result;ready();};
  });},
  acquire(owner){return transact(['state','events'],(tx,done)=>{
   const state=tx.objectStore('state'),events=tx.objectStore('events');let active,rows,remaining=2;
   const ready=()=>{if(--remaining)return;const now=clock();
    if(active&&active.batch.events.some(event=>event.kind!=='visit')){state.delete('batch');active=null;}
    for(const event of rows)if(event.kind!=='visit')events.delete(event.eventId);rows=rows.filter(event=>event.kind==='visit');
    if(active&&active.owner!==owner&&active.until>now){done(null);return;}
    if(active&&now-Date.parse(active.batch.createdAt)>ttl){for(const e of active.batch.events)events.delete(e.eventId);state.delete('batch');active=null;}
    const live=rows.filter(e=>now-Date.parse(e.occurredAt)<=ttl).sort((a,b)=>a.occurredAt.localeCompare(b.occurredAt)||a.eventId.localeCompare(b.eventId));
    for(const e of rows)if(now-Date.parse(e.occurredAt)>ttl)events.delete(e.eventId);
    if(!active&&!live.length){done(null);return;}
    const batch=active?.batch||{version:1,siteId:'eeams-interest-live-v1',batchId:id(),createdAt:new Date(now).toISOString(),events:live.slice(0,20)};
    state.put({batch,owner,until:now+120000},'batch');done(batch);
   };
   const a=state.get('batch');a.onsuccess=()=>{active=a.result;ready();};const b=events.getAll();b.onsuccess=()=>{rows=b.result;ready();};
  });},
  settle(owner,batchId,confirmed){return transact(['state','events'],(tx,done)=>{
   const state=tx.objectStore('state'),q=state.get('batch');q.onsuccess=()=>{
    const current=q.result;if(current?.owner!==owner||current.batch.batchId!==batchId){done(false);return;}
    if(confirmed){for(const event of current.batch.events)tx.objectStore('events').delete(event.eventId);state.delete('batch');}
    else state.put({...current,until:0},'batch');done(true);
   };
  });},
  inspect(){return new Promise((resolve,reject)=>{const tx=db.transaction(['state','events'],'readonly');let events,batch;const a=tx.objectStore('events').getAll(),b=tx.objectStore('state').get('batch');a.onsuccess=()=>events=a.result;b.onsuccess=()=>batch=b.result;tx.oncomplete=()=>resolve({events,batch});tx.onabort=tx.onerror=()=>reject(Error('QUEUE_READ'));});}
 };
}
