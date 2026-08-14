import {
  Agent,
  RunToolCallOutputItem,
  mcpToFunctionTool,
  Runner,
  type MCPServer,
} from "@openai/agents";
import {
  ScriptedModel,
  assistantMessage,
  functionCall,
} from "@openai/agents/testing";
import {
  decodeAlgoliaRealSourceEvidence,
} from "../vendor/nrw/src/real-source-evidence.ts";
import type {
  ReceiverValidatedAlgoliaRealSourceEvidence,
} from "../vendor/nrw/src/types.ts";
import {
  NRW_PUBLIC_META_KEY,
  PERSUASIVE_TOOL_TEXT,
  RECORDED_CASE,
} from "./constants.ts";
import {
  consumeVerifiedNoMatch,
  type ConsumerActionInputs,
} from "./gate.ts";

export interface ConsumerCaseOptions {
  metadata?: unknown;
  action?: Partial<ConsumerActionInputs>;
  toolText?: string;
}

export interface ConsumerCaseResult {
  customData: unknown;
  decoderAccepted: boolean;
  gateVerdict: "PASS" | "BLOCK";
  effectCount: number;
  modelSecondRequestJson: string;
  historyJson: string;
  stateJson: string;
  modelSawToolText: boolean;
  modelSawEvidenceMetadata: boolean;
}

function findToolOutput(items: readonly unknown[]): RunToolCallOutputItem {
  const output = items.find((item) => item instanceof RunToolCallOutputItem);
  if (!(output instanceof RunToolCallOutputItem)) {
    throw new Error("Agents SDK run did not emit RunToolCallOutputItem.");
  }
  return output;
}

function makeServer(metadata: unknown, toolText: string): MCPServer {
  return {
    name: "nrw-recorded-evidence-consumer",
    cacheToolsList: false,
    customDataExtractor: (context) => {
      // Extraction is transport only. Treat the value as untrusted `unknown` after the SDK boundary.
      return context.resultMeta?.[NRW_PUBLIC_META_KEY] as any;
    },
    connect: async () => {},
    close: async () => {},
    listTools: async () => [],
    callTool: async () => {
      throw new Error("callTool fallback must not be used when metadata extraction is enabled.");
    },
    callToolResult: async () => ({
      content: [{ type: "text", text: toolText }],
      _meta: metadata === undefined ? {} : { [NRW_PUBLIC_META_KEY]: metadata },
      structuredContent: { items: [] },
      isError: false,
    }),
    invalidateToolsCache: async () => {},
  };
}

function makeTool(server: MCPServer) {
  return mcpToFunctionTool(
    {
      name: "search_recorded_source",
      description: "Returns the recorded bounded-search result.",
      inputSchema: {
        type: "object",
        properties: {},
        required: [],
        additionalProperties: false,
      },
    } satisfies Parameters<typeof mcpToFunctionTool>[0],
    server,
    false,
  );
}

export async function runConsumerCase(options: ConsumerCaseOptions): Promise<ConsumerCaseResult> {
  const toolText = options.toolText ?? PERSUASIVE_TOOL_TEXT;
  const server = makeServer(options.metadata, toolText);
  const tool = makeTool(server);

  const model = new ScriptedModel([
    [
      functionCall(tool.name, {}, {
        callId: "call_nrw_consumer",
        id: "call_nrw_consumer",
      }),
    ],
    [assistantMessage("done")],
  ]);

  const agent = new Agent({
    name: "NRW Consumer Witness",
    instructions: "Call the recorded search tool once, then finish.",
    model,
    tools: [tool],
    toolUseBehavior: "run_llm_again",
  });

  const runResult = await new Runner({ tracingDisabled: true }).run(
    agent,
    "check the recorded bounded query",
  );

  const outputItem = findToolOutput(runResult.newItems);
  const customData: unknown = outputItem.customData;
  const actionInputs: ConsumerActionInputs = {
    ...RECORDED_CASE,
    ...options.action,
  };

  const decoded: ReceiverValidatedAlgoliaRealSourceEvidence | undefined =
    decodeAlgoliaRealSourceEvidence(customData, {
      applicationId: actionInputs.applicationId,
      credentialFingerprint: actionInputs.credentialFingerprint,
    });

  let effectCount = 0;
  const gate = consumeVerifiedNoMatch({
    ...actionInputs,
    evidence: decoded,
    effect: () => {
      effectCount += 1;
    },
  });

  const secondRequest = model.calls.at(1)?.request;
  if (secondRequest === undefined) {
    throw new Error("Scripted model did not receive the post-tool request.");
  }
  const modelSecondRequestJson = JSON.stringify(secondRequest.input);
  const historyJson = JSON.stringify(runResult.history);
  const stateJson = runResult.state.toString();

  return {
    customData,
    decoderAccepted: decoded !== undefined,
    gateVerdict: gate.verdict,
    effectCount,
    modelSecondRequestJson,
    historyJson,
    stateJson,
    modelSawToolText: modelSecondRequestJson.includes(toolText),
    modelSawEvidenceMetadata:
      modelSecondRequestJson.includes(NRW_PUBLIC_META_KEY)
      || modelSecondRequestJson.includes("WARRANTED_ZERO")
      || modelSecondRequestJson.includes("BOUND_NEGATIVE_EVIDENCE")
      || modelSecondRequestJson.includes("customData")
      || historyJson.includes(NRW_PUBLIC_META_KEY)
      || historyJson.includes("WARRANTED_ZERO")
      || historyJson.includes("BOUND_NEGATIVE_EVIDENCE")
      || historyJson.includes("customData"),
  };
}
