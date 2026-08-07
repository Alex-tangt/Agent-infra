import { test } from "node:test";
import assert from "node:assert/strict";

import { endpoints } from "../src/api/contract.ts";

test("contract: chat endpoint is /demo/{id}/chat", () => {
  assert.equal(endpoints.chat("demo-x"), "/demo/demo-x/chat");
});

test("contract: telemetry endpoint is /demo/{id}/telemetry", () => {
  assert.equal(endpoints.telemetry("demo-x"), "/demo/demo-x/telemetry");
});

test("contract: ablation endpoint is /demo/{id}/ablations", () => {
  assert.equal(endpoints.ablation("demo-x"), "/demo/demo-x/ablations");
});

test("contract: generate-demo endpoint is /demo/{id}/generate", () => {
  assert.equal(endpoints.generateDemo("demo-x"), "/demo/demo-x/generate");
});
