# Project icons in the profile README

## Context

The profile README introduces X-TOC, Bookmark Assistant, DashBye, and
LiteContext in prose. Small project icons should make the projects easier to
recognize without turning the introduction into a card grid or project list.

## Design

- Copy each project's official icon into `assets/projects` so the profile does
  not depend on another repository's branch, path, or website favicon URL.
- Normalize the assets to compact 64 × 64 PNG files and render them at 18 × 18
  in the README.
- Place each icon immediately before its linked project name while preserving
  the current introduction and links.
- Render every project introduction as its own Markdown paragraph. Do not mix
  `<br>` line breaks with blank-line paragraph spacing.
- Set `align="absmiddle"` on each image. Unlike `middle`, which still aligns
  against the text baseline, `absmiddle` centers the image against the full
  line box. GitHub preserves this attribute but strips inline
  `vertical-align` styles.
- Normalize the visible artwork inside each 64 × 64 canvas so all four icons
  have comparable optical size while their rendered boxes and text starting
  positions remain identical.
- Treat each project's current public website as the preferred brand source.
  For Bookmark Assistant, vendor the high-resolution public
  `apple-touch-icon.png` rather than retaining the legacy extension icon or
  hotlinking the website asset.
- Give every image concise alternative text.
- Leave the generated "Latest releases" section unchanged.

## Verification

- Confirm all four PNG files are 64 × 64 and reasonably small.
- Check that README image paths and project links resolve.
- Render the relevant markup through GitHub's Markdown API and confirm the
  absolute-middle alignment attribute survives sanitization.
- Inspect the published profile rather than treating sanitizer output alone as
  proof of visual alignment.
- Confirm all four project introductions have the same published paragraph
  spacing.
- Run the profile updater against a temporary README to ensure the generated
  activity block remains intact.
