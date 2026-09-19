import { drain, iterateFixed } from "../pagination.js";
import { unwrap, unwrapList } from "../normalize.js";
import type { HttpCore } from "../http.js";
import type {
  AcceptedTransferOffer,
  CreatedTransferOffer,
  IterateOptions,
  ListTransferOffersParams,
  TransferOffer,
  TransferOfferPreview,
} from "../types.js";
import type { Tenancy } from "./tenancy.js";
import { normalizeDevice } from "../normalize.js";

/**
 * Handing a device to an organization you have no membership in.
 *
 * `POST /devices/{id}/transfer` needs the caller authorized in BOTH tenancies,
 * which one request cannot be unless the same user happens to administer both
 * organizations. The general case is a handshake instead: the source mints an
 * **offer**, a long random code with a seven-day expiry; the destination
 * receives that code out of band and accepts or declines it holding nothing
 * else.
 *
 * ## There is no inbox of incoming offers, by design
 *
 * An offer names no destination — not knowing the destination's organization id
 * is the entire reason the code exists — so a **pending offer is discoverable
 * only by its code**. {@link list} returns what YOUR organization sent, plus
 * what it has already accepted, tagged by `direction`. It will never show you an
 * offer somebody else made until you have accepted it.
 *
 * The destination flow is therefore: receive a code out of band → {@link get} to
 * preview it → {@link accept} or {@link decline}. Build a "paste a code" entry
 * point, not a notification list.
 *
 * ```ts
 * // source organization
 * const { offer, willDetachWorkflowAttachments } =
 *   await source.transferOffers.create(deviceId)
 * sendToCustomer(offer.code)          // email, chat, a purchase order
 *
 * // destination organization, some days later
 * const preview = await dest.transferOffers.get(code)
 * const { device } = await dest.transferOffers.accept(code, { workspaceId })
 * ```
 *
 * Every offer route is keyed by `{code}`, INCLUDING cancel — there is no
 * cancel-by-id.
 */
export class TransferOffersResource {
  constructor(
    private readonly http: HttpCore,
    private readonly tenancy: Tenancy,
  ) {}

  /**
   * Mint (or reuse) the offer code for a device. Owner/admin in the
   * organization that owns the device today.
   *
   * **Idempotent per device.** A device may have at most one `pending` offer —
   * a partial unique index enforces it — so reopening a dialog hands back the
   * same code rather than burning a second claimable one. The API says which
   * happened with its status, 201 for a fresh mint and 200 for a reuse, and the
   * two bodies are byte-identical; `reused` on the result is that distinction,
   * and it is the reason this method does not simply collapse the 2xx.
   *
   * `willDetachWorkflowAttachments` names the workflow templates the SOURCE
   * loses if a different organization accepts. It is surfaced here because the
   * source is not present at the accept — this is its last chance to reconsider.
   */
  async create(deviceId: string): Promise<CreatedTransferOffer> {
    let status = 201;
    const body = await this.http.request(
      "POST",
      `/devices/${encodeURIComponent(deviceId)}/transfer-offers`,
      { body: {}, onStatus: (s) => (status = s) },
      this.tenancy,
    );
    return {
      offer: unwrap<TransferOffer>(body, "offer"),
      willDetachWorkflowAttachments: unwrapList<string>(
        body,
        "willDetachWorkflowAttachments",
      ),
      reused: status === 200,
    };
  }

  /**
   * Every offer this organization SENT, plus every offer it has ACCEPTED,
   * newest first. Not an inbox: see the class doc.
   *
   * The endpoint returns its whole collection (capped at 200 rows server-side)
   * with no `page` block, so `list()` is already complete and `iterate()` /
   * `listAll()` exist only so code written against them keeps working if the
   * platform paginates it later.
   */
  async list(params: ListTransferOffersParams = {}): Promise<TransferOffer[]> {
    const body = await this.http.request(
      "GET",
      "/transfer-offers",
      {
        query: { status: params.status },
        ...(params.signal ? { signal: params.signal } : {}),
      },
      this.tenancy,
    );
    return unwrapList<TransferOffer>(body, "offers");
  }

  iterate(
    params: ListTransferOffersParams & IterateOptions = {},
  ): AsyncIterableIterator<TransferOffer> {
    return iterateFixed<TransferOffer>(() => this.list(params), params);
  }

  listAll(
    params: ListTransferOffersParams & IterateOptions = {},
  ): Promise<TransferOffer[]> {
    return drain(this.iterate(params));
  }

  /**
   * Every offer ever made for one device, resolved ones included — the device's
   * handover history. Owner/admin in the organization that owns it today.
   */
  async listForDevice(deviceId: string): Promise<TransferOffer[]> {
    const body = await this.http.request(
      "GET",
      `/devices/${encodeURIComponent(deviceId)}/transfer-offers`,
      {},
      this.tenancy,
    );
    return unwrapList<TransferOffer>(body, "offers");
  }

  /**
   * Preview a code you were sent. Returns the RECIPIENT's view, which is a
   * deliberately thin allowlist — device name, device model, source organization
   * name — and **not** a {@link TransferOffer}. No device id, no serial, no
   * tenancy ids, no configuration, no telemetry: whoever holds the code is by
   * definition not yet entitled to the device.
   *
   * Takes no role: refusing a `viewer` who was sent a code would only stop them
   * telling an admin what arrived. Reading also lazily expires a stale pending
   * code, so `status` here is current.
   *
   * A code that does not exist, and a code belonging to somebody else, both
   * answer `NOT_FOUND`.
   */
  async get(code: string): Promise<TransferOfferPreview> {
    const body = await this.http.request(
      "GET",
      `/transfer-offers/${encodeURIComponent(code)}`,
      {},
      this.tenancy,
    );
    return unwrap<TransferOfferPreview>(body, "offer");
  }

  /**
   * Take the device. Owner/admin in the DESTINATION organization;
   * `workspaceId` must be one of yours.
   *
   * Everything {@link DevicesResource.transfer} says applies — the device does
   * not have to be online, all of its history and footage come with it, and
   * `transfer.adoption` is the only honest signal of whether the device itself
   * has caught up.
   *
   * Accepting your own organization's offer is a 400: use
   * `devices.transfer()`. A second accept is a 409 refused by the database, not
   * by a check-then-act, so two simultaneous accepts cannot both win. If the
   * transfer itself fails the offer is reopened and the code can be retried.
   */
  async accept(
    code: string,
    input: { workspaceId: string },
  ): Promise<AcceptedTransferOffer> {
    const body = await this.http.request(
      "POST",
      `/transfer-offers/${encodeURIComponent(code)}/accept`,
      { body: { workspaceId: input.workspaceId } },
      this.tenancy,
    );
    return {
      device: normalizeDevice(unwrap(body, "device")),
      transfer: unwrap(body, "transfer"),
      offer: unwrap<TransferOffer>(body, "offer"),
    };
  }

  /**
   * Refuse a code you were sent. The SOURCE sees it: the row it created reads
   * `declined` with `resolvedAt` set, rather than silently expiring.
   */
  async decline(code: string): Promise<TransferOffer> {
    const body = await this.http.request(
      "POST",
      `/transfer-offers/${encodeURIComponent(code)}/decline`,
      {},
      this.tenancy,
    );
    return unwrap<TransferOffer>(body, "offer");
  }

  /**
   * Withdraw an offer you made. **By CODE, not by id** — every offer route uses
   * the code, because two routes on one path template differing only in the
   * parameter's name is a conflict API Gateway has no good answer for.
   *
   * Only the source organization may cancel; another organization's code reads
   * as `NOT_FOUND`. An already-resolved offer is a 409.
   */
  async cancel(code: string): Promise<void> {
    await this.http.request(
      "DELETE",
      `/transfer-offers/${encodeURIComponent(code)}`,
      {},
      this.tenancy,
    );
  }
}
