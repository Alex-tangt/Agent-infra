import { test } from "node:test";
import assert from "node:assert/strict";

import { createRuntimeServer } from "../src/server.ts";

async function withServer(fn: (baseUrl: string) => Promise<void>) {
  const server = await createRuntimeServer(["public", "dist"]);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const addr = server.address();
  assert.ok(addr && typeof addr === "object");
  const baseUrl = `http://127.0.0.1:${addr.port}`;
  try {
    await fn(baseUrl);
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
}

test("server serves index.html shell with app mount", async () => {
  await withServer(async (baseUrl) => {
    const res = await fetch(`${baseUrl}/`);
    assert.equal(res.status, 200);
    const html = await res.text();
    assert.match(html, /id="app"/);
    assert.match(html, /script type="module" src="\/main\.js"/);
  });
});

test("server serves the built client bundle and its panel modules", async () => {
  await withServer(async (baseUrl) => {
    for (const path of [
      "/main.js",
      "/app.js",
      "/panels/chatPanel.js",
      "/panels/debugPanel.js",
      "/panels/evalPanel.js",
    ]) {
      const res = await fetch(`${baseUrl}${path}`);
      assert.equal(res.status, 200, `${path} should be served`);
    }
    const mainJs = await (await fetch(`${baseUrl}/main.js`)).text();
    assert.match(mainJs, /renderApp/);
  });
});
