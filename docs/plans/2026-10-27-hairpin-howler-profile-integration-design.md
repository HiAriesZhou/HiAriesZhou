# Hairpin and Howler profile integration

## Context

Hairpin and Howler are public macOS apps distributed through GitHub Releases.
Hairpin has a full release; Howler has only pre-releases so far.

## Design

- Add both apps to the README introduction after DashBye and before
  LiteContext, matching the project order on the portfolio site. LiteContext
  stays last because its line leads into the closing question.
- Describe each app by what it does, like the other projects. Howler's line
  alludes to its namesake: a letter that burns once it has been read.
- Link both apps to their GitHub repositories, which serve as their homepages.
- Vendor each repository's app icon (`docs/icon.png` for Hairpin,
  `docs/images/icon.png` for Howler) into `assets/projects`, cropped to the
  visible artwork and scaled to 52 px inside a 64 × 64 canvas so their optical
  size matches the existing icons.
- Add `HiAriesZhou/Hairpin` and `HiAriesZhou/Howler` to the workflow and the
  updater's default repository list. Pre-releases are listed like full
  releases, so Howler appears from its first pre-release.
- Use only public product positioning and links.

## Verification

- Confirm both PNG files are 64 × 64 and compare them against the existing
  icons on light and dark backgrounds.
- Check README image paths and project links resolve.
- Run the updater against the README and confirm both apps appear under
  "Latest releases".
