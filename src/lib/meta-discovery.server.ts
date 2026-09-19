/**
 * Lógica compartilhada de descoberta de contas Instagram a partir de um user access token.
 * Usada tanto pela função `discoverInstagramAccounts` quanto pelo callback OAuth.
 */

const GRAPH = "https://graph.facebook.com/v21.0";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type SupabaseLike = any;

export type DiscoverResult =
  | { ok: true; connected: number; accounts: Array<{ username: string; page_name: string | null }>; warnings: string[] }
  | { ok: false; message: string };

export async function discoverAndSaveIgAccounts(
  supabase: SupabaseLike,
  userId: string,
  userAccessToken: string,
): Promise<DiscoverResult> {
  try {
    const pagesRes = await fetch(
      `${GRAPH}/me/accounts?fields=id,name,access_token,instagram_business_account&limit=100&access_token=${encodeURIComponent(userAccessToken)}`,
    );
    const pagesJson: {
      data?: Array<{ id: string; name?: string; access_token?: string; instagram_business_account?: { id: string } }>;
      error?: { message?: string };
    } = await pagesRes.json();

    if (pagesJson.error) {
      const msg = pagesJson.error.message ?? "erro desconhecido";
      if (/permission|scope|oauth/i.test(msg)) {
        return {
          ok: false,
          message: `Permissões insuficientes: ${msg}. Certifique-se de aceitar todas as permissões solicitadas.`,
        };
      }
      return { ok: false, message: `Meta rejeitou a requisição: ${msg}` };
    }

    const pages = pagesJson.data ?? [];
    if (pages.length === 0) {
      return {
        ok: false,
        message: "Nenhuma Página do Facebook encontrada. Verifique se você administra Páginas nesta conta.",
      };
    }

    const withIg = pages.filter((p) => p.instagram_business_account?.id && p.access_token);
    if (withIg.length === 0) {
      return {
        ok: false,
        message: "Nenhuma Página tem conta Instagram Profissional vinculada. Vá em Instagram → Central de Contas e vincule a conta a uma Página do Facebook.",
      };
    }

    type Discovered = {
      ig_user_id: string;
      username: string;
      account_type: string | null;
      profile_picture_url: string | null;
      followers_count: number;
      media_count: number;
      page_id: string;
      page_name: string | null;
      access_token: string;
    };
    const discovered: Discovered[] = [];
    const failures: string[] = [];

    for (const page of withIg) {
      const igId = page.instagram_business_account!.id;
      const pageToken = page.access_token!;
      const igRes = await fetch(
        `${GRAPH}/${igId}?fields=username,profile_picture_url,followers_count,media_count,account_type&access_token=${encodeURIComponent(pageToken)}`,
      );
      const igJson: {
        username?: string;
        profile_picture_url?: string;
        followers_count?: number;
        media_count?: number;
        account_type?: string;
        error?: { message?: string };
      } = await igRes.json();

      if (igJson.error || !igJson.username) {
        failures.push(`${page.name ?? page.id}: ${igJson.error?.message ?? "sem username"}`);
        continue;
      }

      discovered.push({
        ig_user_id: igId,
        username: igJson.username,
        account_type: igJson.account_type ?? "BUSINESS",
        profile_picture_url: igJson.profile_picture_url ?? null,
        followers_count: igJson.followers_count ?? 0,
        media_count: igJson.media_count ?? 0,
        page_id: page.id,
        page_name: page.name ?? null,
        access_token: pageToken,
      });
    }

    if (discovered.length === 0) {
      return { ok: false, message: `Falha ao ler contas IG: ${failures.join(" | ")}` };
    }

    const rows = discovered.map((d) => ({
      user_id: userId,
      ig_user_id: d.ig_user_id,
      username: d.username,
      account_type: d.account_type,
      profile_picture_url: d.profile_picture_url,
      followers_count: d.followers_count,
      media_count: d.media_count,
      page_id: d.page_id,
      page_name: d.page_name,
      access_token: d.access_token,
      token_expires_at: null,
      is_active: true,
    }));

    const { error: upsertErr } = await supabase
      .from("instagram_accounts")
      .upsert(rows, { onConflict: "user_id,ig_user_id" });

    if (upsertErr) {
      return { ok: false, message: `Erro ao salvar contas: ${upsertErr.message}` };
    }

    return {
      ok: true,
      connected: discovered.length,
      accounts: discovered.map((d) => ({ username: d.username, page_name: d.page_name })),
      warnings: failures,
    };
  } catch (e) {
    return { ok: false, message: `Falha de rede: ${e instanceof Error ? e.message : String(e)}` };
  }
}
