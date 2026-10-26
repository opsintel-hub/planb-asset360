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

/** Signal anchors on the 800x455 stage + floating card centres (px in viewBox space). */
const SIGNALS = [
  { x: 130, y: 180, path: "M130 180 L250 250 L370 180", card: { x: 128, y: 112 } },
  { x: 390, y: 60, path: "M390 60 L510 130 L460 160", card: { x: 252, y: 56 } },
  { x: 670, y: 175, path: "M670 175 L555 240 L480 196", card: { x: 664, y: 108 } },
  { x: 635, y: 365, path: "M635 365 L520 298 L462 265", card: { x: 640, y: 414 } },
  { x: 170, y: 365, path: "M170 365 L290 295 L375 247", card: { x: 168, y: 414 } },
];

function partTone(part: RiskPart): "danger" | "warn" | "ok" {
  if (part.max <= 0) return "ok";
  const ratio = part.value / part.max;
  if (ratio >= 0.75) return "danger";
  if (ratio >= 0.4) return "warn";
  return "ok";
}

const TONE_CARD: Record<ReturnType<typeof partTone>, string> = {
  danger: "border-destructive/50 bg-destructive/10",
  warn: "border-warning/50 bg-warning/10",
  ok: "border-border bg-card/95",
};
const TONE_VALUE: Record<ReturnType<typeof partTone>, string> = {
  danger: "text-destructive",
  warn: "text-warning",
  ok: "text-muted-foreground",
};

export function AssetIsometricRisk({ risk, parts, actions, queueTitle }: {
  risk: AssetRisk; parts: RiskPart[]; actions: RiskAction[]; queueTitle: string;
}) {
  const [activeKey, setActiveKey] = useState("open");
  const [hoverKey, setHoverKey] = useState<string | null>(null);
  const [paused, setPaused] = useState(false);
  const active = parts.find((part) => part.key === activeKey) ?? parts[0];
  const highlight = hoverKey ?? activeKey;
  const formulaTotal = Math.round(parts.reduce((sum, part) => sum + part.value, 0) * 10) / 10;

  const sendToRoutePlan = () => {
    window.sessionStorage.setItem("ad_photo_route", JSON.stringify({ codes: [risk.code], label: `ตรวจป้ายเสี่ยง ${risk.code}` }));
    toast.success(`ส่ง ${risk.code} เข้าแผนตรวจแล้ว`);
    window.location.href = "/route-monitoring";
  };

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

      <div className="grid lg:grid-cols-[minmax(0,1fr)_230px]">
        <div className="risk-twin-stage relative min-w-0 px-2 py-3 sm:px-4">
          <svg viewBox="0 0 800 455" className="block w-full" role="img" aria-label={`แบบจำลองป้าย ${risk.code} เชื่อมกับสัญญาณความเสี่ยง 5 องค์ประกอบ`}>
            <title>กายวิภาคความเสี่ยงของ {risk.code}</title>
            <defs>
              <filter id="risk-twin-blur" x="-40%" y="-40%" width="180%" height="180%"><feGaussianBlur stdDeviation="10" /></filter>
            </defs>
            <g className="risk-twin-grid" fill="none" strokeWidth="1">
              {Array.from({ length: 9 }, (_, i) => <g key={i}><path d={`M${80 + i * 42} ${210 - i * 24} l340 196`} /><path d={`M${80 + i * 42} ${210 + i * 24} l340 -196`} /></g>)}
            </g>
            {parts.map((part, index) => {
              const signal = SIGNALS[index];
              if (!signal) return null;
              return <g key={part.key} className={cn("risk-twin-signal", part.value > 0 && "is-live", highlight === part.key && "is-selected")}>
                <path d={signal.path} fill="none" className="risk-twin-track" strokeWidth="7" />
                <path d={signal.path} fill="none" className="risk-twin-flow" strokeWidth="3" />
                <g className="risk-twin-node" transform={`translate(${signal.x} ${signal.y})`}>
                  <path d="M-42 0 L0 -24 L42 0 L0 24 Z" className="risk-twin-node-top" />
                  <path d="M-42 0 L0 24 L42 0 L42 11 L0 35 L-42 11 Z" className="risk-twin-node-side" />
                  <text y="5" textAnchor="middle" className="risk-twin-node-number">0{index + 1}</text>
                </g>
              </g>;
            })}
            <ellipse cx="408" cy="352" rx="130" ry="36" className="risk-twin-glow" filter="url(#risk-twin-blur)" />
            <g className="risk-twin-platform">
              <path d="M305 285 L405 227 L512 289 L412 347 Z" className="risk-twin-base-top" />
              <path d="M305 285 L412 347 L512 289 L512 307 L412 365 L305 303 Z" className="risk-twin-base-side" />
              <path d="M318 285 L405 235 L499 289 L412 339 Z" className="risk-twin-alert-ring" fill="none" strokeWidth="2" />
            </g>
            <g className="risk-twin-billboard">
              {/* โครงถักเหล็กด้านหลังหน้าป้าย */}
              <g className="risk-twin-truss">
                <path d="M305 92 L477 261 M305 161 L477 192" />
                <path d="M348 117 L348 191 M391 141 L391 221 M434 166 L434 246" />
              </g>
              <path d="M396 215 L410 223 L410 312 L396 304 Z" className="risk-twin-metal" />
              <path d="M410 223 L420 217 L420 306 L410 312 Z" className="risk-twin-metal-side" />
              <path d="M373 311 L408 291 L441 310 L406 331 Z" className="risk-twin-metal" />
              {/* ตู้ควบคุมไฟฟ้า (MDB) ที่โคนเสา */}
              <g className="risk-twin-mdb-box">
                <path d="M352 297 L364 290 L376 296 L364 303 Z" className="risk-twin-mdb" />
                <path d="M352 297 L364 303 L364 321 L352 315 Z" className="risk-twin-mdb-side" />
                <path d="M364 303 L376 296 L376 314 L364 321 Z" className="risk-twin-mdb" />
              </g>
              <path d="M305 92 L477 192 L477 261 L305 161 Z" className="risk-twin-frame" />
              <path d="M305 92 L318 85 L490 184 L477 192 Z" className="risk-twin-metal" />
              <path d="M477 192 L490 184 L490 253 L477 261 Z" className="risk-twin-metal-side" />
              {/* ทางเดินซ่อมบำรุง (Catwalk) ใต้หน้าป้าย */}
              <g>
                <path d="M300 166 L482 270 L482 277 L300 173 Z" className="risk-twin-catwalk" />
                <path d="M312 159 L312 166 M356 184 L356 191 M400 210 L400 217 M444 235 L444 242 M476 253 L476 260" className="risk-twin-rail" />
              </g>
              {/* โคมสปอตไลต์เหนือหน้าป้าย */}
              <g>
                <path d="M340 103 L350 108 L350 114 L340 109 Z" className="risk-twin-lamp" />
                <path d="M395 130 L405 135 L405 141 L395 136 Z" className="risk-twin-lamp" />
                <path d="M450 157 L460 162 L460 168 L450 163 Z" className="risk-twin-lamp" />
                <path d="M345 112 L352 128 M400 139 L407 155 M455 166 L462 182" className="risk-twin-lamp-beam" />
              </g>
              <g transform="matrix(1 .577 0 1 315 111)">
                <rect width="152" height="48" className="risk-twin-screen" />
                <text x="10" y="16" className="risk-twin-screen-brand">PLAN B</text>
                <path d="M10 32 H40 L48 22 L58 40 L67 28 L75 32 H142" className="risk-twin-heartbeat" fill="none" strokeWidth="2" />
              </g>
              <path d="M300 91 L300 164 M496 185 L496 256" className="risk-twin-alert-ring" fill="none" strokeWidth="3" />
            </g>
            <g className="risk-twin-caption"><text x="407" y="403" textAnchor="middle">ASSET RISK ANATOMY</text><text x="407" y="425" textAnchor="middle" className="risk-twin-caption-sub">5 SIGNALS · {RISK_LABELS[risk.level]}</text></g>
          </svg>

          {/* การ์ด Telemetry ลอยรอบป้าย (เดสก์ท็อป) */}
          {parts.map((part, index) => {
            const signal = SIGNALS[index];
            if (!signal) return null;
            const tone = partTone(part);
            return (
              <button
                key={part.key}
                type="button"
                aria-pressed={activeKey === part.key}
                onClick={() => setActiveKey(part.key)}
                onMouseEnter={() => setHoverKey(part.key)}
                onMouseLeave={() => setHoverKey(null)}
                style={{ left: `${(signal.card.x / 800) * 100}%`, top: `${(signal.card.y / 455) * 100}%` }}
                className={cn(
                  "absolute z-10 hidden w-[150px] -translate-x-1/2 -translate-y-1/2 rounded-md border px-2 py-1.5 text-left shadow-[var(--shadow-card)] backdrop-blur-sm transition-transform hover:-translate-y-[55%] lg:block",
                  TONE_CARD[tone],
                  highlight === part.key && "ring-2 ring-primary",
                )}
              >
                <span className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                  <span className="font-mono text-primary">0{index + 1}</span>
                  <span className="truncate">{part.label}</span>
                </span>
                <span className={cn("mt-0.5 block font-mono text-sm font-bold tabular-nums", TONE_VALUE[tone])}>
                  {part.value}<span className="text-[10px] font-normal text-muted-foreground"> / {part.max}</span>
                </span>
              </button>
            );
          })}
        </div>
        <div className="grid grid-cols-1 gap-1 border-t p-3 sm:grid-cols-2 lg:grid-cols-1 lg:border-l lg:border-t-0" aria-label="องค์ประกอบคะแนนความเสี่ยง">
          {parts.map((part, index) => <Button key={part.key} variant="ghost" aria-pressed={activeKey === part.key} onClick={() => setActiveKey(part.key)} onMouseEnter={() => setHoverKey(part.key)} onMouseLeave={() => setHoverKey(null)} className={cn("risk-twin-factor h-auto min-h-16 justify-start gap-3 rounded-md px-3 py-2 text-left whitespace-normal", activeKey === part.key && "is-selected")}>
            <span className="risk-twin-factor-index font-mono text-xs">0{index + 1}</span>
            <span className="min-w-0 flex-1"><span className="block text-xs font-medium">{part.label}</span><span className="mt-0.5 block text-[11px] font-normal text-muted-foreground">{part.detail}</span></span>
            <span className="shrink-0 text-right font-mono text-sm font-bold">{part.value}<span className="block text-[10px] font-normal text-muted-foreground">/ {part.max}</span></span>
          </Button>)}
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
