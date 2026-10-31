import {contentTypes} from './content-model.mjs';
import {renderContentChanges} from './content-changes.mjs';
const $=id=>document.getElementById(id),params=new URLSearchParams(location.search),kind=params.get('kind');
let snapshot,prepared,busy=false,resultId=params.get('result'),capabilities,actualPrepared,actualId=params.get('publication');
async function request(path,data) {
  const response=await fetch(path,{cache:'no-store',credentials:'omit',signal:AbortSignal.timeout(90000),...(data?{method:'POST',headers:{'Content-Type':'application/json','X-EEAMS-Review':'1'},body:JSON.stringify(data)}:{})});
  const value=await response.json();if(!response.ok)throw Error(value.message||'자료 연결을 확인해 주세요.');return value;
}
function error(e){$('error').textContent=e.name==='TimeoutError'?'연결이 지연되고 있습니다. 검증 기록을 확인하거나 다시 불러와 주세요.':e.message;$('error').hidden=false;}
async function showResult(report,id) {
  if(report.copyOnly!==true||report.productionPublished!==false||report.kind!==kind||report.remainingChanges!==0)throw Error('사본 검증 결과를 확인해 주세요.');
  const data=await request('/api/content-copy/snapshot?'+new URLSearchParams({id}));
  if(data.copyId!==id||data.kind!==kind||data.commit!==report.cmsCommit)throw Error('사본 미리보기를 확인해 주세요.');
  localStorage.setItem('eeams-cms-content-v1:'+kind+':'+data.commit,JSON.stringify(data));
  const frame=new URL('content-'+kind+'.html',import.meta.url);frame.search=new URLSearchParams({kind,snapshot:data.commit,copy:id});if(kind==='research')frame.hash='research';
  $('content-frame').src=frame.href;$('standalone').href=frame.href;
  renderContentChanges($('change-list'),report.changes||[]);$('reviewed-changes').open=false;$('reviewed-title').textContent='확인한 변경 '+(report.changes?.length||0)+'건 보기';
  $('result-summary').replaceChildren();
  for(const text of [`사본에 반영된 ${contentTypes[kind].label} ${report.records}개 항목`,'반영한 자료의 남은 변경 0건',`다른 자료 보존: ${report.preservedKinds.map(k=>contentTypes[k].label).join(' · ')}`]){const li=document.createElement('li');li.textContent=text;$('result-summary').append(li);}
  $('report').href='/api/content-copy/report?'+new URLSearchParams({id});$('result').hidden=false;$('prepared').hidden=true;$('prepare').hidden=true;
  $('status').textContent='사본 검증 완료 · 실제 홈페이지와 CMS 입력 자료는 변경되지 않았습니다.';
  $('reload').textContent='결과 다시 보기';resultId=id;history.replaceState(null,'','?'+new URLSearchParams({kind,result:id,...(actualId?{publication:actualId}:{})}));
  $('actual-actions').hidden=!capabilities?.enabled;
  if(actualId && capabilities?.enabled){$('check-actual').hidden=false;await checkActual();}
}
async function load() {
  if(busy)return;busy=true;$('reload').disabled=true;$('prepare').disabled=true;$('error').hidden=true;
  try {
    if(!Object.hasOwn(contentTypes,kind))throw Error('관리할 자료를 선택해 다시 열어 주세요.');
    $('title').textContent=contentTypes[kind].label+' 변경 확인';document.title=$('title').textContent+' | EEAMS 관리';
    $('manager-return').href='/manage#'+kind;$('preview-return').href='content.html?kind='+kind;
    capabilities=await request('/api/content-publication/capabilities');
    $('scope-note').textContent=capabilities.enabled?'사본 검증은 별도 사본에서 진행합니다. 실제 공개 반영은 하단에서 따로 확인합니다.':'실제 홈페이지와 CMS 입력 자료에는 반영하지 않습니다. 다른 종류의 자료와 예약 기록은 그대로 유지합니다.';
    $('connection-state').textContent=capabilities.enabled?'공개 반영 연결이 열려 있습니다. 같은 내용의 사본 검증을 먼저 완료해 주세요.':'게시 연결 준비 완료 · 실제 공개 반영은 꺼져 있습니다. 수정할 자료를 정한 뒤 진행합니다.';
    if(resultId){await showResult(await request('/api/content-copy/report?'+new URLSearchParams({id:resultId})),resultId);return;}
    prepared=null;$('prepared').hidden=true;$('result').hidden=true;$('confirm').checked=false;$('apply').disabled=true;
    snapshot=await request('/api/content?'+new URLSearchParams({kind}));renderContentChanges($('change-list'),snapshot.changes);$('reviewed-changes').open=true;$('reviewed-title').textContent='변경 전후 '+snapshot.changes.length+'건';
    $('status').textContent=`${contentTypes[kind].label} ${snapshot.rows.length}개 항목 · 확인할 변경 ${snapshot.changes.length}건`;$('prepare').disabled=!snapshot.changes.length;
  }catch(e){error(e);}finally{busy=false;$('reload').disabled=false;}
}
$('reload').addEventListener('click',load);
$('prepare').addEventListener('click',async()=>{
  if(busy||!snapshot)return;busy=true;$('prepare').disabled=true;$('reload').disabled=true;$('error').hidden=true;
  try {
    prepared=await request('/api/content-copy/prepare',{kind,baseCommit:snapshot.baseCommit,draftCommit:snapshot.commit});
    $('scope').textContent=`${contentTypes[kind].label} ${prepared.records}개 항목의 목록만 사본에 반영합니다. 확인한 변경은 ${prepared.changes.length}건입니다.`;
    $('operations').replaceChildren();for(const op of prepared.operations){const li=document.createElement('li');li.textContent=op.path+(op.size?' · '+(op.size/1024/1024).toFixed(1)+' MB':'');$('operations').append(li);}
    $('new-addresses').replaceChildren();for(const entry of prepared.mapping.filter(m=>m.added)){const li=document.createElement('li');li.textContent='새 자료 주소: '+entry.label+' → '+entry.publicId;$('new-addresses').append(li);}
    $('confirm').checked=false;$('apply').disabled=true;$('progress').textContent='';$('prepared').hidden=false;
  }catch(e){error(e);}finally{busy=false;$('prepare').disabled=false;$('reload').disabled=false;}
});
$('confirm').addEventListener('change',()=>{$('apply').disabled=busy||!prepared||!$('confirm').checked;});
$('apply').addEventListener('click',async()=>{
  if(busy||!prepared||!$('confirm').checked)return;busy=true;$('apply').disabled=true;$('reload').disabled=true;$('prepare').disabled=true;$('error').hidden=true;$('progress').textContent='별도 사본에서 반영과 기준 갱신을 확인하고 있습니다.';
  try {const report=await request('/api/content-copy/apply',{id:prepared.id,digest:prepared.digest,confirmed:true});await showResult(report,prepared.id);}
  catch(e){error(e);$('progress').textContent='검증을 마치지 못했습니다. 위 안내를 확인해 주세요.';}
  finally{busy=false;$('reload').disabled=false;$('apply').disabled=!$('confirm').checked;$('prepare').disabled=false;}
});
for(const key of ['desktop','mobile'])$(key).addEventListener('click',()=>{document.body.classList.toggle('mobile-preview',key==='mobile');for(const id of ['desktop','mobile'])$(id).setAttribute('aria-pressed',String(id===key));});
async function checkActual() {
  if(!actualId)return;
  const status=await request('/api/content-publication/status?'+new URLSearchParams({id:actualId}));
  if(status.status==='published') {
    if(status.kind!==kind||status.productionPublished!==true||status.remainingChanges!==0)throw Error('게시 기록의 자료 종류나 기준 갱신을 확인해 주세요.');
    $('status').textContent='공개 반영 완료 · CMS 기준 갱신 완료';
    $('copy-result-note').textContent='아래 화면은 게시 전에 검증한 사본입니다. 실제 게시 상태는 하단에서 확인할 수 있습니다.';
    $('actual-status').textContent='공개 자료와 CMS 기준을 함께 갱신했습니다. 홈페이지 배포가 완료되면 공개 화면에서 확인할 수 있습니다.';
    $('prepare-actual').hidden=true;$('actual-candidate').hidden=true;$('check-actual').hidden=true;$('public-result').hidden=false;
    $('public-result').href=kind==='people'?'https://ewha-eeams.github.io/people.html':kind==='education'?'https://ewha-eeams.github.io/education.html':'https://ewha-eeams.github.io/#research';
    history.replaceState(null,'','?'+new URLSearchParams({kind,result:resultId,publication:actualId}));
  } else {
    $('actual-status').textContent=status.status==='not-published'?'아직 공개 반영되지 않았습니다.':'저장본이 달라졌습니다. 최신 내용을 다시 확인해 주세요.';
  }
  return status;
}
$('prepare-actual').addEventListener('click',async()=>{
  if(busy||!resultId||!capabilities?.enabled)return;busy=true;$('prepare-actual').disabled=true;$('error').hidden=true;
  try {
    actualPrepared=await request('/api/content-publication/prepare',{copyId:resultId});
    if(actualPrepared.kind!==kind||actualPrepared.requiresConfirmation!==true)throw Error('공개 반영할 자료를 다시 확인해 주세요.');
    actualId=actualPrepared.id;$('confirm-actual').checked=false;$('apply-actual').disabled=true;
    history.replaceState(null,'','?'+new URLSearchParams({kind,result:resultId,publication:actualId}));
    $('actual-scope').textContent=`${contentTypes[kind].label} ${actualPrepared.records}개 항목 중 검토한 변경 ${actualPrepared.changes.length}건을 공개하고, 이 자료의 CMS 기준을 함께 갱신합니다.`;
    $('actual-files').replaceChildren();
    for(const [label,files]of [['공개',actualPrepared.publicFiles],['CMS 기준 갱신',actualPrepared.cmsFiles]])for(const path of files){const li=document.createElement('li');li.textContent=label+': '+path;$('actual-files').append(li);}
    $('actual-candidate').hidden=false;$('check-actual').hidden=false;$('actual-status').textContent='공개 반영 후보를 확인했습니다. 아직 게시하지 않았습니다.';
  }catch(e){error(e);actualPrepared=null;$('actual-candidate').hidden=true;}
  finally{busy=false;$('prepare-actual').disabled=false;}
});
$('confirm-actual').addEventListener('change',()=>{$('apply-actual').disabled=busy||!actualPrepared||!$('confirm-actual').checked;});
$('apply-actual').addEventListener('click',async()=>{
  if(busy||!actualPrepared||!$('confirm-actual').checked)return;busy=true;$('apply-actual').disabled=true;$('prepare-actual').disabled=true;$('error').hidden=true;$('actual-status').textContent='공개 자료와 CMS 기준을 함께 반영하고 있습니다.';
  try {await request('/api/content-publication/apply',{id:actualPrepared.id,seal:actualPrepared.seal,confirmed:true});await checkActual();}
  catch(e){error(e);$('actual-status').textContent='게시 상태 확인으로 결과를 먼저 확인해 주세요.';}
  finally{busy=false;$('prepare-actual').disabled=false;}
});
$('check-actual').addEventListener('click',async()=>{if(busy)return;busy=true;$('check-actual').disabled=true;try{await checkActual();}catch(e){error(e);}finally{busy=false;$('check-actual').disabled=false;}});
load();
