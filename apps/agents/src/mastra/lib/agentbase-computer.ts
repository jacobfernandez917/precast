import { createHash } from 'node:crypto';
import { attachAgentBaseProof } from './request-context';
import { getAgentBaseToken } from './agentbase-model';

const PROFILE = 'developer' as const;
const ADMISSION_TIMEOUT_MS = 10 * 60_000;
const POLL_MS = 2_000;

export interface ComputerCommand {
  id: string;
  label: string;
  executable: 'git' | 'pnpm';
  argv: string[];
  cwd: string;
  timeoutMs: number;
  memoryMiB?: number;
}

export interface ComputerCommandResult {
  id: string;
  label: string;
  state: 'succeeded';
  stdout: string;
  stderr: string;
}

interface RunView {
  id: string;
  state: string;
}

interface LeaseView {
  id: string;
}

interface ActionView {
  id: string;
  state: string;
  failureCode?: string | null;
  failureMessage?: string | null;
}

interface ApiErrorBody {
  code?: string;
  message?: string;
  reason?: string;
}

export class ComputerApiError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

export function argumentDigest(args: Record<string, unknown>): string {
  const canonical = JSON.stringify(
    Object.fromEntries(
      Object.entries(args)
        .filter(([, value]) => value !== undefined)
        .sort(([a], [b]) => (a < b ? -1 : 1)),
    ),
  );
  return `sha256:${createHash('sha256').update(canonical).digest('hex')}`;
}

function stableKey(...parts: string[]): string {
  return createHash('sha256').update(parts.join('\u0000')).digest('hex').slice(0, 40);
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function outputText(value: unknown): string {
  if (!value || typeof value !== 'object') return '';
  const content = (value as { content?: unknown }).content;
  return typeof content === 'string' ? content : '';
}

export class AgentBaseComputerClient {
  private readonly base: string;

  constructor(
    private readonly agentId: string,
    base = process.env.AGENTBASE_URL,
    private readonly fetcher: typeof fetch = fetch,
  ) {
    if (!base?.trim()) {
      throw new Error('AGENTBASE_URL is required for the scaffold-builder Computer workflow.');
    }
    this.base = base.replace(/\/+$/, '');
  }

  private async request<T>(path: string, init: RequestInit = {}): Promise<T> {
    const url = `${this.base}${path}`;
    const headers = new Headers(init.headers);
    headers.set('accept', 'application/json');
    if (init.body) headers.set('content-type', 'application/json');
    headers.set('authorization', `Bearer ${await getAgentBaseToken(this.agentId)}`);
    attachAgentBaseProof(headers, url, this.base);
    const response = await this.fetcher(url, { ...init, headers });
    const body = (await response.json().catch(() => ({}))) as T & ApiErrorBody;
    if (!response.ok) {
      throw new ComputerApiError(
        body.code ?? `computer_http_${response.status}`,
        body.message ??
          body.reason ??
          `AgentBase Computer request failed (HTTP ${response.status}).`,
        response.status,
      );
    }
    return body;
  }

  async createRun(idempotencySeed: string): Promise<{ run: RunView; lease: LeaseView }> {
    return this.request('/computer-agent/runs/resolved', {
      method: 'POST',
      body: JSON.stringify({
        requestedProfile: PROFILE,
        idempotencyKey: `precast-scaffold:${stableKey(idempotencySeed)}`,
        dataClassification: 'internal',
      }),
    });
  }

  async waitUntilRunning(runId: string): Promise<RunView> {
    const deadline = Date.now() + ADMISSION_TIMEOUT_MS;
    for (;;) {
      const { run } = await this.request<{ run: RunView }>(`/computer-agent/runs/${runId}`);
      if (run.state === 'RUNNING') return run;
      if (!['CREATED', 'AUTHORIZING', 'QUEUED', 'STARTING'].includes(run.state)) {
        throw new Error(`Computer run ${runId} entered ${run.state} before the scaffold started.`);
      }
      if (Date.now() >= deadline) {
        throw new Error('Timed out waiting for the member Computer to admit the scaffold run.');
      }
      await delay(POLL_MS);
    }
  }

  async takeControl(runId: string, leaseId: string): Promise<number> {
    const { session } = await this.request<{ session: { controlEpoch: number } }>(
      `/computer-agent/runs/${runId}/control/take`,
      { method: 'POST', body: JSON.stringify({ leaseId }) },
    );
    return session.controlEpoch;
  }

  async runCommand(
    runId: string,
    leaseId: string,
    controlEpoch: number,
    command: ComputerCommand,
    idempotencySeed: string,
  ): Promise<ComputerCommandResult> {
    const args = {
      executable: command.executable,
      argv: command.argv,
      cwd: command.cwd,
      timeoutMs: command.timeoutMs,
      ...(command.memoryMiB === undefined ? {} : { memoryMiB: command.memoryMiB }),
      waitMs: 10_000,
      profile: PROFILE,
    };
    const digest = argumentDigest(args);
    const { action, decision } = await this.request<{
      action: ActionView;
      decision: { verdict: string; reason?: string };
    }>(`/computer-agent/runs/${runId}/actions`, {
      method: 'POST',
      body: JSON.stringify({
        leaseId,
        operation: 'command_run',
        retryClass: 'idempotent_write',
        idempotencyKey: `precast:${stableKey(idempotencySeed, command.id)}`,
        target: {
          path: command.cwd,
          commandProfile: PROFILE,
          argumentDigest: digest,
          actionDescription: command.label,
        },
        provenance: { authorityFrom: 'member' },
        controlEpoch,
      }),
    });
    if (decision.verdict !== 'allow') {
      throw new Error(
        decision.verdict === 'needs_person'
          ? `${command.label} is waiting for the member's approval (${decision.reason ?? 'policy'}).`
          : `${command.label} was refused (${decision.reason ?? 'policy'}).`,
      );
    }

    const stateHash = argumentDigest({ runId, actionId: action.id, command: command.id });
    await this.request(`/computer-agent/runs/${runId}/actions/${action.id}/commit`, {
      method: 'POST',
      body: JSON.stringify({ leaseId, stateHash, controlEpoch }),
    });
    await this.request(`/computer-agent/runs/${runId}/actions/${action.id}/execute`, {
      method: 'POST',
      body: JSON.stringify({ leaseId, arguments: args }),
    });

    const deadline = Date.now() + command.timeoutMs + 60_000;
    for (;;) {
      const result = await this.request<{
        action: ActionView;
        command: { state: string; exitCode?: number | null };
        output?: unknown;
      }>(
        `/computer-agent/runs/${runId}/actions/${action.id}/command?stream=stdout&offset=0&maxBytes=262144`,
      );
      const stdout = outputText(result.output);
      if (['SUCCEEDED', 'FAILED', 'CANCELED'].includes(result.action.state)) {
        const stderrResult = await this.request<{ output?: unknown }>(
          `/computer-agent/runs/${runId}/actions/${action.id}/command?stream=stderr&offset=0&maxBytes=262144`,
        );
        const stderr = outputText(stderrResult.output);
        if (result.action.state !== 'SUCCEEDED' || result.command.exitCode !== 0) {
          const detail =
            stderr || stdout || result.action.failureMessage || result.action.failureCode;
          throw new Error(`${command.label} failed${detail ? `: ${detail.slice(-4000)}` : '.'}`);
        }
        return { id: command.id, label: command.label, state: 'succeeded', stdout, stderr };
      }
      if (Date.now() >= deadline)
        throw new Error(`${command.label} did not settle before its deadline.`);
      await delay(POLL_MS);
    }
  }

  async complete(
    runId: string,
    leaseId: string,
    outcome: 'succeeded' | 'failed',
    summary: string,
  ): Promise<void> {
    await this.request(`/computer-agent/runs/${runId}/complete`, {
      method: 'POST',
      body: JSON.stringify({
        leaseId,
        outcome,
        summary: summary.slice(0, 2000),
        ...(outcome === 'failed' ? { failureCode: 'precast_scaffold_failed' } : {}),
      }),
    });
  }
}
