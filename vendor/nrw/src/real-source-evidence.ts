import {
  decodeBoundNegativeEvidence,
  type ReceiverValidatedBoundNegativeEvidence,
} from "../frozen/phase2.1/src/index.ts";
import {
  ALGOLIA_HTTP_NORMALIZER_VERSION,
  ALGOLIA_REAL_SOURCE_KIND,
  ALGOLIA_REAL_SOURCE_VERSION,
  type AlgoliaHttpObservationReceipt,
  type AlgoliaRealSourceNegativeEvidence,
  type CredentialBinding,
  type DigestBinding,
  type ReceiverValidatedAlgoliaRealSourceEvidence,
} from "./types.ts";

type JsonRecord = Record<string, unknown>;
const roots = new WeakSet<object>();
const HEX_64 = /^[0-9a-f]{64}$/;

function record(value: unknown): JsonRecord | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? value as JsonRecord
    : undefined;
}

function exactKeys(value: JsonRecord, keys: readonly string[]): boolean {
  const expected = new Set(keys);
  return keys.every((key) => Object.hasOwn(value, key))
    && Object.keys(value).every((key) => expected.has(key));
}

function nonEmpty(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function binding<Representation extends string>(
  value: unknown,
  representation: Representation,
): DigestBinding<Representation> | undefined {
  const input = record(value);
  if (input === undefined
    || !exactKeys(input, ["algorithm", "representation", "digest", "byteLength"])
    || input.algorithm !== "SHA-256"
    || input.representation !== representation
    || typeof input.digest !== "string"
    || !HEX_64.test(input.digest)
    || typeof input.byteLength !== "number"
    || !Number.isInteger(input.byteLength)
    || input.byteLength < 0) return undefined;
  return {
    algorithm: "SHA-256",
    representation,
    digest: input.digest,
    byteLength: input.byteLength,
  };
}

function sameBinding(
  left: DigestBinding<string>,
  right: DigestBinding<string>,
): boolean {
  return left.algorithm === right.algorithm
    && left.representation === right.representation
    && left.digest === right.digest
    && left.byteLength === right.byteLength;
}

function deepFreeze<T>(value: T): T {
  if (typeof value !== "object" || value === null || Object.isFrozen(value)) return value;
  for (const child of Object.values(value as Record<string, unknown>)) deepFreeze(child);
  return Object.freeze(value);
}

export function createAlgoliaRealSourceEvidence(
  receipt: AlgoliaHttpObservationReceipt,
  boundEvidence: ReceiverValidatedBoundNegativeEvidence,
): AlgoliaRealSourceNegativeEvidence {
  return {
    kind: ALGOLIA_REAL_SOURCE_KIND,
    version: ALGOLIA_REAL_SOURCE_VERSION,
    sourceInstance: receipt.sourceInstance,
    authorityContextId: receipt.authorityContextId,
    credentialBinding: receipt.request.credentialBinding,
    verificationCapture: {
      adapterVersion: ALGOLIA_HTTP_NORMALIZER_VERSION,
      rawRequestBodyBinding: receipt.request.bodyBinding,
      rawResponseBodyBinding: receipt.response.bodyBinding,
      normalizedRequestBinding: receipt.normalized.requestBinding,
      normalizedResponseBinding: receipt.normalized.responseBinding,
    },
    boundEvidence: JSON.parse(JSON.stringify(boundEvidence)) as AlgoliaRealSourceNegativeEvidence["boundEvidence"],
  };
}

export function decodeAlgoliaRealSourceEvidence(
  value: unknown,
  expected: { applicationId: string; credentialFingerprint: string },
): ReceiverValidatedAlgoliaRealSourceEvidence | undefined {
  try {
    const input = record(value);
    if (input === undefined || !exactKeys(input, [
      "kind",
      "version",
      "sourceInstance",
      "authorityContextId",
      "credentialBinding",
      "verificationCapture",
      "boundEvidence",
    ]) || input.kind !== ALGOLIA_REAL_SOURCE_KIND
      || input.version !== ALGOLIA_REAL_SOURCE_VERSION) return undefined;
    const source = record(input.sourceInstance);
    const authorityContextId = nonEmpty(input.authorityContextId);
    const credential = binding(
      input.credentialBinding,
      "exact-credential-bytes-sha256-fingerprint",
    ) as CredentialBinding | undefined;
    const capture = record(input.verificationCapture);
    if (source === undefined
      || !exactKeys(source, ["provider", "applicationId", "sourceInstanceId"])
      || source.provider !== "algolia"
      || source.applicationId !== expected.applicationId
      || source.sourceInstanceId !== `algolia-app:${expected.applicationId}`
      || authorityContextId !== `algolia-search-key-sha256:${expected.credentialFingerprint}`
      || credential === undefined
      || credential.digest !== expected.credentialFingerprint
      || capture === undefined
      || !exactKeys(capture, [
        "adapterVersion",
        "rawRequestBodyBinding",
        "rawResponseBodyBinding",
        "normalizedRequestBinding",
        "normalizedResponseBinding",
      ])
      || capture.adapterVersion !== ALGOLIA_HTTP_NORMALIZER_VERSION) return undefined;
    const rawRequest = binding(capture.rawRequestBodyBinding, "exact-http-body-bytes");
    const rawResponse = binding(capture.rawResponseBodyBinding, "exact-http-body-bytes");
    const normalizedRequest = binding(capture.normalizedRequestBinding, "exact-profile-input-bytes");
    const normalizedResponse = binding(capture.normalizedResponseBinding, "exact-profile-input-bytes");
    const nested = decodeBoundNegativeEvidence(input.boundEvidence);
    if (rawRequest === undefined || rawResponse === undefined
      || normalizedRequest === undefined || normalizedResponse === undefined
      || nested === undefined
      || nested.sourceWarrant.profile.id !== "algolia-search"
      || nested.sourceWarrant.scope.provider !== "algolia"
      || nested.proposition.authorityContextId !== authorityContextId
      || !sameBinding(normalizedRequest, nested.sourceWarrant.requestBinding)
      || !sameBinding(normalizedResponse, nested.sourceWarrant.observationBinding.response)) {
      return undefined;
    }
    const reconstructed = {
      kind: ALGOLIA_REAL_SOURCE_KIND,
      version: ALGOLIA_REAL_SOURCE_VERSION,
      sourceInstance: {
        provider: "algolia" as const,
        applicationId: expected.applicationId,
        sourceInstanceId: `algolia-app:${expected.applicationId}`,
      },
      authorityContextId,
      credentialBinding: credential,
      verificationCapture: {
        adapterVersion: ALGOLIA_HTTP_NORMALIZER_VERSION,
        rawRequestBodyBinding: rawRequest,
        rawResponseBodyBinding: rawResponse,
        normalizedRequestBinding: normalizedRequest,
        normalizedResponseBinding: normalizedResponse,
      },
      boundEvidence: nested,
    };
    const frozen = deepFreeze(reconstructed) as unknown as ReceiverValidatedAlgoliaRealSourceEvidence;
    roots.add(frozen);
    return frozen;
  } catch {
    return undefined;
  }
}

export function hasAlgoliaRealSourceValidationMark(
  value: unknown,
): value is ReceiverValidatedAlgoliaRealSourceEvidence {
  return typeof value === "object" && value !== null && roots.has(value);
}
