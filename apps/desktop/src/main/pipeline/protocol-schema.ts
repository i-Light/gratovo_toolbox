/**
 * The protocol as JSON Schema, for the pipeline's tests. Main never imports this module: only
 * `protocol-schema.test.ts` does, which keeps the committed file current (`pnpm pipeline:schema`
 * rewrites it).
 */
import { fileURLToPath } from "node:url";
import { z } from "zod";

import { fromPipelineSchema, protocolVersion, toPipelineSchema } from "./protocol";

export const schemaFile = fileURLToPath(
  new URL(
    "../../../../../services/pipeline/src/gratovo_pipeline/protocol.schema.json",
    import.meta.url,
  ),
);

export interface PipelineJsonSchema {
  readonly $comment: string;
  readonly protocol: number;
  readonly toPipeline: unknown;
  readonly fromPipeline: unknown;
}

export function pipelineJsonSchema(): PipelineJsonSchema {
  return {
    $comment:
      "Generated from apps/desktop/src/main/pipeline/protocol.ts by `pnpm pipeline:schema`. Don't edit.",
    protocol: protocolVersion,
    toPipeline: z.toJSONSchema(toPipelineSchema, { target: "draft-2020-12" }),
    fromPipeline: z.toJSONSchema(fromPipelineSchema, { target: "draft-2020-12" }),
  };
}

/** The file's text: two-space JSON with a final newline, as Prettier leaves it. */
export function pipelineJsonSchemaText(): string {
  return `${JSON.stringify(pipelineJsonSchema(), null, 2)}\n`;
}
