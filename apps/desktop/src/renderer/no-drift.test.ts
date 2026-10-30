import { readdirSync, readFileSync } from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

// ADR 0021 D3: only the prototype itself and the listed wiring may read
// prototype mode. Every other screen shows or hides through lib/wired.ts.
const rendererRoot = fileURLToPath(new URL(".", import.meta.url));

const allowedExact = new Set([
  "app/start.tsx",
  "app/app.tsx",
  "app/top-bar.tsx",
  "overlays/commands.ts",
  "overlays/palette.tsx",
  "lib/settings.ts",
  "settings/settings-screen.tsx",
  "settings/results.tsx",
  "settings/prototype-section.tsx",
]);

// Matches the prototype state module and its siblings, e.g. lib/prototype.ts
// or lib/prototype-toast.ts.
const prototypeModule = /^lib\/prototype[^/]*$/;

// Matches `from "x"`, `import "x"` and `import("x")`.
const specifierPattern = /(?:\bfrom|\bimport)\s*\(?\s*["']([^"']+)["']/g;

function toPosix(path: string): string {
  return path.split(sep).join("/");
}

function listSourceFiles(folder: string): string[] {
  const files: string[] = [];
  for (const entry of readdirSync(folder, { withFileTypes: true })) {
    const full = join(folder, entry.name);
    if (entry.isDirectory()) {
      files.push(...listSourceFiles(full));
    } else if (/\.tsx?$/.test(entry.name) && !/\.test\.tsx?$/.test(entry.name)) {
      files.push(full);
    }
  }
  return files;
}

function isAllowed(relPath: string): boolean {
  // Whole prototype folder is allowed; the shared state file is allowed by the
  // lib/prototype* rule; the rest are listed by name.
  return (
    relPath.startsWith("prototype/") ||
    prototypeModule.test(relPath.replace(/\.tsx?$/, "")) ||
    allowedExact.has(relPath)
  );
}

// Returns true when a relative specifier resolves into renderer/lib/prototype*.
// The specifier is resolved against the importing file's folder, so the same
// "./prototype" means different things in different folders.
function readsPrototypeState(fromFile: string, specifier: string): boolean {
  if (!specifier.startsWith(".")) return false;
  const target = toPosix(relative(rendererRoot, resolve(dirname(fromFile), specifier)));
  return prototypeModule.test(target);
}

function findOffenders(): string[] {
  const offenders: string[] = [];
  for (const file of listSourceFiles(rendererRoot)) {
    const relPath = toPosix(relative(rendererRoot, file));
    if (isAllowed(relPath)) continue;
    const source = readFileSync(file, "utf8");
    for (const match of source.matchAll(specifierPattern)) {
      const specifier = match[1];
      if (specifier !== undefined && readsPrototypeState(file, specifier)) {
        offenders.push(relPath);
        break;
      }
    }
  }
  return offenders;
}

describe("prototype-mode drift", () => {
  // Fails with the list of files that read prototype mode outside the allowlist.
  it("only allowlisted files read prototype mode", () => {
    const offenders = findOffenders();
    expect(
      offenders,
      `No screen may read prototype mode (ADR 0021 D3). Show or hide through the live gate (lib/wired.ts) instead.\nOffending files:\n${offenders.join("\n")}`,
    ).toEqual([]);
  });

  // Guards against a wrong root, which would make the check above pass for nothing.
  it("walks at least 100 source files", () => {
    expect(listSourceFiles(rendererRoot).length).toBeGreaterThanOrEqual(100);
  });
});
