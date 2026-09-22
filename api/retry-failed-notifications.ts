import { createClient } from "@supabase/supabase-js";
import { Resend } from "resend";
import { createHash } from "crypto";

// Vercel empacota cada rota em api/ isoladamente e não traça imports fora desta
// pasta (ver o mesmo aviso em save-lead.ts) — por isso os helpers de email estão
// duplicados aqui em vez de importados.
const OWN_LOCATION_ID = "own_location";

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);
const resend = new Resend(process.env.RESEND_API_KEY);

const FROM = "LisbonBBQ <noreply@lisbonbbq.pt>";
const NOTIFY_EMAIL = "pitmasters@lisbonbbq.pt";

function formatDate(iso: string | undefined) {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString("pt-PT", {
    weekday: "long", year: "numeric", month: "long", day: "numeric",
    timeZone: "Europe/Lisbon"
  });
}

function escapeHtml(text: string | undefined) {
  if (!text) return "";
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function traditionLabel(t: string) {
  return ({ brazilian: "Churrasco Brasileiro 🇧🇷", portuguese: "Churrasco Português 🇵🇹", argentinian: "Asado Argentino 🇦🇷" } as Record<string, string>)[t] || t || "—";
}

function internalEmail(lead: any) {
  const b = lead.booking || {};
  const c = lead.client || {};
  const isCorporate = lead.source === "corporate";
  const extras = (lead.extras || []).map((e: any) => e.qty > 1 ? `${e.name} ×${e.qty}` : e.name).join(", ") || "Nenhum";

  const rows = isCorporate
    ? `
    <tr><td>Cliente</td><td>${c.name || "—"}</td></tr>
    <tr><td>Email</td><td>${c.email ? `<a href="mailto:${c.email}">${c.email}</a>` : "—"}</td></tr>
    <tr><td>Telefone</td><td>${c.phone || "—"}</td></tr>
    <tr><td>Local</td><td>${lead.summary?.location || "A decidir"}</td></tr>
    <tr><td>Tipo de churrasco</td><td>${lead.corporate?.bbqStyle ? traditionLabel(lead.corporate.bbqStyle) : "Ainda não sei"}</td></tr>
    <tr><td>Data do Evento</td><td>${lead.corporate?.date ? formatDate(lead.corporate.date) : "Por confirmar — ver mensagem"}</td></tr>
    <tr><td>Convidados</td><td>${lead.corporate?.guests || b.guests || "—"} pax</td></tr>
    <tr><td>Mensagem</td><td>${escapeHtml(lead.corporate?.message) || "—"}</td></tr>
    <tr><td>ID</td><td style="font-size:12px;color:#999">${lead.id}</td></tr>`
    : `
    <tr><td>Cliente</td><td>${c.name || "—"}</td></tr>
    <tr><td>Email</td><td>${c.email ? `<a href="mailto:${c.email}">${c.email}</a>` : "—"}</td></tr>
    <tr><td>Telefone</td><td>${c.phone || "—"}</td></tr>
    <tr><td>Data do Evento</td><td>${formatDate(b.date)}</td></tr>
    <tr><td>Local</td><td>${lead.summary?.location || b.locationId || "—"}</td></tr>
    <tr><td>Tradição</td><td><span class="badge">${traditionLabel(b.tradition)}</span></td></tr>
    <tr><td>Horário</td><td>${b.slot || "—"}</td></tr>
    <tr><td>Convidados</td><td>${b.guests || "—"} pax</td></tr>
    <tr><td>Extras</td><td>${extras}</td></tr>
    ${b.locationId === OWN_LOCATION_ID ? `
    <tr><td>Código Postal</td><td>${b.ownVenuePostalCode || "—"}</td></tr>
    <tr><td>Água/Luz no local</td><td>${b.ownVenueHasWaterElectricity ? "✅ Confirmado pelo cliente" : "⚠️ Não confirmado"}</td></tr>
    <tr><td>Aluguer lugares sentados</td><td>${b.ownVenueIncludeSeating ? "Sim — incluir na proposta" : "Não"}</td></tr>` : ""}
    <tr><td>ID</td><td style="font-size:12px;color:#999">${lead.id}</td></tr>`;

  return `
<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><style>
  body { font-family: Arial, sans-serif; background: #f5f5f5; margin: 0; padding: 24px; }
  .card { background: #fff; border: 3px solid #111; max-width: 600px; margin: 0 auto; padding: 32px; }
  h1 { background: #FFD600; color: #111; margin: -32px -32px 24px; padding: 20px 32px; font-size: 22px; border-bottom: 3px solid #111; }
  table { width: 100%; border-collapse: collapse; margin-top: 16px; }
  td { padding: 10px 8px; border-bottom: 1px solid #eee; font-size: 15px; }
  td:first-child { font-weight: bold; width: 40%; color: #555; }
  .badge { display: inline-block; background: #FFD600; border: 2px solid #111; padding: 4px 12px; font-weight: bold; border-radius: 4px; }
</style></head>
<body>
<div class="card">
  <h1>🔥 Nova Reserva — LisbonBBQ</h1>
  <p style="margin:0 0 16px;padding:12px 16px;background:#FFF3CD;border-left:4px solid #FFD600;font-size:14px;color:#664d03;">Reenvio automático — a notificação original desta lead falhou (ver "ID" abaixo).</p>
  <table>${rows}
  </table>
</div>
</body>
</html>`;
}

// Janela de espera antes do 1º retry: evita corrida com o próprio save-lead.ts,
// que já tenta marcar internal_notified_at no fim do pedido original.
const GRACE_MINUTES = 2;
// Não voltamos a tentar leads mais antigas que isto: se o Resend esteve tantas
// horas em baixo o problema já devia ter sido notado por outra via.
const MAX_AGE_HOURS = 24;
// Depois destas tentativas, paramos — nesse ponto o problema é provavelmente
// permanente (ex: chave API inválida) e precisa de atenção humana.
const MAX_ATTEMPTS = 10;

/**
 * Rede de segurança para o envio inicial em save-lead.ts: encontra leads
 * completas (têm email) cuja notificação interna "Nova reserva" nunca foi
 * confirmada como enviada e tenta reenviá-la. Corre a cada 5 min via
 * Supabase pg_cron, com a mesma autenticação usada em notify-partial-leads.
 *
 * Exclui explicitamente `stage: "partial"` — o capture parcial do form
 * corporate já recolhe o email antes do telemóvel, por isso teria "email
 * presente + internal_notified_at nulo" tal como uma lead completa cujo envio
 * falhou, e levaria a mandar um "Nova reserva" prematuro sem os dados do
 * pedido (data, local, convidados) que só chegam na submissão final.
 */
export default async function handler(req: any, res: any) {
  const expected = createHash("sha256")
    .update(process.env.SUPABASE_SERVICE_ROLE_KEY || "")
    .digest("hex");
  const secret = req.headers?.["x-cron-secret"];
  if (secret !== expected) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  const now = Date.now();
  const dueBefore = new Date(now - GRACE_MINUTES * 60 * 1000).toISOString();
  const notOlderThan = new Date(now - MAX_AGE_HOURS * 60 * 60 * 1000).toISOString();

  try {
    const { data: rows, error } = await supabase
      .from("leads")
      .select("id, data, internal_notify_attempts")
      .not("email", "is", null)
      .is("data->>stage", null)
      .is("internal_notified_at", null)
      .lt("internal_notify_attempts", MAX_ATTEMPTS)
      .lte("created_at", dueBefore)
      .gte("created_at", notOlderThan);
    if (error) throw error;

    if (!rows || rows.length === 0) {
      return res.json({ ok: true, due: 0, notified: 0, gaveUp: 0 });
    }

    let notified = 0;
    let gaveUp = 0;

    for (const row of rows) {
      const lead = { ...(row.data || {}), id: row.id };
      const notifyTo = lead?.target_email || NOTIFY_EMAIL;
      const attempts = (row.internal_notify_attempts || 0) + 1;

      try {
        await resend.emails.send({
          from: FROM,
          to: notifyTo,
          subject: `🔥 Nova reserva — ${lead?.client?.name || lead?.email || "sem nome"}`,
          html: internalEmail(lead),
        });
        await supabase.from("leads").update({
          internal_notified_at: new Date().toISOString(),
          internal_notify_attempts: attempts,
        }).eq("id", row.id);
        notified++;
      } catch (mailErr) {
        console.error("[RetryFailedNotifications] Resend error:", mailErr);
        await supabase.from("leads").update({ internal_notify_attempts: attempts }).eq("id", row.id);
        if (attempts >= MAX_ATTEMPTS) gaveUp++;
      }
    }

    return res.json({ ok: true, due: rows.length, notified, gaveUp });
  } catch (err: any) {
    console.error("[RetryFailedNotifications] failed:", err);
    return res.status(500).json({ ok: false, error: err?.message || "error" });
  }
}
