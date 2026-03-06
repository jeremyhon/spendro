# Spendro Local-First Rearchitecture

## Intentions
- Reimagine Spendro as a local-first personal finance toolkit.
- Make CLI and local data ownership the default operating model.
- Keep an optional local web UI backed by the same SQLite core.
- Remove cloud backend/runtime dependencies and deployment requirements.

## Requirements

### Functional requirements
- Run locally as:
  - CLI-first workflow for humans and agents.
  - local web UI reading/writing the same SQLite database.
- Store statement files locally.
- Store statement extracted text locally.
- Parse extracted text into transactions in two modes:
  - `agent` mode: external/agent JSON payload import.
  - `embedded` mode: in-process parser backend (`deterministic` or `llm`).
- Store and manage:
  - statements
  - statement text entries
  - transactions/spending data
  - categories
  - parse run history
- Expose machine-friendly CLI outputs for agents (`--json`).
- Create compressed backups of all local data and statement files.
- Restore from compressed backups.
- Require no deployment.

### Non-functional requirements
- Data model is SQLite-based.
- One shared local domain layer is reused by CLI and web actions.
- CLI commands are deterministic and scriptable with stable exit behavior.
- Embedded LLM parsing reuses existing webapp extraction pipeline.
- Use a CLI framework (`commander`) rather than manual argv parsing.

## Local SQLite Core (definition)
The "local SQLite core" is the backend/service layer implemented in
`lib/local/`. It owns local persistence, parser workflows, backup/restore,
and common operations used by both:
- CLI (`scripts/local-cli.ts`)
- web server actions (`app/actions/*`)

SQLite access uses Bun's native driver: `bun:sqlite`.

## Current architecture
- `lib/local/repository.ts`: SQLite schema bootstrap + statement/category/
  parse-run/transaction operations.
- `lib/local/web-adapter.ts`: web action-friendly CRUD operations over SQLite.
- `lib/local/parser.ts`: deterministic parser + agent JSON parser.
- `lib/local/llm-parser.ts`: embedded LLM parser using shared AI pipeline.
- `lib/local/backup.ts`: compressed backup/restore of db + statements.
- `scripts/local-cli.ts`: Commander-based CLI interface.
- `app/actions/categories.ts`, `app/actions/expense.ts`,
  `app/actions/ingestion.ts`: local-only web action adapters.

## SQLite data model
- `statements`
- `statement_texts`
- `parse_runs`
- `transactions`
- `categories`

## CLI surface
- `spendro-local init`
- `spendro-local statement store --file <path>`
- `spendro-local statement list [--json]`
- `spendro-local statement text add --statement-id <id> --file <path>`
- `spendro-local parse run --statement-id <id> --mode embedded|agent [--backend deterministic|llm] [--input <path>] [--json]`
- `spendro-local category add --name <name> [--description <text>]`
- `spendro-local category list [--json]`
- `spendro-local transaction list [--statement-id <id>] [--json]`
- `spendro-local backup create [--out <path>]`
- `spendro-local backup restore --file <path>`

## Local web scope
- Dashboard charts/headline numbers read local SQLite expenses.
- Expenses page supports local edit/delete/bulk delete with category updates.
- Categories page supports local CRUD/reassignment behavior.
- Ingestion prompt is stored locally at `${SPENDRO_HOME}/ingestion-prompt.txt`.
- Auth is local synthetic user only (no external auth provider).

## Legacy removals completed
Removed as part of local-only migration:
- PocketBase client/server/api routes and auth cookie synchronization.
- Supabase storage/database migration artifacts and scripts.
- Merchant mapping UI/actions and PocketBase debug page.
- Cloud upload/realtime hooks and related cloud processor utilities.
- PocketBase/Supabase package dependencies and cloud dev scripts.

## Quickstart
```bash
export SPENDRO_HOME=/tmp/spendro-local

bun run local init
bun run local statement store --file /path/to/statement.pdf
bun run local statement list --json
bun run local statement text add --statement-id <id> --file /path/to/text.txt
bun run local parse run --statement-id <id> --mode embedded --json
bun run local transaction list --statement-id <id> --json
bun run local backup create --json
```

## LLM parser requirements
- `GOOGLE_GENERATIVE_AI_API_KEY` for `--backend llm`.
- Optional model override: `SPENDRO_LOCAL_LLM_MODEL`.
- Default model: `gemini-2.5-flash`.
- Shared extraction path: `lib/utils/ai-processor.ts`.

## Progress
- [x] Intentions and requirements documented.
- [x] Local SQLite core implemented.
- [x] Commander CLI implemented.
- [x] Embedded LLM parser integrated via shared AI pipeline.
- [x] Web categories/expenses/ingestion actions migrated to SQLite.
- [x] PocketBase/Supabase runtime remnants removed.
- [ ] Add focused tests for local core and web adapters.

## Verified behavior (2026-03-06)
- `bun run check` passes (Biome + TypeScript).
- CLI smoke test passed with temporary `SPENDRO_HOME`:
  - `local init`
  - `local statement store`
  - `local statement text add`
  - `local parse run --mode embedded`
  - `local transaction list`

## Change log
- 2026-03-06: Defined local-first intentions/requirements and migration plan.
- 2026-03-06: Implemented `lib/local` core + Commander CLI + backup/restore.
- 2026-03-06: Added local web adapters for categories/expenses/ingestion.
- 2026-03-06: Completed local-only cleanup by removing PocketBase/Supabase
  runtime stack and related UI/routes/scripts.
