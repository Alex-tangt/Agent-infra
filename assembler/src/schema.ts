// 瞬态 spec（配方结构）的本地 JSON Schema 定义（ADR-0005）。
// 组装器生成 demo 代码前产出的 spec 只用做生成时结构校验，校验后即弃；
// 不再依赖 contracts/recipe-schema.json（该契约文件已随配方机制一起废除）。

const RECIPE_SCHEMA = {
  $schema: "https://json-schema.org/draft/2020-12/schema",
  title: "Agent Infra transient spec",
  description:
    "组装器生成 demo 前的瞬态组件/参数/连线声明结构，仅作生成时校验与写码参考，校验后即弃。",
  type: "object",
  properties: {
    name: { type: "string" },
    components: {
      type: "array",
      items: {
        type: "object",
        required: ["id", "version"],
        additionalProperties: false,
        properties: {
          id: { type: "string" },
          version: { type: "string" },
        },
      },
    },
    connections: {
      type: "array",
      items: {
        type: "object",
        required: ["from", "to"],
        additionalProperties: false,
        properties: {
          from: { type: "string" },
          to: { type: "string" },
        },
      },
    },
    parameters: {
      type: "object",
      additionalProperties: {
        type: "object",
        additionalProperties: true,
      },
    },
  },
  required: ["components", "connections", "parameters"],
  additionalProperties: false,
} as const;

export function loadRecipeSchema(): Record<string, any> {
  return RECIPE_SCHEMA as unknown as Record<string, any>;
}

type Node = Record<string, any>;

function validateNode(value: unknown, schema: Node, path: string): void {
  const kind = schema.type as string | undefined;
  if (kind === "object") {
    if (typeof value !== "object" || value === null || Array.isArray(value)) {
      throw new Error(`${path} must be an object, got ${String(value)}`);
    }
    const record = value as Record<string, unknown>;
    const required = (schema.required as string[]) ?? [];
    for (const name of required) {
      if (!(name in record)) {
        throw new Error(`${path} missing required property '${name}'`);
      }
    }
    const properties = (schema.properties as Record<string, Node> | undefined) ?? {};
    for (const key of Object.keys(record)) {
      const propSchema = properties[key];
      if (propSchema) {
        validateNode(record[key], propSchema, `${path}.${key}`);
      } else if (!(schema.additionalProperties as boolean | undefined)) {
        throw new Error(`${path} has unexpected property '${key}'`);
      }
    }
  } else if (kind === "array") {
    if (!Array.isArray(value)) {
      throw new Error(`${path} must be an array, got ${String(value)}`);
    }
    const items = schema.items as Node | undefined;
    if (items) {
      (value as unknown[]).forEach((item, index) =>
        validateNode(item, items, `${path}[${index}]`),
      );
    }
  } else if (kind === "string") {
    if (typeof value !== "string") {
      throw new Error(`${path} must be a string, got ${String(value)}`);
    }
  } else if (kind === "integer") {
    if (typeof value !== "number" || !Number.isInteger(value)) {
      throw new Error(`${path} must be an integer, got ${String(value)}`);
    }
  } else if (kind === "number") {
    if (typeof value !== "number") {
      throw new Error(`${path} must be a number, got ${String(value)}`);
    }
  }
}

export function validateStructure(value: unknown): void {
  validateNode(value, RECIPE_SCHEMA as unknown as Node, "recipe");
}
