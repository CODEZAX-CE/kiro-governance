---
name: page-routing
description: Next.js App Router page and layout patterns for the project. Use when creating new pages, route groups, layouts, or navigation for staff or client portal routes.
metadata:
  version: '1.1'
---

## Route Group Structure

- `frontend/src/app/(auth)/` — Staff-only routes (dashboard, clients, referrals, reports, surveys, case-management, sms, admin)
- `frontend/src/app/(portal)/` — Client portal routes (my-referrals, my-consent, my-profile)
- `frontend/src/app/login/` — Public login page

## Creating a New Staff Page

1. Create the page at `frontend/src/app/(auth)/{feature}/page.tsx`
2. Mark it `'use client'` — the app is a static SPA (`output: 'export'`)
3. Import the relevant domain hook from `@/hooks/`
4. Import MUI components and design system primitives as needed
5. Add loading, error, and empty states

## Creating a New Portal Page

1. Create the page at `frontend/src/app/(portal)/{feature}/page.tsx`
2. The portal uses the client Cognito pool — auth context differs from staff
3. Portal pages show only the logged-in client's data — no multi-tenant concerns

## Layout Patterns

- `(auth)/layout.tsx` — Staff layout with sidebar navigation, header, breadcrumbs
- `(portal)/layout.tsx` — Client portal layout with simplified navigation
- Each route group has its own layout — don't share layouts across groups

## Gotchas

- **All pages are `'use client'`** — this is a static SPA (`output: 'export'`). No Server Components, no server actions, no middleware.
- **Never use `redirect()` from `next/navigation`** — it requires a server. Use `router.replace()` from `useRouter()` instead.
- **No `app/api/` routes** — all API calls go to the backend Lambda via API Gateway. Never create Next.js API routes.
- Route groups `(auth)` and `(portal)` use different Cognito pools. Don't mix them.
- Dynamic routes use `[id]` segments: `(auth)/clients/[id]/page.tsx` for client profile.
- The `(auth)` layout handles auth guard and role-based redirects — individual pages don't re-check auth.
- i18n: Use `useTranslations()` from next-intl. Translation keys follow dot notation: `clients.search.placeholder`. Locale files are in `frontend/src/locales/`.
- `output: 'export'` generates static HTML per route. CloudFront serves these files — configure error pages to serve `404/index.html` for unmatched routes.
