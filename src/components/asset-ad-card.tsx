// Current ad + contract history for one asset (CRM data via public.ad_contracts).
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Megaphone } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import { getAssetAdHistory } from "@/lib/ad-contracts.functions";

function fmt(iso: string | null | undefined): string {
  if (!iso) return "—";
  try {
    return new Date(iso).toLocaleDateString("th-TH", { day: "2-digit", month: "short", year: "numeric" });
  } catch {
    return iso;
  }
}

function daysLeft(end: string | null | undefined): number | null {
  if (!end) return null;
  return Math.ceil((new Date(end).getTime() - Date.now()) / 86400_000);
}

export function AssetAdCard({ code }: { code: string | null | undefined }) {
  const fn = useServerFn(getAssetAdHistory);
  const { data, isLoading } = useQuery({
    queryKey: ["asset-ad-history", code],
    queryFn: () => fn({ data: { oldCode: code as string } }),
    enabled: !!code,
    staleTime: 5 * 60_000,
  });

  if (!code) return null;

  const current = data?.current ?? null;
  const history = (data?.history ?? []).filter((r) => r.id !== current?.id).slice(0, 8);
  const d = daysLeft(current?.end_date_contract);

  return (
    <div className="p-5 border-b">
      <div className="flex items-center gap-2 mb-3">
        <Megaphone className="h-4 w-4 text-primary" />
        <div className="text-sm font-medium">โฆษณาบนป้ายนี้ (CRM)</div>
      </div>

      {isLoading ? (
        <Skeleton className="h-16 w-full" />
      ) : !current ? (
        <p className="text-sm text-muted-foreground">ช่วงนี้ยังไม่มีโฆษณาขึ้นบนป้ายนี้</p>
      ) : (
        <div className="rounded-lg border p-3 bg-muted/30">
          <div className="font-semibold">{current.product_name ?? "—"}</div>
          <div className="mt-1 grid gap-x-6 gap-y-1 text-sm sm:grid-cols-2 lg:grid-cols-3">
            <div>
              <span className="text-muted-foreground">สัญญา: </span>
              {current.ad_contract ?? "—"}
            </div>
            <div>
              <span className="text-muted-foreground">เริ่มสัญญา: </span>
              {fmt(current.start_date_contract)}
            </div>
            <div>
              <span className="text-muted-foreground">สิ้นสุด: </span>
              <span className={cn(d != null && d <= 30 && "text-destructive font-medium")}>
                {fmt(current.end_date_contract)}
                {d != null ? ` (${d < 0 ? "หมดแล้ว" : `${d} วัน`})` : ""}
              </span>
            </div>
            <div>
              <span className="text-muted-foreground">ติดตั้งจริง: </span>
              {fmt(current.favor_start_date_contract)}
            </div>
          </div>
        </div>
      )}

      {history.length > 0 && (
        <div className="mt-3">
          <div className="text-xs text-muted-foreground mb-1">ประวัติโฆษณาย้อนหลัง</div>
          <ul className="text-sm space-y-1">
            {history.map((h) => (
              <li key={h.id} className="flex flex-wrap gap-x-2 text-muted-foreground">
                <span className="text-foreground">{h.product_name ?? "—"}</span>
                <span>
                  {fmt(h.start_date_contract)} → {fmt(h.end_date_contract)}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
