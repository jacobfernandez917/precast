/** Internal UUID markers are never part of the scaffold builder's conversational answer. */
export function scaffoldReplyText(text: string): string {
  let result = text;
  for (let i = 0; i < 3; i++) {
    const match = /^\s*([A-Za-z0-9+/]{48})/.exec(result);
    if (!match) break;
    const decoded = Buffer.from(match[1]!, 'base64').toString('utf8');
    if (
      !/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(decoded) ||
      Buffer.from(decoded).toString('base64') !== match[1]
    )
      break;
    result = result.slice(match[0].length).trimStart();
  }
  return result;
}

export function sanitizeScaffoldReply(payload: unknown): unknown {
  if (!payload || typeof payload !== 'object') return payload;
  const rpc = payload as { result?: Record<string, unknown> };
  const result = rpc.result;
  if (!result) return payload;
  const cleanParts = (message: unknown) => {
    if (!message || typeof message !== 'object') return;
    const parts = (message as { parts?: unknown }).parts;
    if (!Array.isArray(parts)) return;
    for (const part of parts)
      if (
        part &&
        (part.kind === 'text' || part.type === 'text' || (!part.kind && !part.type)) &&
        typeof part.text === 'string'
      )
        part.text = scaffoldReplyText(part.text);
  };
  for (const target of [result, result.task, result.message]) {
    if (!target || typeof target !== 'object') continue;
    const value = target as { artifacts?: unknown; status?: { message?: unknown } };
    cleanParts(target);
    cleanParts(value.status?.message);
    if (Array.isArray(value.artifacts))
      for (const artifact of value.artifacts) cleanParts(artifact);
  }
  return payload;
}
