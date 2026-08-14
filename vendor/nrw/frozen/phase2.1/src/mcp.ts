import type {
  EvaluationResult,
  NegativeResultWarrant,
  ProfileRef,
  Verdict,
  WitnessClass,
} from "./types.ts";

export type JsonRpcId = string | number;

export interface NegativeResultMetadata {
  version: EvaluationResult["version"];
  verdict: Verdict;
  reasonCodes: string[];
  profile?: ProfileRef;
  witnessClass?: WitnessClass;
  warrant?: NegativeResultWarrant;
}

export interface McpCompleteToolResponse {
  jsonrpc: "2.0";
  id: JsonRpcId;
  result: {
    resultType: "complete";
    content: [{ type: "text"; text: string }];
    structuredContent: { items: unknown[] };
    _meta: Record<string, NegativeResultMetadata>;
  };
}

export function negativeResultMetadata(evaluation: EvaluationResult): NegativeResultMetadata {
  return {
    version: evaluation.version,
    verdict: evaluation.verdict,
    reasonCodes: evaluation.reasonCodes,
    ...(evaluation.profile === undefined ? {} : { profile: evaluation.profile }),
    ...(evaluation.witnessClass === undefined ? {} : { witnessClass: evaluation.witnessClass }),
    ...(evaluation.warrant === undefined ? {} : { warrant: evaluation.warrant }),
  };
}

const LABEL = /^[A-Za-z](?:[A-Za-z0-9-]*[A-Za-z0-9])?$/;
const NAME = /^[A-Za-z0-9](?:[A-Za-z0-9._-]*[A-Za-z0-9])?$/;

/**
 * Deliberately validates only the prefixed, nonempty-name subset accepted by
 * this experiment. That subset follows the MCP 2026-07-28 MetaObject grammar.
 */
export function isValidAdopterMetaKey(key: string): boolean {
  const parts = key.split("/");
  if (parts.length !== 2) return false;
  const [prefix, name] = parts;
  if (prefix === undefined || name === undefined || name.length === 0 || !NAME.test(name)) {
    return false;
  }
  const labels = prefix.split(".");
  if (labels.length < 2 || labels.some((label) => !LABEL.test(label))) return false;
  const secondLabel = labels[1]?.toLowerCase();
  return secondLabel !== "modelcontextprotocol" && secondLabel !== "mcp";
}

export function bindCompleteToolResponse(
  id: JsonRpcId,
  items: unknown[],
  evaluation: EvaluationResult,
  metadataKey: string,
): McpCompleteToolResponse {
  if (!isValidAdopterMetaKey(metadataKey)) {
    throw new Error("Metadata key is outside the accepted MCP adopter-key subset.");
  }
  const metadata = negativeResultMetadata(evaluation);
  return {
    jsonrpc: "2.0",
    id,
    result: {
      resultType: "complete",
      content: [{ type: "text", text: `${items.length} source matches returned` }],
      structuredContent: { items },
      _meta: { [metadataKey]: metadata },
    },
  };
}
