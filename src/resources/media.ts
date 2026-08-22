import { drain, iteratePaged } from "../pagination.js";
import { isoOrUndefined, unwrap, unwrapPage } from "../normalize.js";
import { XorgateError } from "../errors.js";
import type { HttpCore } from "../http.js";
import type {
  IterateOptions,
  ListRunsParams,
  ListSessionsParams,
  MediaSession,
  Page,
  RecordingRun,
  ReplayManifest,
  ReplayManifestParams,
  SegmentPlayback,
  SessionSegments,
} from "../types.js";
import type { Tenancy } from "./tenancy.js";

class SessionsResource {
  constructor(
    private readonly http: HttpCore,
    private readonly tenancy: Tenancy,
  ) {}

  /**
   * Paginated. Listing has a SIDE EFFECT: it closes stale sessions as it goes,
   * which is why a session can flip from `open` to `closed` between two reads
   * with nothing else having happened.
   */
  async list(
    deviceId: string,
    params: ListSessionsParams = {},
  ): Promise<Page<MediaSession>> {
    const body = await this.http.request(
      "GET",
      `/devices/${encodeURIComponent(deviceId)}/sessions`,
      { query: sessionQuery(params), ...(params.signal ? { signal: params.signal } : {}) },
      this.tenancy,
    );
    return unwrapPage<MediaSession>(body, "sessions");
  }

  iterate(
    deviceId: string,
    params: ListSessionsParams & IterateOptions = {},
  ): AsyncIterableIterator<MediaSession> {
    return iteratePaged<MediaSession>(
      (limit, offset) => this.list(deviceId, { ...params, limit, offset }),
      { ...params, defaultPageSize: params.limit ?? 100 },
    );
  }

  listAll(
    deviceId: string,
    params: ListSessionsParams & IterateOptions = {},
  ): Promise<MediaSession[]> {
    return drain(this.iterate(deviceId, params));
  }

  /**
   * The same endpoint under `group=runs`, paginating RUNS rather than sessions.
   * Upstream requires `sort=startedAt` there, so it is a separate method rather
   * than a flag.
   */
  async listRuns(
    deviceId: string,
    params: ListRunsParams = {},
  ): Promise<Page<RecordingRun>> {
    const body = await this.http.request(
      "GET",
      `/devices/${encodeURIComponent(deviceId)}/sessions`,
      {
        query: { ...sessionQuery(params), group: "runs", sort: "startedAt" },
        ...(params.signal ? { signal: params.signal } : {}),
      },
      this.tenancy,
    );
    return unwrapPage<RecordingRun>(body, "runs");
  }

  iterateRuns(
    deviceId: string,
    params: ListRunsParams & IterateOptions = {},
  ): AsyncIterableIterator<RecordingRun> {
    return iteratePaged<RecordingRun>(
      (limit, offset) => this.listRuns(deviceId, { ...params, limit, offset }),
      { ...params, defaultPageSize: params.limit ?? 100 },
    );
  }

  /** Owner/admin. Deletes the objects too; not re-creatable. */
  async delete(deviceId: string, sessionId: string): Promise<void> {
    await this.http.request(
      "DELETE",
      `/devices/${encodeURIComponent(deviceId)}/sessions/${encodeURIComponent(sessionId)}`,
      {},
      this.tenancy,
    );
  }
}

export class MediaResource {
  readonly sessions: SessionsResource;

  constructor(
    private readonly http: HttpCore,
    private readonly tenancy: Tenancy,
  ) {
    this.sessions = new SessionsResource(http, tenancy);
  }

  /**
   * The whole ordered index in one call, plus the session it belongs to.
   * Deliberately unpaginated upstream, so there is no iterator.
   */
  async segments(deviceId: string, sessionId: string): Promise<SessionSegments> {
    const body = await this.http.request(
      "GET",
      `/devices/${encodeURIComponent(deviceId)}/sessions/${encodeURIComponent(sessionId)}/segments`,
      {},
      this.tenancy,
    );
    return {
      session: unwrap(body, "session"),
      segments: unwrap(body, "segments"),
    };
  }

  /** One segment at a time. For a span, use `replayManifest()` instead. */
  async segmentPlaybackUrl(
    deviceId: string,
    sessionId: string,
    seq: number,
  ): Promise<SegmentPlayback> {
    return await this.http.request<SegmentPlayback>(
      "GET",
      `/devices/${encodeURIComponent(deviceId)}/sessions/${encodeURIComponent(sessionId)}/segments/${seq}/playback`,
      {},
      this.tenancy,
    );
  }

  /**
   * One response feeds a whole replay: per-session timelines with effective
   * durations and gaps computed server-side, plus a presigned URL per segment.
   *
   * Address it either by session or by range, never both. Caps, each a 400
   * telling you to narrow the request: 600 segments total, and in range mode 10
   * sessions and 24 hours.
   *
   * Every timestamp in the result is epoch MILLISECONDS, unlike the rest of the
   * API. The SDK does not convert them, because converting would break the
   * arithmetic every replay player does.
   */
  async replayManifest(
    deviceId: string,
    params: ReplayManifestParams,
  ): Promise<ReplayManifest> {
    const query = replayQuery(params);
    const body = await this.http.request(
      "GET",
      `/devices/${encodeURIComponent(deviceId)}/replay-manifest`,
      { query },
      this.tenancy,
    );
    return unwrap<ReplayManifest>(body, "replay");
  }
}

function sessionQuery(
  params: ListSessionsParams | ListRunsParams,
): Record<string, string | number | boolean | undefined> {
  const sort = "sort" in params ? params.sort : undefined;
  return {
    limit: params.limit,
    offset: params.offset,
    order: params.order,
    sort,
    status: params.status,
    streamKey: params.streamKey,
    from: isoOrUndefined(params.from),
    to: isoOrUndefined(params.to),
  };
}

function replayQuery(
  params: ReplayManifestParams,
): Record<string, string | undefined> {
  if (params.sessionId !== undefined) return { sessionId: params.sessionId };
  if (params.from === undefined || params.to === undefined) {
    throw new XorgateError({
      code: "INVALID_INPUT",
      message:
        "replayManifest() takes either { sessionId } or { from, to }. " +
        "Neither was supplied.",
    });
  }
  return {
    from: isoOrUndefined(params.from),
    to: isoOrUndefined(params.to),
    streamKey: params.streamKey,
  };
}
