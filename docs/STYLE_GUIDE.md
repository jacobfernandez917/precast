# STYLE_GUIDE.md — Code Style & Conventions

---

## 1. TypeScript

### 1.1 Configuration

- Strict mode is required in all `tsconfig.json` files.
- Extend `tsconfig.base.json` from the repo root.
- Target `ES2023`, module `ESNext`, moduleResolution `Bundler`.

### 1.2 Naming

| Construct                | Convention                      | Example                                 |
| ------------------------ | ------------------------------- | --------------------------------------- |
| Classes                  | PascalCase                      | `UserService`, `ConfigModule`           |
| Functions                | camelCase                       | `parseEnv()`, `validateToken()`         |
| Variables                | camelCase                       | `userName`, `apiEndpoint`               |
| Constants (module-level) | UPPER_SNAKE_CASE                | `MAX_RETRIES`, `DEFAULT_PORT`           |
| Interfaces               | PascalCase (no `I` prefix)      | `UserConfig`, `TokenPayload`            |
| Types                    | PascalCase                      | `ApiResponse<T>`, `Role`                |
| Enums                    | PascalCase (values UPPER_SNAKE) | `Role.ADMIN`, `Status.ACTIVE`           |
| Files                    | kebab-case                      | `user-service.ts`, `auth-middleware.ts` |
| Directories              | kebab-case                      | `apps/api/src/auth/`                    |
| Private members          | `#` prefix (ES2023)             | `#cache = new Map()`                    |

### 1.3 Imports

- Group imports: external → internal → relative.
- No default exports (prefer named exports).
- Use path aliases configured in `tsconfig.base.json` (e.g., `@precast/*`).

```typescript
// External
import { z } from 'zod';

// Internal (workspace)
import { parseApiEnv } from '@precast/shared';

// Relative
import { UserService } from './user.service';
```

### 1.4 Comments

- Default to no comments. Only explain **non-obvious** why, not what.
- Use JSDoc for public API surfaces only (`/** ... */`).

---

## 2. File Structure

### 2.1 Maximum Line Length

- Soft limit: 100 characters.
- Hard limit: 120 characters.

### 2.2 File Size

- Prefer small, single-responsibility files (< 200 lines).
- Break large files into modules.

### 2.3 NestJS Modules

```
apps/api/src/<module>/
├── <module>.module.ts
├── <module>.controller.ts
├── <module>.service.ts
├── <module>.service.spec.ts
├── <module>.repository.ts
├── <module>.repository.spec.ts
└── <module>.dto.ts
```

### 2.4 Next.js App Router & Components

```
apps/web/
├── app/
│   ├── layout.tsx           # root layout (wraps <Providers>, imports globals.css)
│   ├── providers.tsx        # 'use client' — Astryx <Theme> provider
│   ├── page.tsx             # route "/" (server component)
│   ├── AgentChat.tsx        # 'use client' component
│   ├── globals.css          # Tailwind + Astryx cascade layers
│   ├── lib/
│   │   └── a2a-client.ts    # server-only AgentBase A2A client
│   └── api/                 # route handlers
│       ├── health/route.ts  # GET /api/health
│       └── a2a/[agentId]/route.ts
├── next.config.ts
└── postcss.config.mjs
```

**Conventions:**

- **Server components by default**; add `'use client'` only when a file needs
  state, effects, or browser APIs (e.g. `AgentChat.tsx`, `providers.tsx`).
- **UI from Astryx**: import components from per-category subpaths, e.g.
  `import { Button } from '@astryxdesign/core/Button'`. Look up any component's
  props with `pnpm exec astryx component <Name>`.
- **Layout with Tailwind** utility classes (`flex`, `gap-4`, `p-4`) and
  token-backed classes (`bg-surface`, `text-primary`). No hand-written CSS
  beyond `app/globals.css`.
- **Route handlers** live in `app/api/**/route.ts`, exporting `GET`/`POST`; they
  replace the old Nitro `server/` routes.

---

## 3. Git

### 3.1 Commit Messages

Format: `<area>: <imperative summary>`

```
api: add rate limiting middleware
web: fix mobile navigation overflow
shared: add env validation schema
docs: update PROGRESS.md with session log
```

### 3.2 Branch Names

Format: `<type>/<short-description>`

```
feat/api-rate-limiting
fix/web-nav-overflow
chore/update-deps
docs/handoff-update
```

### 3.3 Commits

- Small, scoped commits per concern.
- Every commit that touches code/config/docs must include the matching PROGRESS.md update in the same commit.
- Do not commit `.env` (only `.env.example`).

---

## 4. Validation

- `zod` at all external boundaries:
  - HTTP request bodies
  - Environment variables
  - API payloads
  - Configuration schemas
- Validate env at boot. Missing required vars → fail fast.
- Never trust user input.

---

## 5. Logging

- Use structured logging (`pino` or equivalent).
- Log levels: `debug`, `info`, `warn`, `error`, `fatal`.
- Never `console.log` or `console.error` in committed code.
- Include correlation IDs in request-scoped logs.

```typescript
// Good
this.logger.info({ userId, action: 'login' }, 'User logged in');

// Bad
console.log('User logged in:', userId);
```

---

## 6. Error Handling

- Use typed error classes extending `Error`.
- Throw HTTP-specific errors in NestJS controllers (`NotFoundException`, etc.).
- Catch-all error filters at the application boundary.
- Never expose internal error details to the client (return generic messages, log details).

---

## 7. Testing

- Unit test every service, controller, and utility function.
- Integration test every HTTP endpoint.
- E2E test critical user journeys.
- Test descriptions should read as sentences: `describe('UserService')` → `it('should create a user with valid data')`.
- Mock external dependencies (DB, HTTP, Redis) in unit tests.
- Use factories/fixtures for test data, not production data.
