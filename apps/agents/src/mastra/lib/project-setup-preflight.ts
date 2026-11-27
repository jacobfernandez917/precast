import { z } from 'zod';
import type { ComputerCommand } from './agentbase-computer';

export const setupPreflightStatus = z.enum([
  'ready',
  'setup_project_mismatch',
  'setup_grant_expired',
  'setup_secret_not_granted',
  'invalid_setup_grant',
]);

export const projectAccessRequired = z.object({
  state: z.literal('blocked'),
  code: z.enum([
    'setup_project_mismatch',
    'setup_grant_expired',
    'setup_secret_not_granted',
    'invalid_setup_grant',
    'setup_preflight_unavailable',
  ]),
  projectName: z.string(),
  projectPath: z.string(),
  projectCreated: z.literal(false),
  nextAction: z.literal('Configure project access'),
  message: z.string(),
});

// Fixed, dependency-free code runs before the template exists. Only the leased
// descriptor is read; no grant value is returned or interpolated into source.
const source = String.raw`
const { readSync } = require('node:fs');
let status = 'invalid_setup_grant';
try {
  const [projectName, services] = process.argv.slice(1);
  const fd = process.env.RAYA_SECRET_FD_PRECAST_PROJECT_SETUP;
  if (!/^[3-6]$/.test(fd || '')) {
    status = 'setup_secret_not_granted';
  } else {
    const buffer = Buffer.alloc(65537);
    let length = 0;
    for (;;) {
      const count = readSync(Number(fd), buffer, length, buffer.length - length, null);
      length += count;
      if (!count || length === buffer.length) break;
    }
    if (length > 65536) throw new Error();
    const grant = JSON.parse(buffer.subarray(0, length).toString('utf8'));
    const reuse = services === 'existing-postgres-gemini';
    if (!['hannibal-gemini', 'existing-postgres-gemini'].includes(services)) throw new Error();
    const required = [
      'projectName', 'applicationId', 'clientId', 'clientSecret', 'apiUrl', 'tokenUrl',
      'modelSlug', 'modelId', 'modelListingId', 'modelOrg', 'databaseHost', 'expiresAt',
      ...(reuse ? ['databaseUrl', 'databaseName'] : ['hannibalSlug', 'hannibalListingId', 'hannibalOrg']),
    ];
    const allowed = [...required, 'previewFrameAncestor', ...(reuse ? ['databaseCaPem'] : [])];
    if (!grant || typeof grant !== 'object' || Array.isArray(grant) ||
        !Object.keys(grant).every(key => allowed.includes(key)) ||
        !required.every(key => typeof grant[key] === 'string' && grant[key].length > 0 &&
          grant[key].length <= (key === 'databaseUrl' ? 8192 : 2048) && !/[\r\n\0]/.test(grant[key])))
      throw new Error();
    if (!/^[a-z][a-z0-9-]{1,62}$/.test(projectName) || grant.projectName !== projectName) {
      status = 'setup_project_mismatch';
    } else {
      const now = Date.now();
      const expires = Date.parse(grant.expiresAt);
      status = expires > now && expires <= now + 24 * 60 * 60000 ? 'ready' : 'setup_grant_expired';
    }
    buffer.fill(0);
  }
} catch {
  status = 'invalid_setup_grant';
}
process.stdout.write(status);
`;

export function projectSetupPreflightCommand(
  projectName: string,
  services: 'hannibal-gemini' | 'existing-postgres-gemini',
): ComputerCommand {
  return {
    id: 'setup-preflight',
    label: 'Check approved project access before creating files',
    executable: 'node',
    argv: ['-e', source, projectName, services],
    cwd: 'Projects',
    timeoutMs: 30_000,
    memoryMiB: 128,
    secrets: [
      { alias: 'precast_project_setup', purpose: `Check setup access only for ${projectName}` },
    ],
  };
}

export function configureProjectAccess(
  projectName: string,
  code: z.infer<typeof projectAccessRequired>['code'],
): z.infer<typeof projectAccessRequired> {
  return {
    state: 'blocked',
    code,
    projectName,
    projectPath: `Projects/${projectName}`,
    projectCreated: false,
    nextAction: 'Configure project access',
    message:
      `No project files were created. Ask the owner/operator to configure approved setup access for exactly ${projectName} in AgentBase/Raya, then retry. ` +
      'Keep existing project bindings unchanged; do not paste credentials into chat. If the preflight action needs approval or is unsupported, resolve that in Computer before retrying.',
  };
}
