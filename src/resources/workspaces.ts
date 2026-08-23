import { drain, iteratePaged } from "../pagination.js";
import { unwrap, unwrapPage } from "../normalize.js";
import type { HttpCore } from "../http.js";
import type {
  CreateWorkspaceInput,
  IterateOptions,
  ListWorkspacesParams,
  Page,
  UpdateWorkspaceInput,
  Workspace,
} from "../types.js";
import type { Tenancy } from "./tenancy.js";

export class WorkspacesResource {
  constructor(
    private readonly http: HttpCore,
    private readonly tenancy: Tenancy,
  ) {}

  private async page(params: ListWorkspacesParams = {}): Promise<Page<Workspace>> {
    const body = await this.http.request(
      "GET",
      "/workspaces",
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
    return unwrapPage<Workspace>(body, "workspaces");
  }

  /**
   * One request: up to `limit` (default 100) workspaces in the active
   * organization; `listAll()` is the guaranteed-complete form.
   */
  async list(params: ListWorkspacesParams = {}): Promise<Workspace[]> {
    return (await this.page(params)).items;
  }

  listAll(
    params: ListWorkspacesParams & IterateOptions = {},
  ): Promise<Workspace[]> {
    return drain(this.iterate(params));
  }

  iterate(
    params: ListWorkspacesParams & IterateOptions = {},
  ): AsyncIterableIterator<Workspace> {
    return iteratePaged<Workspace>(
      (limit, offset) => this.page({ ...params, limit, offset }),
      { ...params, defaultPageSize: params.limit ?? 100 },
    );
  }

  async get(id: string): Promise<Workspace> {
    const body = await this.http.request(
      "GET",
      `/workspaces/${encodeURIComponent(id)}`,
      {},
      this.tenancy,
    );
    return unwrap<Workspace>(body, "workspace");
  }

  async create(input: CreateWorkspaceInput): Promise<Workspace> {
    const body = await this.http.request(
      "POST",
      "/workspaces",
      { body: input },
      this.tenancy,
    );
    return unwrap<Workspace>(body, "workspace");
  }

  async update(id: string, input: UpdateWorkspaceInput): Promise<Workspace> {
    const body = await this.http.request(
      "PUT",
      `/workspaces/${encodeURIComponent(id)}`,
      { body: input },
      this.tenancy,
    );
    return unwrap<Workspace>(body, "workspace");
  }

  /** Cascades to the devices in it, and to their sessions and telemetry. */
  async delete(id: string): Promise<void> {
    await this.http.request(
      "DELETE",
      `/workspaces/${encodeURIComponent(id)}`,
      {},
      this.tenancy,
    );
  }
}
