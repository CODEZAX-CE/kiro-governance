---
name: testing-patterns
description: Frontend testing patterns for the project components and hooks. Use when writing Jest component tests, hook tests, or Playwright E2E tests for the frontend.
metadata:
  version: '1.0'
---

## Writing a Component Test

1. Create test at `frontend/__tests__/components/{domain}/{Component}.test.tsx`
2. Render with required providers (ThemeProvider, auth context mock)
3. Use `screen.getByRole()` and `screen.getByLabelText()` — not `getByTestId()`
4. Test user interactions with `userEvent` from `@testing-library/user-event`
5. Assert on visible output, not internal state

## Writing a Hook Test

1. Create test at `frontend/__tests__/hooks/use{Domain}.test.ts`
2. Mock `api-client.ts` — don't hit real API
3. Use `renderHook()` from `@testing-library/react`
4. Test the returned methods and their responses

## Writing a Playwright E2E Test

1. E2E tests cover critical user journeys only: login, client intake, referral creation, consent capture
2. Run against the staging environment
3. Use role-based selectors: `page.getByRole('button', { name: 'Submit' })`
4. Include loading state waits — SPA pages load data after mount

## Coverage Requirements

| Path                              | Minimum |
| --------------------------------- | ------- |
| Forms (intake, referral, consent) | 90%     |
| Domain hooks                      | 80%     |
| Design system primitives          | 80%     |
| Page components                   | 60%     |

## Gotchas

- All component tests need the `ThemeProvider` wrapper — MUI components crash without it. Create a test utility that wraps with all required providers.
- Mock `useApiClient` at the module level, not inside individual tests. The hook is used by all domain hooks.
- Playwright tests must handle the Cognito login flow. Use a test user with known credentials stored in environment variables — never hardcode.
- Don't test MUI internal behavior (dropdown opening, tooltip positioning). Test your business logic and user-visible outcomes.
- i18n: Tests run with English locale by default. If testing Spanish, wrap with the next-intl provider and load `es.json`.
- Accessibility: Run `axe` checks in component tests for all interactive components. Use `jest-axe` or `@axe-core/react`.
