import { drain, iteratePaged } from "../pagination.js";
import { unwrap, unwrapPage } from "../normalize.js";
import type { HttpCore } from "../http.js";
import type {
  AddMembershipInput,
  AddMembershipResult,
  IterateOptions,
  ListMembershipsParams,
  Membership,
  MembershipRole,
  MembershipWithUser,
  Page,
} from "../types.js";
import type { Tenancy } from "./tenancy.js";

export class MembershipsResource {
  constructor(
    private readonly http: HttpCore,
    private readonly tenancy: Tenancy,
  ) {}

  private async page(
    params: ListMembershipsParams = {},
  ): Promise<Page<MembershipWithUser>> {
    const body = await this.http.request(
      "GET",
      "/memberships",
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
    return unwrapPage<MembershipWithUser>(body, "memberships");
  }

  /**
   * The roster for the active organization, each row enriched with its user.
   * One request: up to `limit` (default 100) rows, ascending by join date;
   * `listAll()` is the guaranteed-complete form.
   */
  async list(params: ListMembershipsParams = {}): Promise<MembershipWithUser[]> {
    return (await this.page(params)).items;
  }

  listAll(
    params: ListMembershipsParams & IterateOptions = {},
  ): Promise<MembershipWithUser[]> {
    return drain(this.iterate(params));
  }

  iterate(
    params: ListMembershipsParams & IterateOptions = {},
  ): AsyncIterableIterator<MembershipWithUser> {
    return iteratePaged<MembershipWithUser>(
      (limit, offset) => this.page({ ...params, limit, offset }),
      { ...params, defaultPageSize: params.limit ?? 100 },
    );
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

  /**
   * Change a member's role in place. Owner or admin, with two extra gates the
   * API enforces: owner-level changes (granting `owner`, or changing an
   * existing owner's role) need the caller to be an owner, and demoting the
   * LAST owner is a 403 so an organization can never lock itself out.
   */
  async updateRole(
    membershipId: string,
    role: MembershipRole,
  ): Promise<Membership> {
    const body = await this.http.request(
      "PATCH",
      `/memberships/${encodeURIComponent(membershipId)}`,
      { body: { role } },
      this.tenancy,
    );
    return unwrap(body, "membership");
  }

  /** Removing the last owner is a 403. */
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
