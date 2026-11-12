import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { pathToFileURL } from "node:url";

const README_PATH = process.env.README_PATH
  ? pathToFileURL(resolve(process.env.README_PATH))
  : new URL("../README.md", import.meta.url);
const REQUEST_TIMEOUT_MS = 30_000;
const POSTS_MARKER = "PROFILE_POSTS";
const BOOKMARK_ASSISTANT_KEY = "bookmark-assistant";
const REQUEST_TIMEOUT_MS = 30_000;

const config = {
  releaseRepos: parseReleaseRepos(
    process.env.RELEASE_REPOS ||
    "HiAriesZhou/xtoc,HiAriesZhou/litecontext,HiAriesZhou/DashBye,HiAriesZhou/Hairpin,HiAriesZhou/Howler,HiAriesZhou/TMD"
  ),
  blogFeedUrl:
    process.env.BLOG_FEED_URL || "https://arieszhou.com/rss.en.xml",
  postLimit: Number(process.env.POST_LIMIT || 3),
  titleMaxLength: Number(process.env.TITLE_MAX_LENGTH || 60),
  githubApiBaseUrl: process.env.GITHUB_API_BASE_URL || "https://api.github.com",
  bookmarkAssistantReleasePath: resolve(
    process.env.BOOKMARK_ASSISTANT_RELEASE_PATH ||
    "data/bookmark-assistant-release.json"
  ),
};

const token = process.env.GITHUB_TOKEN;
const readme = await readFile(README_PATH, "utf8");
const bookmarkAssistantRelease = await loadBookmarkAssistantRelease();

const [releaseResult, postResult] = await Promise.allSettled([
  getReleases(config.releaseRepos, config.githubApiBaseUrl),
  getPosts(config.blogFeedUrl, config.postLimit),
]);

const updateFailed =
  releaseResult.status === "rejected" || postResult.status === "rejected";
const releases = [
  ...(bookmarkAssistantRelease ? [bookmarkAssistantRelease] : []),
  ...valueOrWarn("releases", releaseResult, []),
];
const posts = valueOrWarn("posts", postResult, null);
const updateFailed =
  releaseResult.status === "rejected" || postResult.status === "rejected";

const withReleases = releases.reduce(
  (text, release) =>
    replaceMarked(text, `RELEASE:${release.key}`, renderRelease(release)),
  readme
);
const nextReadme =
  posts && posts.length > 0
    ? replaceMarked(withReleases, POSTS_MARKER, renderPosts(posts))
    : withReleases;

if (nextReadme !== readme) {
  await writeFile(README_PATH, nextReadme);
}

if (updateFailed) {
  process.exitCode = 1;
}

async function loadBookmarkAssistantRelease() {
  const payloadRelease = parseBookmarkAssistantRelease(
    process.env.BOOKMARK_ASSISTANT_RELEASE_PAYLOAD
  );

  if (payloadRelease) {
    await mkdir(dirname(config.bookmarkAssistantReleasePath), {
      recursive: true,
    });
    await writeFile(
      config.bookmarkAssistantReleasePath,
      `${JSON.stringify(
        {
          version: payloadRelease.version,
          url: payloadRelease.url,
          published_at: payloadRelease.publishedAt,
        },
        null,
        2
      )}\n`
    );
    return payloadRelease;
  }

  try {
    const raw = await readFile(config.bookmarkAssistantReleasePath, "utf8");
    return parseBookmarkAssistantRelease(raw);
  } catch (error) {
    if (error?.code === "ENOENT") {
      return null;
    }
    throw error;
  }
}

function parseBookmarkAssistantRelease(value) {
  const text = String(value || "").trim();
  if (!text || text === "null" || text === "{}") {
    return null;
  }

  let payload;
  try {
    payload = JSON.parse(text);
  } catch {
    return null;
  }

  const version = cleanText(payload.version);
  if (!version) {
    return null;
  }

  const publishedAt = cleanText(payload.published_at);

  return {
    key: BOOKMARK_ASSISTANT_KEY,
    version,
    url: publicUrl(payload.url) || "https://bookmarkassistant.com/",
    date: formatDate(publishedAt),
    publishedAt,
  };
}

function parseReleaseRepos(value) {
  return value
    .split(",")
    .map((repo) => repo.trim())
    .filter(Boolean)
    .map((fullName) => {
      const [owner, repo] = fullName.split("/");
      if (!owner || !repo) {
        throw new Error(`Invalid repo in RELEASE_REPOS: ${fullName}`);
      }
      return { owner, repo };
    });
}

async function getReleases(repos, githubApiBaseUrl) {
  const releases = await Promise.all(
    repos.map(async ({ owner, repo }) => {
      const url = `${githubApiBaseUrl}/repos/${owner}/${repo}/releases?per_page=10`;
      const response = await fetch(url, {
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
        headers: {
          Accept: "application/vnd.github+json",
          "User-Agent": "Aries-0331-profile-updater",
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
      });

      if (!response.ok) {
        throw new Error(
          `GitHub releases request failed for ${owner}/${repo}: ${response.status}`
        );
      }

      const releases = await response.json();

      const latestRelease = releases
        .filter((release) => !release.draft)
        .sort(compareReleases)[0];

      if (!latestRelease) {
        return { key: repo.toLowerCase(), version: "" };
      }

      return {
        key: repo.toLowerCase(),
        version: releaseLabel(latestRelease),
        url: latestRelease.html_url,
        date: formatDate(latestRelease.published_at || latestRelease.created_at),
      };
    })
  );

  return releases.filter(Boolean);
}

async function getPosts(feedUrl, limit) {
  const response = await fetch(feedUrl, {
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    headers: {
      Accept:
        "application/rss+xml, application/atom+xml, application/xml, text/xml",
      "User-Agent": "Aries-0331-profile-updater",
    },
  });

  if (!response.ok) {
    throw new Error(`Blog feed request failed: ${response.status}`);
  }

  const xml = await response.text();
  const entries = matchAll(
    xml,
    /<item\b[\s\S]*?<\/item>|<entry\b[\s\S]*?<\/entry>/gi
  );

  return entries
    .map((entry) => {
      const isAtom = /^<entry\b/i.test(entry);
      const title = textContent(entry, "title");
      const url = isAtom ? atomLink(entry) : textContent(entry, "link");
      const rawDate =
        textContent(entry, "pubDate") ||
        textContent(entry, "published") ||
        textContent(entry, "updated");

      if (!title || !url) {
        return null;
      }

      return {
        title,
        url: normalizeBlogUrl(url),
        date: formatDate(rawDate),
        sortDate: rawDate || "",
      };
    })
    .filter(Boolean)
    .sort((a, b) => new Date(b.sortDate) - new Date(a.sortDate))
    .slice(0, limit);
}

function matchAll(value, pattern) {
  return Array.from(value.matchAll(pattern), (match) => match[0]);
}

function textContent(xml, tag) {
  const match = xml.match(
    new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`, "i")
  );
  if (!match) {
    return "";
  }

  return decodeXml(
    match[1]
      .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
      .replace(/<[^>]+>/g, "")
  ).trim();
}

function atomLink(xml) {
  const alternate = xml.match(
    /<link[^>]+rel=["']alternate["'][^>]+href=["']([^"']+)["'][^>]*>/i
  );
  const anyLink = xml.match(/<link[^>]+href=["']([^"']+)["'][^>]*>/i);
  return decodeXml((alternate || anyLink || [])[1] || "");
}

function decodeXml(value) {
  return value
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#39;/g, "'");
}

function formatDate(value) {
  if (!value) {
    return "";
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "";
  }

  return date.toISOString().slice(0, 10);
}

function compareReleases(a, b) {
  const versionOrder = compareSemver(releaseVersion(b), releaseVersion(a));

  if (versionOrder !== 0) {
    return versionOrder;
  }

  return (
    new Date(b.published_at || b.created_at) -
    new Date(a.published_at || a.created_at)
  );
}

function releaseVersion(release) {
  return parseSemver(release.tag_name) || parseSemver(release.name);
}

function parseSemver(value) {
  const match = String(value || "").match(
    /^v?(\d+)\.(\d+)\.(\d+)(?:[-+].*)?$/i
  );
  if (!match) {
    return null;
  }

  return match.slice(1).map(Number);
}

function compareSemver(a, b) {
  if (!a && !b) {
    return 0;
  }

  if (!a) {
    return -1;
  }

  if (!b) {
    return 1;
  }

  for (let index = 0; index < 3; index += 1) {
    if (a[index] !== b[index]) {
      return a[index] - b[index];
    }
  }

  return 0;
}

function valueOrWarn(label, result, fallback) {
  if (result.status === "fulfilled") {
    return result.value;
  }

  console.warn(
    `Warning: keeping previous ${label} content because update failed: ${errorMessage(
      result.reason
    )}`
  );
  return fallback;
}

function errorMessage(error) {
  return error?.stack || error?.message || String(error);
}

function renderRelease(release) {
  if (!release.version) {
    return "No release yet";
  }

  const version = escapeHtml(release.version);
  const versionHtml = release.url
    ? `<a href="${escapeHtml(release.url)}">${version}</a>`
    : version;
  const date = release.date || "Date unavailable";
  return `${versionHtml}<br><sub>${escapeHtml(date)}</sub>`;
}

function renderPosts(posts) {
  return posts
    .map((post) => {
      const title = escapeHtml(truncateMiddle(post.title, config.titleMaxLength))
        .replace(/[\\`*_~\[\]]/g, (character) => `&#${character.charCodeAt(0)};`);
      const date = escapeHtml(post.date || "Date unavailable");
      return `<sub>${date}</sub> &nbsp; <a href="${escapeHtml(post.url)}">${title}</a>`;
    })
    .join("<br>\n");
}

function releaseLabel(release) {
  const version = String(release.tag_name || "").trim();
  if (version) {
    return version.startsWith("v") ? version : `v${version}`;
  }

  const name = String(release.name || "").trim();
  const match = name.match(/v?\d+\.\d+\.\d+(?:[-+][\w.-]+)?/i);
  return match ? (match[0].startsWith("v") ? match[0] : `v${match[0]}`) : name;
}

function truncateMiddle(value, maxLength) {
  const text = String(value).trim();
  if (
    !Number.isFinite(maxLength) ||
    maxLength <= 0 ||
    text.length <= maxLength
  ) {
    return text;
  }

  if (maxLength <= 3) {
    return ".".repeat(maxLength);
  }

  const edgeLength = Math.floor((maxLength - 3) / 2);
  const headLength = maxLength - 3 - edgeLength;
  return `${text.slice(0, headLength)}...${text.slice(
    text.length - edgeLength
  )}`;
}

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function cleanText(value) {
  return sanitizePublicText(String(value || "").replace(/\s+/g, " ").trim());
}

function publicUrl(value) {
  try {
    const url = new URL(String(value || "").trim());
    return ["http:", "https:"].includes(url.protocol) ? url.toString() : "";
  } catch {
    return "";
  }
}

function normalizeBlogUrl(value) {
  const url = publicUrl(value);
  if (!url) {
    return "";
  }

  const parsed = new URL(url);
  if (
    parsed.hostname === "arieszhou.cn" ||
    parsed.hostname === "www.arieszhou.cn"
  ) {
    parsed.hostname = "arieszhou.com";
  }

  return parsed.toString();
}

function sanitizePublicText(value) {
  return value
    .replace(/\bhttps?:\/\/\S+/gi, "[redacted-url]")
    .replace(/\b(?:ssh:\/\/|git@)\S+/gi, "[redacted-url]")
    .replace(
      /\b(?:secret|token|password|api[_-]?key|authorization)\s*[:=]\s*\S+/gi,
      "[redacted-secret]"
    )
    .replace(
      /\b(?:artifact|log|logs|workspace|database|page)[_-]?(?:url|path|id)?\s*[:=]\s*\S+/gi,
      "[redacted-detail]"
    )
    .replace(/\b[0-9a-f]{7,40}\b/gi, "[redacted-sha]")
    .replace(/(?:\/[\w.-]+){2,}/g, "[redacted-path]");
}

function replaceMarked(text, marker, content) {
  const startMarker = `<!-- ${marker}:START -->`;
  const endMarker = `<!-- ${marker}:END -->`;
  const start = text.indexOf(startMarker);
  const end = text.indexOf(endMarker);

  if (start === -1 || end === -1 || end < start) {
    console.warn(`Warning: README has no ${marker} markers; skipping.`);
    return text;
  }

  return `${text.slice(0, start + startMarker.length)}${content}${text.slice(
    end
  )}`;
}
