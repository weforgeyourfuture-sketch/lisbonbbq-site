import { createClient } from "@supabase/supabase-js";
import { Resend } from "resend";

// Vercel empacota cada rota em api/ isoladamente e não traça imports fora desta
// pasta (o import de ../constants partiu a função em produção com
// ERR_MODULE_NOT_FOUND). Por isso o valor vem hardcoded — tem de ficar igual a
// OWN_LOCATION_ID em constants.ts.
const OWN_LOCATION_ID = "own_location";

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

const resend = new Resend(process.env.RESEND_API_KEY);

const FROM = "LisbonBBQ <noreply@lisbonbbq.pt>";
const NOTIFY_EMAIL = "pitmasters@lisbonbbq.pt";

function formatDate(iso: string | undefined, lang: "pt" | "en" = "pt") {
  if (!iso) return "—";
  // O servidor corre em UTC; sem timeZone explícita, datas guardadas como
  // meia-noite de Lisboa (23:00Z no verão) apareceriam como o dia anterior.
  return new Date(iso).toLocaleDateString(lang === "en" ? "en-GB" : "pt-PT", {
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

function traditionLabel(t: string, lang: "pt" | "en" = "pt") {
  const pt: Record<string, string> = { brazilian: "Churrasco Brasileiro 🇧🇷", portuguese: "Churrasco Português 🇵🇹", argentinian: "Asado Argentino 🇦🇷" };
  const en: Record<string, string> = { brazilian: "Brazilian Barbecue 🇧🇷", portuguese: "Portuguese Barbecue 🇵🇹", argentinian: "Argentinian Asado 🇦🇷" };
  return (lang === "en" ? en : pt)[t] || t;
}

function internalEmail(lead: any, opts: { incomplete?: boolean } = {}) {
  const b = lead.booking || {};
  const c = lead.client || {};
  const isCorporate = lead.source === "corporate";
  const extras = (lead.extras || []).map((e: any) => e.qty > 1 ? `${e.name} ×${e.qty}` : e.name).join(", ") || "Nenhum";
  const title = opts.incomplete ? "⏳ Lead incompleta — LisbonBBQ" : "🔥 Nova Reserva — LisbonBBQ";
  const banner = opts.incomplete
    ? `<p style="margin:0 0 16px;padding:12px 16px;background:#FFF3CD;border-left:4px solid #FFD600;font-size:14px;color:#664d03;">O cliente começou o pedido mas <strong>não finalizou</strong> nos 5 minutos seguintes. Abaixo estão os dados que o site conseguiu recolher.</p>`
    : "";

  // Leads corporate não passam pelo fluxo de reserva: os campos de booking são
  // placeholders (Local "TBD", tradição por defeito, data = hora da submissão).
  // Mostra os dados reais do pedido — incluindo a mensagem, onde vive o detalhe
  // do evento — em vez dos placeholders.
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
  <h1>${title}</h1>
  ${banner}
  <table>${rows}
  </table>
</div>
</body>
</html>`;
}

function confirmationEmail(lead: any, lang: "pt" | "en" = "pt") {
  const b = lead.booking || {};
  const c = lead.client || {};
  const isCorporate = lead.source === "corporate";

  const en = lang === "en";
  const T = {
    title: en ? "🔥 Request received — LisbonBBQ" : "🔥 Pedido recebido — LisbonBBQ",
    hi: en ? "Hi" : "Olá",
    intro: en
      ? "We've received your request. Our team will be in touch shortly to confirm the details and send your proposal."
      : "Recebemos o teu pedido. A nossa equipa vai entrar em contacto em breve para confirmar os detalhes e enviar proposta.",
    rDate: en ? "Date" : "Data",
    rVenue: en ? "Venue" : "Local",
    rTradition: en ? "Tradition" : "Tradição",
    rSlot: en ? "Time" : "Horário",
    rGuests: en ? "Guests" : "Convidados",
    pax: en ? "pax" : "pax",
    any: en
      ? "Any questions, just reply to this email or contact us directly."
      : "Qualquer dúvida responde a este email ou contacta-nos diretamente.",
    thanks: en ? "Thank you," : "Obrigado,",
    team: en ? "The LisbonBBQ Team" : "Equipa LisbonBBQ",
  };

  // Corporate leads carry placeholder booking data (Local "TBD", etc.), so show a
  // clean, corporate-specific summary instead of the booking-flow fields.
  const rows = isCorporate
    ? `
      ${lead.corporate?.date ? `<tr><td>${T.rDate}</td><td>${formatDate(lead.corporate.date, lang)}</td></tr>` : ""}
      <tr><td>${T.rVenue}</td><td>${lead.summary?.location || (en ? "To be decided" : "A decidir")}</td></tr>
      <tr><td>${T.rTradition}</td><td>${lead.corporate?.bbqStyle ? traditionLabel(lead.corporate.bbqStyle, lang) : (en ? "Not decided yet" : "Ainda não sei")}</td></tr>
      <tr><td>${T.rGuests}</td><td>${lead.corporate?.guests || b.guests || "—"} ${T.pax}</td></tr>`
    : `
      <tr><td>${T.rDate}</td><td>${formatDate(b.date, lang)}</td></tr>
      <tr><td>${T.rVenue}</td><td>${lead.summary?.location || b.locationId || "—"}</td></tr>
      <tr><td>${T.rTradition}</td><td>${traditionLabel(b.tradition, lang)}</td></tr>
      <tr><td>${T.rSlot}</td><td>${b.slot || "—"}</td></tr>
      <tr><td>${T.rGuests}</td><td>${b.guests || "—"} ${T.pax}</td></tr>`;

  return `
<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><style>
  body { font-family: Arial, sans-serif; background: #f5f5f5; margin: 0; padding: 24px; }
  .card { background: #fff; border: 3px solid #111; max-width: 600px; margin: 0 auto; padding: 32px; }
  h1 { background: #FFD600; color: #111; margin: -32px -32px 24px; padding: 20px 32px; font-size: 22px; border-bottom: 3px solid #111; }
  p { font-size: 16px; line-height: 1.6; color: #333; }
  .highlight { background: #FFF9C4; border-left: 4px solid #FFD600; padding: 16px; margin: 20px 0; }
  table { width: 100%; border-collapse: collapse; margin-top: 16px; }
  td { padding: 10px 8px; border-bottom: 1px solid #eee; font-size: 15px; }
  td:first-child { font-weight: bold; width: 40%; color: #555; }
  .footer { margin-top: 32px; font-size: 13px; color: #999; border-top: 1px solid #eee; padding-top: 16px; }
</style></head>
<body>
<div class="card">
  <h1>${T.title}</h1>
  <p>${T.hi} <strong>${c.name?.split(" ")[0] || ""}!</strong></p>
  <p>${T.intro}</p>
  <div class="highlight">
    <table>${rows}
    </table>
  </div>
  <p>${T.any}</p>
  <p>${T.thanks}<br><strong>${T.team}</strong></p>
  <div class="footer">LisbonBBQ · Lisboa, Portugal · lisbonbbq.pt</div>
</div>
</body>
</html>`;
}

export default async function handler(req: any, res: any) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const leadData = req.body;
  const email = leadData?.client?.email || leadData?.email || null;
  const source = leadData?.source || "direct";

  console.log(`[Lead] New submission — email: ${email}, source: ${source}`);

  // 1. Save to Supabase
  let leadId: string | undefined;
  try {
    const { data: inserted, error } = await supabase
      .from("leads")
      .insert({ data: leadData, source, email })
      .select("id")
      .single();
    if (error) {
      console.error("[Lead] Supabase error:", error);
      throw error;
    }
    leadId = inserted?.id;
    console.log("[Lead] Saved to Supabase");
  } catch (err) {
    console.error("[Lead] Supabase failed:", err);
    return res.status(500).json({ success: false, error: "Database error" });
  }

  // Early capture (name + phone collected before the extras step): persist to the
  // database only. The confirmation/notification emails are sent on the final
  // submission, once the client provides their email and chooses extras.
  if (leadData?.stage === "partial") {
    return res.json({ success: true, stage: "partial", message: "Lead parcial guardada." });
  }

  // 2. Send emails via Resend
  const notifyTo = leadData?.target_email || NOTIFY_EMAIL;
  // Client confirmation follows the language of the site the lead came from.
  const lang: "pt" | "en" = leadData?.lang === "en" ? "en" : "pt";
  const clientSubject = lang === "en"
    ? "LisbonBBQ — Request received 🔥"
    : "LisbonBBQ — Pedido recebido 🔥";

  // Tracked independently from the client confirmation below: a Resend outage
  // or a bad client email must not hide the fact that the team was never
  // notified. Failures here leave `internal_notified_at` unset so the
  // retry-failed-notifications cron (every 5 min) picks the lead back up —
  // this is what should have caught the Ricardo Lopes miss on 2026-08-25.
  const [internalResult] = await Promise.allSettled([
    resend.emails.send({
      from: FROM,
      to: notifyTo,
      subject: `🔥 Nova reserva — ${leadData?.client?.name || email}`,
      html: internalEmail(leadData),
    }),
    // Client confirmation (only if we have their email) — best effort, not tracked.
    ...(email ? [resend.emails.send({
      from: FROM,
      to: email,
      subject: clientSubject,
      html: confirmationEmail(leadData, lang),
    })] : []),
  ]);

  if (internalResult.status === "fulfilled") {
    console.log("[Lead] Internal notification sent via Resend");
    if (leadId) {
      await supabase.from("leads").update({
        internal_notified_at: new Date().toISOString(),
        internal_notify_attempts: 1,
      }).eq("id", leadId);
    }
  } else {
    console.error("[Lead] Resend error (internal notification):", internalResult.reason);
    if (leadId) {
      await supabase.from("leads").update({ internal_notify_attempts: 1 }).eq("id", leadId);
    }
  }

  return res.json({ success: true, message: "Lead recebida e processada." });
}
