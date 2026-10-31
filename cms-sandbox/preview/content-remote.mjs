// Additional-content publishing is separate from the concert publisher and disabled by default.
// Candidate construction and proof checks run in marked local copies. Only the inherited,
// fixed two-ref transport can send a reviewed pair after explicit confirmation.
import { createHash } from 'node:crypto';
import { readFile, writeFile, mkdir, rename } from 'node:fs/promises';
import { join } from 'node:path';
import { ActualPublisher } from './publication-remote.mjs';
import { LocalPublicationCopy, createLocalPublicationCopy } from './publication-copy.mjs';
import { ContentPublicationCopy, prepareContentPlan, allowedContentPublicPath } from './content-copy.mjs';
import { contentTypes, originKey } from './content-model.mjs';
import { assertCurrent } from './review-model.mjs';
import { uuidPattern } from './preview-model.mjs';

const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const json = value => Buffer.from(JSON.stringify(value, null, 2) + '\n');
const fail = (message, code = 'CONTENT_PUBLICATION_ERROR') => Object.assign(new Error(message), { code });
const mirror = path => 'cms-sandbox/media/education/' + path.slice('assets/media/education/'.length);
const ledgerPath = (digest, mode) => `cms-sandbox/content-publications/${mode === 'actual' ? 'actual/' : ''}${digest}.json`;
const sealFor = candidate => hash(JSON.stringify(candidate));
const sealValid = candidate => { const { seal, ...value } = candidate; return seal === sealFor(value); };
const changedPaths = (store, parent, child) => store.git(['diff-tree', '--no-commit-id', '--name-only', '-r', '-z', parent, child], { encoding: 'utf8' }).split('\0').filter(Boolean).sort();

function checkedInput(store, plan, digest) {
  if (!Object.hasOwn(contentTypes, plan?.kind) || hash(JSON.stringify(plan)) !== digest) throw fail('확인한 자료 종류나 변경 내용이 다릅니다.');
  const input = new ContentPublicationCopy(store).read(plan.kind, plan);
  if (JSON.stringify(prepareContentPlan(input)) !== JSON.stringify(plan)) throw fail('검토 이후 자료나 변경 범위가 달라졌습니다.');
  return input;
}

// Exact byte expectations, not just a broad path whitelist. Unchanged files in a patch
// do not appear in a Git diff, so diff expectations are calculated against each parent.
function expectedPair(store, plan, digest, publicCommit, mode) {
  const input = checkedInput(store, plan, digest);
  const publicPatches = new Map([[`data/${plan.kind}.csv`, Buffer.from(plan.csv)]]), cmsMedia = new Map();
  for (const op of plan.operations) {
    if (!allowedContentPublicPath(plan.kind, op.path) || !['add', 'reuse'].includes(op.action)) throw fail('선택한 자료 밖의 파일이 포함됐습니다.');
    const bytes = store.bytes(plan.draftCommit, op.sourcePath);
    const blob = createHash('sha1').update(`blob ${bytes.length}\0`).update(bytes).digest('hex');
    if (bytes.length !== op.size || blob !== op.sha) throw fail('확인한 첨부 자료와 다릅니다.');
    if (op.action === 'add') publicPatches.set(op.path, bytes);
    cmsMedia.set(mirror(op.path), bytes);
  }
  const form = structuredClone(input.form); form.source_sha256 = hash(plan.csv);
  form.records = form.records.map((record, index) => {
    const next = { ...record, origin_key: originKey(plan.kind, index) };
    if (plan.kind === 'education') {
      next.slug = plan.rows[index].slug;
      if (plan.rows[index].materials) next.materials = '/' + mirror(plan.rows[index].materials);
    }
    return next;
  });
  const ledger = { schema: 1, copyOnly: mode !== 'actual',
    ...(mode === 'actual' ? { publicationType: 'paired-content-publication' } : { productionPublished: false }),
    kind: plan.kind, digest, previousPublicCommit: plan.baseCommit, previousCmsCommit: plan.draftCommit,
    publicCommit, source_sha256: form.source_sha256, mapping: plan.mapping };
  const cmsPatches = new Map([...publicPatches, ...cmsMedia,
    [`cms-sandbox/content/${plan.kind}.json`, json(form)], [ledgerPath(digest, mode), json(ledger)]]);
  return { publicPatches, cmsPatches, ledger };
}

function checkPatches(store, parent, child, patches) {
  const tree = new Map(store.tree(parent).map(file => [file.path, file]));
  const expected = [];
  for (const [path, bytes] of patches) {
    if (tree.has(path) && tree.get(path).mode === '100644' && store.bytes(parent, path).equals(bytes)) continue;
    expected.push(path);
  }
  if (JSON.stringify(changedPaths(store, parent, child)) !== JSON.stringify(expected.sort())) throw fail('검토한 범위 밖의 변경이 포함됐습니다.');
  const after = new Map(store.tree(child).map(file => [file.path, file]));
  for (const [path, bytes] of patches) if (after.get(path)?.mode !== '100644' || !store.bytes(child, path).equals(bytes)) throw fail('게시 후보의 내용이나 첨부가 다릅니다.');
}

export async function validateContentPair(store, pair, plan, digest, mode = 'actual') {
  await store.verify();
  if (!['copy', 'actual'].includes(mode) || pair.schema !== 1 || pair.kind !== plan.kind || pair.digest !== digest ||
      pair.copyOnly !== (mode === 'copy') || pair.productionPublished !== false ||
      pair.previousPublicCommit !== plan.baseCommit || pair.previousCmsCommit !== plan.draftCommit ||
      ![pair.publicCommit, pair.cmsCommit, plan.baseCommit, plan.draftCommit].every(sha => /^[0-9a-f]{40}$/.test(sha || ''))) throw fail('게시·동기화 확인 기록이 다릅니다.');
  for (const [parent, child] of [[plan.baseCommit, pair.publicCommit], [plan.draftCommit, pair.cmsCommit]]) {
    if (store.git(['rev-list', '--parents', '-n', '1', child], { encoding: 'utf8' }).trim() !== `${child} ${parent}`) throw fail('확인한 저장 이력과 다릅니다.');
  }
  const expected = expectedPair(store, plan, digest, pair.publicCommit, mode);
  checkPatches(store, plan.baseCommit, pair.publicCommit, expected.publicPatches);
  checkPatches(store, plan.draftCommit, pair.cmsCommit, expected.cmsPatches);
  if (JSON.stringify([...expected.publicPatches.keys()]) !== JSON.stringify(pair.publicFiles) ||
      JSON.stringify([...expected.cmsPatches.keys()]) !== JSON.stringify(pair.cmsFiles) || pair.source_sha256 !== expected.ledger.source_sha256) throw fail('게시 파일 목록이나 CMS 기준이 다릅니다.');
  const after = new ContentPublicationCopy(store).snapshot(plan.kind, { baseCommit: pair.publicCommit, draftCommit: pair.cmsCommit });
  if (after.changes.length || pair.remainingChanges !== 0 || pair.records !== after.rows.length) throw fail('게시 뒤 CMS 기준 갱신을 확인하지 못했습니다.');
  return expected;
}

export class ActualContentPublisher extends ActualPublisher {
  paths(id) {
    if (!uuidPattern.test(id || '')) throw fail('게시 확인 주소를 확인해 주세요.');
    const root = join(this.artifactRoot, 'content-publication', id);
    return { root, directory: join(root, 'candidate.git'), candidate: join(root, 'prepared.json'), plan: join(root, 'plan.json'), completed: join(root, 'published.json') };
  }
  async record(id) {
    const paths = this.paths(id), candidate = JSON.parse(await readFile(paths.candidate, 'utf8')), plan = JSON.parse(await readFile(paths.plan, 'utf8'));
    const store = new LocalPublicationCopy(paths.directory, { identity: this.identity });
    if (!sealValid(candidate) || candidate.planDigest !== hash(JSON.stringify(plan)) || candidate.baseCommit !== plan.baseCommit || candidate.draftCommit !== plan.draftCommit) throw fail('게시 확인 기록이 달라졌습니다.');
    await validateContentPair(store, candidate, plan, candidate.planDigest);
    return { paths, candidate, plan, store, transport: await this.transportFactory(store) };
  }
  async prepare({ id, plan, digest, proof }) {
    if (this.active.has(id)) throw fail('게시 연결을 확인하는 중입니다.');
    this.active.add(id);
    try {
      // proof is loaded by the server from a completed local copy, never from HTTP JSON.
      if (!proof?.directory || !proof.report) throw fail('같은 내용의 사본 게시·동기화를 먼저 확인해 주세요.');
      const verified = new LocalPublicationCopy(proof.directory);
      await validateContentPair(verified, proof.report, plan, digest, 'copy');
      assertCurrent({ baseCommit: proof.report.publicCommit, draftCommit: proof.report.cmsCommit }, verified.current());
      assertCurrent(plan, await this.reader.refs());
      const paths = this.paths(id); await mkdir(paths.root, { recursive: true });
      let store;
      try { store = await createLocalPublicationCopy({ directory: paths.directory, sourceRepository: this.reader.copySource || this.sourceRepository, baseCommit: plan.baseCommit, draftCommit: plan.draftCommit, identity: this.identity }); }
      catch (error) { if (error.code !== 'EEXIST') throw error; store = new LocalPublicationCopy(paths.directory, { identity: this.identity }); }
      const transport = await this.transportFactory(store); assertCurrent(plan, await transport.refs());
      let candidate;
      try { candidate = JSON.parse(await readFile(paths.candidate, 'utf8')); } catch (error) { if (error.code !== 'ENOENT') throw error; }
      if (!candidate) {
        // The copy publisher cannot contact a remote. Rebuild and validate the exact
        // proof here, then replace its copy ledger with a distinct production ledger.
        const report = await new ContentPublicationCopy(store).publish(plan, digest);
        await validateContentPair(store, report, plan, digest, 'copy');
        const publicPatches = expectedPair(store, plan, digest, report.publicCommit, 'actual').publicPatches;
        const publicCommit = await store.commit(plan.baseCommit, publicPatches, `Publish reviewed ${plan.kind} content`, path => allowedContentPublicPath(plan.kind, path));
        const expected = expectedPair(store, plan, digest, publicCommit, 'actual');
        const cmsCommit = await store.commit(plan.draftCommit, expected.cmsPatches, `Synchronize reviewed ${plan.kind} after publication ${publicCommit.slice(0, 12)}`, path => expected.cmsPatches.has(path));
        candidate = { schema: 1, status: 'prepared', copyOnly: false, productionPublished: false, kind: plan.kind,
          digest, planDigest: digest, proofId: id, previousPublicCommit: plan.baseCommit, previousCmsCommit: plan.draftCommit,
          baseCommit: plan.baseCommit, draftCommit: plan.draftCommit, publicCommit, cmsCommit,
          publicFiles: [...expected.publicPatches.keys()], cmsFiles: [...expected.cmsPatches.keys()],
          mapping: plan.mapping, changes: plan.changes, records: plan.rows.length, remainingChanges: 0,
          preservedKinds: Object.keys(contentTypes).filter(kind => kind !== plan.kind), source_sha256: expected.ledger.source_sha256, created: Date.now() };
        candidate.seal = sealFor(candidate);
        await writeFile(paths.plan + '.pending', json(plan)); await rename(paths.plan + '.pending', paths.plan);
        await writeFile(paths.candidate + '.pending', json(candidate)); await rename(paths.candidate + '.pending', paths.candidate);
      }
      await this.record(id);
      if (Date.now() - candidate.created > 30 * 60 * 1000) throw fail('게시 확인 시간이 지났습니다. 변경 내용을 다시 확인해 주세요.', 'EXPIRED_REVIEW');
      await transport.send(candidate, true);
      assertCurrent(plan, await transport.refs()); assertCurrent(plan, await this.reader.refs());
      return { id, seal: candidate.seal, status: 'ready', kind: plan.kind, records: candidate.records,
        changes: candidate.changes, publicFiles: candidate.publicFiles, cmsFiles: candidate.cmsFiles,
        productionPublished: false, requiresConfirmation: true };
    } finally { this.active.delete(id); }
  }
}
