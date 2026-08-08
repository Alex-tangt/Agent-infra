import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import type { ChildProcess } from "node:child_process";
import { tmpdir } from "node:os";
import { resolve, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { DemoApiClient } from "../src/api/apiClient.ts";
import { ChatSession } from "../src/panels/chatPanel.ts";
import {
  AssemblerSession,
  MockAssembler,
} from "../src/panels/assemblerPanel.ts";
import { aggregateTelemetry } from "../src/panels/debugPanel.ts";

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const PYTHON = process.platform === "win32" ? "python" : "python3";

// 起一个真实 Python demo server 子进程（无 OPENAI_API_KEY → 注入内置离线模型，绝不发真请求）。
function startPythonServer(): Promise<{ port: number; child: ChildProcess }> {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(
      PYTHON,
      ["-m", "server.app", "--host", "127.0.0.1", "--port", "0"],
      {
        cwd: REPO_ROOT,
        // SERVER_CONFIG_PATH 指向不存在的临时文件：确保本机即使有 server/config.json
        // 也不影响测试确定性（始终走离线兜底模型）。
        env: {
          ...process.env,
          OPENAI_API_KEY: "",
          SERVER_CONFIG_PATH: join(tmpdir(), "agent-infra-e2e-config.json"),
        },
        stdio: ["ignore", "pipe", "pipe"],
      },
    );
    let buffer = "";
    let settled = false;
    const fail = (message: string) => {
      if (!settled) {
        settled = true;
        reject(new Error(message));
      }
    };
    const timer = setTimeout(() => fail("timeout waiting for python server"), 20000);
    child.stdout?.on("data", (chunk: Buffer) => {
      buffer += String(chunk);
      const match = buffer.match(/LISTENING (\d+)/);
      if (match) {
        settled = true;
        clearTimeout(timer);
        resolvePromise({ port: Number(match[1]), child });
      }
    });
    child.stderr?.on("data", (chunk: Buffer) => {
      buffer += `[stderr] ${String(chunk)}`;
    });
    child.on("exit", (code) => fail(`python server exited early: ${code}\n${buffer}`));
    child.on("error", (err) => fail(`python server failed to start: ${err}`));
  });
}

test(
  "runtime E2E: assembler→generate→chat→telemetry→ablation over the real Python server",
  { timeout: 60000 },
  async () => {
    const { port, child } = await startPythonServer();
    try {
      const api = new DemoApiClient(`http://127.0.0.1:${port}`);

      // AC4: 组装器联动——MockAssembler 产出配方 → generateDemo 走真实接线引擎生成并运行
      const assembler = new AssemblerSession("demo-e2e", new MockAssembler(), api);
      assembler.setRequirement("会查天气的 agent");
      await assembler.generate();
      assert.ok(assembler.getState().recipe !== null);
      await assembler.generateDemo();
      assert.match(assembler.getState().demoStatus ?? "", /demo 已生成并运行/);

      // AC1: 发消息 → demo 真实回复（离线模型注入，回复出自 Python demo 管线而非 MockDemoApi）
      const session = new ChatSession("demo-e2e", api);
      await session.sendMessage("你好");
      const chatState = session.getState();
      const reply = [...chatState.messages].reverse().find((m) => m.role === "assistant");
      assert.ok(reply, "expected an assistant reply from the real demo");
      assert.ok(reply.content.startsWith("离线回复："));
      assert.ok(
        !reply.content.startsWith("mock 收到"),
        "reply must come from the Python demo, not the web-side mock",
      );

      // AC2: 对话发生时遥测出现在监测面板（真实遥测流）
      const telemetry = await api.getTelemetry("demo-e2e");
      const components = new Set(telemetry.spans.map((s) => s.componentId));
      assert.ok(components.has("agent-single"));
      assert.ok(components.has("model-openai"));
      assert.ok(aggregateTelemetry(telemetry.spans).length > 0);

      // AC3: 触发消融跑出对比结果（真实 runner）
      const ablation = await api.triggerAblation("demo-e2e", {
        variant: {
          kind: "override",
          target: "model-openai.temperature=0.9",
          description: "覆盖温度",
        },
      });
      assert.equal(ablation.run.status, "done");
      assert.ok(ablation.run.results.length >= 1);
      const result = ablation.run.results[0]!;
      assert.equal(typeof result.scores.score, "number");
      assert.ok(result.spans.length > 0);
    } finally {
      child.kill();
    }
  },
);
