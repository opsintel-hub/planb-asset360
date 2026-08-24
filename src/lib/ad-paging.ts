// Helper: PostgREST caps every response at 1000 rows regardless of .limit(),
// so any "whole table" read must page through with .range().
//
// Pages are fetched in small concurrent waves instead of strictly one at a
// time: each round trip costs ~0.3-0.9s, so a 10-page table took 4-8s when
// fetched serially. Row order is preserved (results are placed by page index)
// and the stop condition is unchanged: we stop at the first short/empty page.
export type PageResult<T> = { data: T[] | null; error: { message: string } | null };

const CONCURRENCY = 4;

export async function fetchAllPaged<T>(
  page: (from: number, to: number) => PromiseLike<PageResult<T>>,
  pageSize = 1000,
  maxRows = 200000,
): Promise<T[]> {
  const out: T[] = [];
  let start = 0;

  while (start < maxRows) {
    const offsets: number[] = [];
    for (let i = 0; i < CONCURRENCY && start + i * pageSize < maxRows; i += 1) {
      offsets.push(start + i * pageSize);
    }
    if (offsets.length === 0) break;

    const pages = await Promise.all(
      offsets.map(async (from) => {
        const { data, error } = await page(from, from + pageSize - 1);
        if (error) throw new Error(error.message);
        return data ?? [];
      }),
    );

    let done = false;
    for (const rows of pages) {
      out.push(...rows);
      if (rows.length < pageSize) {
        done = true;
        break;
      }
    }
    if (done) break;
    start += offsets.length * pageSize;
  }

  return out;
}
