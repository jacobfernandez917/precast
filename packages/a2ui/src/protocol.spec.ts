import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  a2aExtensionsHeader,
  a2uiClientCapabilities,
  a2uiAgentCardExtension,
  A2UI_EXTENSION_URI,
  A2UI_VERSION,
  clientAcceptsCatalog,
  RAYA_BLOCKS_CATALOG_ID,
  RAYA_BLOCKS_CATALOG_SHA256,
} from './protocol.js';

const catalogText = readFileSync(
  new URL('../catalog/raya-blocks-v1.catalog.json', import.meta.url),
  'utf8',
);

/** SHR-002: the catalog is the one Raya and AgentBase pin, and the extension is pinned at v0.9.1. */
describe('SHR-002 pinned catalog and extension', () => {
  it('is byte for byte the catalog Raya and AgentBase pin', () => {
    expect(createHash('sha256').update(catalogText).digest('hex')).toBe(RAYA_BLOCKS_CATALOG_SHA256);
    const catalog = JSON.parse(catalogText) as {
      catalogId: string;
      components: Record<string, unknown>;
    };
    expect(catalog.catalogId).toBe(RAYA_BLOCKS_CATALOG_ID);
    expect(Object.keys(catalog.components)).toHaveLength(13);
  });

  it('pins A2UI v0.9.1', () => {
    expect(A2UI_VERSION).toBe('v0.9.1');
    expect(A2UI_EXTENSION_URI).toBe('https://a2ui.org/a2a-extension/a2ui/v0.9.1');
  });

  it('advertises the catalog it emits, optional, with no inline catalogs', () => {
    expect(a2uiAgentCardExtension()).toMatchObject({
      uri: A2UI_EXTENSION_URI,
      required: false,
      params: { supportedCatalogIds: [RAYA_BLOCKS_CATALOG_ID], acceptsInlineCatalogs: false },
    });
  });
});

describe('SHR-002 extension header filter', () => {
  it('keeps a short list of absolute https URIs', () => {
    expect(a2aExtensionsHeader(A2UI_EXTENSION_URI)).toBe(A2UI_EXTENSION_URI);
    expect(a2aExtensionsHeader(` ${A2UI_EXTENSION_URI} ,https://example.com/ext/v1`)).toBe(
      `${A2UI_EXTENSION_URI}, https://example.com/ext/v1`,
    );
    expect(a2aExtensionsHeader([A2UI_EXTENSION_URI, 'https://example.com/ext/v1'])).toBe(
      `${A2UI_EXTENSION_URI}, https://example.com/ext/v1`,
    );
  });

  it('drops anything else instead of refusing the call', () => {
    for (const bad of [
      undefined,
      '',
      'a2ui',
      'http://a2ui.org/a2a-extension/a2ui/v0.9.1',
      'https://user:pw@example.com/ext',
      Array.from({ length: 9 }, (_, i) => `https://example.com/e${i}`).join(','),
      `https://example.com/${'x'.repeat(1100)}`,
    ])
      expect(a2aExtensionsHeader(bad)).toBeNull();
  });
});

describe('SHR-002 client capabilities', () => {
  const caps = (ids: string[]) => ({
    a2uiClientCapabilities: { 'v0.9.1': { supportedCatalogIds: ids } },
  });

  it('sends the card to a caller that declared nothing, since the text still stands alone', () => {
    expect(clientAcceptsCatalog(undefined)).toBe(true);
    expect(clientAcceptsCatalog({ resourceId: 'u1' })).toBe(true);
  });

  it('respects a caller whose declared catalogs leave ours out', () => {
    expect(clientAcceptsCatalog(caps([RAYA_BLOCKS_CATALOG_ID]))).toBe(true);
    expect(clientAcceptsCatalog(caps(['https://a2ui.org/catalogs/basic']))).toBe(false);
    expect(
      clientAcceptsCatalog({
        a2uiClientCapabilities: { 'v1.0': { supportedCatalogIds: [RAYA_BLOCKS_CATALOG_ID] } },
      }),
    ).toBe(false);
  });
});

describe('SHR-002 client capabilities builder', () => {
  it('declares exactly the catalog this package renders, and passes its own check', () => {
    const caps = a2uiClientCapabilities();
    expect(caps).toEqual({ 'v0.9.1': { supportedCatalogIds: [RAYA_BLOCKS_CATALOG_ID] } });
    expect(clientAcceptsCatalog({ a2uiClientCapabilities: caps })).toBe(true);
  });
});
