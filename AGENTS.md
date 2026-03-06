# Repository Guidelines

## Project Structure & Module Organization
- `app/`: Next.js App Router pages, layouts, and server actions.
- `components/`: reusable UI components (shadcn/ui + custom).
- `hooks/`: React hooks for local data consumption.
- `lib/local/`: local SQLite core, parser backends, backup/restore, and web adapter.
- `lib/types/` + `lib/utils/`: shared schemas and UI/domain utilities.
- `scripts/local-cli.ts`: local CLI entrypoint (`spendro-local`).
- `scripts/import-cloud-to-local.ts`: one-time PocketBase -> local SQLite importer.
- `docs/local-first-rearchitecture.md`: architecture, intentions, requirements,
  and migration progress.
- `app/globals.css`: global styling and Tailwind setup.
- `public/`: static assets.

## Build, Test, and Development Commands
- `bun run dev`: start the Next.js dev server (Turbopack) and log to `dev.log`.
- `bun run build`: create a production build.
- `bun run start`: run the production server.
- `bun run check`: Biome lint/format + `tsc --noEmit`.
- `bun run ci`: `check` + `build` for CI.
- `bun test`: run Bun’s test runner.
- `bun run local`: run the local CLI.
- `bun run local:help`: show CLI help.
- `bun run import:cloud`: import cloud PocketBase data into local SQLite.
- `bun run import:cloud:help`: show importer help.

## Coding Style & Naming Conventions
- TypeScript + React with 2-space indentation, double quotes, semicolons, 80-char line width.
- Formatting/linting via Biome (`biome.json`); do not use ESLint/Prettier.
- Tests use `.test.ts` suffix and live alongside source files.
- Keep local-first logic centralized in `lib/local/` and reuse it from both CLI and web actions.

## Testing Guidelines
- Framework: Bun’s built-in test runner (`bun:test`).
- Naming: co-located `*.test.ts` files, no `__tests__/` folders.
- Run all tests with `bun test`.

## Commit & Pull Request Guidelines
- Commit messages follow Conventional Commits (`feat: ...`, `fix: ...`, `docs: ...`).
- PRs should include a clear summary and screenshots for UI changes.
- When changing local architecture or CLI surface, update
  `docs/local-first-rearchitecture.md`.

## Configuration & Security Notes
- Use `.env.local` for local development; do not commit secrets.
- Core local env vars:
  - `SPENDRO_HOME` (optional): overrides local data directory.
  - `GOOGLE_GENERATIVE_AI_API_KEY` (required only for embedded LLM parsing).
  - `SPENDRO_LOCAL_LLM_MODEL` (optional): overrides default local LLM model.
  - `PB_USER_EMAIL` and `PB_USER_PASSWORD` (for cloud import script).
  - `POCKETBASE_URL` (optional, defaults to `NEXT_PUBLIC_POCKETBASE_URL`).

## Agent-Specific Instructions
- Check logs in `dev.log` when debugging dev server output.
