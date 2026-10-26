// Presentation only: RiskDetail supplies the saved score, factors, actions and real events.
import { useMemo, useState } from "react";
import { Link } from "@tanstack/react-router";
import { Activity, ArrowRight, History, Navigation, ShieldAlert, Wrench } from "lucide-react";
import { Area, AreaChart, CartesianGrid, PolarAngleAxis, PolarGrid, PolarRadiusAxis, Radar, RadarChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import type { AssetRisk } from "@/components/asset-risk";
import { RISK_LABELS } from "@/lib/risk-colors";
import { cn } from "@/lib/utils";

type RiskPart = { key: string; label: string; max: number; value: number; detail: string };
type RiskAction = { title: string; detail: string; owner: string; deadline: string; done: string };
type HistoryEvent = { type: "Claim" | "PM"; eventAt: string };
const TARGETS = [
  { key: "open", label: "MEDIA FACE", x: 76, y: 194, point: [202, 213] },
  { key: "c30", label: "CABINET", x: 422, y: 76, point: [398, 174] },
  { key: "c90", label: "TRUSS & LIGHT", x: 77, y: 74, point: [276, 130] },
  { key: "c365", label: "PYLON & BASE", x: 432, y: 406, point: [336, 406] },
  { key: "pm", label: "MDB / CONTROL", x: 72, y: 406, point: [239, 378] },
];
const AXES: Record<string, string> = { open: "เคลมค้าง", c30: "30 วัน", c90: "90 วัน", c365: "365 วัน", pm: "รอบ PM" };

function FactorGauge({ part, index, selected, onSelect }: { part: RiskPart; index: number; selected: boolean; onSelect: () => void }) {
  const ratio = part.max > 0 ? Math.min(1, Math.max(0, part.value / part.max)) : 0;
  return <Button variant="ghost" className={cn("mission-factor", selected && "is-selected")} aria-pressed={selected} onClick={onSelect}>
    <svg viewBox="0 0 44 44" className="mission-ring" aria-hidden="true">
      <circle cx="22" cy="22" r="18" className="mission-ring-track" />
      <circle cx="22" cy="22" r="18" pathLength="100" strokeDasharray={`${ratio * 100} 100`} transform="rotate(-90 22 22)" className="mission-ring-value" />
      <text x="22" y="26" textAnchor="middle">{String(index + 1).padStart(2, "0")}</text>
    </svg>
    <span className="min-w-0 flex-1">
      <span className="block text-xs font-semibold">{part.label}</span>
      <span className="mt-1 flex items-baseline gap-1 font-mono"><strong className="text-lg">{part.value}</strong><span className="text-[11px] text-muted-foreground">/ {part.max}</span></span>
      <span className="mission-segments mt-1.5" aria-hidden="true">{Array.from({ length: 12 }, (_, i) => <i key={i} className={i < Math.round(ratio * 12) ? "filled" : ""} />)}</span>
    </span>
    <span className="mission-factor-dot" aria-hidden="true" />
  </Button>;
}

function BillboardAnatomy({ activeKey, code, onSelect }: { activeKey: string; code: string; onSelect: (key: string) => void }) {
  const part = (key: string, className: string) => cn("mission-model-part", className, activeKey === key && "is-active");
  return <svg viewBox="0 0 560 490" className="mission-model" role="img" aria-label={`แบบจำลองโครงสร้างป้าย ${code}`}>
    <title>OOH Asset Anatomy — {code}</title>
    <defs>
      <pattern id="mission-grid" width="30" height="17.3" patternUnits="userSpaceOnUse" patternTransform="matrix(1 .577 -1 .577 280 290)"><path d="M30 0H0V17.3" className="mission-grid-line" fill="none" /></pattern>
    </defs>
    <path d="M44 345L283 207L522 345L283 483Z" fill="url(#mission-grid)" />
    <path d="M174 409L323 323L450 397L301 483Z" className="mission-model-shadow" />
    {/* Foundation, bolt plate and pylon. */}
    <g className={part("c365", "mission-foundation")}>
      <path d="M237 395L322 346L399 390L314 440Z" className="mission-concrete-top" />
      <path d="M237 395L314 440L314 454L237 410Z" className="mission-concrete-front" />
      <path d="M314 440L399 390L399 405L314 454Z" className="mission-concrete-side" />
      <path d="M287 383L314 367L347 386L320 402Z" className="mission-steel-top" />
      <path d="M305 257L322 267L322 389L305 379Z" className="mission-steel-front" />
      <path d="M322 267L337 258L337 380L322 389Z" className="mission-steel-side" />
      <path d="M310 278L280 258M329 283L363 254" className="mission-heavy-rail" />
      {[ [298,385], [318,396], [338,384], [316,373] ].map(([x,y],i)=><ellipse key={i} cx={x} cy={y} rx="3" ry="2" className="mission-bolt" />)}
    </g>
    {/* Rear cabinet: intentionally separated from the media face. */}
    <g className={part("c30", "mission-cabinet")}>
      <path d="M273 123L398 195L444 168L319 96Z" className="mission-steel-top" />
      <path d="M398 195L444 168L444 267L398 294Z" className="mission-steel-side" />
      <path d="M273 123L398 195L398 294L273 222Z" className="mission-cabinet-face" />
      {[0,1,2,3,4].map(i=><g key={i}><path d={`M${283+i*22} ${138+i*12.7}v70l16 9V${147+i*12.7}Z`} className="mission-cabinet-panel" /><path d={`M${411+i*5} ${200-i*3}v49`} className="mission-vent" /></g>)}
    </g>
    {/* Exposed service truss, maintenance walkway and lamps. */}
    <g className={part("c90", "mission-truss")}>
      <path d="M190 152L368 255L406 233L229 131Z" className="mission-steel-top" />
      <path d="M190 152L368 255L368 281L190 178Z" className="mission-truss-face" />
      {Array.from({length:6},(_,i)=><path key={i} d={`M${193+i*29} ${155+i*16.8}l26 41v-26l-26 10Z`} className="mission-bracing" />)}
      <path d="M182 277L363 381L397 362L216 257Z" className="mission-walkway" />
      <path d="M185 264L363 367L393 350M185 264v15M230 290v15M275 316v15M320 342v15M363 367v15M393 350v15" className="mission-rail" />
      {[0,1,2].map(i=><g key={i} transform={`translate(${235+i*56} ${126+i*32.3})`}><path d="M0 0v-17l12-7" className="mission-rail" /><path d="M7-26l20 12-8 5-20-12Z" className="mission-light" /></g>)}
    </g>
    {/* Detached media plane. No failure glow: selection uses an outline. */}
    <g className={part("open", "mission-media")}>
      <path d="M144 149L324 253L324 354L144 250Z" className="mission-face-frame" />
      <path d="M144 149L153 144L333 248L324 253Z" className="mission-steel-top" />
      <path d="M324 253L333 248L333 349L324 354Z" className="mission-steel-side" />
      <g transform="matrix(1 .577 0 1 153 166)">
        <rect width="162" height="75" className="mission-ad-face" />
        <path d="M105 0h57v75h-91Z" className="mission-ad-accent" />
        <text x="12" y="30" className="mission-ad-brand">PLAN B</text>
        <text x="12" y="45" className="mission-ad-copy">MEDIA</text>
        <path d="M12 57h53M12 62h34" className="mission-ad-rule" />
        <path d="M128 20l18 10v25l-18-10Z M112 29l14 8v22l-14-8Z" className="mission-ad-mark" />
      </g>
    </g>
    <path d="M324 302L369 276M324 333L369 307M179 223L219 201" className="mission-explode-line" />
    <g className={part("pm", "mission-mdb")}>
      <path d="M219 355L240 343L265 358L244 370Z" className="mission-steel-top" />
      <path d="M219 355L244 370L244 408L219 394Z" className="mission-cabinet-face" />
      <path d="M244 370L265 358L265 396L244 408Z" className="mission-steel-side" />
      <path d="M224 367l15 9v23l-15-9Z" className="mission-cabinet-panel" />
      <path d="M233 376l-4 7h6l-4 7" className="mission-electric" />
      <path d="M265 390L298 408L305 399" className="mission-cable" />
    </g>
    {TARGETS.map((target,index)=> <g key={target.key} className={cn("mission-callout", activeKey === target.key && "is-active")} role="button" tabIndex={0} aria-label={`เลือก ${AXES[target.key]}`} aria-pressed={activeKey === target.key} onClick={()=>onSelect(target.key)} onKeyDown={e=>{if(e.key==="Enter"||e.key===" "){e.preventDefault();onSelect(target.key);}}}>
      <path d={`M${target.x} ${target.y}H${target.x < 280 ? target.x+43 : target.x-40}L${target.point[0]} ${target.point[1]}`} className="mission-leader" />
      <circle cx={target.point[0]} cy={target.point[1]} r="4" className="mission-anchor" />
      <rect x={target.x-15} y={target.y-15} width="30" height="30" rx="4" className="mission-callout-box" />
      <text x={target.x} y={target.y+5} textAnchor="middle" className="mission-callout-number">{String(index+1).padStart(2,"0")}</text>
      <text x={target.x} y={target.y+32} textAnchor="middle" className="mission-callout-label">{target.label}</text>
    </g>)}
  </svg>;
}

export function AssetIsometricRisk({ risk, parts, actions, queueTitle, events, historyAvailable }: {
  risk: AssetRisk; parts: RiskPart[]; actions: RiskAction[]; queueTitle: string; events?: HistoryEvent[]; historyAvailable?: boolean;
}) {
  const [activeKey, setActiveKey] = useState("open");
  const [period, setPeriod] = useState<30 | 90>(30);
  const active = parts.find(p => p.key === activeKey) ?? parts[0];
  const profile = parts.map(p => ({ axis: AXES[p.key] ?? p.label, value: p.max > 0 ? Math.min(100, p.value / p.max * 100) : 0 }));
  const trend = useMemo(() => {
    const today = new Date();
    const counts = new Map<string, { claims: number; pm: number }>();
    for (const event of events ?? []) {
      const key = event.eventAt.slice(0,10);
      const count = counts.get(key) ?? {claims:0,pm:0};
      if(event.type === "Claim") count.claims++; else count.pm++;
      counts.set(key, count);
    }
    return Array.from({length:period},(_,i) => {
      const day = new Date(Date.UTC(today.getUTCFullYear(),today.getUTCMonth(),today.getUTCDate() - period + 1 + i));
      const key = day.toISOString().slice(0,10);
      return { date: `${day.getUTCDate()}/${day.getUTCMonth()+1}`, ...(counts.get(key) ?? {claims:0,pm:0}) };
    });
  }, [events, period]);
  const sendToRoutePlan = () => {
    window.sessionStorage.setItem("ad_photo_route", JSON.stringify({ codes: [risk.code], label: `ตรวจป้ายเสี่ยง ${risk.code}` }));
    toast.success(`ส่ง ${risk.code} เข้าแผนตรวจแล้ว`);
    window.location.href = "/route-monitoring";
  };
  return <section aria-label={`ผังความเสี่ยง 2.5D ของ ${risk.code}`} className="risk-twin mission-control" data-level={risk.level}>
    <div className="mission-workspace">
      <aside className="mission-factors" aria-label="องค์ประกอบคะแนนความเสี่ยง">
        <div className="mission-asset-summary">
          <div className="flex flex-wrap items-center gap-2"><h2 className="font-mono text-2xl font-bold" data-testid="twin-asset-code">{risk.code}</h2><span className="mission-status"><ShieldAlert className="size-3" />{RISK_LABELS[risk.level]}</span></div>
          <p className="mt-2 text-[11px] leading-relaxed text-muted-foreground">{[risk.department, risk.mediaType, risk.district].filter(Boolean).join(" · ") || "ไม่ระบุข้อมูลพื้นที่"}</p>
          <div className="mt-4 flex items-end justify-between border-t pt-3"><span className="text-[11px] text-muted-foreground">คะแนนความเสี่ยง</span><span className="font-mono text-3xl font-bold mission-score">{risk.score}<span className="text-sm text-muted-foreground">/100</span></span></div>
        </div>
        <div className="mission-factor-list">{parts.map((part,index)=><FactorGauge key={part.key} part={part} index={index} selected={part.key===activeKey} onSelect={()=>setActiveKey(part.key)} />)}</div>
      </aside>
      <div className="mission-main">
        <div className="mission-visuals">
          <div className="mission-anatomy">
            <div className="mission-section-label"><span>OOH ASSET ANATOMY</span><span className="font-mono text-[10px] text-muted-foreground">PLAN B · OPERATIONS</span></div>
            <BillboardAnatomy code={risk.code} activeKey={activeKey} onSelect={setActiveKey} />
            <div className="mission-model-caption">โครงสร้างประกอบข้อมูลความเสี่ยง · ไม่ใช่ผลวินิจฉัยชิ้นส่วน</div>
          </div>
          <aside className="mission-analytics" aria-label="การวิเคราะห์ความเสี่ยง">
            <div className="mission-profile">
              <h3 className="mission-section-label">RISK PROFILE</h3>
              <p className="mt-1 text-[10px] text-muted-foreground">สัดส่วนคะแนนต่อเพดานแต่ละปัจจัย (%)</p>
              <div className="mission-radar"><ResponsiveContainer width="100%" height="100%"><RadarChart data={profile} outerRadius="65%"><PolarGrid stroke="var(--border)" /><PolarAngleAxis dataKey="axis" tick={{fill:"var(--muted-foreground)",fontSize:10}} /><PolarRadiusAxis domain={[0,100]} tick={false} axisLine={false} /><Radar dataKey="value" stroke="var(--mission-cyan)" fill="var(--mission-cyan)" fillOpacity={0.16} strokeWidth={2} isAnimationActive={false} /><Tooltip formatter={(v)=>[`${Number(v).toFixed(0)}%`,"สัดส่วนคะแนน"]} contentStyle={{background:"var(--card)",borderColor:"var(--border)",color:"var(--foreground)",fontSize:11}} /></RadarChart></ResponsiveContainer></div>
            </div>
            <div className="mission-history">
              <div className="flex flex-wrap items-center justify-between gap-2"><h3 className="mission-section-label">CLAIM / PM HISTORY</h3><div className="flex gap-0.5" role="group" aria-label="ช่วงประวัติ"><Button size="sm" variant={period===30?"secondary":"ghost"} onClick={()=>setPeriod(30)} aria-pressed={period===30} className="h-6 px-2 text-[10px]">30D</Button><Button size="sm" variant={period===90?"secondary":"ghost"} onClick={()=>setPeriod(90)} aria-pressed={period===90} className="h-6 px-2 text-[10px]">90D</Button></div></div>
              <div className="mt-2 flex gap-3 text-[10px] text-muted-foreground"><span className="flex items-center gap-1"><i className="size-1.5 rounded-full bg-destructive" />Claim</span><span className="flex items-center gap-1"><i className="size-1.5 rounded-full bg-primary" />PM</span><span className="ml-auto">ครั้ง / วัน</span></div>
              <div className="mission-trend">{historyAvailable ? <ResponsiveContainer width="100%" height="100%"><AreaChart data={trend} margin={{left:-24,right:4,top:10,bottom:0}}><CartesianGrid stroke="var(--border)" strokeDasharray="3 4" vertical={false} /><XAxis dataKey="date" minTickGap={35} tick={{fill:"var(--muted-foreground)",fontSize:9}} axisLine={false} tickLine={false}/><YAxis allowDecimals={false} tick={{fill:"var(--muted-foreground)",fontSize:9}} axisLine={false} tickLine={false}/><Tooltip contentStyle={{background:"var(--card)",borderColor:"var(--border)",color:"var(--foreground)",fontSize:11}}/><Area type="stepAfter" dataKey="claims" name="Claim" stroke="var(--destructive)" fill="var(--destructive)" fillOpacity={0.08} strokeWidth={1.5} isAnimationActive={false}/><Area type="stepAfter" dataKey="pm" name="PM" stroke="var(--primary)" fill="var(--primary)" fillOpacity={0.06} strokeWidth={1.5} isAnimationActive={false}/></AreaChart></ResponsiveContainer> : <div className="grid h-full place-items-center text-xs text-muted-foreground">ไม่สามารถโหลดประวัติได้</div>}</div>
            </div>
          </aside>
        </div>
        {active && <div className="mission-context" aria-live="polite"><Activity className="size-5 shrink-0"/><div><h3 className="text-sm font-semibold">{active.label}</h3><p className="mt-1 text-[11px] text-muted-foreground">{active.detail}{active.key === "pm" && risk.daysSincePm == null ? " · ไม่มีข้อมูล PM ไม่ได้หมายความว่าทำ PM แล้ว" : ""}{active.key === "open" && risk.topProblem ? ` · ปัญหาที่พบ: ${risk.topProblem}` : ""}</p></div></div>}
        <div className="mission-actions"><h3 className="flex items-start gap-2 text-sm font-semibold"><Wrench className="size-4 shrink-0 mt-0.5"/>{queueTitle}</h3><div className="mission-protocol">{actions.map((action,index)=><div key={action.title} className="mission-action"><div className="flex items-start gap-2"><span className="mission-step">{index+1}</span><h4 className="text-xs font-semibold leading-relaxed">{action.title}</h4></div><p className="mt-2 text-[10px] text-muted-foreground">{action.owner} · {action.deadline}</p><p className="mt-1 text-[11px] leading-relaxed text-muted-foreground">{action.done}</p>{index<actions.length-1&&<ArrowRight className="mission-action-arrow size-3.5"/>}</div>)}</div></div>
        <div className="mission-footer"><span className="text-[10px] text-muted-foreground">คะแนนบันทึกรอบล่าสุด · เคลมค้างจากข้อมูลล่าสุด</span><div className="flex flex-wrap gap-2"><Button asChild size="sm" variant="outline"><Link to="/search" search={{q:risk.code}}><History/>Asset History 360°</Link></Button><Button size="sm" onClick={sendToRoutePlan}><Navigation/>ส่งเข้า Route Monitoring</Button></div></div>
      </div>
    </div>
  </section>;
}
