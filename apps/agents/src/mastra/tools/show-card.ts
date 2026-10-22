import { randomUUID } from 'node:crypto';
import { createTool } from '@mastra/core/tools';
import { toStandardSchema } from '@mastra/core/schema';
import {
  cardToA2ui,
  SHOW_CARD_INPUT_SCHEMA,
  SHOW_CARD_INSTRUCTIONS,
  SHOW_CARD_TOOL,
} from '@precast/a2ui';
import { setPendingCard } from '../lib/request-context';

export { SHOW_CARD_INSTRUCTIONS };

export type ShowCardResult = { shown: true; surfaceId: string } | { shown: false; reason: string };

/**
 * Draw the card and hold it for this turn's reply. The A2UI middleware attaches it to the A2A
 * response; nothing here touches the reply itself. Kept as a plain function so it tests without
 * the Mastra runtime.
 */
export function showCard(card: unknown, surfaceId = `card-${randomUUID()}`): ShowCardResult {
  const messages = cardToA2ui(card, surfaceId);
  if (!messages) {
    return { shown: false, reason: 'Nothing on that card could be shown. Answer in text instead.' };
  }
  if (!setPendingCard(messages)) {
    return { shown: false, reason: 'Cards only show on replies to a person. Answer in text.' };
  }
  return { shown: true, surfaceId };
}

/**
 * The governed card tool. The model fills a flat card against the schema generated from the
 * catalog's limits; it never writes A2UI itself, so model text cannot decide what a person sees.
 */
export const showCardTool = createTool({
  id: SHOW_CARD_TOOL,
  description:
    'Attach one interactive card (title, text, label/value fields, buttons, one dropdown) under your reply. ' +
    'Always write the reply as text too.',
  // Plain JSON Schema, shared with AgentBase byte for byte; Mastra validates it before `execute`.
  inputSchema: toStandardSchema(
    SHOW_CARD_INPUT_SCHEMA as unknown as Parameters<typeof toStandardSchema>[0],
  ),
  execute: async (input) => showCard(input),
});

/**
 * Spread into an agent's `tools` to turn cards on: `tools: { ...cardTools }`, and append
 * `SHOW_CARD_INSTRUCTIONS` to its instructions. The key must stay `show_card`: it is the tool name
 * the model sees, and the skill id the A2UI middleware looks for on the agent card.
 */
export const cardTools = { [SHOW_CARD_TOOL]: showCardTool } as const;
