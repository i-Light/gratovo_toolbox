import { copyFile, mkdtemp, rm } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";

import { expect, test } from "@playwright/test";
import { FuseState, FuseV1Options, getCurrentFuseWire } from "@electron/fuses";

import { applyReleaseFuses, releaseFuses } from "../scripts/release-fuses";

// Run from Node, the electron package exports the path to its binary.
const requireFromHere = createRequire(__filename);
const electronBinary = requireFromHere("electron") as string;

// This test never launches the app: it only reads and writes the fuse bytes in a copy.
test("flips every fuse to the release setting and leaves the dev binary alone", async () => {
  // The Electron binary is large, so copying it takes a while.
  test.setTimeout(120_000);

  const folder = await mkdtemp(join(tmpdir(), "gratovo-fuses-"));
  try {
    const copy = join(folder, basename(electronBinary));
    await copyFile(electronBinary, copy);

    await applyReleaseFuses(copy);
    const flipped = await getCurrentFuseWire(copy);

    const options = Object.values(FuseV1Options).filter(
      (value): value is FuseV1Options => typeof value === "number",
    );
    for (const option of options) {
      const expected = releaseFuses[option] ? FuseState.ENABLE : FuseState.DISABLE;
      expect(flipped[option], `fuse ${FuseV1Options[option]}`).toBe(expected);
    }

    // Dev runs and the other tests use the original binary, so it must keep its defaults.
    const original = await getCurrentFuseWire(electronBinary);
    expect(original[FuseV1Options.RunAsNode]).toBe(FuseState.ENABLE);
  } finally {
    await rm(folder, { recursive: true, force: true });
  }
});
