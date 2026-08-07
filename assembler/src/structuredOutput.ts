import { Type, type TObject } from "@sinclair/typebox";

import { DEFAULT_CATALOG, type ComponentCatalog } from "./catalog.ts";
import type { Recipe } from "./recipe.ts";
import { validateStructure } from "./schema.ts";
import { validateParams } from "./validate.ts";

export interface LlmLike {
  (prompt: string): Promise<string> | string;
}

export interface StructuredOutputTool {
  name: "structured_output";
  description: string;
  parameters: TObject;
  terminate: true;
  execute(requirement: string): Promise<Recipe>;
}

const componentSchema = Type.Object(
  {
    id: Type.String(),
    version: Type.String(),
  },
  { additionalProperties: false },
);

const connectionSchema = Type.Object(
  {
    from: Type.String(),
    to: Type.String(),
  },
  { additionalProperties: false },
);

// pi 工具入参描述（TypeBox）：描述"模型必须产出的配方形状"给 pi 的 structured-output 约束用。
// 注意：这不是校验的单一来源——结构校验由 schema.validateStructure 消费 contracts/recipe-schema.json。
// 二者必须保持结构一致；本文件的声明是工具描述，契约定义以 recipe-schema.json 为准。
export const RECIPE_PARAMS_SCHEMA: TObject = Type.Object(
  {
    name: Type.Optional(Type.String()),
    components: Type.Array(componentSchema),
    connections: Type.Array(connectionSchema),
    parameters: Type.Record(
      Type.String(),
      Type.Record(Type.String(), Type.Any()),
    ),
  },
  { additionalProperties: false },
);

function parseRaw(raw: string): unknown {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (exc) {
    const message = exc instanceof Error ? exc.message : String(exc);
    throw new Error(`structured output is not valid JSON: ${message}`);
  }
  return parsed;
}

export function constrainToRecipe(raw: string, catalog: ComponentCatalog): Recipe {
  const parsed = parseRaw(raw);

  // 结构校验的单一来源是 contracts/recipe-schema.json（见 schema.validateStructure）。
  validateStructure(parsed);
  const recipe = parsed as unknown as Recipe;

  const knownIds = new Set(recipe.components.map((c) => c.id));
  for (const component of recipe.components) {
    const entry = catalog.components.find(
      (c) => c.id === component.id && c.version === component.version,
    );
    if (!entry) {
      throw new Error(
        `component ${component.id}@${component.version} not in catalog`,
      );
    }
  }
  for (const connection of recipe.connections) {
    if (!knownIds.has(connection.from)) {
      throw new Error(`connection references unknown component: ${connection.from}`);
    }
    if (!knownIds.has(connection.to)) {
      throw new Error(`connection references unknown component: ${connection.to}`);
    }
  }

  validateParams(recipe, catalog);
  return recipe;
}

export function createStructuredOutputTool(
  llm: LlmLike,
  catalog: ComponentCatalog = DEFAULT_CATALOG,
): StructuredOutputTool {
  return {
    name: "structured_output",
    description:
      "Return the final recipe as a single JSON object conforming to the recipe schema. Use this as the last action; the output is validated and returned as a Recipe.",
    parameters: RECIPE_PARAMS_SCHEMA,
    terminate: true,
    async execute(requirement: string): Promise<Recipe> {
      const raw = await llm(requirement);
      return constrainToRecipe(raw, catalog);
    },
  };
}
