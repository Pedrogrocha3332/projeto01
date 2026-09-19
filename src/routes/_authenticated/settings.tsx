import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { PageHeader, PageBody } from "@/components/app/page";
import { useState } from "react";
import { Hash, FileText, Plus, Trash2, Bell } from "lucide-react";
import { toast } from "sonner";

export const Route = createFileRoute("/_authenticated/settings")({
  component: SettingsPage,
});

function SettingsPage() {
  return (
    <div>
      <PageHeader title="Configurações" description="Notificações, atalhos de hashtags, templates de legenda e uso da API." />
      <PageBody>
        <div className="grid gap-6 lg:grid-cols-2">
          <ProfileCard />
          <NotificationsCard />
          <HashtagGroupsCard />
          <CaptionTemplatesCard />
          <ApiUsageCard />
        </div>
      </PageBody>
    </div>
  );
}

function ProfileCard() {
  const { data: profile } = useQuery({
    queryKey: ["profile"],
    queryFn: async () => (await supabase.from("profiles").select("*").maybeSingle()).data,
  });
  return (
    <div className="card-elevated p-5">
      <h3 className="font-display font-semibold">Perfil</h3>
      <div className="mt-3 text-sm space-y-1">
        <div><span className="text-muted-foreground">E-mail:</span> {profile?.email}</div>
        <div><span className="text-muted-foreground">Fuso horário:</span> America/Sao_Paulo</div>
      </div>
    </div>
  );
}

function NotificationsCard() {
  const qc = useQueryClient();
  const { data: profile } = useQuery({
    queryKey: ["profile"],
    queryFn: async () => (await supabase.from("profiles").select("*").maybeSingle()).data,
  });
  const update = useMutation({
    mutationFn: async (patch: { notification_email?: boolean; notify_on_failed?: boolean; notify_on_token_expiry?: boolean }) => {
      const { error } = await supabase.from("profiles").update(patch).eq("id", profile!.id);
      if (error) throw error;
    },
    onSuccess: () => { toast.success("Salvo"); qc.invalidateQueries({ queryKey: ["profile"] }); },
  });
  const toggles = [
    { key: "notification_email", label: "Notificações por e-mail" },
    { key: "notify_on_failed", label: "Alertar sobre publicações com falha" },
    { key: "notify_on_token_expiry", label: "Alertar antes do token expirar" },
  ] as const;
  return (
    <div className="card-elevated p-5">
      <h3 className="font-display font-semibold flex items-center gap-2"><Bell className="h-4 w-4" /> Notificações</h3>
      <div className="mt-3 space-y-2.5 text-sm">
        {toggles.map((t) => (
          <label key={t.key} className="flex items-center justify-between rounded-lg border border-border/60 p-2.5 cursor-pointer">
            <span>{t.label}</span>
            <input type="checkbox"
              checked={Boolean(profile?.[t.key])}
              onChange={(e) => update.mutate({ [t.key]: e.target.checked } as Parameters<typeof update.mutate>[0])}
              className="h-4 w-4 accent-primary" />
          </label>
        ))}
      </div>
    </div>
  );
}

function HashtagGroupsCard() {
  const qc = useQueryClient();
  const [name, setName] = useState("");
  const [tags, setTags] = useState("");
  const { data: groups = [] } = useQuery({
    queryKey: ["hashtag-groups"],
    queryFn: async () => (await supabase.from("hashtag_groups").select("*").order("created_at")).data ?? [],
  });
  const add = useMutation({
    mutationFn: async () => {
      const { data: u } = await supabase.auth.getUser();
      const arr = tags.split(/[\s,]+/).map((t) => t.replace(/^#/, "")).filter(Boolean);
      const { error } = await supabase.from("hashtag_groups").insert({ user_id: u.user!.id, name, hashtags: arr });
      if (error) throw error;
    },
    onSuccess: () => { setName(""); setTags(""); toast.success("Grupo adicionado"); qc.invalidateQueries({ queryKey: ["hashtag-groups"] }); },
  });
  const del = useMutation({
    mutationFn: async (id: string) => { await supabase.from("hashtag_groups").delete().eq("id", id); },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["hashtag-groups"] }),
  });
  return (
    <div className="card-elevated p-5">
      <h3 className="font-display font-semibold flex items-center gap-2"><Hash className="h-4 w-4" /> Grupos de hashtags</h3>
      <div className="mt-3 space-y-2">
        {groups.map((g) => (
          <div key={g.id} className="flex items-start justify-between gap-2 rounded-lg border border-border/60 p-2.5">
            <div className="min-w-0">
              <div className="text-sm font-medium">{g.name}</div>
              <div className="text-xs text-muted-foreground truncate">{g.hashtags.map((h: string) => `#${h}`).join(" ")}</div>
            </div>
            <button onClick={() => del.mutate(g.id)} className="rounded p-1.5 text-destructive hover:bg-destructive/10" aria-label="Excluir"><Trash2 className="h-3.5 w-3.5" /></button>
          </div>
        ))}
      </div>
      <div className="mt-3 space-y-2">
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Nome do grupo (ex.: Fitness)"
          className="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm" />
        <textarea value={tags} onChange={(e) => setTags(e.target.value)} rows={2} placeholder="#fitness #treino #academia"
          className="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm resize-none" />
        <button onClick={() => add.mutate()} disabled={!name || !tags}
          className="inline-flex items-center gap-1.5 rounded-lg ig-gradient px-3 py-1.5 text-xs font-semibold text-primary-foreground disabled:opacity-50">
          <Plus className="h-3.5 w-3.5" /> Adicionar
        </button>
      </div>
    </div>
  );
}

function CaptionTemplatesCard() {
  const qc = useQueryClient();
  const [name, setName] = useState("");
  const [body, setBody] = useState("");
  const { data: tpls = [] } = useQuery({
    queryKey: ["caption-templates"],
    queryFn: async () => (await supabase.from("caption_templates").select("*").order("created_at")).data ?? [],
  });
  const add = useMutation({
    mutationFn: async () => {
      const { data: u } = await supabase.auth.getUser();
      const { error } = await supabase.from("caption_templates").insert({ user_id: u.user!.id, name, body });
      if (error) throw error;
    },
    onSuccess: () => { setName(""); setBody(""); toast.success("Template salvo"); qc.invalidateQueries({ queryKey: ["caption-templates"] }); },
  });
  const del = useMutation({
    mutationFn: async (id: string) => { await supabase.from("caption_templates").delete().eq("id", id); },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["caption-templates"] }),
  });
  return (
    <div className="card-elevated p-5">
      <h3 className="font-display font-semibold flex items-center gap-2"><FileText className="h-4 w-4" /> Templates de legenda</h3>
      <div className="mt-3 space-y-2">
        {tpls.map((t) => (
          <div key={t.id} className="rounded-lg border border-border/60 p-2.5">
            <div className="flex items-center justify-between">
              <div className="text-sm font-medium">{t.name}</div>
              <button onClick={() => del.mutate(t.id)} className="rounded p-1.5 text-destructive hover:bg-destructive/10" aria-label="Excluir"><Trash2 className="h-3.5 w-3.5" /></button>
            </div>
            <p className="mt-1 text-xs text-muted-foreground whitespace-pre-wrap line-clamp-3">{t.body}</p>
          </div>
        ))}
      </div>
      <div className="mt-3 space-y-2">
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Nome do template"
          className="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm" />
        <textarea value={body} onChange={(e) => setBody(e.target.value)} rows={3} placeholder="Conteúdo…"
          className="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm resize-none" />
        <button onClick={() => add.mutate()} disabled={!name || !body}
          className="inline-flex items-center gap-1.5 rounded-lg ig-gradient px-3 py-1.5 text-xs font-semibold text-primary-foreground disabled:opacity-50">
          <Plus className="h-3.5 w-3.5" /> Salvar template
        </button>
      </div>
    </div>
  );
}

function ApiUsageCard() {
  return (
    <div className="card-elevated p-5">
      <h3 className="font-display font-semibold">Uso da Meta API</h3>
      <p className="mt-1 text-xs text-muted-foreground">Limite: 200 chamadas por hora por token de usuário.</p>
      <div className="mt-4">
        <div className="flex justify-between text-xs text-muted-foreground mb-1"><span>Esta hora</span><span>0 / 200</span></div>
        <div className="h-2 rounded-full bg-muted overflow-hidden">
          <div className="h-full ig-gradient" style={{ width: "0%" }} />
        </div>
      </div>
    </div>
  );
}
