import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const SCHEMA_URL = new URL("../../contracts/recipe-schema.json", import.meta.url);

let _schema: Record<string, any> | undefined;

export function loadRecipeSchema(): Record<string, any> {
  if (_schema) {
    return _schema;
  }
  const raw = readFileSync(fileURLToPath(SCHEMA_URL), "utf8");
  _schema = JSON.parse(raw) as Record<string, any>;
  return _schema;
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
  validateNode(value, loadRecipeSchema(), "recipe");
}
