import { AssemblerApiClient, DEFAULT_ASSEMBLER_API_BASE } from "./assemblerApi.ts";
import type { AssemblerPort } from "./assemblerContract.ts";
import { MockAssembler } from "../panels/assemblerPanel.ts";

// 组装器 API 工厂：默认走真实 HTTP 服务（assembler server，端口 9001）；
// `?mock=1` 显式切回骨架假组装器，供无 Node 组装器服务时独立运行（与 createDemoApi 的 mock 开关一致）。
export function createAssemblerApi(): AssemblerPort {
  if (typeof window !== "undefined") {
    const query = new URLSearchParams(window.location.search);
    if (query.get("mock") === "1") return new MockAssembler();
    return new AssemblerApiClient(
      query.get("assembler-api") ?? DEFAULT_ASSEMBLER_API_BASE,
    );
  }
  return new AssemblerApiClient(DEFAULT_ASSEMBLER_API_BASE);
}
