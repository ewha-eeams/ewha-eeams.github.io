export function renderContentChanges(target, changes) {
  target.replaceChildren();
  for(const change of changes) {
    const article=document.createElement('article'),heading=document.createElement('h2');
    heading.textContent=({added:'추가',removed:'제외',changed:'수정'}[change.status])+' · '+change.label;article.append(heading);
    if(change.moved){const p=document.createElement('p');p.textContent='목록 안의 위치가 바뀌었습니다. 표시 순서 값도 함께 확인하세요.';article.append(p);}
    const dl=document.createElement('dl');
    for(const field of change.fields){const dt=document.createElement('dt'),before=document.createElement('dd'),after=document.createElement('dd');dt.textContent=field.label;before.textContent='이전: '+(field.before||'(없음)');before.className='before';after.textContent='저장: '+(field.after||'(없음)');dl.append(dt,before,after);}
    article.append(dl);target.append(article);
  }
  if(!changes.length){const p=document.createElement('p');p.textContent='현재 공개 내용과 같은 상태입니다.';target.append(p);}
}
