/**
 * The Gemini bridge's protocol as JSON Schema, for the pipeline's tests. Main never imports this
 * module: only `gemini-protocol-schema.test.ts` does, which keeps the committed file current
 * (`pnpm --filter @gratovo/desktop exec vitest run -u` rewrites it).
 */
import { fileURLToPath } from "node:url";
import { z } from "zod";

import {
  daemonEventDataSchema,
  fromGeminiSchema,
  geminiParamsSchemas,
  geminiRequestSchema,
  geminiResultSchemas,
  progressEventDataSchema,
} from "./gemini-protocol";

export const geminiSchemaFile = fileURLToPath(
  new URL(
    "../../../../../services/pipeline/src/gratovo_pipeline/gemini/gemini.schema.json",
    import.meta.url,
  ),
);

const target = { target: "draft-2020-12" } as const;

function each(schemas: Readonly<Record<string, z.ZodType>>): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(schemas).map(([method, schema]) => [method, z.toJSONSchema(schema, target)]),
  );
}

export interface GeminiJsonSchema {
  readonly $comment: string;
  readonly toGemini: unknown;
  readonly fromGemini: unknown;
  readonly events: { readonly daemon: unknown; readonly progress: unknown };
  readonly params: Record<string, unknown>;
  readonly results: Record<string, unknown>;
}

export function geminiJsonSchema(): GeminiJsonSchema {
  return {
    $comment:
      "Generated from apps/desktop/src/main/pipeline/gemini-protocol.ts by its Vitest snapshot. Don't edit.",
    toGemini: z.toJSONSchema(geminiRequestSchema, target),
    fromGemini: z.toJSONSchema(fromGeminiSchema, target),
    events: {
      daemon: z.toJSONSchema(daemonEventDataSchema, target),
      progress: z.toJSONSchema(progressEventDataSchema, target),
    },
    params: each(geminiParamsSchemas),
    results: each(geminiResultSchemas),
  };
}

/** The file's text: two-space JSON with a final newline, as Prettier leaves it. */
export function geminiJsonSchemaText(): string {
  return `${JSON.stringify(geminiJsonSchema(), null, 2)}\n`;
}
