import { Client, StreamableHTTPClientTransport } from "@modelcontextprotocol/client";
import { createMcpHandler, McpServer } from "@modelcontextprotocol/server";

export const NEGATIVE_EVIDENCE_META_KEY = "org.example.phase2/negative-evidence";
export const PINNED_MCP_PROTOCOL_VERSION = "2026-07-28";

export interface RawHttpCapture {
  request: {
    method: string;
    url: string;
    headers: Record<string, string>;
    body: string;
  };
  response: {
    status: number;
    headers: Record<string, string>;
    contentType: string;
    body: string;
  };
}

export interface OfficialMcpRoundTrip {
  protocolEra: "modern";
  negotiatedProtocolVersion: "2026-07-28";
  publicResult: Awaited<ReturnType<Client["callTool"]>>;
  rawHttp: RawHttpCapture[];
}

export function parseRawMcpMessages(capture: RawHttpCapture): unknown[] {
  const body = capture.response.body;
  if (capture.response.contentType.includes("text/event-stream")) {
    return body.split(/\r?\n\r?\n/).flatMap((event) => {
      const data = event.split(/\r?\n/)
        .filter((line) => line.startsWith("data:"))
        .map((line) => line.slice(5).trim())
        .join("\n");
      if (data.length === 0) return [];
      return [JSON.parse(data) as unknown];
    });
  }
  if (capture.response.contentType.includes("application/json")) {
    return [JSON.parse(body) as unknown];
  }
  throw new Error(`Unsupported MCP response content type: ${capture.response.contentType}`);
}

/** Runs the official 2.0.0 client and server through an injected, capture-aware fetch. */
export async function runOfficialMcpRoundTrip(
  experimentalMetadata?: unknown,
): Promise<OfficialMcpRoundTrip> {
  const handler = createMcpHandler(() => {
    const server = new McpServer({ name: "phase-2-negative-evidence-server", version: "0.2.0" });
    server.registerTool(
      "lookup-zero",
      { description: "Return the already-captured empty source observation." },
      async () => ({
        content: [{ type: "text" as const, text: "0 source matches returned" }],
        structuredContent: { items: [] },
        ...(experimentalMetadata === undefined
          ? {}
          : { _meta: { [NEGATIVE_EVIDENCE_META_KEY]: experimentalMetadata } }),
      }),
    );
    return server;
  }, { legacy: "reject", responseMode: "auto" });

  const rawHttp: RawHttpCapture[] = [];
  const injectedFetch: typeof fetch = async (input, init) => {
    const request = new Request(input, init);
    const requestClone = request.clone();
    const response = await handler.fetch(request);
    const responseClone = response.clone();
    rawHttp.push({
      request: {
        method: requestClone.method,
        url: requestClone.url,
        headers: Object.fromEntries(requestClone.headers.entries()),
        body: await requestClone.text(),
      },
      response: {
        status: responseClone.status,
        headers: Object.fromEntries(responseClone.headers.entries()),
        contentType: responseClone.headers.get("content-type") ?? "",
        body: await responseClone.text(),
      },
    });
    return response;
  };

  const client = new Client(
    { name: "phase-2-negative-evidence-client", version: "0.2.0" },
    { versionNegotiation: { mode: { pin: PINNED_MCP_PROTOCOL_VERSION } } },
  );
  try {
    const transport = new StreamableHTTPClientTransport(
      new URL("https://phase2.example.invalid/mcp"),
      { fetch: injectedFetch },
    );
    await client.connect(transport);
    const protocolEra = client.getProtocolEra();
    const negotiatedProtocolVersion = client.getNegotiatedProtocolVersion();
    if (protocolEra !== "modern") throw new Error(`Expected modern MCP era, received ${String(protocolEra)}`);
    if (negotiatedProtocolVersion !== PINNED_MCP_PROTOCOL_VERSION) {
      throw new Error(`Expected pinned MCP version, received ${String(negotiatedProtocolVersion)}`);
    }
    const publicResult = await client.callTool({ name: "lookup-zero", arguments: {} });
    return {
      protocolEra,
      negotiatedProtocolVersion,
      publicResult,
      rawHttp,
    };
  } finally {
    await client.close();
    await handler.close();
  }
}
