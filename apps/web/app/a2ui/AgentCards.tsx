'use client';

import { useEffect, useRef, useState } from 'react';
import { A2uiSurface, type ReactCatalogComponent } from '@a2ui/react/v0_9';
import {
  MessageProcessor,
  STRICT_VALIDATION,
  type ActionPayload,
  type SurfaceModel,
} from '@a2ui/web_core/v0_9';
import { rayaBlocksCatalog } from './catalog';

type Surface = SurfaceModel<ReactCatalogComponent>;

/** A press on a card, as the route handler accepts it (`readPressAction`). */
export interface CardPress {
  name: string;
  value?: string;
  surfaceId: string;
  sourceComponentId: string;
  context: Record<string, unknown>;
}

interface Props {
  /** The A2UI messages one agent reply attached, as `AgentReply.a2ui` returns them. */
  messages: unknown[];
  onPress: (press: CardPress) => void | Promise<void>;
}

/**
 * Draws the cards one agent reply attached. Each reply gets its own message processor, so a
 * surface id reused across turns cannot update an earlier card, and the catalog's limits
 * (one surface per message) are checked per reply. The processor validates every component
 * against `rayaBlocksCatalog` and reports what it refuses to the console, continuing with the
 * rest, which is the catalog's own rule for an unnamed component.
 *
 * The processor is created inside the effect and disposed in its cleanup: a processor shared
 * across effect runs would see `createSurface` twice under StrictMode and refuse the second.
 * `onPress` is read through a ref so a parent re-render never rebuilds the card.
 *
 * Loaded with `next/dynamic` and `ssr: false` (see AgentChat.tsx): `@a2ui/react` extends
 * `HTMLElement` at import time, so it cannot run on the server.
 */
export function AgentCards({ messages, onPress }: Props) {
  const onPressRef = useRef(onPress);
  onPressRef.current = onPress;
  const [surfaces, setSurfaces] = useState<Surface[]>([]);

  useEffect(() => {
    const processor = new MessageProcessor<ReactCatalogComponent>(
      [rayaBlocksCatalog],
      (action: ActionPayload) =>
        onPressRef.current({
          name: action.name,
          ...(typeof action.context.value === 'string' ? { value: action.context.value } : {}),
          surfaceId: action.surfaceId,
          sourceComponentId: action.sourceComponentId,
          context: action.context,
        }),
      { validationConfig: STRICT_VALIDATION },
    );
    const sync = () => setSurfaces(Array.from(processor.getSurfaces().values()));
    const created = processor.onSurfaceCreated(sync);
    const deleted = processor.onSurfaceDeleted(sync);
    try {
      processor.processMessages(messages as never);
    } catch (err) {
      // A malformed list is the agent's fault, not the person's: log it and draw what landed.
      console.error('A2UI: could not process a card', err);
    }
    sync();
    return () => {
      created.unsubscribe();
      deleted.unsubscribe();
      processor.dispose();
      setSurfaces([]);
    };
  }, [messages]);

  if (surfaces.length === 0) return null;
  return (
    <div className="flex flex-col gap-3">
      {surfaces.map((surface) => (
        <div key={surface.id} className="rounded-lg border border-border p-3">
          <A2uiSurface surface={surface} />
        </div>
      ))}
    </div>
  );
}
