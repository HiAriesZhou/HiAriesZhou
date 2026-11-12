import assert from 'node:assert/strict';
import test from 'node:test';
import { checkSnapshots, syncIssue, checkFeed } from './check-project-releases.mjs';

const snapshot = { title: 'Example', slug: 'example', releaseVersion: '1.0.0', links: { repository: 'https://github.com/example/tool' } };
const release = { tag_name: 'v1.1.0', draft: false, prerelease: false };
const response = (body, status = 200) => new Response(JSON.stringify(body), { status });
const publicRelease = async path => response(path.endsWith('/latest') ? release : { private: false });

test('reports stable release differences and normalizes a leading v', async () => {
  assert.deepEqual(await checkSnapshots([snapshot], publicRelease), [{ title: 'Example', slug: 'example', current: '1.0.0', latest: '1.1.0', url: 'https://github.com/example/tool/releases/tag/v1.1.0' }]);
  assert.deepEqual(await checkSnapshots([{ ...snapshot, releaseVersion: 'v1.1.0' }], publicRelease), []);
});

test('skips unpublished releases and public repositories without releases', async () => {
  for (const value of [{ ...release, prerelease: true }, { ...release, draft: true }, { ...release, tag_name: 'v1.0.0' }]) {
    assert.deepEqual(await checkSnapshots([snapshot], async path => response(path.endsWith('/latest') ? value : { private: false })), []);
  }
  assert.deepEqual(await checkSnapshots([snapshot], async path => path.endsWith('/latest') ? response({}, 404) : response({ private: false })), []);
});

test('encodes parentheses in release links embedded in reminder Markdown', async () => {
  const differences = await checkSnapshots([snapshot], async path =>
    response(path.endsWith('/latest') ? { ...release, tag_name: 'v1.1.0)' } : { private: false }));
  assert.equal(differences[0].url, 'https://github.com/example/tool/releases/tag/v1.1.0%29');
});

test('private repositories, API failures and malformed releases fail the check', async () => {
  for (const request of [async () => response({ private: true }), async () => response({}, 403), async () => response({}), async path => response(path.endsWith('/latest') ? {} : { private: false })]) {
    await assert.rejects(checkSnapshots([snapshot], request));
  }
});

test('validates the entire feed before contacting repositories or changing issues', async () => {
  for (const feed of [null, {}, { schemaVersion: 2, products: [snapshot] }, { schemaVersion: 1, products: [] },
    { schemaVersion: 1, products: [snapshot, { ...snapshot, links: { repository: 'https://example.com/private' } }] },
    { schemaVersion: 1, products: [{ ...snapshot, releaseVersion: '' }] },
    { schemaVersion: 1, products: [{ ...snapshot, slug: '../../other' }] },
    { schemaVersion: 1, products: [snapshot, snapshot] }]) {
    let calls = 0;
    await assert.rejects(checkFeed(async () => response(feed), async () => { calls++; return response({}); }));
    assert.equal(calls, 0);
  }
  await assert.rejects(checkFeed(async () => response({}, 503), publicRelease));
  assert.equal((await checkFeed(async () => response({ schemaVersion: 1, products: [snapshot] }), publicRelease)).length, 1);
});

test('creates, updates and closes one bot reminder without repeated identical writes', async () => {
  const calls = [];
  const request = async (path, options = {}) => { calls.push({ path, ...options }); return response({ number: 12 }); };
  const differences = await checkSnapshots([snapshot], publicRelease);
  await syncIssue('example/profile', differences, [], request);
  const created = JSON.parse(calls[0].body);
  assert.equal(calls[0].method, 'POST');
  assert.match(created.body, /1\.0\.0 → 1\.1\.0/);
  const issue = { number: 12, body: created.body, title: created.title, user: { login: 'github-actions[bot]' } };
  calls.length = 0;
  await syncIssue('example/profile', differences, [issue], request);
  assert.equal(calls.length, 0);
  await syncIssue('example/profile', [{ ...differences[0], latest: '1.2.0' }], [issue], request);
  assert.equal(calls[0].method, 'PATCH');
  calls.length = 0;
  await syncIssue('example/profile', [], [issue], request);
  assert.equal(JSON.parse(calls[0].body).state, 'closed');
  calls.length = 0;
  await syncIssue('example/profile', [], [], request);
  assert.equal(calls.length, 0);
});

test('does not change human issues or pull requests and reports write failures', async () => {
  const differences = await checkSnapshots([snapshot], publicRelease);
  await assert.rejects(syncIssue('example/profile', differences, [], async () => response({}, 403)));
  const calls = [];
  await syncIssue('example/profile', [], [
    { number: 3, body: '<!-- project-release-monitor -->', user: { login: 'human' } },
    { number: 4, body: '<!-- project-release-monitor -->', user: { login: 'github-actions[bot]' }, pull_request: {} },
  ], async (...args) => { calls.push(args); return response({}); });
  assert.equal(calls.length, 0);
});
