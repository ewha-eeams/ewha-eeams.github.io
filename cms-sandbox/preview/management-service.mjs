import { createHash } from 'node:crypto';
import { compileSnapshot, rawUrl, cmsRoot } from './preview-model.mjs';
import { buildReview, assertCurrent } from './review-model.mjs';
import { parseCsv } from './csv-parser.mjs';
import { contentTypes, parseContentCsv, compileContent } from './content-model.mjs';

// Read-only operations over the same fixed repository reader used for review.
export function createManagementService({ reader, publicationEnabled = false, contentPublicationEnabled = false }) {
  const snapshots = new Map();
  let loading;
  const contentSnapshots = new Map(), contentLoading = new Map();
  async function readContent(kind) {
    if (!Object.hasOwn(contentTypes, kind)) throw new Error('관리할 자료 종류를 확인해 주세요.');
    if (!contentLoading.has(kind)) contentLoading.set(kind, (async () => {
      const refs = await reader.refs();
      const [csv, bytes, tree] = await Promise.all([reader.bytes(refs.baseCommit, `data/${kind}.csv`), reader.bytes(refs.draftCommit, `cms-sandbox/content/${kind}.json`), reader.tree(refs.draftCommit)]);
      if (bytes.length > 1024 * 1024) throw new Error('자료 목록의 크기를 확인해 주세요.');
      const snapshot = compileContent({ kind, form: JSON.parse(bytes.toString('utf8')), sourceRows: parseContentCsv(csv.toString('utf8'), kind), sourceHash: createHash('sha256').update(csv).digest('hex'), commit: refs.draftCommit, baseCommit: refs.baseCommit, tree });
      assertCurrent(refs, await reader.refs());
      contentSnapshots.set(kind + ':' + snapshot.commit, snapshot);
      while (contentSnapshots.size > 30) contentSnapshots.delete(contentSnapshots.keys().next().value);
      return snapshot;
    })().finally(() => contentLoading.delete(kind)));
    return contentLoading.get(kind);
  }
  async function readSaved() {
    const refs = await reader.refs();
    const [baseTree, draftTree, csv] = await Promise.all([
      reader.tree(refs.baseCommit), reader.tree(refs.draftCommit), reader.bytes(refs.baseCommit, 'data/archive.csv'),
    ]);
    const paths = draftTree.filter(f => f.type === 'blob' && /^cms-sandbox\/(?:forms|drafts)\/[^/]+\.json$/.test(f.path));
    if (paths.length > 200 || paths.some(f => f.size > 1024 * 1024)) throw new Error('공연 목록의 개수와 크기를 확인해 주세요.');
    const files = [];
    for (let i = 0; i < paths.length; i += 8) files.push(...await Promise.all(paths.slice(i, i + 8).map(async file => ({
      path: file.path, data: JSON.parse((await reader.bytes(refs.draftCommit, file.path)).toString('utf8')),
    }))));
    const source = { sha256: createHash('sha256').update(csv).digest('hex'), rows: parseCsv(csv.toString('utf8')) };
    const review = buildReview({ source, files, baseTree, draftTree, ...refs, baseCsv: csv.toString('utf8') });
    const snapshot = { ...compileSnapshot({ source, files, tree: draftTree, commit: refs.draftCommit }), delivery: 'local-server' };
    assertCurrent(refs, await reader.refs());
    snapshots.set(snapshot.commit, snapshot);
    while (snapshots.size > 20) snapshots.delete(snapshots.keys().next().value);
    return { refs, review, snapshot };
  }
  function saved() {
    loading ||= readSaved().finally(() => { loading = null; });
    return loading;
  }
  return {
    health() { return { app: 'eeams-cms-manager', schema: 1, mode: publicationEnabled || contentPublicationEnabled ? 'publication-enabled' : 'review-only', publication: {concerts:publicationEnabled,additionalContent:contentPublicationEnabled} }; },
    async status() {
      const { refs, review, snapshot } = await saved();
      return { ...this.health(), concerts: snapshot.entries.length, works: snapshot.rows.length,
        changes: review.entries.filter(entry => entry.status !== 'unchanged').length, warnings: snapshot.warnings,
        links: { edit: `${cmsRoot}/collection/concerts`, add: `${cmsRoot}/collection/concert_drafts/new`, upload: `${cmsRoot}/file/upload_guide` },
        ...refs, checkedAt: new Date().toISOString() };
    },
    async preview() { return (await saved()).snapshot; },
    async content(kind) { return readContent(kind); },
    async contentMedia(kind, commit, path) {
      const snapshot = contentSnapshots.get(kind + ':' + commit), resource = snapshot?.resources[path];
      if (!resource || resource.path !== path) throw Object.assign(new Error('자료 미리보기를 다시 불러와 주세요.'), { code: 'ENOENT' });
      const bytes = await reader.bytes(commit, path);
      const valid = resource.mime === 'application/pdf' ? bytes.subarray(0, 5).toString() === '%PDF-' : resource.mime === 'image/png' ? bytes.subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10])) : resource.mime === 'image/webp' ? bytes.subarray(0,4).toString() === 'RIFF' && bytes.subarray(8,12).toString() === 'WEBP' : bytes[0] === 0xff && bytes[1] === 0xd8;
      if (!valid || bytes.length !== resource.bytes) throw new Error('자료의 형식이나 크기를 확인해 주세요.');
      return { bytes, mime: resource.mime };
    },
    async media(commit, path) {
      if (!/^[0-9a-f]{40}$/.test(commit || '') || typeof path !== 'string' || path.length > 2048 || !path.startsWith('cms-sandbox/media/concerts/')
          || !/\.(?:jpg|pdf)$/i.test(path) || /[\\?#%\x00-\x1f]/.test(path) || path.split('/').some(part => part === '.' || part === '..')) throw new Error('미리보기 자료 경로를 확인해 주세요.');
      const snapshot = snapshots.get(commit), resource = snapshot?.resources[rawUrl(commit, path)];
      if (!resource || resource.path !== path) throw Object.assign(new Error('관리 시작 화면에서 미리보기를 다시 불러와 주세요.'), { code: 'ENOENT' });
      const bytes = await reader.bytes(commit, path);
      if (bytes.length !== resource.bytes || (resource.mime === 'application/pdf' ? bytes.subarray(0, 5).toString() !== '%PDF-' : bytes[0] !== 0xff || bytes[1] !== 0xd8)) throw new Error('선택한 자료의 형식이나 크기를 확인해 주세요.');
      return { bytes, mime: resource.mime };
    },
  };
}
