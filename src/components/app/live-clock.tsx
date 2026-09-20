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
    <div className="flex items-center justify-between rounded-xl border border-neutral-800 bg-[#141417] px-3.5 py-2.5 text-xs shadow-xs">
      <span className="text-[#A1A1AA] capitalize font-medium">{date}</span>
      <div className="flex items-center gap-1.5">
        <span className="font-mono tabular-nums font-bold text-[#FACC15] text-sm tracking-tight">{time}</span>
        <span className="text-[10px] text-[#71717A] font-semibold">SP</span>
      </div>
    </div>
  );
}

/** Retorna a data/hora atual formatada em America/Sao_Paulo (para uso em UI). */
export function nowInSaoPaulo(): string {
  return timeFmt.format(new Date());
}
