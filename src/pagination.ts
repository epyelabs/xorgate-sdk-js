import type { IterateOptions, Page, PageMeta } from "./types.js";

/**
 * The iteration convention, applied to both kinds of collection.
 *
 * Exactly three endpoints paginate today (`GET /devices`,
 * `GET /devices/{id}/sessions`, `GET /devices/{id}/telemetry/readings`) and the
 * rest return their whole collection. `iterate()` exists on every collection
 * anyway, so code written against it keeps working unchanged when the platform
 * paginates the rest: the SDK is the only thing that has to learn about the new
 * `page` block.
 */

/** Drains an already-complete array, calling `onPage` once. */
export async function* iterateFixed<T>(
  load: () => Promise<T[]>,
  options: IterateOptions = {},
): AsyncIterableIterator<T> {
  const items = await load();
  options.onPage?.({
    limit: items.length,
    offset: 0,
    order: "desc",
    total: items.length,
  });
  for (const item of items) yield item;
}

/**
 * Walks a paginated endpoint, one request at a time.
 *
 * Sequential on purpose. `offset` pagination over a table that is still being
 * written gives inconsistent results when pages are fetched out of order, and a
 * parallel fan-out is a good way to discover an account's default gateway
 * limits the hard way.
 */
export async function* iteratePaged<T>(
  loadPage: (limit: number, offset: number) => Promise<Page<T>>,
  options: IterateOptions & { defaultPageSize?: number } = {},
): AsyncIterableIterator<T> {
  const pageSize = options.pageSize ?? options.defaultPageSize ?? 100;
  let offset = 0;

  for (;;) {
    if (options.signal?.aborted) return;
    const page = await loadPage(pageSize, offset);
    options.onPage?.(page.page);
    for (const item of page.items) yield item;

    if (page.items.length === 0) return;
    // `limit` echoes the request AFTER clamping, so advancing by it (rather
    // than by what we asked for) is what keeps a clamped page from looping.
    const step = page.items.length;
    offset += step;
    if (offset >= page.page.total) return;
    // A page shorter than the effective limit means the end, even when `total`
    // says otherwise: `telemetry.readings()` caps `total` rather than counting.
    if (step < effectiveLimit(page.page, pageSize)) return;
  }
}

function effectiveLimit(meta: PageMeta, requested: number): number {
  return meta.limit > 0 ? meta.limit : requested;
}

export async function drain<T>(it: AsyncIterableIterator<T>): Promise<T[]> {
  const out: T[] = [];
  for await (const item of it) out.push(item);
  return out;
}
