import {contentTypes} from './content-model.mjs';
import {renderContentChanges} from './content-changes.mjs';
const $=id=>document.getElementById(id),params=new URLSearchParams(location.search),kind=params.get('kind');
let snapshot,prepared,busy=false,resultId=params.get('result');
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
  $('reload').textContent='결과 다시 보기';resultId=id;history.replaceState(null,'','?'+new URLSearchParams({kind,result:id}));
}
async function load() {
  if(busy)return;busy=true;$('reload').disabled=true;$('prepare').disabled=true;$('error').hidden=true;
  try {
    if(!Object.hasOwn(contentTypes,kind))throw Error('관리할 자료를 선택해 다시 열어 주세요.');
    $('title').textContent=contentTypes[kind].label+' 변경 확인';document.title=$('title').textContent+' | EEAMS 관리';
    $('manager-return').href='/manage#'+kind;$('preview-return').href='content.html?kind='+kind;
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
load();
