import { test } from "node:test";
import assert from "node:assert/strict";

import { loadRecipeSchema, validateStructure } from "../src/schema.ts";

const VALID = {
  name: "weather-agent",
  components: [
    { id: "model-openai", version: "1.0" },
    { id: "context-window", version: "1.0" },
  ],
  connections: [{ from: "model-openai", to: "context-window" }],
  parameters: { "model-openai": { temperature: 0.7 } },
};

test("schema: recipe-schema.json is the single source consumed by TS", () => {
  const schema = loadRecipeSchema() as {
    $schema: string;
    type: string;
    required: string[];
    additionalProperties: boolean;
  };

  assert.equal(schema.type, "object");
  assert.match(schema.$schema, /^https:\/\/json-schema\.org\/draft\/2020-12\/schema$/);
  assert.deepEqual(schema.required, ["components", "connections", "parameters"]);
  assert.equal(schema.additionalProperties, false);
});

test("schema: component items require id + version and forbid extras", () => {
  const schema = loadRecipeSchema();
  const items = (schema as Record<string, any>).properties.components.items;

  assert.deepEqual(items.required, ["id", "version"]);
  assert.equal(items.additionalProperties, false);
  assert.equal(items.properties.id.type, "string");
  assert.equal(items.properties.version.type, "string");
});

test("schema: connection items require from + to and forbid extras", () => {
  const schema = loadRecipeSchema();
  const items = (schema as Record<string, any>).properties.connections.items;

  assert.deepEqual(items.required, ["from", "to"]);
  assert.equal(items.additionalProperties, false);
});

test("schema: validateStructure accepts a full valid recipe", () => {
  assert.doesNotThrow(() => validateStructure(VALID));
});

test("schema: validateStructure rejects a missing components key", () => {
  const { components: _omitted, ...broken } = VALID;
  void _omitted;
  assert.throws(() => validateStructure(broken), /required property 'components'/);
});

test("schema: validateStructure rejects a component without version", () => {
  const broken = {
    ...VALID,
    components: [{ id: "model-openai" }],
  };
  assert.throws(() => validateStructure(broken), /'version'/);
});

test("schema: validateStructure rejects an unknown top-level field", () => {
  const broken = { ...VALID, spurious: true };
  assert.throws(() => validateStructure(broken), /unexpected property 'spurious'/);
});
