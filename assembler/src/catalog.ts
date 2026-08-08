export interface ParamSpec {
  type: string;
  default?: unknown;
  enum?: string[];
  min?: number;
  max?: number;
}

export interface ComponentEntry {
  id: string;
  version: string;
  params: Record<string, ParamSpec>;
}

export interface ComponentCatalog {
  components: ComponentEntry[];
}

export const DEFAULT_CATALOG: ComponentCatalog = {
  components: [
    {
      id: "model-openai",
      version: "1.0",
      params: {
        model: {
          type: "string",
          enum: ["gpt-4o-mini", "gpt-4o"],
          default: "gpt-4o-mini",
        },
        temperature: { type: "number", min: 0, max: 2, default: 0.7 },
        max_tokens: { type: "number", min: 1, max: 16384, default: 1024 },
      },
    },
    {
      id: "model-ollama",
      version: "1.0",
      params: {
        model: { type: "string", default: "llama3" },
        temperature: { type: "number", min: 0, max: 2, default: 0.7 },
        max_tokens: { type: "number", min: 1, max: 16384, default: 1024 },
        base_url: { type: "string", default: "http://localhost:11434/v1" },
      },
    },
    {
      id: "context-window",
      version: "1.0",
      params: {
        max_rounds: { type: "integer", min: 1, default: 5 },
        strategy: { type: "string", enum: ["truncate"], default: "truncate" },
      },
    },
    {
      id: "tool-caller",
      version: "1.0",
      params: {
        tools: { type: "list", default: [] },
        strategy: {
          type: "string",
          enum: ["strict", "lenient"],
          default: "strict",
        },
      },
    },
    {
      id: "agent-single",
      version: "1.0",
      params: {
        max_iterations: { type: "integer", min: 1, default: 5 },
      },
    },
  ],
};

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
