import { describe, expect, test } from "bun:test";
import {
  type CategorizationRuleMatcher,
  doesCategorizationRuleMatch,
  findFirstMatchingCategorizationRule,
  normalizeRulePattern,
  type RuleMatchCandidate,
} from "@/lib/local/categorization-rules";

function buildRule(
  overrides: Partial<CategorizationRuleMatcher>
): CategorizationRuleMatcher {
  return {
    id: "rule-1",
    action: "categorize",
    matchField: "merchant",
    matchType: "contains",
    pattern: "acufem",
    normalizedPattern: "acufem",
    categoryId: "cat-childcare",
    accountId: null,
    priority: 100,
    isActive: true,
    createdAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

function buildCandidate(
  overrides: Partial<RuleMatchCandidate>
): RuleMatchCandidate {
  return {
    description: "PAYNOW-FAST - ACUFEM MEDICAL PTE.",
    merchant: "ACUFEM MEDICAL PTE.",
    accountId: null,
    ...overrides,
  };
}

describe("categorization rules", () => {
  test("normalizes rule patterns for case-insensitive matching", () => {
    expect(normalizeRulePattern("  ACUFEM   MEDICAL ")).toBe("acufem medical");
  });

  test("matches exact merchant rules with normalized whitespace", () => {
    const rule = buildRule({
      matchType: "exact",
      pattern: "ACUFEM MEDICAL PTE.",
      normalizedPattern: normalizeRulePattern("ACUFEM MEDICAL PTE."),
    });
    const candidate = buildCandidate({
      merchant: " acufem   medical   pte. ",
    });

    expect(doesCategorizationRuleMatch(rule, candidate)).toBe(true);
  });

  test("matches regex description rules", () => {
    const rule = buildRule({
      matchField: "description",
      matchType: "regex",
      pattern: "PAYNOW-FAST\\s*-\\s*ACUFEM",
      normalizedPattern: normalizeRulePattern("PAYNOW-FAST\\s*-\\s*ACUFEM"),
    });

    expect(doesCategorizationRuleMatch(rule, buildCandidate({}))).toBe(true);
  });

  test("respects account scope when matching rules", () => {
    const rule = buildRule({
      accountId: "account-1",
    });

    expect(
      doesCategorizationRuleMatch(
        rule,
        buildCandidate({ accountId: "account-1" })
      )
    ).toBe(true);
    expect(
      doesCategorizationRuleMatch(
        rule,
        buildCandidate({ accountId: "account-2" })
      )
    ).toBe(false);
  });

  test("chooses highest-priority matching rule", () => {
    const candidate = buildCandidate({});
    const rules: CategorizationRuleMatcher[] = [
      buildRule({
        id: "low-priority",
        priority: 200,
        categoryId: "cat-other",
      }),
      buildRule({
        id: "high-priority",
        priority: 10,
        categoryId: "cat-childcare",
      }),
    ];

    const matched = findFirstMatchingCategorizationRule(rules, candidate);
    expect(matched?.id).toBe("high-priority");
  });
});
