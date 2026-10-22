'use client';

import { useState } from 'react';
import { z } from 'zod';
import { Catalog, CommonSchemas, type ResolveA2uiProps } from '@a2ui/web_core/v0_9';
import { createComponentImplementation, type ReactA2uiComponentProps } from '@a2ui/react/v0_9';
import { AlertDialog } from '@astryxdesign/core/AlertDialog';
import { Button } from '@astryxdesign/core/Button';
import { DateInput } from '@astryxdesign/core/DateInput';
import { Divider } from '@astryxdesign/core/Divider';
import { Heading } from '@astryxdesign/core/Heading';
import { Link } from '@astryxdesign/core/Link';
import { MoreMenu } from '@astryxdesign/core/MoreMenu';
import { Selector } from '@astryxdesign/core/Selector';
import { Text } from '@astryxdesign/core/Text';
import { TextArea } from '@astryxdesign/core/TextArea';
import { TextInput } from '@astryxdesign/core/TextInput';
import { RAYA_BLOCKS_CATALOG_ID } from '@precast/a2ui';

/**
 * `raya.blocks.v1` as an A2UI React catalog, drawn with Astryx so cards follow the APC theme in
 * light and dark. One implementation per catalog component, thirteen in all; the zod schemas
 * mirror `packages/a2ui/catalog/raya-blocks-v1.catalog.json`, and the message processor
 * validates every component against them before it is drawn, so a component the catalog does
 * not name, or a property it does not allow, is dropped with an error rather than rendered.
 *
 * A press reaches the agent through `context.dispatchAction({ name, context })`: `name` is the
 * action id the agent wrote, `context` carries the control's `value`, the `label` the person
 * saw, and any `selection` they made. The agent receives all three as text (route.ts).
 */

const str = CommonSchemas.DynamicString;
const action = z.object({
  name: z.string().min(1).max(64),
  value: z.string().max(2000).optional(),
});
const options = z
  .array(z.object({ label: z.string().min(1).max(120), value: z.string().max(2000) }))
  .min(1);
const httpsUrl = z
  .string()
  .max(2000)
  .regex(/^https:\/\//);

/** What a component receives once the binder has resolved every data-model path to its value. */
type Props<S extends z.ZodTypeAny> = ReactA2uiComponentProps<ResolveA2uiProps<z.infer<S>>>;

/** A text value the binder resolved, or '' for a nested path it left as is. */
const text = (v: unknown): string => (typeof v === 'string' ? v : '');

/** Render each child, by id or by resolved reference. */
function children(list: unknown, buildChild: Props<z.ZodTypeAny>['buildChild'], max?: number) {
  const items = Array.isArray(list) ? list.slice(0, max) : [];
  return items.map((c) => {
    const ref = typeof c === 'string' ? { id: c } : (c as { id: string; basePath?: string });
    return <div key={ref.id}>{buildChild(ref.id, ref.basePath)}</div>;
  });
}

/** Dispatch a press. `extractActionTarget` reads `name` and `context` straight off this object. */
function press(
  context: Props<z.ZodTypeAny>['context'],
  act: { name: string; value?: string },
  extra: Record<string, unknown> = {},
) {
  return context.dispatchAction({
    name: act.name,
    context: { ...(act.value !== undefined ? { value: act.value } : {}), ...extra },
  });
}

// ── Layout ──────────────────────────────────────────────────────────────────

const StackApi = { name: 'Stack', schema: z.object({ children: CommonSchemas.ChildList }) };
const Stack = createComponentImplementation(
  StackApi,
  ({ props, buildChild }: Props<typeof StackApi.schema>) => (
    <div className="flex flex-col gap-3">{children(props.children, buildChild)}</div>
  ),
);

const ActionsApi = { name: 'Actions', schema: z.object({ children: CommonSchemas.ChildList }) };
// One row holds at most 5 controls, the catalog's `controlsPerActions` limit.
const Actions = createComponentImplementation(
  ActionsApi,
  ({ props, buildChild }: Props<typeof ActionsApi.schema>) => (
    <div className="flex flex-wrap items-end gap-2">{children(props.children, buildChild, 5)}</div>
  ),
);

const DividerApi = { name: 'Divider', schema: z.object({}) };
const DividerBlock = createComponentImplementation(DividerApi, () => <Divider />);

// ── Text ────────────────────────────────────────────────────────────────────

const HeaderApi = { name: 'Header', schema: z.object({ text: str }) };
const Header = createComponentImplementation(
  HeaderApi,
  ({ props }: Props<typeof HeaderApi.schema>) => <Heading level={3}>{props.text}</Heading>,
);

const SectionApi = {
  name: 'Section',
  schema: z.object({
    text: str.optional(),
    fields: z
      .array(z.object({ label: str, value: str }))
      .max(10)
      .optional(),
    accessory: CommonSchemas.ComponentId.optional(),
  }),
};
const Section = createComponentImplementation(
  SectionApi,
  ({ props, buildChild }: Props<typeof SectionApi.schema>) => (
    <div className="flex flex-col gap-2">
      {props.text && <Text as="p">{props.text}</Text>}
      {props.fields && props.fields.length > 0 && (
        <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1">
          {props.fields.map((f, i) => (
            <div key={i} className="contents">
              <dt>
                <Text type="supporting">{text(f.label)}</Text>
              </dt>
              <dd>
                <Text>{text(f.value)}</Text>
              </dd>
            </div>
          ))}
        </dl>
      )}
      {props.accessory && <div>{buildChild(props.accessory)}</div>}
    </div>
  ),
);

const ContextApi = { name: 'Context', schema: z.object({ text: str }) };
const Context = createComponentImplementation(
  ContextApi,
  ({ props }: Props<typeof ContextApi.schema>) => <Text type="supporting">{props.text}</Text>,
);

// ── Media ───────────────────────────────────────────────────────────────────

const ImageApi = { name: 'Image', schema: z.object({ url: httpsUrl, alt: str }) };
const Image = createComponentImplementation(
  ImageApi,
  ({ props }: Props<typeof ImageApi.schema>) => (
    // Plain <img>: the URL is agent-authored and not on any allowlist, so next/image's
    // optimizer must not fetch it. `referrerPolicy` keeps this app's origin from the host.
    <img
      src={props.url}
      alt={props.alt}
      className="max-w-full rounded-lg"
      referrerPolicy="no-referrer"
    />
  ),
);

const EmbedApi = {
  name: 'Embed',
  schema: z.object({
    url: httpsUrl,
    title: str.optional(),
    ratio: z.enum(['16:9', '4:3', '1:1']).optional(),
  }),
};
// Drawn as a link, not an iframe: an agent-authored page inside this app's frame is a larger
// surface than a card should open. Raya may embed; this app sends the person to it.
const Embed = createComponentImplementation(
  EmbedApi,
  ({ props }: Props<typeof EmbedApi.schema>) => (
    <Link href={props.url} isExternalLink target="_blank" rel="noopener noreferrer">
      {props.title ?? props.url}
    </Link>
  ),
);

// ── Controls ────────────────────────────────────────────────────────────────

const ButtonApi = {
  name: 'Button',
  schema: z.object({
    label: str,
    action: action.optional(),
    url: httpsUrl.optional(),
    variant: z.enum(['default', 'primary', 'danger']).optional(),
    confirm: z
      .object({ title: z.string(), text: z.string(), confirm: z.string(), deny: z.string() })
      .optional(),
    once: z.boolean().optional(),
  }),
};
const VARIANT = { default: 'secondary', primary: 'primary', danger: 'destructive' } as const;
const ButtonBlock = createComponentImplementation(
  ButtonApi,
  ({ props, context }: Props<typeof ButtonApi.schema>) => {
    const [confirming, setConfirming] = useState(false);
    const [used, setUsed] = useState(false);
    const variant = VARIANT[props.variant ?? 'default'];

    if (!props.action) {
      if (!props.url) return null;
      return (
        <Button
          label={props.label}
          variant={variant}
          href={props.url}
          target="_blank"
          rel="noopener noreferrer"
        />
      );
    }
    const act = props.action;
    const fire = () => {
      if (props.once) setUsed(true);
      return press(context, act, { label: props.label });
    };
    return (
      <>
        <Button
          label={props.label}
          variant={variant}
          isDisabled={used}
          clickAction={() => (props.confirm ? setConfirming(true) : fire())}
        />
        {props.confirm && (
          <AlertDialog
            isOpen={confirming}
            onOpenChange={setConfirming}
            title={props.confirm.title}
            description={props.confirm.text}
            actionLabel={props.confirm.confirm}
            cancelLabel={props.confirm.deny}
            actionVariant={variant === 'destructive' ? 'destructive' : 'primary'}
            onAction={() => {
              setConfirming(false);
              void fire();
            }}
          />
        )}
      </>
    );
  },
);

const SelectApi = {
  name: 'Select',
  schema: z.object({ action, placeholder: z.string().optional(), options }),
};
const Select = createComponentImplementation(
  SelectApi,
  ({ props, context }: Props<typeof SelectApi.schema>) => {
    const [value, setValue] = useState<string>('');
    return (
      <Selector
        label={props.placeholder ?? 'Choose'}
        isLabelHidden
        placeholder={props.placeholder}
        value={value}
        options={props.options.map((o) => ({ value: o.value, label: o.label }))}
        changeAction={(next) => {
          setValue(next);
          const picked = props.options.find((o) => o.value === next);
          return press(context, props.action, { selection: next, label: picked?.label ?? null });
        }}
      />
    );
  },
);

const OverflowApi = { name: 'Overflow', schema: z.object({ action, options }) };
const Overflow = createComponentImplementation(
  OverflowApi,
  ({ props, context }: Props<typeof OverflowApi.schema>) => (
    <MoreMenu
      label="More"
      items={props.options.map((o) => ({
        label: o.label,
        onClick: () => void press(context, props.action, { selection: o.value, label: o.label }),
      }))}
    />
  ),
);

const DatePickerApi = {
  name: 'DatePicker',
  schema: z.object({
    action,
    initial: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/)
      .optional(),
  }),
};
const DatePicker = createComponentImplementation(
  DatePickerApi,
  ({ props, context }: Props<typeof DatePickerApi.schema>) => {
    type Iso = Parameters<typeof DateInput>[0]['value'];
    const [value, setValue] = useState<Iso>(props.initial as Iso);
    return (
      <DateInput
        label="Date"
        isLabelHidden
        value={value}
        changeAction={(next) => {
          setValue(next);
          if (next) return press(context, props.action, { selection: next });
        }}
      />
    );
  },
);

const TextInputApi = {
  name: 'TextInput',
  schema: z.object({
    action,
    placeholder: z.string().optional(),
    maxLength: z.number().int().positive().optional(),
    multiline: z.boolean().optional(),
  }),
};
const TextInputBlock = createComponentImplementation(
  TextInputApi,
  ({ props, context }: Props<typeof TextInputApi.schema>) => {
    const [text, setText] = useState('');
    // Astryx's TextInput has no maxLength prop, so the cap applies in onChange for both fields.
    const onChange = (v: string) => setText(props.maxLength ? v.slice(0, props.maxLength) : v);
    const send = () => {
      const selection = text.trim();
      if (!selection) return;
      setText('');
      return press(context, props.action, { selection });
    };
    const field = props.multiline ? (
      <TextArea
        label="Reply"
        isLabelHidden
        value={text}
        onChange={onChange}
        placeholder={props.placeholder}
        rows={3}
      />
    ) : (
      <TextInput
        label="Reply"
        isLabelHidden
        value={text}
        onChange={onChange}
        placeholder={props.placeholder}
      />
    );
    return (
      <div className="flex items-end gap-2">
        <div className="flex-1">{field}</div>
        <Button label="Send" variant="secondary" isDisabled={!text.trim()} clickAction={send} />
      </div>
    );
  },
);

/** The catalog the message processor validates against and the surface renders with. */
export const rayaBlocksCatalog = new Catalog(RAYA_BLOCKS_CATALOG_ID, 'v0.9', [
  Stack,
  Header,
  Section,
  Context,
  DividerBlock,
  Image,
  Actions,
  Embed,
  ButtonBlock,
  Select,
  DatePicker,
  Overflow,
  TextInputBlock,
]);
