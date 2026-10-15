import { useState } from "react";
import { Activity, Pause, Play, ShieldAlert, Wrench } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { AssetRisk } from "@/components/asset-risk";
import { RISK_LABELS } from "@/lib/risk-colors";
import { cn } from "@/lib/utils";

type RiskPart = { key: string; label: string; max: number; value: number; detail: string };
type RiskAction = { title: string; detail: string; owner: string; deadline: string; done: string };
const SIGNALS = [
  { x: 130, y: 180, path: "M130 180 L250 250 L370 180" },
  { x: 390, y: 60, path: "M390 60 L510 130 L460 160" },
  { x: 670, y: 175, path: "M670 175 L555 240 L480 196" },
  { x: 635, y: 365, path: "M635 365 L520 298 L462 265" },
  { x: 170, y: 365, path: "M170 365 L290 295 L375 247" },
];

export function AssetIsometricRisk({ risk, parts, actions, queueTitle }: {
  risk: AssetRisk; parts: RiskPart[]; actions: RiskAction[]; queueTitle: string;
}) {
  const [activeKey, setActiveKey] = useState("open");
  const [hoverKey, setHoverKey] = useState<string | null>(null);
  const [paused, setPaused] = useState(false);
  const active = parts.find((part) => part.key === activeKey) ?? parts[0];
  const highlight = hoverKey ?? activeKey;
  const formulaTotal = Math.round(parts.reduce((sum, part) => sum + part.value, 0) * 10) / 10;

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
        <div className="risk-twin-stage min-w-0 px-2 py-3 sm:px-4">
          <svg viewBox="0 0 800 455" className="block w-full" role="img" aria-label={`แบบจำลองป้าย ${risk.code} เชื่อมกับสัญญาณความเสี่ยง 5 องค์ประกอบ`}>
            <title>กายวิภาคความเสี่ยงของ {risk.code}</title>
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
            <g className="risk-twin-platform">
              <path d="M305 285 L405 227 L512 289 L412 347 Z" className="risk-twin-base-top" />
              <path d="M305 285 L412 347 L512 289 L512 307 L412 365 L305 303 Z" className="risk-twin-base-side" />
              <path d="M318 285 L405 235 L499 289 L412 339 Z" className="risk-twin-alert-ring" fill="none" strokeWidth="2" />
            </g>
            <g className="risk-twin-billboard">
              <path d="M396 215 L410 223 L410 312 L396 304 Z" className="risk-twin-metal" />
              <path d="M410 223 L420 217 L420 306 L410 312 Z" className="risk-twin-metal-side" />
              <path d="M373 311 L408 291 L441 310 L406 331 Z" className="risk-twin-metal" />
              <path d="M305 92 L477 192 L477 261 L305 161 Z" className="risk-twin-frame" />
              <path d="M305 92 L318 85 L490 184 L477 192 Z" className="risk-twin-metal" />
              <path d="M477 192 L490 184 L490 253 L477 261 Z" className="risk-twin-metal-side" />
              <g transform="matrix(1 .577 0 1 315 111)">
                <rect width="152" height="48" className="risk-twin-screen" />
                <text x="10" y="16" className="risk-twin-screen-brand">PLAN B</text>
                <path d="M10 32 H40 L48 22 L58 40 L67 28 L75 32 H142" className="risk-twin-heartbeat" fill="none" strokeWidth="2" />
              </g>
              <path d="M300 91 L300 164 M496 185 L496 256" className="risk-twin-alert-ring" fill="none" strokeWidth="3" />
            </g>
            <g className="risk-twin-caption"><text x="407" y="403" textAnchor="middle">ASSET RISK ANATOMY</text><text x="407" y="425" textAnchor="middle" className="risk-twin-caption-sub">5 SIGNALS · {RISK_LABELS[risk.level]}</text></g>
          </svg>
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
      <footer className="flex flex-wrap justify-between gap-2 border-t px-4 py-2 text-[10px] text-muted-foreground"><span>คะแนนคำนวณทุกคืน · เคลมค้างจากข้อมูลล่าสุด</span><span>{formulaTotal !== risk.score ? `ผลรวมองค์ประกอบปัจจุบัน ${formulaTotal} · คะแนนบันทึก ${risk.score} (ต่างรอบอัปเดต/การปัดเศษ)` : `ผลรวมองค์ประกอบ ${formulaTotal} / 100`}</span><span>แบบจำลองประกอบข้อมูล ไม่ระบุชิ้นส่วนที่เสียจริง</span></footer>
    </section>
  );
}