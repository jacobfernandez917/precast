import { z } from 'zod';

const identifier = z.string().regex(/^[a-z][a-z0-9_]{0,47}$/);
export const prdFieldSchema = z
  .object({
    id: identifier,
    label: z.string().min(1).max(80),
    type: z.enum(['text', 'number', 'date', 'boolean', 'choice']),
    required: z.boolean(),
    choices: z.array(z.string().min(1).max(80)).max(20),
  })
  .strict();

export const prdBlueprintSchema = z
  .object({
    title: z.string().min(1).max(120),
    mission: z.string().min(1).max(2000),
    audience: z.string().min(1).max(1000),
    agentJob: z.string().min(1).max(2000),
    collections: z
      .array(
        z
          .object({
            id: identifier,
            label: z.string().min(1).max(80),
            singular: z.string().min(1).max(80),
            fields: z.array(prdFieldSchema).min(1).max(16),
          })
          .strict(),
      )
      .min(1)
      .max(8),
    acceptanceCriteria: z.array(z.string().min(1).max(1000)).min(1).max(30),
  })
  .strict()
  .superRefine((brief, ctx) => {
    const collections = new Set<string>();
    for (const [i, collection] of brief.collections.entries()) {
      if (collections.has(collection.id))
        ctx.addIssue({
          code: 'custom',
          path: ['collections', i, 'id'],
          message: 'Collection identifiers must be unique.',
        });
      collections.add(collection.id);
      const fields = new Set<string>();
      for (const [j, field] of collection.fields.entries()) {
        if (fields.has(field.id) || ['__proto__', 'constructor', 'prototype'].includes(field.id))
          ctx.addIssue({
            code: 'custom',
            path: ['collections', i, 'fields', j, 'id'],
            message: 'Field identifiers must be unique and safe.',
          });
        fields.add(field.id);
        if (field.type === 'choice' && !field.choices.length)
          ctx.addIssue({
            code: 'custom',
            path: ['collections', i, 'fields', j, 'choices'],
            message: 'A choice field needs its allowed values.',
          });
      }
    }
  });

export type PrdBlueprint = z.infer<typeof prdBlueprintSchema>;
export type PrdRecord = {
  id: string;
  collection: string;
  data: Record<string, string | number | boolean>;
  createdAt: string;
  updatedAt: string;
};

export function prdRecordSchema(collection: PrdBlueprint['collections'][number]) {
  return z
    .object(
      Object.fromEntries(
        collection.fields.map((field) => {
          let value: z.ZodTypeAny =
            field.type === 'number'
              ? z.number().finite()
              : field.type === 'boolean'
                ? z.boolean()
                : field.type === 'choice'
                  ? z.string().refine((v) => field.choices.includes(v), 'Choose an allowed value.')
                  : field.type === 'date'
                    ? z
                        .string()
                        .regex(/^\d{4}-\d{2}-\d{2}$/)
                        .refine((v) => !Number.isNaN(Date.parse(v)), 'Use a valid date.')
                    : z.string().trim().max(5000);
          if (field.required && field.type === 'text') value = z.string().trim().min(1).max(5000);
          if (!field.required) value = value.optional();
          return [field.id, value];
        }),
      ),
    )
    .strict();
}
