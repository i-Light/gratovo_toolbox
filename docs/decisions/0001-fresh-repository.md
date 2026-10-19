# 0001. A fresh repository instead of renaming the old one

- **Date:** 2026-10-19
- **Status:** accepted (owner's request)

## Context

The old repository `gratovo_code` has grown for months. Its history holds live keys (`data/.env` was tracked and pushed), build scripts for Flutter, one-off migrations, and files that no longer contribute. The owner asked for a clean repository built from day one with good practice, copying in only what is needed. They also asked for a physical copy of the old folder first.

## Decision

- Make a full physical copy of the old folder: `E:\IMA work\Code\gratovo_code backup 2026-10-19`. It is complete, including `.git`, and at commit `43596b8`.
- Leave the old folder and repository as they are. The team still runs the old app until cutover, and its releases come from there.
- Create `gratovo_toolbox` with a new history. The first commit holds only the docs, the design reference, the project skills and a read-only `legacy/` copy of the old source with secrets excluded (see [0005](0005-legacy-reference-folder.md)).

## Alternatives considered

- **Rename the old repository and keep its history.** That carries the leaked keys and months of clutter into the new project.
- **Rewrite the old history to purge secrets.** That is destructive, it doesn't help the clutter, and the keys must be rotated anyway.

## Consequences

- Two repositories exist until cutover. The old one is archived in step 11.
- Cloud sessions working on the new repository can't see the old one, hence `legacy/`.
