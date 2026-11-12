import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const run = promisify(execFile);
const SCRIPT = fileURLToPath(new URL("./update-profile.mjs", import.meta.url));
const README = `### Hi
<table>
<tr><td>Alpha</td><td><!-- RELEASE:alpha:START -->old<!-- RELEASE:alpha:END --></td></tr>
<tr><td>Beta</td><td><!-- RELEASE:beta:START -->No release yet<!-- RELEASE:beta:END --></td></tr>
<tr><td>TMD</td><td><!-- RELEASE:tmd:START -->old<!-- RELEASE:tmd:END --></td></tr>
<tr><td>Bookmark Assistant</td><td><!-- RELEASE:bookmark-assistant:START -->No release yet<!-- RELEASE:bookmark-assistant:END --></td></tr>
</table>
<p><!-- PROFILE_POSTS:START -->old posts<!-- PROFILE_POSTS:END --></p>
[Home](https://example.com/)
`;
const RELEASES = [
  { tag_name: "v1.2.0", html_url: "https://github.com/o/Alpha/releases/tag/v1.2.0", published_at: "2026-10-01T00:00:00Z" },
  { tag_name: "v1.10.0", html_url: "https://github.com/o/Alpha/releases/tag/v1.10.0", published_at: "2026-09-01T00:00:00Z" },
  { tag_name: "v2.0.0", html_url: "https://github.com/o/Alpha/releases/tag/v2.0.0", published_at: "2026-10-05T00:00:00Z", draft: true },
];
const FEED = `<rss><channel>
<item><title>Oldest</title><link>https://www.arieszhou.cn/blog/oldest</link><pubDate>Mon, 01 Jun 2026 00:00:00 GMT</pubDate></item>
<item><title><![CDATA[Tom & "Jerry"]]></title><link>https://arieszhou.com/blog/tom</link><pubDate>Mon, 03 Aug 2026 00:00:00 GMT</pubDate></item>
<item><title>Newest</title><link>https://arieszhou.com/blog/newest</link><pubDate>Mon, 05 Oct 2026 00:00:00 GMT</pubDate></item>
<item><title>Middle</title><link>https://arieszhou.com/blog/middle</link><pubDate>Mon, 07 Sep 2026 00:00:00 GMT</pubDate></item>
</channel></rss>`;

async function fixture(t, { releaseStatus = 200, feedStatus = 200, releases = RELEASES, feed = FEED, extraEnv = {} } = {}) {
  const dir = await mkdtemp(join(tmpdir(), "profile-sync-"));
  const readmePath = join(dir, "README.md");
  const releasePath = join(dir, "bookmark.json");
  const requests = [];
  await writeFile(readmePath, README);
  await writeFile(releasePath, JSON.stringify({ version: "v1.4.3", url: "https://bookmarkassistant.com", published_at: "2026-10-05T09:09:54Z" }));
  const server = createServer((request, response) => {
    requests.push(request.url);
    const isFeed = request.url === "/rss.xml";
    response.statusCode = isFeed ? feedStatus : releaseStatus;
    response.end(isFeed ? feed : JSON.stringify(request.url.includes("/Beta/") ? [] : releases));
  });
  await new Promise(done => server.listen(0, "127.0.0.1", done));
  t.after(async () => {
    await new Promise(done => server.close(done));
    await rm(dir, { recursive: true, force: true });
  });
  const base = `http://127.0.0.1:${server.address().port}`;
  return {
    requests,
    readme: () => readFile(readmePath, "utf8"),
    savedRelease: async () => JSON.parse(await readFile(releasePath, "utf8")),
    run: async () => {
      try {
        return { ...await run(process.execPath, [SCRIPT], { env: {
          PATH: process.env.PATH, README_PATH: readmePath,
          BOOKMARK_ASSISTANT_RELEASE_PATH: releasePath,
          GITHUB_API_BASE_URL: base, BLOG_FEED_URL: `${base}/rss.xml`,
          RELEASE_REPOS: "o/Alpha,o/Beta", ...extraEnv,
        } }), code: 0 };
      } catch (error) {
        return error;
      }
    },
  };
}
const section = (text, key) => text.split(`<!-- ${key}:START -->`)[1].split(`<!-- ${key}:END -->`)[0];

test("writes each project's latest release, dates and three posts without altering static content", async t => {
  const context = await fixture(t);
  assert.equal((await context.run()).code, 0);
  const readme = await context.readme();
  assert.equal(section(readme, "RELEASE:alpha"), '<a href="https://github.com/o/Alpha/releases/tag/v1.10.0">v1.10.0</a><br><sub>2026-09-01</sub>');
  assert.equal(section(readme, "RELEASE:beta"), "No release yet");
  assert.equal(section(readme, "RELEASE:bookmark-assistant"), '<a href="https://bookmarkassistant.com/">v1.4.3</a><br><sub>2026-10-05</sub>');
  assert.equal(section(readme, "PROFILE_POSTS"), '<sub>2026-10-05</sub> &nbsp; <a href="https://arieszhou.com/blog/newest">Newest</a><br>\n<sub>2026-09-07</sub> &nbsp; <a href="https://arieszhou.com/blog/middle">Middle</a><br>\n<sub>2026-08-03</sub> &nbsp; <a href="https://arieszhou.com/blog/tom">Tom &amp; &quot;Jerry&quot;</a>');
  assert.ok(readme.startsWith("### Hi\n<table>"));
  assert.ok(readme.endsWith("[Home](https://example.com/)\n"));
  assert.equal((await context.run()).code, 0);
  assert.equal(await context.readme(), readme);
});

test("defaults include TMD and preserve the existing release sources", async t => {
  const context = await fixture(t, { extraEnv: { RELEASE_REPOS: "" } });
  assert.equal((await context.run()).code, 0);
  assert.deepEqual(context.requests.filter(url => url !== "/rss.xml").map(url => url.split("/")[3]).sort(),
    ["xtoc", "litecontext", "DashBye", "Hairpin", "Howler", "TMD"].sort());
  assert.match(section(await context.readme(), "RELEASE:tmd"), /v1\.10\.0/);
});

for (const status of [404, 500]) {
  test(`GitHub ${status} preserves project versions and fails despite cached Bookmark Assistant`, async t => {
    const context = await fixture(t, { releaseStatus: status });
    const result = await context.run();
    assert.equal(result.code, 1);
    assert.match(result.stderr, new RegExp(`GitHub releases request failed.*${status}`));
    assert.equal(section(await context.readme(), "RELEASE:alpha"), "old");
    assert.match(section(await context.readme(), "RELEASE:bookmark-assistant"), /v1\.4\.3/);
  });
}

test("RSS failure preserves posts and reports failure", async t => {
  const context = await fixture(t, { feedStatus: 503 });
  const result = await context.run();
  assert.equal(result.code, 1);
  assert.match(result.stderr, /Blog feed request failed: 503/);
  assert.equal(section(await context.readme(), "PROFILE_POSTS"), "old posts");
});

test("clears a removed release after a successful empty response", async t => {
  const context = await fixture(t, { releases: [] });
  assert.equal((await context.run()).code, 0);
  assert.equal(section(await context.readme(), "RELEASE:alpha"), "No release yet");
});

test("encodes Markdown punctuation in inline article titles", async t => {
  const context = await fixture(t, { feed: FEED.replace("Newest", "Use *stars* and _names_") });
  assert.equal((await context.run()).code, 0);
  assert.ok((await context.readme()).includes('>Use &#42;stars&#42; and &#95;names&#95;</a>'));
});

test("labels unknown dates without inventing a publication date", async t => {
  const context = await fixture(t, {
    feed: FEED.replace(/<pubDate>[^<]*<\/pubDate>/g, "<pubDate>invalid</pubDate>"),
    releases: [{ tag_name: "v1.0.0", html_url: "https://github.com/o/Alpha/releases/tag/v1.0.0", published_at: "invalid" }],
  });
  assert.equal((await context.run()).code, 0);
  assert.match(section(await context.readme(), "RELEASE:alpha"), /<sub>Date unavailable<\/sub>/);
  assert.match(section(await context.readme(), "PROFILE_POSTS"), /<sub>Date unavailable<\/sub>/);
});

for (const publishedAt of ["", "2026-11-10T08:00:00Z"]) {
  test(`dispatch stores the supplied release and ${publishedAt ? "date" : "unknown date"}`, async t => {
    const context = await fixture(t, { extraEnv: { BOOKMARK_ASSISTANT_RELEASE_PAYLOAD: JSON.stringify({
      version: "v1.5.0", url: "https://bookmarkassistant.com/changelog", ...(publishedAt ? { published_at: publishedAt } : {}),
    }) } });
    assert.equal((await context.run()).code, 0);
    assert.deepEqual(await context.savedRelease(), { version: "v1.5.0", url: "https://bookmarkassistant.com/changelog", published_at: publishedAt });
    assert.equal(section(await context.readme(), "RELEASE:bookmark-assistant"), `<a href="https://bookmarkassistant.com/changelog">v1.5.0</a><br><sub>${publishedAt ? "2026-11-10" : "Date unavailable"}</sub>`);
  });
}
