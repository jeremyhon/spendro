# Statement Parser Methodology

## Purpose
This document defines the standard way to add or change deterministic statement
parsers in Spendro local mode.

## Core approach
- Build separate parsers per statement family instead of one generic parser.
- Keep parser logic deterministic and local (no external dependency required).
- Treat parser output as transaction extraction in statement billed currency.
- Validate parser changes with two checks:
  - Known-good parity against existing transactions.
  - OCR/image visibility checks for statements without known-good rows.

## Parser architecture pattern
Each format-specific parser should follow this shape in
`lib/local/parser.ts`:

1. `detectXxxStatement(rawText)`
2. `parseXxxTransactions(rawText)`
3. Dispatch order in `parseEmbeddedTransactions(rawText)`

Detection should be specific enough to avoid collisions with other formats.
Dispatch order matters when formats have overlapping keywords.

## Extraction rules
- Parse `postedOn`, `description`, `amount`, and `currency` from statement text.
- For account transfer-like rows (for example `PAYNOW-FAST`, GIRO, FAST),
  parse continuation/detail lines to enrich counterparty metadata and attach it
  to `merchant` (and optionally description suffix) when reliable.
- Keep positive outflow transactions as expenses.
- Skip credits/refunds/reversals when they are not spending.
- For account statements, use format-specific skip rules to avoid deposits,
  balances, and non-spend rows.
- Support zero-activity statements as valid parses when format is recognized.

## Foreign currency handling
Canonical transaction amount should be the statement billed amount (for example,
SGD on Singapore card statements). This reflects the actual posted spend.

If you want richer FX analytics, add optional fields at ingest time:
- `originalAmount`
- `originalCurrency`
- `fxFee` (optional)

Do not fetch historical market FX rates for parser reconciliation.

## Workflow for adding a new parser
1. Collect 3-5 representative statements for that format.
2. Add a format detector using stable header anchors.
3. Add parser logic with robust date/amount parsing.
4. Add skip rules for non-expense and non-transaction lines.
5. Add unit tests in `lib/local/parser.test.ts`.
6. Run known-good parity and OCR audit commands.
7. Investigate low-recall outliers before merging.

## Validation commands
- Unit tests:
  - `bun test lib/local/parser.test.ts`
- Known-good parity (method 1):
  - `bun run local --json parse audit-known`
  - `bun run local --json parse audit-known --statement-id <id>`
- OCR/image verification (method 2):
  - `bun run local --json parse audit-ocr --only-unknown --limit 30`
  - `bun run local --json parse audit-ocr --statement-id <id>`

## Acceptance criteria
A parser change is ready when all are true:
- Format detection is stable across representative files.
- Unit tests pass.
- No new parser failures in `parse audit-known`.
- OCR audit does not show systemic misses for that format.
- Any remaining mismatches are explained (for example, legacy data issues).

## Troubleshooting patterns
- Year-shift mismatches:
  - Verify statement date anchor first.
  - Compare parsed date range against known-good rows.
  - Correct legacy year offsets in DB when historical imports are wrong.
- Multi-page account statements:
  - Parse by page and re-detect column headers per page.
- False positives from generic parser:
  - Tighten detector patterns and dispatch order.
- OCR false negatives:
  - Increase `--dpi`, then manually inspect unresolved outliers.
