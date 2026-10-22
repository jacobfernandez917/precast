/**
 * `show_card`: the built-in tool an agent calls to attach an interactive card to its reply. The
 * model fills a flat card; `cardToA2ui` turns it into A2UI v0.9.1 messages in the catalog
 * `raya.blocks.v1`, within the catalog's limits. UI is never parsed out of model text, so untrusted
 * text cannot decide the structure of what a person sees.
 *
 * `cardToA2ui` and `cardStrings` stay self-contained (no imports, no module constants) because
 * AgentBase emits them into generated containers with `toString()`.
 */

export const SHOW_CARD_TOOL = 'show_card';

const label = { type: 'string', minLength: 1, maxLength: 120 };
const body = { type: 'string', minLength: 1, maxLength: 3000 };
const actionName = {
  type: 'string',
  minLength: 1,
  maxLength: 64,
  pattern: '^[a-zA-Z0-9._:-]+$',
  description: 'A short id you will receive back when this is pressed, e.g. approve_invoice.',
};
const value = {
  type: 'string',
  maxLength: 2000,
  description: 'Returned to you exactly as written when this is pressed. Never shown.',
};

/** JSON Schema for the tool's input, within `raya.blocks.v1`'s limits. */
export const SHOW_CARD_INPUT_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    title: { ...label, description: 'One bold line at the top.' },
    text: { ...body, description: "The card's main text." },
    fields: {
      type: 'array',
      maxItems: 10,
      description: 'Label and value pairs, shown in two columns.',
      items: {
        type: 'object',
        additionalProperties: false,
        properties: { label, value: label },
        required: ['label', 'value'],
      },
    },
    note: {
      ...body,
      description: 'A muted line under the card, such as where the data came from.',
    },
    buttons: {
      type: 'array',
      maxItems: 5,
      description:
        'Up to 5 buttons. A button with `action` sends you `action` and `value` when pressed. A button with `url` only opens that https page and tells you nothing.',
      items: {
        type: 'object',
        additionalProperties: false,
        properties: {
          label,
          action: actionName,
          value,
          style: { type: 'string', enum: ['primary', 'danger'] },
          url: { type: 'string', maxLength: 2000, pattern: '^https://' },
        },
        required: ['label'],
      },
    },
    choice: {
      type: 'object',
      additionalProperties: false,
      description: 'One dropdown; the person picks an option and presses Send.',
      properties: {
        action: actionName,
        placeholder: label,
        options: {
          type: 'array',
          minItems: 1,
          maxItems: 20,
          items: {
            type: 'object',
            additionalProperties: false,
            properties: { label, value: { type: 'string', minLength: 1, maxLength: 2000 } },
            required: ['label', 'value'],
          },
        },
      },
      required: ['action', 'options'],
    },
  },
} as const;

/**
 * What the agent is told about the tool. Append it to the instructions of any agent that has
 * `show_card`. A press reaches the agent as a text message carrying one of two JSON payloads:
 * `raya.interaction` from Raya, or `a2ui.action` from any other A2UI client (see `a2a-parts.ts`).
 */
export const SHOW_CARD_INSTRUCTIONS = [
  'CARDS: you can attach one interactive card to a reply by calling the show_card tool once.',
  'Use it when buttons, a choice or a short table of values help the person act; otherwise answer in text.',
  'Always write your reply as text too: the card sits under it, and some people only see the text.',
  "Do not repeat the card's contents in the text.",
  'When someone uses a control on one of your cards, you receive a message saying so with a JSON payload.',
  'A raya.interaction payload has action_id (the action you gave the control), label (what they saw), value (what you set) and selection (what they chose or typed).',
  'An a2ui.action payload has name (the action you gave the control), value (what you set, when the control had one) and context (anything else the client sent, such as what they chose).',
  'Treat that message as the action itself, not as new content to analyse: do what the control offers and reply about it.',
].join('\n');

/** Added to the reply when a guardrail dropped its card, so the text never points at nothing. */
export const CARD_WITHHELD_NOTE =
  "A card that came with this reply was not shown because it broke one of this agent's content rules.";

/* eslint-disable @typescript-eslint/no-explicit-any -- emitted as plain JavaScript */

/** The card as A2UI v0.9.1 messages in `raya.blocks.v1`, or null when nothing valid is left. */
export function cardToA2ui(card: any, surfaceId: string): unknown[] | null {
  const str = (v: any, max: number) =>
    typeof v === 'string' && v.trim() ? v.trim().slice(0, max) : null;
  const id = (v: any) => (typeof v === 'string' && /^[a-zA-Z0-9._:-]{1,64}$/.test(v) ? v : null);
  if (!card || typeof card !== 'object') return null;
  const components: any[] = [];
  const children: string[] = [];
  const add = (c: any) => {
    components.push(c);
    return c.id;
  };

  const title = str(card.title, 120);
  if (title) children.push(add({ id: 'title', component: 'Header', text: title }));
  const text = str(card.text, 3000);
  const fields = (Array.isArray(card.fields) ? card.fields : [])
    .map((f: any) => ({ label: str(f && f.label, 120), value: str(f && f.value, 120) }))
    .filter((f: any) => f.label && f.value)
    .slice(0, 10);
  if (text || fields.length) {
    const section: any = { id: 'body', component: 'Section' };
    if (text) section.text = text;
    if (fields.length) section.fields = fields;
    children.push(add(section));
  }
  const note = str(card.note, 3000);
  if (note) children.push(add({ id: 'note', component: 'Context', text: note }));

  const controls: string[] = [];
  const buttons = Array.isArray(card.buttons) ? card.buttons : [];
  buttons.forEach((b: any, i: number) => {
    const text = str(b && b.label, 120);
    if (!text) return;
    const button: any = { id: 'button-' + i, component: 'Button', label: text };
    if (b.style === 'primary' || b.style === 'danger') button.variant = b.style;
    const url =
      typeof b.url === 'string' && /^https:\/\//.test(b.url) ? b.url.slice(0, 2000) : null;
    const name = id(b.action);
    if (url && !name) button.url = url;
    else if (name) {
      button.action = { name };
      if (typeof b.value === 'string') button.action.value = b.value.slice(0, 2000);
    } else return;
    controls.push(add(button));
  });
  const choice = card.choice;
  const choiceName = choice && id(choice.action);
  const options = (choice && Array.isArray(choice.options) ? choice.options : [])
    .map((o: any) => ({
      label: str(o && o.label, 120),
      value: typeof (o && o.value) === 'string' ? o.value.slice(0, 2000) : null,
    }))
    .filter((o: any) => o.label && o.value)
    .slice(0, 20);
  if (choiceName && options.length) {
    const select: any = {
      id: 'choice',
      component: 'Select',
      action: { name: choiceName },
      options,
    };
    const placeholder = str(choice.placeholder, 120);
    if (placeholder) select.placeholder = placeholder;
    // The choice keeps its place in a full row: one row holds 5 controls.
    if (controls.length >= 5) controls.length = 4;
    controls.push(add(select));
  }
  if (controls.length) {
    const kept = new Set(controls.slice(0, 5));
    const row = add({ id: 'actions', component: 'Actions', children: [...kept] });
    children.push(row);
    for (let i = components.length - 1; i >= 0; i--) {
      const c = components[i];
      if ((c.component === 'Button' || c.component === 'Select') && !kept.has(c.id)) {
        components.splice(i, 1);
      }
    }
  }
  if (!children.length) return null;

  return [
    { version: 'v0.9.1', createSurface: { surfaceId, catalogId: 'raya.blocks.v1' } },
    {
      version: 'v0.9.1',
      updateComponents: {
        surfaceId,
        components: [{ id: 'root', component: 'Stack', children }, ...components],
      },
    },
  ];
}

/** Every string a person could read on the card, for the output guardrails. */
export function cardStrings(card: any): string[] {
  const out: string[] = [];
  const push = (v: any) => {
    if (typeof v === 'string' && v.trim()) out.push(v);
  };
  if (!card || typeof card !== 'object') return out;
  push(card.title);
  push(card.text);
  push(card.note);
  for (const f of Array.isArray(card.fields) ? card.fields : []) {
    push(f && f.label);
    push(f && f.value);
  }
  for (const b of Array.isArray(card.buttons) ? card.buttons : []) {
    push(b && b.label);
    push(b && b.url);
  }
  if (card.choice) {
    push(card.choice.placeholder);
    for (const o of Array.isArray(card.choice.options) ? card.choice.options : [])
      push(o && o.label);
  }
  return out;
}

/* eslint-enable @typescript-eslint/no-explicit-any */
