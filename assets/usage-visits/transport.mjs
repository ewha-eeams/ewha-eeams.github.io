export function isActive(config,{origin,privacy,now=Date.now()}={}){
 if(config.enabled!==true||privacy||!config.allowedOrigins?.includes(origin)||config.siteId!=='eeams-interest-live-v1'||!Number.isFinite(Date.parse(config.startedAt))||now<Date.parse(config.startedAt))return false;
 try{const url=new URL(config.endpoint);return url.origin==='https://script.google.com'&&/^\/macros\/s\/[A-Za-z0-9_-]{20,}\/exec$/.test(url.pathname)&&!url.search&&!url.hash&&!url.username&&!url.password;}catch{return false;}
}
export async function deliver(batch,{post,receipt,wait=async()=>{},attempts=2}={}){
 if(!Number.isInteger(attempts)||attempts<1||attempts>2)throw Error('RETRY_LIMIT');
 for(let n=1;n<=attempts;n++){
  try{await post(JSON.stringify(batch));}catch{}
  let answer;try{answer=await receipt(batch);}catch{}
  if(answer?.version===1&&answer.batchId===batch.batchId&&answer.stored===true&&answer.mode==='live')return{confirmed:true,attempts:n};
  if(n<attempts)await wait(1500);
 }
 return{confirmed:false,attempts};
}
export function browserTransport(endpoint,document,fetcher=fetch){
 return{
  post:async body=>{
   const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),10000);
   try{return await fetcher(endpoint,{method:'POST',mode:'no-cors',credentials:'omit',referrerPolicy:'no-referrer',headers:{'Content-Type':'text/plain;charset=UTF-8'},body,keepalive:true,signal:controller.signal});}
   finally{clearTimeout(timer);}
  },
  receipt:batch=>new Promise((resolve,reject)=>{
   const callback='eeamsReceipt_'+batch.batchId,script=document.createElement('script'),url=new URL(endpoint),view=document.defaultView;
   url.searchParams.set('batchId',batch.batchId);url.searchParams.set('month',new Date(Date.parse(batch.createdAt)+9*3600000).toISOString().slice(0,7));url.searchParams.set('callback',callback);
   let done=false;const cleanup=()=>{clearTimeout(timer);delete view[callback];script.remove();};
   const finish=(error,value)=>{if(done)return;done=true;cleanup();error?reject(error):resolve(value);};
   const timer=setTimeout(()=>finish(Error('RECEIPT_TIMEOUT')),10000);view[callback]=value=>finish(null,value);script.onerror=()=>finish(Error('RECEIPT_BLOCKED'));script.referrerPolicy='no-referrer';script.src=url.href;document.head.append(script);
  }),wait:ms=>new Promise(resolve=>setTimeout(resolve,ms))
 };
}
