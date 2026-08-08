import { test } from "node:test";
import assert from "node:assert/strict";

import {
  DEFAULT_CATALOG,
  requireComponent,
  type ComponentCatalog,
} from "../src/catalog.ts";

test("catalog: includes the real registry components at version 1.0", () => {
  const ids = DEFAULT_CATALOG.components.map((c) => `${c.id}@${c.version}`);

  assert.deepEqual(ids.sort(), [
    "agent-single@1.0",
    "context-window@1.0",
    "model-ollama@1.0",
    "model-openai@1.0",
    "tool-caller@1.0",
  ]);
});

test("catalog: model-openai declares the registered param specs", () => {
  const model = requireComponent(DEFAULT_CATALOG, "model-openai");

  assert.deepEqual(Object.keys(model.params).sort(), [
    "max_tokens",
    "model",
    "temperature",
  ]);
  assert.deepEqual(model.params.model?.enum, ["gpt-4o-mini", "gpt-4o"]);
  assert.equal(model.params.temperature?.min, 0);
  assert.equal(model.params.temperature?.max, 2);
});

test("catalog: model-ollama declares the local ollama param specs", () => {
  const model = requireComponent(DEFAULT_CATALOG, "model-ollama");

  assert.deepEqual(Object.keys(model.params).sort(), [
    "base_url",
    "max_tokens",
    "model",
    "temperature",
  ]);
  assert.equal(model.params.model?.default, "llama3");
  assert.equal(model.params.base_url?.default, "http://localhost:11434/v1");
});

test("catalog: requireComponent throws for an unknown id", () => {
  assert.throws(
    () => requireComponent(DEFAULT_CATALOG, "ghost-component"),
    /not in catalog/,
  );
});

test("catalog: an injected catalog can override the default set", () => {
  const injected: ComponentCatalog = {
    components: [
      { id: "context-window", version: "1.0", params: {} },
      { id: "model-openai", version: "1.0", params: {} },
    ],
  };

  const found = requireComponent(injected, "context-window");

  assert.equal(found.id, "context-window");
  assert.throws(() => requireComponent(injected, "tool-caller"), /not in catalog/);
});
