import { contentTypes,contentCsv } from './content-model.mjs';
const params=new URLSearchParams(location.search),kind=params.get('kind'),commit=params.get('snapshot');
if(!Object.hasOwn(contentTypes,kind)||!/^[0-9a-f]{40}$/.test(commit||'')||document.body.dataset.cmsContent!==kind)throw Error('자료 미리보기에서 다시 열어 주세요.');
export const contentSnapshot=JSON.parse(localStorage.getItem('eeams-cms-content-v1:'+kind+':'+commit)||'null');
if(!contentSnapshot||contentSnapshot.schema!==1||contentSnapshot.kind!==kind||contentSnapshot.commit!==commit)throw Error('관리 화면에서 저장된 자료를 다시 불러와 주세요.');
export async function contentFetch(path) {
  if(String(path)!=='data/'+kind+'.csv')return new Response(null,{status:404});
  return new Response(contentCsv(kind,contentSnapshot.displayRows),{status:200,headers:{'Content-Type':'text/csv; charset=utf-8'}});
}
export function contentMediaUrl(path) {
  const normalized=String(path).replace(/^\//,'');
  if(!Object.hasOwn(contentSnapshot.resources,normalized))return '';
  return '/api/content-media?'+new URLSearchParams({kind,commit,path:normalized});
}
