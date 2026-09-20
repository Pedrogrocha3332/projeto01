import type { ReactNode } from "react";

export function PageHeader({
  title, description, actions,
}: { title: string; description?: string; actions?: ReactNode }) {
  return (
    <div className="border-b border-border/50 bg-background/90 backdrop-blur-xs">
      <div className="mx-auto max-w-7xl px-8 py-7 flex flex-wrap items-center justify-between gap-4">
        <div className="min-w-0">
          <h1 className="text-2xl font-bold tracking-tight text-neutral-900">{title}</h1>
          {description && <p className="mt-1 text-sm text-neutral-500 font-normal">{description}</p>}
        </div>
        {actions && <div className="flex items-center gap-3">{actions}</div>}
      </div>
    </div>
  );
}

export function PageBody({ children }: { children: ReactNode }) {
  return <div className="mx-auto max-w-7xl px-8 py-8">{children}</div>;
}

export function EmptyState({
  icon: Icon, title, description, action,
}: { icon: React.ComponentType<{ className?: string }>; title: string; description: string; action?: ReactNode }) {
  return (
    <div className="card-elevated flex flex-col items-center justify-center py-16 px-6 text-center">
      <div className="mb-4 inline-flex h-12 w-12 items-center justify-center rounded-2xl bg-neutral-100 border border-neutral-200/60 text-neutral-800">
        <Icon className="h-6 w-6" />
      </div>
      <h3 className="text-base font-semibold text-neutral-900">{title}</h3>
      <p className="mt-1.5 max-w-md text-sm text-neutral-500">{description}</p>
      {action && <div className="mt-5">{action}</div>}
    </div>
  );
}

export function StatusBadge({ status }: { status: string }) {
  const map: Record<string, string> = {
    scheduled: "bg-neutral-100 text-neutral-700 border-neutral-200",
    published: "bg-emerald-50 text-emerald-700 border-emerald-200/70",
    failed: "bg-rose-50 text-rose-700 border-rose-200/70",
    draft: "bg-neutral-100 text-neutral-600 border-neutral-200",
    publishing: "bg-amber-50 text-amber-700 border-amber-200/70",
  };
  return (
    <span className={`inline-flex items-center rounded-full border px-2.5 py-0.5 text-[11px] font-medium capitalize tracking-tight ${map[status] ?? map.draft}`}>
      {status}
    </span>
  );
}

export function GradientButton({ children, ...props }: React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      {...props}
      className={`inline-flex items-center gap-2 rounded-xl bg-neutral-900 px-4 py-2.5 text-sm font-semibold text-white shadow-xs transition-all duration-150 hover:bg-neutral-800 active:scale-[0.98] disabled:opacity-50 ${props.className ?? ""}`}
    >
      {children}
    </button>
  );
}
