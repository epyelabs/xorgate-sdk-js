import { iterateFixed } from "../pagination.js";
import { unwrap, unwrapList } from "../normalize.js";
import type { HttpCore } from "../http.js";
import type {
  AddMembershipInput,
  AddMembershipResult,
  IterateOptions,
  MembershipWithUser,
} from "../types.js";
import type { Tenancy } from "./tenancy.js";

export class MembershipsResource {
  constructor(
    private readonly http: HttpCore,
    private readonly tenancy: Tenancy,
  ) {}

  /** The roster for the active organization, each row enriched with its user. */
  async list(): Promise<MembershipWithUser[]> {
    const body = await this.http.request("GET", "/memberships", {}, this.tenancy);
    return unwrapList<MembershipWithUser>(body, "memberships");
  }

  listAll(): Promise<MembershipWithUser[]> {
    return this.list();
  }

  iterate(options?: IterateOptions): AsyncIterableIterator<MembershipWithUser> {
    return iterateFixed(() => this.list(), options);
  }

  /** By `userId` or by `email`. Owner or admin. */
  async add(input: AddMembershipInput): Promise<AddMembershipResult> {
    const body = await this.http.request(
      "POST",
      "/memberships",
      { body: input },
      this.tenancy,
    );
    return {
      membership: unwrap(body, "membership"),
      invited: unwrapInvited(body),
    };
  }

  /** Removing the last owner is a 403. There is no role-update endpoint yet. */
  async remove(membershipId: string): Promise<void> {
    await this.http.request(
      "DELETE",
      `/memberships/${encodeURIComponent(membershipId)}`,
      {},
      this.tenancy,
    );
  }
}

function unwrapInvited(body: unknown): boolean {
  const row = body as { invited?: unknown };
  return row?.invited === true;
}
