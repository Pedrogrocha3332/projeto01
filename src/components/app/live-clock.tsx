import { useEffect, useState } from "react";

const TZ = "America/Sao_Paulo";

const dateFmt = new Intl.DateTimeFormat("pt-BR", {
  timeZone: TZ,
  weekday: "short",
  day: "2-digit",
  month: "short",
});

const timeFmt = new Intl.DateTimeFormat("pt-BR", {
  timeZone: TZ,
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  hour12: false,
});

export function LiveClock({ compact = false }: { compact?: boolean }) {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(id);
  }, []);

  const time = timeFmt.format(now);
  const date = dateFmt.format(now);

  if (compact) {
    return (
      <span className="font-mono tabular-nums text-xs text-muted-foreground">
        {time}
      </span>
    );
  }

  return (
    <div className="inline-flex items-center gap-2 rounded-lg border border-border/60 bg-card/60 px-3 py-1.5 text-xs">
      <span className="text-muted-foreground capitalize">{date}</span>
      <span className="h-3 w-px bg-border" />
      <span className="font-mono tabular-nums font-semibold gold-text text-sm">{time}</span>
      <span className="text-[10px] text-muted-foreground">SP</span>
    </div>
  );
}

/** Retorna a data/hora atual formatada em America/Sao_Paulo (para uso em UI). */
export function nowInSaoPaulo(): string {
  return timeFmt.format(new Date());
}
