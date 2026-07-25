import { useEffect, useRef, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { Search, Loader2, X, MapPin } from "lucide-react";
import { toast } from "sonner";
import { searchPlacesText, type PlaceSearchResult } from "@/lib/places.functions";
import { cn } from "@/lib/utils";

type Props = {
  onSelect: (place: PlaceSearchResult) => void;
  onClear?: () => void;
  className?: string;
};

const EXAMPLES = ["สุขุมวิท 22", "เดอะมอลล์บางกะปิ", "สาทร", "BTS อโศก", "เซ็นทรัลลาดพร้าว"];

export default function PlaceSearchBox({ onSelect, onClear, className }: Props) {
  const searchFn = useServerFn(searchPlacesText);
  const [text, setText] = useState("");
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [results, setResults] = useState<PlaceSearchResult[]>([]);
  const [activeIdx, setActiveIdx] = useState(0);
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  // Debounced search
  useEffect(() => {
    const q = text.trim();
    if (q.length < 2) {
      setResults([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    const timer = setTimeout(async () => {
      abortRef.current?.abort();
      const ctrl = new AbortController();
      abortRef.current = ctrl;
      try {
        const { results } = await searchFn({ data: { query: q } });
        if (!ctrl.signal.aborted) {
          setResults(results);
          setActiveIdx(0);
        }
      } catch (e) {
        if (!ctrl.signal.aborted) {
          setResults([]);
          const msg = (e as Error).message;
          if (!/aborted/i.test(msg)) console.warn("place search failed:", msg);
        }
      } finally {
        if (!ctrl.signal.aborted) setLoading(false);
      }
    }, 300);
    return () => clearTimeout(timer);
  }, [text, searchFn]);

  useEffect(() => {
    const onDoc = (e: MouseEvent) => {
      if (!wrapRef.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, []);

  const pick = (p: PlaceSearchResult) => {
    setText(p.name);
    setOpen(false);
    onSelect(p);
  };

  const runExample = async (q: string) => {
    setText(q);
    setOpen(true);
    setLoading(true);
    try {
      const { results } = await searchFn({ data: { query: q } });
      setResults(results);
      setActiveIdx(0);
      if (results[0]) pick(results[0]);
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setLoading(false);
    }
  };

  const clearAll = () => {
    setText("");
    setResults([]);
    setOpen(false);
    onClear?.();
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (!open || results.length === 0) {
      if (e.key === "Enter" && text.trim().length >= 2) {
        setOpen(true);
      }
      return;
    }
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActiveIdx((i) => Math.min(i + 1, results.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActiveIdx((i) => Math.max(i - 1, 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      const p = results[activeIdx];
      if (p) pick(p);
    } else if (e.key === "Escape") {
      setOpen(false);
    }
  };

  return (
    <div ref={wrapRef} className={cn("relative", className)}>
      <div className="relative">
        <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 size-4 text-muted-foreground pointer-events-none" />
        <input
          value={text}
          onChange={(e) => { setText(e.target.value); setOpen(true); }}
          onFocus={() => setOpen(true)}
          onKeyDown={onKeyDown}
          placeholder="ค้นหาสถานที่ / ห้าง / BTS / ถนน / ซอย"
          className="h-9 w-full rounded-md border bg-background pl-8 pr-16 text-xs focus:outline-none focus:ring-2 focus:ring-primary/40"
        />
        <div className="absolute right-1.5 top-1/2 -translate-y-1/2 flex items-center gap-1">
          {loading && <Loader2 className="size-3.5 animate-spin text-muted-foreground" />}
          {text && (
            <button
              type="button"
              onClick={clearAll}
              className="p-1 rounded hover:bg-accent text-muted-foreground"
              title="ล้างค่า"
            >
              <X className="size-3.5" />
            </button>
          )}
        </div>
      </div>

      {open && (results.length > 0 || text.trim().length < 2) && (
        <div className="absolute z-[1100] left-0 right-0 mt-1 rounded-md border bg-popover shadow-lg overflow-hidden">
          {text.trim().length < 2 ? (
            <div className="p-2">
              <div className="text-[11px] text-muted-foreground px-1 pb-1">ลองพิมพ์:</div>
              <div className="flex flex-wrap gap-1">
                {EXAMPLES.map((ex) => (
                  <button
                    key={ex}
                    onClick={() => runExample(ex)}
                    className="h-6 px-2 rounded-full border text-[11px] hover:bg-accent"
                  >
                    {ex}
                  </button>
                ))}
              </div>
            </div>
          ) : (
            <ul className="max-h-72 overflow-auto">
              {results.map((r, i) => (
                <li key={r.id}>
                  <button
                    onClick={() => pick(r)}
                    onMouseEnter={() => setActiveIdx(i)}
                    className={cn(
                      "w-full flex items-start gap-2 px-3 py-2 text-left text-xs",
                      i === activeIdx ? "bg-accent" : "hover:bg-accent/60",
                    )}
                  >
                    <MapPin className="size-3.5 mt-0.5 shrink-0 text-primary" />
                    <div className="min-w-0">
                      <div className="font-medium truncate">{r.name}</div>
                      {r.address && (
                        <div className="text-[11px] text-muted-foreground truncate">{r.address}</div>
                      )}
                    </div>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
