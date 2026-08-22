import { iterateFixed } from "../pagination.js";
import { unwrap, unwrapList } from "../normalize.js";
import type { HttpCore } from "../http.js";
import type {
  ApiKey,
  CreateApiKeyInput,
  CreatedApiKey,
  IterateOptions,
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

  async list(): Promise<ApiKey[]> {
    const body = await this.http.request("GET", "/api-keys", {}, this.tenancy);
    return unwrapList<ApiKey>(body, "api_keys", "apiKeys");
  }

  listAll(): Promise<ApiKey[]> {
    return this.list();
  }

  iterate(options?: IterateOptions): AsyncIterableIterator<ApiKey> {
    return iterateFixed(() => this.list(), options);
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
