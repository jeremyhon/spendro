import type {
  CategorizationRuleAction,
  CategorizationRuleMatchField,
  CategorizationRuleMatchType,
} from "@/lib/local/types";

export interface CategorizationRuleMatcher {
  id: string;
  action: CategorizationRuleAction;
  matchField: CategorizationRuleMatchField;
  matchType: CategorizationRuleMatchType;
  pattern: string;
  normalizedPattern: string;
  categoryId: string | null;
  accountId: string | null;
  priority: number;
  isActive: boolean;
  createdAt: string;
}

export interface RuleMatchCandidate {
  description: string;
  merchant: string | null;
  accountId: string | null;
}

function normalizeWhitespace(value: string): string {
  return value.trim().replaceAll(/\s+/g, " ");
}

function normalizeForComparison(value: string): string {
  return normalizeWhitespace(value).toLowerCase();
}

export function normalizeRulePattern(pattern: string): string {
  return normalizeForComparison(pattern);
}

function getMatchSource(
  candidate: RuleMatchCandidate,
  field: CategorizationRuleMatchField
): string {
  if (field === "merchant") {
    return candidate.merchant ?? "";
  }

  return candidate.description;
}

function accountScopeMatches(
  ruleAccountId: string | null,
  candidateAccountId: string | null
): boolean {
  if (!ruleAccountId) {
    return true;
  }

  return candidateAccountId === ruleAccountId;
}

function doesPatternMatch(
  matchType: CategorizationRuleMatchType,
  pattern: string,
  normalizedPattern: string,
  source: string
): boolean {
  const normalizedSource = normalizeForComparison(source);

  if (!normalizedSource) {
    return false;
  }

  if (matchType === "exact") {
    return normalizedSource === normalizedPattern;
  }

  if (matchType === "contains") {
    return normalizedSource.includes(normalizedPattern);
  }

  try {
    const regex = new RegExp(pattern, "i");
    return regex.test(source);
  } catch {
    return false;
  }
}

export function doesCategorizationRuleMatch(
  rule: CategorizationRuleMatcher,
  candidate: RuleMatchCandidate
): boolean {
  if (!rule.isActive) {
    return false;
  }

  if (!accountScopeMatches(rule.accountId, candidate.accountId)) {
    return false;
  }

  const source = getMatchSource(candidate, rule.matchField);
  return doesPatternMatch(
    rule.matchType,
    rule.pattern,
    rule.normalizedPattern,
    source
  );
}

export function findFirstMatchingCategorizationRule(
  rules: CategorizationRuleMatcher[],
  candidate: RuleMatchCandidate
): CategorizationRuleMatcher | null {
  const sorted = [...rules].sort((left, right) => {
    if (left.priority !== right.priority) {
      return left.priority - right.priority;
    }

    return left.createdAt.localeCompare(right.createdAt);
  });

  for (const rule of sorted) {
    if (doesCategorizationRuleMatch(rule, candidate)) {
      return rule;
    }
  }

  return null;
}
