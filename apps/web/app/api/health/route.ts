import type { HealthStatus } from '@precast/shared';
import { NextResponse } from 'next/server';
import { log } from '../../lib/logger';
import { signInStatus } from '../../lib/auth';

// Always evaluate at request time so `uptime`/`timestamp` are live.
export const dynamic = 'force-dynamic';

export function GET(): NextResponse<HealthStatus> {
  log.debug('GET /api/health');
  const signIn = signInStatus();
  return NextResponse.json<HealthStatus>({
    // Sign-in is required before chat, so without it the app cannot be used.
    status: signIn === 'ready' || signIn === 'starting' ? 'ok' : 'degraded',
    version: '0.1.0',
    uptime: process.uptime(),
    timestamp: new Date().toISOString(),
    services: {},
    signIn,
  });
}
