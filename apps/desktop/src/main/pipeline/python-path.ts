import { join, resolve } from "node:path";

/**
 * Where the pipeline's Python is, and what it starts with (ADR 0013).
 */

export interface PythonCommand {
  /** The interpreter. */
  python: string;
  /** The folder it runs in: `services/pipeline`. */
  cwd: string;
}

/**
 * The repository's `services/pipeline/.venv` (made by `uv sync`) when unpackaged; `appPath` is
 * `apps/desktop`. The installed app has no Python until it ships a runtime (step 3h), so it is null
 * there, as it is when the venv is missing.
 */
export function findPython(o: {
  packaged: boolean;
  appPath: string;
  exists: (path: string) => boolean;
}): PythonCommand | null {
  if (o.packaged) {
    return null;
  }
  const cwd = resolve(o.appPath, "..", "..", "services", "pipeline");
  const python = join(cwd, ".venv", "Scripts", "python.exe");
  return o.exists(python) ? { python, cwd } : null;
}

/**
 * The pipeline's whole environment: what Windows and Python need to start, nothing from the user's
 * shell beyond it, and no secret (those go on stdin). `-I` makes Python ignore every `PYTHON*`
 * variable anyway, so the entry point sets UTF-8 itself.
 */
export function pipelineEnv(env: Record<string, string | undefined>): Record<string, string> {
  // Windows names are case-insensitive, and a copied environment keeps whichever case it had.
  const read = (name: string): string | undefined => {
    const found = Object.keys(env).find((k) => k.toUpperCase() === name);
    const value = found === undefined ? undefined : env[found];
    return value === undefined || value === "" ? undefined : value;
  };
  const picked: Record<string, string> = {};
  for (const [name, as] of [
    ["SYSTEMROOT", "SystemRoot"],
    ["PATH", "PATH"],
    ["TEMP", "TEMP"],
    ["TMP", "TMP"],
  ] as const) {
    const value = read(name);
    if (value !== undefined) {
      picked[as] = value;
    }
  }
  return picked;
}
