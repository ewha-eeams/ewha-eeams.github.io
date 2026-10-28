// This adapter writes only to a new, marked, local bare repository without remotes.
// It cannot publish to GitHub, main, Google Calendar, or Google Sheets.
import { execFileSync } from 'node:child_process';
import { readFile, writeFile, mkdir, rm, realpath } from 'node:fs/promises';
import { createHash, randomUUID } from 'node:crypto';
import { join, resolve } from 'node:path';
import { buildReview, preparePlan, assertCurrent, allowedPublishPath } from './review-model.mjs';
import { parseCsv } from './csv-parser.mjs';
import { groupRows } from './concert-model.mjs';

const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
const json = value => Buffer.from(JSON.stringify(value, null, 2) + '\n');
const shaPattern = /^[0-9a-f]{40}$/;
const refs = { baseCommit: 'refs/heads/site-copy', draftCommit: 'refs/heads/cms-copy' };
const marker = 'eeams-local-publication-copy.json';
const failure = (message, code = 'COPY_PUBLICATION_ERROR') => Object.assign(new Error(message), { code });
const formPath = path => /^cms-sandbox\/(?:forms\/[0-9]{4}-concert[1-9][0-9]*|drafts\/[0-9a-f-]{36})\.json$/i.test(path);
const syncPath = path => allowedPublishPath(path) || formPath(path) || ['.pages.yml', 'cms-sandbox/data/archive.csv', 'cms-sandbox/preview/source.json', 'cms-sandbox/preview/build-info.json'].includes(path) || /^cms-sandbox\/publications\/[0-9a-f]{64}\.json$/.test(path);

/** Advance the baseline, retaining all unselected editor content and uploaded media paths. */
export function synchronizeCms({ review, plan, files, config, buildInfo, publicCommit, digest }) {
  if (!shaPattern.test(publicCommit)) throw failure('사본 게시 저장본을 확인해 주세요.');
  if (JSON.stringify(preparePlan(review, plan.selectedIds)) !== JSON.stringify(plan)) throw failure('확인한 반영 범위가 달라졌습니다.');
  const hash = sha256(Buffer.from(plan.csv)), selected = new Map(plan.mapping.map(m => [m.cms_id, m]));
  const patches = new Map(), transformed = [], preserved = [];
  for (const file of files) {
    if (!formPath(file.path)) throw failure('공연 사본의 경로를 확인해 주세요.');
    const data = structuredClone(file.data), mapping = selected.get(data.cms_id);
    data.source_sha256 = hash;
    let path = file.path;
    if (mapping) {
      path = `cms-sandbox/forms/${mapping.publicId}.json`;
      if (path !== file.path) {
        if (files.some(f => f.path === path)) throw failure('게시 후 공연 주소가 기존 사본과 겹칩니다.');
        patches.set(file.path, null);
      }
      data.origin_id = mapping.publicId;
      data.slug = mapping.publicId.split('-')[1];
      transformed.push({ cms_id: data.cms_id, from: file.path, to: path, publicId: mapping.publicId });
    } else {
      // Preserve optional omitted fields, order, unknown fields and attachment selections.
      const before = structuredClone(file.data), after = structuredClone(data);
      delete before.source_sha256; delete after.source_sha256;
      if (JSON.stringify(before) !== JSON.stringify(after)) throw failure('미반영 초안이 변경됐습니다.');
      preserved.push({ cms_id: data.cms_id, path: file.path });
    }
    patches.set(path, json(data));
  }
  if (transformed.length !== selected.size) throw failure('반영할 공연 사본 일부가 없습니다.');
  const nextConfig = structuredClone(config);
  for (const name of ['concerts', 'concert_drafts']) {
    const collection = nextConfig.content?.find(c => c.name === name);
    const fields = collection?.fields?.filter(f => f.name === 'source_sha256');
    if (fields?.length !== 1) throw failure('새 초안의 기준 설정을 확인해 주세요.');
    fields[0].default = hash;
  }
  patches.set('.pages.yml', json(nextConfig));
  patches.set('cms-sandbox/data/archive.csv', Buffer.from(plan.csv));
  patches.set('cms-sandbox/preview/source.json', json({ schema: 1, sha256: hash, rows: plan.rows }));
  patches.set('cms-sandbox/preview/build-info.json', json({ ...buildInfo, publicBase: publicCommit, sourceRows: plan.rows.length }));
  const ledger = { schema: 1, copyOnly: true, productionPublished: false, digest, previousPublicCommit: plan.baseCommit, previousCmsCommit: plan.draftCommit, publicCommit, source_sha256: hash, mapping: plan.mapping };
  patches.set(`cms-sandbox/publications/${digest}.json`, json(ledger));
  if ([...patches.keys()].some(path => !syncPath(path))) throw failure('동기화 범위를 확인해 주세요.');
  return { patches, hash, transformed, preserved, ledger };
}

export class LocalPublicationCopy {
  constructor(directory) { this.directory = resolve(directory); }
  git(args, options = {}) {
    return execFileSync('git', ['--no-replace-objects', '--git-dir', this.directory, ...args], {
      maxBuffer: 128 * 1024 * 1024, stdio: ['pipe', 'pipe', 'pipe'],
      ...options,
      env: { ...process.env, GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: '/dev/null', GIT_TERMINAL_PROMPT: '0',
        GIT_AUTHOR_NAME: 'EEAMS CMS copy verification', GIT_AUTHOR_EMAIL: 'cms-copy@example.invalid',
        GIT_COMMITTER_NAME: 'EEAMS CMS copy verification', GIT_COMMITTER_EMAIL: 'cms-copy@example.invalid', ...options.env },
    });
  }
  async verify() {
    const data = JSON.parse(await readFile(join(this.directory, marker), 'utf8'));
    if (data.schema !== 1 || data.copyOnly !== true || data.productionPublished !== false || data.directory !== await realpath(this.directory) || this.git(['rev-parse', '--is-bare-repository'], { encoding: 'utf8' }).trim() !== 'true' || this.git(['remote'], { encoding: 'utf8' }).trim()) throw failure('외부 연결이 없는 전용 사본에서만 시험할 수 있습니다.');
    const names = this.git(['for-each-ref', '--format=%(refname)', 'refs/heads'], { encoding: 'utf8' }).trim().split('\n').filter(Boolean);
    if (names.length !== 2 || names.some(r => !Object.values(refs).includes(r))) throw failure('사본 게시 대상이 아닌 저장소입니다.');
  }
  current() { return Object.fromEntries(Object.entries(refs).map(([key, ref]) => [key, this.git(['rev-parse', '--verify', ref], { encoding: 'utf8' }).trim()])); }
  tree(commit) {
    if (!shaPattern.test(commit)) throw failure('저장본 형식을 확인해 주세요.');
    return this.git(['ls-tree', '-r', '-l', '-z', commit], { encoding: 'utf8' }).split('\0').filter(Boolean).map(line => {
      const [meta, path] = line.split('\t'), [mode, type, sha, size] = meta.trim().split(/\s+/);
      return { path, mode, type, sha, size: Number(size) };
    });
  }
  bytes(commit, path) {
    if (!shaPattern.test(commit) || path.includes('..') || /[\\\x00-\x1f]/.test(path) || path.startsWith('/')) throw failure('자료 경로를 확인해 주세요.');
    return this.git(['show', `${commit}:${path}`]);
  }
  review(at = this.current()) {
    const csv = this.bytes(at.baseCommit, 'data/archive.csv'), source = { sha256: sha256(csv), rows: parseCsv(csv.toString('utf8')) };
    const baseTree = this.tree(at.baseCommit), draftTree = this.tree(at.draftCommit);
    const files = draftTree.filter(f => f.type === 'blob' && formPath(f.path)).map(f => ({ path: f.path, data: JSON.parse(this.bytes(at.draftCommit, f.path).toString('utf8')) }));
    return { review: buildReview({ source, files, baseTree, draftTree, ...at, baseCsv: csv.toString('utf8') }), files };
  }
  async commit(parent, patches, message, allowed) {
    const index = join(this.directory, `copy-index-${randomUUID()}`), env = { GIT_INDEX_FILE: index };
    try {
      this.git(['read-tree', parent], { env });
      for (const [path, bytes] of patches) {
        if (!allowed(path)) throw failure('허용되지 않은 파일 변경입니다.');
        if (bytes === null) this.git(['update-index', '--index-info'], { env, input: `0 ${'0'.repeat(40)}\t${path}\n` });
        else {
          const blob = this.git(['hash-object', '-w', '--stdin'], { input: bytes, encoding: 'utf8' }).trim();
          this.git(['update-index', '--add', '--cacheinfo', '100644', blob, path], { env });
        }
      }
      const tree = this.git(['write-tree'], { env, encoding: 'utf8' }).trim();
      const commit = this.git(['commit-tree', tree, '-p', parent], { input: message + '\n', encoding: 'utf8' }).trim();
      const changed = this.git(['diff-tree', '--no-commit-id', '--name-only', '-r', parent, commit], { encoding: 'utf8' }).trim().split('\n').filter(Boolean);
      if (changed.some(p => !allowed(p) || !patches.has(p))) throw failure('준비한 변경 밖의 파일이 포함됐습니다.');
      return commit;
    } finally { await rm(index, { force: true }); await rm(index + '.lock', { force: true }); }
  }
  async publish(plan, digest, { fault = async () => {} } = {}) {
    await this.verify();
    if (!/^[0-9a-f]{64}$/.test(digest) || sha256(JSON.stringify(plan)) !== digest) throw failure('확인한 변경 내용과 요청이 다릅니다.');
    const journalPath = join(this.directory, 'publication-result.json');
    let journal;
    try { journal = JSON.parse(await readFile(journalPath, 'utf8')); } catch (e) { if (e.code !== 'ENOENT') throw e; }
    if (journal && journal.digest !== digest) throw failure('다른 검증에 사용한 사본입니다. 새 사본에서 다시 확인해 주세요.');
    const current = this.current();
    if (journal && current.baseCommit === journal.publicCommit && current.draftCommit === journal.cmsCommit) {
      await this.checkResult(journal);
      return { ...journal, repeated: true };
    }
    assertCurrent(plan, current);
    if (!journal) {
      const { review, files } = this.review(current);
      if (JSON.stringify(preparePlan(review, plan.selectedIds)) !== JSON.stringify(plan)) throw failure('준비한 자료와 사본 내용이 다릅니다.');
      const publicPatches = new Map();
      for (const op of plan.operations) {
        if (op.path === 'data/archive.csv') publicPatches.set(op.path, Buffer.from(plan.csv));
        else if (op.action === 'delete') publicPatches.set(op.path, null);
        else {
          const bytes = this.bytes(plan.draftCommit, op.sourcePath);
          const blob = createHash('sha1').update(`blob ${bytes.length}\0`).update(bytes).digest('hex');
          if (bytes.length !== op.size || blob !== op.sha || (op.path.endsWith('.pdf') ? bytes.subarray(0, 5).toString() !== '%PDF-' : bytes[0] !== 0xff || bytes[1] !== 0xd8)) throw failure('확인한 첨부 자료와 다릅니다.');
          publicPatches.set(op.path, bytes);
        }
      }
      const publicCommit = await this.commit(plan.baseCommit, publicPatches, `Copy publication ${digest}`, allowedPublishPath);
      const sync = synchronizeCms({ review, plan, files, config: JSON.parse(this.bytes(plan.draftCommit, '.pages.yml')), buildInfo: JSON.parse(this.bytes(plan.draftCommit, 'cms-sandbox/preview/build-info.json')), publicCommit, digest });
      // Keep the trial branch's public mirror consistent without merging the trial into the site.
      for (const patch of publicPatches) sync.patches.set(...patch);
      const cmsCommit = await this.commit(plan.draftCommit, sync.patches, `Copy CMS synchronization ${digest}`, syncPath);
      const next = this.review({ baseCommit: publicCommit, draftCommit: cmsCommit });
      const selected = next.review.entries.filter(e => plan.selectedIds.includes(e.cms_id));
      if (selected.length !== plan.selectedIds.length || selected.some(e => e.status !== 'unchanged' || !e.existing)) throw failure('게시한 공연의 CMS 동기화를 확인하지 못했습니다.');
      for (const old of review.entries.filter(e => !plan.selectedIds.includes(e.cms_id))) {
        const after = next.review.entries.find(e => e.cms_id === old.cms_id);
        if (!after || old.status !== after.status) throw failure('미반영 초안의 변경 상태가 달라졌습니다.');
      }
      journal = { schema: 1, copyOnly: true, productionPublished: false, digest, baseCommit: plan.baseCommit, draftCommit: plan.draftCommit,
        publicCommit, cmsCommit, mapping: plan.mapping, transformed: sync.transformed, preserved: sync.preserved,
        selectedUnchanged: selected.length, remainingChanges: next.review.entries.filter(e => e.status !== 'unchanged').length,
        source_sha256: sync.hash, publicFiles: [...publicPatches.keys()], cmsFiles: [...sync.patches.keys()],
        concerts: groupRows(plan.rows).length, workRows: plan.rows.length };
      const pending = journalPath + '.pending'; await writeFile(pending, json(journal));
      const { rename } = await import('node:fs/promises'); await rename(pending, journalPath);
    }
    await this.checkResult(journal);
    await fault('before-transaction', this, journal);
    // Git locks and checks BOTH old refs before moving either one.
    try {
      this.git(['update-ref', '--stdin'], { input: `start\nupdate ${refs.baseCommit} ${journal.publicCommit} ${plan.baseCommit}\nupdate ${refs.draftCommit} ${journal.cmsCommit} ${plan.draftCommit}\nprepare\ncommit\n`, encoding: 'utf8' });
    } catch { throw failure('게시 사본 또는 CMS 사본이 바뀌었습니다. 어느 쪽도 이번 변경으로 반영하지 않았습니다.', 'STALE_REVIEW'); }
    await fault('after-transaction', this, journal);
    return { ...journal, repeated: false };
  }
  async checkResult(result) {
    if (result.schema !== 1 || result.copyOnly !== true || result.productionPublished !== false || ![result.publicCommit, result.cmsCommit, result.baseCommit, result.draftCommit].every(s => shaPattern.test(s || ''))) throw failure('사본 검증 기록을 확인해 주세요.');
    if (this.git(['rev-parse', `${result.publicCommit}^`], { encoding: 'utf8' }).trim() !== result.baseCommit || this.git(['rev-parse', `${result.cmsCommit}^`], { encoding: 'utf8' }).trim() !== result.draftCommit) throw failure('사본 변경 이력을 확인해 주세요.');
    const ledger = JSON.parse(this.bytes(result.cmsCommit, `cms-sandbox/publications/${result.digest}.json`));
    if (ledger.digest !== result.digest || ledger.publicCommit !== result.publicCommit) throw failure('CMS 동기화 기록이 다릅니다.');
    if (sha256(this.bytes(result.publicCommit, 'data/archive.csv')) !== result.source_sha256) throw failure('게시 사본 자료가 다릅니다.');
  }
}

export async function createLocalPublicationCopy({ directory, sourceRepository, baseCommit, draftCommit }) {
  if (![baseCommit, draftCommit].every(s => shaPattern.test(s || ''))) throw failure('복사할 저장본을 확인해 주세요.');
  const source = await realpath(sourceRepository), target = resolve(directory);
  if (target === source || source.startsWith(target + '/')) throw failure('원본과 분리된 새 사본이 필요합니다.');
  // A fresh directory and no remote make a mistaken production write impossible here.
  await mkdir(target);
  const store = new LocalPublicationCopy(target);
  try {
    execFileSync('git', ['init', '--bare', '--quiet', target], { stdio: 'pipe' });
    store.git(['-c', 'protocol.file.allow=always', 'fetch', '--quiet', '--no-tags', '--no-write-fetch-head', source, baseCommit, draftCommit]);
    store.git(['update-ref', refs.baseCommit, baseCommit]); store.git(['update-ref', refs.draftCommit, draftCommit]);
    await writeFile(join(target, marker), json({ schema: 1, copyOnly: true, productionPublished: false, directory: await realpath(target) }));
    await store.verify(); return store;
  } catch (error) { await rm(target, { recursive: true, force: true }); throw error; }
}
