import {contentTypes} from './content-model.mjs';
import {renderContentChanges} from './content-changes.mjs';
import {byId as $,element as el,request,publicationControls} from './publication-ui.mjs';
const params=new URLSearchParams(location.search),kind=params.get('kind');let snapshot=null,capabilities=null;
if(Object.hasOwn(contentTypes,kind)){ $('title').textContent=contentTypes[kind].label+' 홈페이지에 반영';document.title=$('title').textContent+' | EEAMS 관리';$('manager-return').href='/manage#'+kind; }
const flow=publicationControls({
 async load(){
  snapshot=null;capabilities=null;if(!Object.hasOwn(contentTypes,kind))throw Error('자료 관리에서 종류를 선택해 다시 열어 주세요.');
  const label=contentTypes[kind].label;$('title').textContent=label+' 홈페이지에 반영';document.title=$('title').textContent+' | EEAMS 관리';$('manager-return').href='/manage#'+kind;$('status').textContent='저장된 내용을 확인하고 있습니다.';
  capabilities=await request('/api/content-publication/capabilities');
  const data=await request('/api/content?'+new URLSearchParams({kind}));if(data.kind!==kind||!Array.isArray(data.changes)||!Array.isArray(data.rows))throw Error('저장된 자료의 종류를 확인해 주세요.');snapshot=data;
  renderContentChanges($('change-list'),snapshot.changes);$('reviewed-title').textContent=`수정 내용 ${snapshot.changes.length}건`;$('reviewed-changes').open=!!snapshot.changes.length;
  $('scope-note').textContent=capabilities.enabled?`${label}에 저장된 수정 전체가 함께 반영됩니다. 다른 종류의 자료는 유지합니다.`:'이 연결은 내용 확인만 가능합니다. 홈페이지 반영 기능은 닫혀 있습니다.';
  $('status').textContent=snapshot.changes.length?'내용을 확인한 뒤 반영 준비를 눌러 주세요.':'홈페이지에 반영할 수정 내용이 없습니다.';
 },
 canPrepare:()=>!!snapshot?.changes.length,
 async prepare(phase){
  phase('저장한 내용과 첨부 자료를 확인하고 있습니다.');
  const prepared=await request('/api/content-copy/prepare',{kind,baseCommit:snapshot.baseCommit,draftCommit:snapshot.commit});
  phase('홈페이지 표시와 반영 후 저장 연결을 확인하고 있습니다.');
  const report=await request('/api/content-copy/apply',{id:prepared.id,digest:prepared.digest,confirmed:true});
  if(report.copyOnly!==true||report.productionPublished!==false||report.kind!==kind||report.remainingChanges!==0)throw Error('자동 확인 결과가 반영 대상과 다릅니다.');
  // Pin optional preview to the exact checked data. No frame or additional action is required.
  const data=await request('/api/content-copy/snapshot?'+new URLSearchParams({id:prepared.id}));
  if(data.copyId!==prepared.id||data.kind!==kind||data.commit!==report.cmsCommit)throw Error('확인한 화면 자료가 달라졌습니다.');
  localStorage.setItem('eeams-cms-content-v1:'+kind+':'+data.commit,JSON.stringify(data));
  const preview=new URL('content-'+kind+'.html',import.meta.url);preview.search=new URLSearchParams({kind,snapshot:data.commit,copy:prepared.id});if(kind==='research')preview.hash='research';
  let candidate=null;if(capabilities.enabled){phase('마지막으로 반영 대상을 확인하고 있습니다.');candidate=await request('/api/content-publication/prepare',{copyId:prepared.id});if(candidate.id!==prepared.id||candidate.kind!==kind||JSON.stringify(candidate.changes)!==JSON.stringify(report.changes))throw Error('최종 반영 대상이 달라졌습니다.');}
  return{candidate,prepared,report,preview:preview.href,reportUrl:'/api/content-copy/report?'+new URLSearchParams({id:prepared.id})};
 },
 showReady({prepared,report,preview,reportUrl}){
  $('reviewed-changes').open=false;
  $('ready-scope').textContent=`${contentTypes[kind].label}의 수정 ${report.changes.length}건 전체를 반영합니다. 다른 종류의 자료는 유지합니다.`;$('ready-items').replaceChildren();
  for(const change of report.changes)$('ready-items').append(el('li',`${({added:'추가',removed:'제외',changed:'수정'})[change.status]||'수정'} · ${change.label}`));
  $('ready-files').replaceChildren();for(const item of prepared.mapping.filter(m=>m.added))$('ready-files').append(el('li','새 자료: '+item.label));$('ready-preview').href=preview;$('ready-report').href=reportUrl;
 },
 apply:candidate=>request('/api/content-publication/apply',{id:candidate.id,seal:candidate.seal,confirmed:true}),
 status:id=>request('/api/content-publication/status?'+new URLSearchParams({id})),
 showPublished(result){
  if(result.status!=='published'||result.kind!==kind||result.productionPublished!==true||result.remainingChanges!==0)throw Error('반영 완료 기록의 종류나 저장 상태를 확인해 주세요.');
  $('published-summary').textContent=`${contentTypes[kind].label}의 수정 내용을 반영했고 편집 자료의 저장 상태도 맞췄습니다.`;
  $('published-link').href=kind==='people'?'https://ewha-eeams.github.io/people.html':kind==='education'?'https://ewha-eeams.github.io/education.html':'https://ewha-eeams.github.io/#research';
 }
});
await flow.start();
