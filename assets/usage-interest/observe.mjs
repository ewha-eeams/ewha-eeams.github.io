const sectionIds={archive:'concerts',research:'research',education:'education',people:'people'};
export function attachInterest(document,registry,classify,{enabled=false,onAction}={}){
 if(!enabled)return()=>{};
 if(typeof onAction!=='function')throw Error('집계 행동을 받는 함수를 확인해 주세요.');
 const view=document.defaultView;let initialDone=false;
 const emit=intent=>{const action=classify(intent,registry);if(action)onAction(action);};
 const click=event=>{
  if(!event.isTrusted||event.button!==0||!(event.target instanceof view.Element))return;
  const target=event.target,link=target.closest('a[href]');
  if(link){
   let url;try{url=new URL(link.href,view.location.href);}catch{return;}
   const record=link.closest('details.archive-record,details.education-record');
   if(record&&link.matches('.archive-resource-link,.person-action')){emit({type:'attachment',category:record.classList.contains('archive-record')?'concerts':'education',recordKey:record.id});return;}
   if(link.matches('.project-card')){emit({type:'research_link',url:link.getAttribute('href')});return;}
   if(url.origin===view.location.origin&&url.pathname===view.location.pathname){let id;try{id=decodeURIComponent(url.hash.slice(1));}catch{return;}if(sectionIds[id])emit({type:'section_open',category:sectionIds[id]});}
   return;
  }
  const disclosure=target.closest('.section-disclosure');
  if(disclosure&&disclosure.getAttribute('aria-expanded')!=='true'){const id=disclosure.closest('section')?.id;if(sectionIds[id])emit({type:'section_open',category:sectionIds[id]});return;}
  const summary=target.closest('summary'),record=summary?.parentElement;
  if(record?.matches('details.archive-record,details.education-record')&&!record.open)emit({type:'record_open',category:record.classList.contains('archive-record')?'concerts':'education',recordKey:record.id});
 };
 const initial=()=>{
  if(initialDone)return;
  let key;try{key=decodeURIComponent(view.location.hash.slice(1));}catch{return;}
  const category=['/archive.html','/archive-en.html'].includes(view.location.pathname)?'concerts':['/education.html','/education-en.html'].includes(view.location.pathname)?'education':null;
  if(category&&key){const record=document.getElementById(key);if(!record?.matches('details')||!record.open)return;initialDone=true;emit({type:'record_open',category,recordKey:key});}
  else{initialDone=true;if(['/','/index.html','/en.html'].includes(view.location.pathname)&&sectionIds[key])emit({type:'section_open',category:sectionIds[key]});else emit({type:'page_entry',path:view.location.pathname,recordKey:''});}
 };
 document.addEventListener('click',click,true);const observer=new view.MutationObserver(()=>{initial();if(initialDone)observer.disconnect();});observer.observe(document.documentElement,{subtree:true,childList:true,attributes:true,attributeFilter:['open']});
 initial();if(initialDone)observer.disconnect();return()=>{document.removeEventListener('click',click,true);observer.disconnect();};
}
