/**
 * A2UI (https://a2ui.org), pinned at v0.9.1. Agents emit A2UI surfaces in the catalog
 * `raya.blocks.v1`, the vocabulary Raya renders and AgentBase's composed agents already use. The
 * catalog ships beside this package (`catalog/raya-blocks-v1.catalog.json`), pinned by its digest,
 * so a renderer and an agent can never disagree about which components exist.
 */
export const A2UI_VERSION = 'v0.9.1';
export const A2UI_EXTENSION_URI = 'https://a2ui.org/a2a-extension/a2ui/v0.9.1';
export const A2UI_MIME_TYPE = 'application/a2ui+json';
export const RAYA_BLOCKS_CATALOG_ID = 'raya.blocks.v1';
/** sha256 of `catalog/raya-blocks-v1.catalog.json`; Raya and AgentBase pin the same value. */
export const RAYA_BLOCKS_CATALOG_SHA256 =
  'dabef026373fb1cc235b5bb2d2ed2825e4a33c132acae0a69b15c68c9a6e0186';

/** The A2UI client-capabilities key a caller sets on `message.metadata`. */
export const A2UI_CLIENT_CAPABILITIES_KEY = 'a2uiClientCapabilities';

const MAX_EXTENSIONS = 8;
const MAX_EXTENSIONS_HEADER = 1024;

/**
 * A caller's `X-A2A-Extensions`, kept when it is a short list of absolute https URIs. Anything
 * else is dropped rather than refused: activation is optional, and the message metadata carries
 * the same intent.
 */
export function a2aExtensionsHeader(raw: string | string[] | undefined | null): string | null {
  const value = Array.isArray(raw) ? raw.join(',') : raw;
  if (!value || value.length > MAX_EXTENSIONS_HEADER) return null;
  const uris = value
    .split(',')
    .map((u) => u.trim())
    .filter(Boolean);
  if (!uris.length || uris.length > MAX_EXTENSIONS) return null;
  for (const uri of uris) {
    try {
      const url = new URL(uri);
      if (url.protocol !== 'https:' || url.username || url.password) return null;
    } catch {
      return null;
    }
  }
  return uris.join(', ');
}

/** The A2UI entry for an agent card's `capabilities.extensions`. */
export function a2uiAgentCardExtension(): {
  uri: string;
  description: string;
  required: boolean;
  params: { supportedCatalogIds: string[]; acceptsInlineCatalogs: boolean };
} {
  return {
    uri: A2UI_EXTENSION_URI,
    description: `Attaches interactive A2UI surfaces in the ${RAYA_BLOCKS_CATALOG_ID} catalog to replies.`,
    required: false,
    params: { supportedCatalogIds: [RAYA_BLOCKS_CATALOG_ID], acceptsInlineCatalogs: false },
  };
}

/** What a client that renders `raya.blocks.v1` sets as `message.metadata.a2uiClientCapabilities`. */
export function a2uiClientCapabilities(): Record<string, { supportedCatalogIds: string[] }> {
  return { [A2UI_VERSION]: { supportedCatalogIds: [RAYA_BLOCKS_CATALOG_ID] } };
}

/**
 * Whether a caller that declared A2UI capabilities can render `raya.blocks.v1`.
 *
 * A caller that declares nothing gets the surface anyway: the data part sits beside the text, so a
 * text-only client loses nothing, and activation is optional in the extension. A caller that
 * declares a catalog list without ours is saying it cannot draw the card, and is respected.
 */
export function clientAcceptsCatalog(metadata: unknown): boolean {
  const caps = (metadata as Record<string, unknown> | null | undefined)?.[
    A2UI_CLIENT_CAPABILITIES_KEY
  ];
  if (!caps || typeof caps !== 'object') return true;
  const forVersion = (caps as Record<string, unknown>)[A2UI_VERSION];
  if (!forVersion || typeof forVersion !== 'object') return false;
  const ids = (forVersion as { supportedCatalogIds?: unknown }).supportedCatalogIds;
  return Array.isArray(ids) && ids.includes(RAYA_BLOCKS_CATALOG_ID);
}
