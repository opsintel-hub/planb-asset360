// Clean Industrial Digital Twin — 2.5D billboard model + single-source factor panel.
// Presentation-only: reuses the persisted risk score; never recomputes it.
import { useState } from "react";
import { Link } from "@tanstack/react-router";
import { Activity, History, Navigation, Pause, Play, ShieldAlert, Wrench } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import type { AssetRisk } from "@/components/asset-risk";
import { RISK_LABELS } from "@/lib/risk-colors";
import { cn } from "@/lib/utils";

type RiskPart = { key: string; label: string; max: number; value: number; detail: string };
type RiskAction = { title: string; detail: string; owner: string; deadline: string; done: string };

/** Which physical part of the billboard lights up for each risk factor. */
const PART_TARGET: Record<string, string> = {
  open: "screen", // เคลมค้างเปิด → หน้าจอแสดงผล
  c30: "frame", // เคลมถี่ระยะสั้น → โครงหน้าป้าย
  c90: "truss", // เคลมสะสม → โครงถักเหล็ก
  c365: "lamp", // เคลมระยะยาว → ระบบไฟส่องสว่าง
  pm: "mdb", // บำรุงรักษา → ตู้ MDB โคนเสา
};
const PART_TARGET_LABEL: Record<string, string> = {
  screen: "หน้าจอแสดงผล",
  frame: "โครงหน้าป้าย",
  truss: "โครงถักเหล็ก",
  lamp: "ระบบไฟส่องสว่าง",
  mdb: "ตู้ควบคุมไฟฟ้า (MDB)",
};

function partTone(part: RiskPart): "danger" | "warn" | "ok" {
  if (part.max <= 0) return "ok";
  const ratio = part.value / part.max;
  if (ratio >= 0.75) return "danger";
  if (ratio >= 0.4) return "warn";
  return "ok";
}

const TONE_VALUE: Record<ReturnType<typeof partTone>, string> = {
  danger: "text-destructive",
  warn: "text-warning",
  ok: "text-muted-foreground",
};
const TONE_BAR: Record<ReturnType<typeof partTone>, string> = {
  danger: "bg-destructive",
  warn: "bg-warning",
  ok: "bg-emerald-500",
};

export function AssetIsometricRisk({ risk, parts, actions, queueTitle }: {
  risk: AssetRisk; parts: RiskPart[]; actions: RiskAction[]; queueTitle: string;
}) {
  const [activeKey, setActiveKey] = useState("open");
  const [hoverKey, setHoverKey] = useState<string | null>(null);
  const [paused, setPaused] = useState(false);
  const active = parts.find((part) => part.key === activeKey) ?? parts[0];
  const highlight = hoverKey ?? activeKey;
  const highlightTarget = PART_TARGET[highlight] ?? null;
  const formulaTotal = Math.round(parts.reduce((sum, part) => sum + part.value, 0) * 10) / 10;

  const sendToRoutePlan = () => {
    window.sessionStorage.setItem("ad_photo_route", JSON.stringify({ codes: [risk.code], label: `ตรวจป้ายเสี่ยง ${risk.code}` }));
    toast.success(`ส่ง ${risk.code} เข้าแผนตรวจแล้ว`);
    window.location.href = "/route-monitoring";
  };

  const partClass = (target: string, base: string) =>
    cn("risk-twin-part", base, highlightTarget === target && "is-highlighted");

  return (
    <section aria-label={`ผังความเสี่ยง 2.5D ของ ${risk.code}`} className="risk-twin overflow-hidden rounded-lg border bg-background" data-level={risk.level} data-paused={paused}>
      <header className="flex flex-wrap items-center justify-between gap-3 border-b px-4 py-3 sm:px-5">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2"><h2 className="font-mono text-xl font-bold" data-testid="twin-asset-code">{risk.code}</h2><span className="risk-twin-status inline-flex items-center gap-1 text-xs font-semibold"><ShieldAlert className="size-3.5" />{RISK_LABELS[risk.level]}</span></div>
          <p className="mt-1 text-xs text-muted-foreground">{[risk.department, risk.mediaType, risk.district].filter(Boolean).join(" · ") || "ไม่ระบุข้อมูลพื้นที่"}</p>
        </div>
        <div className="flex items-center gap-3">
          <div className="text-right"><div className="text-[10px] text-muted-foreground">คะแนนความเสี่ยง</div><div className="risk-twin-status text-3xl font-bold tabular-nums">{risk.score}<span className="text-xs font-normal text-muted-foreground"> / 100</span></div></div>
          <Button variant="ghost" size="icon" aria-label={paused ? "เล่นแอนิเมชัน" : "หยุดแอนิเมชัน"} title={paused ? "เล่นแอนิเมชัน" : "หยุดแอนิเมชัน"} onClick={() => setPaused(!paused)}>{paused ? <Play /> : <Pause />}</Button>
        </div>
      </header>

      <div className="grid lg:grid-cols-[minmax(0,1fr)_280px]">
        {/* ===== โมเดล 2.5D คลีน — ไม่มีการ์ดลอย ไม่มีตัวเลขซ้ำ ===== */}
        <div className="risk-twin-stage relative min-w-0 px-2 py-3 sm:px-4">
          <svg viewBox="0 0 800 455" className="block w-full" role="img" aria-label={`แบบจำลองป้าย ${risk.code}`}>
            <title>กายวิภาคความเสี่ยงของ {risk.code}</title>
            <defs>
              <filter id="risk-twin-blur" x="-40%" y="-40%" width="180%" height="180%"><feGaussianBlur stdDeviation="10" /></filter>
            </defs>
            <g className="risk-twin-grid" fill="none" strokeWidth="1">
              {Array.from({ length: 9 }, (_, i) => <g key={i}><path d={`M${80 + i * 42} ${210 - i * 24} l340 196`} /><path d={`M${80 + i * 42} ${210 + i * 24} l340 -196`} /></g>)}
            </g>

            {/* ฐานรากคอนกรีต — เงาเนียน ไม่ฟุ้ง */}
            <ellipse cx="408" cy="352" rx="118" ry="30" className="risk-twin-shadow" filter="url(#risk-twin-blur)" />
            <g className="risk-twin-platform">
              <path d="M305 285 L405 227 L512 289 L412 347 Z" className="risk-twin-base-top" />
              <path d="M305 285 L412 347 L512 289 L512 307 L412 365 L305 303 Z" className="risk-twin-base-side" />
            </g>

            <g className="risk-twin-billboard">
              {/* โครงถักเหล็กด้านหลังหน้าป้าย */}
              <g className={partClass("truss", "risk-twin-truss")}>
                <path d="M305 92 L477 261 M305 161 L477 192" />
                <path d="M348 117 L348 191 M391 141 L391 221 M434 166 L434 246" />
              </g>
              {/* เสา + แขนรับ */}
              <path d="M396 215 L410 223 L410 312 L396 304 Z" className="risk-twin-metal" />
              <path d="M410 223 L420 217 L420 306 L410 312 Z" className="risk-twin-metal-side" />
              <path d="M373 311 L408 291 L441 310 L406 331 Z" className="risk-twin-metal" />
              {/* ตู้ควบคุมไฟฟ้า (MDB) ที่โคนเสา */}
              <g className={partClass("mdb", "risk-twin-mdb-box")}>
                <path d="M352 297 L364 290 L376 296 L364 303 Z" className="risk-twin-mdb" />
                <path d="M352 297 L364 303 L364 321 L352 315 Z" className="risk-twin-mdb-side" />
                <path d="M364 303 L376 296 L376 314 L364 321 Z" className="risk-twin-mdb" />
              </g>
              {/* โครงหน้าป้าย */}
              <path d="M305 92 L477 192 L477 261 L305 161 Z" className={partClass("frame", "risk-twin-frame")} />
              <path d="M305 92 L318 85 L490 184 L477 192 Z" className="risk-twin-metal" />
              <path d="M477 192 L490 184 L490 253 L477 261 Z" className="risk-twin-metal-side" />
              {/* ทางเดินซ่อมบำรุง (Catwalk) ใต้หน้าป้าย */}
              <g>
                <path d="M300 166 L482 270 L482 277 L300 173 Z" className="risk-twin-catwalk" />
                <path d="M312 159 L312 166 M356 184 L356 191 M400 210 L400 217 M444 235 L444 242 M476 253 L476 260" className="risk-twin-rail" />
              </g>
              {/* โคมสปอตไลต์เหนือหน้าป้าย */}
              <g className={partClass("lamp", "risk-twin-lamps")}>
                <path d="M340 103 L350 108 L350 114 L340 109 Z" className="risk-twin-lamp" />
                <path d="M395 130 L405 135 L405 141 L395 136 Z" className="risk-twin-lamp" />
                <path d="M450 157 L460 162 L460 168 L450 163 Z" className="risk-twin-lamp" />
                <path d="M345 112 L352 128 M400 139 L407 155 M455 166 L462 182" className="risk-twin-lamp-beam" />
              </g>
              {/* หน้าจอแสดงผลสื่อโฆษณา (สมจริง ไม่ใช่กราฟคลื่นหัวใจ) */}
              <g className={partClass("screen", "risk-twin-screen-group")} transform="matrix(1 .577 0 1 315 111)">
                <rect width="152" height="48" className="risk-twin-screen" />
                <text x="10" y="17" className="risk-twin-screen-brand">PLAN B</text>
                <rect x="10" y="24" width="86" height="7" rx="2" className="risk-twin-screen-block" />
                <rect x="10" y="35" width="56" height="5" rx="2" className="risk-twin-screen-block risk-twin-screen-block-sub" />
                <rect x="106" y="22" width="36" height="18" rx="3" className="risk-twin-screen-badge" />
              </g>
            </g>

            <g className="risk-twin-caption"><text x="407" y="403" textAnchor="middle">ASSET RISK ANATOMY</text><text x="407" y="425" textAnchor="middle" className="risk-twin-caption-sub">{RISK_LABELS[risk.level]} · คลิกองค์ประกอบด้านขวาเพื่อชี้ชิ้นส่วน</text></g>
          </svg>
        </div>

        {/* ===== แผงองค์ประกอบความเสี่ยง — Single Source of Truth ===== */}
        <div className="flex flex-col gap-1.5 border-t p-3 lg:border-l lg:border-t-0" aria-label="องค์ประกอบคะแนนความเสี่ยง">
          <div className="px-1 pb-1 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">องค์ประกอบความเสี่ยง</div>
          {parts.map((part, index) => {
            const tone = partTone(part);
            const pct = part.max > 0 ? Math.min(100, Math.round((part.value / part.max) * 100)) : 0;
            const target = PART_TARGET[part.key];
            return (
              <button
                key={part.key}
                type="button"
                aria-pressed={activeKey === part.key}
                onClick={() => setActiveKey(part.key)}
                onMouseEnter={() => setHoverKey(part.key)}
                onMouseLeave={() => setHoverKey(null)}
                className={cn("risk-twin-factor rounded-md border border-transparent px-3 py-2 text-left transition-colors hover:bg-accent/50", activeKey === part.key && "is-selected")}
              >
                <span className="flex items-baseline justify-between gap-2">
                  <span className="flex min-w-0 items-baseline gap-1.5 text-xs font-medium">
                    <span className="risk-twin-factor-index font-mono text-[10px]">{index + 1}</span>
                    <span className="truncate">{part.label}</span>
                  </span>
                  <span className={cn("shrink-0 font-mono text-sm font-bold tabular-nums", TONE_VALUE[tone])}>
                    {part.value}<span className="text-[10px] font-normal text-muted-foreground"> / {part.max}</span>
                  </span>
                </span>
                <span className="mt-1.5 block h-1.5 overflow-hidden rounded-full bg-muted">
                  <span className={cn("block h-full rounded-full transition-all", TONE_BAR[tone])} style={{ width: `${pct}%` }} />
                </span>
                <span className="mt-1 flex items-center justify-between gap-2 text-[11px] text-muted-foreground">
                  <span className="truncate">{part.detail}</span>
                  {target && <span className="shrink-0 font-mono text-[9px] uppercase tracking-wide opacity-70">→ {PART_TARGET_LABEL[target]}</span>}
                </span>
              </button>
            );
          })}
        </div>
      </div>

      {active && <div className="flex flex-wrap items-start gap-3 border-t bg-muted/30 px-4 py-3 text-xs sm:px-5"><Activity className="risk-twin-status mt-0.5 size-4 shrink-0" /><div className="min-w-0 flex-1"><p className="font-semibold">{active.label} · {active.value} / {active.max} คะแนน</p><p className="mt-1 text-muted-foreground">{active.detail}{active.key === "pm" && risk.daysSincePm == null ? " · สูตรปัจจุบันให้ 0 คะแนนเมื่อไม่มีข้อมูล ไม่ได้หมายความว่าทำ PM แล้ว" : ` · สัดส่วน ${Math.round(active.value / active.max * 100)}% ของคะแนนเต็มองค์ประกอบนี้`}</p></div></div>}
      <div className="border-t px-4 py-4 sm:px-5"><h3 className="flex items-start gap-2 text-sm font-semibold"><Wrench className="risk-twin-status mt-0.5 size-4 shrink-0" />{queueTitle}</h3><div className="mt-3 grid gap-3 sm:grid-cols-3">{actions.map((action) => <div key={action.title} className="min-w-0 border-l-2 border-primary/30 pl-3"><p className="text-xs font-semibold">{action.title}</p><p className="mt-1 text-[11px] text-muted-foreground">{action.owner} · {action.deadline}</p><p className="mt-1 text-[11px] leading-relaxed text-muted-foreground">{action.done}</p></div>)}</div></div>
      <div className="flex flex-wrap items-center gap-2 border-t px-4 py-3 sm:px-5">
        <Button asChild size="sm" variant="outline"><Link to="/search" search={{ q: risk.code }}><History />เปิด Asset History 360°</Link></Button>
        <Button type="button" size="sm" onClick={sendToRoutePlan}><Navigation />ส่งเข้า Route Monitoring</Button>
      </div>
      <footer className="flex flex-wrap justify-between gap-2 border-t px-4 py-2 text-[10px] text-muted-foreground"><span>คะแนนคำนวณทุกคืน · เคลมค้างจากข้อมูลล่าสุด</span><span>{formulaTotal !== risk.score ? `ผลรวมองค์ประกอบปัจจุบัน ${formulaTotal} · คะแนนบันทึก ${risk.score} (ต่างรอบอัปเดต/การปัดเศษ)` : `ผลรวมองค์ประกอบ ${formulaTotal} / 100`}</span><span>แบบจำลองประกอบข้อมูล ไม่ระบุชิ้นส่วนที่เสียจริง</span></footer>
    </section>
  );
}
