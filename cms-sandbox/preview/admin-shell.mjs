// Navigation only. No save or publication requests.
const icon = name => {
  const paths = {content:'<path d="M7 3h7l4 4v14H6V3h1m7 0v5h4M9 12h6m-6 4h6"/>',activity:'<path d="M5 20v-6m7 6V4m7 16V9"/>',guide:'<path d="M12 5c-3-2-6-2-9-1v15c3-1 6-1 9 1m0-15c3-2 6-2 9-1v15c-3-1-6-1-9 1V5Z"/>',home:'<path d="m4 11 8-7 8 7m-14-2v11h12V9m-9 11v-6h6v6"/>'};
  return `<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">${paths[name]}</svg>`;
};
if(document.body.classList.contains('admin-page')&&!document.querySelector('.admin-sidebar')){
 const side=document.createElement('aside');side.className='admin-sidebar';
 side.innerHTML=`<a class="admin-brand" href="manage.html" aria-label="EEAMS 자료 관리 시작"><strong>EEAMS</strong><span>자료 관리</span></a><nav aria-label="관리 메뉴"><a class="sidebar-item" data-section="content" href="manage.html">${icon('content')}<span>콘텐츠 관리</span></a><span class="sidebar-item sidebar-unavailable" aria-disabled="true">${icon('activity')}<span>이용 현황</span><small>준비 중</small></span><a class="sidebar-item" data-section="guide" href="guide.html">${icon('guide')}<span>사용 안내</span></a></nav><div class="sidebar-footer"><a href="https://ewha-eeams.github.io/" target="_blank" rel="noopener noreferrer">${icon('home')}<span>공개 홈페이지 ↗</span></a><p>이 Mac의 관리 도구</p></div>`;
 const skip=document.createElement('a');skip.href='#admin-main';skip.className='admin-skip';skip.textContent='본문으로 바로가기';document.querySelector('main').id||='admin-main';document.body.prepend(side);document.body.prepend(skip);document.body.classList.add('has-admin-shell');
 function current(){
  const file=location.pathname.split('/').pop(),section=file==='guide.html'?'guide':'content';
  for(const link of side.querySelectorAll('[data-section]')){const active=link.dataset.section===section;link.classList.toggle('is-active',active);if(active)link.setAttribute('aria-current','page');else link.removeAttribute('aria-current');}

 }
 current();
}
