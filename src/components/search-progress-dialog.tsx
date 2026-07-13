import { useEffect, useState } from "react";
import { Loader2, X } from "lucide-react";

type Stage = { label: string; from: number; to: number };

const STAGES: Stage[] = [
  { label: "กรองป้ายตามพื้นที่", from: 0, to: 20 },
  { label: "คำนวณขอบเขตแผนที่", from: 20, to: 30 },
  { label: "เรียก Overpass API (OpenStreetMap)", from: 30, to: 90 },
  { label: "จับคู่ระยะทางป้าย ↔ POI", from: 90, to: 99 },
];

/**
 * Progress modal that only appears when a search takes > `showAfterMs`.
 * Progress is time-estimated (server fn can't stream); we snap to 100%
 * from the parent when the response arrives (unmount = done).
 */
export function SearchProgressDialog({
  open,
  showAfterMs = 3000,
  estimatedTotalMs = 15000,
  onCancel,
}: {
  open: boolean;
  showAfterMs?: number;
  estimatedTotalMs?: number;
  onCancel?: () => void;
}) {
  const [visible, setVisible] = useState(false);
  const [startedAt, setStartedAt] = useState<number | null>(null);
  const [pct, setPct] = useState(0);

  useEffect(() => {
    if (!open) {
      setVisible(false);
      setStartedAt(null);
      setPct(0);
      return;
    }
    const t = window.setTimeout(() => {
      setVisible(true);
      setStartedAt(Date.now());
    }, showAfterMs);
    return () => window.clearTimeout(t);
  }, [open, showAfterMs]);

  useEffect(() => {
    if (!visible || startedAt == null) return;
    const tick = () => {
      const elapsed = Date.now() - startedAt;
      const raw = Math.min(99, (elapsed / estimatedTotalMs) * 100);
      // ease-out — feels less linear
      const eased = 99 * (1 - Math.pow(1 - raw / 99, 1.6));
      setPct(eased);
    };
    tick();
    const iv = window.setInterval(tick, 200);
    return () => window.clearInterval(iv);
  }, [visible, startedAt, estimatedTotalMs]);

  if (!open || !visible) return null;

  const currentStage = STAGES.find((s) => pct >= s.from && pct < s.to) ?? STAGES[STAGES.length - 1];

  return (
    <div className="fixed inset-0 z-[1300] grid place-items-center bg-black/40 backdrop-blur-sm p-4">
      <div className="w-full max-w-sm rounded-xl border bg-card shadow-2xl p-5">
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-center gap-2">
            <Loader2 className="size-4 animate-spin text-primary" />
            <div className="text-sm font-semibold">กำลังค้นหา POI…</div>
          </div>
          {onCancel && (
            <button
              onClick={onCancel}
              className="p-1 rounded hover:bg-accent text-muted-foreground"
              aria-label="ยกเลิก"
            >
              <X className="size-4" />
            </button>
          )}
        </div>

        <div className="mt-4 space-y-2">
          <div className="h-2 rounded-full bg-muted overflow-hidden">
            <div
              className="h-full bg-primary transition-all duration-200 ease-out"
              style={{ width: `${pct}%` }}
            />
          </div>
          <div className="flex items-center justify-between text-[11px]">
            <span className="text-muted-foreground">{currentStage.label}</span>
            <span className="tabular-nums font-medium">{pct.toFixed(0)}%</span>
          </div>
        </div>

        <ul className="mt-4 space-y-1 text-[11px]">
          {STAGES.map((s) => {
            const done = pct >= s.to;
            const active = pct >= s.from && pct < s.to;
            return (
              <li
                key={s.label}
                className={
                  done
                    ? "text-foreground"
                    : active
                    ? "text-primary font-medium"
                    : "text-muted-foreground/60"
                }
              >
                {done ? "✓" : active ? "•" : "○"} {s.label}
              </li>
            );
          })}
        </ul>

        <div className="mt-4 text-[10px] text-muted-foreground">
          {pct >= 99
            ? "ใช้เวลานานกว่าปกติ — Overpass อาจ timeout ภายใน 45 วิ ลองกดยกเลิกแล้วจำกัดพื้นที่ (BKKUPC / เขต / พื้นที่)"
            : "ค้นหาช้ากว่าปกติ? ลองจำกัดพื้นที่ (BKKUPC / เขต / พื้นที่) หรือลดจำนวนประเภทสถานที่"}
        </div>
      </div>
    </div>
  );
}
