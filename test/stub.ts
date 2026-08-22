import type { FetchLike } from "../src/types.js";

export interface RecordedCall {
  url: string;
  method: string;
  headers: Record<string, string>;
  body: unknown;
}

export interface StubReply {
  status?: number;
  body?: unknown;
  /** Sent verbatim, so a test can assert on `Retry-After` handling. */
  headers?: Record<string, string>;
  /** Raw body, for testing a non-JSON 200. */
  text?: string;
  /** Throw instead of answering, for testing the network path. */
  throws?: unknown;
}

export interface Stub {
  fetch: FetchLike;
  calls: RecordedCall[];
}

/** Answers each call with the next reply, repeating the last one forever. */
export function stubFetch(...replies: StubReply[]): Stub {
  const calls: RecordedCall[] = [];
  const fetch: FetchLike = async (url, init) => {
    // Real `fetch` rejects immediately on an already-aborted signal. A stub
    // that only listens for a future `abort` event would hang instead, which is
    // a property of the stub rather than of the code under test.
    if (init?.signal?.aborted) {
      throw Object.assign(new Error("aborted"), { name: "AbortError" });
    }
    const reply = replies[Math.min(calls.length, replies.length - 1)] ?? {};
    calls.push({
      url,
      method: init?.method ?? "GET",
      headers: normalizeHeaders(init?.headers),
      body: init?.body === undefined ? undefined : JSON.parse(String(init.body)),
    });
    if (reply.throws !== undefined) throw reply.throws;
    const status = reply.status ?? 200;
    const text =
      reply.text !== undefined
        ? reply.text
        : reply.body === undefined
          ? ""
          : JSON.stringify(reply.body);
    return new Response(status === 204 ? null : text, {
      status,
      headers: {
        "content-type": "application/json",
        ...(reply.headers ?? {}),
      },
    });
  };
  return { fetch, calls };
}

function normalizeHeaders(headers: HeadersInit | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  if (!headers) return out;
  for (const [key, value] of Object.entries(headers as Record<string, string>)) {
    out[key.toLowerCase()] = value;
  }
  return out;
}

/** A device row as the API serializes it, deprecated duplicates included. */
export function deviceRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "dev-1",
    workspaceId: "ws-1",
    deviceModelId: "dm-1",
    serial: "XG-0042",
    name: "Excavator 12",
    agentVersion: "b30d3f4",
    firmwareVersion: "b30d3f4",
    status: "online",
    lastSeenAt: "2026-08-22T14:00:00.000Z",
    config: { recording: { telemetry: { enabled: true }, video: { enabled: false } } },
    configRev: 4,
    configUpdatedAt: "2026-08-22T13:00:00.000Z",
    uiPrefs: { activeStreamsViewType: "card" },
    reportedConfig: null,
    reportedAt: null,
    gnssAntBias: false,
    activeStreamsViewType: "card",
    recordingConfig: { telemetry: { enabled: true } },
    createdAt: "2026-08-01T00:00:00.000Z",
    updatedAt: "2026-08-22T13:00:00.000Z",
    ...overrides,
  };
}
