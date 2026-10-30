import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';

const official = 'https://github.com/ares-emulator/ares.git';

function fixture(t) {
  const root = mkdtempSync(join(tmpdir(), 'ares-upstream-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const repo = join(root, 'fork');
  const source = join(root, 'source');
  mkdirSync(repo);
  const env = { ...process.env, GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: '/dev/null', GIT_TERMINAL_PROMPT: '0', GIT_MERGE_AUTOEDIT: 'no' };
  function git(cwd, ...args) {
    const result = spawnSync('git', args, { cwd, env, encoding: 'utf8' });
    assert.equal(result.status, 0, result.stderr);
    return result.stdout.trim();
  }
  git(repo, 'init', '-b', 'main');
  git(repo, 'config', 'user.name', 'Test');
  git(repo, 'config', 'user.email', 'test@example.com');
  mkdirSync(join(repo, 'scripts'));
  copyFileSync(new URL('../pull-upstream.sh', import.meta.url), join(repo, 'scripts/pull-upstream.sh'));
  writeFileSync(join(repo, 'core.txt'), 'base\n');
  git(repo, 'add', '.');
  git(repo, 'commit', '-m', 'Base');
  git(root, 'clone', '-b', 'main', repo, source);
  git(source, 'config', 'user.name', 'Test');
  git(source, 'config', 'user.email', 'test@example.com');
  git(source, 'checkout', '-b', 'master');
  writeFileSync(join(source, 'core.txt'), 'upstream\n');
  git(source, 'commit', '-am', 'Upstream update');
  git(repo, 'config', `url.${source}.insteadOf`, official);
  const run = (...args) => spawnSync('bash', ['scripts/pull-upstream.sh', ...args], { cwd: repo, env, encoding: 'utf8' });
  return { repo, source, git, run };
}

test('creates upstream and merges master; repeated runs succeed', (t) => {
  const { repo, git, run } = fixture(t);
  const result = run();
  assert.equal(result.status, 0, result.stderr);
  assert.equal(git(repo, 'config', '--get', 'remote.upstream.url'), official);
  assert.equal(readFileSync(join(repo, 'core.txt'), 'utf8'), 'upstream\n');
  assert.equal(run().status, 0);
});

test('rejects an unrelated upstream without changing it or merging', (t) => {
  const { repo, git, run } = fixture(t);
  git(repo, 'remote', 'add', 'upstream', 'https://github.com/example/ares.git');
  const before = git(repo, 'rev-parse', 'HEAD');
  assert.match(run().stderr, /expected ares-emulator\/ares/);
  assert.equal(git(repo, 'remote', 'get-url', 'upstream'), 'https://github.com/example/ares.git');
  assert.equal(git(repo, 'rev-parse', 'HEAD'), before);
});

test('rejects untracked changes before adding a remote', (t) => {
  const { repo, git, run } = fixture(t);
  writeFileSync(join(repo, 'untracked.txt'), 'work');
  assert.match(run().stderr, /Commit or stash/);
  assert.equal(git(repo, 'remote'), '');
});

test('supports another upstream branch and preserves an SSH remote', (t) => {
  const { repo, source, git, run } = fixture(t);
  const ssh = 'git@github.com:ares-emulator/ares.git';
  git(repo, 'config', `url.${source}.insteadOf`, ssh);
  git(repo, 'remote', 'add', 'upstream', ssh);
  assert.equal(run('main').status, 0);
  assert.equal(git(repo, 'config', '--get', 'remote.upstream.url'), ssh);
  assert.equal(readFileSync(join(repo, 'core.txt'), 'utf8'), 'base\n');
});

test('leaves conflicts for review and supports aborting', (t) => {
  const { repo, git, run } = fixture(t);
  writeFileSync(join(repo, 'core.txt'), 'fork\n');
  git(repo, 'commit', '-am', 'Fork update');
  const result = run();
  assert.equal(result.status, 1);
  assert.match(result.stderr, /git merge --continue/);
  assert.equal(git(repo, 'diff', '--name-only', '--diff-filter=U'), 'core.txt');
  git(repo, 'merge', '--abort');
  assert.equal(readFileSync(join(repo, 'core.txt'), 'utf8'), 'fork\n');
});

test('fetch failures do not merge stale FETCH_HEAD', (t) => {
  const { repo, git, run } = fixture(t);
  assert.equal(run().status, 0);
  const before = git(repo, 'rev-parse', 'HEAD');
  assert.notEqual(run('missing-branch').status, 0);
  assert.equal(git(repo, 'rev-parse', 'HEAD'), before);
});

for (const mixed of [false, true]) {
  test(`preserves intentional deletions${mixed ? ' while leaving active conflicts' : ' and completes merge'}`, (t) => {
    const { repo, source, git, run } = fixture(t);
    // Create a shared retired file, then delete it only in the fork.
    git(source, 'checkout', 'main');
    mkdirSync(join(source, 'desktop-ui', 'presentation'), { recursive: true });
    writeFileSync(join(source, 'desktop-ui', 'presentation', 'old window.cpp'), 'base\n');
    git(source, 'add', '.');
    git(source, 'commit', '-m', 'Shared desktop file');
    git(repo, 'fetch', source, 'main');
    git(repo, 'merge', '--ff-only', 'FETCH_HEAD');
    git(repo, 'rm', 'desktop-ui/presentation/old window.cpp');
    if (mixed) writeFileSync(join(repo, 'core.txt'), 'fork\n');
    git(repo, 'commit', '-am', 'Retire desktop');
    writeFileSync(join(source, 'desktop-ui', 'presentation', 'old window.cpp'), 'upstream\n');
    writeFileSync(join(source, 'core.txt'), 'upstream\n');
    git(source, 'commit', '-am', 'Upstream changes');
    const result = run('main');
    assert.equal(result.status, mixed ? 1 : 0, result.stderr);
    assert.match(result.stdout, /Preserved intentional deletion/);
    assert.equal(git(repo, 'ls-files', 'desktop-ui/presentation/old window.cpp'), '');
    assert.equal(git(repo, 'diff', '--name-only', '--diff-filter=U'), mixed ? 'core.txt' : '');
    if (mixed) git(repo, 'merge', '--abort');
    else assert.equal(git(repo, 'rev-list', '--parents', '-n', '1', 'HEAD').split(' ').length, 3);
  });
}

test('keeps active desktop sources conflicted and imports new runtime files in place', (t) => {
  const { repo, source, git, run } = fixture(t);
  git(source, 'checkout', 'main');
  mkdirSync(join(source, 'desktop-ui', 'input'), { recursive: true });
  const active = 'desktop-ui/input/input.cpp';
  writeFileSync(join(source, active), 'base\n');
  git(source, 'add', '.');
  git(source, 'commit', '-m', 'Shared runtime');
  git(repo, 'fetch', source, 'main');
  git(repo, 'merge', '--ff-only', 'FETCH_HEAD');
  writeFileSync(join(repo, active), 'fork\n');
  git(repo, 'commit', '-am', 'Adapt runtime');
  writeFileSync(join(source, active), 'upstream\n');
  writeFileSync(join(source, 'desktop-ui/input/game-input.hpp'), 'new helper\n');
  git(source, 'add', '.');
  git(source, 'commit', '-m', 'Update runtime');
  assert.equal(run('main').status, 1);
  assert.equal(git(repo, 'diff', '--name-only', '--diff-filter=U'), active);
  assert.equal(readFileSync(join(repo, 'desktop-ui/input/game-input.hpp'), 'utf8'), 'new helper\n');
  git(repo, 'merge', '--abort');
});
