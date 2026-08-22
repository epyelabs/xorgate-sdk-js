import type { HttpCore } from "../http.js";
import type { CreateSessionTokenInput, SessionToken } from "../types.js";
import type { Tenancy } from "./tenancy.js";

export class AuthResource {
  constructor(
    private readonly http: HttpCore,
    private readonly tenancy: Tenancy,
  ) {}

  /**
   * Exchange this client's API key for a short-lived token a browser or mobile
   * app may hold. **API-key mode only**: a `{ getToken }` client gets
   * `401 API_KEY_REQUIRED`, because a signed-in session already authenticates
   * the API directly and needs no exchange. A session token cannot mint another.
   *
   * Call it from YOUR endpoint, after YOUR authorization decision, and return
   * the result to your client:
   *
   * ```ts
   * app.post("/api/xorgate-token", requireMyOwnLogin, async (req, res) => {
   *   res.json(
   *     await xg.auth.createSessionToken({
   *       workspaceId: await myDb.workspaceForUser(req.user.id),
   *       ttlSeconds: 900,
   *     }),
   *   )
   * })
   * ```
   *
   * xorgate never learns who your user is. You authorize the person; xorgate
   * authorizes the key.
   *
   * The response is flat rather than enveloped, matching the wire: a token is a
   * credential rather than a resource, and there is nothing to read back.
   */
  async createSessionToken(
    input: CreateSessionTokenInput = {},
  ): Promise<SessionToken> {
    return await this.http.request<SessionToken>(
      "POST",
      "/auth/session-tokens",
      { body: input },
      this.tenancy,
    );
  }
}
