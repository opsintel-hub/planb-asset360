import { useState, useRef } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Download, Upload, FileSpreadsheet, AlertTriangle, CheckCircle2 } from "lucide-react";
import * as XLSX from "xlsx";
import { toast } from "sonner";
import { listInformedMapping, replaceInformedMapping } from "@/lib/mapping.functions";
import { Badge } from "@/components/ui-bits";
import { cn } from "@/lib/utils";

const VALID_IMPACTS = [
  "จอดับ/ไม่เห็นโฆษณา",
  "แสดงผลไม่สมบูรณ์",
  "ไม่มีผลต่อการมองเห็น",
];

const HEADERS = ["informed", "impact_level", "informed_group", "team", "informed_detail"] as const;
type Row = { informed: string; impact_level: string; informed_group: string | null; team: string | null; informed_detail: string };

export function MappingImportExport() {
  const listFn = useServerFn(listInformedMapping);
  const replaceFn = useServerFn(replaceInformedMapping);
  const qc = useQueryClient();
  const fileRef = useRef<HTMLInputElement>(null);
  const [preview, setPreview] = useState<{ rows: Row[]; errors: string[] } | null>(null);

  const { data, isLoading } = useQuery({
    queryKey: ["informed-mapping"],
    queryFn: () => listFn({}),
    staleTime: 60_000,
  });
  const rows = (data?.rows ?? []) as Row[];

  const mutation = useMutation({
    mutationFn: async (rows: Row[]) => replaceFn({ data: { rows } }),
    onSuccess: (res) => {
      toast.success(`อัปเดต Mapping สำเร็จ (${res.count} แถว)`);
      qc.invalidateQueries({ queryKey: ["informed-mapping"] });
      qc.invalidateQueries({ queryKey: ["pm-insights"] });
      setPreview(null);
      if (fileRef.current) fileRef.current.value = "";
    },
    onError: (e: Error) => toast.error(e.message),
  });

  function handleExport() {
    const data = rows.map((r) => ({
      informed: r.informed,
      impact_level: r.impact_level,
      informed_group: r.informed_group ?? "",
      team: r.team ?? "",
      informed_detail: r.informed_detail,
    }));
    const ws = XLSX.utils.json_to_sheet(data, { header: HEADERS as unknown as string[] });
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Mapping");
    XLSX.writeFile(wb, `informed_mapping_${new Date().toISOString().slice(0, 10)}.xlsx`);
  }

  async function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const buf = await file.arrayBuffer();
      const wb = XLSX.read(buf, { type: "array" });
      const ws = wb.Sheets[wb.SheetNames[0]];
      const json = XLSX.utils.sheet_to_json<Record<string, unknown>>(ws, { defval: "" });
      const errors: string[] = [];
      const parsed: Row[] = [];
      json.forEach((r, i) => {
        const line = i + 2;
        const informed = String(r.informed ?? "").trim();
        const impact = String(r.impact_level ?? "").trim();
        const detail = String(r.informed_detail ?? "").trim();
        const group = String(r.informed_group ?? "").trim();
        const team = String(r.team ?? "").trim();
        if (!informed) return errors.push(`แถว ${line}: ขาด informed`);
        if (!VALID_IMPACTS.includes(impact)) return errors.push(`แถว ${line}: impact_level ไม่ถูกต้อง "${impact}"`);
        if (!detail) return errors.push(`แถว ${line}: ขาด informed_detail`);
        parsed.push({ informed, impact_level: impact, informed_group: group || null, team: team || null, informed_detail: detail });
      });
      if (parsed.length === 0 && errors.length === 0) errors.push("ไฟล์ไม่มีข้อมูล");
      setPreview({ rows: parsed, errors });
    } catch (err) {
      toast.error("อ่านไฟล์ไม่สำเร็จ: " + (err as Error).message);
    }
  }

  return (
    <div className="space-y-4">
      <div className="rounded-2xl border bg-card p-5">
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div>
            <h3 className="text-base font-semibold flex items-center gap-2">
              <FileSpreadsheet className="size-5 text-primary" />
              Informed Mapping (ใช้คำนวณ Impact ใน PM Insights)
            </h3>
            <p className="text-sm text-muted-foreground mt-1">
              {isLoading ? "กำลังโหลด…" : `ปัจจุบันมี ${rows.length} รายการ`} — Import ไฟล์ใหม่จะแทนที่ข้อมูลเดิมทั้งหมด
            </p>
          </div>
          <div className="flex gap-2">
            <button
              onClick={handleExport}
              disabled={isLoading || rows.length === 0}
              className="inline-flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-medium bg-card border hover:bg-accent disabled:opacity-50"
            >
              <Download className="size-4" /> Export .xlsx
            </button>
            <label className="inline-flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-medium bg-primary text-primary-foreground hover:opacity-90 cursor-pointer">
              <Upload className="size-4" /> Import .xlsx
              <input ref={fileRef} type="file" accept=".xlsx,.csv" className="hidden" onChange={handleFile} />
            </label>
          </div>
        </div>
        <div className="mt-3 text-xs text-muted-foreground">
          คอลัมน์ที่ต้องมี: <code className="font-mono">{HEADERS.join(", ")}</code> — <code className="font-mono">impact_level</code> ต้องเป็นค่าใดค่าหนึ่ง: {VALID_IMPACTS.join(" / ")}
        </div>
      </div>

      {preview && (
        <div className="rounded-2xl border bg-card p-5 space-y-3">
          <div className="flex items-center justify-between flex-wrap gap-2">
            <h4 className="font-semibold">ตัวอย่างก่อนยืนยัน</h4>
            <div className="flex gap-2 items-center">
              <Badge tone={preview.errors.length ? "danger" : "success"}>
                {preview.errors.length ? `${preview.errors.length} ข้อผิดพลาด` : `พร้อม ${preview.rows.length} แถว`}
              </Badge>
              <button onClick={() => setPreview(null)} className="rounded-lg px-3 py-1.5 text-sm border hover:bg-accent">ยกเลิก</button>
              <button
                onClick={() => mutation.mutate(preview.rows)}
                disabled={mutation.isPending || preview.rows.length === 0 || preview.errors.length > 0}
                className="inline-flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-medium bg-primary text-primary-foreground hover:opacity-90 disabled:opacity-50"
              >
                <CheckCircle2 className="size-4" />
                {mutation.isPending ? "กำลังบันทึก…" : `ยืนยันแทนที่ทั้งหมด`}
              </button>
            </div>
          </div>

          {preview.errors.length > 0 && (
            <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-sm">
              <div className="font-medium text-destructive flex items-center gap-2 mb-1">
                <AlertTriangle className="size-4" /> พบข้อผิดพลาด
              </div>
              <ul className="list-disc pl-5 space-y-0.5 max-h-40 overflow-auto">
                {preview.errors.slice(0, 50).map((e, i) => <li key={i}>{e}</li>)}
                {preview.errors.length > 50 && <li>… อีก {preview.errors.length - 50} รายการ</li>}
              </ul>
            </div>
          )}

          <div className="overflow-auto max-h-96 border rounded-lg">
            <table className="w-full text-sm">
              <thead className="bg-muted/50 sticky top-0">
                <tr>{HEADERS.map((h) => <th key={h} className="text-left px-3 py-2 font-medium">{h}</th>)}</tr>
              </thead>
              <tbody>
                {preview.rows.slice(0, 100).map((r, i) => (
                  <tr key={i} className={cn("border-t", i % 2 && "bg-muted/20")}>
                    <td className="px-3 py-1.5">{r.informed}</td>
                    <td className="px-3 py-1.5">{r.impact_level}</td>
                    <td className="px-3 py-1.5">{r.informed_group}</td>
                    <td className="px-3 py-1.5">{r.team}</td>
                    <td className="px-3 py-1.5">{r.informed_detail}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {preview.rows.length > 100 && <div className="text-xs text-muted-foreground p-2">แสดง 100 แถวแรกจากทั้งหมด {preview.rows.length}</div>}
          </div>
        </div>
      )}
    </div>
  );
}
