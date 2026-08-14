import {
  deriveZeroProposition,
  jsonRecord,
  optionIdentity,
  parseElasticsearchRequest,
  parseODataRequest,
  sameZeroProposition,
  stableJson,
} from "./proposition.ts";
import type {
  VerificationAssessment,
  VerificationComparison,
  ZeroProposition,
} from "./types.ts";

function same(left: unknown, right: unknown): boolean {
  return stableJson(left) === stableJson(right);
}

function assessment(
  preservation: VerificationAssessment["preservation"],
  acquisition: VerificationAssessment["acquisition"],
  changeKind: VerificationAssessment["changeKind"],
  reasonCodes: string[],
  originalProposition?: ZeroProposition,
  verificationProposition?: ZeroProposition,
): VerificationAssessment {
  return {
    preservation,
    acquisition,
    changeKind,
    reasonCodes,
    ...(originalProposition === undefined ? {} : { originalProposition }),
    ...(verificationProposition === undefined ? {} : { verificationProposition }),
  };
}

function reasonForMismatch(
  input: VerificationComparison,
  original: ZeroProposition,
  verification: ZeroProposition,
  providerReason: string,
): string {
  if (input.originalAuthorityContextId !== input.verificationAuthorityContextId) {
    return "AUTHORITY_CONTEXT_CHANGED";
  }
  if (original.sourceScopeIdentity !== verification.sourceScopeIdentity) {
    return `${providerReason}_SOURCE_SCOPE_CHANGED`;
  }
  return `${providerReason}_MATCH_PREDICATE_CHANGED`;
}

function derivePair(input: VerificationComparison):
  | { original: ZeroProposition; verification: ZeroProposition }
  | undefined {
  const original = deriveZeroProposition({
    profile: input.profile,
    request: input.originalRequest,
    authorityContextId: input.originalAuthorityContextId,
  });
  const verification = deriveZeroProposition({
    profile: input.profile,
    request: input.verificationRequest,
    authorityContextId: input.verificationAuthorityContextId,
  });
  return original === undefined || verification === undefined
    ? undefined
    : { original, verification };
}

function algolia(
  input: VerificationComparison,
  pair: { original: ZeroProposition; verification: ZeroProposition },
): VerificationAssessment {
  const original = jsonRecord(input.originalRequest)!;
  const verification = jsonRecord(input.verificationRequest)!;
  if (!sameZeroProposition(pair.original, pair.verification)) {
    const reason = input.originalAuthorityContextId !== input.verificationAuthorityContextId
      ? "AUTHORITY_CONTEXT_CHANGED"
      : original.enableABTest !== verification.enableABTest
        ? "ALGOLIA_AB_TEST_PARTICIPATION_CHANGED"
        : reasonForMismatch(input, pair.original, pair.verification, "ALGOLIA");
    return assessment(
      "NOT_PRESERVING",
      "PROPOSITION_CHANGING_ONLY",
      "PROPOSITION_CHANGING",
      [reason],
      pair.original,
      pair.verification,
    );
  }
  if (same(original, verification)) {
    return assessment("PRESERVING", "PASSIVE_ONLY", "NONE", ["REQUEST_UNCHANGED"], pair.original, pair.verification);
  }
  if ((original.getRankingInfo === undefined || typeof original.getRankingInfo === "boolean")
    && verification.getRankingInfo === true) {
    return assessment(
      "PRESERVING",
      "SAFE_STRENGTHENING_AVAILABLE",
      "EVIDENCE_ONLY_STRENGTHENING",
      ["ALGOLIA_RANKING_INFO_METADATA_ENABLED"],
      pair.original,
      pair.verification,
    );
  }
  return assessment(
    "PRESERVING",
    "NONE_IDENTIFIED",
    "NONE",
    ["ALGOLIA_CHANGE_IS_NOT_EVIDENCE_STRENGTHENING"],
    pair.original,
    pair.verification,
  );
}

function odata(
  input: VerificationComparison,
  pair: { original: ZeroProposition; verification: ZeroProposition },
): VerificationAssessment {
  const original = parseODataRequest(input.originalRequest)!;
  const verification = parseODataRequest(input.verificationRequest)!;
  if (!sameZeroProposition(pair.original, pair.verification)) {
    const reason = pair.original.matchPredicateIdentity !== pair.verification.matchPredicateIdentity
      ? "ODATA_FILTER_OR_SEARCH_CHANGED"
      : reasonForMismatch(input, pair.original, pair.verification, "ODATA");
    return assessment(
      "NOT_PRESERVING",
      "PROPOSITION_CHANGING_ONLY",
      "PROPOSITION_CHANGING",
      [reason],
      pair.original,
      pair.verification,
    );
  }
  if (same(input.originalRequest, input.verificationRequest)) {
    return assessment("PRESERVING", "PASSIVE_ONLY", "NONE", ["REQUEST_UNCHANGED"], pair.original, pair.verification);
  }
  const originalShaping = optionIdentity(original.options, ["top", "skip"]);
  const verificationShaping = optionIdentity(verification.options, ["top", "skip"]);
  const countSame = original.options.get("count") === verification.options.get("count");
  if (Object.keys(originalShaping).length > 0
    && Object.keys(verificationShaping).length === 0
    && countSame) {
    return assessment(
      "PRESERVING",
      "SAFE_STRENGTHENING_AVAILABLE",
      "RETRIEVAL_SHAPING_NORMALIZATION",
      ["ODATA_TOP_SKIP_REMOVED_WITH_MATCH_PREDICATE_PRESERVED"],
      pair.original,
      pair.verification,
    );
  }
  if (same(originalShaping, verificationShaping) && !countSame) {
    return assessment(
      "PRESERVING",
      "SAFE_STRENGTHENING_AVAILABLE",
      "EVIDENCE_ONLY_STRENGTHENING",
      ["ODATA_INLINE_COUNT_METADATA_TOGGLED"],
      pair.original,
      pair.verification,
    );
  }
  return assessment(
    "PRESERVING",
    "NONE_IDENTIFIED",
    "NONE",
    ["ODATA_CHANGE_NOT_PROVED_TO_STRENGTHEN_EVIDENCE"],
    pair.original,
    pair.verification,
  );
}

function elasticsearch(
  input: VerificationComparison,
  pair: { original: ZeroProposition; verification: ZeroProposition },
): VerificationAssessment {
  const original = parseElasticsearchRequest(input.originalRequest)!;
  const verification = parseElasticsearchRequest(input.verificationRequest)!;
  if (!sameZeroProposition(pair.original, pair.verification)) {
    const reason = pair.original.matchPredicateIdentity !== pair.verification.matchPredicateIdentity
      ? "ELASTICSEARCH_QUERY_OR_TERMINATION_CHANGED"
      : reasonForMismatch(input, pair.original, pair.verification, "ELASTICSEARCH");
    return assessment(
      "NOT_PRESERVING",
      "PROPOSITION_CHANGING_ONLY",
      "PROPOSITION_CHANGING",
      [reason],
      pair.original,
      pair.verification,
    );
  }
  if (same(input.originalRequest, input.verificationRequest)) {
    return assessment("PRESERVING", "PASSIVE_ONLY", "NONE", ["REQUEST_UNCHANGED"], pair.original, pair.verification);
  }
  const paramNames = ["allow_no_indices", "ignore_unavailable", "allow_partial_search_results"];
  const changedParamsAreStricter = paramNames.every((name) => (
    original.params[name] === verification.params[name] || verification.params[name] === false
  ));
  const totalTrackingStronger = original.body.track_total_hits === verification.body.track_total_hits
    || verification.body.track_total_hits === true;
  if (changedParamsAreStricter && totalTrackingStronger) {
    return assessment(
      "PRESERVING",
      "SAFE_STRENGTHENING_AVAILABLE",
      "EVIDENCE_ONLY_STRENGTHENING",
      ["ELASTICSEARCH_COVERAGE_AND_EXACTNESS_STRENGTHENED"],
      pair.original,
      pair.verification,
    );
  }
  return assessment(
    "PRESERVING",
    "NONE_IDENTIFIED",
    "NONE",
    ["ELASTICSEARCH_CHANGE_NOT_PROVED_TO_STRENGTHEN_EVIDENCE"],
    pair.original,
    pair.verification,
  );
}

export function assessVerificationRequest(input: VerificationComparison): VerificationAssessment {
  const pair = derivePair(input);
  if (pair === undefined) {
    return assessment(
      "UNKNOWN",
      "NONE_IDENTIFIED",
      "NONE",
      ["ZERO_PROPOSITION_DERIVATION_FAILED"],
    );
  }
  switch (input.profile) {
    case "algolia-search": return algolia(input, pair);
    case "odata-4.01-entity-collection": return odata(input, pair);
    case "elasticsearch-local-search": return elasticsearch(input, pair);
    default:
      return assessment("UNKNOWN", "NONE_IDENTIFIED", "NONE", ["PROFILE_UNSUPPORTED_FOR_PROPOSITION_COMPARISON"]);
  }
}
