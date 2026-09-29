import { drain, iteratePaged } from "../pagination.js";
import { unwrap, unwrapList, unwrapPage } from "../normalize.js";
import type { HttpCore } from "../http.js";
import type {
  CreateWebhookInput,
  CreatedWebhookEndpoint,
  IterateOptions,
  ListWebhookDeliveriesParams,
  ListWebhooksParams,
  Page,
  RotatedWebhookSecret,
  UpdateWebhookInput,
  WebhookDelivery,
  WebhookDeliveryDetail,
  WebhookDeliveryStats,
  WebhookEndpoint,
  WebhookEndpointDetail,
  WebhookEvent,
  WebhookEventCatalog,
  WebhookEventTypeInfo,
  WebhookRedelivery,
  WebhookTestResult,
} from "../types.js";
import type { Tenancy } from "./tenancy.js";

const path = (id: string) => `/webhooks/${encodeURIComponent(id)}`;

/**
 * `xg.webhooks.deliveries`: an endpoint's delivery log (kept 30 days) and
 * manual redelivery.
 */
class WebhookDeliveriesResource {
  constructor(
    private readonly http: HttpCore,
    private readonly tenancy: Tenancy,
  ) {}

  /** PAGINATED, newest first by default. `status` filters. */
  async list(
    endpointId: string,
    params: ListWebhookDeliveriesParams = {},
  ): Promise<Page<WebhookDelivery>> {
    const body = await this.http.request(
      "GET",
      `${path(endpointId)}/deliveries`,
      {
        query: {
          limit: params.limit,
          offset: params.offset,
          order: params.order,
          status: params.status,
        },
        ...(params.signal ? { signal: params.signal } : {}),
      },
      this.tenancy,
    );
    return unwrapPage<WebhookDelivery>(body, "deliveries");
  }

  iterate(
    endpointId: string,
    params: ListWebhookDeliveriesParams & IterateOptions = {},
  ): AsyncIterableIterator<WebhookDelivery> {
    return iteratePaged<WebhookDelivery>(
      (limit, offset) => this.list(endpointId, { ...params, limit, offset }),
      { ...params, defaultPageSize: params.limit ?? 100 },
    );
  }

  listAll(
    endpointId: string,
    params: ListWebhookDeliveriesParams & IterateOptions = {},
  ): Promise<WebhookDelivery[]> {
    return drain(this.iterate(endpointId, params));
  }

  /** One delivery with the first 1 KB of the response and the envelope that was sent. */
  async get(endpointId: string, deliveryId: string): Promise<WebhookDeliveryDetail> {
    const body = await this.http.request(
      "GET",
      `${path(endpointId)}/deliveries/${encodeURIComponent(deliveryId)}`,
      {},
      this.tenancy,
    );
    const row = unwrap<Record<string, unknown>>(body, "delivery");
    const event = (row["event"] as WebhookEvent | null | undefined) ?? null;
    return {
      ...(row as unknown as WebhookDelivery),
      // The detail route serializes the row without the joined type; the
      // envelope carries it.
      ...(row["eventType"] === undefined && event ? { eventType: event.type } : {}),
      responseExcerpt: (row["responseExcerpt"] as string | null | undefined) ?? null,
      event,
    };
  }

  /**
   * Owner/admin. Queues a NEW delivery of the same event (same `webhook-id`,
   * so a receiver that dedupes treats it as a repeat) with a fresh retry
   * schedule. 409 `CONFLICT` while the endpoint is disabled.
   */
  async redeliver(endpointId: string, deliveryId: string): Promise<WebhookRedelivery> {
    const body = await this.http.request(
      "POST",
      `${path(endpointId)}/deliveries/${encodeURIComponent(deliveryId)}/redeliver`,
      {},
      this.tenancy,
    );
    return {
      delivery: unwrap<WebhookDelivery>(body, "delivery"),
      enqueued: unwrap<boolean>(body, "enqueued"),
    };
  }
}

/**
 * `xg.webhooks`: the organization's webhook endpoint registry.
 *
 * Endpoints are ORGANIZATION resources: any role reads, owner/admin writes,
 * and a workspace-scoped session token is refused (`WORKSPACE_SCOPED`). An
 * endpoint receives nothing until something routes to it: a device route
 * (`xg.devices.webhooks.set()`) or a workflow `output.event` node whose
 * `webhook` field names it. Verify deliveries with `verifyWebhookSignature()`.
 */
export class WebhooksResource {
  readonly deliveries: WebhookDeliveriesResource;

  constructor(
    private readonly http: HttpCore,
    private readonly tenancy: Tenancy,
  ) {
    this.deliveries = new WebhookDeliveriesResource(http, tenancy);
  }

  /** PAGINATED, newest first by default. The secret is never included. */
  async list(params: ListWebhooksParams = {}): Promise<Page<WebhookEndpoint>> {
    const body = await this.http.request(
      "GET",
      "/webhooks",
      {
        query: {
          limit: params.limit,
          offset: params.offset,
          order: params.order,
          sort: params.sort,
        },
        ...(params.signal ? { signal: params.signal } : {}),
      },
      this.tenancy,
    );
    return unwrapPage<WebhookEndpoint>(body, "webhooks");
  }

  iterate(
    params: ListWebhooksParams & IterateOptions = {},
  ): AsyncIterableIterator<WebhookEndpoint> {
    return iteratePaged<WebhookEndpoint>(
      (limit, offset) => this.list({ ...params, limit, offset }),
      { ...params, defaultPageSize: params.limit ?? 100 },
    );
  }

  listAll(params: ListWebhooksParams & IterateOptions = {}): Promise<WebhookEndpoint[]> {
    return drain(this.iterate(params));
  }

  /**
   * Owner/admin. `secret` is returned exactly once (`whsec_` + base64): store
   * it in the same function that creates the endpoint, never log the return
   * value whole. The SDK keeps no copy. A duplicate `name` is 409 `CONFLICT`;
   * a non-https, private or localhost `url` is 400.
   */
  async create(input: CreateWebhookInput): Promise<CreatedWebhookEndpoint> {
    const body = await this.http.request(
      "POST",
      "/webhooks",
      { body: input },
      this.tenancy,
    );
    return {
      webhook: unwrap<WebhookEndpoint>(body, "webhook"),
      secret: unwrap<string>(body, "secret"),
    };
  }

  /** The endpoint plus `deliveryStats` (counts by status over the last 24 h). */
  async get(id: string): Promise<WebhookEndpointDetail> {
    const body = await this.http.request("GET", path(id), {}, this.tenancy);
    const row = unwrap<Record<string, unknown>>(body, "webhook");
    return {
      ...(row as unknown as WebhookEndpoint),
      deliveryStats: deliveryStats(row["deliveryStats"]),
    };
  }

  /** Owner/admin. Any of `name`, `url`, `description`, `enabled`. */
  async update(id: string, input: UpdateWebhookInput): Promise<WebhookEndpoint> {
    const body = await this.http.request("PATCH", path(id), { body: input }, this.tenancy);
    return unwrap<WebhookEndpoint>(body, "webhook");
  }

  /** Owner/admin. Also deletes its device routes, delivery log and secret. */
  async delete(id: string): Promise<void> {
    await this.http.request("DELETE", path(id), {}, this.tenancy);
  }

  /**
   * Owner/admin. Sends a `ping` to this endpoint only: one attempt, never
   * retried; the result shows in `deliveries.list()` within seconds. 409
   * `CONFLICT` while the endpoint is disabled.
   */
  async test(id: string): Promise<WebhookTestResult> {
    const body = await this.http.request("POST", `${path(id)}/test`, {}, this.tenancy);
    return {
      eventId: unwrap<string>(body, "eventId"),
      dispatched: unwrap<boolean>(body, "dispatched"),
    };
  }

  /**
   * Owner/admin. Returns the new `secret` exactly once. For
   * `previousSecretValidForHours` (24) deliveries carry two signatures, old
   * and new, so the receiver can switch at its own pace.
   */
  async rotateSecret(id: string): Promise<RotatedWebhookSecret> {
    const body = await this.http.request(
      "POST",
      `${path(id)}/rotate-secret`,
      {},
      this.tenancy,
    );
    return {
      webhook: unwrap<WebhookEndpoint>(body, "webhook"),
      secret: unwrap<string>(body, "secret"),
      previousSecretValidForHours: unwrap<number>(body, "previousSecretValidForHours"),
    };
  }

  /** The event catalog: every type, how it is routed, and a sample `data`. */
  async eventTypes(options: { signal?: AbortSignal } = {}): Promise<WebhookEventCatalog> {
    const body = await this.http.request(
      "GET",
      "/webhook-event-types",
      options.signal ? { signal: options.signal } : {},
      this.tenancy,
    );
    return {
      apiVersion: unwrap<string>(body, "apiVersion"),
      eventTypes: unwrapList<WebhookEventTypeInfo>(body, "eventTypes"),
    };
  }
}

/** The server only sends statuses that have rows; missing ones are 0. */
function deliveryStats(value: unknown): WebhookDeliveryStats {
  const row = (typeof value === "object" && value !== null ? value : {}) as Record<string, unknown>;
  const n = (key: string, fallback = 0) =>
    typeof row[key] === "number" ? (row[key] as number) : fallback;
  return {
    windowHours: n("windowHours", 24),
    pending: n("pending"),
    delivered: n("delivered"),
    failed: n("failed"),
    exhausted: n("exhausted"),
  };
}
