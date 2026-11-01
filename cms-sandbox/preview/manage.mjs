import { cmsRoot } from './preview-model.mjs';
const $=id=>document.getElementById(id), kinds=['concerts','people','education','research'];
// GET only: returning from the editor refreshes state, never saves or publishes.
$('edit').href=`${cmsRoot}/collection/concerts`; $('add').href=`${cmsRoot}/collection/concert_drafts/new`; $('upload').href=`${cmsRoot}/file/upload_guide`;
let inFlight, timer;
async function read(url){const response=await fetch(url,{cache:'no-store',credentials:'omit',signal:AbortSignal.timeout(20000)});if(!response.ok)throw Error('저장 상태를 확인하지 못했습니다.');return response.json();}
function row(kind,changes,message){const badge=$(`${kind}-changes`);badge.hidden=!message&&!changes;badge.textContent=message||(changes?'홈페이지 반영 전':'');badge.className=`status-pill ${message?'needs-attention':'has-changes'}`;}
function refresh(){
 if(inFlight)return inFlight;
 inFlight=(async()=>{
  $('reload').disabled=true;$('error-panel').hidden=true;$('connection-note').hidden=true;$('loading').hidden=false;
  kinds.forEach(kind=>row(kind,0));
  const results=await Promise.allSettled(kinds.map(async kind=>{
   if(kind==='concerts'){
    const data=await read('/api/manage/status');
    if(data.app!=='eeams-cms-manager'||data.schema!==1||!Number.isSafeInteger(data.changes)||data.changes<0)throw Error('관리 화면 연결을 확인해 주세요.');
    const available=data.publication?.concerts===true&&data.publication?.additionalContent===true;
    if(!available){$('connection-note').textContent='일부 자료의 홈페이지 반영 기능이 닫혀 있습니다. 반영 화면에서 연결을 확인하세요.';$('connection-note').hidden=false;}
    row(kind,data.changes);return{baseCommit:data.baseCommit,draftCommit:data.draftCommit};
   }
   const data=await read(`/api/content?kind=${kind}`);
   if(data.schema!==1||data.kind!==kind||!Array.isArray(data.rows)||!Array.isArray(data.changes))throw Error('자료 목록의 연결을 확인해 주세요.');
   row(kind,data.changes.length);return{baseCommit:data.baseCommit,draftCommit:data.commit};
  }));
  const failures=results.filter(result=>result.status==='rejected');
  if(failures.length){
   kinds.forEach((kind,i)=>{if(results[i].status==='rejected')row(kind,0,'상태 확인 필요');});
   if(results[0].status==='rejected'){$('connection-note').textContent='홈페이지 반영 연결을 확인하지 못했습니다.';$('connection-note').hidden=false;}
   $('error').textContent='일부 자료의 최신 상태를 확인하지 못했습니다. 잠시 후 다시 확인해 주세요.';$('error-panel').hidden=false;
  }else if(new Set(results.map(r=>`${r.value.baseCommit}:${r.value.draftCommit}`)).size!==1){
   kinds.forEach(kind=>row(kind,0,'다시 확인 필요'));
   $('error').textContent='확인하는 동안 자료가 저장되었습니다. 최신 상태를 다시 확인해 주세요.';$('error-panel').hidden=false;
  }
  $('loading').hidden=true;$('reload').disabled=false;
 })().finally(()=>{inFlight=null;});
 return inFlight;
}
function refreshOnReturn(){if(document.visibilityState==='hidden')return;clearTimeout(timer);timer=setTimeout(refresh,150);}
$('reload').addEventListener('click',refresh);
window.addEventListener('focus',refreshOnReturn);window.addEventListener('pageshow',refreshOnReturn);document.addEventListener('visibilitychange',refreshOnReturn);
refresh();
