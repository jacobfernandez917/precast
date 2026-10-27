/**
 * Shared types.
 *
 * Add project-wide types here. This is initially empty — extend as needed.
 */

// ── Generic API Types ──────────────────────────────────────────────────────

export interface ApiResponse<T> {
  success: boolean;
  data?: T;
  error?: string;
  message?: string;
}

export interface PaginatedResponse<T> {
  rows: T[];
  total: number;
  page: number;
  pageSize: number;
}

export interface HealthStatus {
  status: 'ok' | 'degraded' | 'down';
  version: string;
  uptime: number;
  timestamp: string;
  services: Record<string, 'up' | 'down'>;
  /**
   * Whether people can sign in (the web app requires it before chat). A reason
   * code only: the detail stays in the server log.
   */
  signIn?: 'ready' | 'missing-secret' | 'missing-database' | 'database-error' | 'starting';
}
