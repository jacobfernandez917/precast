import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  cardStrings,
  cardToA2ui,
  SHOW_CARD_INPUT_SCHEMA,
  SHOW_CARD_INSTRUCTIONS,
} from './show-card.js';

type Component = Record<string, unknown> & { id: string; component: string };
type Catalog = {
  components: Record<string, { allOf: Array<{ properties?: Record<string, unknown> }> }>;
};

const catalog = JSON.parse(
  readFileSync(new URL('../catalog/raya-blocks-v1.catalog.json', import.meta.url), 'utf8'),
) as Catalog;
/** Every component is in the catalog and carries only the properties its schema names. */
function offCatalog(components: Component[]): string[] {
  const problems: string[] = [];
  for (const c of components) {
    const schema = catalog.components[c.component];
    if (!schema) {
      problems.push(`${c.id}: ${c.component} is not in the catalog`);
      continue;
    }
    const allowed = new Set(['id', ...Object.keys(schema.allOf[1]?.properties ?? {})]);
    for (const key of Object.keys(c)) {
      if (!allowed.has(key)) problems.push(`${c.id}: ${c.component} has no property ${key}`);
    }
  }
  return problems;
}

function componentsOf(messages: unknown[] | null): Component[] {
  const update = (messages ?? [])[1] as { updateComponents: { components: Component[] } };
  return update.updateComponents.components;
}

const deployCard = {
  title: 'Deploy failed',
  text: 'Staging is still on the previous build.',
  fields: [
    { label: 'Commit', value: '4f21a9' },
    { label: 'Duration', value: '3m 12s' },
  ],
  note: 'From the build pipeline',
  buttons: [
    { label: 'Retry deploy', action: 'retry', value: '4f21a9', style: 'primary' },
    { label: 'Open the log', url: 'https://example.com/log' },
  ],
  choice: {
    action: 'pick_env',
    placeholder: 'Environment',
    options: [
      { label: 'Staging', value: 'staging' },
      { label: 'Production', value: 'prod' },
    ],
  },
};

/** SHR-003: the flat card becomes A2UI in the raya.blocks.v1 catalog, inside its limits. */
describe('SHR-003 show_card becomes an A2UI surface', () => {
  it('draws the card as one surface of catalog components', () => {
    const messages = cardToA2ui(deployCard, 'card-1');
    expect(messages?.[0]).toEqual({
      version: 'v0.9.1',
      createSurface: { surfaceId: 'card-1', catalogId: 'raya.blocks.v1' },
    });
    const components = componentsOf(messages);
    expect(components[0]).toEqual({
      id: 'root',
      component: 'Stack',
      children: ['title', 'body', 'note', 'actions'],
    });
    expect(components.map((c) => c.component)).toEqual([
      'Stack',
      'Header',
      'Section',
      'Context',
      'Button',
      'Button',
      'Select',
      'Actions',
    ]);
    expect(offCatalog(components)).toEqual([]);
    expect(components.find((c) => c.id === 'button-0')).toEqual({
      id: 'button-0',
      component: 'Button',
      label: 'Retry deploy',
      variant: 'primary',
      action: { name: 'retry', value: '4f21a9' },
    });
    expect(components.find((c) => c.id === 'button-1')).toEqual({
      id: 'button-1',
      component: 'Button',
      label: 'Open the log',
      url: 'https://example.com/log',
    });
  });

  it('keeps a row to 5 controls, the dropdown included', () => {
    const buttons = Array.from({ length: 5 }, (_, i) => ({ label: `B${i}`, action: `b${i}` }));
    const components = componentsOf(cardToA2ui({ ...deployCard, buttons }, 'card-2'));
    const row = components.find((c) => c.component === 'Actions') as unknown as {
      children: string[];
    };
    expect(row.children).toEqual(['button-0', 'button-1', 'button-2', 'button-3', 'choice']);
    expect(components.filter((c) => c.component === 'Button')).toHaveLength(4);
  });

  it('drops what the catalog would refuse and keeps the rest', () => {
    const components = componentsOf(
      cardToA2ui(
        {
          title: 'x'.repeat(500),
          buttons: [
            { label: 'No action or link' },
            { label: 'Bad id', action: 'has spaces' },
            { label: 'Plain http', url: 'http://example.com' },
            { label: 'Both', action: 'go', url: 'https://example.com' },
          ],
          fields: [{ label: 'Only a label' }],
          script: '<script>alert(1)</script>',
        },
        'card-3',
      ),
    );
    expect(
      (components.find((c) => c.id === 'title') as unknown as { text: string }).text,
    ).toHaveLength(120);
    const buttons = components.filter((c) => c.component === 'Button');
    expect(buttons).toEqual([
      { id: 'button-3', component: 'Button', label: 'Both', action: { name: 'go' } },
    ]);
    expect(components.some((c) => c.component === 'Section')).toBe(false);
    expect(offCatalog(components)).toEqual([]);
  });

  it('is null when nothing would show', () => {
    expect(cardToA2ui({}, 'card-4')).toBeNull();
    expect(cardToA2ui(null, 'card-4')).toBeNull();
    expect(cardToA2ui({ buttons: [{ label: 'x' }] }, 'card-4')).toBeNull();
  });

  it('lists every string a person could read, for the output guardrails', () => {
    expect(cardStrings(deployCard)).toEqual([
      'Deploy failed',
      'Staging is still on the previous build.',
      'From the build pipeline',
      'Commit',
      '4f21a9',
      'Duration',
      '3m 12s',
      'Retry deploy',
      'Open the log',
      'https://example.com/log',
      'Environment',
      'Staging',
      'Production',
    ]);
  });

  it('runs the same from its emitted source, as the container runs it', () => {
    // eslint-disable-next-line @typescript-eslint/no-implied-eval -- the generator emits this text
    const emitted = new Function(`${cardToA2ui.toString()}; return cardToA2ui;`)() as (
      card: unknown,
      id: string,
    ) => unknown;
    expect(emitted(deployCard, 'card-1')).toEqual(cardToA2ui(deployCard, 'card-1'));
  });

  it("states the catalog's limits in the tool's input schema", () => {
    expect(SHOW_CARD_INPUT_SCHEMA.properties.buttons.maxItems).toBe(5);
    expect(SHOW_CARD_INPUT_SCHEMA.properties.fields.maxItems).toBe(10);
    expect(SHOW_CARD_INPUT_SCHEMA.properties.choice.properties.options.maxItems).toBe(20);
    expect(SHOW_CARD_INPUT_SCHEMA.properties.title.maxLength).toBe(120);
  });
});

describe('SHR-003 show_card instructions', () => {
  it('tell the agent both forms a press arrives in', () => {
    expect(SHOW_CARD_INSTRUCTIONS).toContain('show_card');
    expect(SHOW_CARD_INSTRUCTIONS).toContain('raya.interaction');
    expect(SHOW_CARD_INSTRUCTIONS).toContain('a2ui.action');
  });
});
