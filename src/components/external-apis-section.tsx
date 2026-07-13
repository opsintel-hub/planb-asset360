import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { CheckCircle2, XCircle, Loader2, Zap, ExternalLink } from "lucide-react";
import { toast } from "sonner";
import { pingOverpass, pingOsrm, pingNominatim, type PingResult } from "@/lib/external-apis.functions";
import { pingGoogleMaps } from "@/lib/billboard-mockups.functions";

type ApiCard = {
  id: string;
  name: string;
  purpose: string;
  cost: string;
  endpoint: string;
  docsUrl?: string;
  rateLimit?: string;
  pingFn: () => ReturnType<typeof useServerFn>;
};

function ApiStatusCard({
  name, purpose, cost, endpoint, docsUrl, rateLimit,
  pingResult, onPing, pinging,
}: {
  name: string; purpose: string; cost: string; endpoint: string;
  docsUrl?: string; rateLimit?: string;
  pingResult?: PingResult; onPing: () => void; pinging: boolean;
}) {
  const status: "unknown" | "ok" | "fail" = !pingResult ? "unknown" : pingResult.ok ? "ok" : "fail";
  const dotClass = status === "ok" ? "bg-green-500" : status === "fail" ? "bg-red-500" : "bg-slate-400";
  const label = status === "ok" ? "พร้อมใช้งาน" : status === "fail" ? "ล้มเหลว" : "ยังไม่ได้ทดสอบ";
  return (
    <div className="rounded-xl border bg-card p-4 space-y-3">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <span className={`inline-block size-2.5 rounded-full ${dotClass}`} />
            <div className="font-semibold text-sm">{name}</div>
            <span className="text-[10px] text-muted-foreground">{label}</span>
          </div>
          <div className="mt-1 text-xs text-muted-foreground">{purpose}</div>
        </div>
        <button
          onClick={onPing}
          disabled={pinging}
          className="h-8 px-3 rounded-md border text-xs hover:bg-accent inline-flex items-center gap-1 disabled:opacity-40"
        >
          {pinging ? <Loader2 className="size-3.5 animate-spin" /> : <Zap className="size-3.5" />}
          ทดสอบเชื่อมต่อ
        </button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-x-4 gap-y-1 text-[11px]">
        <div><span className="text-muted-foreground">ค่าใช้จ่าย:</span> <b>{cost}</b></div>
        {rateLimit && <div><span className="text-muted-foreground">Rate limit:</span> <b>{rateLimit}</b></div>}
        <div className="md:col-span-2 truncate">
          <span className="text-muted-foreground">Endpoint:</span>{" "}
          <code className="text-[10px] bg-muted px-1 py-0.5 rounded">{endpoint}</code>
        </div>
        {docsUrl && (
          <div className="md:col-span-2">
            <a href={docsUrl} target="_blank" rel="noreferrer"
              className="text-blue-600 dark:text-blue-400 hover:underline text-[11px] inline-flex items-center gap-1">
              <ExternalLink className="size-3" /> ดูเอกสาร API
            </a>
          </div>
        )}
      </div>

      {pingResult && (
        <div className={`rounded-md border px-3 py-2 text-xs flex items-center gap-2 ${
          pingResult.ok ? "bg-green-50 dark:bg-green-950/30 border-green-200 text-green-900 dark:text-green-100"
                        : "bg-red-50 dark:bg-red-950/30 border-red-200 text-red-900 dark:text-red-100"
        }`}>
          {pingResult.ok ? <CheckCircle2 className="size-4 shrink-0" /> : <XCircle className="size-4 shrink-0" />}
          <div className="flex-1 truncate">{pingResult.message}</div>
          {pingResult.ok && <div className="text-[11px] tabular-nums shrink-0">{pingResult.latencyMs} ms</div>}
        </div>
      )}
    </div>
  );
}

export function ExternalApisSection() {
  const overpassFn = useServerFn(pingOverpass);
  const osrmFn = useServerFn(pingOsrm);
  const nominatimFn = useServerFn(pingNominatim);

  const [results, setResults] = useState<Record<string, PingResult>>({});

  const overpassMut = useMutation({
    mutationFn: () => overpassFn({}),
    onSuccess: (r) => {
      setResults((p) => ({ ...p, overpass: r }));
      if (r.ok) toast.success(`Overpass OK · ${r.latencyMs} ms`);
      else toast.error(`Overpass ล้มเหลว: ${r.message}`);
    },
  });
  const osrmMut = useMutation({
    mutationFn: () => osrmFn({}),
    onSuccess: (r) => {
      setResults((p) => ({ ...p, osrm: r }));
      if (r.ok) toast.success(`OSRM OK · ${r.latencyMs} ms`);
      else toast.error(`OSRM ล้มเหลว: ${r.message}`);
    },
  });
  const nominatimMut = useMutation({
    mutationFn: () => nominatimFn({}),
    onSuccess: (r) => {
      setResults((p) => ({ ...p, nominatim: r }));
      if (r.ok) toast.success(`Nominatim OK · ${r.latencyMs} ms`);
      else toast.error(`Nominatim ล้มเหลว: ${r.message}`);
    },
  });

  return (
    <div className="space-y-4">
      <div className="rounded-xl border bg-blue-50 dark:bg-blue-950/30 p-4 text-xs">
        <div className="font-semibold text-blue-900 dark:text-blue-100 mb-1">
          API ภายนอก (External APIs) — ฟรี ไม่มีค่าใช้จ่าย
        </div>
        <div className="text-blue-800 dark:text-blue-200">
          หน้านี้แสดงสถานะการเชื่อมต่อกับบริการแผนที่/POI ภายนอกที่ระบบใช้งาน
          กด <b>"ทดสอบเชื่อมต่อ"</b> เพื่อยิงคำขอจริงจากเซิร์ฟเวอร์ไปยัง provider
          และดูสถานะ + ความเร็ว
        </div>
      </div>

      <ApiStatusCard
        name="Overpass API (OpenStreetMap)"
        purpose="ค้นหาสถานที่ (POI) เช่น ห้าง โชว์รูมรถ BTS/MRT ป้ายรถเมล์ โรงเรียน โรงพยาบาล ฯลฯ ใช้สำหรับโหมด 'ค้นหาใกล้ POI' บนหน้าแผนที่"
        cost="ฟรี ไม่ต้องสมัคร API key"
        rateLimit="~10,000 req/วัน ต่อ IP"
        endpoint="https://overpass-api.de/api/interpreter"
        docsUrl="https://wiki.openstreetmap.org/wiki/Overpass_API"
        pingResult={results.overpass}
        onPing={() => overpassMut.mutate()}
        pinging={overpassMut.isPending}
      />

      <ApiStatusCard
        name="OSRM Routing"
        purpose="คำนวณเส้นทางบนถนนจริง (Route/Trip) ใช้สำหรับ 'Auto Route' และ 'Optimize' ในโหมด Inspection"
        cost="ฟรี (public demo server, project-osrm.org)"
        rateLimit="ไม่ระบุ (fair-use)"
        endpoint="https://router.project-osrm.org/route/v1/driving/..."
        docsUrl="http://project-osrm.org/docs/v5.24.0/api/"
        pingResult={results.osrm}
        onPing={() => osrmMut.mutate()}
        pinging={osrmMut.isPending}
      />

      <ApiStatusCard
        name="Nominatim (Geocoding)"
        purpose="แปลงชื่อสถานที่/ที่อยู่ → พิกัด (ใช้เสริมในอนาคต)"
        cost="ฟรี"
        rateLimit="1 req/วินาที (nominatim.openstreetmap.org)"
        endpoint="https://nominatim.openstreetmap.org/search"
        docsUrl="https://nominatim.org/release-docs/latest/api/Search/"
        pingResult={results.nominatim}
        onPing={() => nominatimMut.mutate()}
        pinging={nominatimMut.isPending}
      />

      <div className="rounded-xl border bg-yellow-50 dark:bg-yellow-950/20 border-yellow-200 p-4 text-xs">
        <div className="font-semibold text-yellow-900 dark:text-yellow-100 mb-1">
          🟡 Google Maps / Street View (Optional — เพิ่มภายหลัง)
        </div>
        <div className="text-yellow-800 dark:text-yellow-200 space-y-1">
          <p>สำหรับฟีเจอร์ Street View / Mockup / PDF ที่มีภาพถนน — Google ให้ free tier ~$200/เดือน แล้วคิดเงินตาม usage</p>
          <p>เมื่อคุณสมัคร Google Maps API key แล้วจะมีฟอร์มให้กรอกที่นี่ในรอบพัฒนาถัดไป (Phase 3)</p>
        </div>
      </div>
    </div>
  );
}
