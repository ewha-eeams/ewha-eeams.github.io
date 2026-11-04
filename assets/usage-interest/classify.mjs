const host='https://ewha-eeams.github.io/';
export function canonicalUrl(value){
 const url=new URL(value,host);if(!['http:','https:'].includes(url.protocol)||url.username||url.password)throw Error('공개 연결 주소를 확인해 주세요.');return url.href;
}
export function classifyIntent(intent,registry){
 if(intent.type==='section_open'&&['concerts','research','education','people'].includes(intent.category))return{kind:'category_entry',category:intent.category,contentId:intent.category};
 if(intent.type==='record_open'){
  const target=registry.find(r=>r.category===intent.category&&r.recordKey===intent.recordKey);
  return target?{kind:'detail_open',category:target.category,contentId:target.id}:null;
 }
 if(intent.type==='page_entry'){
  const path=intent.path;
  const person=registry.find(r=>r.category==='people'&&r.pages?.includes(path));if(person)return{kind:'detail_open',category:'people',contentId:'people-index'};
  if(['/archive.html','/archive-en.html'].includes(path)&&!intent.recordKey)return{kind:'category_entry',category:'concerts',contentId:'concerts'};
  if(['/education.html','/education-en.html'].includes(path)&&!intent.recordKey)return{kind:'category_entry',category:'education',contentId:'education'};
  return null;
 }
 if(intent.type==='attachment'){
  const target=registry.find(r=>r.category===intent.category&&r.recordKey===intent.recordKey&&r.actions.includes('attachment_open'));
  return target?{kind:'attachment_open',category:target.category,contentId:target.id}:null;
 }
 if(intent.type==='research_link'){
  let url;try{url=canonicalUrl(intent.url);}catch{return null;}
  const target=registry.find(r=>r.category==='research'&&r.url===url);
  return target?{kind:'research_outbound_open',category:'research',contentId:target.id}:null;
 }
 return null;
}
