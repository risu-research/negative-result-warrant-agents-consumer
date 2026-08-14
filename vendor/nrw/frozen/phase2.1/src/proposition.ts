import { createHash } from "node:crypto";
import {
  WARRANT_VERSION,
  type SourceScope,
  type SourceObservation,
  type ZeroProposition,
} from "./types.ts";

type JsonRecord = Record<string, unknown>;

export function jsonRecord(value: unknown): JsonRecord | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? value as JsonRecord
    : undefined;
}

export function stableJson(value: unknown): string {
  if (value === undefined) return "undefined";
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  const object = jsonRecord(value);
  if (object !== undefined) {
    return `{${Object.keys(object).sort().map(
      (key) => `${JSON.stringify(key)}:${stableJson(object[key])}`,
    ).join(",")}}`;
  }
  return JSON.stringify(value);
}

function identity(value: unknown): string {
  return `sha256:${createHash("sha256").update(stableJson(value)).digest("hex")}`;
}

export function sameZeroProposition(
  left: ZeroProposition,
  right: ZeroProposition,
): boolean {
  return stableJson(left) === stableJson(right);
}

export function parseObservationRequest(observation: SourceObservation): unknown {
  if (observation.requestBytes === undefined) return undefined;
  try {
    return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(observation.requestBytes));
  } catch {
    return undefined;
  }
}

function parseObservationResponse(observation: SourceObservation): unknown {
  if (observation.responseBytes === undefined) return undefined;
  try {
    return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(observation.responseBytes));
  } catch {
    return undefined;
  }
}

function relativeUrl(path: unknown): URL | undefined {
  if (typeof path !== "string" || !path.startsWith("/")) return undefined;
  try {
    const url = new URL(path, "https://profile-input.invalid");
    return url.hash === "" ? url : undefined;
  } catch {
    return undefined;
  }
}

function decodedSegments(url: URL): string[] | undefined {
  try {
    return url.pathname.split("/").filter(Boolean).map(decodeURIComponent);
  } catch {
    return undefined;
  }
}

function onlyKeys(value: JsonRecord, allowed: ReadonlySet<string>): boolean {
  return Object.keys(value).every((key) => allowed.has(key));
}

function build(
  profile: string,
  sourceScopeIdentity: string,
  matchPredicate: unknown,
  authorityContextId: string,
): ZeroProposition {
  return {
    profile: { id: profile, version: WARRANT_VERSION },
    sourceScopeIdentity,
    matchPredicateIdentity: identity(matchPredicate),
    authorityContextId,
  };
}

export type SourceScopeIdentityMaterial = Pick<
  SourceScope,
  | "provider"
  | "endpoint"
  | "entitySet"
  | "requestedIndex"
  | "effectiveIndex"
  | "targetIndexExpression"
>;

/**
 * The single provider-profile-aware source-scope identity derivation.
 * Issuance and receiver validation both call this function.
 */
export function deriveSourceScopeIdentity(
  profile: string,
  scope: SourceScopeIdentityMaterial,
): string | undefined {
  const url = relativeUrl(scope.endpoint);
  const segments = url === undefined ? undefined : decodedSegments(url);
  switch (profile) {
    case "algolia-search": {
      if (scope.provider !== "algolia"
        || scope.entitySet !== "index-records"
        || url?.search !== ""
        || segments?.length !== 4
        || segments[0] !== "1"
        || segments[1] !== "indexes"
        || segments[2] !== scope.requestedIndex
        || segments[3] !== "query"
        || typeof scope.requestedIndex !== "string"
        || scope.requestedIndex.length === 0
        || typeof scope.effectiveIndex !== "string"
        || scope.effectiveIndex.length === 0) return undefined;
      return `algolia:${url.pathname}:requested=${scope.requestedIndex}:effective=${scope.effectiveIndex}`;
    }
    case "elasticsearch-local-search": {
      if (scope.provider !== "elasticsearch"
        || scope.entitySet !== "documents"
        || url?.search !== ""
        || segments?.length !== 2
        || segments[0] !== scope.targetIndexExpression
        || segments[1] !== "_search"
        || typeof scope.targetIndexExpression !== "string"
        || scope.targetIndexExpression.length === 0
        || scope.targetIndexExpression.includes(":")) return undefined;
      return `elasticsearch:${url.pathname}:${scope.targetIndexExpression}:local`;
    }
    case "odata-4.01-entity-collection": {
      if (scope.provider !== "odata"
        || url === undefined
        || typeof scope.entitySet !== "string"
        || scope.entitySet.length === 0
        || segments?.at(-1) !== scope.entitySet) return undefined;
      return `odata:${url.pathname}:${scope.entitySet}`;
    }
    default: return undefined;
  }
}

function deriveAlgolia(
  requestValue: unknown,
  authorityContextId: string,
  sourceScope?: SourceScopeIdentityMaterial,
): ZeroProposition | undefined {
  const request = jsonRecord(requestValue);
  if (request === undefined
    || typeof request.path !== "string"
    || typeof request.index !== "string"
    || request.index.length === 0) return undefined;
  const url = relativeUrl(request.path);
  if (url === undefined || url.search !== "") return undefined;
  const segments = decodedSegments(url);
  if (segments?.length !== 4
    || segments[0] !== "1"
    || segments[1] !== "indexes"
    || segments[2] !== request.index
    || segments[3] !== "query") return undefined;
  const matchPredicate = { ...request };
  delete matchPredicate.getRankingInfo;
  const scope = sourceScope ?? {
    provider: "algolia",
    endpoint: request.path,
    entitySet: "index-records",
    requestedIndex: request.index,
    effectiveIndex: request.index,
  };
  if (scope.endpoint !== request.path || scope.requestedIndex !== request.index) return undefined;
  const sourceScopeIdentity = deriveSourceScopeIdentity("algolia-search", scope);
  if (sourceScopeIdentity === undefined) return undefined;
  return build(
    "algolia-search",
    sourceScopeIdentity,
    matchPredicate,
    authorityContextId,
  );
}

export interface ODataRequestParts {
  request: JsonRecord;
  url: URL;
  options: Map<string, string>;
}

const ODATA_REQUEST_KEYS = new Set(["method", "path", "entitySet", "odataVersion", "mode"]);
const ODATA_COMPARABLE_OPTIONS = new Set(["filter", "search", "top", "skip", "count"]);

export function parseODataRequest(value: unknown): ODataRequestParts | undefined {
  const request = jsonRecord(value);
  if (request === undefined || !onlyKeys(request, ODATA_REQUEST_KEYS)) return undefined;
  const url = relativeUrl(request.path);
  if (url === undefined
    || request.method !== "GET"
    || request.odataVersion !== "4.01"
    || request.mode !== "entity-collection"
    || typeof request.entitySet !== "string"
    || request.entitySet.length === 0) return undefined;
  const segments = decodedSegments(url);
  if (segments?.at(-1) !== request.entitySet) return undefined;
  const options = new Map<string, string>();
  for (const [rawName, optionValue] of url.searchParams) {
    const name = (rawName.startsWith("$") ? rawName.slice(1) : rawName).toLowerCase();
    if (!ODATA_COMPARABLE_OPTIONS.has(name) || options.has(name)) return undefined;
    if (name === "count" && !["true", "false"].includes(optionValue.toLowerCase())) return undefined;
    if ((name === "top" || name === "skip") && !/^[0-9]+$/.test(optionValue)) return undefined;
    options.set(name, optionValue);
  }
  return { request, url, options };
}

export function optionIdentity(options: Map<string, string>, names: string[]): JsonRecord {
  return Object.fromEntries(
    names.filter((name) => options.has(name)).map((name) => [name, options.get(name)]),
  );
}

function deriveOData(
  requestValue: unknown,
  authorityContextId: string,
  sourceScope?: SourceScopeIdentityMaterial,
): ZeroProposition | undefined {
  const parts = parseODataRequest(requestValue);
  if (parts === undefined) return undefined;
  const scope = sourceScope ?? {
    provider: "odata",
    endpoint: parts.request.path as string,
    entitySet: parts.request.entitySet as string,
  };
  if (scope.endpoint !== parts.request.path || scope.entitySet !== parts.request.entitySet) return undefined;
  const sourceScopeIdentity = deriveSourceScopeIdentity("odata-4.01-entity-collection", scope);
  if (sourceScopeIdentity === undefined) return undefined;
  return build(
    "odata-4.01-entity-collection",
    sourceScopeIdentity,
    optionIdentity(parts.options, ["filter", "search"]),
    authorityContextId,
  );
}

export interface ElasticsearchRequestParts {
  request: JsonRecord;
  params: JsonRecord;
  body: JsonRecord;
  url: URL;
}

const ES_REQUEST_KEYS = new Set(["path", "target", "sourceMode", "params", "body"]);
const ES_PARAM_KEYS = new Set(["allow_no_indices", "ignore_unavailable", "allow_partial_search_results"]);
const ES_BODY_KEYS = new Set(["query", "track_total_hits", "terminate_after"]);

export function parseElasticsearchRequest(value: unknown): ElasticsearchRequestParts | undefined {
  const request = jsonRecord(value);
  const params = jsonRecord(request?.params);
  const body = jsonRecord(request?.body);
  const url = relativeUrl(request?.path);
  if (request === undefined || params === undefined || body === undefined || url === undefined
    || !onlyKeys(request, ES_REQUEST_KEYS)
    || !onlyKeys(params, ES_PARAM_KEYS)
    || !onlyKeys(body, ES_BODY_KEYS)
    || !Object.hasOwn(body, "query")
    || typeof request.target !== "string"
    || request.target.length === 0
    || request.target.includes(":")
    || request.sourceMode !== "local") return undefined;
  const segments = decodedSegments(url);
  if (url.search !== "" || segments?.length !== 2
    || segments[0] !== request.target || segments[1] !== "_search") return undefined;
  const booleanFields = [
    params.allow_no_indices,
    params.ignore_unavailable,
    params.allow_partial_search_results,
    body.track_total_hits,
  ];
  if (booleanFields.some((item) => ![undefined, true, false].includes(item as boolean | undefined))) {
    return undefined;
  }
  if (body.terminate_after !== undefined
    && !(typeof body.terminate_after === "number"
      && Number.isInteger(body.terminate_after)
      && body.terminate_after >= 0)) return undefined;
  return { request, params, body, url };
}

function deriveElasticsearch(
  requestValue: unknown,
  authorityContextId: string,
  sourceScope?: SourceScopeIdentityMaterial,
): ZeroProposition | undefined {
  const parts = parseElasticsearchRequest(requestValue);
  if (parts === undefined) return undefined;
  const scope = sourceScope ?? {
    provider: "elasticsearch",
    endpoint: parts.request.path as string,
    entitySet: "documents",
    targetIndexExpression: parts.request.target as string,
  };
  if (scope.endpoint !== parts.request.path
    || scope.targetIndexExpression !== parts.request.target) return undefined;
  const sourceScopeIdentity = deriveSourceScopeIdentity("elasticsearch-local-search", scope);
  if (sourceScopeIdentity === undefined) return undefined;
  return build(
    "elasticsearch-local-search",
    sourceScopeIdentity,
    {
      query: parts.body.query,
      ...(parts.body.terminate_after === undefined
        ? {}
        : { terminate_after: parts.body.terminate_after }),
    },
    authorityContextId,
  );
}

/** The sole proposition derivation used by issuance, comparison, composition, and tests. */
export function deriveZeroProposition(input: {
  profile: string;
  request: unknown;
  authorityContextId: string;
  sourceScope?: SourceScopeIdentityMaterial;
}): ZeroProposition | undefined {
  if (input.authorityContextId.length === 0) return undefined;
  switch (input.profile) {
    case "algolia-search": return deriveAlgolia(input.request, input.authorityContextId, input.sourceScope);
    case "odata-4.01-entity-collection": return deriveOData(input.request, input.authorityContextId, input.sourceScope);
    case "elasticsearch-local-search": return deriveElasticsearch(input.request, input.authorityContextId, input.sourceScope);
    default: return undefined;
  }
}

export function deriveZeroPropositionFromObservation(
  observation: SourceObservation,
): ZeroProposition | undefined {
  if (observation.profile === undefined || observation.authorityContext?.id === undefined) return undefined;
  const request = parseObservationRequest(observation);
  if (request === undefined) return undefined;
  const requestRecord = jsonRecord(request);
  const responseRecord = jsonRecord(parseObservationResponse(observation));
  const sourceScope = observation.profile === "algolia-search"
    && requestRecord !== undefined
    && responseRecord !== undefined
    && typeof requestRecord.path === "string"
    && typeof requestRecord.index === "string"
    && typeof responseRecord.indexUsed === "string"
    ? {
        provider: "algolia" as const,
        endpoint: requestRecord.path,
        entitySet: "index-records",
        requestedIndex: requestRecord.index,
        effectiveIndex: responseRecord.indexUsed,
      }
    : undefined;
  return deriveZeroProposition({
    profile: observation.profile,
    request,
    authorityContextId: observation.authorityContext.id,
    ...(sourceScope === undefined ? {} : { sourceScope }),
  });
}
