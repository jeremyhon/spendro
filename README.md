# Spendro

Spendro is now a local-first personal finance toolkit.

It runs entirely on your machine with no required deployment and no cloud
runtime dependency. The CLI and local web app share the same SQLite-backed core.

## Current Status

Local-first migration is complete.

- Primary workflow: local CLI (`spendro-local`)
- Optional UI: local Next.js web app on the same data
- Storage: local SQLite + local statement files
- Parsing: deterministic parser and optional embedded LLM backend
- Coverage: account/card + statement-month mapping and gap detection
- Backup: compressed archive create/restore

Detailed architecture and migration history:
- `docs/local-first-rearchitecture.md`

## Core Capabilities

- Store statement PDFs locally
- Store extracted statement text locally
- Parse statements into transactions
  - Embedded deterministic parser
  - Embedded LLM parser
  - Agent JSON import mode
- Manage categories and spending data locally
- Persist categorization/visibility preferences with local rules
- Track account/card identity with optional `last4`
- Track statement-month coverage and detect missing months
- Create and restore compressed local backups

## Architecture

Local backend/service layer lives in `lib/local/` and is shared by both CLI and
web actions.

Key modules:
- `lib/local/repository.ts`: domain operations + persistence
- `lib/local/sqlite.ts`: SQLite adapter (`better-sqlite3`)
- `lib/local/parser.ts`: deterministic statement parsers
- `lib/local/llm-parser.ts`: embedded LLM parsing
- `lib/local/backup.ts`: backup and restore
- `scripts/local-cli.ts`: CLI entrypoint

## Data Location

Spendro resolves local data home in this order:

1. `SPENDRO_HOME` (if set)
2. `<repo>/.local-spendro` (if present)
3. `~/.spendro`

Local DB path:
- `<home>/spendro.db`

Statement file store:
- `<home>/statements/`

## Quick Start

```bash
bun install
bun run local init
```

Store and parse a statement:

```bash
bun run local statement store --file /path/to/statement.pdf
bun run local statement text add --statement-id <id> --file /path/to/text.txt
bun run local parse run --statement-id <id> --mode embedded --json
bun run local transaction list --statement-id <id> --json
```

Run local web app:

```bash
bun run dev
```

## CLI Commands

Main command groups:
- `statement`: store/list statement files
- `parse`: run parsers + parser audits
- `category`: add/list categories
- `rule`: add/list/remove/test categorization rules
- `transaction`: list transactions
- `coverage`: refresh mappings, manage overrides, detect gaps
- `backup`: create/restore archive

Helpful scripts:
- `bun run local:help`
- `bun run sql:help`
- `bun run import:cloud:help`

Quick SQL helper:

```bash
bun run sql "select count(*) as total from transactions"
bun run sql --write -- "update categories set name='Utilities' where id=?1"
```

## Environment Variables

Core local vars:
- `SPENDRO_HOME` (optional)
- `GOOGLE_GENERATIVE_AI_API_KEY` (required for embedded LLM parsing)
- `SPENDRO_LOCAL_LLM_MODEL` (optional model override)

Migration-only vars (legacy cloud import script):
- `PB_USER_EMAIL`
- `PB_USER_PASSWORD`
- `POCKETBASE_URL`

## Documentation

- Architecture and migration progress:
  - `docs/local-first-rearchitecture.md`
- Parser design and validation method:
  - `docs/parser-methodology.md`

## Legacy

The project has fully moved to local-first mode.

Legacy cloud stack has been removed from runtime:
- PocketBase client/server/api runtime paths
- Supabase runtime/migration artifacts
- Cloud upload/realtime processing hooks

What remains for backward compatibility:
- `scripts/import-cloud-to-local.ts`
  - One-time importer to pull existing PocketBase data into local SQLite
  - Imports cloud `merchant_mappings` into local `categorization_rules` when
    available
  - Useful only if you still have old cloud data to migrate

No deployment is required for normal operation.
