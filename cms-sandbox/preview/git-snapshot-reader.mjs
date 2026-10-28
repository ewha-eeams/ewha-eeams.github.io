// Read a fixed public repository through Git transport; no credentials and no remote writes.
// The cache is disposable and separate from both the checkout and publication copies.
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { repository, branch } from './preview-model.mjs';
const run = promisify(execFile), shaPattern = /^[0-9a-f]{40}$/;
const remote = `https://github.com/${repository}.git`;
export class GitSnapshotReader {
  constructor({ directory, sourceRepository }) { this.directory = resolve(directory); this.copySource = this.directory; this.sourceRepository = resolve(sourceRepository); this.trees = new Map(); }
  async command(args, options = {}) {
    const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith('GIT_')));
    return (await run('git', ['--no-replace-objects', '--git-dir', this.directory, '-c', 'credential.helper=', ...args], {
      encoding: 'buffer', timeout: 60000, maxBuffer: 32 * 1024 * 1024, ...options,
      env: { ...env, GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: '/dev/null', GIT_TERMINAL_PROMPT: '0' },
    })).stdout;
  }
  async ready() {
    if (!this.initializing) this.initializing = (async () => {
      await mkdir(this.directory, { recursive: true });
      await run('git', ['init', '--bare', '--quiet', this.directory]);
      // Seed existing objects locally, without modifying the source checkout.
      await this.command(['-c', 'protocol.file.allow=always', 'fetch', '--quiet', '--no-tags', '--no-write-fetch-head', this.sourceRepository, 'HEAD', 'refs/remotes/origin/main']);
    })().catch(error => { this.initializing = null; throw error; });
    await this.initializing;
  }
  async refs() {
    await this.ready();
    try {
      const text = (await this.command(['ls-remote', '--refs', remote, 'refs/heads/main', `refs/heads/${branch}`])).toString('utf8');
      const found = new Map(text.trim().split('\n').map(line => { const [sha, ref] = line.split(/\s+/); return [ref, sha]; }));
      const result = { baseCommit: found.get('refs/heads/main'), draftCommit: found.get(`refs/heads/${branch}`) };
      if (!Object.values(result).every(s => shaPattern.test(s || ''))) throw new Error('공개 저장본과 CMS 저장본을 확인하지 못했습니다.');
      for (const sha of new Set(Object.values(result))) {
        try { await this.command(['cat-file', '-e', `${sha}^{commit}`]); }
        catch { await this.command(['fetch', '--quiet', '--no-tags', '--no-write-fetch-head', remote, sha]); }
      }
      return result;
    } catch { throw new Error('GitHub 저장본 연결을 확인하지 못했습니다. 잠시 후 다시 불러와 주세요.'); }
  }
  async tree(commit) {
    if (!shaPattern.test(commit)) throw new Error('저장본 형식을 확인해 주세요.');
    if (!this.trees.has(commit)) {
      const text = (await this.command(['ls-tree', '-r', '-l', '-z', commit])).toString('utf8');
      this.trees.set(commit, text.split('\0').filter(Boolean).map(line => {
        const [meta, path] = line.split('\t'), [mode, type, sha, size] = meta.trim().split(/\s+/);
        return { path, mode, type, sha, size: Number(size) };
      }));
    }
    return this.trees.get(commit);
  }
  async bytes(commit, path) {
    const file = (await this.tree(commit)).find(f => f.path === path && f.type === 'blob');
    if (!file) throw Object.assign(new Error(`파일을 찾지 못했습니다: ${path}`), { code: 'ENOENT' });
    if (file.mode !== '100644' || file.size > 20 * 1024 * 1024) throw new Error('자료 형식이나 크기를 확인해 주세요.');
    const bytes = await this.command(['cat-file', 'blob', file.sha]);
    if (bytes.length !== file.size) throw new Error('저장된 자료의 크기가 다릅니다.');
    return bytes;
  }
}
