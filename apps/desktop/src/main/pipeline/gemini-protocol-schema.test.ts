import { describe, expect, it } from "vitest";

import { geminiJsonSchema, geminiJsonSchemaText, geminiSchemaFile } from "./gemini-protocol-schema";
import { geminiParamsSchemas, geminiResultSchemas } from "./gemini-protocol";

describe("the Gemini bridge protocol's JSON Schema file", () => {
  // After changing gemini-protocol.ts, `vitest run -u` rewrites the file. CI never writes it.
  it("is what the zod schemas generate", async () => {
    await expect(geminiJsonSchemaText()).toMatchFileSnapshot(geminiSchemaFile);
  });

  it("holds both directions, the events, and every typed method", () => {
    const schema = geminiJsonSchema();
    expect(schema.fromGemini).toMatchObject({ anyOf: expect.any(Array) as unknown });
    expect(Object.keys(schema.params).sort()).toEqual(Object.keys(geminiParamsSchemas).sort());
    expect(Object.keys(schema.results).sort()).toEqual(Object.keys(geminiResultSchemas).sort());
  });
});
