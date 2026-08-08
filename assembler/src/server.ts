import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";

import {
  assembleRequirement,
  assembleWithAnswers,
  type AssembleDeps,
  type AssembleResult,
} from "./assemble.ts";
import type { Answers } from "./clarify.ts";
import { LocalDriver } from "./localDriver.ts";

export const DEFAULT_ASSEMBLER_PORT = 9001;

/** POST /assemble 请求体：需求 + 可选澄清答案（语言中立 JSON，web 侧 assemblerContract 同构） */
export interface AssembleRequestBody {
  requirement: string;
  answers?: Answers;
}

/** 请求输入校验错误：客户端问题，服务端映射为 400（区别于内部错误的 500） */
export class AssembleRequestError extends Error {}

function setCors(res: ServerResponse): void {
  // web 运行界面本地开发跨域：放行所有来源的浏览器调用
  res.setHeader("access-control-allow-origin", "*");
  res.setHeader("access-control-allow-methods", "GET, POST, OPTIONS");
  res.setHeader("access-control-allow-headers", "content-type");
}

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  setCors(res);
  res.writeHead(status, { "content-type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(body));
}

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let data = "";
    req.on("data", (chunk: Buffer) => {
      data += String(chunk);
    });
    req.on("end", () => resolve(data));
    req.on("error", reject);
  });
}

/** 单次组装请求处理：复用 A5 编排（acquire → clarify / convert），响应即 AssembleResult */
export async function handleAssemble(
  body: unknown,
  deps: AssembleDeps,
): Promise<AssembleResult> {
  const record = body as Partial<AssembleRequestBody>;
  if (typeof record.requirement !== "string" || record.requirement.trim() === "") {
    throw new AssembleRequestError("requirement 必填且为非空字符串");
  }
  if (record.answers === undefined) {
    return assembleRequirement(record.requirement, deps);
  }
  return assembleWithAnswers(record.requirement, record.answers, deps);
}

export interface AssemblerServerOptions {
  deps?: AssembleDeps;
}

/**
 * 组装器 HTTP 服务：暴露 POST /assemble（真实"需求→demo 代码"链路，代码是唯一真相源）。
 * 浏览器无法直接 import 组装器（本地驱动跑在 Node 侧），
 * 故包装为 Node 服务供运行界面经 API 调用；带 CORS 头解决本地开发跨域。
 */
export function createAssemblerServer(options: AssemblerServerOptions = {}): Server {
  // 默认本地驱动：确定性输出 demo 代码（无模型依赖，web 演示开箱即用）；pi 驱动按需注入 options.deps.driver。
  // 模型组件选型：默认 model-openai；本地 ollama 环境经 ASSEMBLER_MODEL_COMPONENT=model-ollama 覆盖。
  const modelComponent = process.env.ASSEMBLER_MODEL_COMPONENT ?? "model-openai";
  const deps: AssembleDeps = {
    ...(options.deps ?? {}),
    driver:
      options.deps?.driver ??
      new LocalDriver({ modelComponent }),
  };
  return createServer(async (req, res) => {
    try {
      const url = new URL(req.url ?? "/", "http://localhost");
      if (req.method === "OPTIONS") {
        setCors(res);
        res.writeHead(204);
        res.end();
        return;
      }
      if (req.method === "POST" && url.pathname === "/assemble") {
        const raw = await readBody(req);
        let body: unknown;
        try {
          body = JSON.parse(raw);
        } catch {
          sendJson(res, 400, { error: "请求体不是合法 JSON" });
          return;
        }
        const result = await handleAssemble(body, deps);
        sendJson(res, 200, result);
        return;
      }
      sendJson(res, 404, { error: "not found" });
    } catch (exc) {
      const message = exc instanceof Error ? exc.message : String(exc);
      const status = exc instanceof AssembleRequestError ? 400 : 500;
      sendJson(res, status, { error: message });
    }
  });
}
