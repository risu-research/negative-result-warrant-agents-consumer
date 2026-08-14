import { assessVerificationRequest } from "./acquisition.ts";
import { warrantDescribesObservation } from "./evaluator.ts";
import {
  deriveZeroPropositionFromObservation,
  parseObservationRequest,
  sameZeroProposition,
} from "./proposition.ts";
import {
  type BoundNegativeEvidence,
  type EvaluationResult,
  type ReceiverValidatedBoundNegativeEvidence,
  type SourceObservation,
} from "./types.ts";
import { BOUND_EVIDENCE_KIND, BOUND_EVIDENCE_VERSION } from "./types.ts";
import { decodeBoundNegativeEvidence } from "./receiver.ts";

function sameBytes(left: Uint8Array | undefined, right: Uint8Array | undefined): boolean {
  if (left === undefined || right === undefined || left.byteLength !== right.byteLength) return false;
  return left.every((value, index) => value === right[index]);
}

/**
 * The sole safe replacement for the deleted Phase 1.2 boolean helper.
 * It binds a real Q' warrant to its exact observation before relating Q' to Q.
 */
export function composeNegativeEvidence(input: {
  originalObservation: SourceObservation;
  verificationObservation: SourceObservation;
  verificationResult: EvaluationResult;
}): ReceiverValidatedBoundNegativeEvidence | undefined {
  const warrant = input.verificationResult.warrant;
  if (input.verificationResult.verdict !== "WARRANTED_ZERO" || warrant === undefined) return undefined;
  if (!warrantDescribesObservation(warrant, input.verificationObservation)) return undefined;

  const originalProposition = deriveZeroPropositionFromObservation(input.originalObservation);
  const verificationProposition = deriveZeroPropositionFromObservation(input.verificationObservation);
  if (originalProposition === undefined || verificationProposition === undefined) return undefined;
  if (!sameZeroProposition(warrant.proposition, verificationProposition)) return undefined;
  if (!sameZeroProposition(originalProposition, verificationProposition)) return undefined;

  const originalRequest = parseObservationRequest(input.originalObservation);
  const verificationRequest = parseObservationRequest(input.verificationObservation);
  if (originalRequest === undefined || verificationRequest === undefined
    || input.originalObservation.profile === undefined
    || input.originalObservation.authorityContext === undefined
    || input.verificationObservation.authorityContext === undefined) return undefined;

  const comparison = assessVerificationRequest({
    profile: input.originalObservation.profile,
    originalRequest,
    verificationRequest,
    originalAuthorityContextId: input.originalObservation.authorityContext.id,
    verificationAuthorityContextId: input.verificationObservation.authorityContext.id,
  });
  if (comparison.preservation !== "PRESERVING") return undefined;
  const direct = sameBytes(
    input.originalObservation.requestBytes,
    input.verificationObservation.requestBytes,
  );
  if (!direct && comparison.acquisition !== "SAFE_STRENGTHENING_AVAILABLE") return undefined;

  const candidate: BoundNegativeEvidence = {
    kind: BOUND_EVIDENCE_KIND,
    version: BOUND_EVIDENCE_VERSION,
    proposition: originalProposition,
    sourceWarrant: warrant,
    verificationObservation: {
      profile: input.verificationObservation.profile!,
      observationId: warrant.observationBinding.observationId,
      requestBinding: warrant.requestBinding,
      responseBinding: warrant.observationBinding.response,
      authorityContextId: input.verificationObservation.authorityContext.id,
    },
    mode: direct ? "DIRECT" : "PROPOSITION_PRESERVING_VERIFICATION",
    preservationReasonCodes: comparison.reasonCodes,
  };
  return decodeBoundNegativeEvidence(candidate);
}
