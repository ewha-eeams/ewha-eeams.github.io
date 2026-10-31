import { cmsRoot } from './preview-model.mjs';
import { contentTypes } from './content-model.mjs';
import { renderContentChanges } from './content-changes.mjs';
const $=id=>document.getElementById(id),params=new URLSearchParams(location.search);
let snapshot,loading=false;
if(Object.hasOwn(contentTypes,params.get('kind'))) $('kind').value=params.get('kind');
function frame() {
  const url=new URL('content-'+snapshot.kind+'.html',import.meta.url);
  url.search=new URLSearchParams({kind:snapshot.kind,snapshot:snapshot.commit});
  if(snapshot.kind==='research')url.hash='research';
  $('content-frame').src=url.href;$('content-frame').hidden=false; $('content-standalone').href=url.href; $('content-standalone').hidden=false; document.title=contentTypes[snapshot.kind].label+' 미리보기 | EEAMS 관리';
}
async function refresh() {
  if(loading)return;loading=true;const kind=$('kind').value;
  $('reload').disabled=true;$('kind').disabled=true;$('error').hidden=true;$('content-frame').hidden=true; $('content-standalone').hidden=true;
  $('status').textContent='저장된 자료를 확인하고 있습니다.';
  $('title').textContent=contentTypes[kind].label+' 미리보기';
  $('copy-review').href='content-review.html?kind='+kind; $('edit').href=cmsRoot+'/file/'+kind; $('edit').textContent=contentTypes[kind].label+' 편집 ↗'; document.querySelector('[data-manager-return]').href='/manage#'+kind;
  try {
    const response=await fetch('/api/content?'+new URLSearchParams({kind}),{cache:'no-store',credentials:'omit',signal:AbortSignal.timeout(30000)});
    const data=await response.json();if(!response.ok)throw Error(data.message||'저장된 자료를 읽지 못했습니다.');
    if(data.schema!==1||data.kind!==kind||!Array.isArray(data.rows)||!Array.isArray(data.changes)||!/^[0-9a-f]{40}$/.test(data.commit||''))throw Error('자료 형식을 확인해 주세요.');
    snapshot=data;localStorage.setItem('eeams-cms-content-v1:'+kind+':'+data.commit,JSON.stringify(data));
    $('status').textContent='저장된 '+contentTypes[kind].label+' '+data.rows.length+'개 항목 · 공개 전 변경 '+data.changes.length+'건';
    $('change-title').textContent='변경 내용 확인 · '+data.changes.length+'건';$('change-list').replaceChildren();
    renderContentChanges($('change-list'),data.changes);
    history.replaceState(null,'','?kind='+kind);frame();
  }catch(error){$('error').textContent=error.name==='TimeoutError'?'연결이 지연되고 있습니다. 잠시 후 다시 불러와 주세요.':error.message;$('error').hidden=false;$('status').textContent='최신 저장 상태를 확인하지 못했습니다.';}
  finally{loading=false;$('reload').disabled=false;$('kind').disabled=false;}
}
$('kind').addEventListener('change',refresh);$('reload').addEventListener('click',refresh);
for(const key of ['desktop','mobile'])$(key).addEventListener('click',()=>{document.body.classList.toggle('mobile-preview',key==='mobile');for(const id of ['desktop','mobile'])$(id).setAttribute('aria-pressed',String(id===key));});
refresh();
