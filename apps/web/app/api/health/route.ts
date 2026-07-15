import type { HealthStatus } from '@precast/shared';
import { NextResponse } from 'next/server';

// Always evaluate at request time so `uptime`/`timestamp` are live.
export const dynamic = 'force-dynamic';

export function GET(): NextResponse<HealthStatus> {
  return NextResponse.json<HealthStatus>({
    status: 'ok',
    version: '0.1.0',
    uptime: process.uptime(),
    timestamp: new Date().toISOString(),
    services: {},
  });
}
