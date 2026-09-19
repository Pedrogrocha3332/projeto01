type Item = { id: string; label: string; consumed?: boolean };
export function VideoOrderList({ items, onChange, disabled = false }: { items: Item[]; onChange: (ids: string[]) => void; disabled?: boolean }) {
  function move(index: number, offset: number) {
    const ids = items.map(item => item.id);
    const target = index + offset;
    if (target < 0 || target >= ids.length) return;
    [ids[index], ids[target]] = [ids[target], ids[index]];
    onChange(ids);
  }
  return <ol className="max-h-64 space-y-1 overflow-y-auto rounded border border-border p-2">
    {items.length === 0 && <li className="text-sm text-muted-foreground">Selecione os vídeos abaixo.</li>}
    {items.map((item, index) => <li key={item.id} className="flex items-center gap-2 text-sm">
      <span className="w-7 shrink-0">{index + 1}.</span>
      <span className="min-w-0 flex-1 truncate" title={item.label}>{item.label}{item.consumed ? " (já enfileirado neste ciclo)" : ""}</span>
      <button type="button" aria-label={`Subir ${item.label}`} disabled={disabled || index === 0} onClick={() => move(index, -1)} className="rounded border px-2 py-1 disabled:opacity-30">↑</button>
      <button type="button" aria-label={`Descer ${item.label}`} disabled={disabled || index === items.length - 1} onClick={() => move(index, 1)} className="rounded border px-2 py-1 disabled:opacity-30">↓</button>
    </li>)}
  </ol>;
}
