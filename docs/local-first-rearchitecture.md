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
- Track account/card identity separately from statements:
  - institution/provider
  - product type (`card`, `account`, `other`)
  - account label
  - optional last-4 digits
- Tag each statement to:
  - an account/card identity
  - a normalized statement month (`YYYY-MM`)
- Automate missing-statement detection by account/card and month.
- Expose machine-friendly CLI outputs for agents (`--json`).
- Create compressed backups of all local data and statement files.
- Restore from compressed backups.
- Require no deployment.

### Non-functional requirements
- Data model is SQLite-based.
- One shared local domain layer is reused by CLI and web actions.
- CLI commands are deterministic and scriptable with stable exit behavior.
- CLI tooling runs on Node (`node --import tsx`) for Bun-independent execution.
- Embedded LLM parsing reuses existing webapp extraction pipeline.
- Use a CLI framework (`commander`) rather than manual argv parsing.

## Local SQLite Core (definition)
The "local SQLite core" is the backend/service layer implemented in
`lib/local/`. It owns local persistence, parser workflows, backup/restore,
and common operations used by both:
- CLI (`scripts/local-cli.ts`)
- web server actions (`app/actions/*`)

SQLite access is Node-only via `better-sqlite3` in `lib/local/sqlite.ts`
(shared by Next.js server actions and Node CLI commands).
Numbered SQL placeholders (`?1`, `?2`) are normalized for
`better-sqlite3` compatibility.
Local path resolution order is:
1. `SPENDRO_HOME` (if set)
2. `<repo>/.local-spendro` (if present)
3. `~/.spendro`

## Current architecture
- `lib/local/repository.ts`: SQLite schema bootstrap + statement/category/
  parse-run/transaction operations.
- `lib/local/web-adapter.ts`: web action-friendly CRUD operations over SQLite.
- `lib/local/parser.ts`: deterministic parser + agent JSON parser.
- `lib/local/parser-audit.ts`: parser validation utilities (known-good parity +
  OCR/image verification).
- `lib/local/llm-parser.ts`: embedded LLM parser using shared AI pipeline.
- `lib/local/backup.ts`: compressed backup/restore of db + statements.
- `scripts/local-cli.ts`: Commander-based CLI interface.
- `app/actions/categories.ts`, `app/actions/expense.ts`,
  `app/actions/ingestion.ts`: local-only web action adapters.
- Parser implementation and testing methodology:
  - `docs/parser-methodology.md`

## SQLite data model
- `statements`
- `statement_texts`
- `parse_runs`
- `transactions`
- `categories`
- `accounts`
- `statement_account_months`
- `statement_account_overrides`
- `categorization_rules`

## Statement coverage automation
- `accounts` stores normalized account/card concepts (institution, product,
  label, optional last4, active flag).
- `statement_account_months` stores the statement-to-account mapping with
  statement month and inference metadata.
- `statement_account_overrides` stores manual statement/account/month
  corrections that persist across future refreshes.
- `coverage refresh` re-computes mappings for all statements from filename +
  first-page PDF text inference, while applying manual overrides first.
- `coverage gaps` computes month gaps per active account from first observed
  month through `--as-of` (default: previous calendar month).
- Current output is deterministic and scriptable via JSON for agent workflows.

## CLI surface
- `spendro-local init`
- `spendro-local statement store --file <path>`
- `spendro-local statement list [--json]`
- `spendro-local statement text add --statement-id <id> --file <path>`
- `spendro-local parse run --statement-id <id> --mode embedded|agent [--backend deterministic|llm] [--input <path>] [--json]`
- `spendro-local parse audit-known [--statement-id <id>] [--limit <n>] [--json]`
- `spendro-local parse audit-ocr [--statement-id <id>] [--only-unknown] [--limit <n>] [--dpi <n>] [--json]`
- `spendro-local category add --name <name> [--description <text>]`
- `spendro-local category list [--json]`
- `spendro-local rule list [--json]`
- `spendro-local rule add --field <merchant|description> --match <exact|contains|regex> --pattern <text> [--action <categorize|hide|ignore>] [--category <name>] [--account-id <id>] [--priority <n>] [--notes <text>] [--inactive] [--json]`
- `spendro-local rule remove --rule-id <id> [--json]`
- `spendro-local rule test --description <text> [--merchant <text>] [--account-id <id>] [--json]`
- `spendro-local transaction list [--statement-id <id>] [--json]`
- `spendro-local backup create [--out <path>]`
- `spendro-local backup restore --file <path>`
- `spendro-local coverage refresh`
- `spendro-local coverage accounts [--json]`
- `spendro-local coverage map [--json]`
- `spendro-local coverage overrides [--json]`
- `spendro-local coverage assign --statement-id <id> --institution <name> --product-type <card|account|other> --label <label> --month <YYYY-MM> [--last4 <digits>] [--reason <text>] [--no-refresh] [--json]`
- `spendro-local coverage unassign --statement-id <id> [--no-refresh] [--json]`
- `spendro-local coverage gaps [--as-of <YYYY-MM>] [--include-complete] [--no-refresh] [--json]`
- `bun run sql [--db <path>] [--json] [--write] [--param <value> ...] -- "<SQL>"`
- `bun run import:cloud --email <email> --password <password> [--reset-local] [--download-statements] [--json]`

### Quick SQL helper
- Script: `scripts/sqlite-query.ts`
- Purpose: run ad-hoc SQL quickly against local SQLite for debugging/analysis.
- Default database: path resolved by `resolveLocalPaths()` (see above order).
- Read-only by default; pass `--write` for mutating SQL.

Examples:
```bash
bun run sql "select count(*) as total from transactions"
bun run sql --param UOB --param 5 -- "select * from statements where bank_name = ?1 limit ?2"
bun run sql --write --param "Utilities" --param "<category-id>" -- "update categories set name = ?1 where id = ?2"
```

## Cloud Import (one-time migration)
- Script: `scripts/import-cloud-to-local.ts`
- Auth: PocketBase user credentials (email + password)
- Source URL default: `NEXT_PUBLIC_POCKETBASE_URL` or `POCKETBASE_URL`
- Destination: current `SPENDRO_HOME` local SQLite + statements directory
- Optional `--reset-local` clears local data before import
- Optional `--download-statements` attempts to fetch files from `blob_url`; if download fails, importer creates local metadata stub files so statement records remain consistent

Example:
```bash
export SPENDRO_HOME=/tmp/spendro-local
export PB_USER_EMAIL="you.com"
export PB_USER_PASSWORD="your-password"
bun run import:cloud --reset-local --download-statements
```

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
bun run local coverage assign --statement-id <id> --institution UOB --product-type card --label Card --last4 1234 --month 2026-02 --json
bun run local coverage overrides --json
bun run local coverage gaps --as-of 2026-02 --json
bun run local backup create --json
```

## LLM parser requirements
- `GOOGLE_GENERATIVE_AI_API_KEY` for `--backend llm`.
- Optional model override: `SPENDRO_LOCAL_LLM_MODEL`.
- Default model: `gemini-2.5-flash`.
- Shared extraction path: `lib/utils/ai-processor.ts`.
- Optional web suppression list: `SPENDRO_HIDDEN_TRANSACTION_IDS`
  (comma-separated transaction IDs hidden from local web expense/fact views).
- Built-in web suppression rule also hides internal self-transfer style rows
  involving `JEREMY HON` (for example GIRO/FAST transfer descriptions).
- Embedded LLM prompt now receives rule-based categorization hints from
  `categorization_rules` so recurring merchant/category preferences are applied
  consistently.

## Preference surfaces
Persisted user-preference/state surfaces in local mode:
- `categorization_rules` table for recurring categorization and visibility logic
  (`categorize`, `hide`, `ignore` actions).
- `statement_account_overrides` for manual account/month coverage corrections.
- `${SPENDRO_HOME}/ingestion-prompt.txt` for ingestion prompt customization.

## Deterministic parser coverage
- Citibank credit card statements (`CardStatement_*`, `Citibank_CreditCard_*`)
- DBS credit card statements (`dbs_cc_*`, `dbs_live_fresh_*`,
  `Credit_Cards_Consolidated_Statement_*`)
- DBS/POSB consolidated account statements (`DBS_POSB Consolidated Statement_*`)
- DBS deposit/account statements (`dbs_account_*`, `Deposit_Account_Statement_*`)
- UOB credit card statements (`eStatement__*.pdf`, `eStatement.pdf`)
- UOB account statements (`uob_*.pdf`)
- OCBC 90.N card statements (`OCBC_90.N_CARD-*`)
- UOB account summary-only statements (recognized as valid zero-transaction
  statements)

## Progress
- [x] Intentions and requirements documented.
- [x] Local SQLite core implemented.
- [x] Commander CLI implemented.
- [x] Embedded LLM parser integrated via shared AI pipeline.
- [x] Web categories/expenses/ingestion actions migrated to SQLite.
- [x] Account/month statement coverage model + gap detection implemented.
- [x] Manual coverage override model + CLI commands implemented.
- [x] PocketBase/Supabase runtime remnants removed.
- [x] Bank-specific deterministic parsers expanded and cross-check tooling added.
- [ ] Add focused tests for local core and web adapters.

## Verified behavior (2026-03-06)
- `bun run check` passes (Biome + TypeScript).
- Node-based CLI entrypoints execute successfully via package scripts:
  - `bun run local:help`
  - `bun run sql:help`
  - `bun run import:cloud:help`
- Dev server smoke test (2026-03-06) passed via agent-browser:
  - Opened and interacted with `/`, `/expenses`, `/categories`, `/ingestion`
  - No browser page errors reported by `agent-browser errors`
- `bun run local coverage refresh --json` returns:
  - `processedStatements: 66`
  - `taggedStatements: 64`
  - `unclassifiedStatements: 2` (both are local test PDFs)
  - `accountsCount: 9`
  - `coverageRowsCount: 64`
- `bun run local coverage gaps --as-of 2026-02 --json` returns per-account
  missing-month lists (including expected Jan-Feb 2026 checks).
- Manual override smoke test in isolated `SPENDRO_HOME`:
  - before override: `coverage refresh` returned `unclassifiedStatements: 1`
  - after `coverage assign`: `coverage refresh` returned
    `manualOverrideStatements: 1`, `taggedStatements: 1`
  - after `coverage unassign`: `coverage refresh` returned
    `manualOverrideStatements: 0`, `unclassifiedStatements: 1`
- Local dataset consolidation run (2026-03-06):
  - Consolidated DBS card formats (`dbs_cc_*`, `dbs_live_fresh_*`,
    `Credit_Cards_Consolidated_Statement_*`) into one canonical account:
    `DBS / card / Live Fresh / 8217` using manual overrides.
  - Post-refresh result: `manualOverrideStatements: 12`, `accountsCount: 7`.
  - Duplicate month check for consolidated DBS card:
    - `2025-01` has two statement records.
    - Files are byte-identical (`sha256` match) and extracted text hashes match,
      indicating a duplicate copy of the same statement.
- Windows Downloads import run (2026-03-06):
  - Imported 13 new statement PDFs from `/mnt/c/Users/Jeremy/Downloads`
    (Citibank, DBS, UOB).
  - Added manual normalization overrides for 7 statements:
    - DBS consolidated card statements (Dec 2025, Jan 2026, Feb 2026) ->
      `DBS / card / Live Fresh / 8217`
    - DBS POSB consolidated deposit statements (Jan 2026, Feb 2026) ->
      `DBS / account / Deposit Account`
    - DBS deposit statements inferred as generic statement (Sep 2025, Dec 2025)
      -> `DBS / account / Deposit Account`
  - Post-import refresh:
    - `processedStatements: 78`
    - `taggedStatements: 76`
    - `unclassifiedStatements: 2`
    - `manualOverrideStatements: 18`
    - `accountsCount: 7`
  - Post-import gaps as-of `2026-02` reduced to:
    - OCBC 90N (`1805`): `2026-01`, `2026-02`
    - OCBC 90N (`5540`): `2025-11`, `2025-12`, `2026-01`, `2026-02`
    - UOB Card (`4265`): `2026-01`, `2026-02`
- Parse run attempt for newly imported statements (2026-03-06):
  - Added extracted text (`pdftotext`, source `pdftotext`) for all 13 newly
    imported statements.
  - Ran embedded LLM parse on all 13 statements.
  - Result: 13 failed / 0 succeeded due provider error:
    `API key expired. Please renew the API key.`
  - Statement coverage/gap analysis remains valid because it is independent of
    transaction parse success.
- CLI smoke test passed with temporary `SPENDRO_HOME`:
  - `local init`
  - `local statement store`
  - `local statement text add`
- Local data cleanup and enrichment (2026-03-06):
  - Added category `Childcare`.
  - Reassigned `ACUFEM` + `CONFINEMENT NANNY` transactions to `Childcare`.
  - Dec 23, 2025 large `PAYNOW-FAST` transfer enriched to
    `PAYNOW-FAST - ACUFEM MEDICAL PTE.` using statement text evidence
    (`PIB2512238650265897`, `ACUFEM MEDICAL PTE.`, `OTHR 198002648R`).
  - Ran transfer-detail enrichment backfill from stored statement texts:
    18 generic transfer rows were updated with counterparties.
  - Internal transfers to `JEREMY HON` are hidden from local web expense/fact
    views.
  - Added persistent rule engine and CLI management:
    - Rule actions: `categorize`, `hide`, `ignore`
    - Match controls: `field` (`merchant|description`), `type`
      (`exact|contains|regex`), optional account scope, priority ordering
    - Parse-time application for deterministic, LLM, and agent parse modes
    - LLM prompt awareness via injected categorization hint lines
  - Added starter rules:
    - `ACUFEM` -> `Childcare`
    - `CONFINEMENT NANN` -> `Childcare`
    - `JEREMY HON` self-transfer rows -> hidden
  - `local parse run --mode embedded`
  - `local transaction list`
- Deterministic parser regression + validation run (2026-03-06):
  - `bun test lib/local/parser.test.ts` passes (8 tests).
  - Known-good parity (`bun run local --json parse audit-known`):
    - `totalKnownStatements: 56`
    - `comparedStatements: 56`
    - `parseFailures: 0`
    - `avgRecall: 0.9779`
    - `avgPrecision: 0.8985`
    - `perfectMatches: 26`
    - Notable mismatch buckets:
      - Corrected year-shifted legacy known-good rows for two UOB card
        statements:
        - `eStatement__8_.pdf`: shifted `+1` year
        - `eStatement__5_.pdf`: shifted `+2` years
      - Citi mismatch reconciliation completed:
        - Updated legacy Citi transaction amounts to statement-billed deterministic
          parse amounts while preserving existing categorized rows.
        - Reconciled key-count gaps by inserting/deleting unmatched legacy keys on
          affected Citi statements.
        - Result: all Citi statements in known-good parity now return
          `recall: 1` and `precision: 1`.
  - OCR/image verification for unknown statements (`parse audit-ocr --limit 30`):
    - `totalStatements: 22`
    - `successfulStatements: 22`
    - `failedStatements: 0`
    - `parsedTransactions: 307`
    - `ocrUnmatchedTransactions: 53` (flagged for manual review, mostly OCR
      misses on dense card pages)
  - Summary-only/zero-activity statements are now treated as valid parse outputs
    with zero transactions instead of parser failures.
- UOB XLS extraction + import run (2026-03-06):
  - Parsed and imported UOB card exports:
    - `CC_TXN_History_06032026145414.xls` (statement month `2026-01`)
    - `CC_TXN_History_06032026145425.xls` (statement month `2026-02`)
  - Ingested via:
    - `statement store` + `parse run --mode agent` (array JSON payload)
    - `coverage assign` manual overrides to
      `UOB / card / ONE Card / 4962`
  - Disabled legacy inferred UOB card buckets (`UOB / card / Card`) so
    gap tracking reflects the active card portfolio.
  - Imported transactions:
    - Jan statement: 2 expenses (MyRepublic, Pacificlight)
    - Feb statement: 3 expenses (MyRepublic, Pacificlight, Loom)
  - Pacificlight continuity now extends through:
    - `2025-12` (SGD 191.98)
    - `2026-01` (SGD 209.59)
- OCBC 1805 Jan/Feb import run (2026-03-06):
  - Imported and parsed:
    - `OCBC 90.N CARD-1805-Jan-26.pdf` (`statementId: c9dee282-66e7-485c-a37d-f700560c2c3b`, 21 transactions)
    - `OCBC 90.N CARD-1805-Feb-26.pdf` (`statementId: c13cd184-a0bf-4b2a-9195-350906eb63f1`, 24 transactions)
  - Added manual coverage overrides:
    - Jan 2026 -> OCBC 90N Card (`last4=1805`)
    - Feb 2026 -> OCBC 90N Card (`last4=1805`)
  - Marked OCBC 90N Card (`last4=5540`) inactive per user instruction.
  - Post-refresh gap result as-of `2026-02`: no remaining gaps.

## Change log
- 2026-03-06: Defined local-first intentions/requirements and migration plan.
- 2026-03-06: Implemented `lib/local` core + Commander CLI + backup/restore.
- 2026-03-06: Added local web adapters for categories/expenses/ingestion.
- 2026-03-06: Completed local-only cleanup by removing PocketBase/Supabase
  runtime stack and related UI/routes/scripts.
- 2026-03-06: Added parser methodology documentation for format-specific parser
  design and cross-check testing workflow.
- 2026-03-06: Added `scripts/sqlite-query.ts` + `bun run sql` shortcut for fast
  ad-hoc SQLite querying in local mode.
- 2026-03-06: Switched CLI package scripts to Node runtime (`node --import tsx`)
  for `local`, `sql`, and `import:cloud` commands.
- 2026-03-06: Simplified SQLite adapter to Node-only (removed Bun runtime
  branch) now that CLI and server execution paths are both Node-based.
- 2026-03-06: Added local web suppression support for hidden transactions via
  `SPENDRO_HIDDEN_TRANSACTION_IDS`; default suppression includes the Dec 2025
  509,405 outlier transaction.
- 2026-03-06: Enhanced deterministic account-statement parsing to enrich
  transfer-like rows (PayNow/FAST/GIRO) with counterparty metadata from
  continuation lines, populating clearer `description` + `merchant` values.
- 2026-03-06: Reparsed Jan-Feb 2026 DBS account statements to backfill enriched
  transfer metadata in local data (`PAYNOW-FAST`, FAST/GIRO, funds transfers).
- 2026-03-06: Migrated active local data home into repo at `.local-spendro`
  and ignored it in git; updated path resolution to prefer repo-local data when
  present.
- 2026-03-06: Extracted and imported UOB `.xls` transaction exports into local
  statements/transactions and mapped coverage to UOB ONE Card (`last4=4962`).
- 2026-03-06: Imported OCBC 1805 Jan/Feb 2026 PDFs, mapped coverage months,
  and deactivated OCBC 5540 account for gap tracking.
