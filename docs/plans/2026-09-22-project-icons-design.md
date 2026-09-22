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
- Set `align="middle"` on each image so GitHub aligns it with the surrounding
  text. GitHub preserves this attribute but strips inline `vertical-align`
  styles.
- Give every image concise alternative text.
- Leave the generated "Latest releases" section unchanged.

## Verification

- Confirm all four PNG files are 64 × 64 and reasonably small.
- Check that README image paths and project links resolve.
- Render the relevant markup through GitHub's Markdown API and confirm the
  middle-alignment attribute survives sanitization.
- Run the profile updater against a temporary README to ensure the generated
  activity block remains intact.
