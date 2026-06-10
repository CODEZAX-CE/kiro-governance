---
name: form-patterns
description: React Hook Form + Zod form patterns for the project. Use when building forms for client intake, referral creation, consent capture, survey submission, or any multi-step form.
metadata:
  version: '1.0'
---

## Creating a New Form

1. Define the Zod schema in the component file or a co-located `schema.ts`
2. Use `useForm()` from React Hook Form with `zodResolver`
3. Use design system primitives (`Input`, `Select`, `Checkbox`) — not raw MUI or HTML inputs
4. Wire each field with `register()` or `Controller` for MUI components
5. Display field errors using `formState.errors` — show below the field, not in a toast
6. Call the domain hook method on submit

## Form Template

```typescript
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { useClients } from '@/hooks/useClients';

const schema = z.object({
  firstName: z.string().min(1, 'First name is required'),
  lastName: z.string().min(1, 'Last name is required'),
  email: z.string().email('Invalid email').optional(),
});

type FormData = z.infer<typeof schema>;

export function CreateClientForm() {
  const { create } = useClients();
  const { register, handleSubmit, formState: { errors } } = useForm<FormData>({
    resolver: zodResolver(schema),
  });

  const onSubmit = async (data: FormData) => {
    await create(data);
  };

  return (
    <form onSubmit={handleSubmit(onSubmit)}>
      {/* fields here */}
    </form>
  );
}
```

## Multi-Step Forms

- Client intake and referral creation use multi-step wizards
- Track current step with local state (`useState`)
- Validate per-step with Zod `.pick()` or separate schemas per step
- Save draft on step change for long forms (client intake)

## Gotchas

- Always use `zodResolver` — don't write manual validation logic. Zod schemas are the single source of truth for form validation.
- MUI components need `Controller` from React Hook Form, not `register()`. Only native HTML inputs work with `register()`.
- Required fields must be marked with `*` in the label AND have `aria-required="true"` for accessibility.
- Error messages must be in both English and Spanish — use i18n keys, not hardcoded strings.
- Phone number fields use the validator from `@[project]/shared/utils/validation.ts` — don't write a custom regex.
- Consent forms have special requirements: capture method (in-person, e-sign, SMS, verbal, proxy) must be recorded. Check `@[project]/shared/types/consent.ts` for the full shape.
