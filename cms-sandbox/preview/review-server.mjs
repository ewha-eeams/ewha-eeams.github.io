import http from 'node:http';
import { readFile, writeFile, mkdir, rename, rm } from 'node:fs/promises';
import { createHash, randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { join, resolve, dirname } from 'node:path';
import { buildReview, publicReview, preparePlan, assertCurrent, allowedPublishPath } from './review-model.mjs';
import { parseCsv } from './csv-parser.mjs';
import { repository, branch, rawUrl, uuidPattern } from './preview-model.mjs';
import { createLocalPublicationCopy, LocalPublicationCopy } from './publication-copy.mjs';
import { GitSnapshotReader } from './git-snapshot-reader.mjs';
import { ActualPublisher } from './publication-remote.mjs';
import { createManagementService } from './management-service.mjs';
import { execFileSync } from 'node:child_process';

const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
const gitSha = bytes => createHash('sha1').update(`blob ${bytes.length}\0`).update(bytes).digest('hex');
const ttl = 30 * 60 * 1000;
const maxFile = 20 * 1024 * 1024;
const JSZip = createRequire(import.meta.url)('./jszip.min.cjs');
export class GitHubReader {
  trees = new Map(); bytesCache = new Map();
  async response(url) {
    const response = await fetch(url, { headers: { Accept: 'application/vnd.github+json' }, signal: AbortSignal.timeout(25000) });
    if (!response.ok) throw new Error(response.status === 403 || response.status === 429 ? 'GitHub 읽기 한도에 도달했습니다. 잠시 후 다시 불러와 주세요.' : `저장본을 읽지 못했습니다. (${response.status})`);
    return response;
  }
  async refs() {
    const [base, draft] = await Promise.all(['main', branch].map(async ref => (await this.response(`https://api.github.com/repos/${repository}/branches/${ref}`)).json()));
    const result = { baseCommit: base.commit?.sha, draftCommit: draft.commit?.sha };
    if (Object.values(result).some(s => !/^[0-9a-f]{40}$/.test(s || ''))) throw new Error('저장본을 확인하지 못했습니다.');
    return result;
  }
  async tree(commit) {
    if (!this.trees.has(commit)) {
      const result = await (await this.response(`https://api.github.com/repos/${repository}/git/trees/${commit}?recursive=1`)).json();
      if (result.truncated || !Array.isArray(result.tree)) throw new Error('파일 목록 일부가 누락됐습니다. 다시 확인해 주세요.');
      this.trees.set(commit, result.tree);
    }
    return this.trees.get(commit);
  }
  async bytes(commit, path) {
    const file = (await this.tree(commit)).find(f => f.path === path && f.type === 'blob');
    if (!file) { const error = new Error(`파일을 찾지 못했습니다: ${path}`); error.code = 'ENOENT'; throw error; }
    if (file.size > maxFile) throw new Error(`파일을 확인해 주세요: ${path}`);
    if (!this.bytesCache.has(file.sha)) {
      const bytes = Buffer.from(await (await this.response(rawUrl(commit, path))).arrayBuffer());
      if (bytes.length !== file.size || gitSha(bytes) !== file.sha) throw new Error(`저장된 파일과 내용이 다릅니다: ${path}`);
      this.bytesCache.set(file.sha, bytes);
    }
    return this.bytesCache.get(file.sha);
  }
}

export function createReviewService({ reader = new GitHubReader(), artifactRoot, sourceRepository, publisher = null, fault = async () => {} }) {
  const reviews = new Map(), plans = new Map(), results = new Map();
  const active = new Set();
  const requireLive = (map, id) => {
    const value = map.get(id);
    if (!value || Date.now() - value.created > ttl) { const error = new Error('확인 시간이 지났습니다. 변경 내용을 다시 불러와 주세요.'); error.code = 'EXPIRED_REVIEW'; throw error; }
    return value;
  };
  return {
    reader, results,
    async findResult(id) {
      if (results.has(id)) return results.get(id);
      if (!uuidPattern.test(id)) throw new Error('반영 시험 결과를 확인해 주세요.');
      const directory = join(artifactRoot, id), receipt = JSON.parse(await readFile(join(directory, 'review.json'), 'utf8'));
      if (receipt.schema !== 1 || receipt.published !== false || receipt.trialOnly !== true || !/^[0-9a-f]{40}$/.test(receipt.baseCommit || '') || !Array.isArray(receipt.files) || receipt.files.some(f => !allowedPublishPath(f.path)) || !Array.isArray(receipt.deleted) || receipt.deleted.some(p => !allowedPublishPath(p)) || !/^[0-9]{4}-concert[1-9][0-9]*$/.test(receipt.mapping?.[0]?.publicId || '')) throw new Error('반영 시험 결과의 형식이 올바르지 않습니다.');
      for (const file of receipt.files) {
        const bytes = await readFile(join(directory, file.path));
        if (bytes.length !== file.bytes || sha256(bytes) !== file.sha256) throw new Error('반영 시험 자료가 변경됐습니다. 다시 확인해 주세요.');
      }
      const summary = { id, trialOnly: true, published: false, preview: `/rehearsals/${id}/archive.html#${receipt.mapping[0].publicId}`, package: `/rehearsals/${id}/review-package.zip`, files: receipt.files.length, deleted: receipt.deleted.length };
      const result = { receipt, directory, summary }; results.set(id, result); return result;
    },
    async load() {
      const refs = await reader.refs();
      const [baseTree, draftTree] = await Promise.all([reader.tree(refs.baseCommit), reader.tree(refs.draftCommit)]);
      const bytes = await reader.bytes(refs.baseCommit, 'data/archive.csv');
      const source = { sha256: sha256(bytes), rows: parseCsv(bytes.toString('utf8')) };
      const paths = draftTree.filter(f => f.type === 'blob' && /^cms-sandbox\/(?:forms|drafts)\/[^/]+\.json$/.test(f.path));
      if (paths.length > 200 || paths.some(p => p.size > 1024 * 1024)) throw new Error('공연 사본의 개수 또는 크기를 확인해 주세요.');
      const files = [];
      for (let i = 0; i < paths.length; i += 8) files.push(...await Promise.all(paths.slice(i, i + 8).map(async f => ({ path: f.path, data: JSON.parse((await reader.bytes(refs.draftCommit, f.path)).toString('utf8')) }))));
      const review = buildReview({ source, files, baseTree, draftTree, ...refs, baseCsv: bytes.toString('utf8') });
      const id = randomUUID(); reviews.set(id, { ...review, created: Date.now() });
      for (const [key, item] of reviews) if (Date.now() - item.created > ttl) reviews.delete(key);
      return { id, publicationEnabled: !!publisher, ...publicReview(review) };
    },
    async prepare(reviewId, selectedIds) {
      const review = requireLive(reviews, reviewId); assertCurrent(review, await reader.refs());
      const plan = preparePlan(review, selectedIds), digest = sha256(JSON.stringify(plan)), id = randomUUID();
      plans.set(id, { plan, digest, created: Date.now() });
      return { id, digest, mapping: plan.mapping, operations: plan.operations, baseCommit: plan.baseCommit, draftCommit: plan.draftCommit };
    },
    async rehearse(id, digest) {
      const item = requireLive(plans, id), { plan } = item;
      if (item.digest !== digest || sha256(JSON.stringify(plan)) !== digest) throw new Error('확인한 변경 내용과 요청이 다릅니다. 다시 확인해 주세요.');
      assertCurrent(plan, await reader.refs());
      if (results.has(id)) return results.get(id).summary;
      if (active.has(id)) throw new Error('같은 반영 시험을 처리하고 있습니다. 잠시 기다려 주세요.');
      active.add(id);
      const temporary = join(artifactRoot, `.pending-${id}`), final = join(artifactRoot, id);
      try {
        await mkdir(temporary, { recursive: true });
        const files = [], deleted = plan.operations.filter(o => o.action === 'delete').map(o => o.path);
        const save = async (path, bytes) => {
          if (!allowedPublishPath(path)) throw new Error('허용되지 않은 파일 변경입니다.');
          const target = join(temporary, path); await mkdir(dirname(target), { recursive: true }); await writeFile(target, bytes);
          files.push({ path, bytes: bytes.length, sha256: sha256(bytes) });
        };
        await save('data/archive.csv', Buffer.from(plan.csv, 'utf8'));
        for (const operation of plan.operations.filter(o => o.sourcePath)) {
          const bytes = await reader.bytes(operation.sourceCommit, operation.sourcePath);
          if (gitSha(bytes) !== operation.sha) throw new Error('첨부 파일의 저장본이 달라졌습니다.');
          if (operation.path.endsWith('.pdf') ? bytes.subarray(0, 5).toString() !== '%PDF-' : bytes[0] !== 0xff || bytes[1] !== 0xd8) throw new Error('첨부 파일의 형식을 확인해 주세요.');
          await save(operation.path, bytes);
        }
        await fault('after-files');
        const receipt = { schema: 1, trialOnly: true, published: false, publicState: 'unchanged', planDigest: digest, baseCommit: plan.baseCommit, draftCommit: plan.draftCommit, selectedIds: plan.selectedIds, mapping: plan.mapping, operations: plan.operations, deleted, files, created: new Date().toISOString() };
        await writeFile(join(temporary, 'review.json'), JSON.stringify(receipt, null, 2) + '\n');
        const zip = new JSZip(); zip.file('review.json', JSON.stringify(receipt, null, 2) + '\n');
        for (const file of files) if (plan.operations.some(o => o.path === file.path && o.action !== 'delete')) zip.file(file.path, await readFile(join(temporary, file.path)));
        await writeFile(join(temporary, 'review-package.zip'), await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' }));
        await fault('before-commit'); assertCurrent(plan, await reader.refs());
        await rename(temporary, final);
        const summary = { id, trialOnly: true, published: false, preview: `/rehearsals/${id}/archive.html#${plan.mapping[0].publicId}`, package: `/rehearsals/${id}/review-package.zip`, files: files.length, deleted: deleted.length };
        results.set(id, { receipt, directory: final, summary }); return summary;
      } catch (error) { await rm(temporary, { recursive: true, force: true }); throw error; }
      finally { active.delete(id); }
    },
    async validatePublication(id, digest) {
      const { plan, digest: expected } = requireLive(plans, id);
      if (expected !== digest || sha256(JSON.stringify(plan)) !== digest) throw new Error('확인한 변경 내용과 요청이 다릅니다.');
      if (!sourceRepository) throw new Error('이 컴퓨터의 사본 게시 검증을 준비해 주세요.');
      assertCurrent(plan, await reader.refs());
      const result = await this.findResult(id), key = `publication-${id}`;
      if (active.has(key)) throw new Error('같은 사본 검증을 처리하고 있습니다. 잠시 기다려 주세요.');
      active.add(key);
      try {
        const directory = join(result.directory, 'publication-copy.git');
        let copy;
        try { copy = await createLocalPublicationCopy({ directory, sourceRepository: reader.copySource || sourceRepository, baseCommit: plan.baseCommit, draftCommit: plan.draftCommit }); }
        catch (error) { if (error.code !== 'EEXIST') throw error; copy = new LocalPublicationCopy(directory); }
        const report = await copy.publish(plan, digest);
        assertCurrent(plan, await reader.refs());
        await writeFile(join(result.directory, 'publication-check.json'), JSON.stringify(report, null, 2) + '\n');
        return { copyOnly: true, productionPublished: false, selectedSynced: report.selectedUnchanged, remainingChanges: report.remainingChanges,
          promoted: report.transformed.filter(f => f.from !== f.to).length, preserved: report.preserved.length, repeated: report.repeated,
          report: `/rehearsals/${id}/publication-check.json` };
      } finally { active.delete(key); }
    },
    async prepareActualPublication(id, digest) {
      if (!publisher) throw new Error('실제 게시 연결이 열려 있지 않습니다. 사본 확인은 계속 사용할 수 있습니다.');
      const { plan, digest: expected } = requireLive(plans, id);
      if (expected !== digest) throw new Error('확인한 게시 내용이 다릅니다.');
      assertCurrent(plan, await reader.refs());
      const result = await this.findResult(id);
      const proof = JSON.parse(await readFile(join(result.directory, 'publication-check.json'), 'utf8'));
      if (proof.digest !== digest || proof.baseCommit !== plan.baseCommit || proof.draftCommit !== plan.draftCommit || proof.selectedUnchanged !== plan.mapping.length) throw new Error('같은 내용으로 사본 게시·CMS 동기화를 먼저 확인해 주세요.');
      const key = `actual-prepare-${id}`; if (active.has(key)) throw new Error('게시 연결을 확인하는 중입니다.');
      active.add(key);
      try { return await publisher.prepare({ id, plan, digest }); } finally { active.delete(key); }
    },
    async applyActualPublication(id, seal, confirmed) {
      if (!publisher) throw new Error('실제 게시 연결이 열려 있지 않습니다.');
      return publisher.apply({ id, seal, confirmed });
    },
    async publicationStatus(id) {
      if (!publisher) throw new Error('게시 기록 확인 연결이 열려 있지 않습니다.');
      return publisher.status(id);
    },
  };
}

const mime = path => path.endsWith('.html') ? 'text/html; charset=utf-8' : /\.(mjs|js)$/.test(path) ? 'text/javascript; charset=utf-8' : path.endsWith('.css') ? 'text/css; charset=utf-8' : path.endsWith('.json') ? 'application/json; charset=utf-8' : path.endsWith('.csv') ? 'text/csv; charset=utf-8' : path.endsWith('.pdf') ? 'application/pdf' : path.endsWith('.png') ? 'image/png' : /\.jpe?g$/.test(path) ? 'image/jpeg' : path.endsWith('.webp') ? 'image/webp' : path.endsWith('.zip') ? 'application/zip' : 'application/octet-stream';
const previewPathAllowed = path => ['archive.html', 'media.html', 'data/archive.csv'].includes(path) || /^assets\/(?:[a-zA-Z0-9_.-]+\.(?:css|js|png|jpg|webp)|media\/(?:concerts|home)\/[a-zA-Z0-9_./-]+\.(?:jpg|png|webp|pdf))$/.test(path);
export function trustedMutation(headers, origin) { return headers.origin === origin && headers['content-type']?.split(';')[0] === 'application/json' && headers['x-eeams-review'] === '1'; }

export function createReviewServer({ root, service, pageNotice = '', management = null }) {
  return http.createServer(async (req, res) => {
    const host = req.headers.host || '';
    const send = (status, body, type = 'application/json; charset=utf-8') => { res.writeHead(status, { 'Content-Type': type, 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' }); res.end(req.method === 'HEAD' ? undefined : body); };
    try {
      if (!/^(?:127\.0\.0\.1|localhost):[0-9]+$/.test(host)) return send(403, JSON.stringify({ message: '접속 주소를 확인해 주세요.' }));
      const url = new URL(req.url, `http://${host}`), path = decodeURIComponent(url.pathname);
      if (path.includes('..') || path.includes('\\')) return send(400, '{}');
      if (req.method === 'POST') {
        if (!trustedMutation(req.headers, `http://${host}`)) return send(403, JSON.stringify({ message: '이 컴퓨터의 변경 확인 화면에서 진행해 주세요.' }));
        let body = ''; for await (const chunk of req) { body += chunk; if (Buffer.byteLength(body) > 16384) throw new Error('요청 크기를 확인해 주세요.'); }
        const data = JSON.parse(body);
        const result = path === '/api/prepare' ? await service.prepare(data.reviewId, data.selectedIds) : path === '/api/rehearse' ? await service.rehearse(data.planId, data.digest) : path === '/api/validate-publication' ? await service.validatePublication(data.planId, data.digest) : path === '/api/publication/prepare' ? await service.prepareActualPublication(data.planId, data.digest) : path === '/api/publication/apply' ? await service.applyActualPublication(data.publicationId, data.seal, data.confirmed) : null;
        return result ? send(200, JSON.stringify(result)) : send(404, '{}');
      }
      if (!['GET', 'HEAD'].includes(req.method)) return send(405, '{}');
      if (path === '/' || ['/manage', '/preview', '/review'].includes(path)) {
        const name = path === '/preview' ? 'index' : path === '/review' || url.searchParams.has('publication') ? 'review' : management ? 'manage' : 'review';
        res.writeHead(302, { Location: `/cms-sandbox/preview/${name}.html${url.search}`, 'Cache-Control': 'no-store' }); return res.end();
      }
      if (management && path === '/api/manage/health') return send(200, JSON.stringify(management.health()));
      if (management && path === '/api/manage/status') return send(200, JSON.stringify(await management.status()));
      if (management && path === '/api/saved-preview') return send(200, JSON.stringify(await management.preview()));
      if (management && path === '/api/content') return send(200, JSON.stringify(await management.content(url.searchParams.get('kind'))));
      if (management && path === '/api/content-media') {
        const file = await management.contentMedia(url.searchParams.get('kind'), url.searchParams.get('commit'), url.searchParams.get('path'));
        return send(200, file.bytes, file.mime);
      }
      if (management && path === '/api/saved-media') {
        const file = await management.media(url.searchParams.get('commit'), url.searchParams.get('path'));
        return send(200, file.bytes, file.mime);
      }
      if (path === '/api/review') return send(200, JSON.stringify(await service.load()));
      if (path === '/api/publication/status') return send(200, JSON.stringify(await service.publicationStatus(url.searchParams.get('id'))));
      const match = path.match(/^\/rehearsals\/([0-9a-f-]{36})\/(.+)$/);
      if (match) {
        const result = await service.findResult(match[1]), file = match[2];
        if (!result || result.receipt.deleted.includes(file)) return send(404, '{}');
        if (file === 'review-package.zip') { res.setHeader('Content-Disposition', 'attachment; filename="eeams-reviewed-content.zip"'); return send(200, await readFile(join(result.directory, file)), mime(file)); }
        if (file === 'publication-check.json') return send(200, await readFile(join(result.directory, file)), mime(file));
        if (!previewPathAllowed(file)) return send(404, '{}');
        const local = result.receipt.files.some(f => f.path === file);
        let bytes = local ? await readFile(join(result.directory, file)) : await service.reader.bytes(result.receipt.baseCommit, file);
        if (file.endsWith('.html')) bytes = Buffer.from(bytes.toString('utf8').replace('<head>', '<head><meta name="robots" content="noindex,nofollow">').replace(/<title>.*?<\/title>/, '<title>사본 반영 결과 | EEAMS</title>').replace(/href="index.html(#[^"]*)?"/g, 'href="https://ewha-eeams.github.io/index.html$1" target="_blank" rel="noopener noreferrer"').replace('<main', '<div style="padding:10px;text-align:center;background:#eaf2f8;color:#175c87;font:13px system-ui">사본 반영 시험 · 운영 홈페이지는 유지됩니다. <a href="/cms-sandbox/preview/review.html">변경 확인으로 돌아가기</a></div><main'));
        return send(200, bytes, mime(file));
      }
      const file = path === '/' ? 'cms-sandbox/preview/review.html' : path.slice(1);
      if ((!file.startsWith('cms-sandbox/preview/') && !file.startsWith('assets/')) || /(?:review-server|management-service|publication-copy|publication-remote|git-snapshot-reader|jszip\.min\.cjs)/.test(file) || !/\.(?:html|mjs|js|css|json|png|jpg|webp)$/.test(file)) return send(404, '{}');
      let bytes = await readFile(join(root, file));
      if (management && file === 'cms-sandbox/preview/index.html') bytes = Buffer.from(bytes.toString('utf8').replace('<body>', '<body data-preview-source="manager">'));
      if (management && file === 'cms-sandbox/preview/review.html') bytes = Buffer.from(bytes.toString('utf8').replace('id="manager-home" href="/manage" hidden', 'id="manager-home" href="/manage"'));
      if (pageNotice && file === 'cms-sandbox/preview/review.html') {
        const notice = pageNotice.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
        bytes = Buffer.from(bytes.toString('utf8').replace('<body>', `<body><div role="note" style="position:sticky;top:0;z-index:20;padding:12px;text-align:center;background:#fff1c9;color:#624708;font:14px system-ui">${notice}</div>`));
      }
      return send(200, bytes, mime(file));
    } catch (error) { send(error.code === 'STALE_REVIEW' || error.code === 'EXPIRED_REVIEW' ? 409 : error.code === 'ENOENT' ? 404 : 400, JSON.stringify({ code: error.code || 'REVIEW_ERROR', message: error.message })); }
  });
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const root = fileURLToPath(new URL('../../', import.meta.url));
  const artifactRoot = join(root, 'cms-sandbox/rehearsals');
  const reader = new GitSnapshotReader({ directory: join(artifactRoot, '.read-cache.git'), sourceRepository: root });
  const enabled = process.argv.includes('--allow-publication');
  const identity = enabled ? Object.fromEntries(['name', 'email'].map(key => [key, execFileSync('git', ['config', `user.${key}`], { cwd: root, encoding: 'utf8' }).trim()])) : null;
  const publisher = enabled ? new ActualPublisher({ artifactRoot, sourceRepository: root, reader, identity }) : null;
  const service = createReviewService({ reader, artifactRoot, sourceRepository: root, publisher });
  const management = createManagementService({ reader, publicationEnabled: enabled });
  createReviewServer({ root, service, management }).listen(8921, '127.0.0.1', () => console.log(`EEAMS CMS manager ready at http://127.0.0.1:8921/manage — publication ${enabled ? 'enabled for reviewed content' : 'disabled'}.`));
}
