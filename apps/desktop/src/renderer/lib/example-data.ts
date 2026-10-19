import { exampleFrame } from "@gratovo/core/data";

import { toAppData } from "./frame";
import type { AppData } from "./store";

/** The example data as the renderer holds it (the same as a freshly seeded example database). */
export function exampleData(now: number): AppData {
  return toAppData(exampleFrame(now));
}
