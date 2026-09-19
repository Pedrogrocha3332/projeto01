import { useVideoFolders } from "@/lib/video-folders";
type Account = { id: string; username: string };
export function VideoSourceTabs({ accounts, value, onChange }: { accounts: Account[]; value: string; onChange: (value: string) => void }) {
  const folders=useVideoFolders();
  const sources = [{ id: "all", label: "Todas" }, ...(folders.data??[]).map(a => ({ id: a.id, label: a.name })), { id: "unassigned", label: "Sem pasta" }];
  return <div className="mb-3 min-w-0">
    <p className="mb-2 text-xs text-muted-foreground">Pasta dos vídeos</p>
    {folders.error&&<p className="text-xs text-destructive">{folders.error.message}</p>}
    <div role="group" aria-label="Filtrar vídeos por pasta" className="flex gap-2 overflow-x-auto pb-2">
      {sources.map(source => <button key={source.id} type="button" aria-pressed={value === source.id}
        onClick={() => onChange(source.id)}
        className={`shrink-0 rounded-full border px-3 py-2 text-xs ${value === source.id ? "border-primary bg-primary text-primary-foreground" : "border-border bg-card"}`}>
        {source.label}
      </button>)}
    </div>
  </div>;
}
