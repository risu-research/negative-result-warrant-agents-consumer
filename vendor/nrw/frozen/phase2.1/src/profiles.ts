import type {
  AdapterAssessment,
  EvidenceFact,
  Obligation,
  ObligationKind,
  ObligationState,
  ParsedObservation,
  SourceProfileAdapter,
  SourceScope,
} from "./types.ts";

type JsonRecord = Record<string, unknown>;

function record(value: unknown): JsonRecord | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as JsonRecord)
    : undefined;
}

function nonEmptyString(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function nonNegativeInteger(value: unknown): number | undefined {
  return typeof value === "number" && Number.isInteger(value) && value >= 0
    ? value
    : undefined;
}

function obligation(
  id: string,
  state: ObligationState,
  reasonCode: string,
  kind: ObligationKind = "SUPPORT",
): Obligation {
  return { id, kind, state, reasonCode };
}

function defeater(id: string, state: ObligationState, reasonCode: string): Obligation {
  return obligation(id, state, reasonCode, "DEFEATER");
}

function presenceForCount(value: unknown): EvidenceFact {
  if (nonNegativeInteger(value) === undefined) {
    return {
      id: "MATCH_PRESENT",
      state: "UNKNOWN",
      reasonCode: "MATCH_CARDINALITY_MISSING_OR_MALFORMED",
    };
  }
  return (value as number) > 0
    ? { id: "MATCH_PRESENT", state: "SATISFIED", reasonCode: "MATCH_OBSERVED" }
    : { id: "MATCH_PRESENT", state: "BLOCKED", reasonCode: "ZERO_OBSERVED" };
}

function exactBoolean(
  id: string,
  value: unknown,
  required: boolean,
  blockedCode: string,
  unknownCode: string,
): Obligation {
  if (value === required) return obligation(id, "SATISFIED", "REQUIRED_VALUE_CONFIRMED");
  if (typeof value === "boolean") return obligation(id, "BLOCKED", blockedCode);
  return obligation(id, "UNKNOWN", unknownCode);
}

function exactNumber(
  id: string,
  value: unknown,
  required: number,
  blockedCode: string,
  unknownCode: string,
): Obligation {
  if (value === required) return obligation(id, "SATISFIED", "REQUIRED_VALUE_CONFIRMED");
  if (typeof value === "number" && Number.isFinite(value)) {
    return obligation(id, "BLOCKED", blockedCode);
  }
  return obligation(id, "UNKNOWN", unknownCode);
}

function visibility(observation: ParsedObservation): SourceScope["visibility"] {
  return {
    kind: "source-effective-view-only",
    authorityContextId: observation.authorityContext.id,
  };
}

function relativeUrl(path: string | undefined): URL | undefined {
  if (path === undefined || !path.startsWith("/")) return undefined;
  try {
    const parsed = new URL(path, "https://profile-input.invalid");
    return parsed.hash.length === 0 ? parsed : undefined;
  } catch {
    return undefined;
  }
}

function decodedPathSegments(url: URL | undefined): string[] | undefined {
  if (url === undefined) return undefined;
  try {
    return url.pathname.split("/").filter(Boolean).map((part) => decodeURIComponent(part));
  } catch {
    return undefined;
  }
}

function onlyKeys(value: JsonRecord | undefined, allowed: ReadonlySet<string>): ObligationState {
  if (value === undefined) return "UNKNOWN";
  return Object.keys(value).every((key) => allowed.has(key)) ? "SATISFIED" : "BLOCKED";
}

function algoliaPathTargetsIndex(path: string | undefined, index: string | undefined): boolean {
  const url = relativeUrl(path);
  const segments = decodedPathSegments(url);
  return index !== undefined
    && url?.search === ""
    && segments?.length === 4
    && segments[0] === "1"
    && segments[1] === "indexes"
    && segments[2] === index
    && segments[3] === "query";
}

const algolia: SourceProfileAdapter = {
  profile: { id: "algolia-search", version: "0.2.1" },
  witnessClass: "cardinality-exactness",
  assess(observation): AdapterAssessment {
    const request = record(observation.request);
    const response = record(observation.response);
    const requestedIndex = nonEmptyString(request?.index);
    const endpoint = nonEmptyString(request?.path);
    const pathConsistent = algoliaPathTargetsIndex(endpoint, requestedIndex);
    const effectiveIndex = nonEmptyString(response?.indexUsed);
    const effectiveIndexWitnessed = effectiveIndex !== undefined;
    const scopeResolved = requestedIndex !== undefined
      && endpoint !== undefined
      && pathConsistent
      && effectiveIndexWitnessed;
    const scope = scopeResolved
      ? {
          provider: "algolia" as const,
          endpoint,
          entitySet: "index-records",
          requestedIndex,
          effectiveIndex,
          queryBinding: observation.requestBinding,
          visibility: visibility(observation),
        }
      : undefined;
    const nbHits = response?.nbHits;
    const exhaustive = record(response?.exhaustive);
    const zeroState = nbHits === 0
      ? obligation("ZERO_CARDINALITY", "SATISFIED", "ZERO_COUNT_OBSERVED")
      : nonNegativeInteger(nbHits) !== undefined && (nbHits as number) > 0
        ? obligation("ZERO_CARDINALITY", "BLOCKED", "NONZERO_COUNT_OBSERVED")
        : obligation("ZERO_CARDINALITY", "UNKNOWN", "NB_HITS_MISSING_OR_MALFORMED");

    return {
      profile: this.profile,
      witnessClass: this.witnessClass,
      presence: presenceForCount(nbHits),
      obligations: [
        exactBoolean(
          "RANKING_INFO_REQUESTED",
          request?.getRankingInfo,
          true,
          "EFFECTIVE_SCOPE_METADATA_NOT_REQUESTED",
          "RANKING_INFO_SETTING_MISSING_OR_MALFORMED",
        ),
        exactBoolean(
          "AB_TEST_PARTICIPATION_DISABLED",
          request?.enableABTest,
          false,
          "AB_TEST_CAN_TRANSFORM_EFFECTIVE_QUERY",
          "AB_TEST_SETTING_MISSING_OR_MALFORMED",
        ),
        obligation(
          "REQUEST_TARGET_CONSISTENT",
          request === undefined || requestedIndex === undefined || endpoint === undefined
            ? "UNKNOWN"
            : pathConsistent ? "SATISFIED" : "BLOCKED",
          pathConsistent ? "REQUEST_PATH_TARGETS_DECLARED_INDEX" : "REQUEST_PATH_INDEX_MISMATCH",
        ),
        obligation(
          "EFFECTIVE_INDEX_WITNESSED",
          effectiveIndexWitnessed ? "SATISFIED" : "UNKNOWN",
          effectiveIndexWitnessed ? "SOURCE_REPORTED_EFFECTIVE_INDEX" : "EFFECTIVE_INDEX_WITNESS_MISSING",
        ),
        obligation(
          "SOURCE_SCOPE_RESOLVED",
          scopeResolved ? "SATISFIED" : "UNKNOWN",
          scopeResolved ? "EFFECTIVE_INDEX_RESOLVED" : "EFFECTIVE_INDEX_UNRESOLVED",
        ),
        zeroState,
        exactBoolean(
          "EXACT_CARDINALITY",
          exhaustive?.nbHits,
          true,
          "APPROXIMATE_CARDINALITY",
          "EXACTNESS_MISSING_OR_MALFORMED",
        ),
        response === undefined || exhaustive === undefined
          ? defeater("RULE_MATCHING_COMPLETE", "UNKNOWN", "RULE_MATCH_EXHAUSTIVITY_UNAVAILABLE")
          : !Object.hasOwn(exhaustive, "rulesMatch")
            ? defeater("RULE_MATCHING_COMPLETE", "SATISFIED", "NO_RULE_MATCH_INCOMPLETENESS_REPORTED")
            : exhaustive.rulesMatch === true
              ? defeater("RULE_MATCHING_COMPLETE", "SATISFIED", "RULE_MATCHING_REPORTED_EXHAUSTIVE")
              : exhaustive.rulesMatch === false
                ? defeater("RULE_MATCHING_COMPLETE", "BLOCKED", "RULE_MATCHING_INCOMPLETE_DUE_TO_TIMEOUT")
                : defeater("RULE_MATCHING_COMPLETE", "UNKNOWN", "RULE_MATCH_EXHAUSTIVITY_MALFORMED"),
      ],
      ...(scope === undefined ? {} : { scope }),
    };
  },
};

function safeTerminateAfter(body: JsonRecord | undefined): Obligation {
  const value = body?.terminate_after;
  if (value === undefined || value === 0) {
    return obligation("NO_EARLY_TERMINATION_LIMIT", "SATISFIED", "NO_NONZERO_TERMINATE_AFTER");
  }
  if (typeof value === "number" && Number.isInteger(value) && value > 0) {
    return obligation("NO_EARLY_TERMINATION_LIMIT", "BLOCKED", "TERMINATE_AFTER_ENABLED");
  }
  return obligation("NO_EARLY_TERMINATION_LIMIT", "UNKNOWN", "TERMINATE_AFTER_MALFORMED");
}

function elasticsearchPathTargets(path: string | undefined, target: string | undefined): boolean {
  const url = relativeUrl(path);
  const segments = decodedPathSegments(url);
  return target !== undefined
    && url?.search === ""
    && segments?.length === 2
    && segments[0] === target
    && segments[1] === "_search";
}

const ES_REQUEST_KEYS = new Set(["path", "target", "sourceMode", "params", "body"]);
const ES_PARAM_KEYS = new Set([
  "allow_no_indices",
  "ignore_unavailable",
  "allow_partial_search_results",
]);
const ES_BODY_KEYS = new Set(["query", "track_total_hits", "terminate_after"]);

const elasticsearch: SourceProfileAdapter = {
  profile: { id: "elasticsearch-local-search", version: "0.2.1" },
  witnessClass: "execution-coverage",
  assess(observation): AdapterAssessment {
    const request = record(observation.request);
    const response = record(observation.response);
    const params = record(request?.params);
    const body = record(request?.body);
    const hits = record(response?.hits);
    const total = record(hits?.total);
    const shards = record(response?._shards);
    const target = nonEmptyString(request?.target);
    const endpoint = nonEmptyString(request?.path);
    const pathConsistent = elasticsearchPathTargets(endpoint, target);
    const requestShapeState = onlyKeys(request, ES_REQUEST_KEYS);
    const paramsState = onlyKeys(params, ES_PARAM_KEYS);
    const bodyState = onlyKeys(body, ES_BODY_KEYS);
    const supportedRequestSemantics = requestShapeState === "SATISFIED"
      && paramsState === "SATISFIED"
      && bodyState === "SATISFIED";
    const localMode = request?.sourceMode === "local"
      && target !== undefined
      && !target.includes(":")
      && response?._clusters === undefined;
    const localModeState: ObligationState = request?.sourceMode === undefined
      || target === undefined
      || response === undefined
      ? "UNKNOWN"
      : localMode ? "SATISFIED" : "BLOCKED";
    const scopeResolved = target !== undefined && endpoint !== undefined && pathConsistent && localMode;
    const scope = scopeResolved
      ? {
          provider: "elasticsearch" as const,
          endpoint,
          entitySet: "documents",
          targetIndexExpression: target,
          queryBinding: observation.requestBinding,
          visibility: visibility(observation),
        }
      : undefined;
    const totalValue = total?.value;
    const zeroState = totalValue === 0
      ? obligation("ZERO_CARDINALITY", "SATISFIED", "ZERO_COUNT_OBSERVED")
      : nonNegativeInteger(totalValue) !== undefined && (totalValue as number) > 0
        ? obligation("ZERO_CARDINALITY", "BLOCKED", "NONZERO_COUNT_OBSERVED")
        : obligation("ZERO_CARDINALITY", "UNKNOWN", "TOTAL_HITS_MISSING_OR_MALFORMED");
    const relationState = total?.relation === "eq"
      ? obligation("EXACT_TOTAL_RELATION", "SATISFIED", "TOTAL_RELATION_EQ")
      : total?.relation === "gte"
        ? obligation("EXACT_TOTAL_RELATION", "BLOCKED", "LOWER_BOUND_TOTAL_ONLY")
        : obligation("EXACT_TOTAL_RELATION", "UNKNOWN", "TOTAL_RELATION_MISSING_OR_MALFORMED");
    const shardTotal = nonNegativeInteger(shards?.total);
    const shardSuccessful = nonNegativeInteger(shards?.successful);
    const shardFailed = nonNegativeInteger(shards?.failed);
    const shardScope = shardTotal === undefined
      ? obligation("NONEMPTY_RESOLVED_SHARDS", "UNKNOWN", "SHARD_SCOPE_MISSING_OR_MALFORMED")
      : shardTotal > 0
        ? obligation("NONEMPTY_RESOLVED_SHARDS", "SATISFIED", "NONEMPTY_SHARD_SCOPE")
        : obligation("NONEMPTY_RESOLVED_SHARDS", "BLOCKED", "EMPTY_OR_UNRESOLVED_SOURCE_SCOPE");
    const shardAccountingKnown = shardTotal !== undefined
      && shardSuccessful !== undefined
      && shardFailed !== undefined;
    const shardAccountingComplete = shardAccountingKnown
      && shardSuccessful === shardTotal
      && shardFailed === 0;
    const shardAccounting = !shardAccountingKnown
      ? obligation("SHARD_ACCOUNTING_COMPLETE", "UNKNOWN", "SHARD_ACCOUNTING_MISSING_OR_MALFORMED")
      : shardAccountingComplete
        ? obligation("SHARD_ACCOUNTING_COMPLETE", "SATISFIED", "ALL_SHARDS_SUCCESSFUL")
        : obligation("SHARD_ACCOUNTING_COMPLETE", "BLOCKED", "NOT_ALL_SHARDS_SUCCESSFUL");

    return {
      profile: this.profile,
      witnessClass: this.witnessClass,
      presence: presenceForCount(totalValue),
      obligations: [
        obligation(
          "SUPPORTED_REQUEST_SEMANTICS",
          request === undefined || params === undefined || body === undefined
            ? "UNKNOWN"
            : supportedRequestSemantics ? "SATISFIED" : "BLOCKED",
          supportedRequestSemantics
            ? "STRICT_SEARCH_REQUEST_SUBSET_CONFIRMED"
            : "UNSUPPORTED_SEARCH_REQUEST_SEMANTICS",
        ),
        obligation(
          "REQUEST_TARGET_CONSISTENT",
          request === undefined || target === undefined || endpoint === undefined
            ? "UNKNOWN"
            : pathConsistent ? "SATISFIED" : "BLOCKED",
          pathConsistent ? "REQUEST_PATH_TARGETS_DECLARED_INDEX_EXPRESSION" : "REQUEST_PATH_TARGET_MISMATCH",
        ),
        obligation(
          "SOURCE_SCOPE_RESOLVED",
          scopeResolved ? "SATISFIED" : "UNKNOWN",
          scopeResolved ? "LOCAL_INDEX_SCOPE_RESOLVED" : "LOCAL_INDEX_SCOPE_UNRESOLVED",
        ),
        exactBoolean(
          "ALLOW_NO_INDICES_FALSE",
          params?.allow_no_indices,
          false,
          "EMPTY_OR_UNRESOLVED_SOURCE_SCOPE",
          "ALLOW_NO_INDICES_MISSING_OR_MALFORMED",
        ),
        exactBoolean(
          "IGNORE_UNAVAILABLE_FALSE",
          params?.ignore_unavailable,
          false,
          "UNAVAILABLE_INDICES_IGNORED",
          "IGNORE_UNAVAILABLE_MISSING_OR_MALFORMED",
        ),
        exactBoolean(
          "PARTIAL_RESULTS_DISABLED",
          params?.allow_partial_search_results,
          false,
          "PARTIAL_RESULTS_ALLOWED",
          "PARTIAL_RESULTS_SETTING_MISSING_OR_MALFORMED",
        ),
        exactBoolean(
          "EXACT_TOTAL_TRACKING",
          body?.track_total_hits,
          true,
          "EXACT_TOTAL_TRACKING_DISABLED",
          "EXACT_TOTAL_TRACKING_MISSING_OR_MALFORMED",
        ),
        safeTerminateAfter(body),
        obligation(
          "LOCAL_SEARCH_ONLY",
          localModeState,
          localModeState === "SATISFIED"
            ? "LOCAL_SEARCH_CONFIRMED"
            : localModeState === "BLOCKED"
              ? "CROSS_CLUSTER_OR_UNSUPPORTED_SOURCE_MODE"
              : "LOCAL_SEARCH_MODE_MISSING_OR_MALFORMED",
        ),
        zeroState,
        relationState,
        exactBoolean(
          "NOT_TIMED_OUT",
          response?.timed_out,
          false,
          "SEARCH_TIMED_OUT",
          "TIMEOUT_WITNESS_MISSING_OR_MALFORMED",
        ),
        exactNumber(
          "NO_SHARD_FAILURES",
          shards?.failed,
          0,
          "SHARD_FAILURE_OBSERVED",
          "SHARD_FAILURE_WITNESS_MISSING_OR_MALFORMED",
        ),
        shardScope,
        shardAccounting,
        exactBoolean(
          "NOT_TERMINATED_EARLY",
          response?.terminated_early,
          false,
          "EARLY_TERMINATION_OBSERVED",
          "EARLY_TERMINATION_WITNESS_MISSING_OR_MALFORMED",
        ),
      ],
      ...(scope === undefined ? {} : { scope }),
    };
  },
};

const ODATA_REQUEST_KEYS = new Set(["method", "path", "entitySet", "odataVersion", "mode"]);
const ODATA_ZERO_SAFE_QUERY_OPTIONS = new Set(["filter", "search"]);

function odataPathTargetsEntitySet(path: string | undefined, entitySet: string | undefined): boolean {
  const url = relativeUrl(path);
  const segments = decodedPathSegments(url);
  return entitySet !== undefined && segments !== undefined && segments.at(-1) === entitySet;
}

function odataQuerySemantics(path: string | undefined): Obligation {
  const url = relativeUrl(path);
  if (url === undefined) {
    return obligation("ZERO_SAFE_REQUEST_SEMANTICS", "UNKNOWN", "ODATA_REQUEST_URL_MISSING_OR_MALFORMED");
  }
  const seen = new Set<string>();
  for (const rawName of url.searchParams.keys()) {
    const withoutDollar = rawName.startsWith("$") ? rawName.slice(1) : rawName;
    const normalized = withoutDollar.toLowerCase();
    if (normalized.length === 0 || seen.has(normalized)) {
      return obligation("ZERO_SAFE_REQUEST_SEMANTICS", "BLOCKED", "DUPLICATE_OR_MALFORMED_QUERY_OPTION");
    }
    seen.add(normalized);
    if (!ODATA_ZERO_SAFE_QUERY_OPTIONS.has(normalized)) {
      return obligation("ZERO_SAFE_REQUEST_SEMANTICS", "BLOCKED", "CARDINALITY_SHAPING_OR_UNSUPPORTED_QUERY_OPTION");
    }
  }
  return obligation("ZERO_SAFE_REQUEST_SEMANTICS", "SATISFIED", "FILTER_SEARCH_ONLY_REQUEST_SUBSET");
}

function odataContextMatchesEntitySet(context: string | undefined, entitySet: string | undefined): boolean {
  if (context === undefined || entitySet === undefined) return false;
  const hash = context.lastIndexOf("#");
  if (hash < 0) return false;
  try {
    return decodeURIComponent(context.slice(hash + 1)) === entitySet;
  } catch {
    return false;
  }
}

const odata: SourceProfileAdapter = {
  profile: { id: "odata-4.01-entity-collection", version: "0.2.1" },
  witnessClass: "enumeration-closure",
  assess(observation): AdapterAssessment {
    const request = record(observation.request);
    const response = record(observation.response);
    const endpoint = nonEmptyString(request?.path);
    const entitySet = nonEmptyString(request?.entitySet);
    const requestShapeState = onlyKeys(request, ODATA_REQUEST_KEYS);
    const getRequest = request?.method === "GET";
    const collectionMode = request?.odataVersion === "4.01" && request?.mode === "entity-collection";
    const collectionModeState: ObligationState = request?.odataVersion === undefined
      || request?.mode === undefined
      ? "UNKNOWN"
      : typeof request.odataVersion !== "string" || typeof request.mode !== "string"
        ? "UNKNOWN"
        : collectionMode ? "SATISFIED" : "BLOCKED";
    const pathConsistent = odataPathTargetsEntitySet(endpoint, entitySet);
    const querySemantics = odataQuerySemantics(endpoint);
    const scopeResolved = endpoint !== undefined
      && entitySet !== undefined
      && pathConsistent
      && collectionMode
      && getRequest;
    const scope = scopeResolved
      ? {
          provider: "odata" as const,
          endpoint,
          entitySet,
          queryBinding: observation.requestBinding,
          visibility: visibility(observation),
        }
      : undefined;
    const value = response?.value;
    const count = Array.isArray(value) ? value.length : undefined;
    const nextLinkPresent = response !== undefined
      && (Object.hasOwn(response, "@nextLink") || Object.hasOwn(response, "@odata.nextLink"));
    const nextLinkValue = response?.["@nextLink"] ?? response?.["@odata.nextLink"];
    const closure = response === undefined
      ? obligation("ENUMERATION_CLOSED", "UNKNOWN", "COLLECTION_RESPONSE_MISSING_OR_MALFORMED")
      : !nextLinkPresent
        ? obligation("ENUMERATION_CLOSED", "SATISFIED", "NEXT_LINK_ABSENT_UNDER_ODATA_CONTRACT")
        : nonEmptyString(nextLinkValue) !== undefined
          ? obligation("ENUMERATION_CLOSED", "BLOCKED", "PARTIAL_COLLECTION_HAS_NEXT_LINK")
          : obligation("ENUMERATION_CLOSED", "UNKNOWN", "NEXT_LINK_MALFORMED");
    const deltaPresent = response !== undefined
      && (Object.hasOwn(response, "@deltaLink") || Object.hasOwn(response, "@odata.deltaLink"));
    const context = nonEmptyString(response?.["@context"])
      ?? nonEmptyString(response?.["@odata.context"]);
    const contextMatches = odataContextMatchesEntitySet(context, entitySet);
    const zeroState = count === 0
      ? obligation("ZERO_CARDINALITY", "SATISFIED", "EMPTY_COLLECTION_OBSERVED")
      : typeof count === "number" && count > 0
        ? obligation("ZERO_CARDINALITY", "BLOCKED", "NONEMPTY_COLLECTION_OBSERVED")
        : obligation("ZERO_CARDINALITY", "UNKNOWN", "COLLECTION_VALUE_MISSING_OR_MALFORMED");
    const countKeys = response === undefined
      ? []
      : ["@count", "@odata.count"].filter((key) => Object.hasOwn(response, key));
    const inlineCount = countKeys.length === 1 ? response?.[countKeys[0]!] : undefined;
    const countContradiction = response === undefined
      ? defeater("NO_CONTRADICTORY_INLINE_COUNT", "UNKNOWN", "COLLECTION_RESPONSE_MISSING_OR_MALFORMED")
      : countKeys.length === 0
        ? defeater("NO_CONTRADICTORY_INLINE_COUNT", "SATISFIED", "INLINE_COUNT_ABSENT")
        : countKeys.length > 1
          ? defeater("NO_CONTRADICTORY_INLINE_COUNT", "UNKNOWN", "DUPLICATE_INLINE_COUNT_CONTROLS")
          : nonNegativeInteger(inlineCount) === undefined
            ? defeater("NO_CONTRADICTORY_INLINE_COUNT", "UNKNOWN", "INLINE_COUNT_MALFORMED")
            : (inlineCount as number) > 0
              ? defeater("NO_CONTRADICTORY_INLINE_COUNT", "BLOCKED", "INLINE_COUNT_CONTRADICTS_ZERO")
              : defeater("NO_CONTRADICTORY_INLINE_COUNT", "SATISFIED", "INLINE_COUNT_DOES_NOT_CONTRADICT_ZERO");

    return {
      profile: this.profile,
      witnessClass: this.witnessClass,
      presence: presenceForCount(count),
      obligations: [
        obligation(
          "SUPPORTED_PROFILE_INPUT_SHAPE",
          requestShapeState,
          requestShapeState === "SATISFIED"
            ? "ODATA_PROFILE_INPUT_SHAPE_CONFIRMED"
            : requestShapeState === "BLOCKED"
              ? "UNSUPPORTED_ODATA_PROFILE_INPUT_FIELDS"
              : "ODATA_PROFILE_INPUT_MISSING_OR_MALFORMED",
        ),
        obligation(
          "GET_COLLECTION_REQUEST",
          request?.method === undefined ? "UNKNOWN" : getRequest ? "SATISFIED" : "BLOCKED",
          getRequest ? "GET_REQUEST_CONFIRMED" : "NON_GET_REQUEST_UNSUPPORTED",
        ),
        obligation(
          "REQUEST_TARGET_CONSISTENT",
          request === undefined || endpoint === undefined || entitySet === undefined
            ? "UNKNOWN"
            : pathConsistent ? "SATISFIED" : "BLOCKED",
          pathConsistent ? "REQUEST_PATH_TARGETS_DECLARED_ENTITY_SET" : "REQUEST_PATH_ENTITY_SET_MISMATCH",
        ),
        querySemantics,
        obligation(
          "SOURCE_SCOPE_RESOLVED",
          scopeResolved ? "SATISFIED" : "UNKNOWN",
          scopeResolved ? "ENTITY_COLLECTION_SCOPE_RESOLVED" : "ENTITY_COLLECTION_SCOPE_UNRESOLVED",
        ),
        obligation(
          "ODATA_401_COLLECTION_MODE",
          collectionModeState,
          collectionModeState === "SATISFIED"
            ? "ODATA_401_ENTITY_COLLECTION_CONFIRMED"
            : collectionModeState === "BLOCKED"
              ? "UNSUPPORTED_ODATA_MODE"
              : "ODATA_MODE_MISSING_OR_MALFORMED",
        ),
        obligation(
          "COLLECTION_CONTEXT_MATCHES_SCOPE",
          context === undefined || entitySet === undefined
            ? "UNKNOWN"
            : contextMatches ? "SATISFIED" : "BLOCKED",
          contextMatches ? "ODATA_CONTEXT_MATCHES_ENTITY_SET" : "ODATA_CONTEXT_SCOPE_MISMATCH",
        ),
        zeroState,
        countContradiction,
        closure,
        obligation(
          "NO_DELTA_RESPONSE",
          response === undefined ? "UNKNOWN" : deltaPresent ? "BLOCKED" : "SATISFIED",
          response === undefined
            ? "COLLECTION_RESPONSE_MISSING_OR_MALFORMED"
            : deltaPresent ? "DELTA_RESPONSE_UNSUPPORTED" : "NON_DELTA_RESPONSE_CONFIRMED",
        ),
      ],
      ...(scope === undefined ? {} : { scope }),
    };
  },
};

export const PROFILE_ADAPTERS: ReadonlyMap<string, SourceProfileAdapter> = new Map([
  [algolia.profile.id, algolia],
  [elasticsearch.profile.id, elasticsearch],
  [odata.profile.id, odata],
]);
