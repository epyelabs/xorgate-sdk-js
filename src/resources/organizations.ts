import { drain, iteratePaged } from "../pagination.js";
import { normalizeOrganization, unwrap, unwrapPage } from "../normalize.js";
import type { HttpCore } from "../http.js";
import type {
  CreateOrganizationInput,
  IterateOptions,
  ListOrganizationsParams,
  Organization,
  Page,
  UpdateOrganizationInput,
} from "../types.js";
import type { Tenancy } from "./tenancy.js";

export class OrganizationsResource {
  constructor(
    private readonly http: HttpCore,
    private readonly tenancy: Tenancy,
  ) {}

  private async page(
    params: ListOrganizationsParams = {},
  ): Promise<Page<Organization>> {
    const body = await this.http.request(
      "GET",
      "/organizations",
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
    return unwrapPage<Organization>(body, "organizations", normalizeOrganization);
  }

  /**
   * One request: up to `limit` (default 100) organizations. A user belongs to
   * a handful at most, so this is effectively "all of them"; `listAll()` is
   * the guaranteed-complete form.
   */
  async list(params: ListOrganizationsParams = {}): Promise<Organization[]> {
    return (await this.page(params)).items;
  }

  listAll(
    params: ListOrganizationsParams & IterateOptions = {},
  ): Promise<Organization[]> {
    return drain(this.iterate(params));
  }

  iterate(
    params: ListOrganizationsParams & IterateOptions = {},
  ): AsyncIterableIterator<Organization> {
    return iteratePaged<Organization>(
      (limit, offset) => this.page({ ...params, limit, offset }),
      { ...params, defaultPageSize: params.limit ?? 100 },
    );
  }

  /** `{id}` must be the ACTIVE organization. Read another by switching clients. */
  async get(id: string): Promise<Organization> {
    const body = await this.http.request(
      "GET",
      `/organizations/${encodeURIComponent(id)}`,
      {},
      this.tenancy,
    );
    return normalizeOrganization(unwrap(body, "organization"));
  }

  async create(input: CreateOrganizationInput): Promise<Organization> {
    const body = await this.http.request(
      "POST",
      "/organizations",
      { body: input },
      this.tenancy,
    );
    return normalizeOrganization(unwrap(body, "organization"));
  }

  async update(id: string, input: UpdateOrganizationInput): Promise<Organization> {
    const body = await this.http.request(
      "PUT",
      `/organizations/${encodeURIComponent(id)}`,
      { body: input },
      this.tenancy,
    );
    return normalizeOrganization(unwrap(body, "organization"));
  }

  /** Cascades to workspaces, devices, API keys and memberships. Owner only. */
  async delete(id: string): Promise<void> {
    await this.http.request(
      "DELETE",
      `/organizations/${encodeURIComponent(id)}`,
      {},
      this.tenancy,
    );
  }
}
