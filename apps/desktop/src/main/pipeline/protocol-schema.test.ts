import { describe, expect, it } from "vitest";

import { pipelineJsonSchema, pipelineJsonSchemaText, schemaFile } from "./protocol-schema";

describe("the pipeline protocol's JSON Schema file", () => {
  // After changing protocol.ts, `pnpm pipeline:schema` rewrites the file. CI never writes it.
  it("is what the zod schemas generate", async () => {
    await expect(pipelineJsonSchemaText()).toMatchFileSnapshot(schemaFile);
  });

  it("names the version and both directions", () => {
    const schema = pipelineJsonSchema();
    expect(schema.protocol).toBe(1);
    expect(schema.toPipeline).toMatchObject({ oneOf: expect.any(Array) as unknown });
    expect(schema.fromPipeline).toMatchObject({ oneOf: expect.any(Array) as unknown });
  });
});
