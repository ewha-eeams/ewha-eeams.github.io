import { cmsRoot } from './preview-model.mjs';
const $=id=>document.getElementById(id), kinds=['concerts','people','education','research'];
// This screen uses GET only. Save, rehearsal and publication remain explicit actions elsewhere.
$('edit').href=`${cmsRoot}/collection/concerts`; $('add').href=`${cmsRoot}/collection/concert_drafts/new`; $('upload').href=`${cmsRoot}/file/upload_guide`;
async function read(url){const response=await fetch(url,{cache:'no-store',credentials:'omit',signal:AbortSignal.timeout(20000)});if(!response.ok)throw Error('저장 상태를 확인하지 못했습니다. 잠시 후 다시 확인해 주세요.');return response.json();}
function row(kind,count,changes){$(`${kind}-count`).textContent=`${count}건`;const badge=$(`${kind}-changes`);badge.textContent=changes?`${changes}건 변경`:'변경 없음';badge.className=`status-pill ${changes?'has-changes':'is-current'}`;}
async function refresh(){
 $('reload').disabled=true;$('error').hidden=true;
 for(const kind of kinds){$(`${kind}-count`).textContent='확인 중';$(`${kind}-changes`).textContent='확인 중';$(`${kind}-changes`).className='status-pill';}
 for(const id of ['total-count','pending-count','connection-label'])$(id).textContent='확인 중';
 $('summary').textContent='저장된 내용을 확인하고 있습니다.';$('next-step').textContent='잠시만 기다려 주세요.';$('publication-note').textContent='게시 연결을 확인하고 있습니다.';
 const results=await Promise.allSettled(kinds.map(async kind=>{
  if(kind==='concerts'){
   const status=await read('/api/manage/status');
   if(status.app!=='eeams-cms-manager'||status.schema!==1||!Number.isSafeInteger(status.concerts)||!Number.isSafeInteger(status.changes))throw Error('관리 화면 연결을 확인해 주세요.');
   row(kind,status.concerts,status.changes);
   const available=status.publication?.concerts===true&&status.publication?.additionalContent===true;
   $('connection-label').textContent=available?'최종 확인 후 게시':status.mode==='publication-enabled'?'일부 연결':'미리보기 모드';
   $('publication-note').textContent=available?'최종 확인 후 게시할 수 있습니다. Save는 초안 저장이며, 사본 검증과 게시 확인을 거쳐야 공개됩니다.':status.mode==='publication-enabled'?'일부 자료의 게시 연결만 열려 있습니다. 각 변경 확인 화면에서 연결 상태를 확인하세요.':'현재는 미리보기·변경 확인 모드입니다. 실제 게시 연결은 닫혀 있습니다.';
   return{count:status.concerts,changes:status.changes,baseCommit:status.baseCommit,draftCommit:status.draftCommit};
  }
  const data=await read(`/api/content?kind=${kind}`);
  if(data.schema!==1||data.kind!==kind||!Array.isArray(data.rows)||!Array.isArray(data.changes))throw Error('자료 목록의 연결을 확인해 주세요.');
  row(kind,data.rows.length,data.changes.length);return{count:data.rows.length,changes:data.changes.length,baseCommit:data.baseCommit,draftCommit:data.commit};
 }));
 const failures=results.filter(result=>result.status==='rejected');
 const complete=results.every(result=>result.status==='fulfilled');
 const revisions=complete?new Set(results.map(result=>`${result.value.baseCommit}:${result.value.draftCommit}`)):null;
 if(complete&&revisions.size!==1){
  $('total-count').textContent='새로고침 필요';$('pending-count').textContent='새로고침 필요';
  $('summary').textContent='확인하는 동안 저장된 자료가 바뀌었습니다.';$('next-step').textContent='상태 새로고침을 눌러 같은 저장 기준으로 다시 확인하세요.';
 }else if(!failures.length){
  const values=results.map(result=>result.value),count=values.reduce((s,v)=>s+v.count,0),changes=values.reduce((s,v)=>s+v.changes,0);
  $('total-count').textContent=`${count}건`;$('pending-count').textContent=`${changes}건`;
  $('summary').textContent=`자료 4종 · 저장된 항목 ${count}건 · 공개 전 변경 ${changes}건`;
  $('next-step').textContent=changes?'변경이 있는 자료의 미리보기와 변경 확인을 진행하세요.':'저장된 초안과 공개 내용이 같습니다. 필요한 자료의 편집부터 시작하세요.';
 }else{
  kinds.forEach((kind,index)=>{if(results[index].status!=='rejected')return;$(`${kind}-count`).textContent='확인 필요';$(`${kind}-changes`).textContent='확인 필요';$(`${kind}-changes`).className='status-pill needs-attention';});
  $('total-count').textContent='확인 필요';$('pending-count').textContent='확인 필요';
  if(results[0].status==='rejected'){$('connection-label').textContent='확인 필요';$('publication-note').textContent='게시 연결을 확인하지 못했습니다. 변경 확인 화면에서 다시 확인해 주세요.';}
  $('summary').textContent='일부 자료의 최신 상태를 확인하지 못했습니다.';$('next-step').textContent='확인되지 않은 자료는 0건으로 표시하지 않습니다. 편집 화면과 안내는 계속 열 수 있습니다.';
  $('error').textContent=failures[0].reason.message;$('error').hidden=false;
 }
 $('reload').disabled=false;
}
$('reload').addEventListener('click',refresh);refresh();
