import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";

const Schema = z.object({
  email: z.string().email("E-mail inválido"),
  password: z.string().min(6, "Senha mínima de 6 caracteres"),
  fullName: z.string().min(1).optional(),
});

export const cloneMyAccount = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => Schema.parse(input))
  .handler(async ({ data, context }) => {
    const { supabase, userId: sourceUserId } = context;

    // Ensure caller is admin_principal
    const { data: isAdmin, error: roleErr } = await supabase.rpc("has_role", {
      _user_id: sourceUserId,
      _role: "admin_principal",
    });
    if (roleErr) throw new Error(roleErr.message);
    if (!isAdmin) throw new Error("Apenas admin_principal pode clonar contas");

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    // 1) create an invite for admin_principal, bypassing RLS via admin client
    const token = crypto.randomUUID() + "-" + crypto.randomUUID();
    const { error: invErr } = await supabaseAdmin.from("invites").insert({
      token,
      role: "admin_principal",
      created_by: sourceUserId,
      expires_at: new Date(Date.now() + 10 * 60 * 1000).toISOString(),
    });
    if (invErr) throw new Error("Falha criando convite: " + invErr.message);

    // 2) create auth user (email confirmed), passing invite_token so trigger grants role
    const { data: createdRes, error: createErr } =
      await supabaseAdmin.auth.admin.createUser({
        email: data.email,
        password: data.password,
        email_confirm: true,
        user_metadata: {
          full_name: data.fullName ?? data.email.split("@")[0],
          invite_token: token,
        },
      });
    if (createErr || !createdRes?.user) {
      // cleanup invite
      await supabaseAdmin.from("invites").delete().eq("token", token);
      throw new Error("Falha criando usuário: " + (createErr?.message ?? "sem detalhes"));
    }
    const newUserId = createdRes.user.id;

    // 3) copy data — build ID remaps as we go
    const cloneCount = { igAccounts: 0, mediaAssets: 0, pools: 0, poolVideos: 0, posts: 0, postMedia: 0, captions: 0, hashtags: 0, meta: 0 };

    // meta_credentials (unique per user)
    const { data: meta } = await supabaseAdmin.from("meta_credentials").select("app_id,app_secret,long_lived_token").eq("user_id", sourceUserId).maybeSingle();
    if (meta) {
      await supabaseAdmin.from("meta_credentials").insert({ ...meta, user_id: newUserId });
      cloneCount.meta = 1;
    }

    // caption_templates
    const { data: caps } = await supabaseAdmin.from("caption_templates").select("name,body").eq("user_id", sourceUserId);
    if (caps?.length) {
      await supabaseAdmin.from("caption_templates").insert(caps.map((c) => ({ ...c, user_id: newUserId })));
      cloneCount.captions = caps.length;
    }

    // hashtag_groups
    const { data: hgs } = await supabaseAdmin.from("hashtag_groups").select("name,hashtags").eq("user_id", sourceUserId);
    if (hgs?.length) {
      await supabaseAdmin.from("hashtag_groups").insert(hgs.map((h) => ({ ...h, user_id: newUserId })));
      cloneCount.hashtags = hgs.length;
    }

    // instagram_accounts
    const { data: igs } = await supabaseAdmin.from("instagram_accounts").select("*").eq("user_id", sourceUserId);
    const igMap = new Map<string, string>();
    if (igs?.length) {
      for (const ig of igs) {
        const newId = crypto.randomUUID();
        igMap.set(ig.id, newId);
        const { id: _oldId, user_id: _u, created_at: _c, updated_at: _up, ...rest } = ig as any;
        await supabaseAdmin.from("instagram_accounts").insert({ ...rest, id: newId, user_id: newUserId });
      }
      cloneCount.igAccounts = igs.length;
    }

    // media_assets
    const { data: assets } = await supabaseAdmin.from("media_assets").select("*").eq("user_id", sourceUserId);
    const assetMap = new Map<string, string>();
    if (assets?.length) {
      const rows = assets.map((a) => {
        const newId = crypto.randomUUID();
        assetMap.set(a.id, newId);
        const { id: _i, user_id: _u, created_at: _c, ...rest } = a as any;
        return { ...rest, id: newId, user_id: newUserId, ig_account_id: a.ig_account_id ? igMap.get(a.ig_account_id) ?? null : null };
      });
      // batch insert
      for (let i = 0; i < rows.length; i += 200) {
        await supabaseAdmin.from("media_assets").insert(rows.slice(i, i + 200));
      }
      cloneCount.mediaAssets = rows.length;
    }

    // media_pools
    const { data: pools } = await supabaseAdmin.from("media_pools").select("*").eq("user_id", sourceUserId);
    const poolMap = new Map<string, string>();
    if (pools?.length) {
      for (const p of pools) {
        const newId = crypto.randomUUID();
        poolMap.set(p.id, newId);
        const { id: _i, user_id: _u, created_at: _c, updated_at: _up, ...rest } = p as any;
        await supabaseAdmin.from("media_pools").insert({
          ...rest,
          id: newId,
          user_id: newUserId,
          ig_account_id: igMap.get(p.ig_account_id) ?? p.ig_account_id,
          cover_media_asset_id: p.cover_media_asset_id ? assetMap.get(p.cover_media_asset_id) ?? null : null,
        });
      }
      cloneCount.pools = pools.length;
    }

    // pool_videos
    if (poolMap.size) {
      const { data: pvs } = await supabaseAdmin.from("pool_videos").select("*").in("pool_id", Array.from(poolMap.keys()));
      if (pvs?.length) {
        const rows = pvs
          .map((pv) => {
            const newPool = poolMap.get(pv.pool_id);
            const newAsset = assetMap.get(pv.media_asset_id);
            if (!newPool || !newAsset) return null;
            const { id: _i, created_at: _c, ...rest } = pv as any;
            return { ...rest, id: crypto.randomUUID(), pool_id: newPool, media_asset_id: newAsset };
          })
          .filter(Boolean);
        for (let i = 0; i < rows.length; i += 500) {
          await supabaseAdmin.from("pool_videos").insert(rows.slice(i, i + 500) as any);
        }
        cloneCount.poolVideos = rows.length;
      }
    }

    // scheduled_posts
    const { data: posts } = await supabaseAdmin.from("scheduled_posts").select("*").eq("user_id", sourceUserId);
    const postMap = new Map<string, string>();
    if (posts?.length) {
      for (const p of posts) {
        const newId = crypto.randomUUID();
        postMap.set(p.id, newId);
        const { id: _i, user_id: _u, created_at: _c, updated_at: _up, ...rest } = p as any;
        await supabaseAdmin.from("scheduled_posts").insert({
          ...rest,
          id: newId,
          user_id: newUserId,
          ig_account_id: igMap.get(p.ig_account_id) ?? p.ig_account_id,
          cover_media_id: p.cover_media_id ? assetMap.get(p.cover_media_id) ?? null : null,
        });
      }
      cloneCount.posts = posts.length;
    }

    // post_media
    if (postMap.size) {
      const { data: pms } = await supabaseAdmin.from("post_media").select("*").in("post_id", Array.from(postMap.keys()));
      if (pms?.length) {
        const rows = pms
          .map((pm) => {
            const newPost = postMap.get(pm.post_id);
            const newAsset = assetMap.get(pm.media_asset_id);
            if (!newPost || !newAsset) return null;
            const { id: _i, created_at: _c, ...rest } = pm as any;
            return { ...rest, id: crypto.randomUUID(), post_id: newPost, media_asset_id: newAsset };
          })
          .filter(Boolean);
        for (let i = 0; i < rows.length; i += 500) {
          await supabaseAdmin.from("post_media").insert(rows.slice(i, i + 500) as any);
        }
        cloneCount.postMedia = rows.length;
      }
    }

    return { ok: true, newUserId, email: data.email, counts: cloneCount };
  });
