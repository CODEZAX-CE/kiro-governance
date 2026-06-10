---
name: auth-patterns
description: Auth patterns for the project frontend. Use when working with login, MFA, token refresh, protected routes, auth context, or the returnUrl redirect flow.
metadata:
  version: '1.0'
---

## File Structure

- `lib/auth.ts` — all auth logic, types, context creation, `useAuth()` hook. No JSX.
- `lib/AuthProvider.tsx` — React component only. Renders `<AuthContext.Provider>`. Import this into the provider tree.

Never put JSX in `auth.ts`. Never put business logic in `AuthProvider.tsx`.

## Auth Flow

```
POST /api/auth/login → { accessToken, idToken, refreshToken } or { mfaRequired, session }
  → if mfaRequired: POST /api/auth/mfa → { accessToken, idToken, refreshToken }
  → store accessToken + idToken in memory (module-level vars)
  → store refreshToken in localStorage only
  → on app load: read refreshToken → POST /api/auth/refresh → restore session
  → on signOut: null all vars + clear localStorage
```

## Token Storage Rules

- `accessToken` + `idToken` — memory only (module-level `let` vars in `auth.ts`)
- `refreshToken` — `localStorage` only, with `isLocalStorageAvailable()` guard
- Never store tokens in React state, cookies, or sessionStorage

## Protected Routes — returnUrl Pattern

In `(auth)/layout.tsx`:

```typescript
const pathname = usePathname();
if (!isLoading && !isAuthenticated) {
  router.replace(`/login?returnUrl=${encodeURIComponent(pathname)}`);
}
```

In `login/page.tsx` after successful login:

```typescript
const searchParams = useSearchParams();
const returnUrl = searchParams.get('returnUrl') || '/dashboard';
router.replace(returnUrl);
```

## Provider Tree Position

`AuthProvider` must be inside `NextIntlClientProvider` and `ThemeProvider`:

```
ReduxProvider → NextIntlClientProvider → ThemeProvider → AuthProvider
```

## Gotchas

- `isLoading` starts `true` — always guard renders with it to avoid flash of unauthenticated content
- `passwordExpired` flag in JWT claims triggers redirect to `/change-password` immediately after login
- MFA session (`_mfaSession`) is module-level — it's lost on page refresh. If user refreshes mid-MFA, they restart login.
- `isLocalStorageAvailable()` must be called before every localStorage access — Node 25 has a broken `localStorage` global in dev
- Never import `AuthProvider` from `auth.ts` — it lives in `AuthProvider.tsx`
