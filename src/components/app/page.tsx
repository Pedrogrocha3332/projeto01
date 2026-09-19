import type { ReactNode } from "react";

export function PageHeader({
  title, description, actions,
}: { title: string; description?: string; actions?: ReactNode }) {
  return (
    <div className="border-b border-border/60 bg-background/60 backdrop-blur">
      <div className="mx-auto max-w-7xl px-6 py-6 flex flex-wrap items-end justify-between gap-4">
        <div className="min-w-0">
          <h1 className="font-display text-2xl font-semibold tracking-tight">{title}</h1>
          {description && <p className="mt-1 text-sm text-muted-foreground">{description}</p>}
        </div>
        {actions && <div className="flex items-center gap-2">{actions}</div>}
      </div>
    </div>
  );
}

export function PageBody({ children }: { children: ReactNode }) {
  return <div className="mx-auto max-w-7xl px-6 py-8">{children}</div>;
}

export function EmptyState({
  icon: Icon, title, description, action,
}: { icon: React.ComponentType<{ className?: string }>; title: string; description: string; action?: ReactNode }) {
  return (
    <div className="card-elevated flex flex-col items-center justify-center py-14 px-6 text-center">
      <div className="mb-4 inline-flex h-14 w-14 items-center justify-center rounded-2xl" style={{ background: "var(--gradient-ig-soft)" }}>
        <Icon className="h-6 w-6 text-primary" />
      </div>
      <h3 className="font-display text-lg font-semibold">{title}</h3>
      <p className="mt-1.5 max-w-md text-sm text-muted-foreground">{description}</p>
      {action && <div className="mt-5">{action}</div>}
    </div>
  );
}

export function StatusBadge({ status }: { status: string }) {
  const map: Record<string, string> = {
    scheduled: "bg-chart-5/15 text-chart-5 border-chart-5/30",
    published: "bg-success/15 text-success border-success/30",
    failed: "bg-destructive/15 text-destructive border-destructive/30",
    draft: "bg-muted text-muted-foreground border-border",
    publishing: "bg-warning/15 text-warning border-warning/30",
  };
  return (
    <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-medium capitalize ${map[status] ?? map.draft}`}>
      {status}
    </span>
  );
}

export function GradientButton({ children, ...props }: React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      {...props}
      className={`inline-flex items-center gap-2 rounded-lg ig-gradient px-4 py-2 text-sm font-semibold text-white shadow-lg transition-transform hover:scale-[1.02] disabled:opacity-70 ${props.className ?? ""}`}
    >
      {children}
    </button>
  );
}
