import { useEffect, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";

/**
 * Renders a media_assets image. If the stored signed URL fails (e.g. filename
 * with spaces / expired signature), automatically re-signs from storage_path.
 */
export function AssetImage({
  storagePath,
  publicUrl,
  alt,
  className,
  loading = "lazy",
}: {
  storagePath: string;
  publicUrl?: string | null;
  alt?: string;
  className?: string;
  loading?: "lazy" | "eager";
}) {
  const [src, setSrc] = useState<string>(() => publicUrl || "");
  const triedRef = useRef(false);

  useEffect(() => {
    setSrc(publicUrl || "");
    triedRef.current = false;
    if (!publicUrl && storagePath) { void refresh(); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [publicUrl, storagePath]);

  async function refresh() {
    if (triedRef.current || !storagePath) return;
    triedRef.current = true;
    const { data } = await supabase.storage.from("media").createSignedUrl(storagePath, 60 * 60 * 24 * 30);
    if (data?.signedUrl) {
      setSrc(data.signedUrl);
      // Persist the fresh URL so subsequent loads don't fail again
      supabase.from("media_assets").update({ public_url: data.signedUrl }).eq("storage_path", storagePath).then(() => {});
    }
  }

  return (
    <img
      src={src || undefined}
      alt={alt ?? ""}
      className={className}
      loading={loading}
      onError={refresh}
    />
  );
}
