import { describe, expect, it } from 'vitest';
import { scaffoldReplyText, sanitizeScaffoldReply } from './scaffold-reply';
describe('scaffold conversational reply privacy', () => {
  const marker = Buffer.from('00000000-0000-4000-8000-000000000001').toString('base64');
  it('removes a canonical internal UUID marker even when it is glued to the question', () => {
    expect(scaffoldReplyText(marker + 'What should the project be called?')).toBe(
      'What should the project be called?',
    );
    expect(scaffoldReplyText(marker)).toBe('');
    expect(scaffoldReplyText('Use Projects/my-app and https://example.srv.us')).toContain(
      'Projects/my-app',
    );
    expect(scaffoldReplyText('Explain ' + marker)).toBe('Explain ' + marker);
  });
  it('cleans only A2A reply text parts and preserves execution metadata and non-text data', () => {
    const reply = {
      result: {
        kind: 'task',
        status: { state: 'completed' },
        artifacts: [
          {
            parts: [
              { kind: 'text', text: marker },
              { kind: 'text', text: 'Use the Nova theme?' },
              { kind: 'data', data: { text: marker } },
            ],
          },
        ],
        metadata: { internal: marker },
      },
    };
    sanitizeScaffoldReply(reply);
    expect(reply.result.artifacts[0]!.parts[0]!.text).toBe('');
    expect(reply.result.artifacts[0]!.parts[1]!.text).toBe('Use the Nova theme?');
    expect(reply.result.metadata.internal).toBe(marker);
    expect(reply.result.artifacts[0]!.parts[2]!.data?.text).toBe(marker);
  });
});
