import { prdBlueprintSchema, projectBrief, type PrdBlueprint } from '@precast/shared';
import { resolveAgentMode } from './agent-mode';

/** Operator configuration only; never taken from a caller or tool input. */
export function resolveProductBrief(
  value = process.env.PRECAST_PRODUCT_BLUEPRINT_JSON,
): PrdBlueprint | null {
  if (!value) return projectBrief;
  if (resolveAgentMode() !== 'project' || value.length > 40000)
    throw new Error('Product configuration is only available in project mode.');
  return prdBlueprintSchema.parse(JSON.parse(value));
}
