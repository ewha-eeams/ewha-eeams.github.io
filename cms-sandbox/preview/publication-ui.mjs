// Shared presentation/controller only. Preparation never calls a public apply endpoint.
export const byId=id=>document.getElementById(id);
export const element=(tag,text,className)=>{const node=document.createElement(tag);if(text!=null)node.textContent=text;if(className)node.className=className;return node;};
export async function request(path,data){
 const response=await fetch(path,{cache:'no-store',credentials:'omit',signal:AbortSignal.timeout(90000),...(data?{method:'POST',headers:{'Content-Type':'application/json','X-EEAMS-Review':'1'},body:JSON.stringify(data)}:{})});
 const value=await response.json();if(!response.ok)throw Object.assign(Error(value.message||'자료 연결을 확인해 주세요.'),{code:value.code});return value;
}
export function publicationControls({load,canPrepare,prepare,apply,status,showReady,showPublished,lockInputs=()=>{}}){
 const $=byId;let busy=false,candidate=null,finished=false,uncertain=false;
 let publicationId=new URLSearchParams(location.search).get('publication');uncertain=!!publicationId;
 function controls(){
  $('prepare').disabled=busy||uncertain||finished||!canPrepare();$('reload').disabled=busy||uncertain;
  $('confirm').disabled=busy||uncertain||!candidate;$('publish').disabled=busy||uncertain||!candidate||!$('confirm').checked;
  $('check-status').disabled=busy;lockInputs(busy||uncertain||finished);
 }
 function phase(value){$('progress').textContent=value;}
 function saveId(id){const url=new URL(location.href);id?url.searchParams.set('publication',id):url.searchParams.delete('publication');history.replaceState(null,'',url);}
 function clear(){candidate=null;$('prepare').hidden=false;$('prepared').hidden=true;$('confirm').checked=false;$('ready-details').open=false;}
 function error(e){
  $('error').textContent=['STALE_REVIEW','EXPIRED_REVIEW'].includes(e.code)?'저장된 내용이 달라졌거나 확인 시간이 지났습니다. 최신 내용을 다시 불러와 주세요.':e.message?.includes('5 MB')?e.message:uncertain?'연결이 끊겨 반영 결과를 확인해야 합니다. 아래 결과 확인을 이용해 주세요.':'반영 준비를 마치지 못했습니다. 안내를 확인한 뒤 최신 내용을 다시 불러와 주세요.';
  $('error-box').hidden=false;$('error-detail').textContent=e.message||'연결을 확인해 주세요.';
 }
 function update(){controls();}
 function invalidate(){if(busy||uncertain)return;clear();$('error-box').hidden=true;phase('');controls();}
 async function reload(){
  if(busy||uncertain)return;if(finished){publicationId=null;saveId(null);}busy=true;finished=false;$('editing-area').hidden=false;clear();$('published').hidden=true;$('error-box').hidden=true;controls();
  try{await load();}catch(e){error(e);}finally{busy=false;controls();}
 }
 async function publishResult(result){await showPublished(result);$('editing-area').hidden=true;candidate=null;finished=true;uncertain=false;$('prepared').hidden=true;$('recovery').hidden=true;$('published').hidden=false;phase('');}
 async function check(){
  if(busy||!publicationId)return;busy=true;controls();
  try{
   const result=await status(publicationId);
   if(result.status==='published'){await publishResult(result);$('error-box').hidden=true;}
   else if(result.status==='not-published'){
    uncertain=false;$('confirm').checked=false;$('recovery-message').textContent='아직 홈페이지에 반영되지 않았습니다. 내용을 다시 확인한 뒤 진행하세요.';
    if(!candidate){publicationId=null;saveId(null);await load();}
   }else{$('recovery-message').textContent='다른 저장이 있어 반영 결과를 확정하지 못했습니다. 기록을 다시 확인해 주세요.';}
  }catch(e){uncertain=true;error(e);$('recovery-message').textContent='결과를 확인하지 못했습니다. 새 반영을 반복하지 말고 잠시 후 다시 확인하세요.';}
  finally{busy=false;controls();}
 }
 $('reload').addEventListener('click',reload);
 $('prepare').addEventListener('click',async()=>{
  if(busy||uncertain||finished||!canPrepare())return;busy=true;clear();$('status').textContent='';$('error-box').hidden=true;$('recovery').hidden=true;controls();
  try{
   const ready=await prepare(phase);
   if(ready.candidate&&(ready.candidate.requiresConfirmation!==true||ready.candidate.productionPublished!==false||!ready.candidate.id||!ready.candidate.seal))throw Error('반영 대상 확인 정보가 올바르지 않습니다.');
   await showReady(ready);candidate=ready.candidate||null;$('confirm').checked=false;$('prepared').hidden=false;$('prepare').hidden=true;$('final-actions').hidden=!candidate;
   phase(candidate?'준비가 끝났습니다. 아래 대상을 확인하고 마지막 버튼을 눌러 주세요.':'확인을 마쳤습니다. 이 연결에서는 홈페이지에 반영할 수 없습니다.');
   $('prepared').scrollIntoView({behavior:'smooth',block:'start'});
  }catch(e){clear();phase('아직 홈페이지에 반영하지 않았습니다.');error(e);}
  finally{busy=false;controls();}
 });
 $('confirm').addEventListener('change',controls);
 $('publish').addEventListener('click',async()=>{
  if(busy||uncertain||!candidate||!$('confirm').checked)return;
  const requested=candidate;busy=true;publicationId=requested.id;saveId(publicationId);$('error-box').hidden=true;controls();phase('홈페이지에 반영하고 저장 상태를 확인하고 있습니다.');
  try{await publishResult(await apply(requested));$('published').scrollIntoView({behavior:'smooth',block:'start'});}
  catch(e){uncertain=true;error(e);$('recovery-message').textContent='반영 요청을 보냈습니다. 버튼을 다시 누르기 전에 결과부터 확인하세요.';$('recovery').hidden=false;}
  finally{busy=false;controls();}
 });
 $('check-status').addEventListener('click',check);
 return{update,invalidate,async start(){
  if(publicationId){$('recovery').hidden=false;$('recovery-message').textContent='이전에 요청한 반영 결과를 확인하고 있습니다.';await check();}
  else await reload();
 },isBusy:()=>busy};
}
