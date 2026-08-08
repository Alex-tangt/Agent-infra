import { readFileSync } from "node:fs";

export interface ParamSpec {
  type: string;
  default?: unknown;
  enum?: string[];
  min?: number;
  max?: number;
}

export interface PortSpec {
  name: string;
  type: string;
}

export interface ComponentEntry {
  id: string;
  version: string;
  description?: string;
  role?: string;
  class_name?: string;
  inputs?: PortSpec[];
  outputs?: PortSpec[];
  params: Record<string, ParamSpec>;
}

export interface ComponentCatalog {
  components: ComponentEntry[];
}

// 组件契约的单一权威源是 Python 侧 components/registry.py（ADR-0005）。本文件不再手抄，
// 只读取 registry 的导出只读契约 contracts/component-catalog.json（由 scripts/export_catalog.py 生成）。
const CATALOG_FILE_URL = new URL(
  "../../contracts/component-catalog.json",
  import.meta.url,
);

function loadDefaultCatalog(): ComponentCatalog {
  let raw: string;
  try {
    raw = readFileSync(CATALOG_FILE_URL, "utf-8");
  } catch {
    throw new Error(
      `组件注册表导出物缺失（${CATALOG_FILE_URL.href}）：请先运行 python scripts/export_catalog.py 生成 contracts/component-catalog.json`,
    );
  }
  return JSON.parse(raw) as ComponentCatalog;
}

export const DEFAULT_CATALOG: ComponentCatalog = loadDefaultCatalog();

export function findComponent(
  catalog: ComponentCatalog,
  id: string,
): ComponentEntry | undefined {
  return catalog.components.find((entry) => entry.id === id);
}

export function requireComponent(catalog: ComponentCatalog, id: string): ComponentEntry {
  const entry = findComponent(catalog, id);
  if (!entry) {
    throw new Error(`component ${id!} not in catalog`);
  }
  return entry;
}
