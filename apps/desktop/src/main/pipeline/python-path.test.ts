import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { findPython, pipelineEnv } from "./python-path";

describe("finding the pipeline's Python", () => {
  const appPath = join("C:", "repo", "apps", "desktop");
  const cwd = join("C:", "repo", "services", "pipeline");
  const python = join(cwd, ".venv", "Scripts", "python.exe");

  it("is the repository's venv when unpackaged", () => {
    expect(findPython({ packaged: false, appPath, exists: (p) => p === python })).toEqual({
      python,
      cwd,
    });
  });

  it("is missing when the venv isn't there (uv sync not run)", () => {
    expect(findPython({ packaged: false, appPath, exists: () => false })).toBeNull();
  });

  it("is missing in the installed app until it ships a Python runtime (3h)", () => {
    expect(findPython({ packaged: true, appPath, exists: () => true })).toBeNull();
  });
});

describe("the pipeline's environment", () => {
  it("carries only what Windows and Python need, nothing from the user's shell", () => {
    const env = pipelineEnv({
      SystemRoot: "C:\\Windows",
      Path: "C:\\Windows\\system32",
      TEMP: "C:\\Temp",
      TMP: "C:\\Temp",
      SUPABASE_SERVICE_ROLE_KEY: "nope",
      YOUTUBE_API_KEY: "nope",
      PYTHONPATH: "C:\\elsewhere",
      HTTPS_PROXY: "http://proxy.example",
    });
    expect(env).toEqual({
      SystemRoot: "C:\\Windows",
      PATH: "C:\\Windows\\system32",
      TEMP: "C:\\Temp",
      TMP: "C:\\Temp",
    });
  });

  it("leaves out what isn't set", () => {
    expect(pipelineEnv({ SYSTEMROOT: "C:\\Windows" })).toEqual({ SystemRoot: "C:\\Windows" });
  });
});
