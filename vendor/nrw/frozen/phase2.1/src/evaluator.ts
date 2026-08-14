import { createHash } from "node:crypto";
import { PROFILE_ADAPTERS } from "./profiles.ts";
import { deriveZeroProposition } from "./proposition.ts";
import {
  WARRANT_VERSION,
  type AuthorityContext,
  type ByteBinding,
  type EvaluationResult,
  type NegativeResultWarrant,
  type Obligation,
  type ParsedObservation,
  type SourceObservation,
} from "./types.ts";

function bind(bytes: Uint8Array): ByteBinding {
  return {
    algorithm: "SHA-256",
    representation: "exact-profile-input-bytes",
    digest: createHash("sha256").update(bytes).digest("hex"),
    byteLength: bytes.byteLength,
  };
}

function parseJson(bytes: Uint8Array | undefined): unknown {
  if (bytes === undefined) return undefined;
  try {
    return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
  } catch {
    return undefined;
  }
}

function validAuthority(value: AuthorityContext | undefined): value is AuthorityContext {
  return value?.kind === "opaque-non-secret"
    && typeof value.id === "string"
    && value.id.length > 0;
}

function baseObligations(observation: SourceObservation, recognized: boolean): Obligation[] {
  return [
    {
      id: "PROFILE_EXPLICIT",
      kind: "SUPPORT",
      state: recognized ? "SATISFIED" : observation.profile === undefined ? "UNKNOWN" : "BLOCKED",
      reasonCode: recognized
        ? "SUPPORTED_PROFILE_SELECTED_EXPLICITLY"
        : observation.profile === undefined ? "PROFILE_NOT_SELECTED" : "PROFILE_UNSUPPORTED",
    },
    {
      id: "REQUEST_BOUND",
      kind: "SUPPORT",
      state: observation.requestBytes === undefined ? "UNKNOWN" : "SATISFIED",
      reasonCode: observation.requestBytes === undefined
        ? "PROFILE_INPUT_REQUEST_BYTES_MISSING"
        : "EXACT_PROFILE_INPUT_REQUEST_BYTES_BOUND",
    },
    {
      id: "RESPONSE_BOUND",
      kind: "SUPPORT",
      state: observation.responseBytes === undefined ? "UNKNOWN" : "SATISFIED",
      reasonCode: observation.responseBytes === undefined
        ? "PROFILE_INPUT_RESPONSE_BYTES_MISSING"
        : "EXACT_PROFILE_INPUT_RESPONSE_BYTES_BOUND",
    },
    {
      id: "OBSERVATION_BOUND",
      kind: "SUPPORT",
      state: typeof observation.observationId === "string" && observation.observationId.length > 0
        ? "SATISFIED"
        : "UNKNOWN",
      reasonCode: typeof observation.observationId === "string" && observation.observationId.length > 0
        ? "OBSERVATION_IDENTIFIER_BOUND"
        : "OBSERVATION_IDENTIFIER_MISSING",
    },
    {
      id: "VISIBILITY_CONTEXT_BOUND",
      kind: "SUPPORT",
      state: validAuthority(observation.authorityContext) ? "SATISFIED" : "UNKNOWN",
      reasonCode: validAuthority(observation.authorityContext)
        ? "SOURCE_EFFECTIVE_AUTHORITY_CONTEXT_BOUND"
        : "AUTHORITY_CONTEXT_MISSING_OR_MALFORMED",
    },
  ];
}

export function evaluateObservation(observation: SourceObservation): EvaluationResult {
  const adapter = observation.profile === undefined
    ? undefined
    : PROFILE_ADAPTERS.get(observation.profile);
  const obligations = baseObligations(observation, adapter !== undefined);

  if (adapter === undefined
    || observation.requestBytes === undefined
    || observation.responseBytes === undefined
    || !validAuthority(observation.authorityContext)) {
    return {
      version: WARRANT_VERSION,
      verdict: "UNKNOWN",
      obligations,
      evidenceFacts: [],
      reasonCodes: obligations.filter((item) => item.state !== "SATISFIED").map((item) => item.reasonCode),
    };
  }

  const requestBinding = bind(observation.requestBytes);
  const responseBinding = bind(observation.responseBytes);
  const parsed: ParsedObservation = {
    request: parseJson(observation.requestBytes),
    response: parseJson(observation.responseBytes),
    requestBinding,
    responseBinding,
    authorityContext: observation.authorityContext,
  };
  const assessment = adapter.assess(parsed);
  obligations.push(...assessment.obligations);
  const proposition = deriveZeroProposition({
    profile: adapter.profile.id,
    request: parsed.request,
    authorityContextId: observation.authorityContext.id,
    ...(assessment.scope === undefined ? {} : { sourceScope: assessment.scope }),
  });
  obligations.push({
    id: "PROPOSITION_DERIVED",
    kind: "SUPPORT",
    state: proposition === undefined ? "UNKNOWN" : "SATISFIED",
    reasonCode: proposition === undefined
      ? "ZERO_PROPOSITION_DERIVATION_FAILED"
      : "ZERO_PROPOSITION_DERIVED",
  });

  if (assessment.presence.state === "SATISFIED") {
    return {
      version: WARRANT_VERSION,
      verdict: "PRESENT",
      profile: adapter.profile,
      witnessClass: adapter.witnessClass,
      obligations,
      evidenceFacts: [assessment.presence],
      reasonCodes: [assessment.presence.reasonCode],
    };
  }

  const unsupported = obligations.filter(
    (item) => item.kind === "SUPPORT" && item.state !== "SATISFIED",
  );
  const undefeated = obligations.filter(
    (item) => item.kind === "DEFEATER" && item.state !== "SATISFIED",
  );
  const failed = [...unsupported, ...undefeated];
  if (unsupported.length > 0
    || undefeated.length > 0
    || assessment.scope === undefined
    || proposition === undefined
    || observation.observationId === undefined) {
    return {
      version: WARRANT_VERSION,
      verdict: "UNKNOWN",
      profile: adapter.profile,
      witnessClass: adapter.witnessClass,
      obligations,
      evidenceFacts: [assessment.presence],
      reasonCodes: failed.length > 0
        ? [...new Set(failed.map((item) => item.reasonCode))]
        : ["REQUIRED_BINDING_UNAVAILABLE"],
    };
  }

  // This is the only issuance point. Adapters expose facts and obligations;
  // they cannot assert a verdict. Every support obligation is satisfied and
  // every recognized defeater is affirmatively clear. The result remains
  // observation-local and never licenses a world-level nonexistence claim.
  const warrant: NegativeResultWarrant = {
    version: WARRANT_VERSION,
    verdict: "WARRANTED_ZERO",
    profile: adapter.profile,
    requestBinding,
    observationBinding: {
      observationId: observation.observationId,
      response: responseBinding,
    },
    scope: assessment.scope,
    proposition,
    obligations,
    reasonCodes: ["SOURCE_OBSERVATION_WARRANTS_ZERO"],
  };
  return {
    version: WARRANT_VERSION,
    verdict: "WARRANTED_ZERO",
    profile: adapter.profile,
    witnessClass: adapter.witnessClass,
    obligations,
    evidenceFacts: [assessment.presence],
    reasonCodes: [...warrant.reasonCodes],
    warrant,
  };
}

export function warrantDescribesObservation(
  warrant: NegativeResultWarrant,
  observation: SourceObservation,
): boolean {
  if (observation.requestBytes === undefined
    || observation.responseBytes === undefined
    || observation.observationId === undefined
    || !validAuthority(observation.authorityContext)) {
    return false;
  }
  const requestBinding = bind(observation.requestBytes);
  const responseBinding = bind(observation.responseBytes);
  return observation.profile === warrant.profile.id
    && observation.observationId === warrant.observationBinding.observationId
    && observation.authorityContext.id === warrant.scope.visibility.authorityContextId
    && requestBinding.digest === warrant.requestBinding.digest
    && requestBinding.byteLength === warrant.requestBinding.byteLength
    && requestBinding.digest === warrant.scope.queryBinding.digest
    && responseBinding.digest === warrant.observationBinding.response.digest
    && responseBinding.byteLength === warrant.observationBinding.response.byteLength;
}
