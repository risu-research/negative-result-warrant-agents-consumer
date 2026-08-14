export const WARRANT_VERSION = "0.2.1" as const;
export const BOUND_EVIDENCE_VERSION = "0.2.2" as const;
export const BOUND_EVIDENCE_KIND = "BOUND_NEGATIVE_EVIDENCE" as const;

export type Verdict = "PRESENT" | "WARRANTED_ZERO" | "UNKNOWN";
export type ObligationState = "SATISFIED" | "BLOCKED" | "UNKNOWN";
export type ObligationKind = "SUPPORT" | "DEFEATER";
export type WitnessClass =
  | "cardinality-exactness"
  | "execution-coverage"
  | "enumeration-closure";

export interface ProfileRef {
  id: string;
  version: typeof WARRANT_VERSION;
}

export interface Obligation {
  id: string;
  kind: ObligationKind;
  state: ObligationState;
  reasonCode: string;
}

export interface EvidenceFact {
  id: "MATCH_PRESENT";
  state: ObligationState;
  reasonCode: string;
}

export interface ByteBinding {
  algorithm: "SHA-256";
  representation: "exact-profile-input-bytes";
  digest: string;
  byteLength: number;
}

export interface VisibilityContext {
  kind: "source-effective-view-only";
  authorityContextId: string;
}

export interface SourceScope {
  provider: "algolia" | "elasticsearch" | "odata";
  endpoint: string;
  entitySet: string;
  queryBinding: ByteBinding;
  visibility: VisibilityContext;
  requestedIndex?: string;
  effectiveIndex?: string;
  targetIndexExpression?: string;
}

/**
 * A source-observation warrant only. It does not assert real-world absence,
 * global visibility, freshness, durability, or what another principal sees.
 */
export interface NegativeResultWarrant {
  version: typeof WARRANT_VERSION;
  verdict: "WARRANTED_ZERO";
  profile: ProfileRef;
  requestBinding: ByteBinding;
  observationBinding: {
    observationId: string;
    response: ByteBinding;
  };
  scope: SourceScope;
  proposition: ZeroProposition;
  obligations: Obligation[];
  reasonCodes: ["SOURCE_OBSERVATION_WARRANTS_ZERO"];
}

export interface EvaluationResult {
  version: typeof WARRANT_VERSION;
  verdict: Verdict;
  profile?: ProfileRef;
  witnessClass?: WitnessClass;
  obligations: Obligation[];
  evidenceFacts: EvidenceFact[];
  reasonCodes: string[];
  warrant?: NegativeResultWarrant;
}

export interface AuthorityContext {
  kind: "opaque-non-secret";
  id: string;
}

export interface SourceObservation {
  profile?: string;
  observationId?: string;
  requestBytes?: Uint8Array;
  responseBytes?: Uint8Array;
  authorityContext?: AuthorityContext;
}

export interface ParsedObservation {
  request: unknown;
  response: unknown;
  requestBinding: ByteBinding;
  responseBinding: ByteBinding;
  authorityContext: AuthorityContext;
}

export interface AdapterAssessment {
  profile: ProfileRef;
  witnessClass: WitnessClass;
  presence: EvidenceFact;
  obligations: Obligation[];
  scope?: SourceScope;
}

export interface SourceProfileAdapter {
  profile: ProfileRef;
  witnessClass: WitnessClass;
  assess(observation: ParsedObservation): AdapterAssessment;
}

export type PropositionPreservation = "PRESERVING" | "NOT_PRESERVING" | "UNKNOWN";
export type AcquisitionClassification =
  | "PASSIVE_ONLY"
  | "SAFE_STRENGTHENING_AVAILABLE"
  | "PROPOSITION_CHANGING_ONLY"
  | "NONE_IDENTIFIED";
export type RequestChangeKind =
  | "NONE"
  | "EVIDENCE_ONLY_STRENGTHENING"
  | "RETRIEVAL_SHAPING_NORMALIZATION"
  | "PROPOSITION_CHANGING";

export interface ZeroProposition {
  profile: ProfileRef;
  sourceScopeIdentity: string;
  matchPredicateIdentity: string;
  authorityContextId: string;
}

export interface VerificationComparison {
  profile: string;
  originalRequest: unknown;
  verificationRequest: unknown;
  originalAuthorityContextId: string;
  verificationAuthorityContextId: string;
}

export interface VerificationAssessment {
  preservation: PropositionPreservation;
  acquisition: AcquisitionClassification;
  changeKind: RequestChangeKind;
  reasonCodes: string[];
  originalProposition?: ZeroProposition;
  verificationProposition?: ZeroProposition;
}

export interface BoundNegativeEvidence {
  kind: typeof BOUND_EVIDENCE_KIND;
  version: typeof BOUND_EVIDENCE_VERSION;
  proposition: ZeroProposition;
  sourceWarrant: NegativeResultWarrant;
  verificationObservation: {
    profile: string;
    observationId: string;
    requestBinding: ByteBinding;
    responseBinding: ByteBinding;
    authorityContextId: string;
  };
  mode: "DIRECT" | "PROPOSITION_PRESERVING_VERIFICATION";
  preservationReasonCodes: string[];
}

type DeepReadonly<T> = T extends (...args: never[]) => unknown
  ? T
  : T extends ReadonlyArray<infer Item>
    ? ReadonlyArray<DeepReadonly<Item>>
    : T extends object
      ? { readonly [Key in keyof T]: DeepReadonly<T[Key]> }
      : T;

declare const receiverValidatedBrand: unique symbol;

/** A root object reconstructed, frozen, and runtime-branded by the receiver. */
export type ReceiverValidatedBoundNegativeEvidence = DeepReadonly<BoundNegativeEvidence> & {
  readonly [receiverValidatedBrand]: true;
};

export type NegativePremiseGateVerdict = "PASS" | "BLOCK";
