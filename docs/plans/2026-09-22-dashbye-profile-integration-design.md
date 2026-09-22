# DashBye profile integration

## Context

This repository is Aries's public GitHub profile and activity updater. DashBye is
already public, but it does not have a GitHub Release or tag yet.

## Design

- Add DashBye to the README introduction using the same problem-to-project voice
  as the other projects.
- Add `HiAriesZhou/DashBye` to both the workflow configuration and the updater's
  default repository list.
- Keep "Latest releases" truthful: DashBye should appear only after its first
  published GitHub Release. Until then, the updater should silently skip it.
- Use only public product positioning and links. Do not include private roadmap,
  business, credential, or publishing details.

## Verification

- Check the updater script parses successfully.
- Run it against a temporary README and confirm a repository with no releases
  does not add an empty or placeholder item.
- Confirm the English RSS feed remains configured for "Recent writing".
