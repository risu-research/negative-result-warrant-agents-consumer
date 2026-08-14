import { deriveSourceScopeIdentity, sameZeroProposition } from "./proposition.ts";
import {
  BOUND_EVIDENCE_KIND,
  BOUND_EVIDENCE_VERSION,
  WARRANT_VERSION,
  type BoundNegativeEvidence,
  type ByteBinding,
  type NegativeResultWarrant,
  type Obligation,
  type ProfileRef,
  type ReceiverValidatedBoundNegativeEvidence,
  type SourceScope,
  type ZeroProposition,
} from "./types.ts";

type JsonRecord = Record<string, unknown>;
type ProfileId = "algolia-search" | "elasticsearch-local-search" | "odata-4.01-entity-collection";

const validatedRoots = new WeakSet<object>();
const HEX_64 = /^[0-9a-f]{64}$/;
const SHA_256_IDENTITY = /^sha256:[0-9a-f]{64}$/;
const SUPPORTED_PROFILES = new Set<ProfileId>([
  "algolia-search",
  "elasticsearch-local-search",
  "odata-4.01-entity-collection",
]);

const UNIVERSAL_OBLIGATIONS = {
  PROFILE_EXPLICIT: "SUPPORT",
  REQUEST_BOUND: "SUPPORT",
  RESPONSE_BOUND: "SUPPORT",
  OBSERVATION_BOUND: "SUPPORT",
  VISIBILITY_CONTEXT_BOUND: "SUPPORT",
  PROPOSITION_DERIVED: "SUPPORT",
} as const;

const PROFILE_OBLIGATIONS: Readonly<Record<ProfileId, Readonly<Record<string, "SUPPORT" | "DEFEATER">>>> = {
  "algolia-search": {
    ...UNIVERSAL_OBLIGATIONS,
    RANKING_INFO_REQUESTED: "SUPPORT",
    AB_TEST_PARTICIPATION_DISABLED: "SUPPORT",
    REQUEST_TARGET_CONSISTENT: "SUPPORT",
    EFFECTIVE_INDEX_WITNESSED: "SUPPORT",
    SOURCE_SCOPE_RESOLVED: "SUPPORT",
    ZERO_CARDINALITY: "SUPPORT",
    EXACT_CARDINALITY: "SUPPORT",
    RULE_MATCHING_COMPLETE: "DEFEATER",
  },
  "elasticsearch-local-search": {
    ...UNIVERSAL_OBLIGATIONS,
    SUPPORTED_REQUEST_SEMANTICS: "SUPPORT",
    REQUEST_TARGET_CONSISTENT: "SUPPORT",
    SOURCE_SCOPE_RESOLVED: "SUPPORT",
    ALLOW_NO_INDICES_FALSE: "SUPPORT",
    IGNORE_UNAVAILABLE_FALSE: "SUPPORT",
    PARTIAL_RESULTS_DISABLED: "SUPPORT",
    EXACT_TOTAL_TRACKING: "SUPPORT",
    NO_EARLY_TERMINATION_LIMIT: "SUPPORT",
    LOCAL_SEARCH_ONLY: "SUPPORT",
    ZERO_CARDINALITY: "SUPPORT",
    EXACT_TOTAL_RELATION: "SUPPORT",
    NOT_TIMED_OUT: "SUPPORT",
    NO_SHARD_FAILURES: "SUPPORT",
    NONEMPTY_RESOLVED_SHARDS: "SUPPORT",
    SHARD_ACCOUNTING_COMPLETE: "SUPPORT",
    NOT_TERMINATED_EARLY: "SUPPORT",
  },
  "odata-4.01-entity-collection": {
    ...UNIVERSAL_OBLIGATIONS,
    SUPPORTED_PROFILE_INPUT_SHAPE: "SUPPORT",
    GET_COLLECTION_REQUEST: "SUPPORT",
    REQUEST_TARGET_CONSISTENT: "SUPPORT",
    ZERO_SAFE_REQUEST_SEMANTICS: "SUPPORT",
    SOURCE_SCOPE_RESOLVED: "SUPPORT",
    ODATA_401_COLLECTION_MODE: "SUPPORT",
    COLLECTION_CONTEXT_MATCHES_SCOPE: "SUPPORT",
    ZERO_CARDINALITY: "SUPPORT",
    NO_CONTRADICTORY_INLINE_COUNT: "DEFEATER",
    ENUMERATION_CLOSED: "SUPPORT",
    NO_DELTA_RESPONSE: "SUPPORT",
  },
};

const UNIVERSAL_REASONS = {
  PROFILE_EXPLICIT: new Set(["SUPPORTED_PROFILE_SELECTED_EXPLICITLY"]),
  REQUEST_BOUND: new Set(["EXACT_PROFILE_INPUT_REQUEST_BYTES_BOUND"]),
  RESPONSE_BOUND: new Set(["EXACT_PROFILE_INPUT_RESPONSE_BYTES_BOUND"]),
  OBSERVATION_BOUND: new Set(["OBSERVATION_IDENTIFIER_BOUND"]),
  VISIBILITY_CONTEXT_BOUND: new Set(["SOURCE_EFFECTIVE_AUTHORITY_CONTEXT_BOUND"]),
  PROPOSITION_DERIVED: new Set(["ZERO_PROPOSITION_DERIVED"]),
} as const;

const PROFILE_OBLIGATION_REASONS: Readonly<Record<ProfileId, Readonly<Record<string, ReadonlySet<string>>>>> = {
  "algolia-search": {
    ...UNIVERSAL_REASONS,
    RANKING_INFO_REQUESTED: new Set(["REQUIRED_VALUE_CONFIRMED"]),
    AB_TEST_PARTICIPATION_DISABLED: new Set(["REQUIRED_VALUE_CONFIRMED"]),
    REQUEST_TARGET_CONSISTENT: new Set(["REQUEST_PATH_TARGETS_DECLARED_INDEX"]),
    EFFECTIVE_INDEX_WITNESSED: new Set(["SOURCE_REPORTED_EFFECTIVE_INDEX"]),
    SOURCE_SCOPE_RESOLVED: new Set(["EFFECTIVE_INDEX_RESOLVED"]),
    ZERO_CARDINALITY: new Set(["ZERO_COUNT_OBSERVED"]),
    EXACT_CARDINALITY: new Set(["REQUIRED_VALUE_CONFIRMED"]),
    RULE_MATCHING_COMPLETE: new Set([
      "NO_RULE_MATCH_INCOMPLETENESS_REPORTED",
      "RULE_MATCHING_REPORTED_EXHAUSTIVE",
    ]),
  },
  "elasticsearch-local-search": {
    ...UNIVERSAL_REASONS,
    SUPPORTED_REQUEST_SEMANTICS: new Set(["STRICT_SEARCH_REQUEST_SUBSET_CONFIRMED"]),
    REQUEST_TARGET_CONSISTENT: new Set(["REQUEST_PATH_TARGETS_DECLARED_INDEX_EXPRESSION"]),
    SOURCE_SCOPE_RESOLVED: new Set(["LOCAL_INDEX_SCOPE_RESOLVED"]),
    ALLOW_NO_INDICES_FALSE: new Set(["REQUIRED_VALUE_CONFIRMED"]),
    IGNORE_UNAVAILABLE_FALSE: new Set(["REQUIRED_VALUE_CONFIRMED"]),
    PARTIAL_RESULTS_DISABLED: new Set(["REQUIRED_VALUE_CONFIRMED"]),
    EXACT_TOTAL_TRACKING: new Set(["REQUIRED_VALUE_CONFIRMED"]),
    NO_EARLY_TERMINATION_LIMIT: new Set(["NO_NONZERO_TERMINATE_AFTER"]),
    LOCAL_SEARCH_ONLY: new Set(["LOCAL_SEARCH_CONFIRMED"]),
    ZERO_CARDINALITY: new Set(["ZERO_COUNT_OBSERVED"]),
    EXACT_TOTAL_RELATION: new Set(["TOTAL_RELATION_EQ"]),
    NOT_TIMED_OUT: new Set(["REQUIRED_VALUE_CONFIRMED"]),
    NO_SHARD_FAILURES: new Set(["REQUIRED_VALUE_CONFIRMED"]),
    NONEMPTY_RESOLVED_SHARDS: new Set(["NONEMPTY_SHARD_SCOPE"]),
    SHARD_ACCOUNTING_COMPLETE: new Set(["ALL_SHARDS_SUCCESSFUL"]),
    NOT_TERMINATED_EARLY: new Set(["REQUIRED_VALUE_CONFIRMED"]),
  },
  "odata-4.01-entity-collection": {
    ...UNIVERSAL_REASONS,
    SUPPORTED_PROFILE_INPUT_SHAPE: new Set(["ODATA_PROFILE_INPUT_SHAPE_CONFIRMED"]),
    GET_COLLECTION_REQUEST: new Set(["GET_REQUEST_CONFIRMED"]),
    REQUEST_TARGET_CONSISTENT: new Set(["REQUEST_PATH_TARGETS_DECLARED_ENTITY_SET"]),
    ZERO_SAFE_REQUEST_SEMANTICS: new Set(["FILTER_SEARCH_ONLY_REQUEST_SUBSET"]),
    SOURCE_SCOPE_RESOLVED: new Set(["ENTITY_COLLECTION_SCOPE_RESOLVED"]),
    ODATA_401_COLLECTION_MODE: new Set(["ODATA_401_ENTITY_COLLECTION_CONFIRMED"]),
    COLLECTION_CONTEXT_MATCHES_SCOPE: new Set(["ODATA_CONTEXT_MATCHES_ENTITY_SET"]),
    ZERO_CARDINALITY: new Set(["EMPTY_COLLECTION_OBSERVED"]),
    NO_CONTRADICTORY_INLINE_COUNT: new Set([
      "INLINE_COUNT_ABSENT",
      "INLINE_COUNT_DOES_NOT_CONTRADICT_ZERO",
    ]),
    ENUMERATION_CLOSED: new Set(["NEXT_LINK_ABSENT_UNDER_ODATA_CONTRACT"]),
    NO_DELTA_RESPONSE: new Set(["NON_DELTA_RESPONSE_CONFIRMED"]),
  },
};

const PROVIDER_BY_PROFILE: Readonly<Record<ProfileId, SourceScope["provider"]>> = {
  "algolia-search": "algolia",
  "elasticsearch-local-search": "elasticsearch",
  "odata-4.01-entity-collection": "odata",
};

const PRESERVATION_REASON_BY_PROFILE: Readonly<Record<ProfileId, ReadonlySet<string>>> = {
  "algolia-search": new Set(["ALGOLIA_RANKING_INFO_METADATA_ENABLED"]),
  "elasticsearch-local-search": new Set(["ELASTICSEARCH_COVERAGE_AND_EXACTNESS_STRENGTHENED"]),
  "odata-4.01-entity-collection": new Set([
    "ODATA_TOP_SKIP_REMOVED_WITH_MATCH_PREDICATE_PRESERVED",
    "ODATA_INLINE_COUNT_METADATA_TOGGLED",
  ]),
};

function record(value: unknown): JsonRecord | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? value as JsonRecord
    : undefined;
}

function exactKeys(value: JsonRecord, required: readonly string[], optional: readonly string[] = []): boolean {
  const allowed = new Set([...required, ...optional]);
  return required.every((key) => Object.hasOwn(value, key))
    && Object.keys(value).every((key) => allowed.has(key));
}

function nonEmptyString(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function profile(value: unknown): ProfileRef | undefined {
  const input = record(value);
  if (input === undefined || !exactKeys(input, ["id", "version"])
    || typeof input.id !== "string"
    || !SUPPORTED_PROFILES.has(input.id as ProfileId)
    || input.version !== WARRANT_VERSION) return undefined;
  return { id: input.id, version: WARRANT_VERSION };
}

function byteBinding(value: unknown): ByteBinding | undefined {
  const input = record(value);
  if (input === undefined || !exactKeys(input, ["algorithm", "representation", "digest", "byteLength"])
    || input.algorithm !== "SHA-256"
    || input.representation !== "exact-profile-input-bytes"
    || typeof input.digest !== "string"
    || !HEX_64.test(input.digest)
    || typeof input.byteLength !== "number"
    || !Number.isInteger(input.byteLength)
    || input.byteLength < 0) return undefined;
  return {
    algorithm: "SHA-256",
    representation: "exact-profile-input-bytes",
    digest: input.digest,
    byteLength: input.byteLength,
  };
}

function proposition(value: unknown): ZeroProposition | undefined {
  const input = record(value);
  if (input === undefined
    || !exactKeys(input, ["profile", "sourceScopeIdentity", "matchPredicateIdentity", "authorityContextId"])) {
    return undefined;
  }
  const propositionProfile = profile(input.profile);
  const sourceScopeIdentity = nonEmptyString(input.sourceScopeIdentity);
  const authorityContextId = nonEmptyString(input.authorityContextId);
  if (propositionProfile === undefined
    || sourceScopeIdentity === undefined
    || authorityContextId === undefined
    || typeof input.matchPredicateIdentity !== "string"
    || !SHA_256_IDENTITY.test(input.matchPredicateIdentity)) return undefined;
  return {
    profile: propositionProfile,
    sourceScopeIdentity,
    matchPredicateIdentity: input.matchPredicateIdentity,
    authorityContextId,
  };
}

function visibility(value: unknown): SourceScope["visibility"] | undefined {
  const input = record(value);
  if (input === undefined || !exactKeys(input, ["kind", "authorityContextId"])
    || input.kind !== "source-effective-view-only") return undefined;
  const authorityContextId = nonEmptyString(input.authorityContextId);
  return authorityContextId === undefined
    ? undefined
    : { kind: "source-effective-view-only", authorityContextId };
}

function scope(value: unknown, profileId: ProfileId): SourceScope | undefined {
  const input = record(value);
  const common = ["provider", "endpoint", "entitySet", "queryBinding", "visibility"];
  const required = profileId === "algolia-search"
    ? [...common, "requestedIndex", "effectiveIndex"]
    : profileId === "elasticsearch-local-search"
      ? [...common, "targetIndexExpression"]
      : common;
  if (input === undefined || !exactKeys(input, required)
    || input.provider !== PROVIDER_BY_PROFILE[profileId]) return undefined;
  const endpoint = nonEmptyString(input.endpoint);
  const entitySet = nonEmptyString(input.entitySet);
  const queryBinding = byteBinding(input.queryBinding);
  const scopeVisibility = visibility(input.visibility);
  if (endpoint === undefined || entitySet === undefined
    || queryBinding === undefined || scopeVisibility === undefined) return undefined;
  if (profileId === "algolia-search") {
    const requestedIndex = nonEmptyString(input.requestedIndex);
    const effectiveIndex = nonEmptyString(input.effectiveIndex);
    if (entitySet !== "index-records" || requestedIndex === undefined || effectiveIndex === undefined) return undefined;
    return {
      provider: "algolia",
      endpoint,
      entitySet,
      queryBinding,
      visibility: scopeVisibility,
      requestedIndex,
      effectiveIndex,
    };
  }
  if (profileId === "elasticsearch-local-search") {
    const targetIndexExpression = nonEmptyString(input.targetIndexExpression);
    if (entitySet !== "documents" || targetIndexExpression === undefined) return undefined;
    return {
      provider: "elasticsearch",
      endpoint,
      entitySet,
      queryBinding,
      visibility: scopeVisibility,
      targetIndexExpression,
    };
  }
  return {
    provider: "odata",
    endpoint,
    entitySet,
    queryBinding,
    visibility: scopeVisibility,
  };
}

function obligations(value: unknown, profileId: ProfileId): Obligation[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const expected = PROFILE_OBLIGATIONS[profileId];
  const expectedReasons = PROFILE_OBLIGATION_REASONS[profileId];
  if (value.length !== Object.keys(expected).length) return undefined;
  const seen = new Set<string>();
  const output: Obligation[] = [];
  for (const item of value) {
    const input = record(item);
    if (input === undefined || !exactKeys(input, ["id", "kind", "state", "reasonCode"])
      || typeof input.id !== "string"
      || !Object.hasOwn(expected, input.id)
      || seen.has(input.id)
      || input.kind !== expected[input.id]
      || input.state !== "SATISFIED"
      || nonEmptyString(input.reasonCode) === undefined
      || expectedReasons[input.id]?.has(input.reasonCode as string) !== true) return undefined;
    seen.add(input.id);
    output.push({
      id: input.id,
      kind: expected[input.id]!,
      state: "SATISFIED",
      reasonCode: input.reasonCode as string,
    });
  }
  return seen.size === Object.keys(expected).length ? output : undefined;
}

function warrant(value: unknown): NegativeResultWarrant | undefined {
  const input = record(value);
  if (input === undefined || !exactKeys(input, [
    "version",
    "verdict",
    "profile",
    "requestBinding",
    "observationBinding",
    "scope",
    "proposition",
    "obligations",
    "reasonCodes",
  ]) || input.version !== WARRANT_VERSION || input.verdict !== "WARRANTED_ZERO") return undefined;
  const warrantProfile = profile(input.profile);
  if (warrantProfile === undefined) return undefined;
  const profileId = warrantProfile.id as ProfileId;
  const requestBinding = byteBinding(input.requestBinding);
  const observationInput = record(input.observationBinding);
  const warrantScope = scope(input.scope, profileId);
  const warrantProposition = proposition(input.proposition);
  const warrantObligations = obligations(input.obligations, profileId);
  if (requestBinding === undefined
    || observationInput === undefined
    || !exactKeys(observationInput, ["observationId", "response"])
    || nonEmptyString(observationInput.observationId) === undefined
    || warrantScope === undefined
    || warrantProposition === undefined
    || warrantObligations === undefined
    || !Array.isArray(input.reasonCodes)
    || input.reasonCodes.length !== 1
    || input.reasonCodes[0] !== "SOURCE_OBSERVATION_WARRANTS_ZERO") return undefined;
  const response = byteBinding(observationInput.response);
  if (response === undefined) return undefined;
  return {
    version: WARRANT_VERSION,
    verdict: "WARRANTED_ZERO",
    profile: warrantProfile,
    requestBinding,
    observationBinding: {
      observationId: observationInput.observationId as string,
      response,
    },
    scope: warrantScope,
    proposition: warrantProposition,
    obligations: warrantObligations,
    reasonCodes: ["SOURCE_OBSERVATION_WARRANTS_ZERO"],
  };
}

function verificationObservation(value: unknown): BoundNegativeEvidence["verificationObservation"] | undefined {
  const input = record(value);
  if (input === undefined || !exactKeys(input, [
    "profile",
    "observationId",
    "requestBinding",
    "responseBinding",
    "authorityContextId",
  ])) return undefined;
  const observationProfile = nonEmptyString(input.profile);
  const observationId = nonEmptyString(input.observationId);
  const requestBinding = byteBinding(input.requestBinding);
  const responseBinding = byteBinding(input.responseBinding);
  const authorityContextId = nonEmptyString(input.authorityContextId);
  if (observationProfile === undefined || observationId === undefined
    || requestBinding === undefined || responseBinding === undefined
    || authorityContextId === undefined) return undefined;
  return { profile: observationProfile, observationId, requestBinding, responseBinding, authorityContextId };
}

function sameProfile(left: ProfileRef, right: ProfileRef): boolean {
  return left.id === right.id && left.version === right.version;
}

function sameBinding(left: ByteBinding, right: ByteBinding): boolean {
  return left.algorithm === right.algorithm
    && left.representation === right.representation
    && left.digest === right.digest
    && left.byteLength === right.byteLength;
}

function preservationReasons(
  value: unknown,
  mode: BoundNegativeEvidence["mode"],
  profileId: ProfileId,
): string[] | undefined {
  if (!Array.isArray(value) || value.length !== 1 || typeof value[0] !== "string") return undefined;
  if (mode === "DIRECT") return value[0] === "REQUEST_UNCHANGED" ? [value[0]] : undefined;
  return PRESERVATION_REASON_BY_PROFILE[profileId].has(value[0]) ? [value[0]] : undefined;
}

function deepFreeze<T>(value: T): T {
  if (typeof value !== "object" || value === null || Object.isFrozen(value)) return value;
  for (const child of Object.values(value as Record<string, unknown>)) deepFreeze(child);
  return Object.freeze(value);
}

function validateAndBrand(value: unknown): ReceiverValidatedBoundNegativeEvidence | undefined {
  const input = record(value);
  if (input === undefined || !exactKeys(input, [
    "kind",
    "version",
    "proposition",
    "sourceWarrant",
    "verificationObservation",
    "mode",
    "preservationReasonCodes",
  ]) || input.kind !== BOUND_EVIDENCE_KIND
    || input.version !== BOUND_EVIDENCE_VERSION
    || !["DIRECT", "PROPOSITION_PRESERVING_VERIFICATION"].includes(input.mode as string)) return undefined;

  const evidenceProposition = proposition(input.proposition);
  const sourceWarrant = warrant(input.sourceWarrant);
  const observation = verificationObservation(input.verificationObservation);
  if (evidenceProposition === undefined || sourceWarrant === undefined || observation === undefined) return undefined;
  const profileId = sourceWarrant.profile.id as ProfileId;
  const derivedSourceScopeIdentity = deriveSourceScopeIdentity(profileId, sourceWarrant.scope);
  const mode = input.mode as BoundNegativeEvidence["mode"];
  const reasons = preservationReasons(input.preservationReasonCodes, mode, profileId);
  if (reasons === undefined
    || derivedSourceScopeIdentity === undefined
    || derivedSourceScopeIdentity !== sourceWarrant.proposition.sourceScopeIdentity
    || !sameZeroProposition(evidenceProposition, sourceWarrant.proposition)
    || !sameProfile(sourceWarrant.profile, evidenceProposition.profile)
    || observation.profile !== sourceWarrant.profile.id
    || evidenceProposition.authorityContextId !== observation.authorityContextId
    || evidenceProposition.authorityContextId !== sourceWarrant.scope.visibility.authorityContextId
    || observation.observationId !== sourceWarrant.observationBinding.observationId
    || !sameBinding(observation.requestBinding, sourceWarrant.requestBinding)
    || !sameBinding(observation.requestBinding, sourceWarrant.scope.queryBinding)
    || !sameBinding(observation.responseBinding, sourceWarrant.observationBinding.response)) return undefined;

  const reconstructed: BoundNegativeEvidence = {
    kind: BOUND_EVIDENCE_KIND,
    version: BOUND_EVIDENCE_VERSION,
    proposition: evidenceProposition,
    sourceWarrant,
    verificationObservation: observation,
    mode,
    preservationReasonCodes: reasons,
  };
  const frozen = deepFreeze(reconstructed) as unknown as ReceiverValidatedBoundNegativeEvidence;
  validatedRoots.add(frozen);
  return frozen;
}

/** The only public receiver entry point for protocol-delivered metadata. */
export function decodeBoundNegativeEvidence(
  value: unknown,
): ReceiverValidatedBoundNegativeEvidence | undefined {
  try {
    return validateAndBrand(value);
  } catch {
    return undefined;
  }
}

/** Internal gate check. This tests identity in the private WeakSet; it cannot mint validation. */
export function hasReceiverValidationMark(
  value: unknown,
): value is ReceiverValidatedBoundNegativeEvidence {
  return typeof value === "object" && value !== null && validatedRoots.has(value);
}
