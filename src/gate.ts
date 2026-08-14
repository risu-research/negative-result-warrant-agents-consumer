import {
  checkNegativePremise,
  deriveZeroProposition,
  type NegativePremiseGateVerdict,
  type ZeroProposition,
} from "../vendor/nrw/frozen/phase2.1/src/index.ts";
import {
  hasAlgoliaRealSourceValidationMark,
} from "../vendor/nrw/src/real-source-evidence.ts";
import type {
  ReceiverValidatedAlgoliaRealSourceEvidence,
} from "../vendor/nrw/src/types.ts";
import { FIXED_MATCHING_CONTROLS } from "./constants.ts";

export interface ConsumerActionInputs {
  applicationId: string;
  index: string;
  query: string;
  credentialFingerprint: string;
}

export interface ConsumerActionResult {
  verdict: NegativePremiseGateVerdict;
  requiredProposition?: ZeroProposition;
  effectCount: number;
}

/**
 * Consumer-owned policy boundary.
 * The caller supplies action facts, never a ZeroProposition.
 */
export function consumeVerifiedNoMatch(input: ConsumerActionInputs & {
  evidence?: ReceiverValidatedAlgoliaRealSourceEvidence;
  effect: () => void;
}): ConsumerActionResult {
  const authorityContextId = `algolia-search-key-sha256:${input.credentialFingerprint}`;
  const sourceInstanceId = `algolia-app:${input.applicationId}`;
  const path = `/1/indexes/${encodeURIComponent(input.index)}/query`;

  const requiredProposition = deriveZeroProposition({
    profile: "algolia-search",
    request: {
      path,
      index: input.index,
      query: input.query,
      ...FIXED_MATCHING_CONTROLS,
    },
    authorityContextId,
    sourceScope: {
      provider: "algolia",
      endpoint: path,
      entitySet: "index-records",
      requestedIndex: input.index,
      effectiveIndex: input.index,
    },
  });

  const evidence = input.evidence;
  const outerValid = evidence !== undefined
    && hasAlgoliaRealSourceValidationMark(evidence)
    && evidence.sourceInstance.applicationId === input.applicationId
    && evidence.sourceInstance.sourceInstanceId === sourceInstanceId
    && evidence.authorityContextId === authorityContextId
    && evidence.credentialBinding.digest === input.credentialFingerprint;

  const verdict = requiredProposition !== undefined && outerValid
    ? checkNegativePremise({
        requiredProposition,
        evidence: evidence.boundEvidence,
      })
    : "BLOCK";

  let effectCount = 0;
  if (verdict === "PASS") {
    input.effect();
    effectCount = 1;
  }

  return {
    verdict,
    ...(requiredProposition === undefined ? {} : { requiredProposition }),
    effectCount,
  };
}
