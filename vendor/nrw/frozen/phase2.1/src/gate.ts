import { sameZeroProposition } from "./proposition.ts";
import { hasReceiverValidationMark } from "./receiver.ts";
import type {
  NegativePremiseGateVerdict,
  ReceiverValidatedBoundNegativeEvidence,
  ZeroProposition,
} from "./types.ts";

/** A deliberately tiny proposition-equality premise gate, not an authorization system. */
export function checkNegativePremise(input: {
  requiredProposition: ZeroProposition;
  evidence?: ReceiverValidatedBoundNegativeEvidence;
}): NegativePremiseGateVerdict {
  const evidence = input.evidence;
  return evidence !== undefined
    && hasReceiverValidationMark(evidence)
    && sameZeroProposition(input.requiredProposition, evidence.proposition)
    ? "PASS"
    : "BLOCK";
}

export function guardedExecute(input: {
  requiredProposition: ZeroProposition;
  evidence?: ReceiverValidatedBoundNegativeEvidence;
  effect: () => void;
}): NegativePremiseGateVerdict {
  const verdict = checkNegativePremise({
    requiredProposition: input.requiredProposition,
    ...(input.evidence === undefined ? {} : { evidence: input.evidence }),
  });
  if (verdict === "PASS") input.effect();
  return verdict;
}
