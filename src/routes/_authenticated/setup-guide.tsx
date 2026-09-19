import { createFileRoute, Link } from "@tanstack/react-router";
import { PageHeader, PageBody } from "@/components/app/page";
import { Check, ExternalLink } from "lucide-react";

export const Route = createFileRoute("/_authenticated/setup-guide")({
  component: SetupGuide,
});

const STEPS: { title: string; body: React.ReactNode; link?: { label: string; href: string } }[] = [
  {
    title: "Crie uma conta de Desenvolvedor Meta",
    body: <>Acesse developers.facebook.com e cadastre-se como desenvolvedor. É gratuito e leva cerca de 1 minuto.</>,
    link: { label: "developers.facebook.com", href: "https://developers.facebook.com" },
  },
  {
    title: "Crie um novo App Meta",
    body: <>No painel: <em>Meus Apps → Criar App</em>. Escolha <strong>Business</strong> como tipo. Dê qualquer nome (ex.: "ELITE Publisher").</>,
  },
  {
    title: "Adicione o produto Instagram Graph API",
    body: <>No dashboard do app, clique em <em>Adicionar Produto</em> e selecione <strong>Instagram Graph API</strong>. Adicione também <strong>Facebook Login</strong>.</>,
  },
  {
    title: "Configure a URL de redirecionamento OAuth",
    body: <>Em Facebook Login → Configurações, adicione esta Valid OAuth Redirect URI exatamente: <code className="mx-1 rounded bg-muted px-1.5 py-0.5 text-xs">{typeof window !== "undefined" ? `${window.location.origin}/api/public/meta/callback` : "/api/public/meta/callback"}</code></>,
  },
  {
    title: "Solicite as permissões necessárias",
    body: (
      <>Em App Review → Permissions and Features, solicite:
        <ul className="mt-2 ml-6 list-disc text-sm space-y-1 text-muted-foreground">
          <li><code>instagram_basic</code></li>
          <li><code>instagram_content_publish</code></li>
          <li><code>instagram_manage_insights</code></li>
          <li><code>pages_show_list</code></li>
          <li><code>pages_read_engagement</code></li>
        </ul>
        <p className="mt-2 text-sm text-muted-foreground">Publicação de conteúdo e insights exigem análise da Meta. Você pode usar em modo de desenvolvimento com usuários de teste enquanto aguarda.</p>
      </>
    ),
  },
  {
    title: "Converta seu Instagram em Comercial ou Criador",
    body: <>O ELITE só funciona com contas Comerciais ou de Criador vinculadas a uma Página do Facebook. No app do IG: Configurações → Conta → Mudar para conta profissional.</>,
  },
  {
    title: "Configure o App ID e o App Secret no ELITE",
    body: <>Quando o app estiver pronto, cole o <strong>App ID</strong> e o <strong>App Secret</strong> em Configurações → Meta API. Armazenamos com segurança e nunca expomos ao navegador.</>,
    link: { label: "Ir para Meta API", href: "/meta-api" },
  },
  {
    title: "Conecte sua conta do Instagram",
    body: <>Acesse Contas do Instagram e clique em <em>Conectar conta</em>. Você será redirecionado ao Facebook para autorizar o ELITE.</>,
    link: { label: "Ir para Contas", href: "/accounts" },
  },
];

function SetupGuide() {
  return (
    <div>
      <PageHeader
        title="Guia de instalação"
        description="Configure seu app da Meta para começar a agendar."
      />
      <PageBody>
        <ol className="space-y-4">
          {STEPS.map((step, i) => (
            <li key={i} className="card-elevated p-5">
              <div className="flex items-start gap-4">
                <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full ig-gradient text-sm font-bold text-primary-foreground">
                  {i + 1}
                </div>
                <div className="min-w-0 flex-1">
                  <h3 className="font-display text-base font-semibold">{step.title}</h3>
                  <div className="mt-1.5 text-sm text-muted-foreground">{step.body}</div>
                  {step.link && (
                    step.link.href.startsWith("http") ? (
                      <a href={step.link.href} target="_blank" rel="noreferrer"
                        className="mt-3 inline-flex items-center gap-1.5 text-xs font-medium text-primary hover:underline">
                        {step.link.label} <ExternalLink className="h-3 w-3" />
                      </a>
                    ) : (
                      <Link to={step.link.href} className="mt-3 inline-flex items-center gap-1.5 text-xs font-medium text-primary hover:underline">
                        {step.link.label} →
                      </Link>
                    )
                  )}
                </div>
              </div>
            </li>
          ))}
        </ol>
        <div className="mt-6 rounded-xl p-5" style={{ background: "var(--gradient-ig-soft)" }}>
          <div className="flex items-start gap-3">
            <Check className="h-5 w-5 text-primary mt-0.5" />
            <div>
              <div className="font-display font-semibold">Tudo pronto</div>
              <p className="text-sm text-muted-foreground mt-1">Após aprovado, publicar carrosséis, reels e imagens é um clique. O ELITE cuida de polling de container, re-tentativas e limites de API.</p>
            </div>
          </div>
        </div>
      </PageBody>
    </div>
  );
}
