# Repository guide

This public repository holds the GitHub profile README and its activity updater.
Keep README.md focused on the profile. Existing design notes live in docs/plans.

## Maintenance

- Run `node --test scripts/update-profile.test.mjs` for the updater's offline regression tests. No packages need to be installed.
- Run `node scripts/update-profile.mjs` from the repository root to refresh the README from public GitHub Releases and the English RSS feed. This contacts live services and may modify README.md.
- Keep existing products, the English RSS feed, and the five-release/five-post limits unless the task explicitly changes them. Add a public product to both `releaseRepos` in the script and `RELEASE_REPOS` in the workflow. Use its published name and describe only released features.
- The workflow runs every three hours at minute 17 UTC, or on manual and supported repository dispatch events. Scheduled runs may be delayed by GitHub.
- The workflow uses `GITHUB_TOKEN` with `contents: write` to commit README.md and the public Bookmark Assistant release metadata. Preserve that narrow file list. Workflow tests run before live updates; failed fetches retain the affected section and fail the job before commit.
- Workflow runs share a concurrency group to avoid overlapping pushes. Recheck repository rules before changing the push mechanism. If a future rule requires pull requests for the bot, report the conflict rather than weakening protection or adding a credential.

## Public content

Work on a task branch and send human changes through a pull request. Preserve unrelated local work. Keep credentials, private plans, personal filesystem paths, session logs, and unpublished product claims out of this repository. Use synthetic data in tests. Review generated content and assets before publishing.
