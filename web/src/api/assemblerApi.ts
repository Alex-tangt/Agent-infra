import { assemblerEndpoints } from "./assemblerContract.ts";
import type {
  Answers,
  AssembleOutcome,
  AssemblerPort,
  AssembleRequest,
} from "./assemblerContract.ts";

export type Fetcher = (url: string, init?: RequestInit) => Promise<Response>;

export const DEFAULT_ASSEMBLER_API_BASE = "http://127.0.0.1:9001";

// 调组装器服务（assembler/src/server.ts）的 HTTP 客户端：真实"需求→demo 代码"链路。
// 澄清机制随链路接入：assemble 返回 clarify 问题 → 界面展示 → 用户回答 → assembleWithAnswers。
export class AssemblerApiClient implements AssemblerPort {
  private baseUrl: string;
  private fetchFn: Fetcher;

  constructor(
    baseUrl: string = DEFAULT_ASSEMBLER_API_BASE,
    fetchFn: Fetcher = fetch.bind(globalThis),
  ) {
    this.baseUrl = baseUrl.replace(/\/$/, "");
    this.fetchFn = fetchFn;
  }

  private async postAssemble(
    requirement: string,
    answers?: Answers,
  ): Promise<AssembleOutcome> {
    const request: AssembleRequest = answers
      ? { requirement, answers }
      : { requirement };
    const res = await this.fetchFn(`${this.baseUrl}${assemblerEndpoints.assemble}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(request),
    });
    if (!res.ok) {
      throw new Error(`assembler api POST /assemble failed: ${res.status}`);
    }
    return (await res.json()) as AssembleOutcome;
  }

  assemble(requirement: string): Promise<AssembleOutcome> {
    return this.postAssemble(requirement);
  }

  assembleWithAnswers(
    requirement: string,
    answers: Answers,
  ): Promise<AssembleOutcome> {
    return this.postAssemble(requirement, answers);
  }
}
