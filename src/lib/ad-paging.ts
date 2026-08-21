// Helper: PostgREST caps every response at 1000 rows regardless of .limit(),
// so any "whole table" read must page through with .range().
export type PageResult<T> = { data: T[] | null; error: { message: string } | null };

export async function fetchAllPaged<T>(
  page: (from: number, to: number) => PromiseLike<PageResult<T>>,
  pageSize = 1000,
  maxRows = 200000,
): Promise<T[]> {
  const out: T[] = [];
  for (let from = 0; from < maxRows; from += pageSize) {
    const { data, error } = await page(from, from + pageSize - 1);
    if (error) throw new Error(error.message);
    if (!data || data.length === 0) break;
    out.push(...data);
    if (data.length < pageSize) break;
  }
  return out;
}
