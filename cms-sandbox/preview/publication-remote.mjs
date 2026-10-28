import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { readFile, writeFile, rename } from 'node:fs/promises';
import { createHash, randomUUID } from 'node:crypto';
import { join, resolve } from 'node:path';
import { createLocalPublicationCopy, LocalPublicationCopy, synchronizeCms, allowedCmsSyncPath } from './publication-copy.mjs';
import { preparePlan, assertCurrent, allowedPublishPath } from './review-model.mjs';
import { branch, uuidPattern } from './preview-model.mjs';

const run = promisify(execFile), hash = bytes => createHash('sha256').update(bytes).digest('hex');
const serialize = value => JSON.stringify(value, null, 2) + '\n';
const fail = (message, code = 'PUBLICATION_ERROR') => Object.assign(new Error(message), { code });
const shaPattern = /^[0-9a-f]{40}$/;
const targets = { baseCommit: 'refs/heads/main', draftCommit: `refs/heads/${branch}` };
const remote = 'git@github.com:ewha-eeams/ewha-eeams.github.io.git';
const ttl = 30 * 60 * 1000;
const same = (a, b) => a.baseCommit === b.baseCommit && a.draftCommit === b.draftCommit;
const nextRefs = c => ({ baseCommit: c.publicCommit, draftCommit: c.cmsCommit });
const oldRefs = c => ({ baseCommit: c.baseCommit, draftCommit: c.draftCommit });
const sealFor = c => hash(JSON.stringify({ planDigest: c.planDigest, baseCommit: c.baseCommit, draftCommit: c.draftCommit, publicCommit: c.publicCommit, cmsCommit: c.cmsCommit, publicFiles: c.publicFiles, cmsFiles: c.cmsFiles, mapping: c.mapping }));

/** Fixed two-reference atomic transport. Production URL cannot come from a browser request. */
class AtomicTransport {
  constructor(store, url) { this.store = store; this.url = url; }
  async git(args) {
    const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith('GIT_')));
    try {
      return (await run('git', ['--no-replace-objects', '--git-dir', this.store.directory, ...args], {
        timeout: 60000, maxBuffer: 1024 * 1024, encoding: 'utf8',
        env: { ...env, GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: '/dev/null', GIT_TERMINAL_PROMPT: '0', GIT_SSH_COMMAND: 'ssh -o BatchMode=yes' },
      })).stdout;
    } catch { throw fail('게시 연결을 확인하지 못했습니다. 현재 저장 상태를 확인한 뒤 다시 진행해 주세요.', 'TRANSPORT_ERROR'); }
  }
  async refs() {
    const text = await this.git(['ls-remote', '--refs', this.url, ...Object.values(targets)]);
    const found = new Map(text.trim().split('\n').map(line => { const [sha, ref] = line.split(/\s+/); return [ref, sha]; }));
    const value = Object.fromEntries(Object.entries(targets).map(([key, ref]) => [key, found.get(ref)]));
    if (!Object.values(value).every(s => shaPattern.test(s || ''))) throw fail('운영 홈페이지와 CMS 저장본을 확인하지 못했습니다.');
    return value;
  }
  async send(candidate, dryRun = false) {
    const args = ['push', '--atomic', '--porcelain',
      `--force-with-lease=${targets.baseCommit}:${candidate.baseCommit}`, `--force-with-lease=${targets.draftCommit}:${candidate.draftCommit}`,
      ...(dryRun ? ['--dry-run'] : []), this.url, `${candidate.publicCommit}:${targets.baseCommit}`, `${candidate.cmsCommit}:${targets.draftCommit}`];
    return this.git(args);
  }
}
export const githubTransport = store => new AtomicTransport(store, remote);
export async function localTestTransport(store, directory) {
  const path = resolve(directory), marker = JSON.parse(await readFile(join(path, 'eeams-publication-test.json'), 'utf8'));
  if (marker.testOnly !== true) throw fail('지정된 시험 저장소가 아닙니다.');
  return new AtomicTransport(store, path);
}

async function atomicJson(path, value) {
  const temporary = path + '.' + randomUUID() + '.pending';
  await writeFile(temporary, serialize(value)); await rename(temporary, path);
}

async function prepareCommits(store, plan, digest) {
  await store.verify(); assertCurrent(plan, store.current());
  const { review, files } = store.review();
  if (hash(JSON.stringify(plan)) !== digest || JSON.stringify(preparePlan(review, plan.selectedIds)) !== JSON.stringify(plan)) throw fail('확인한 반영 내용이 달라졌습니다.');
  const changes = new Map();
  for (const op of plan.operations) {
    if (!allowedPublishPath(op.path)) throw fail('공연 콘텐츠 외의 파일이 포함됐습니다.');
    if (op.path === 'data/archive.csv') changes.set(op.path, Buffer.from(plan.csv));
    else if (op.action === 'delete') changes.set(op.path, null);
    else {
      const bytes = store.bytes(plan.draftCommit, op.sourcePath);
      const sha = createHash('sha1').update(`blob ${bytes.length}\0`).update(bytes).digest('hex');
      if (sha !== op.sha || bytes.length !== op.size || (op.path.endsWith('.pdf') ? bytes.subarray(0, 5).toString() !== '%PDF-' : bytes[0] !== 0xff || bytes[1] !== 0xd8)) throw fail('첨부 자료의 내용이나 형식이 달라졌습니다.');
      changes.set(op.path, bytes);
    }
  }
  const titles = plan.mapping.map(m => m.title).join(', ');
  const publicCommit = await store.commit(plan.baseCommit, changes, `Publish reviewed concerts: ${titles}`, allowedPublishPath);
  const sync = synchronizeCms({ review, plan, files, config: JSON.parse(store.bytes(plan.draftCommit, '.pages.yml')), buildInfo: JSON.parse(store.bytes(plan.draftCommit, 'cms-sandbox/preview/build-info.json')), publicCommit, digest, publicationRecord: true });
  for (const [path, bytes] of changes) sync.patches.set(path, bytes);
  const cmsCommit = await store.commit(plan.draftCommit, sync.patches, `Synchronize CMS after concert publication ${publicCommit.slice(0, 12)}`, allowedCmsSyncPath);
  const after = store.review({ baseCommit: publicCommit, draftCommit: cmsCommit });
  for (const entry of after.review.entries) {
    const before = review.entries.find(e => e.cms_id === entry.cms_id);
    if (plan.selectedIds.includes(entry.cms_id) ? entry.status !== 'unchanged' || !entry.existing : !before || before.status !== entry.status) throw fail('게시 후 CMS 기준이나 미반영 초안을 확인하지 못했습니다.');
  }
  const candidate = { schema: 1, status: 'prepared', productionPublished: false, planDigest: digest, baseCommit: plan.baseCommit, draftCommit: plan.draftCommit,
    publicCommit, cmsCommit, mapping: plan.mapping, publicFiles: [...changes.keys()], cmsFiles: [...sync.patches.keys()],
    source_sha256: sync.hash, selectedSynced: plan.mapping.length, remainingChanges: after.review.entries.filter(e => e.status !== 'unchanged').length, created: Date.now() };
  candidate.seal = sealFor(candidate); return candidate;
}

function validateCandidate(store, candidate, plan) {
  if (candidate.schema !== 1 || candidate.productionPublished !== false || ![candidate.publicCommit, candidate.cmsCommit, candidate.baseCommit, candidate.draftCommit].every(s => shaPattern.test(s || '')) || candidate.seal !== sealFor(candidate) || candidate.planDigest !== hash(JSON.stringify(plan)) || candidate.baseCommit !== plan.baseCommit || candidate.draftCommit !== plan.draftCommit) throw fail('게시 확인 기록이 다릅니다.');
  if (store.git(['rev-parse', `${candidate.publicCommit}^`], { encoding: 'utf8' }).trim() !== candidate.baseCommit || store.git(['rev-parse', `${candidate.cmsCommit}^`], { encoding: 'utf8' }).trim() !== candidate.draftCommit) throw fail('게시 기준 이력이 다릅니다.');
  const changed = (before, after) => store.git(['diff-tree', '--no-commit-id', '--name-only', '-r', before, after], { encoding: 'utf8' }).trim().split('\n').filter(Boolean).sort();
  if (JSON.stringify(changed(candidate.baseCommit, candidate.publicCommit)) !== JSON.stringify([...candidate.publicFiles].sort()) || candidate.publicFiles.some(p => !allowedPublishPath(p)) || changed(candidate.draftCommit, candidate.cmsCommit).some(p => !allowedCmsSyncPath(p) || !candidate.cmsFiles.includes(p))) throw fail('확인한 콘텐츠 밖의 변경이 포함됐습니다.');
  const csv = store.bytes(candidate.publicCommit, 'data/archive.csv');
  if (hash(csv) !== candidate.source_sha256 || !csv.equals(Buffer.from(plan.csv))) throw fail('게시할 공연 정보가 달라졌습니다.');
  const blobs = new Map(store.tree(candidate.publicCommit).map(f => [f.path, f]));
  if (JSON.stringify([...candidate.publicFiles].sort()) !== JSON.stringify(plan.operations.map(o => o.path).sort())) throw fail('반영 파일 범위가 다릅니다.');
  for (const op of plan.operations.filter(o => o.path !== 'data/archive.csv')) {
    const blob = blobs.get(op.path);
    if (op.action === 'delete' ? !!blob : !blob || blob.sha !== op.sha || blob.size !== op.size) throw fail('게시 후보의 첨부 자료가 다릅니다.');
  }
  const ledger = JSON.parse(store.bytes(candidate.cmsCommit, `cms-sandbox/publications/${candidate.planDigest}.json`));
  if (ledger.kind !== 'paired-publication' || ledger.digest !== candidate.planDigest || ledger.publicCommit !== candidate.publicCommit) throw fail('CMS 동기화 기록이 다릅니다.');
}

/** Prepare locally, then atomically update only main + the existing CMS branch. */
export class ActualPublisher {
  constructor({ artifactRoot, sourceRepository, reader, identity, transportFactory = githubTransport, fault = async () => {} }) {
    Object.assign(this, { artifactRoot, sourceRepository, reader, identity, transportFactory, fault }); this.active = new Set();
  }
  paths(id) {
    if (!uuidPattern.test(id || '')) throw fail('게시 기록 식별자를 확인해 주세요.');
    const root = join(this.artifactRoot, id);
    return { directory: join(root, 'actual-publication.git'), candidate: join(root, 'prepared-publication.json'), plan: join(root, 'prepared-plan.json'), completed: join(root, 'published.json') };
  }
  async record(id) {
    const paths = this.paths(id), candidate = JSON.parse(await readFile(paths.candidate, 'utf8')), plan = JSON.parse(await readFile(paths.plan, 'utf8'));
    const store = new LocalPublicationCopy(paths.directory, { identity: this.identity }); await store.verify(); validateCandidate(store, candidate, plan);
    return { paths, candidate, plan, store, transport: await this.transportFactory(store) };
  }
  async prepare({ id, plan, digest }) {
    if (hash(JSON.stringify(plan)) !== digest) throw fail('확인한 반영 내용이 다릅니다.');
    const paths = this.paths(id);
    let store;
    try { store = await createLocalPublicationCopy({ directory: paths.directory, sourceRepository: this.reader.copySource || this.sourceRepository, baseCommit: plan.baseCommit, draftCommit: plan.draftCommit, identity: this.identity }); }
    catch (error) { if (error.code !== 'EEXIST') throw error; store = new LocalPublicationCopy(paths.directory, { identity: this.identity }); }
    const transport = await this.transportFactory(store); assertCurrent(plan, await transport.refs());
    let candidate;
    try { candidate = JSON.parse(await readFile(paths.candidate, 'utf8')); }
    catch (error) { if (error.code !== 'ENOENT') throw error; }
    if (!candidate) {
      candidate = await prepareCommits(store, plan, digest);
      await atomicJson(paths.plan, plan); await atomicJson(paths.candidate, candidate);
    }
    validateCandidate(store, candidate, plan);
    if (Date.now() - candidate.created > ttl) throw fail('게시 확인 시간이 지났습니다. 변경 내용을 다시 불러와 주세요.', 'EXPIRED_REVIEW');
    await transport.send(candidate, true); assertCurrent(plan, await transport.refs());
    return { id, seal: candidate.seal, status: 'ready', mapping: candidate.mapping, publicFiles: candidate.publicFiles, productionPublished: false, requiresConfirmation: true };
  }
  async completed(record, id, repeated = false) {
    const { candidate, paths } = record;
    const receipt = { ...candidate, id, status: 'published', productionPublished: true, confirmedAt: new Date().toISOString(), repeated };
    await atomicJson(paths.completed, receipt); return receipt;
  }
  async status(id) {
    const record = await this.record(id);
    try {
      const done = JSON.parse(await readFile(record.paths.completed, 'utf8'));
      if (done.seal !== record.candidate.seal || done.status !== 'published' || done.productionPublished !== true) throw fail('게시 완료 기록이 다릅니다.');
      return done;
    } catch (error) { if (error.code !== 'ENOENT') throw error; }
    const refs = await record.transport.refs();
    if (same(refs, nextRefs(record.candidate))) return this.completed(record, id, true);
    if (same(refs, oldRefs(record.candidate))) return { id, status: 'not-published', productionPublished: false };
    return { id, status: 'changed', productionPublished: null, message: '저장본이 달라졌습니다. 게시 기록과 최신 변경을 확인해 주세요.' };
  }
  async apply({ id, seal, confirmed }) {
    if (confirmed !== true) throw fail('실제 공개 반영 범위를 확인해 주세요.');
    if (this.active.has(id)) throw fail('게시 결과를 확인하는 중입니다. 잠시 기다려 주세요.');
    this.active.add(id);
    try {
      const record = await this.record(id), { candidate, transport } = record;
      if (seal !== candidate.seal) throw fail('승인한 게시 내용과 다릅니다.');
      const previous = await this.status(id);
      if (previous.status === 'published') return { ...previous, repeated: true };
      if (previous.status !== 'not-published') throw fail(previous.message, 'STALE_REVIEW');
      if (Date.now() - candidate.created > ttl) throw fail('게시 확인 시간이 지났습니다. 변경 내용을 다시 불러와 주세요.', 'EXPIRED_REVIEW');
      await this.fault('before-send', record);
      let sent = false;
      try { await transport.send(candidate); sent = true; await this.fault('after-send', record); }
      catch { /* A lost reply is resolved by reading the actual two refs, never by blind replay. */ }
      let refs;
      try { refs = await transport.refs(); }
      catch { throw fail('게시 결과를 아직 확인하지 못했습니다. 같은 화면의 게시 상태 확인을 이용해 주세요.', 'PUBLICATION_UNKNOWN'); }
      if (same(refs, nextRefs(candidate))) return this.completed(record, id);
      if (!same(refs, oldRefs(candidate))) throw fail('게시 중 저장본이 달라졌습니다. 최신 상태를 확인해 주세요.', 'STALE_REVIEW');
      throw fail(sent ? '반영 결과를 확인하지 못했습니다. 게시 상태를 다시 확인해 주세요.' : '게시가 적용되지 않았습니다. 기존 홈페이지와 CMS 상태는 유지됩니다.', sent ? 'PUBLICATION_UNKNOWN' : 'PUBLICATION_NOT_APPLIED');
    } finally { this.active.delete(id); }
  }
}
