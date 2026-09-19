import { createFileRoute, Link } from "@tanstack/react-router";
import { Calendar, BarChart3, Sparkles, ShieldCheck, Zap, ArrowRight, Crown } from "lucide-react";

export const Route = createFileRoute("/")({
  component: Landing,
});

function Landing() {
  return (
    <div className="min-h-screen bg-background text-foreground">
      <header className="border-b border-border/50 backdrop-blur-md sticky top-0 z-40 bg-background/70">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-4">
          <Link to="/" className="flex items-center gap-2.5">
            <div className="h-8 w-8 rounded-lg ig-gradient flex items-center justify-center">
              <Crown className="h-4 w-4 text-primary-foreground" />
            </div>
            <span className="font-display text-xl font-bold tracking-tight gold-text">ELITE</span>
          </Link>
          <div className="flex items-center gap-2">
            <Link to="/auth" className="rounded-lg px-4 py-2 text-sm font-medium text-muted-foreground hover:text-foreground">Entrar</Link>
          </div>
        </div>
      </header>

      <main>
        <section className="mx-auto max-w-6xl px-6 pt-24 pb-24 text-center">
          <div className="inline-flex items-center gap-2 rounded-full border border-border bg-card/60 px-3 py-1 text-xs text-muted-foreground">
            <Sparkles className="h-3.5 w-3.5 text-primary" />
            Meta Graph API oficial · Acesso exclusivo por convite
          </div>
          <h1 className="mx-auto mt-6 max-w-3xl font-display text-5xl font-bold leading-tight tracking-tight md:text-6xl">
            Publicação automática de Reels <span className="gold-text">no padrão ELITE.</span>
          </h1>
          <p className="mx-auto mt-5 max-w-xl text-base text-muted-foreground md:text-lg">
            Plataforma premium e privada para gerenciar filas, agendamentos e publicações no Instagram profissional — sem intermediários, sem risco de banimento.
          </p>
          <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
            <Link to="/auth" className="inline-flex items-center gap-2 rounded-xl ig-gradient px-6 py-3 text-sm font-semibold text-primary-foreground shadow-lg transition-transform hover:scale-[1.02]">
              Acessar painel <ArrowRight className="h-4 w-4" />
            </Link>
          </div>
        </section>

        <section className="mx-auto grid max-w-6xl gap-4 px-6 pb-24 md:grid-cols-3">
          {[
            { icon: Calendar, title: "Calendário visual", body: "Visualize toda a sua fila mensal, semanal e diária com detecção automática de conflitos." },
            { icon: Zap, title: "Publicação automática", body: "Motor de publicação confiável com re-tentativa exponencial e polling de containers de vídeo." },
            { icon: BarChart3, title: "Analytics real", body: "Seguidores, alcance, impressões, engajamento e melhores horários por conta conectada." },
            { icon: Crown, title: "Acesso privado", body: "Somente administradores autorizados. Cadastro exclusivamente por convite." },
            { icon: ShieldCheck, title: "Seguro por design", body: "Tokens da Meta ficam criptografados no servidor. Nunca expostos no navegador." },
            { icon: Sparkles, title: "Reels + Carrosséis", body: "Fila automática com intervalos configuráveis, primeiro comentário e hashtags." },
          ].map((f) => (
            <div key={f.title} className="card-elevated p-6">
              <div className="mb-4 inline-flex h-10 w-10 items-center justify-center rounded-lg" style={{ background: "var(--gradient-ig-soft)" }}>
                <f.icon className="h-5 w-5 text-primary" />
              </div>
              <h3 className="font-display text-lg font-semibold">{f.title}</h3>
              <p className="mt-1.5 text-sm text-muted-foreground">{f.body}</p>
            </div>
          ))}
        </section>
      </main>

      <footer className="border-t border-border/50 py-8 text-center text-xs text-muted-foreground">
        © {new Date().getFullYear()} ELITE · Sistema privado. Não afiliado à Meta ou Instagram.
      </footer>
    </div>
  );
}
