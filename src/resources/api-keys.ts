import { drain, iteratePaged } from "../pagination.js";
import { unwrap, unwrapPage } from "../normalize.js";
import type { HttpCore } from "../http.js";
import type {
  ApiKey,
  CreateApiKeyInput,
  CreatedApiKey,
  IterateOptions,
  ListApiKeysParams,
  Page,
} from "../types.js";
import type { Tenancy } from "./tenancy.js";

/**
 * The one resource where the SDK's envelope normalization is visible: the wire
 * says `api_keys` and `{api_key, plaintext_key}`, mirroring the Postgres table
 * name. Everything INSIDE those envelopes is already camelCase.
 */
export class ApiKeysResource {
  constructor(
    private readonly http: HttpCore,
    private readonly tenancy: Tenancy,
  ) {}

  private async page(params: ListApiKeysParams = {}): Promise<Page<ApiKey>> {
    const body = await this.http.request(
      "GET",
      "/api-keys",
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
    return unwrapPage<ApiKey>(body, ["api_keys", "apiKeys"]);
  }

  /**
   * One request: up to `limit` (default 100) keys, revoked and expired ones
   * included; `listAll()` is the guaranteed-complete form.
   */
  async list(params: ListApiKeysParams = {}): Promise<ApiKey[]> {
    return (await this.page(params)).items;
  }

  listAll(params: ListApiKeysParams & IterateOptions = {}): Promise<ApiKey[]> {
    return drain(this.iterate(params));
  }

  iterate(
    params: ListApiKeysParams & IterateOptions = {},
  ): AsyncIterableIterator<ApiKey> {
    return iteratePaged<ApiKey>(
      (limit, offset) => this.page({ ...params, limit, offset }),
      { ...params, defaultPageSize: params.limit ?? 100 },
    );
  }

  /**
   * Owner or admin. `plaintextKey` is shown exactly once: only its SHA-256 is
   * stored, so write it to your secret store in the same function that creates
   * it, and never log the return value whole.
   */
  async create(input: CreateApiKeyInput): Promise<CreatedApiKey> {
    const body = await this.http.request(
      "POST",
      "/api-keys",
      { body: input },
      this.tenancy,
    );
    return {
      apiKey: unwrap<ApiKey>(body, "api_key", "apiKey"),
      plaintextKey: unwrap<string>(body, "plaintext_key", "plaintextKey"),
    };
  }

  /**
   * A hard delete, not a revocation: `revokedAt` is never set by this call.
   *
   * It also destroys every session token minted from this key, immediately.
   * That cascade is the only way to kill a live session token, so it is the
   * emergency stop for a leaked client credential; mint the replacement key
   * first if the integration has to keep working.
   */
  async delete(id: string): Promise<void> {
    await this.http.request(
      "DELETE",
      `/api-keys/${encodeURIComponent(id)}`,
      {},
      this.tenancy,
    );
  }
}
