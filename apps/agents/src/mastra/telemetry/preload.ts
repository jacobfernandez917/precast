/**
 * The production container's first module: `node --import ./telemetry.mjs index.mjs`
 * (apps/agents/Dockerfile). Built by `pnpm build:telemetry` with the packages left
 * external, so it resolves the same node_modules as the Mastra bundle. Starting
 * here puts propagation and the http/fetch instrumentation in place before any
 * module of the app graph is evaluated; the call in `mastra/index.ts` then finds
 * telemetry already started and does nothing.
 */
import { startAgentTelemetry } from './otel';

startAgentTelemetry();
