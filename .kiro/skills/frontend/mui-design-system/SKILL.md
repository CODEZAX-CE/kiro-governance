---
name: mui-design-system
description: MUI theming and design system token usage for the project components. Use when creating or styling MUI components, applying theme tokens, or working with the design system primitives.
metadata:
  version: '1.1'
---

## Applying Design System Tokens

1. Import tokens directly from their file in `frontend/src/design-system/tokens/` — never hardcode colors, spacing, or typography
2. Use the MUI `sx` prop or Emotion `styled()` for custom styling
3. Reference semantic color tokens, not raw hex values
4. Use the 4px spacing grid from `tokens/spacing.ts`: 4, 8, 12, 16, 24, 32, 48, 64
5. Use breakpoints from `tokens/breakpoints.ts`: sm: 640, md: 768, lg: 1024, xl: 1280

## Token Imports

```typescript
import { colors } from '@/design-system/tokens/colors';
import { spacing } from '@/design-system/tokens/spacing';
import { breakpoints } from '@/design-system/tokens/breakpoints';
```

## Creating a New Component

1. Check if a design system primitive exists in `frontend/src/design-system/primitives/` first
2. If not, create a domain-scoped component in `frontend/src/components/{domain}/`
3. Access the theme via `useTheme()` from `@/design-system/theme/useTheme`
4. Use MUI components as the base — don't build from raw HTML unless MUI has no equivalent
5. All interactive elements must be keyboard accessible and have visible focus indicators

## Theme Structure

- `frontend/src/design-system/tokens/` — individual token files (colors, typography, spacing, breakpoints, shadows)
- `frontend/src/design-system/theme/uwm.ts` — MUI theme built from tokens
- `frontend/src/design-system/theme/ThemeProvider.tsx` — React context provider
- `frontend/src/design-system/theme/useTheme.ts` — typed hook to access current theme

## Gotchas

- The project uses MUI + Emotion, NOT Tailwind CSS. Never add Tailwind classes.
- Design system primitives (`Button`, `Input`, `Select`, etc.) are project-specific wrappers around MUI — use them instead of raw MUI components where they exist.
- Import tokens from their individual files (`@/design-system/tokens/colors`), not from a barrel export — the top-level `design-system/index.ts` does not exist yet.
- `uwm.ts` is the single source of truth for the UWM brand theme — don't create parallel theme files.
- Spacing uses a 4px base grid. MUI's `theme.spacing()` is configured to match — `theme.spacing(2)` = 8px.
- Always use `sx` prop for one-off styles. Use `styled()` only for reusable styled components.
