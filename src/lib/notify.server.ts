// Notificações via WhatsApp (CallMeBot)
// Envia mensagem para o número configurado no secret CALLMEBOT_PHONE
// usando a chave em CALLMEBOT_API_KEY.
// Never throws — falha silenciosa (loga) para não derrubar o fluxo de publicação.

export async function sendWhatsApp(message: string): Promise<void> {
  const phone = process.env.CALLMEBOT_PHONE;
  const apikey = process.env.CALLMEBOT_API_KEY;
  if (!phone || !apikey) {
    console.warn("[notify] CALLMEBOT_PHONE/CALLMEBOT_API_KEY não configurados");
    return;
  }
  try {
    const url = `https://api.callmebot.com/whatsapp.php?phone=${encodeURIComponent(phone)}&text=${encodeURIComponent(message)}&apikey=${encodeURIComponent(apikey)}`;
    const res = await fetch(url, { method: "GET" });
    if (!res.ok) {
      console.warn(`[notify] CallMeBot respondeu ${res.status}`);
    }
  } catch (e) {
    console.warn("[notify] falha ao enviar WhatsApp:", e instanceof Error ? e.message : e);
  }
}

export function formatTs(d: Date = new Date()): string {
  return d.toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo", hour12: false });
}
