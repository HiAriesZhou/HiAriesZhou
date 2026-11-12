# Repository guide

This public repository holds the GitHub profile README and its activity updater.
Keep README.md focused on the profile. Existing design notes live in docs/plans.

## Maintenance

- Run `node --test scripts/*.test.mjs` for the updater and release monitor's offline regression tests. No packages need to be installed.
- Run `node scripts/update-profile.mjs` from the repository root to refresh the README from public GitHub Releases and the English RSS feed. This contacts live services and may modify README.md.
- Keep existing products, the English RSS feed, per-product release cells, and the three-post limit unless the task explicitly changes them. Add a public product to both `releaseRepos` in the script and `RELEASE_REPOS` in the workflow, with a matching `RELEASE:<lowercase-repo>` cell in README.md. Use its published name and describe only released features.
- The workflow runs every three hours at minute 17 UTC, or on manual and supported repository dispatch events. Scheduled runs may be delayed by GitHub.
- The workflow uses `GITHUB_TOKEN` with `contents: write` to commit README.md and the public Bookmark Assistant release metadata. Preserve that narrow file list. Workflow tests run before live updates; failed fetches prevent README commits, but validated dispatch metadata is committed before the job reports failure so a later refresh can recover it.
- Workflow runs share a concurrency group with `queue: max` to serialize pushes without replacing pending release dispatches (up to GitHub's 100-pending-run limit). Each run explicitly checks out `github.ref` at startup so queued runs include earlier bot commits instead of the event's stale SHA. Recheck repository rules before changing the push mechanism. If a future rule requires pull requests for the bot, report the conflict rather than weakening protection or adding a credential.

## Portfolio release reminders

- The separate `check-product-releases.yml` workflow supports manual dispatch. It reads `https://www.arieszhou.com/products.json`, containing only reviewed public product names, slugs, versions and repository URLs. The feed is not deployed yet, so the daily schedule is disabled. After deploying the feed and passing a read-only live check, enable the daily schedule at 02:37 UTC.
- Run `node scripts/check-project-releases.mjs` for a read-only live report. `--write` uses `GITHUB_REPOSITORY` and the built-in `GITHUB_TOKEN` to maintain one bot-owned issue in this repository. Only this job has `issues: write`; it has no content write permission.
- Public reads use no token. Invalid/empty feeds and API failures fail before issue writes; a public repository without a stable release is skipped. Identical differences cause no write; a successful check without differences closes the reminder. Manually closing an unresolved issue allows a new one next run.
- The monitor compares latest stable GitHub Releases only. Products without a reviewed version are absent from the feed. Store availability, product descriptions and unreviewed translations still require editorial review. It never edits portfolio content or imports private repository data.

## Public content

Work on a task branch and send human changes through a pull request. Preserve unrelated local work. Keep credentials, private plans, personal filesystem paths, session logs, and unpublished product claims out of this repository. Use synthetic data in tests. Review generated content and assets before publishing.
