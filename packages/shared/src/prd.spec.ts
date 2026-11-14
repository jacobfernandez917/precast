import { describe, expect, it } from 'vitest';
import { prdBlueprintSchema, prdRecordSchema } from './prd.js';

const collection = {
  id: 'actions',
  label: 'Actions',
  singular: 'Action',
  fields: [
    { id: 'title', label: 'Title', type: 'text' as const, required: true, choices: [] },
    {
      id: 'status',
      label: 'Status',
      type: 'choice' as const,
      required: true,
      choices: ['Open', 'Done'],
    },
    { id: 'effort', label: 'Effort', type: 'number' as const, required: false, choices: [] },
  ],
};
const brief = {
  title: 'Action Desk',
  mission: 'Manage private actions.',
  audience: 'Individuals',
  agentJob: 'Help plan actions.',
  collections: [collection],
  acceptanceCriteria: ['Create and update an action.'],
};

describe('SHARED-009 PRD application contracts', () => {
  it('validates typed records without accepting extra fields, invented choices or empty required values', () => {
    const schema = prdRecordSchema(collection);
    expect(schema.parse({ title: '  Follow up  ', status: 'Open', effort: 3 })).toEqual({
      title: 'Follow up',
      status: 'Open',
      effort: 3,
    });
    for (const data of [
      { title: '', status: 'Open' },
      { title: 'Task', status: 'Unknown' },
      { title: 'Task', status: 'Open', ownerId: 'other-account' },
      { title: 'Task', status: 'Open', effort: Infinity },
    ])
      expect(schema.safeParse(data).success).toBe(false);
  });
  it('rejects ambiguous duplicate field and collection identities and unsafe keys', () => {
    expect(prdBlueprintSchema.safeParse(brief).success).toBe(true);
    expect(
      prdBlueprintSchema.safeParse({ ...brief, collections: [collection, collection] }).success,
    ).toBe(false);
    expect(
      prdBlueprintSchema.safeParse({
        ...brief,
        collections: [{ ...collection, fields: [...collection.fields, collection.fields[0]] }],
      }).success,
    ).toBe(false);
    expect(
      prdBlueprintSchema.safeParse({
        ...brief,
        collections: [{ ...collection, fields: [{ ...collection.fields[0], id: 'constructor' }] }],
      }).success,
    ).toBe(false);
  });
  it('requires real allowed values for choice fields', () => {
    expect(
      prdBlueprintSchema.safeParse({
        ...brief,
        collections: [{ ...collection, fields: [{ ...collection.fields[1], choices: [] }] }],
      }).success,
    ).toBe(false);
  });
});

describe('SHARED-010 project idea boundary cases', () => {
  it('rejects impossible calendar dates instead of normalizing them into another month', () => {
    const schema = prdRecordSchema({
      ...collection,
      fields: [{ id: 'due', label: 'Due', type: 'date' as const, required: true, choices: [] }],
    });
    for (const due of ['2026-02-29', '2026-02-30', '2026-04-31', '2026-13-01'])
      expect(schema.safeParse({ due }).success).toBe(false);
    expect(schema.safeParse({ due: '2028-02-29' }).success).toBe(true);
  });
  it('keeps zero and false values for numeric and checkbox projects', () => {
    const schema = prdRecordSchema({
      ...collection,
      fields: [
        { id: 'quantity', label: 'Quantity', type: 'number' as const, required: true, choices: [] },
        { id: 'done', label: 'Done', type: 'boolean' as const, required: true, choices: [] },
      ],
    });
    expect(schema.parse({ quantity: 0, done: false })).toEqual({ quantity: 0, done: false });
    expect(schema.safeParse({ quantity: '0', done: 'false' }).success).toBe(false);
  });
  it('rejects duplicate choice options in the product blueprint', () => {
    expect(
      prdBlueprintSchema.safeParse({
        ...brief,
        collections: [
          { ...collection, fields: [{ ...collection.fields[1], choices: ['Open', 'Open'] }] },
        ],
      }).success,
    ).toBe(false);
  });
});
