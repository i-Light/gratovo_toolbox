/** An error's kind for the log: its code or its name, never its message (it may hold a path). */
export function kindOf(error: unknown): string {
  if (error instanceof Error) {
    const code = (error as NodeJS.ErrnoException).code;
    return typeof code === "string" ? code : error.name;
  }
  return typeof error;
}
