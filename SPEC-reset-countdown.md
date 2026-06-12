# SPEC: Analytics live reset countdowns + 5-min refresh label (task_1781284379648)

Adam-requested, matching Anthropic's own console format. Two changes, dashboard only.
Stack: Next.js 14 app router, the panel is the SERVER component
`dashboard/src/components/analytics/subscription-usage.tsx`. No new dependencies.
NO em or en dashes anywhere in added text (use hyphens).

## Change 1 - footer label
In `subscription-usage.tsx` line ~134: `refreshes every 15 min` -> `refreshes every 5 min`.
(Leave the rest of the footer line untouched.)

## Change 2 - live reset countdowns

Every "Resets <PT time>" line under a usage bar (UsageRow, used by both the 3 Claude
account cards' 5h + 7d bars AND the Codex card's two bars) becomes a LIVE countdown.

### New file `dashboard/src/components/analytics/reset-countdown.tsx`
A small CLIENT component ('use client'):

```tsx
'use client';
export function formatResetCountdown(diffMs: number): string
export function ResetCountdown({ resets, fallback }: { resets?: string; fallback: string })
```

- `formatResetCountdown(diffMs)` (EXPORTED, pure - this is the unit-tested core):
  - diffMs <= 0            -> 'Resets soon'           (data refreshes within 5 min)
  - 0 < diffMs < 60_000    -> 'Resets in <1 min'
  - < 60 min               -> 'Resets in 26 min'      (minutes = Math.ceil(diffMs / 60_000);
                               ceil so it never shows 0 while still in the future.
                               EDGE: if ceil yields exactly 60 -> fall through to the h/m form: 'Resets in 1h 0m')
  - >= 60 min              -> 'Resets in 1h 12m'      (hours = floor(min/60), rem = min % 60; always show the m part, e.g. 'Resets in 2h 0m')
- `ResetCountdown`:
  - If `resets` is missing or unparseable (isNaN on Date.parse) -> render the `fallback` string as-is.
  - HYDRATION-SAFE mounted pattern: `const [now, setNow] = useState<number | null>(null)`;
    in `useEffect`, set immediately and then `setInterval` every 30_000 ms (clear on unmount).
    While `now === null` (server render AND first client paint) render the `fallback`
    string - this guarantees server/client markup match, then the countdown swaps in
    after mount. No suppressHydrationWarning needed.
  - When mounted: render `formatResetCountdown(Date.parse(resets) - now)`.
  - Render shape: a `<p className="text-[10px] text-muted-foreground">` exactly like the
    current static line (the component returns the whole <p>, the parent stops wrapping it).

### Wire-up in `subscription-usage.tsx`
Replace (in UsageRow):
```tsx
{resets && <p className="text-[10px] text-muted-foreground">Resets {ptTime(resets)}</p>}
```
with:
```tsx
{resets && <ResetCountdown resets={resets} fallback={`Resets ${ptTime(resets)}`} />}
```
Import the component. ptTime stays where it is (the fallback keeps the PT-time rule for
SSR/no-JS). Touch NOTHING else in the file beyond the footer label.

## Tests
New `dashboard/src/components/analytics/__tests__/reset-countdown.test.ts` (vitest, pure
function tests only - no DOM needed):
- 26 min out -> 'Resets in 26 min'
- 72 min out -> 'Resets in 1h 12m'
- exactly 60 min -> 'Resets in 1h 0m'
- 2h 0m case -> 'Resets in 2h 0m'
- 30 s out -> 'Resets in <1 min'
- 0 / negative -> 'Resets soon'
- ceil behavior: 61 s out -> 'Resets in 2 min' (not 1)
Match the import style of existing dashboard tests (see dashboard/src/lib/__tests__/).

## Validation (run from the worktree)
- `cd dashboard && npx tsc --noEmit` must pass (dashboard has its own tsconfig).
- From the WORKTREE ROOT: `npx vitest run dashboard/src/components/analytics/__tests__/reset-countdown.test.ts`.
Do not run next build (deploy step is the orchestrator's, Node 25). Do not git add or commit.
