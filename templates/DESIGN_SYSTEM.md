# DESIGN_SYSTEM — Astryx

> **Template + worked example.** Capture the design language the web app follows
> so UI work is consistent and agent-buildable. This example adopts **Astryx**
> (`@astryxdesign/core`, Meta Open Source) for the **meeting-room reservation**
> chat UI. Astryx is a themeable React design system built on design tokens;
> pick a theme and compose components — replace the theme/token choices with your
> brand while keeping the structure.

**Design system:** Astryx · **Applies to:** `apps/web/` (Next.js + React)
**Last updated:** [ISO date]

---

## 1. Principles

Astryx is **token-first and component-first**: you build UI from accessible,
pre-styled components and reference semantic tokens, never raw values.

- **Themeable** — a theme package (`@astryxdesign/theme-*`) supplies every token
  (color, spacing, radius, typography, shadow, motion) as CSS custom properties.
  Light/dark are derived from the theme, applied via `<Theme mode="system">`.
- **Semantic tokens** — components consume roles (`surface`, `primary`, `border`)
  rather than hex; swap the theme to re-skin the whole app.
- **Built-in spacing & a11y** — components ship with consistent spacing, focus
  states, and ARIA. Prefer a component over hand-rolled markup.
- **Layout primitives** — `VStack`/`HStack`/`Grid`/`Layout` for structure; the
  `gap`/`padding` props use the spacing scale (`gap={4}`), not manual margins.

Discover everything with the CLI: `pnpm exec astryx component` (list),
`pnpm exec astryx component <Name>` (props), `pnpm exec astryx docs <topic>`.

## 2. Theme & tokens

Pick a theme package and wire it once. This example uses **neutral**; other
published themes: `butter`, `chocolate`, `gothic` (dark-only), `matcha`,
`stone`, `y2k`. Swap the package + import to re-theme.

- Provider: `<Theme theme={neutralTheme} mode="system">` in `app/providers.tsx`.
- Token CSS: `theme.css` (pre-built custom properties) imported in `app/globals.css`.
- Token families: **color** (`surface`, `primary`, `border`, status colors),
  **spacing** (`0…10` scale), **radius/shape**, **typography**, **elevation**
  (shadow tokens), **motion** (duration/easing). Full list:
  `pnpm exec astryx docs tokens`.

> Use semantic color tokens (via component `variant` props or the Tailwind bridge
> classes `bg-surface`, `text-primary`, `border-border`) — never inline hex.

## 3. Typography

Use the `Heading` and `Text` components with **semantic** props, not manual
size/weight:

| Component + prop             | Use in the reservation UI             |
| ---------------------------- | ------------------------------------- |
| `<Heading type="display-*">` | Empty-state hero ("Find a room").     |
| `<Heading level={1..6}>`     | Section titles, confirmation summary. |
| `<Text type="large">`        | Room name in a result card.           |
| `<Text type="body">`         | Chat message text.                    |
| `<Text type="supporting">`   | Secondary/meta text; input helper.    |

## 4. Elevation & shape

- **Elevation:** raise surfaces with Astryx shadow/elevation tokens (see
  `astryx docs elevation`); `Card` carries its own surface treatment — prefer it
  over ad-hoc shadows.
- **Shape:** border-radius tokens (`astryx docs shape`); components round
  themselves via the theme. Use the Tailwind bridge (`rounded-lg`) for custom
  containers so radii stay token-backed.

## 5. Motion

- Use Astryx motion tokens (duration/easing) for transitions (`astryx docs motion`).
- Message send and booking confirmation use a brief fade/scale; keep it subtle.
- Respect `prefers-reduced-motion`: fall back to short opacity transitions.

## 6. Component mapping (reservation chat)

Astryx ships purpose-built **Chat** components — prefer them for the chat surface.

| UI element       | Astryx component                           | Notes                                        |
| ---------------- | ------------------------------------------ | -------------------------------------------- |
| Message list     | `ChatLayout` + `ChatMessage`               | User vs agent roles; themed bubbles.         |
| Composer         | `ChatComposer` (or `TextInput` + `Button`) | Send action = `variant="primary"`.           |
| Room result      | `Card` (+ `ClickableCard` if selectable)   | `Heading` = room name; `Badge` for capacity. |
| Capacity / floor | `Badge` / `Selector`                       | Semantic color variants.                     |
| Confirm booking  | `Dialog`                                   | Primary confirm button.                      |
| Conflict         | `Banner` (`status="error"`) / `Toast`      | Error role.                                  |
| Page shell       | `AppShell` / `Layout` + `VStack`/`HStack`  | Header/content/footer slots.                 |

## 7. Implementation notes (Next.js)

- **Style via Astryx + Tailwind** (per project rules): compose Astryx components
  and use Tailwind utilities (`flex`, `gap-4`, `p-4`, token-backed `bg-surface`,
  `text-primary`) for layout. The Tailwind bridge is
  `@astryxdesign/core/tailwind-theme.css`; cascade-layer order is set in
  `app/globals.css`. No hand-written CSS beyond `globals.css`; use StyleX's
  `xstyle` prop only for one-offs. See [STYLE_GUIDE](../docs/STYLE_GUIDE.md).
- **Light and dark** come from the theme via `<Theme mode="system">`.
- Components using state/effects need `'use client'`; keep pages server components
  where possible.
- **Build note:** Astryx 0.1.x ships dev-JSX-compiled components, so `apps/web`
  builds with `next build --webpack` + a `jsx-dev-runtime` shim (see TECH_STACK.md).

## 8. References

- Astryx docs: https://astryx.atmeta.com/docs/getting-started
- Local CLI: `pnpm exec astryx docs`, `pnpm exec astryx component <Name>`
- GitHub: https://github.com/facebook/astryx
