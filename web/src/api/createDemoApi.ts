import { DemoApiClient } from "./apiClient.ts";
import type { DemoApi } from "../mockDemoApi.ts";
import { MockDemoApi } from "../mockDemoApi.ts";

const DEFAULT_API_BASE = "http://127.0.0.1:9000";

// 运行界面默认连 Python demo server（DemoApiClient 走真实链路）；
// `?mock=1` 显式切回骨架假后端，供无 Python 环境时独立运行。
export function createDemoApi(): DemoApi {
  if (typeof window !== "undefined") {
    const query = new URLSearchParams(window.location.search);
    if (query.get("mock") === "1") return new MockDemoApi();
    return new DemoApiClient(query.get("api") ?? DEFAULT_API_BASE);
  }
  return new DemoApiClient(DEFAULT_API_BASE);
}
