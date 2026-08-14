import type {
  BoundNegativeEvidence,
  ReceiverValidatedBoundNegativeEvidence,
  SourceObservation,
} from "../frozen/phase2.1/src/types.ts";

export const ALGOLIA_HTTP_NORMALIZER_VERSION = "0.3.0" as const;
export const ALGOLIA_REAL_SOURCE_KIND = "ALGOLIA_REAL_SOURCE_NEGATIVE_EVIDENCE" as const;
export const ALGOLIA_REAL_SOURCE_VERSION = "0.3.0" as const;

export interface DigestBinding<Representation extends string> {
  algorithm: "SHA-256";
  representation: Representation;
  digest: string;
  byteLength: number;
}

export type HttpBodyBinding = DigestBinding<"exact-http-body-bytes">;
export type ProfileInputBinding = DigestBinding<"exact-profile-input-bytes">;
export type CredentialBinding = DigestBinding<"exact-credential-bytes-sha256-fingerprint">;

export interface AlgoliaSourceInstance {
  provider: "algolia";
  applicationId: string;
  sourceInstanceId: string;
}

export interface AlgoliaHttpExchangeCapture {
  sourceInstance: AlgoliaSourceInstance;
  authorityContextId: string;
  observationId: string;
  request: {
    method: string;
    url: string;
    headers: Record<string, string>;
    applicationIdHeader: string;
    credentialBinding: CredentialBinding;
    bodyBytes: Uint8Array;
    sentAt: string;
  };
  response: {
    status: number;
    finalUrl: string;
    headers: Record<string, string>;
    contentType: string;
    bodyBytes: Uint8Array;
    receivedAt: string;
  };
}

export interface AlgoliaHttpObservationReceipt {
  version: "0.3.0";
  sourceInstance: AlgoliaSourceInstance;
  authorityContextId: string;
  observationId: string;
  request: {
    method: "POST";
    url: string;
    origin: string;
    pathname: string;
    queryString: string;
    headers: Record<string, string>;
    applicationIdHeader: string;
    bodyBinding: HttpBodyBinding;
    credentialBinding: CredentialBinding;
  };
  response: {
    status: 200;
    finalUrl: string;
    headers: Record<string, string>;
    contentType: string;
    bodyBinding: HttpBodyBinding;
  };
  normalized: {
    adapterVersion: "0.3.0";
    profile: "algolia-search";
    requestBinding: ProfileInputBinding;
    responseBinding: ProfileInputBinding;
  };
}

export interface NormalizedAlgoliaObservation {
  observation: SourceObservation;
  receipt: AlgoliaHttpObservationReceipt;
  normalizedRequest: Record<string, unknown>;
  normalizedResponse: Record<string, unknown>;
  normalizedRequestBytes: Uint8Array;
  normalizedResponseBytes: Uint8Array;
}

export interface AlgoliaRealSourceNegativeEvidence {
  kind: typeof ALGOLIA_REAL_SOURCE_KIND;
  version: typeof ALGOLIA_REAL_SOURCE_VERSION;
  sourceInstance: AlgoliaSourceInstance;
  authorityContextId: string;
  credentialBinding: CredentialBinding;
  verificationCapture: {
    adapterVersion: "0.3.0";
    rawRequestBodyBinding: HttpBodyBinding;
    rawResponseBodyBinding: HttpBodyBinding;
    normalizedRequestBinding: ProfileInputBinding;
    normalizedResponseBinding: ProfileInputBinding;
  };
  boundEvidence: BoundNegativeEvidence;
}

type DeepReadonly<T> = T extends (...args: never[]) => unknown
  ? T
  : T extends ReadonlyArray<infer Item>
    ? ReadonlyArray<DeepReadonly<Item>>
    : T extends object
      ? { readonly [Key in keyof T]: DeepReadonly<T[Key]> }
      : T;

declare const algoliaRealSourceBrand: unique symbol;

export type ReceiverValidatedAlgoliaRealSourceEvidence = DeepReadonly<
  Omit<AlgoliaRealSourceNegativeEvidence, "boundEvidence">
  & { boundEvidence: ReceiverValidatedBoundNegativeEvidence }
> & { readonly [algoliaRealSourceBrand]: true };

export interface AlgoliaActionInputs {
  applicationId: string;
  index: string;
  query: string;
  credential: string;
}
