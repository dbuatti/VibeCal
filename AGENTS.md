# VibeCal Coding Conventions

## Stack
- React 19 + TypeScript + Vite
- Tailwind CSS + shadcn/ui components
- React Router (routes in `src/App.tsx`)
- Supabase (database + edge functions)
- date-fns / date-fns-tz for dates
- recharts for charts
- lucide-react for icons
- sonner for toasts (`showSuccess` / `showError`)

## File Structure
- `src/pages/` — route-level page components
- `src/components/` — reusable UI components
- `src/components/ui/` — shadcn/ui primitives (do not edit)
- `src/hooks/` — custom React hooks
- `src/contexts/` — React context providers
- `src/lib/` — utilities, client config
- `src/utils/` — helper functions
- `src/integrations/` — auto-generated Supabase client
- `supabase/functions/` — Supabase edge functions (Deno)

## Patterns
- Shared sync state via `SyncContext` (`useSync()` hook)
- Pages re-fetch on `vibecal:sync-complete` custom event
- Apple CalDAV sync: 90-day lookback, 180-day forward
- RRULE expansion client-side (iCloud ignores CALDAV:expand)

## Component Patterns
- Default export for pages, named export for shared components
- `cn()` from `@/lib/utils` for className merging
- `Card`, `CardContent`, `CardHeader`, `CardTitle`, `CardDescription` from shadcn
- `showSuccess()` / `showError()` from `@/utils/toast`
- `format()`, `parseISO()`, `isValid()` from date-fns
- `formatInTimeZone()` / `toDate()` from date-fns-tz

## Naming
- Files: PascalCase for components, camelCase for utils/hooks
- Edge functions: kebab-case in `supabase/functions/`
- Custom events: prefixed with `vibecal:` namespace
