export function commandFailureReason(result) {
  if (result.signal) return `signal ${result.signal}`;
  if (result.error) return `spawn ${result.error.code ?? 'failed'}`;
  return result.status === null ? 'exit status unavailable' : `exit ${result.status}`;
}
