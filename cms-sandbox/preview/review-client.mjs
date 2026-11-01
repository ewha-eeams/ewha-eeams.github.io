import {byId as $,element as el,request,publicationControls} from './publication-ui.mjs';
let review=null,valid=false;const selected=new Set();
const names={poster:'포스터',pdf:'프로그램북 PDF',photos:'공연 사진'},actionNames={add:'추가',replace:'교체',delete:'제외'};
function column(value,label){const node=el('div');node.append(el('small',label,'caption'),el('p',value||'—'));return node;}
function works(works,label){const node=el('div');node.append(el('strong',label,'caption'));const list=el('ol');for(const work of works)list.append(el('li',[work.composer,work.composer_en,work.work_title,work.work_title_en,work.format,work.media_url].filter(Boolean).join('\n')));node.append(list);return node;}
function render(){
 $('entries').replaceChildren();const changed=review.entries.filter(e=>e.status!=='unchanged');$('selection').hidden=!changed.length;
 if(!changed.length){const empty=el('div',null,'empty');empty.append(el('strong','홈페이지에 반영할 수정 내용이 없습니다.'),el('p','자료를 편집하고 Save로 저장한 뒤 다시 열어 주세요.'));$('entries').append(empty);}
 for(const entry of changed){
  const card=el('article',null,'entry'),heading=el('div',null,'entry-heading'),label=el('label'),input=el('input');input.type='checkbox';input.value=entry.cms_id;
  const text=el('div');text.append(el('strong',entry.title),el('small',`${entry.date} · ${entry.status==='new'?'새 공연':'기존 공연 수정'}`));label.append(input,text);
  const edit=el('a','수정하기 ↗');edit.href=entry.editUrl;edit.target='_blank';edit.rel='noopener noreferrer';heading.append(label,edit);card.append(heading);
  const details=el('details');details.append(el('summary','수정 내용 보기'));const body=el('div',null,'changes');
  for(const change of entry.changes){const row=el('div',null,'field-change');row.append(el('strong',change.label),column(change.before,'현재 홈페이지'),column(change.after,'저장한 내용'));body.append(row);}
  if(entry.worksChanged){const comparison=el('div',null,'work-comparison');comparison.append(works(entry.beforeWorks,`현재 홈페이지 · ${entry.beforeWorks.length}곡`),works(entry.afterWorks,`저장한 내용 · ${entry.afterWorks.length}곡`));body.append(comparison);}
  for(const kind of entry.mediaChanges){const before=kind==='photos'?entry.beforeMedia.photos.map(p=>p.path.split('/').pop()).join(', '):entry.beforeMedia[kind]?.path.split('/').pop(),after=kind==='photos'?entry.afterMedia.photos.map(p=>p.path.split('/').pop()).join(', '):entry.afterMedia[kind]?.path.split('/').pop();body.append(el('p',before&&before===after?`${names[kind]}: 파일 내용 변경`:`${names[kind]}: ${before||'없음'} → ${after||'없음'}`,'media-change'));}
  details.append(body);card.append(details);$('entries').append(card);
  input.addEventListener('change',()=>{input.checked?selected.add(entry.cms_id):selected.delete(entry.cms_id);flow.invalidate();$('selected-count').textContent=`선택한 공연 ${selected.size}건`;flow.update();});
 }
}
function validateReceipt(result){if(result.status!=='published'||result.productionPublished!==true||!result.mapping?.length||!Number.isSafeInteger(result.selectedSynced))throw Error('반영 완료 기록을 확인해 주세요.');}
const flow=publicationControls({
 async load(){
  valid=false;selected.clear();review=null;$('entries').replaceChildren();$('selection').hidden=true;$('status').textContent='저장된 내용을 확인하고 있습니다.';
  const data=await request('/api/review');if(!data.id||!Array.isArray(data.entries))throw Error('공연 자료를 확인해 주세요.');review=data;valid=true;render();$('selected-count').textContent='선택한 공연 0건';
  $('scope-note').textContent=review.publicationEnabled?'선택한 공연만 반영합니다. 마지막 확인 버튼을 누르기 전까지 홈페이지는 바뀌지 않습니다.':'이 연결은 내용 확인만 가능합니다. 홈페이지 반영 기능은 닫혀 있습니다.';
  $('status').textContent=review.entries.some(e=>e.status!=='unchanged')?'홈페이지에 반영할 공연을 선택해 주세요.':'';
 },
 canPrepare:()=>valid&&selected.size>0,
 lockInputs:locked=>{for(const input of document.querySelectorAll('#entries input'))input.disabled=locked;},
 async prepare(phase){
  const ids=[...selected];phase('선택한 내용과 첨부 자료를 확인하고 있습니다.');
  const plan=await request('/api/prepare',{reviewId:review.id,selectedIds:ids});
  const result=await request('/api/rehearse',{planId:plan.id,digest:plan.digest});
  phase('홈페이지 표시와 반영 후 저장 연결을 확인하고 있습니다.');
  const proof=await request('/api/validate-publication',{planId:plan.id,digest:plan.digest});
  if(proof.copyOnly!==true||proof.productionPublished!==false||proof.selectedSynced!==plan.mapping.length)throw Error('자동 확인 결과가 반영 대상과 다릅니다.');
  let candidate=null;
  if(review.publicationEnabled){phase('마지막으로 반영 대상을 확인하고 있습니다.');candidate=await request('/api/publication/prepare',{planId:plan.id,digest:plan.digest});if(candidate.id!==plan.id||JSON.stringify(candidate.mapping)!==JSON.stringify(plan.mapping))throw Error('최종 반영 대상이 달라졌습니다.');}
  return{candidate,plan,preview:result.preview,report:proof.report};
 },
 showReady({plan,preview,report}){
  $('ready-scope').textContent=`선택한 공연 ${plan.mapping.length}건의 확인한 수정만 반영합니다. 선택하지 않은 공연은 유지합니다.`;$('ready-items').replaceChildren();for(const item of plan.mapping)$('ready-items').append(el('li',item.title));
  $('ready-files').replaceChildren();for(const op of plan.operations){const label=op.path==='data/archive.csv'?'공연 정보':op.path.endsWith('-poster.jpg')?'포스터':op.path.endsWith('-program-book.pdf')?'프로그램북 PDF':'공연 사진';$('ready-files').append(el('li',`${label} ${actionNames[op.action]}`));}
  $('ready-preview').href=preview;$('ready-report').href=report;
 },
 apply:candidate=>request('/api/publication/apply',{publicationId:candidate.id,seal:candidate.seal,confirmed:true}),
 status:id=>request('/api/publication/status?'+new URLSearchParams({id})),
 showPublished(result){validateReceipt(result);$('published-summary').textContent=`공연 ${result.selectedSynced}건을 반영했고 편집 자료의 저장 상태도 맞췄습니다.`;$('published-link').href='https://ewha-eeams.github.io/archive.html#'+result.mapping[0].publicId;}
});
await flow.start();
