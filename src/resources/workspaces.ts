import { iterateFixed } from "../pagination.js";
import { unwrap, unwrapList } from "../normalize.js";
import type { HttpCore } from "../http.js";
import type {
  CreateWorkspaceInput,
  IterateOptions,
  UpdateWorkspaceInput,
  Workspace,
} from "../types.js";
import type { Tenancy } from "./tenancy.js";

export class WorkspacesResource {
  constructor(
    private readonly http: HttpCore,
    private readonly tenancy: Tenancy,
  ) {}

  /** Unpaginated: every workspace in the active organization. */
  async list(): Promise<Workspace[]> {
    const body = await this.http.request("GET", "/workspaces", {}, this.tenancy);
    return unwrapList<Workspace>(body, "workspaces");
  }

  listAll(): Promise<Workspace[]> {
    return this.list();
  }

  iterate(options?: IterateOptions): AsyncIterableIterator<Workspace> {
    return iterateFixed(() => this.list(), options);
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
