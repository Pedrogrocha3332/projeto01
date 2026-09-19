// Client-side video utilities: metadata extraction, thumbnail generation,
// and Instagram Reels validation.

export type VideoMeta = {
  width: number;
  height: number;
  duration: number; // seconds
};

export const REEL_LIMITS = {
  minDuration: 3,
  recommendedMaxDuration: 90, // > 90s tem alcance reduzido pelo algoritmo
  hardMaxDuration: 15 * 60,
  maxBytes: 4 * 1024 * 1024 * 1024, // 4GB
  targetAspect: 9 / 16,
  aspectTolerance: 0.05,
  minShortSide: 720,
  idealWidth: 1080,
  idealHeight: 1920,
  allowedMime: ["video/mp4", "video/quicktime"],
  allowedExt: [".mp4", ".mov"],
};

export type ReelWarning = {
  code: "aspect" | "resolution" | "too_short" | "too_long" | "format" | "size";
  severity: "error" | "warning";
  message: string;
};

export function extractVideoMeta(file: File | Blob): Promise<VideoMeta> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const v = document.createElement("video");
    v.preload = "metadata";
    v.muted = true;
    v.playsInline = true;
    v.src = url;
    const cleanup = () => URL.revokeObjectURL(url);
    v.onloadedmetadata = () => {
      const meta = { width: v.videoWidth, height: v.videoHeight, duration: v.duration };
      cleanup();
      resolve(meta);
    };
    v.onerror = () => { cleanup(); reject(new Error("Não foi possível ler o vídeo")); };
  });
}

// A nearly black frame is usually an opening fade, not a useful thumbnail.
export function isDarkFrame(pixels: Uint8ClampedArray): boolean {
  let visible = 0;
  for (let i = 0; i < pixels.length; i += 4) {
    if (Math.max(pixels[i], pixels[i + 1], pixels[i + 2]) > 24) visible++;
  }
  return visible / Math.max(1, pixels.length / 4) < 0.02;
}

export function generateVideoThumbnail(file: File | Blob | string, seekTo = 1): Promise<Blob> {
  return new Promise((resolve, reject) => {
    const ownedUrl = typeof file !== "string";
    const url = ownedUrl ? URL.createObjectURL(file) : file;
    const v = document.createElement("video");
    let finished = false;
    let capturing = false;
    let frameIndex = 0;
    let times: number[] = [];
    const cleanup = () => {
      clearTimeout(timer);
      v.onloadedmetadata = v.onloadeddata = v.onseeked = v.onerror = null;
      v.pause();
      v.removeAttribute("src");
      v.load();
      if (ownedUrl) URL.revokeObjectURL(url);
    };
    const fail = (message: string) => {
      if (finished) return;
      finished = true;
      cleanup();
      reject(new Error(message));
    };
    const timer = setTimeout(() => fail("O vídeo demorou demais para gerar a prévia"), 25_000);
    const capture = () => {
      if (finished || capturing || v.readyState < 2 || v.seeking) return;
      if (Math.abs(v.currentTime - times[frameIndex]) > 0.1) return;
      capturing = true;
      try {
        if (!v.videoWidth || !v.videoHeight) throw new Error("Frame vazio");
        const scale = Math.min(1, 480 / Math.max(v.videoWidth, v.videoHeight));
        const canvas = document.createElement("canvas");
        canvas.width = Math.max(1, Math.round(v.videoWidth * scale));
        canvas.height = Math.max(1, Math.round(v.videoHeight * scale));
        const ctx = canvas.getContext("2d");
        if (!ctx) throw new Error("Canvas indisponível");
        ctx.drawImage(v, 0, 0, canvas.width, canvas.height);
        if (isDarkFrame(ctx.getImageData(0, 0, canvas.width, canvas.height).data)) {
          if (++frameIndex < times.length) {
            capturing = false;
            v.currentTime = times[frameIndex];
            return;
          }
          throw new Error("Não foi possível encontrar um quadro visível");
        }
        canvas.toBlob(blob => {
          if (finished) return;
          if (!blob) { fail("Falha ao gerar miniatura"); return; }
          finished = true;
          cleanup();
          resolve(blob);
        }, "image/jpeg", 0.82);
      } catch (error) { fail(error instanceof Error ? error.message : "Falha ao gerar miniatura"); }
    };
    v.preload = "auto";
    v.muted = true;
    v.playsInline = true;
    v.crossOrigin = "anonymous";
    v.onloadedmetadata = () => {
      const duration = Number.isFinite(v.duration) && v.duration > 0 ? v.duration : null;
      const end = duration == null ? 6 : Math.max(0, duration - 0.05);
      const candidates = duration == null ? [seekTo, 3, 6] : [Math.min(seekTo, duration * 0.2), duration * 0.5, duration * 0.8];
      times = [...new Set(candidates.map(t => Math.max(0, Math.min(t, end))))];
      v.currentTime = times[0];
      capture();
    };
    v.onloadeddata = capture;
    v.onseeked = capture;
    v.onerror = () => fail("Não foi possível processar o vídeo neste navegador");
    v.src = url;
    v.load();
  });
}

export function validateReel(
  input: { meta?: VideoMeta | null; mime?: string | null; fileName?: string | null; sizeBytes?: number | null },
): ReelWarning[] {
  const out: ReelWarning[] = [];
  const { meta, mime, fileName, sizeBytes } = input;

  // Formato
  const ext = (fileName ?? "").toLowerCase().slice(fileName?.lastIndexOf(".") ?? 0);
  const mimeOk = mime ? REEL_LIMITS.allowedMime.includes(mime) : false;
  const extOk = REEL_LIMITS.allowedExt.includes(ext);
  if (!mimeOk && !extOk) {
    out.push({ code: "format", severity: "error", message: "Formato inválido: use MP4 ou MOV." });
  }

  // Tamanho
  if (sizeBytes != null && sizeBytes > REEL_LIMITS.maxBytes) {
    out.push({ code: "size", severity: "error", message: "Arquivo acima de 4GB (limite do Instagram)." });
  }

  if (meta) {
    // Duração
    if (meta.duration && meta.duration < REEL_LIMITS.minDuration) {
      out.push({ code: "too_short", severity: "error", message: `Vídeo muito curto (${meta.duration.toFixed(1)}s). Mínimo 3s.` });
    } else if (meta.duration && meta.duration > REEL_LIMITS.recommendedMaxDuration) {
      out.push({
        code: "too_long",
        severity: "warning",
        message: `Vídeo com ${Math.round(meta.duration)}s — recomendado até 90s para melhor alcance.`,
      });
    }

    // Proporção
    if (meta.width && meta.height) {
      const aspect = meta.width / meta.height;
      const diff = Math.abs(aspect - REEL_LIMITS.targetAspect);
      if (diff > REEL_LIMITS.aspectTolerance) {
        const current = simplifyRatio(meta.width, meta.height);
        out.push({
          code: "aspect",
          severity: "warning",
          message: `Proporção ${current} — o ideal para Reels é 9:16 (1080x1920).`,
        });
      }
      // Resolução
      const shortSide = Math.min(meta.width, meta.height);
      if (shortSide < REEL_LIMITS.minShortSide) {
        out.push({
          code: "resolution",
          severity: "warning",
          message: `Resolução baixa (${meta.width}x${meta.height}). Mínimo recomendado 720p.`,
        });
      }
    }
  }

  return out;
}

function simplifyRatio(w: number, h: number): string {
  const g = gcd(w, h);
  return `${w / g}:${h / g}`;
}
function gcd(a: number, b: number): number { return b === 0 ? a : gcd(b, a % b); }
