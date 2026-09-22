import { createClient } from "@supabase/supabase-js";
import { Resend } from "resend";
import { createHash } from "crypto";

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);
const resend = new Resend(process.env.RESEND_API_KEY);

const FROM = "LisbonBBQ <noreply@lisbonbbq.pt>";
const NOTIFY_EMAIL = "pitmasters@lisbonbbq.pt";

function formatDate(iso: string | undefined) {
  if (!iso) return "—";
  // O servidor corre em UTC; sem timeZone explícita, datas guardadas como
  // meia-noite de Lisboa (23:00Z no verão) apareceriam como o dia anterior.
  return new Date(iso).toLocaleDateString("pt-PT", {
    weekday: "long", year: "numeric", month: "long", day: "numeric",
    timeZone: "Europe/Lisbon"
  });
}

function traditionLabel(t: string) {
  return ({ brazilian: "Churrasco Brasileiro 🇧🇷", portuguese: "Churrasco Português 🇵🇹", argentinian: "Asado Argentino 🇦🇷" } as Record<string, string>)[t] || t || "—";
}

function escapeHtml(text: string | undefined) {
  if (!text) return "";
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
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

  // O capture parcial do form corporate grava o que já estava preenchido no
  // momento em que a pessoa saiu da página — mostra os mesmos campos do
  // email final, cada um com "—"/"A decidir"/"Ainda não sei" quando vazio.
  const rows = isCorporate
    ? `
    <tr><td>Cliente</td><td>${c.name || "—"}</td></tr>
    <tr><td>Email</td><td>${c.email ? `<a href="mailto:${c.email}">${c.email}</a>` : "—"}</td></tr>
    <tr><td>Telefone</td><td>${c.phone || "—"}</td></tr>
    <tr><td>Local</td><td>${lead.summary?.location || "A decidir"}</td></tr>
    <tr><td>Tipo de churrasco</td><td>${lead.corporate?.bbqStyle ? traditionLabel(lead.corporate.bbqStyle) : "Ainda não sei"}</td></tr>
    <tr><td>Data do Evento</td><td>${lead.corporate?.date ? formatDate(lead.corporate.date) : "—"}</td></tr>
    <tr><td>Convidados</td><td>${lead.corporate?.guests || "—"} pax</td></tr>
    <tr><td>Mensagem</td><td>${escapeHtml(lead.corporate?.message) || "—"}</td></tr>
    <tr><td>ID</td><td style="font-size:12px;color:#999">${lead.id || "—"}</td></tr>`
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
    <tr><td>ID</td><td style="font-size:12px;color:#999">${lead.id || "—"}</td></tr>`;

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

// Minutes a partial lead (name + phone only) waits before we notify the team —
// gives the client time to finish the form. If they complete, the normal
// notification already fired and we skip the partial one (no duplicates).
const WAIT_MINUTES = 5;

/**
 * Triggered on a schedule (Supabase pg_cron). Finds partial leads that are older
 * than WAIT_MINUTES and not yet notified, and — unless the same person has since
 * completed the form — sends the team an "incomplete lead" email with whatever
 * data the site managed to collect. Idempotent: every processed row is stamped
 * with `partial_notified_at` so it is never emailed twice.
 *
 * Discriminator: partial leads are stamped with `stage: "partial"` in `data`.
 * Not the top-level `email` column — o capture parcial do form corporate já
 * recolhe o email antes do telemóvel, por isso essa coluna não fica a NULL
 * como no capture parcial da homepage (nome + telefone, sem email).
 */
export default async function handler(req: any, res: any) {
  // Auth: the scheduler sends the SHA-256 of the service-role key (a non-secret
  // value), so the actual key is never embedded in the cron job definition.
  const expected = createHash("sha256")
    .update(process.env.SUPABASE_SERVICE_ROLE_KEY || "")
    .digest("hex");
  const secret = req.headers?.["x-cron-secret"];
  if (secret !== expected) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  const now = Date.now();
  const dueBefore = new Date(now - WAIT_MINUTES * 60 * 1000).toISOString();
  const completedSince = new Date(now - 6 * 60 * 60 * 1000).toISOString();

  try {
    // Partial leads old enough to act on and not yet processed.
    const { data: partials, error: pErr } = await supabase
      .from("leads")
      .select("id, created_at, data")
      .eq("data->>stage", "partial")
      .is("partial_notified_at", null)
      .lte("created_at", dueBefore);
    if (pErr) throw pErr;

    if (!partials || partials.length === 0) {
      return res.json({ ok: true, due: 0, notified: 0, skipped: 0 });
    }

    // Phones of anyone who completed (email present) in the recent window.
    const { data: completed, error: cErr } = await supabase
      .from("leads")
      .select("data, created_at")
      .not("email", "is", null)
      .gte("created_at", completedSince);
    if (cErr) throw cErr;

    const completedPhones = new Set(
      (completed || []).map((r: any) => r.data?.client?.phone).filter(Boolean)
    );

    let notified = 0;
    let skipped = 0;

    for (const row of partials) {
      const lead = row.data || {};
      const phone = lead?.client?.phone;
      const completedForm = phone && completedPhones.has(phone);

      if (!completedForm) {
        const notifyTo = lead?.target_email || NOTIFY_EMAIL;
        try {
          await resend.emails.send({
            from: FROM,
            to: notifyTo,
            subject: `⏳ Lead incompleta — ${lead?.client?.name || phone || "sem nome"}`,
            html: internalEmail(lead, { incomplete: true }),
          });
          notified++;
        } catch (mailErr) {
          console.error("[PartialLeads] Resend error:", mailErr);
          // leave partial_notified_at unset so the next run retries this one
          continue;
        }
      } else {
        skipped++;
      }

      await supabase
        .from("leads")
        .update({ partial_notified_at: new Date().toISOString() })
        .eq("id", row.id);
    }

    return res.json({ ok: true, due: partials.length, notified, skipped });
  } catch (err: any) {
    console.error("[PartialLeads] failed:", err);
    return res.status(500).json({ ok: false, error: err?.message || "error" });
  }
}
