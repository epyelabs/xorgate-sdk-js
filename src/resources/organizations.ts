import { iterateFixed } from "../pagination.js";
import { normalizeOrganization, unwrap, unwrapList } from "../normalize.js";
import type { HttpCore } from "../http.js";
import type {
  CreateOrganizationInput,
  IterateOptions,
  Organization,
  UpdateOrganizationInput,
} from "../types.js";
import type { Tenancy } from "./tenancy.js";

export class OrganizationsResource {
  constructor(
    private readonly http: HttpCore,
    private readonly tenancy: Tenancy,
  ) {}

  /** Unpaginated. `iterate()` exists so a future `page` block is a no-op here. */
  async list(): Promise<Organization[]> {
    const body = await this.http.request("GET", "/organizations", {}, this.tenancy);
    return unwrapList<unknown>(body, "organizations").map(normalizeOrganization);
  }

  listAll(): Promise<Organization[]> {
    return this.list();
  }

  iterate(options?: IterateOptions): AsyncIterableIterator<Organization> {
    return iterateFixed(() => this.list(), options);
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
