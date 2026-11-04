import {config} from './config.mjs';
const registry=[];
import {openQueue,createQueue,randomId} from './store.mjs';
import {isActive,deliver,browserTransport} from './transport.mjs';
async function start(){
 const privacy=navigator.globalPrivacyControl===true||navigator.doNotTrack==='1'||localStorage.getItem('eeams-interest-optout')==='1';
 if(!isActive(config,{origin:location.origin,privacy})||window.top!==window)return;
 const db=await openQueue(),queue=createQueue(db,{registry,startedAt:config.startedAt,maxEvents:config.maxPendingEvents}),owner=randomId(),transport=browserTransport(config.endpoint,document);
 let working=false,timer,closed=false;
 const flush=async()=>{if(working||closed)return;working=true;
  try{const batch=await queue.acquire(owner);if(batch){const result=await deliver(batch,transport);await queue.settle(owner,batch.batchId,result.confirmed);if(result.confirmed)schedule();}}
  catch{}finally{working=false;}
 };
 const schedule=()=>{clearTimeout(timer);timer=setTimeout(flush,8000);};
 const record=action=>queue.record(action).then(schedule).catch(()=>{});
 await record({kind:'visit'});
 const hide=()=>{if(document.visibilityState==='hidden'){clearTimeout(timer);void flush();}};
 const pagehide=()=>{clearTimeout(timer);void flush();};const online=()=>void flush();
 document.addEventListener('visibilitychange',hide);window.addEventListener('pagehide',pagehide);window.addEventListener('online',online);
 window.addEventListener('storage',event=>{if(event.key==='eeams-interest-optout'&&event.newValue==='1'){closed=true;clearTimeout(timer);db.close();}},{once:false});
 schedule();
}
// A telemetry or browser-storage failure must not interfere with site navigation.
void start().catch(()=>{});
