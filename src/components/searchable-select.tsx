import { useEffect, useMemo, useRef, useState } from "react";
import { Check, ChevronDown, Search, X } from "lucide-react";
import { cn } from "@/lib/utils";

type Props = {
  value: string;
  onChange: (value: string) => void;
  options: string[];
  /** Label shown when value === allValue */
  allLabel?: string;
  allValue?: string;
  placeholder?: string;
  className?: string;
  title?: string;
};

/**
 * Compact searchable dropdown (combobox) for long option lists such as CRM brands.
 * Shows live filtered suggestions while typing.
 */
export default function SearchableSelect({
  value,
  onChange,
  options,
  allLabel = "ทั้งหมด",
  allValue = "all",
  placeholder = "พิมพ์เพื่อค้นหา...",
  className,
  title,
}: Props) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const [activeIdx, setActiveIdx] = useState(0);
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);

  const list = useMemo(() => {
    const items = [{ value: allValue, label: allLabel }, ...options.map((o) => ({ value: o, label: o }))];
    const needle = q.trim().toLowerCase();
    if (!needle) return items;
    return items.filter((i) => i.label.toLowerCase().includes(needle));
  }, [options, q, allLabel, allValue]);

  useEffect(() => {
    const onDoc = (e: MouseEvent) => {
      if (!wrapRef.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, []);

  useEffect(() => {
    if (open) {
      setQ("");
      setActiveIdx(0);
      const t = setTimeout(() => inputRef.current?.focus(), 0);
      return () => clearTimeout(t);
    }
  }, [open]);

  const pick = (v: string) => {
    onChange(v);
    setOpen(false);
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActiveIdx((i) => Math.min(i + 1, list.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActiveIdx((i) => Math.max(i - 1, 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      const item = list[activeIdx];
      if (item) pick(item.value);
    } else if (e.key === "Escape") {
      setOpen(false);
    }
  };

  const display = value === allValue ? allLabel : value;

  return (
    <div ref={wrapRef} className={cn("relative", className)} title={title}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className={cn(
          "h-9 w-full rounded-md border bg-background pl-2.5 pr-7 text-xs inline-flex items-center gap-1.5 hover:bg-accent",
          value !== allValue && "border-primary text-primary",
        )}
      >
        <span className="truncate">{display}</span>
        <ChevronDown className="size-3.5 absolute right-2 top-1/2 -translate-y-1/2 opacity-60" />
      </button>

      {open && (
        <div className="absolute z-[1200] left-0 mt-1 w-[260px] max-w-[80vw] rounded-md border bg-popover shadow-lg overflow-hidden">
          <div className="relative border-b">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 size-3.5 text-muted-foreground pointer-events-none" />
            <input
              ref={inputRef}
              value={q}
              onChange={(e) => {
                setQ(e.target.value);
                setActiveIdx(0);
              }}
              onKeyDown={onKeyDown}
              placeholder={placeholder}
              className="h-9 w-full bg-transparent pl-8 pr-7 text-xs focus:outline-none"
            />
            {q && (
              <button
                type="button"
                onClick={() => setQ("")}
                className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
              >
                <X className="size-3.5" />
              </button>
            )}
          </div>
          <ul className="max-h-72 overflow-auto py-1">
            {list.length === 0 && (
              <li className="px-3 py-2 text-xs text-muted-foreground">ไม่พบรายการที่ใกล้เคียง</li>
            )}
            {list.map((item, i) => (
              <li key={item.value}>
                <button
                  type="button"
                  onClick={() => pick(item.value)}
                  onMouseEnter={() => setActiveIdx(i)}
                  className={cn(
                    "w-full flex items-center gap-2 px-3 py-1.5 text-left text-xs",
                    i === activeIdx ? "bg-accent" : "hover:bg-accent/60",
                  )}
                >
                  <Check className={cn("size-3.5 shrink-0", item.value === value ? "opacity-100 text-primary" : "opacity-0")} />
                  <span className="truncate">{item.label}</span>
                </button>
              </li>
            ))}
          </ul>
          {options.length > 0 && (
            <div className="px-3 py-1.5 border-t text-[11px] text-muted-foreground">
              {list.length} / {options.length + 1} รายการ
            </div>
          )}
        </div>
      )}
    </div>
  );
}
