import { HttpCore, DEFAULT_BASE_URL, hideProperties } from "./http.js";
import { XorgateError } from "./errors.js";
import { normalizeOrganization, normalizeUser, unwrap, unwrapList } from "./normalize.js";
import { ApiKeysResource } from "./resources/api-keys.js";
import { AuthResource } from "./resources/auth.js";
import { DeviceModelsResource } from "./resources/device-models.js";
import { DeviceRegistrationsResource } from "./resources/device-registrations.js";
import { DevicesResource } from "./resources/devices.js";
import { MediaResource } from "./resources/media.js";
import { MembershipsResource } from "./resources/memberships.js";
import { OrganizationsResource } from "./resources/organizations.js";
import { TelemetryResource } from "./resources/telemetry.js";
import { WorkspacesResource } from "./resources/workspaces.js";
import type { Tenancy } from "./resources/tenancy.js";
import type {
  BootstrapClientOptions,
  ClientOptions,
  CreateOrganizationInput,
  HttpMethod,
  Me,
  Organization,
  RawRequestInit,
  SearchResult,
} from "./types.js";

export interface XorgateClient {
  readonly baseUrl: string;
  readonly organizationId: string;
  readonly workspaceId: string | undefined;

  /** Derive a client for another organization. Shares the HTTP core. */
  forOrganization(organizationId: string): XorgateClient;
  /** Derive a client with a different (or no) default workspace. */
  forWorkspace(workspaceId: string | undefined): XorgateClient;

  me(): Promise<Me>;
  /** `GET /search`. At most 6 hits per resource type; `q` under 2 chars yields []. */
  search(q: string, options?: { signal?: AbortSignal }): Promise<SearchResult[]>;

  /**
   * Escape hatch for anything this SDK does not model yet. Applies auth,
   * tenancy headers, timeout and error mapping; does NOT unwrap the envelope
   * or normalize casing, so `T` is the raw wire shape.
   */
  request<T = unknown>(
    method: HttpMethod,
    path: string,
    init?: RawRequestInit,
  ): Promise<T>;

  readonly organizations: OrganizationsResource;
  readonly memberships: MembershipsResource;
  readonly apiKeys: ApiKeysResource;
  readonly auth: AuthResource;
  readonly workspaces: WorkspacesResource;
  readonly deviceModels: DeviceModelsResource;
  readonly devices: DevicesResource;
  readonly deviceRegistrations: DeviceRegistrationsResource;
  readonly media: MediaResource;
  readonly telemetry: TelemetryResource;
}

class Client implements XorgateClient {
  readonly organizations: OrganizationsResource;
  readonly memberships: MembershipsResource;
  readonly apiKeys: ApiKeysResource;
  readonly auth: AuthResource;
  readonly workspaces: WorkspacesResource;
  readonly deviceModels: DeviceModelsResource;
  readonly devices: DevicesResource;
  readonly deviceRegistrations: DeviceRegistrationsResource;
  readonly media: MediaResource;
  readonly telemetry: TelemetryResource;

  private readonly tenancy: Tenancy;

  constructor(
    private readonly http: HttpCore,
    organizationId: string,
    workspaceId: string | undefined,
  ) {
    this.tenancy = workspaceId ? { organizationId, workspaceId } : { organizationId };
    this.organizations = new OrganizationsResource(http, this.tenancy);
    this.memberships = new MembershipsResource(http, this.tenancy);
    this.apiKeys = new ApiKeysResource(http, this.tenancy);
    this.auth = new AuthResource(http, this.tenancy);
    this.workspaces = new WorkspacesResource(http, this.tenancy);
    this.deviceModels = new DeviceModelsResource(http, this.tenancy);
    this.devices = new DevicesResource(http, this.tenancy);
    this.deviceRegistrations = new DeviceRegistrationsResource(http, this.tenancy);
    this.media = new MediaResource(http, this.tenancy);
    this.telemetry = new TelemetryResource(http, this.tenancy);

    // The credential itself is already unserializable (see `hideProperties`),
    // so this is ergonomics rather than safety: without it, serializing a client
    // dumps every resource module and the whole HTTP core with it.
    hideProperties(this, ["http", "tenancy"]);
  }

  /**
   * What a client is, for a log line. Everything else on the object is
   * machinery, and the credential is not serializable at all.
   */
  toJSON(): { baseUrl: string; organizationId: string; workspaceId?: string } {
    return {
      baseUrl: this.baseUrl,
      organizationId: this.organizationId,
      ...(this.workspaceId ? { workspaceId: this.workspaceId } : {}),
    };
  }

  get baseUrl(): string {
    return this.http.baseUrl;
  }

  get organizationId(): string {
    return this.tenancy.organizationId as string;
  }

  get workspaceId(): string | undefined {
    return this.tenancy.workspaceId;
  }

  forOrganization(organizationId: string): XorgateClient {
    return new Client(this.http, requireId(organizationId, "organizationId"), this.workspaceId);
  }

  forWorkspace(workspaceId: string | undefined): XorgateClient {
    return new Client(this.http, this.organizationId, workspaceId);
  }

  async me(): Promise<Me> {
    return meFrom(await this.http.request("GET", "/me", {}, this.tenancy));
  }

  async search(
    q: string,
    options: { signal?: AbortSignal } = {},
  ): Promise<SearchResult[]> {
    const body = await this.http.request(
      "GET",
      "/search",
      { query: { q }, ...(options.signal ? { signal: options.signal } : {}) },
      this.tenancy,
    );
    return unwrapList<SearchResult>(body, "results");
  }

  request<T = unknown>(
    method: HttpMethod,
    path: string,
    init: RawRequestInit = {},
  ): Promise<T> {
    return this.http.request<T>(method, path, init, this.tenancy);
  }
}

export interface BootstrapClient {
  me(): Promise<Me>;
  listOrganizations(): Promise<Organization[]>;
  createOrganization(input: CreateOrganizationInput): Promise<Organization>;
  /** Upgrade to a full client once an organization id is known. */
  forOrganization(organizationId: string): XorgateClient;
}

class Bootstrap implements BootstrapClient {
  constructor(private readonly http: HttpCore) {}

  async me(): Promise<Me> {
    return meFrom(await this.http.request("GET", "/me"));
  }

  async listOrganizations(): Promise<Organization[]> {
    const body = await this.http.request("GET", "/organizations");
    return unwrapList<unknown>(body, "organizations").map(normalizeOrganization);
  }

  async createOrganization(input: CreateOrganizationInput): Promise<Organization> {
    const body = await this.http.request("POST", "/organizations", { body: input });
    return normalizeOrganization(unwrap(body, "organization"));
  }

  forOrganization(organizationId: string): XorgateClient {
    return new Client(this.http, requireId(organizationId, "organizationId"), undefined);
  }
}

export function createClient(options: ClientOptions): XorgateClient {
  if (!options || typeof options !== "object") {
    throw new XorgateError({
      code: "INVALID_CONFIG",
      message: "createClient() takes an options object.",
    });
  }
  const http = new HttpCore(options);
  return new Client(
    http,
    requireId(options.organizationId, "organizationId"),
    options.workspaceId,
  );
}

/**
 * The narrow client for the three operations that need no active organization:
 * `GET /me`, `GET /organizations` and `POST /organizations`. A brand-new user
 * has no organization, so they cannot be reached through a client that requires
 * one. All three need a Cognito ID token; an API key is refused by the platform
 * with `USER_CREDENTIAL_REQUIRED`.
 */
export function createBootstrapClient(
  options: BootstrapClientOptions,
): BootstrapClient {
  if (!options || typeof options !== "object") {
    throw new XorgateError({
      code: "INVALID_CONFIG",
      message: "createBootstrapClient() takes an options object.",
    });
  }
  return new Bootstrap(new HttpCore(options));
}

function meFrom(body: unknown): Me {
  return {
    user: normalizeUser(unwrap(body, "user")),
    memberships: unwrapList(body, "memberships"),
    organizations: unwrapList<unknown>(body, "organizations").map(normalizeOrganization),
  };
}

function requireId(value: string | undefined, field: string): string {
  if (typeof value !== "string" || value.trim() === "") {
    throw new XorgateError({
      code: "INVALID_CONFIG",
      message:
        `\`${field}\` is required and must be a non-empty string. Almost every ` +
        "endpoint resolves an active organization, and a caller in more than one " +
        "who omits the header gets 400 ORGANIZATION_REQUIRED.",
    });
  }
  return value;
}

export { DEFAULT_BASE_URL };
