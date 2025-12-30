# Repository Guidelines

## Project Structure & Module Organization
- `app/`: Next.js App Router pages, layouts, and route handlers.
- `components/`: reusable UI components (shadcn/ui + custom).
- `hooks/`: React hooks (notably PocketBase data hooks).
- `lib/`: shared utilities, PocketBase client, Supabase Storage client, env validation.
- `scripts/`: dev and database helper scripts.
- `styles/` and `app/globals.css`: global styling and Tailwind setup.
- `public/`: static assets.
- `supabase/`: legacy migrations/config (kept for reference and data export).

## Build, Test, and Development Commands
- `bun run dev`: start the Next.js dev server (Turbopack) and log to `dev.log`.
- `bun run build`: create a production build.
- `bun run start`: run the production server.
- `bun run check`: Biome lint/format + `tsc --noEmit`.
- `bun run ci`: `check` + `build` for CI.
- `bun test`: run Bun’s test runner.
- `bun run reset`: reset local DB and storage (if present in your branch).

## Coding Style & Naming Conventions
- TypeScript + React with 2-space indentation, double quotes, semicolons, 80-char line width.
- Formatting/linting via Biome (`biome.json`); do not use ESLint/Prettier.
- Tests use `.test.ts` suffix and live alongside source files (e.g., `lib/utils/temporal-dates.test.ts`).
- Keep env vars centralized in `lib/env.ts` with T3 Env validation.

## Testing Guidelines
- Framework: Bun’s built-in test runner (`bun:test`).
- Naming: co-located `*.test.ts` files, no `__tests__/` folders.
- Run all tests with `bun test` or target patterns: `bun test temporal`.

## Commit & Pull Request Guidelines
- Commit messages follow Conventional Commits seen in history: `feat(ui): ...`, `fix(dashboard): ...`, `docs: ...`.
- PRs should include a clear summary, linked issues, and UI screenshots when applicable.
- If schema changes are involved, include migration notes and update `supabase/` artifacts.

## Configuration & Security Notes
- Required environment variables are defined in `lib/env.ts`.
- Use `.env.local` for local development; do not commit secrets.
- PocketBase is the primary DB/auth; Supabase is used for Storage uploads.
- Relevant vars include `NEXT_PUBLIC_POCKETBASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, and optional `SUPABASE_STORAGE_BUCKET`.

## Agent-Specific Instructions
- Do not start or stop the dev server; it is managed externally.
- Check logs in `dev.log` when debugging dev server output.
