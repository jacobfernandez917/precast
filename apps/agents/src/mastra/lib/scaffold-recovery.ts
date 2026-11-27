import { z } from 'zod';

export const scaffoldRecovery = z.object({
  state: z.literal('recovery_required'),
  code: z.literal('scaffold_preserved'),
  projectName: z.string(),
  projectPath: z.string(),
  failedStage: z.enum([
    'admission',
    'control',
    'clone',
    'bootstrap',
    'product-input',
    'product',
    'services',
    'service-verification',
    'verify',
    'build',
    'preview-authorization',
    'preview',
    'preview-handoff',
    'complete',
    'prd-settlement',
  ]),
  filesystem: z.enum(['not_touched', 'preserved_uninspected']),
  creationOwnership: z.literal('unproven'),
  rollback: z.literal('not_attempted'),
  rollbackReason: z.literal('conditional_rollback_unavailable'),
  serviceEffects: z.enum(['not_requested', 'review_required']),
  nextAction: z.literal('Review preserved project'),
  automaticRetry: z.literal(false),
  message: z.string(),
});

export function preserveScaffold(
  projectName: string,
  failedStage: z.infer<typeof scaffoldRecovery>['failedStage'],
  projectWriteAttempted: boolean,
  serviceSetupAttempted: boolean,
): z.infer<typeof scaffoldRecovery> {
  return {
    state: 'recovery_required',
    code: 'scaffold_preserved',
    projectName,
    projectPath: `Projects/${projectName}`,
    failedStage,
    filesystem: projectWriteAttempted ? 'preserved_uninspected' : 'not_touched',
    creationOwnership: 'unproven',
    rollback: 'not_attempted',
    rollbackReason: 'conditional_rollback_unavailable',
    serviceEffects: serviceSetupAttempted ? 'review_required' : 'not_requested',
    nextAction: 'Review preserved project',
    automaticRetry: false,
    message:
      `Scaffolding stopped at ${failedStage}. No cleanup was attempted. ` +
      `The owner/operator must inspect Projects/${projectName} and the Computer action status before continuing; its existence, exclusive creation and unchanged contents are not proven. ` +
      (serviceSetupAttempted
        ? 'Service setup may have changed external state. Review that outcome before retrying; no database or service cleanup was requested.'
        : 'Service setup was not requested. Preserve any existing or changed files; no automatic retry or deletion is safe.'),
  };
}
