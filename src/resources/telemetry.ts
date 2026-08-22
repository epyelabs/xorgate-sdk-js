import { iteratePaged } from "../pagination.js";
import { commaList, isoOrUndefined, unwrap, unwrapPage, normalizePageMeta } from "../normalize.js";
import type { HttpCore } from "../http.js";
import type {
  IterateOptions,
  LatestByMetric,
  LatestReading,
  Page,
  TelemetryColumnSource,
  TelemetryHistory,
  TelemetryHistoryParams,
  TelemetryReading,
  TelemetryReadingsParams,
  TelemetryRecentParams,
  TelemetryTableColumn,
  TelemetryTablePage,
  TelemetryTableRow,
} from "../types.js";
import type { Tenancy } from "./tenancy.js";

export class TelemetryResource {
  constructor(
    private readonly http: HttpCore,
    private readonly tenancy: Tenancy,
  ) {}

  /**
   * Raw rows up to 5,000, or bucket averages up to 10,000 with `interval`.
   *
   * Does not paginate. `truncated` is the ONLY signal that data was left
   * behind, so check it on every call: a truncated result is a complete-looking
   * array, and a chart built from one looks fine and is wrong.
   */
  async history(
    deviceId: string,
    params: TelemetryHistoryParams,
  ): Promise<TelemetryHistory> {
    return await this.http.request<TelemetryHistory>(
      "GET",
      `/devices/${encodeURIComponent(deviceId)}/telemetry`,
      {
        query: {
          from: isoOrUndefined(params.from),
          to: isoOrUndefined(params.to),
          metric: commaList(params.metric),
          interval: params.interval,
        },
        ...(params.signal ? { signal: params.signal } : {}),
      },
      this.tenancy,
    );
  }

  /**
   * One row per metric, last-writer-wins. STALE rather than empty on an offline
   * device: it returns the last reading ingested forever, so check `ts` against
   * the clock before showing a value as current. An empty array means the
   * device has never reported telemetry at all.
   */
  async latest(deviceId: string): Promise<LatestReading[]> {
    const body = await this.http.request(
      "GET",
      `/devices/${encodeURIComponent(deviceId)}/telemetry/latest`,
      {},
      this.tenancy,
    );
    return unwrap<LatestReading[]>(body, "latest") ?? [];
  }

  /** The same data keyed by metric: the shape `@xorgate/react` also emits. */
  async latestByMetric(deviceId: string): Promise<LatestByMetric> {
    const rows = await this.latest(deviceId);
    const out = {} as LatestByMetric;
    for (const row of rows) out[row.metric] = row;
    return out;
  }

  /** The newest N rows with no time window. The right seed for a chart. */
  async recent(
    deviceId: string,
    params: TelemetryRecentParams = {},
  ): Promise<TelemetryHistory> {
    return await this.http.request<TelemetryHistory>(
      "GET",
      `/devices/${encodeURIComponent(deviceId)}/telemetry/recent`,
      {
        query: { metric: commaList(params.metric), limit: params.limit },
        ...(params.signal ? { signal: params.signal } : {}),
      },
      this.tenancy,
    );
  }

  /** PAGINATED, table shape: `columns` plus positional `rows`. */
  async readings(
    deviceId: string,
    params: TelemetryReadingsParams = {},
  ): Promise<TelemetryTablePage> {
    const body = await this.http.request<{
      columns?: TelemetryTableColumn[];
      rows?: TelemetryTableRow[];
      columnSource?: TelemetryColumnSource;
      page?: unknown;
    }>(
      "GET",
      `/devices/${encodeURIComponent(deviceId)}/telemetry/readings`,
      {
        query: { ...readingsQuery(params), shape: "table" },
        ...(params.signal ? { signal: params.signal } : {}),
      },
      this.tenancy,
    );
    const rows = body.rows ?? [];
    return {
      columns: body.columns ?? [],
      rows,
      columnSource: body.columnSource ?? "data",
      page: normalizePageMeta(body.page, rows.length),
    };
  }

  /** PAGINATED, flat shape: the same rows as `history()`. */
  async readingsFlat(
    deviceId: string,
    params: TelemetryReadingsParams = {},
  ): Promise<Page<TelemetryReading>> {
    const body = await this.http.request(
      "GET",
      `/devices/${encodeURIComponent(deviceId)}/telemetry/readings`,
      {
        query: { ...readingsQuery(params), shape: "flat" },
        ...(params.signal ? { signal: params.signal } : {}),
      },
      this.tenancy,
    );
    return unwrapPage<TelemetryReading>(body, "readings");
  }

  /**
   * Drains `readingsFlat()`. `page.total` is capped at 10,000 distinct
   * timestamps, so this stops at the cap without throwing and without warning:
   * it yields items and never sees the page block. Pass `onPage` to notice.
   */
  iterateReadings(
    deviceId: string,
    params: TelemetryReadingsParams & IterateOptions = {},
  ): AsyncIterableIterator<TelemetryReading> {
    return iteratePaged<TelemetryReading>(
      (limit, offset) => this.readingsFlat(deviceId, { ...params, limit, offset }),
      { ...params, defaultPageSize: params.limit ?? 100 },
    );
  }
}

function readingsQuery(
  params: TelemetryReadingsParams,
): Record<string, string | number | undefined> {
  return {
    limit: params.limit,
    offset: params.offset,
    order: params.order,
    from: isoOrUndefined(params.from),
    to: isoOrUndefined(params.to),
    metric: commaList(params.metric),
  };
}
