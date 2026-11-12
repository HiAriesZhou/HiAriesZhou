import { pathToFileURL } from 'node:url';

const feedUrl = 'https://www.arieszhou.com/products.json';
const marker = '<!-- project-release-monitor -->';
const title = 'Review public product release snapshots';
const repositoryPattern = /^https:\/\/github\.com\/([\w.-]+\/[\w.-]+)\/?$/;
const normalizeVersion = value => value.replace(/^v/, '');
const plainText = value => String(value).replace(/[\r\n]/g, ' ').replace(/[\\`*_\[\]<>]/g, character => `\\${character}`);

async function json(response, context) {
  if (!response.ok) throw new Error(`${context}: HTTP ${response.status}`);
  return response.json();
}

export async function checkFeed(fetchFeed, request) {
  const feed = await json(await fetchFeed(), 'Portfolio product feed');
  if (feed?.schemaVersion !== 1 || !Array.isArray(feed.products) || feed.products.length === 0) {
    throw new Error('Invalid or empty portfolio product feed');
  }
  const slugs = new Set();
  for (const product of feed.products) {
    if (!product || typeof product.slug !== 'string' || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(product.slug)
      || typeof product.title !== 'string' || !product.title.trim()
      || typeof product.releaseVersion !== 'string' || !product.releaseVersion.trim()
      || typeof product.links?.repository !== 'string' || !repositoryPattern.test(product.links.repository)
      || slugs.has(product.slug)) {
      throw new Error('Invalid product in portfolio feed');
    }
    slugs.add(product.slug);
  }
  return checkSnapshots(feed.products, request);
}

export async function checkSnapshots(snapshots, request) {
  const results = await Promise.all(snapshots.map(async snapshot => {
    const match = snapshot.links.repository.match(repositoryPattern);
    if (!match) throw new Error(`Invalid public repository for ${snapshot.slug}`);
    const repository = match[1];
    const metadata = await json(await request(`/repos/${repository}`), repository);
    if (metadata.private !== false) throw new Error(`Public repository required for ${snapshot.slug}`);
    const response = await request(`/repos/${repository}/releases/latest`);
    if (response.status === 404) return [];
    const release = await json(response, `${repository} release`);
    if (typeof release.tag_name !== 'string' || !release.tag_name.trim()
      || typeof release.draft !== 'boolean' || typeof release.prerelease !== 'boolean') {
      throw new Error(`Invalid release response for ${snapshot.slug}`);
    }
    if (release.draft || release.prerelease) return [];
    const latest = normalizeVersion(release.tag_name);
    if (normalizeVersion(snapshot.releaseVersion) === latest) return [];
    return [{ title: snapshot.title, slug: snapshot.slug, current: snapshot.releaseVersion, latest,
      url: `https://github.com/${repository}/releases/tag/${encodeURIComponent(release.tag_name)}` }];
  }));
  return results.flat();
}

export async function syncIssue(repository, differences, issues, request) {
  const issue = issues.find(entry => !entry.pull_request && entry.user?.login === 'github-actions[bot]' && entry.body?.startsWith(marker));
  if (differences.length === 0) {
    if (issue) await json(await request(`/repos/${repository}/issues/${issue.number}`, {
      method: 'PATCH', body: JSON.stringify({ state: 'closed', state_reason: 'completed' }),
    }), 'Close release reminder');
    return;
  }
  const body = `${marker}\nPublic releases differ from the reviewed [portfolio](${feedUrl}). Review each release and README, then update the portfolio's bilingual product snapshots. A GitHub release does not establish browser-store availability.\n\n${differences.map(item => `- **${plainText(item.title)}**: ${plainText(item.current)} → ${plainText(item.latest)}. [Release](${item.url}).`).join('\n')}\n\nThis reminder does not edit snapshots. It updates when differences change and closes after a successful check finds none.\n`;
  if (issue?.body === body && issue.title === title) return;
  const path = `/repos/${repository}/issues${issue ? `/${issue.number}` : ''}`;
  await json(await request(path, { method: issue ? 'PATCH' : 'POST', body: JSON.stringify({ title, body }) }), 'Save release reminder');
}

async function listIssues(repository, request) {
  const result = [];
  for (let page = 1; ; page += 1) {
    const issues = await json(await request(`/repos/${repository}/issues?state=open&per_page=100&page=${page}`), 'List release reminders');
    if (!Array.isArray(issues)) throw new Error('Invalid issue list');
    result.push(...issues);
    if (issues.length < 100) return result;
  }
}

async function main() {
  const headers = { Accept: 'application/vnd.github+json', 'User-Agent': 'product-release-monitor', 'X-GitHub-Api-Version': '2022-11-28' };
  const publicRequest = path => fetch(`https://api.github.com${path}`, { headers, signal: AbortSignal.timeout(30_000) });
  const differences = await checkFeed(() => fetch(feedUrl, { signal: AbortSignal.timeout(30_000) }), publicRequest);
  process.stdout.write(`${JSON.stringify({ differences }, null, 2)}\n`);
  if (!process.argv.includes('--write')) return;
  const repository = process.env.GITHUB_REPOSITORY;
  const token = process.env.GITHUB_TOKEN;
  if (!repository?.match(/^[\w.-]+\/[\w.-]+$/) || !token) throw new Error('GITHUB_REPOSITORY and GITHUB_TOKEN are required for --write');
  const request = (path, options = {}) => fetch(`https://api.github.com${path}`, {
    ...options, headers: { ...headers, Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, signal: AbortSignal.timeout(30_000),
  });
  await syncIssue(repository, differences, await listIssues(repository, request), request);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch(error => { process.stderr.write(`${error.message}\n`); process.exitCode = 1; });
}
