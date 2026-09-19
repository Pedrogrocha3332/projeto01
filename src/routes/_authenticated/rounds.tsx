import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { PageHeader, PageBody } from "@/components/app/page";
import { PoolVideoPicker } from "@/components/app/pool-video-picker";
import { VideoSourceTabs } from "@/components/app/video-source-tabs";
import { VideoOrderList } from "@/components/app/video-order-list";
import { AssetImage } from "@/components/app/asset-image";
import { filterPoolVideos, loadPoolLibrary } from "@/lib/pool-library";
import { saveRound, controlRound, type RoundConfig } from "@/lib/rounds.functions";

export const Route = createFileRoute("/_authenticated/rounds")({ component: RoundsPage });
const button = "rounded-lg border border-border px-3 py-2 text-sm hover:bg-muted disabled:opacity-40";
const input = "mt-1 w-full rounded-lg border border-input bg-background px-3 py-2 text-sm";
const labels: Record<string,string> = { draft: "Rascunho", active: "Em execução", paused: "Pausada", failed: "Precisa de atenção", completed: "Concluída", cancelled: "Encerrada" };
type Participant = RoundConfig["accounts"][number];
type Run = { id: string; name: string; round_interval_minutes?: number; next_round_at?: string | null; active_participant_ids?: string[]; concurrent_accounts?: number; batch_size: number; total_per_account: number; status: string; last_error: string | null; publication_round_accounts: (Participant & {id:string;position:number;stopped_at?:string|null;stop_reason?:string|null;account_label?:string|null})[] };
type Item = { confirmed_at: string | null; confirmed_media_id: string | null; id: string; sequence: number; round_number: number; account_index: number; participant_id: string; scheduled_posts: { status: string; ig_media_id: string | null; last_error: string | null } | null };

function RoundsPage() {
  const qc = useQueryClient();
  const [editor, setEditor] = useState<RoundConfig | null>(null);
  const [selectedRun, setSelectedRun] = useState<string | null>(null);
  const db = supabase as any;
  const accounts = useQuery({ queryKey: ["round-accounts"], queryFn: async () => {
    const { data, error } = await supabase.from("instagram_accounts").select("id,username").order("username");
    if (error) throw error; return data;
  }});
  const runs = useQuery({ queryKey: ["publication-rounds"], refetchInterval: 5000, queryFn: async (): Promise<Run[]> => {
    const { data, error } = await db.from("publication_rounds").select("*,publication_round_accounts(*)").order("created_at", { ascending:false }).limit(100);
    if (error) throw error; return data.map((run: Run) => ({ ...run, publication_round_accounts: run.publication_round_accounts.filter(a => a.ig_account_id != null) }));
  }});
  const items = useQuery({ queryKey: ["round-progress",selectedRun], enabled: Boolean(selectedRun), refetchInterval: 5000, queryFn: async (): Promise<Item[]> => {
    const rows: Item[] = [];
    for (let offset=0; ; offset+=500) {
      const { data,error } = await db.from("publication_round_items").select("id,sequence,round_number,account_index,participant_id,confirmed_at,confirmed_media_id,scheduled_posts(status,ig_media_id,last_error)")
        .eq("run_id",selectedRun).order("sequence").range(offset,offset+499);
      if(error) throw error; rows.push(...data); if(data.length<500) return rows;
    }
  }});
  const saveFn=useServerFn(saveRound), controlFn=useServerFn(controlRound);
  const save=useMutation({ mutationFn: (config:RoundConfig)=>saveFn({data:config}), onSuccess: r=>{
    setEditor(null);setSelectedRun(r.id);qc.invalidateQueries({queryKey:["publication-rounds"]});toast.success("Rascunho salvo. Nenhuma publicação foi disparada.");
  },onError:e=>toast.error(e.message)});
  const control=useMutation({mutationFn: (data:{id:string;action:"start"|"pause"|"resume"|"cancel"})=>controlFn({data}),onSuccess:()=>{
    qc.invalidateQueries({queryKey:["publication-rounds"]});qc.invalidateQueries({queryKey:["round-progress"]});toast.success("Execução atualizada");
  },onError:e=>toast.error(e.message)});
  const current=runs.data?.find(r=>r.id===selectedRun);
  const visibleIds=new Set(current?.publication_round_accounts.map(a=>a.id)??[]);
  const visibleItems=(items.data??[]).filter(i=>visibleIds.has(i.participant_id));
  const completed=visibleItems.filter(i=>i.confirmed_at&&i.confirmed_media_id);
  const stoppedIds=new Set(current?.publication_round_accounts.filter(a=>a.stopped_at).map(a=>a.id)??[]);
  const skipped=visibleItems.filter(i=>stoppedIds.has(i.participant_id)&&(!i.confirmed_at||!i.confirmed_media_id));
  const next=visibleItems.find(i=>!stoppedIds.has(i.participant_id)&&(!i.confirmed_at||!i.confirmed_media_id));
  const accountName=(id:string)=>"@"+(accounts.data?.find(a=>a.id===id)?.username??id);
  return <div>
    <PageHeader title="Publicação em rodadas" description="Escolha de 1 a 5 contas por vez. Uma conta com erro libera sua vaga para a próxima da fila."
      actions={<button className={button} disabled={save.isPending||Boolean(editor)} onClick={()=>setEditor({id:null,name:"",batch_size:5,concurrent_accounts:3,round_interval_minutes:60,total_per_account:50,accounts:[]})}>Nova execução</button>} />
    <PageBody>
      <p className="mb-4 rounded-lg border border-border p-3 text-sm text-muted-foreground">Se uma conta falhar, os envios dela param nesta execução e as demais continuam automaticamente. Salvar aqui não cria pools normais nem envia posts. Durante uma execução, a publicação normal deste painel fica em espera. O total vale somente para esta execução.</p>
      {(runs.error||accounts.error) && <p role="alert" className="mb-4 text-destructive">Não foi possível carregar as rodadas. Confira a conexão e aplique o SQL de Publicação em rodadas antes de usar esta seção.</p>}
      {editor ? <RoundEditor value={editor} onChange={setEditor} accounts={accounts.data??[]} busy={save.isPending} onSave={()=>save.mutate(editor)} onCancel={()=>setEditor(null)} /> : <>
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {runs.isLoading&&<p>Carregando…</p>}
          {runs.data?.length===0&&<p>Nenhuma execução. Clique em Nova execução para escolher as contas e os vídeos.</p>}
          {runs.data?.map(r=><button key={r.id} onClick={()=>setSelectedRun(r.id)} className={`rounded-xl border p-4 text-left ${selectedRun===r.id?"border-primary":"border-border"}`}>
            <strong>{r.name}</strong><p className="text-sm">{labels[r.status]} · {r.publication_round_accounts.length} contas</p>
            <p className="text-xs text-muted-foreground">{r.concurrent_accounts??2} contas simultâneas · {r.batch_size} por conta/rodada · {r.total_per_account} por conta · {Math.ceil(r.total_per_account/r.batch_size)} rodadas · {r.round_interval_minutes??0} min de espera por conta</p>
          </button>)}
        </div>
        {current&&<section className="mt-5 space-y-4 rounded-xl border border-border p-4">
          <h2 className="font-display text-lg">{current.name} · {labels[current.status]}</h2>
          <p>{completed.length}/{current.total_per_account*current.publication_round_accounts.length} confirmados como publicados{skipped.length>0&&` · ${skipped.length} não enviados por erro de conta`}</p>
          {next&&<p className="text-sm">Rodada {next.round_number}/{Math.ceil(current.total_per_account/current.batch_size)} · Em atendimento: {current.publication_round_accounts.filter(a=>!a.stopped_at&&(current.active_participant_ids?.length ? current.active_participant_ids.includes(a.id) : Math.floor(a.position/(current.concurrent_accounts??2))===Math.floor((current.publication_round_accounts.find(p=>p.id===next.participant_id)?.position??0)/(current.concurrent_accounts??2)))).sort((a,b)=>a.position-b.position).map(a=>accountName(a.ig_account_id)).join(" + ")}</p>}
          {current.status==="active"&&current.next_round_at&&new Date(current.next_round_at).getTime()>Date.now()&&<p className="text-sm text-primary">Aguardando o intervalo das contas em atendimento. Próximo envio a partir de {new Date(current.next_round_at).toLocaleString("pt-BR")}.</p>}
          {items.error&&<p role="alert" className="text-destructive">Falha ao carregar o progresso. Atualize antes de continuar.</p>}
          {current.last_error&&<p role="alert" className="text-destructive">{current.last_error}</p>}
          <ol className="space-y-1 text-sm">{[...current.publication_round_accounts].sort((a,b)=>a.position-b.position).map((a,n)=><li key={a.id}>{n+1}. {a.account_label??accountName(a.ig_account_id)} — {completed.filter(i=>i.participant_id===a.id).length}/{current.total_per_account} publicados{a.stopped_at&&<span className="text-destructive"> · Interrompida nesta execução: {a.stop_reason??"Erro na publicação"}</span>}</li>)}</ol>
          <div className="flex flex-wrap gap-2">
            {current.status==="draft"&&<>
              <button className={button} onClick={()=>setEditor({id:current.id,name:current.name,batch_size:current.batch_size,concurrent_accounts:current.concurrent_accounts??2,round_interval_minutes:current.round_interval_minutes??0,total_per_account:current.total_per_account,accounts:[...current.publication_round_accounts].sort((a,b)=>a.position-b.position)})}>Editar rascunho</button>
              <button className={button} disabled={control.isPending} onClick={()=>{if(window.confirm(`Iniciar ${current.name}? Serão publicados até ${current.total_per_account} reels por conta. Até ${current.concurrent_accounts??2} contas publicarão em paralelo, um vídeo por vez em cada conta. A fila normal precisa estar vazia e os pools normais pausados.`))control.mutate({id:current.id,action:"start"});}}>Iniciar rodadas</button>
            </>}
            {current.status==="active"&&<button className={button} disabled={control.isPending} onClick={()=>control.mutate({id:current.id,action:"pause"})}>Pausar</button>}
            {["paused","failed"].includes(current.status)&&<button className={button} disabled={control.isPending||Boolean(items.error)} onClick={()=>{if(window.confirm("Continuar do mesmo vídeo? Se houve falha, confira a conta e o erro antes de continuar."))control.mutate({id:current.id,action:"resume"});}}>Continuar</button>}
            {["draft","paused","failed"].includes(current.status)&&<button className={button} disabled={control.isPending} onClick={()=>{if(window.confirm("Encerrar esta execução? Vídeos já publicados serão mantidos. Os restantes não serão enviados por esta execução."))control.mutate({id:current.id,action:"cancel"});}}>Encerrar execução</button>}
          </div>
          <p className="text-xs text-muted-foreground">Pausar impede o próximo envio; um envio já iniciado pode terminar. Ao concluir, nenhum pool normal é ativado automaticamente. A execução continua com esta página fechada, pelos crons do painel.</p>
        </section>}
      </>}
    </PageBody>
  </div>;
}

function RoundEditor({value,onChange,accounts,busy,onSave,onCancel}:{value:RoundConfig;onChange:(v:RoundConfig)=>void;accounts:{id:string;username:string}[];busy:boolean;onSave:()=>void;onCancel:()=>void}) {
  const [editing,setEditing]=useState(0),[toAdd,setToAdd]=useState(""),[source,setSource]=useState("all"),[search,setSearch]=useState("");
  const videos=useQuery({queryKey:["media-videos-selectable","shared"],queryFn:()=>loadPoolLibrary(supabase)});
  const covers=useQuery({queryKey:["round-covers"],queryFn:async()=>{const {data,error}=await supabase.from("media_assets").select("id,file_name,storage_path,public_url").in("media_kind",["cover","image"]).order("created_at",{ascending:false});if(error)throw error;return data;}});
  const participant=value.accounts[editing];
  const update=(patch:Partial<Participant>)=>onChange({...value,accounts:value.accounts.map((a,i)=>i===editing?{...a,...patch}:a)});
  const filtered=filterPoolVideos(videos.data??[],source,search);
  const move=(i:number,delta:number)=>{const list=[...value.accounts];[list[i],list[i+delta]]=[list[i+delta],list[i]];onChange({...value,accounts:list});setEditing(i+delta);};
  return <fieldset disabled={busy} className="min-w-0 space-y-4">
    <div className="grid gap-3 sm:grid-cols-2">
      <label>Nome<input className={input} value={value.name} onChange={e=>onChange({...value,name:e.target.value})} /></label>
      <label>Contas ao mesmo tempo<select className={input} value={value.concurrent_accounts} onChange={e=>onChange({...value,concurrent_accounts:Number(e.target.value)})}>{[1,2,3,4,5].map(n=><option key={n} value={n}>{n}</option>)}</select><span className="text-xs text-muted-foreground">Um vídeo por vez em cada conta. Defina antes de iniciar.</span></label>
      <label>Reels por rodada<input className={input} type="number" min={1} max={100} value={value.batch_size} onChange={e=>onChange({...value,batch_size:Number(e.target.value)})}/></label>
      <label>Espera da conta entre rodadas (minutos)<input className={input} type="number" min={0} max={10080} value={value.round_interval_minutes} onChange={e=>onChange({...value,round_interval_minutes:Number(e.target.value)})}/><span className="text-xs text-muted-foreground">Conta desde o último reel da própria conta na rodada anterior. O tempo na fila já conta. 0 = sem espera.</span></label>
      <label>Total por conta<input className={input} type="number" min={1} max={1000} value={value.total_per_account} onChange={e=>onChange({...value,total_per_account:Number(e.target.value)})}/></label>
    </div>
    <div className="flex flex-wrap gap-2">
      <select aria-label="Adicionar conta" className={button} value={toAdd} onChange={e=>setToAdd(e.target.value)}><option value="">Escolha uma conta</option>{accounts.filter(a=>!value.accounts.some(p=>p.ig_account_id===a.id)).map(a=><option key={a.id} value={a.id}>@{a.username}</option>)}</select>
      <button className={button} disabled={!toAdd} onClick={()=>{onChange({...value,accounts:[...value.accounts,{ig_account_id:toAdd,video_ids:[],caption:"",caption_2:"",caption_3:"",spacing_seconds:105,cover_media_id:null}]});setEditing(value.accounts.length);setSource("all");setToAdd("");}}>Adicionar conta</button>
    </div>
    <ol className="space-y-2">{value.accounts.map((a,i)=><li key={a.ig_account_id} className={`flex flex-wrap items-center gap-2 rounded-lg border p-2 ${editing===i?"border-primary":"border-border"}`}>
      <button className="min-w-0 flex-1 text-left" onClick={()=>{setEditing(i);setSource("all");setSearch("");}}>{i+1}. @{accounts.find(acc=>acc.id===a.ig_account_id)?.username} · {a.video_ids.length} vídeos</button>
      <button className={button} disabled={i===0} aria-label="Mover conta para cima" onClick={()=>move(i,-1)}>↑</button><button className={button} disabled={i===value.accounts.length-1} aria-label="Mover conta para baixo" onClick={()=>move(i,1)}>↓</button>
      <button className={button} onClick={()=>{onChange({...value,accounts:value.accounts.filter((_,n)=>n!==i)});setEditing(0);}}>Remover</button>
    </li>)}</ol>
    {participant&&<section className="min-w-0 space-y-4 rounded-xl border border-border p-4">
      <h2 className="text-lg font-semibold">Vídeos de publicação: @{accounts.find(a=>a.id===participant.ig_account_id)?.username}</h2>
      <label className="block max-w-sm">Espaçamento (segundos)<input className={input} type="number" min={0} max={1800} value={participant.spacing_seconds} onChange={e=>update({spacing_seconds:Number(e.target.value)})}/></label>
      <label className="block">Primeiro comentário (opcional)<textarea className={input} maxLength={2200} rows={3} value={participant.first_comment??""} onChange={e=>update({first_comment:e.target.value})} placeholder="Comentário enviado após cada reel desta conta"/><span className="text-xs text-muted-foreground">Deixe vazio para não comentar. Vale para os novos posts desta execução.</span></label>
      <details><summary className="cursor-pointer">Legendas e capa</summary>
        <div className="grid gap-3 py-3 md:grid-cols-3">{(["caption","caption_2","caption_3"] as const).map((key,i)=><label key={key}>Legenda {i+1}<textarea className={input} maxLength={2200} rows={3} value={participant[key]} onChange={e=>update({[key]:e.target.value})}/></label>)}</div>
        <p className="mb-2 text-xs text-muted-foreground">A legenda muda a cada 6 reels da conta, como nos pools normais.</p>
        {covers.error&&<p role="alert">Não foi possível carregar capas.</p>}
        <div className="flex gap-2 overflow-x-auto pb-2"><button className={button} onClick={()=>update({cover_media_id:null})}>Sem capa</button>{covers.data?.map(c=><button key={c.id} aria-label={c.file_name} aria-pressed={participant.cover_media_id===c.id} className={`w-24 shrink-0 overflow-hidden rounded-lg border-2 ${participant.cover_media_id===c.id?"border-primary":"border-border"}`} onClick={()=>update({cover_media_id:c.id})}><AssetImage storagePath={c.storage_path} publicUrl={c.public_url} className="h-24 w-24 object-cover"/></button>)}</div>
      </details>
      <p className="text-sm">Ordem obrigatória. A lista recomeça na mesma ordem quando termina, até completar o total da conta.</p>
      <VideoOrderList items={participant.video_ids.map(id=>({id,label:videos.data?.find(v=>v.id===id)?.file_name??id}))} onChange={video_ids=>update({video_ids})}/>
      <VideoSourceTabs accounts={accounts} value={source} onChange={setSource}/>
      <div className="flex flex-wrap items-center gap-2"><input aria-label="Buscar vídeos" className={input+" sm:max-w-sm"} placeholder="Buscar vídeos…" value={search} onChange={e=>setSearch(e.target.value)}/><button className={button} onClick={()=>update({video_ids:[...new Set([...participant.video_ids,...filtered.map(v=>v.id)])]})}>Selecionar todos desta aba</button></div>
      {videos.isLoading?<p>Carregando vídeos…</p>:videos.error?<p role="alert">Falha ao carregar vídeos. Atualize a página.</p>:<PoolVideoPicker videos={filtered} selected={participant.video_ids} onToggle={id=>update({video_ids:participant.video_ids.includes(id)?participant.video_ids.filter(v=>v!==id):[...participant.video_ids,id]})}/>}
    </section>}
    <div className="sticky bottom-0 flex flex-wrap gap-2 border-t border-border bg-background py-3">
      <button className={button} onClick={onCancel}>Voltar</button>
      <button className={button+" bg-primary text-primary-foreground"} disabled={busy||!value.name.trim()||!value.accounts.length||value.accounts.some(a=>!a.video_ids.length)||Boolean(videos.error)||videos.isLoading} onClick={onSave}>{busy?"Salvando…":"Salvar rascunho"}</button>
    </div>
  </fieldset>;
}
