import { drain, iteratePaged } from "../pagination.js";
import { parseIoCapabilities } from "../capabilities.js";
import { unwrap, unwrapPage } from "../normalize.js";
import type { HttpCore } from "../http.js";
import type {
  CreateDeviceModelInput,
  DeviceModel,
  DeviceModelWriteOptions,
  IterateOptions,
  ListDeviceModelsParams,
  Page,
  UpdateDeviceModelInput,
} from "../types.js";
import type { Tenancy } from "./tenancy.js";

/**
 * The platform-wide hardware catalog. Reads take no tenancy header and are open
 * to any valid credential; WRITES need the PLATFORM admin role
 * (`user.role === "admin"`), which no API key and no session token can ever
 * have, and which being an organization owner does not grant.
 */
export class DeviceModelsResource {
  constructor(
    private readonly http: HttpCore,
    private readonly tenancy: Tenancy,
  ) {}

  private async page(
    params: ListDeviceModelsParams = {},
  ): Promise<Page<DeviceModel>> {
    const body = await this.http.request(
      "GET",
      "/device-models",
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
    return unwrapPage<DeviceModel>(body, ["device_models", "deviceModels"]);
  }

  /**
   * One request: up to `limit` (default 100) catalog rows; `listAll()` is the
   * guaranteed-complete form.
   */
  async list(params: ListDeviceModelsParams = {}): Promise<DeviceModel[]> {
    return (await this.page(params)).items;
  }

  listAll(
    params: ListDeviceModelsParams & IterateOptions = {},
  ): Promise<DeviceModel[]> {
    return drain(this.iterate(params));
  }

  iterate(
    params: ListDeviceModelsParams & IterateOptions = {},
  ): AsyncIterableIterator<DeviceModel> {
    return iteratePaged<DeviceModel>(
      (limit, offset) => this.page({ ...params, limit, offset }),
      { ...params, defaultPageSize: params.limit ?? 100 },
    );
  }

  async get(id: string): Promise<DeviceModel> {
    const body = await this.http.request(
      "GET",
      `/device-models/${encodeURIComponent(id)}`,
      {},
      this.tenancy,
    );
    return unwrap<DeviceModel>(body, "device_model", "deviceModel");
  }

  async create(
    input: CreateDeviceModelInput,
    options: DeviceModelWriteOptions = {},
  ): Promise<DeviceModel> {
    validateCapabilities(input.ioCapabilities, options);
    const body = await this.http.request(
      "POST",
      "/device-models",
      { body: input },
      this.tenancy,
    );
    return unwrap<DeviceModel>(body, "device_model", "deviceModel");
  }

  async update(
    id: string,
    input: UpdateDeviceModelInput,
    options: DeviceModelWriteOptions = {},
  ): Promise<DeviceModel> {
    validateCapabilities(input.ioCapabilities, options);
    const body = await this.http.request(
      "PUT",
      `/device-models/${encodeURIComponent(id)}`,
      { body: input },
      this.tenancy,
    );
    return unwrap<DeviceModel>(body, "device_model", "deviceModel");
  }

  async delete(id: string): Promise<void> {
    await this.http.request(
      "DELETE",
      `/device-models/${encodeURIComponent(id)}`,
      {},
      this.tenancy,
    );
  }
}

/**
 * The one place the SDK does real work the API does not. `validate: false`
 * turns it off, which is only honest for writing a document the SDK's schema
 * rejects and the platform accepts, i.e. one that will provision zero video
 * channels.
 */
function validateCapabilities(
  value: unknown,
  options: DeviceModelWriteOptions,
): void {
  if (options.validate === false) return;
  if (value === undefined || value === null) return;
  parseIoCapabilities(value);
}
