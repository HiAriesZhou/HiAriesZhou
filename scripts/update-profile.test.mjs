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

- Alpha — does a thing<!-- RELEASE:alpha:START --> · old<!-- RELEASE:alpha:END -->
- Beta — not released<!-- RELEASE:beta:START --><!-- RELEASE:beta:END -->
- Bookmark Assistant — sorts<!-- RELEASE:bookmark-assistant:START --><!-- RELEASE:bookmark-assistant:END -->

**Writing** — <!-- PROFILE_POSTS:START -->old posts<!-- PROFILE_POSTS:END -->

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

- Alpha — does a thing<!-- RELEASE:alpha:START --> · <a href="https://github.com/o/Alpha/releases/tag/v1.10.0">v1.10.0</a><!-- RELEASE:alpha:END -->
- Beta — not released<!-- RELEASE:beta:START --><!-- RELEASE:beta:END -->
- Bookmark Assistant — sorts<!-- RELEASE:bookmark-assistant:START --> · <a href="https://bookmarkassistant.com/">v1.4.3</a><!-- RELEASE:bookmark-assistant:END -->

**Writing** — <!-- PROFILE_POSTS:START --><a href="https://arieszhou.com/blog/newest">Newest</a> · <a href="https://arieszhou.com/blog/middle">Middle</a> · <a href="https://arieszhou.com/blog/tom">Tom &amp; &quot;Jerry&quot;</a><!-- PROFILE_POSTS:END -->

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
      "<!-- RELEASE:bookmark-assistant:START -->",
      '<!-- RELEASE:bookmark-assistant:START --> · <a href="https://bookmarkassistant.com/">v1.4.3</a>'
    )
  );
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
    /<!-- RELEASE:bookmark-assistant:START --> · <a href="https:\/\/bookmarkassistant\.com\/changelog">v1\.5\.0<\/a><!-- RELEASE:bookmark-assistant:END -->/
  );
});
