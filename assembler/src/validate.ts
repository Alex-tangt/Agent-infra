import {
  findComponent,
  type ComponentCatalog,
  type ParamSpec,
} from "./catalog.ts";
import type { Recipe } from "./recipe.ts";

export function validateParams(recipe: Recipe, catalog: ComponentCatalog): void {
  const ids = new Set(recipe.components.map((c) => c.id));
  for (const [componentId, params] of Object.entries(recipe.parameters)) {
    if (!ids.has(componentId)) {
      throw new Error(`parameter for unknown component: ${componentId}`);
    }
    const entry = findComponent(catalog, componentId);
    if (!entry) {
      throw new Error(`component ${componentId} not in catalog`);
    }
    for (const [name, value] of Object.entries(params)) {
      const spec = entry.params[name];
      if (!spec) {
        throw new Error(`unknown parameter '${name}' for component '${componentId}'`);
      }
      assertParamValue(componentId, name, value, spec);
    }
  }
}

export function assertParamValue(
  componentId: string,
  name: string,
  value: unknown,
  spec: ParamSpec,
): void {
  const label = `parameter '${name}' for component '${componentId}'`;
  if (spec.type === "string" && typeof value !== "string") {
    throw new Error(`${label} must be a string, got ${JSON.stringify(value)}`);
  }
  if (
    (spec.type === "number" || spec.type === "integer") &&
    typeof value !== "number"
  ) {
    throw new Error(`${label} must be a number, got ${JSON.stringify(value)}`);
  }
  if (spec.type === "integer" && !Number.isInteger(value)) {
    throw new Error(`${label} must be an integer, got ${JSON.stringify(value)}`);
  }
  if (spec.type === "list" && !Array.isArray(value)) {
    throw new Error(`${label} must be a list, got ${JSON.stringify(value)}`);
  }
  if (spec.enum && !spec.enum.includes(value as string)) {
    throw new Error(`${label} must be one of ${JSON.stringify(spec.enum)}, got ${JSON.stringify(value)}`);
  }
  if (typeof value === "number") {
    if (spec.min !== undefined && value < spec.min) {
      throw new Error(`${label} below min ${spec.min}`);
    }
    if (spec.max !== undefined && value > spec.max) {
      throw new Error(`${label} above max ${spec.max}`);
    }
  }
}
