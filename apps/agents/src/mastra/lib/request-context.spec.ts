import { describe, expect, it } from 'vitest';
import {
  ON_BEHALF_OF_HEADER,
  attachOnBehalfOf,
  currentOnBehalfOf,
  resolveOnBehalfOf,
  runWithRequestContext,
} from './request-context';

/**
 * OBO-1 — end-user delegation (AGT-012).
 *
 * These target the SECURITY properties, because those are the ones whose
 * failure is silent and serious: a subject leaked to a third-party host, or a
 * subject that survives past its turn and gets attached to someone else's
 * request. Getting the happy path right is easy; those two are not.
 */
const AB = 'https://api.agentbase.test';

describe('request context', () => {
  it('is empty outside a turn', () => {
    expect(currentOnBehalfOf()).toBeUndefined();
  });

  it('exposes the subject inside a turn, and does not leak past it', () => {
    runWithRequestContext({ onBehalfOf: 'U123' }, () => {
      expect(currentOnBehalfOf()).toBe('U123');
    });
    expect(currentOnBehalfOf(), 'the subject must not survive the turn').toBeUndefined();
  });

  it('keeps concurrent turns separate', async () => {
    // The reason for AsyncLocalStorage rather than a module-level variable: two
    // in-flight requests must never see each other's user.
    const seen: string[] = [];
    const turn = (id: string, delay: number) =>
      runWithRequestContext({ onBehalfOf: id }, async () => {
        await new Promise((r) => setTimeout(r, delay));
        seen.push(currentOnBehalfOf()!);
      });
    await Promise.all([turn('alice', 20), turn('bob', 5), turn('carol', 10)]);
    expect(seen.sort()).toEqual(['alice', 'bob', 'carol']);
  });
});

describe('resolveOnBehalfOf precedence', () => {
  it('explicit input beats the inbound header', () => {
    runWithRequestContext({ onBehalfOf: 'from-header' }, () => {
      expect(resolveOnBehalfOf({ explicit: 'from-tool' })).toBe('from-tool');
    });
  });

  it('the inbound header beats a project fallback', () => {
    runWithRequestContext({ onBehalfOf: 'from-header' }, () => {
      expect(resolveOnBehalfOf({ projectFallback: () => 'from-cookie' })).toBe('from-header');
    });
  });

  it('does not even consult the fallback when something better answered', () => {
    let consulted = false;
    runWithRequestContext({ onBehalfOf: 'from-header' }, () => {
      resolveOnBehalfOf({
        projectFallback: () => {
          consulted = true;
          return 'x';
        },
      });
    });
    expect(consulted).toBe(false);
  });

  it('falls through to the project source, then to nothing', () => {
    expect(resolveOnBehalfOf({ projectFallback: () => 'from-cookie' })).toBe('from-cookie');
    expect(resolveOnBehalfOf()).toBeUndefined();
    expect(resolveOnBehalfOf({ explicit: '   ' }), 'blank is not a subject').toBeUndefined();
  });
});

describe('attachOnBehalfOf — the host guard', () => {
  it('attaches the subject on a call to AgentBase', () => {
    const h = new Headers();
    runWithRequestContext({ onBehalfOf: 'U123' }, () => {
      attachOnBehalfOf(h, `${AB}/proxy/mcp/acme/slack/mcp`, AB);
    });
    expect(h.get(ON_BEHALF_OF_HEADER)).toBe('U123');
  });

  it('NEVER attaches it to a third-party host', () => {
    // The leak this exists to prevent: an agent that also calls some vendor API
    // must not tell that vendor who its user is.
    const h = new Headers();
    runWithRequestContext({ onBehalfOf: 'U123' }, () => {
      attachOnBehalfOf(h, 'https://evil.example.com/collect', AB);
    });
    expect(h.get(ON_BEHALF_OF_HEADER)).toBeNull();
  });

  it('is not fooled by a host that merely starts with the base string', () => {
    // `startsWith` would pass `https://api.agentbase.test.evil.com`. Origin
    // comparison is why this uses URL parsing rather than string prefixes.
    const h = new Headers();
    runWithRequestContext({ onBehalfOf: 'U123' }, () => {
      attachOnBehalfOf(h, `${AB}.evil.com/collect`, AB);
    });
    expect(h.get(ON_BEHALF_OF_HEADER)).toBeNull();
  });

  it('sends nothing when there is no subject', () => {
    const h = new Headers();
    attachOnBehalfOf(h, `${AB}/proxy/mcp/x/y/mcp`, AB);
    expect(h.get(ON_BEHALF_OF_HEADER)).toBeNull();
  });

  it('sends nothing when no AgentBase base is known, or the URL is unparseable', () => {
    const h = new Headers();
    runWithRequestContext({ onBehalfOf: 'U123' }, () => {
      attachOnBehalfOf(h, `${AB}/x`, undefined);
      attachOnBehalfOf(h, 'not a url', AB);
    });
    expect(h.get(ON_BEHALF_OF_HEADER)).toBeNull();
  });
});
