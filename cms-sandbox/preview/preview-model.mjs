import { concertFields, workFields, groupRows, rowsFor, mergeConcert, validateConcert } from './concert-model.mjs';

export const branch = 'cms-pilot-20261026';
export const repository = 'ewha-eeams/ewha-eeams.github.io';
export const rawRoot = `https://raw.githubusercontent.com/${repository}/`;
export const cmsRoot = `https://app.pagescms.org/${repository}/${branch}`;
export const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function rawUrl(commit, path) {
  if (!/^[0-9a-f]{40}$/.test(commit) || !path || path.startsWith('/') || path.split('/').some(p => p === '.' || p === '..') || /[\\?#]/.test(path)) throw new Error('자료 경로를 확인해 주세요.');
  return rawRoot + commit + '/' + path.split('/').map(encodeURIComponent).join('/');
}

const text = value => value == null ? '' : typeof value === 'string' && value.length <= 20000 ? value : (() => { throw new Error('입력값의 형식이나 길이를 확인해 주세요.'); })();

export function compileSnapshot({ source, files, tree, commit }) {
  if (!/^[0-9a-f]{40}$/.test(commit)) throw new Error('저장본을 확인하지 못했습니다.');
  if (!Array.isArray(tree) || tree.length > 100000) throw new Error('자료 목록을 확인하지 못했습니다.');
  const blobs = new Map(tree.filter(f => f.type === 'blob').map(f => [f.path, f]));
  const baseConcerts = new Map(groupRows(source.rows).map(c => [c.id, c]));
  let rows = structuredClone(source.rows);
  const entries = [], resources = {}, warnings = [], ids = new Set(), origins = new Set();
  for (const { path, data } of files) {
    const existing = /^cms-sandbox\/forms\/[0-9]{4}-concert[1-9][0-9]*\.json$/.test(path);
    if (!existing && !/^cms-sandbox\/drafts\/[0-9a-f-]{36}\.json$/i.test(path)) throw new Error('사본 외의 파일은 미리 볼 수 없습니다.');
    if (!uuidPattern.test(data.cms_id || '') || ids.has(data.cms_id)) throw new Error(`${path}: 초안 식별자를 확인해 주세요.`);
    ids.add(data.cms_id);
    if (!existing && path !== `cms-sandbox/drafts/${data.cms_id}.json`) throw new Error('초안 파일명이 식별자와 다릅니다.');
    if (data.source_sha256 !== source.sha256) throw new Error(`${path}: 원본 기준이 달라졌습니다. 사본을 먼저 검토해 주세요.`);
    if (!Array.isArray(data.works) || !data.works.length || data.works.length > 500) throw new Error(`${path}: 작품 목록을 확인해 주세요.`);
    const concert = Object.fromEntries(concertFields.map(k => [k, text(data[k])]));
    concert.works = data.works.map(work => Object.fromEntries(workFields.map(k => [k, text(work[k])])));
    if (!concert.title.trim() || !concert.venue.trim()) throw new Error(`${path}: 공연명과 장소를 입력해 주세요.`);
    if (existing) {
      const base = baseConcerts.get(data.origin_id);
      if (!base || path !== `cms-sandbox/forms/${base.id}.json` || origins.has(base.id) || concert.date !== base.date || concert.slug !== base.slug) throw new Error(`${path}: 기존 공연의 날짜와 주소는 유지해야 합니다.`);
      origins.add(base.id);
      Object.assign(concert, { original: true, id: base.id });
      rows = mergeConcert(rows, concert);
    } else {
      if (data.origin_id || data.slug) throw new Error(`${path}: 새 공연의 공개 식별자는 아직 부여하지 않습니다.`);
      const errors = validateConcert({ ...concert, original: false, slug: 'concert1' }, []);
      if (errors.length) throw new Error(`${path}: ${errors.join(' ')}`);
      concert.slug = `draft-${data.cms_id.toLowerCase()}`;
      rows.push(...rowsFor(concert));
    }
    const recordId = `${concert.date.slice(0, 4)}-${concert.slug}`;
    const attach = (value, extension, kind) => {
      const pathValue = text(value);
      if (!pathValue) return '';
      if (!pathValue.startsWith('/cms-sandbox/media/concerts/') || /[\\?#%]/.test(pathValue) || pathValue.split('/').some(p => p === '.' || p === '..') || !pathValue.toLowerCase().endsWith('.' + extension)) throw new Error(`${concert.title}: ${kind}은 사본 자료에서 선택해 주세요.`);
      const mediaPath = pathValue.slice(1), blob = blobs.get(mediaPath);
      if (!blob) { warnings.push(`${concert.title}: ${kind} 파일을 찾지 못했습니다. CMS에서 다시 선택해 주세요.`); return ''; }
      if (blob.size > 20 * 1024 * 1024) throw new Error(`${concert.title}: ${kind} 파일이 사본의 20 MB 한도를 넘습니다.`);
      const url = rawUrl(commit, mediaPath);
      resources[url] = { path: mediaPath, mime: extension === 'pdf' ? 'application/pdf' : 'image/jpeg', bytes: blob.size };
      return url;
    };
    if (data.photos != null && !Array.isArray(data.photos)) throw new Error('사진 목록 형식을 확인해 주세요.');
    const photos = data.photos || [];
    if (photos.length > 20 || new Set(photos).size !== photos.length) throw new Error('사진은 중복 없이 최대 20장 선택해 주세요.');
    entries.push({ recordId, cms_id: data.cms_id, path, existing, title: concert.title, date: concert.date,
      editUrl: `${cmsRoot}/collection/${existing ? 'concerts' : 'concert_drafts'}/edit/${encodeURIComponent(path)}`,
      poster: attach(data.poster, 'jpg', '포스터'), pdf: attach(data.program_book, 'pdf', '프로그램북'),
      photos: photos.map(p => attach(p, 'jpg', '사진')).filter(Boolean) });
  }
  if (origins.size !== baseConcerts.size) throw new Error('기존 공연 사본 일부가 없습니다. 목록을 먼저 확인해 주세요.');
  entries.sort((a, b) => b.date.localeCompare(a.date) || a.path.localeCompare(b.path));
  return { schema: 1, branch, repository, commit, rows, entries, resources, warnings };
}

export const storageKey = commit => `eeams-cms-saved-preview-v1:${commit}`;
export function readSnapshot(commit, storage = localStorage) {
  if (!/^[0-9a-f]{40}$/.test(commit || '')) throw new Error('미리보기 목록에서 저장된 초안을 먼저 불러와 주세요.');
  const snapshot = JSON.parse(storage.getItem(storageKey(commit)) || 'null');
  if (!snapshot || snapshot.schema !== 1 || snapshot.commit !== commit || snapshot.branch !== branch || snapshot.repository !== repository) throw new Error('미리보기 목록에서 저장된 초안을 먼저 불러와 주세요.');
  for (const [url, resource] of Object.entries(snapshot.resources)) if (rawUrl(commit, resource.path) !== url || !resource.path.startsWith('cms-sandbox/media/concerts/')) throw new Error('미리보기 자료 경로를 확인해 주세요.');
  return snapshot;
}
