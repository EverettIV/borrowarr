# BorrowArr marketing / landing page (archived)

This folder holds the former app root landing page (`client/app/page.tsx`) that was shown at `/`.

The live app now redirects `/` to `/pages/discover`. This archive is for a separate marketing site or reference.

## Contents

- `page.tsx` — original Next.js client component (was `client/app/page.tsx`)

## Styling

The landing page relied on utility classes defined in `client/styles/globals.scss`, including:

- `pulse-glow`, `animate-float`, `shimmer`
- `glow-border`, `hover-lift`, `btn-glow`, `card-interactive`
- `text-gradient-animate`, `neon-text`, `link-hover`

If you spin this up as a standalone site, copy those rules or depend on the same global stylesheet.

## Dependencies

Built for the BorrowArr client stack: Next.js, HeroUI (`@heroui/react`), `lucide-react`, and the app layout/providers (not included here).