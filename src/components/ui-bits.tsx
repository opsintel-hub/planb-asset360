import { cn } from "@/lib/utils";

export function StatCard({
  label,
  value,
  delta,
  icon,
  tone = "default",
}: {
  label: string;
  value: string | number;
  delta?: string;
  icon?: React.ReactNode;
  tone?: "default" | "success" | "warning" | "danger";
}) {
  const toneClass = {
    default: "text-primary bg-primary/10",
    success: "text-success bg-success/10",
    warning: "text-warning bg-warning/10",
    danger: "text-destructive bg-destructive/10",
  }[tone];

  return (
    <div className="rounded-xl border bg-card p-4 sm:p-5 shadow-[var(--shadow-card)] hover:shadow-[var(--shadow-elegant)] transition-all">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="text-[11px] sm:text-xs uppercase tracking-wider text-muted-foreground font-medium truncate">
            {label}
          </div>
          <div className="mt-2 text-2xl sm:text-3xl font-bold tracking-tight tabular-nums">{value}</div>
          {delta && (
            <div className="mt-1 text-xs text-muted-foreground truncate">{delta}</div>
          )}
        </div>
        {icon && (
          <div className={cn("size-9 sm:size-10 shrink-0 rounded-lg grid place-items-center", toneClass)}>
            {icon}
          </div>
        )}
      </div>
    </div>
  );
}

export function PageHeader({
  title,
  subtitle,
  actions,
}: {
  title: string;
  subtitle?: string;
  actions?: React.ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-3 sm:gap-4 mb-4 sm:mb-6">
      <div className="min-w-0 flex-1">
        <h1 className="text-xl sm:text-2xl lg:text-3xl font-bold tracking-tight text-foreground">
          {title}
        </h1>
        {subtitle && (
          <p className="mt-1 text-xs sm:text-sm text-muted-foreground">{subtitle}</p>
        )}
      </div>
      {actions && <div className="flex items-center gap-2 shrink-0">{actions}</div>}
    </div>
  );
}

export function Badge({
  children,
  tone = "default",
}: {
  children: React.ReactNode;
  tone?: "default" | "success" | "warning" | "danger" | "info";
}) {
  const cls = {
    default: "bg-muted text-muted-foreground",
    success: "bg-success/15 text-success",
    warning: "bg-warning/15 text-[oklch(0.45_0.15_75)]",
    danger: "bg-destructive/15 text-destructive",
    info: "bg-primary/10 text-primary",
  }[tone];
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium",
        cls,
      )}
    >
      {children}
    </span>
  );
}
