import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
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
<tr><th>Project</th><th>Purpose</th><th>Latest release</th></tr>
<tr><td>Alpha</td><td>does a thing</td><td><!-- RELEASE:alpha:START -->old<!-- RELEASE:alpha:END --></td></tr>
<tr><td>Beta</td><td>not released</td><td><!-- RELEASE:beta:START -->No release yet<!-- RELEASE:beta:END --></td></tr>
<tr><td>Bookmark Assistant</td><td>sorts</td><td><!-- RELEASE:bookmark-assistant:START -->No release yet<!-- RELEASE:bookmark-assistant:END --></td></tr>
</table>

**Writing**

<p>
<!-- PROFILE_POSTS:START -->old posts<!-- PROFILE_POSTS:END -->
</p>

[Home](https://example.com/)
`;

const RELEASES = {
  Alpha: [
    {
      tag_name: "v1.2.0",
      html_url: "https://github.com/o/Alpha/releases/tag/v1.2.0",
      published_at: "2026-10-01T00:00:00Z",
    },
    {
      tag_name: "v1.10.0",
      html_url: "https://github.com/o/Alpha/releases/tag/v1.10.0",
      published_at: "2026-09-01T00:00:00Z",
    },
    {
      tag_name: "v2.0.0",
      html_url: "https://github.com/o/Alpha/releases/tag/v2.0.0",
      published_at: "2026-10-05T00:00:00Z",
      draft: true,
    },
  ],
};

const FEED = `<rss><channel>
<item><title>Oldest</title><link>https://www.arieszhou.cn/blog/oldest</link><pubDate>Mon, 01 Jun 2026 00:00:00 GMT</pubDate></item>
<item><title><![CDATA[Tom & "Jerry"]]></title><link>https://arieszhou.com/blog/tom</link><pubDate>Mon, 03 Aug 2026 00:00:00 GMT</pubDate></item>
<item><title>Newest</title><link>https://arieszhou.com/blog/newest</link><pubDate>Mon, 05 Oct 2026 00:00:00 GMT</pubDate></item>
<item><title>Middle</title><link>https://arieszhou.com/blog/middle</link><pubDate>Mon, 07 Sep 2026 00:00:00 GMT</pubDate></item>
</channel></rss>`;

async function withServer(handler, callback) {
  const server = createServer(handler);
  await new Promise((done) => server.listen(0, "127.0.0.1", done));
  try {
    return await callback(`http://127.0.0.1:${server.address().port}`);
  } finally {
    await new Promise((done) => server.close(done));
  }
}

async function runUpdater(baseUrl, extraEnv = {}) {
  const dir = await mkdtemp(join(tmpdir(), "profile-"));
  const readmePath = join(dir, "README.md");
  const releasePath = join(dir, "bookmark-assistant-release.json");
  await writeFile(readmePath, README);
  await writeFile(
    releasePath,
    JSON.stringify({
      version: "v1.4.3",
      url: "https://bookmarkassistant.com",
      published_at: "2026-10-05T09:09:54Z",
    })
  );

  await run(process.execPath, [SCRIPT], {
    env: {
      PATH: process.env.PATH,
      README_PATH: readmePath,
      BOOKMARK_ASSISTANT_RELEASE_PATH: releasePath,
      GITHUB_API_BASE_URL: baseUrl,
      BLOG_FEED_URL: `${baseUrl}/rss.xml`,
      RELEASE_REPOS: "o/Alpha,o/Beta",
      POST_LIMIT: "3",
      ...extraEnv,
    },
  });

  return {
    readme: await readFile(readmePath, "utf8"),
    savedRelease: JSON.parse(await readFile(releasePath, "utf8")),
  };
}

test("writes each project's latest release and the newest posts", async () => {
  const { readme } = await withServer((request, response) => {
    if (request.url === "/rss.xml") {
      response.end(FEED);
      return;
    }
    const repo = request.url.match(/^\/repos\/o\/(\w+)\/releases/)?.[1];
    if (RELEASES[repo]) {
      response.end(JSON.stringify(RELEASES[repo]));
      return;
    }
    response.statusCode = 404;
    response.end("{}");
  }, runUpdater);

  assert.equal(
    readme,
    `### Hi

<table>
<tr><th>Project</th><th>Purpose</th><th>Latest release</th></tr>
<tr><td>Alpha</td><td>does a thing</td><td><!-- RELEASE:alpha:START --><a href="https://github.com/o/Alpha/releases/tag/v1.10.0">v1.10.0</a><br><sub>2026-09-01</sub><!-- RELEASE:alpha:END --></td></tr>
<tr><td>Beta</td><td>not released</td><td><!-- RELEASE:beta:START -->No release yet<!-- RELEASE:beta:END --></td></tr>
<tr><td>Bookmark Assistant</td><td>sorts</td><td><!-- RELEASE:bookmark-assistant:START --><a href="https://bookmarkassistant.com/">v1.4.3</a><br><sub>2026-10-05</sub><!-- RELEASE:bookmark-assistant:END --></td></tr>
</table>

**Writing**

<p>
<!-- PROFILE_POSTS:START --><sub>2026-10-05</sub> &nbsp; <a href="https://arieszhou.com/blog/newest">Newest</a><br>
<sub>2026-09-07</sub> &nbsp; <a href="https://arieszhou.com/blog/middle">Middle</a><br>
<sub>2026-08-03</sub> &nbsp; <a href="https://arieszhou.com/blog/tom">Tom &amp; &quot;Jerry&quot;</a><!-- PROFILE_POSTS:END -->
</p>

[Home](https://example.com/)
`
  );
});

test("keeps the previous content when the requests fail", async () => {
  const { readme } = await withServer((request, response) => {
    response.statusCode = 500;
    response.end("{}");
  }, runUpdater);

  assert.equal(
    readme,
    README.replace(
      '<!-- RELEASE:bookmark-assistant:START -->No release yet',
      '<!-- RELEASE:bookmark-assistant:START --><a href="https://bookmarkassistant.com/">v1.4.3</a><br><sub>2026-10-05</sub>'
    )
  );
});

test("clears a removed release after a successful empty response", async () => {
  const { readme } = await withServer((request, response) => {
    if (request.url === "/rss.xml") {
      response.statusCode = 500;
      response.end("{}");
      return;
    }
    response.end("[]");
  }, runUpdater);

  assert.ok(readme.includes("<!-- RELEASE:alpha:START -->No release yet<!-- RELEASE:alpha:END -->"));
  assert.ok(readme.includes("<!-- PROFILE_POSTS:START -->old posts<!-- PROFILE_POSTS:END -->"));
});

test("encodes Markdown punctuation in inline article titles", async () => {
  const { readme } = await withServer((request, response) => {
    if (request.url === "/rss.xml") {
      response.end(FEED.replace("Newest", "Use *stars* and _names_"));
      return;
    }
    response.end("[]");
  }, runUpdater);

  assert.ok(readme.includes('>Use &#42;stars&#42; and &#95;names&#95;</a>'));
});

test("labels unknown dates without inventing a publication date", async () => {
  const { readme } = await withServer((request, response) => {
    if (request.url === "/rss.xml") {
      response.end(FEED.replace(/<pubDate>[^<]*<\/pubDate>/g, "<pubDate>invalid</pubDate>"));
      return;
    }
    response.end(JSON.stringify([{
      tag_name: "v1.0.0",
      html_url: "https://github.com/o/Alpha/releases/tag/v1.0.0",
      published_at: "invalid",
    }]));
  }, runUpdater);

  assert.ok(readme.includes('>v1.0.0</a><br><sub>Date unavailable</sub>'));
  assert.ok(readme.includes('<sub>Date unavailable</sub> &nbsp; <a href='));
});

test("dispatch without a publication date keeps the date unknown", async () => {
  const { readme, savedRelease } = await withServer((request, response) => {
    response.statusCode = 500;
    response.end("{}");
  }, (baseUrl) => runUpdater(baseUrl, {
    BOOKMARK_ASSISTANT_RELEASE_PAYLOAD: JSON.stringify({ version: "v1.5.0" }),
  }));

  assert.equal(savedRelease.published_at, "");
  assert.ok(readme.includes('>v1.5.0</a><br><sub>Date unavailable</sub>'));
});

test("stores and shows a Bookmark Assistant release sent by dispatch", async () => {
  const { readme, savedRelease } = await withServer(
    (request, response) => {
      response.statusCode = 500;
      response.end("{}");
    },
    (baseUrl) =>
      runUpdater(baseUrl, {
        BOOKMARK_ASSISTANT_RELEASE_PAYLOAD: JSON.stringify({
          version: "v1.5.0",
          url: "https://bookmarkassistant.com/changelog",
          published_at: "2026-11-10T08:00:00Z",
        }),
      })
  );

  assert.deepEqual(savedRelease, {
    version: "v1.5.0",
    url: "https://bookmarkassistant.com/changelog",
    published_at: "2026-11-10T08:00:00Z",
  });
  assert.match(
    readme,
    /<!-- RELEASE:bookmark-assistant:START --><a href="https:\/\/bookmarkassistant\.com\/changelog">v1\.5\.0<\/a><br><sub>2026-11-10<\/sub><!-- RELEASE:bookmark-assistant:END -->/
  );
});
