import { drain, iteratePaged } from "../pagination.js";
import { commaList, unwrap, unwrapList, unwrapPage } from "../normalize.js";
import type { HttpCore } from "../http.js";
import type {
  IterateOptions,
  ListWorkflowTemplatesParams,
  Page,
  WorkflowTemplate,
  WorkflowTemplateDetail,
  WorkflowTemplateTagCount,
} from "../types.js";
import type { Tenancy } from "./tenancy.js";

/**
 * Workflow templates: the reusable processing graphs an organization has
 * authored, and the tags a program finds them by.
 *
 * READS ONLY, and deliberately so. Authoring a template, saving a draft,
 * publishing a version, attaching one to a device and reading its runs all
 * exist as REST resources, but they are still moving and are undocumented; a
 * template is authored in the web editor. What is settled, documented and
 * modelled here is the discovery path: an integration tags the templates it
 * owns, lists them by that tag, and reads one back.
 *
 * ```ts
 * const page = await xg.workflowTemplates.list({ tags: ["geofence"] })
 * for (const template of page.items) console.log(template.name, template.tags)
 * ```
 *
 * An organization API key at the default `member` role is enough for all three
 * methods. Cross-organization reads answer `404` like everywhere else, so
 * `NOT_FOUND` means "not visible to me", not "deleted".
 */
export class WorkflowTemplatesResource {
  constructor(
    private readonly http: HttpCore,
    private readonly tenancy: Tenancy,
  ) {}

  /**
   * PAGINATED. `tags` filters ANY-of: a template matches when it carries at
   * least one of the values. There is no ALL-of mode; intersect client-side if
   * you need one.
   */
  async list(
    params: ListWorkflowTemplatesParams = {},
  ): Promise<Page<WorkflowTemplate>> {
    const body = await this.http.request(
      "GET",
      "/workflow-templates",
      {
        query: {
          limit: params.limit,
          offset: params.offset,
          order: params.order,
          sort: params.sort,
          status: params.status,
          // One comma-separated `tag` rather than a repeated parameter: the
          // API reads both as the same string, and a comma can never occur
          // inside a tag.
          tag: commaList(params.tags),
        },
        ...(params.signal ? { signal: params.signal } : {}),
      },
      this.tenancy,
    );
    return unwrapPage<WorkflowTemplate>(body, "templates", normalizeTemplate);
  }

  iterate(
    params: ListWorkflowTemplatesParams & IterateOptions = {},
  ): AsyncIterableIterator<WorkflowTemplate> {
    return iteratePaged<WorkflowTemplate>(
      (limit, offset) => this.list({ ...params, limit, offset }),
      { ...params, defaultPageSize: params.limit ?? 100 },
    );
  }

  listAll(
    params: ListWorkflowTemplatesParams & IterateOptions = {},
  ): Promise<WorkflowTemplate[]> {
    return drain(this.iterate(params));
  }

  /** The template plus every version (with its graph) and the devices it is attached to. */
  async get(id: string): Promise<WorkflowTemplateDetail> {
    const body = await this.http.request(
      "GET",
      `/workflow-templates/${encodeURIComponent(id)}`,
      {},
      this.tenancy,
    );
    const template = unwrap<Record<string, unknown>>(body, "template");
    return {
      ...(normalizeTemplate(template) as WorkflowTemplateDetail),
      versions: (template["versions"] as WorkflowTemplateDetail["versions"]) ?? [],
      usage: (template["usage"] as WorkflowTemplateDetail["usage"]) ?? [],
    };
  }

  /**
   * The organization's distinct tags with counts, most used first. Unpaginated
   * and small by construction (a tag vocabulary, not a collection); use it to
   * discover what is taggable without walking every template.
   */
  async tags(options: { signal?: AbortSignal } = {}): Promise<WorkflowTemplateTagCount[]> {
    const body = await this.http.request(
      "GET",
      "/workflow-templates/tags",
      { ...(options.signal ? { signal: options.signal } : {}) },
      this.tenancy,
    );
    return unwrapList<WorkflowTemplateTagCount>(body, "tags");
  }
}

/**
 * `tags` and `requiredCapabilities` default to `[]` rather than coming back
 * undefined: both are absent on an API deployment older than the field that
 * carries them, and a consumer mapping over `template.tags` should not have to
 * know which deployment it is talking to.
 */
function normalizeTemplate(value: unknown): WorkflowTemplate {
  const row = value as Record<string, unknown>;
  return {
    ...(row as unknown as WorkflowTemplate),
    tags: Array.isArray(row["tags"]) ? (row["tags"] as string[]) : [],
    requiredCapabilities: Array.isArray(row["requiredCapabilities"])
      ? (row["requiredCapabilities"] as string[])
      : [],
  };
}
