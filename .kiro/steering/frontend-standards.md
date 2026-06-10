# Frontend Development Standards

Standards for building the project frontend — a Next.js SPA with MUI, TypeScript strict mode, and a custom design system.

---

## 1. General Principles

- **Screen guide first**: Before building ANY screen, read `docs/frontend-screen-development-guide.md`. It maps every screen to its legacy layout reference, backend API, edge cases, and visual security rules. Follow the 3-step process: Find → Build → Connect.
- **Legacy KB first**: Before writing a single line of UI code, search the **Frontend App Screens KB** (ID: `d3ddf39c-d8d6-4c58-98b4-f884f81503a1`) for the screen you are building. Use the legacy screenshot as the layout reference. Match field labels, button positions, card structure, and flow exactly.
- **Design system always**: Every component MUST use the project design system. This is non-negotiable:
  - **Tokens**: All colors, spacing, typography, shadows from `frontend/src/design-system/tokens/` — NEVER hardcode `#hex`, `rgb()`, `px` values
  - **Primitives**: Use `Button`, `Input`, `Card`, `Modal`, `Spinner`, `Stack`, `Grid`, `Select`, `Tabs` from `@/design-system` — NEVER use raw MUI equivalents directly
  - **Theme**: The MUI theme (`uwmTheme` in `design-system/theme/uwm.ts`) is built from the tokens — use MUI `sx` palette keys (`'primary.main'`, `'grey.200'`, `'text.primary'`) which resolve through the theme automatically
  - **Import pattern**: `import { Button, Input } from '@/design-system'` and `import { colors } from '@/design-system/tokens/colors'`
- **Clarity over cleverness**: Readable components over clever abstractions
- **Accessible by default**: WCAG 2.1 AA compliance on all interactive elements
- **Domain-scoped**: Components, hooks, and pages organized by domain
- **Type-safe**: TypeScript strict mode, shared types with backend

---

## 1.2 Auth Screen Layout Pattern (MANDATORY)

ALL auth screens (login, forgot password, TOTP enrollment, TOTP challenge, change password, signup, privacy modal) MUST use the same two-column layout via `AuthPageLayout` component:

```
┌─────────────────────┬──────────────────────────┐
│   LEFT SIDEBAR      │      RIGHT FORM AREA      │
│   40% width         │      60% width            │
│   bgcolor:          │      bgcolor: #ffffff      │
│   primary.main      │      Form centered         │
│   (#0245b6)         │      vertically            │
│                     │                            │
│   [Project] Logo    │   [Form fields]            │
│   "Smart Referral   │   [Submit button]          │
│    Network"         │   [Links]                  │
│   Subtitle          │                            │
│                     │                            │
│   Hidden on mobile  │   Full width on mobile     │
└─────────────────────┴──────────────────────────┘
```

**Usage:** Wrap every auth screen with `<AuthPageLayout>`:

```typescript
import AuthPageLayout from '@/components/auth/AuthPageLayout';

export default function MyAuthScreen() {
  return (
    <AuthPageLayout>
      {/* form content here */}
    </AuthPageLayout>
  );
}
```

**Applies to:** LoginForm, MfaEnrollmentStep, MfaChallengeStep, PasswordResetFlow, ChangePasswordPage, SignupPage, PrivacyAcknowledgmentModal (full-page version)

These are the ONLY values to use for colors. Import from `@/design-system/tokens/colors`.

| Token                         | Value     | Use for                            |
| ----------------------------- | --------- | ---------------------------------- |
| `colors.primary.main`         | `#0245b6` | Primary actions, links, sidebar bg |
| `colors.primary.dark`         | `#023792` | Primary button bg, hover states    |
| `colors.primary.contrastText` | `#ffffff` | Text on primary bg                 |
| `colors.background.default`   | `#f2f2f2` | Page background                    |
| `colors.background.paper`     | `#ffffff` | Card/surface background            |
| `colors.text.primary`         | `#2f2f2f` | Body text, headings                |
| `colors.text.secondary`       | `#6f6f6f` | Helper text, labels, captions      |
| `colors.text.disabled`        | `#8f8f8f` | Disabled text, placeholders        |
| `colors.grey[200]`            | `#cfcfcf` | Input borders, dividers            |
| `colors.error.main`           | `#fd0202` | Error states                       |
| `colors.divider`              | `#cfcfcf` | Divider lines                      |

**MUI sx shorthand** (resolves through uwmTheme automatically):

- `bgcolor: 'primary.main'` → `#0245b6`
- `color: 'text.secondary'` → `#6f6f6f`
- `borderColor: 'grey.200'` → `#cfcfcf`
- `bgcolor: 'background.default'` → `#f2f2f2`

---

## 2. Technology Stack

| Layer            | Technology                                                                                                                                                                                                                |
| ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Framework        | Next.js (SPA mode, client-side rendering)                                                                                                                                                                                 |
| Language         | TypeScript (strict mode)                                                                                                                                                                                                  |
| UI Library       | MUI (Material-UI) + Emotion                                                                                                                                                                                               |
| Design System    | Custom tokens + primitives in `frontend/src/design-system/`                                                                                                                                                               |
| State Management | Redux Toolkit (RTK) + RTK Query                                                                                                                                                                                           |
| Forms            | React Hook Form + Zod                                                                                                                                                                                                     |
| ACL              | CASL v6 (https://casl.js.org/) + @casl/react — declarative `<Can>` component for role-based UI hiding. Abilities defined from JWT claims. Backend enforces all permissions — CASL is UX only.                             |
| Charts           | Chart.js (https://www.chartjs.org/) + react-chartjs-2 — used for EMC bar charts, line graphs, and PNG/SVG export (FR-REPORT-005, FR-REPORT-008)                                                                           |
| Idle Timer       | react-idle-timer (https://idletimer.dev/) — 15-min inactivity screen blur + 30-min full logout. Tracks mouse, keyboard, click, scroll events. See auth-security-architecture.md §8.3. Pending SEC-2 stakeholder decision. |
| API Layer        | RTK Query for data fetching/caching, `lib/api-client.ts` for base query with JWT                                                                                                                                          |
| Auth             | Backend API (`POST /api/auth/login`, `/mfa`, `/refresh`) via `lib/auth.ts` + `lib/AuthProvider.tsx` — no Cognito SDK on frontend                                                                                          |
| i18n             | next-intl (English + Spanish)                                                                                                                                                                                             |
| Testing          | Playwright E2E for all critical flows                                                                                                                                                                                     |
| Tooling          | ESLint, Prettier, Husky, lint-staged                                                                                                                                                                                      |

**Not used**: Tailwind CSS, TanStack Query, SWR, Zustand, shadcn/ui, Radix UI, Axios.

---

## 3. Project Structure

See `docs/code-structure.md` for the full tree. Key frontend paths:

```
frontend/src/
  app/                    # Next.js App Router
    (auth)/               # Staff routes (dashboard, clients, referrals, etc.)
    (portal)/             # Client portal routes (my-referrals, my-consent, my-profile)
    login/                # Public login page
  components/             # Domain-scoped components
    clients/
    referrals/
    shared/               # Cross-domain: buttons, inputs, modals, tables
  hooks/                  # One hook per domain (useClients, useReferrals, etc.)
  lib/                    # Auth, API client, i18n config
  locales/                # en.json, es.json
  design-system/          # Tokens, theme, primitives, layout components
```

**Rules:**

- All pages are `'use client'` — static SPA (`output: 'export'`), no Server Components, no server actions, no middleware
- `output: 'export'` constraint: never use `redirect()` from `next/navigation` in server components — use client-side `router.replace()` instead
- Components scoped by domain — `components/clients/`, not flat
- One hook per domain — `useClients`, not `useClientSearch` + `useClientCreate`
- Design system tokens in `design-system/tokens/` are the source of truth for all visual values — never hardcode colors, spacing, or typography
- Auth split: `lib/auth.ts` (logic, types, context, hooks — no JSX) + `lib/AuthProvider.tsx` (React component only)
- Provider tree order (outermost → innermost): `ReduxProvider` → `NextIntlClientProvider` → `ThemeProvider` → `AuthProvider`
- i18n: client-side `NextIntlClientProvider` with locale in `localStorage` — no `[locale]` route segment (incompatible with static export)

---

## 4. Component Standards

- Use MUI components as the base layer
- Use design system primitives (`Button`, `Input`, `Select`) where they exist
- Style with `sx` prop for one-off styles, `styled()` for reusable styled components
- All interactive elements: keyboard accessible, visible focus indicators, ARIA labels
- Loading, error, and empty states for every data-fetching component
- **Single responsibility** — one component does one thing. Split if it exceeds ~200 lines
- **Memoization** — use `React.memo` for expensive renders, `useMemo`/`useCallback` for stable references passed as props
- **No inline function definitions in JSX** for event handlers that cause child re-renders
- **Prop drilling limit** — if passing props through 3+ levels, use context or composition
- **No direct DOM manipulation** — use refs only when React can't handle it (focus, scroll, third-party libs)

---

## 5. State Management

- **Local state**: `useState` / `useReducer` for component-scoped state
- **Server state**: RTK Query for data fetching, caching, and automatic cache invalidation
- **Global state**: Redux Toolkit (RTK) for cross-component state when needed
- **Auth state**: Auth context via `lib/auth.tsx` — tokens from backend API, stored in memory
- **ACL state**: CASL abilities via `lib/abilities.ts` — built once from JWT claims at login

---

## 5.1 ACL / Role-Based UI (CASL)

CASL is used for frontend permission checks only. Backend enforces all permissions independently.

**Setup:**

- `lib/abilities.ts` — defines abilities from JWT claims (`custom:role`, `custom:county_id`, `custom:agency_id`, `is_read_only`)
- `lib/AbilityContext.tsx` — React context provider wrapping the app
- `@casl/react` `<Can>` component for conditional rendering

**Ability definition (static — no API call needed):**

```typescript
// lib/abilities.ts
import { AbilityBuilder, createMongoAbility } from '@casl/ability';

export function defineAbilitiesFor(user) {
  const { can, cannot, build } = new AbilityBuilder(createMongoAbility);

  if (user.role === 'root') can('manage', 'all');

  if (user.role === 'county_admin') {
    can('manage', 'User', { countyId: user.countyId });
    can('manage', 'Agency', { countyId: user.countyId });
    can('manage', 'SMS', { countyId: user.countyId });
    can('read', 'Report');
    can('create', 'Client');
    can('create', 'Referral');
  }

  if (user.role === 'agency_admin') {
    can('manage', 'User', { agencyId: user.agencyId });
    can('manage', 'Client');
    can('manage', 'Referral');
    can('read', 'Report');
  }

  if (user.role === 'agency_staff') {
    can('create', 'Client');
    can('create', 'Referral');
    can('read', 'Client');
    can('read', 'Report');
  }

  // User-level modifier
  if (user.isReadOnly) {
    cannot('create', 'all');
    cannot('update', 'all');
    cannot('delete', 'all');
  }

  // Program-level — CalWORKs root-only
  if (user.role !== 'root') cannot('manage', 'CalWORKs');

  return build();
}
```

**Component usage:**

```typescript
import { Can } from '@casl/react';
import { useAbility } from '@/lib/AbilityContext';

// Nav items
<Can I="manage" a="CalWORKs" ability={ability}>
  <NavItem href="/case-management">Case Management</NavItem>
</Can>

// Action buttons
<Can I="manage" a="User" ability={ability}>
  <Button>Create User</Button>
</Can>

// Inline checks
const ability = useAbility();
if (ability.can('manage', 'all')) { /* root-only logic */ }
```

**Rules:**

- Abilities built once at login from JWT claims — no API call to fetch permissions
- Rebuild abilities on token refresh (role/agency change forces re-login via `AdminUserGlobalSignOut`)
- Never use CASL as the sole permission check — backend `withMiddleware({ roles: [...] })` is the enforcer
- `is_read_only` users see all data their role allows but all write actions are hidden

---

## 6. API Integration

- All API calls go through `lib/api-client.ts` — never use `fetch()` directly in components or pages
- Two patterns available from `lib/api-client.ts`:
  - **RTK Query `baseQuery`** — use for domain hooks (`useClients`, `useReferrals`, etc.) that need caching and cache invalidation
  - **`useApiClient()` hook** — use for one-off calls that don't need RTK Query caching
- Types shared with backend via `@[project]/shared/types/`
- API contracts defined in `specs/api/{domain}.yaml` (OpenAPI)
- Error handling: `api-client.ts` handles 401 (redirect to `/login`) and 500 (toast) globally

---

## 7. Forms & Validation

- React Hook Form + Zod for all forms
- MUI components require `Controller`, not `register()`
- Validation schemas co-located with form components
- Error messages use i18n keys — no hardcoded strings
- Required fields marked with `*` and `aria-required="true"`

---

## 8. i18n

- next-intl for translations
- Locale files: `frontend/src/locales/en.json`, `es.json`
- Translation keys: dot notation (`clients.search.placeholder`)
- All user-visible strings must be translated — no hardcoded English in JSX

---

## 9. Accessibility (WCAG 2.1 AA)

- Semantic HTML elements (`button`, `nav`, `main`, `h1`–`h6`)
- Keyboard navigation for all interactive elements
- Visible focus indicators (minimum 3:1 contrast)
- Color contrast: 4.5:1 for normal text, 3:1 for large text
- ARIA attributes only when semantic HTML is insufficient
- Skip navigation link on all pages
- `axe-core` checks in component tests

---

## 10. Testing

- **E2E tests**: Playwright for all critical flows (login, intake, referral, consent)
- **Test location**: `frontend/__tests__/` for unit/component tests, `frontend/e2e/` for Playwright
- **Coverage**: 90% for forms, 80% for hooks and primitives, 60% for pages
- Every story must include tests — no implementation is complete without them

---

## 11. Error Handling

- Error boundaries at route level (`error.tsx`) and feature level
- User-friendly error messages with recovery actions
- Log errors to monitoring service in production
- Never show stack traces to users

---

## 12. Naming Conventions

| Item                 | Convention                    | Example                       |
| -------------------- | ----------------------------- | ----------------------------- |
| Components           | `PascalCase`                  | `ClientSearchForm.tsx`        |
| Hooks                | `camelCase` with `use` prefix | `useClients.ts`               |
| Pages                | `page.tsx` in route folder    | `app/(auth)/clients/page.tsx` |
| Translation keys     | `dot.notation`                | `clients.search.placeholder`  |
| CSS classes (if any) | `kebab-case`                  | `client-card-header`          |

---

## 13. Dependency Management (Mandatory)

- **LTS packages only** — always use the latest stable version of every dependency. Never hardcode versions in specs or prompts. Before installing or using any package, check the official documentation for the current stable release. If a package's behavior, config format, or API has changed, follow the current official docs — never assume from memory or previous sprints.

---

## 14. Code Quality (Mandatory)

- **Prettier** + **ESLint** — enforced in CI
- **Husky + lint-staged** — pre-commit hooks
- TypeScript strict mode — no `any`
- Pipeline fails if `format:check` or `lint:check` fails

---

## 15. Definition of Done

- [ ] Component uses design system tokens — no hardcoded colors/spacing
- [ ] TypeScript strict mode, no `any`
- [ ] Zod validation on all form inputs
- [ ] Types from `@[project]/shared/types/`
- [ ] i18n keys for all user-visible strings
- [ ] Loading, error, and empty states handled
- [ ] Keyboard accessible, visible focus indicators
- [ ] Component tests passing (coverage targets met)
- [ ] Formatted with Prettier, passes ESLint
- [ ] No hardcoded API URLs or secrets
- [ ] CASL `<Can>` used for role-based UI hiding
- [ ] No `console.log` with PII in production builds

---

## 16. Key Reference Documents

| Document                     | Path                                        | What it covers                                                                                                                        |
| ---------------------------- | ------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| **Screen Development Guide** | `docs/frontend-screen-development-guide.md` | 78 screens mapped to legacy references, API hooks, edge cases, visual security, done checklist. **Read this first for every screen.** |
| **Design System**            | `docs/design-system.md`                     | Tokens, colors, typography, spacing, breakpoints, component specs                                                                     |
| **Code Structure**           | `docs/code-structure.md`                    | Folder layout, domain boundaries, hook patterns                                                                                       |
| **OpenAPI Specs**            | `specs/api/*.yaml`                          | API contracts per domain (clients, referrals, consent, emc, programs, admin, reports, surveys)                                        |
| **Auth Architecture**        | `docs/auth-security-architecture.md`        | Auth API endpoints, JWT claims, session management, screen blur (§8.3)                                                                |
| **RBAC Architecture**        | `docs/rbac-access-control-architecture.md`  | Permission matrix, CASL ability definitions                                                                                           |
| **Frontend App Screens KB**  | `.kiro/knowledge/frontend-app-screens/`     | Legacy screenshots and HTML for layout reference                                                                                      |
