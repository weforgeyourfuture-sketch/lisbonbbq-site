import { createClient } from "@supabase/supabase-js";
import { Resend } from "resend";
import { randomBytes } from "crypto";

// Um único ficheiro para toda a rota /api/events/* (GET evento, GET .ics,
// POST dieta, POST codigo): o plano Hobby da Vercel limita a 12 Serverless
// Functions por deployment, e um ficheiro por endpoint (index/dieta/codigo/ics)
// ultrapassava esse limite. O catch-all [...params] despacha por método +
// segmento em vez de depender do routing por ficheiro.

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);
const resend = new Resend(process.env.RESEND_API_KEY);

const FROM = "LisbonBBQ <noreply@lisbonbbq.pt>";
const NOTIFY_EMAIL = "pitmasters@lisbonbbq.pt";

const DIET_LABELS: Record<string, string> = {
  nenhuma: "Come de tudo",
  vegetariano: "Vegetariano",
  vegano: "Vegano",
  gluten: "Sem glúten",
  lactose: "Sem lactose",
  alergia: "Tem alergia",
};

function escapeHtml(text: string | undefined | null) {
  if (!text) return "";
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function isValidEmail(email: string) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

function toIcsDate(iso: string) {
  return new Date(iso).toISOString().replace(/[-:]/g, "").split(".")[0] + "Z";
}

// Escapa vírgulas, ponto-e-vírgula, barras invertidas e quebras de linha
// conforme o RFC 5545 (secção 3.3.11).
function escapeIcsText(text: string) {
  return text
    .replace(/\\/g, "\\\\")
    .replace(/,/g, "\\,")
    .replace(/;/g, "\\;")
    .replace(/\n/g, "\\n");
}

// Código pessoal e rastreável ao evento de origem: prefixo do slug + 4
// caracteres aleatórios. Usado só quando o evento não tem um referral_code
// fixo definido (ex.: código estático "SOFIA40" partilhado por todos).
function generateCode(slug: string) {
  const prefix = slug.replace(/[^a-z0-9]/gi, "").slice(0, 6).toUpperCase();
  const suffix = randomBytes(3).toString("hex").toUpperCase().slice(0, 4);
  return `${prefix}-${suffix}`;
}

function internalDietEmail(event: any, diet: string, detail: string, email: string) {
  return `
<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><style>
  body { font-family: Arial, sans-serif; background: #f5f5f5; margin: 0; padding: 24px; }
  .card { background: #fff; border: 3px solid #111; max-width: 600px; margin: 0 auto; padding: 32px; }
  h1 { background: #F4B41A; color: #111; margin: -32px -32px 24px; padding: 20px 32px; font-size: 22px; border-bottom: 3px solid #111; }
  table { width: 100%; border-collapse: collapse; margin-top: 16px; }
  td { padding: 10px 8px; border-bottom: 1px solid #eee; font-size: 15px; }
  td:first-child { font-weight: bold; width: 32%; color: #555; }
</style></head>
<body>
<div class="card">
  <h1>🌱 Resposta de dieta — ${escapeHtml(event.title)}</h1>
  <table>
    <tr><td>Email</td><td><a href="mailto:${escapeHtml(email)}">${escapeHtml(email)}</a></td></tr>
    <tr><td>Restrição</td><td>${escapeHtml(DIET_LABELS[diet] || diet)}</td></tr>
    <tr><td>Detalhes</td><td>${escapeHtml(detail) || "—"}</td></tr>
    <tr><td>Evento</td><td>${escapeHtml(event.slug)}</td></tr>
  </table>
</div>
</body>
</html>`;
}

function confirmationDietEmail(event: any, diet: string, detail: string) {
  return `
<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><style>
  body { font-family: Arial, sans-serif; background: #f5f5f5; margin: 0; padding: 24px; }
  .card { background: #fff; border: 3px solid #111; max-width: 600px; margin: 0 auto; padding: 32px; }
  h1 { background: #F4B41A; color: #111; margin: -32px -32px 24px; padding: 20px 32px; font-size: 22px; border-bottom: 3px solid #111; }
  p { font-size: 16px; line-height: 1.6; color: #333; }
  .highlight { background: #FFF9C4; border-left: 4px solid #F4B41A; padding: 16px; margin: 20px 0; font-size: 15px; }
  .footer { margin-top: 32px; font-size: 13px; color: #999; border-top: 1px solid #eee; padding-top: 16px; }
</style></head>
<body>
<div class="card">
  <h1>🔥 Anotado — ${escapeHtml(event.title)}</h1>
  <p>Os pitmasters já sabem.</p>
  <div class="highlight">
    <strong>${escapeHtml(DIET_LABELS[diet] || diet)}</strong>
    ${detail ? `<br>${escapeHtml(detail)}` : ""}
  </div>
  <p>Podes alterar a tua resposta a qualquer momento, basta submeteres o formulário de novo com o mesmo email.</p>
  <p>Alergia grave? Fala directamente com os pitmasters: <a href="mailto:pitmasters@lisbonbbq.pt">pitmasters@lisbonbbq.pt</a> ou +351 961 058 571.</p>
  <div class="footer">LisbonBBQ · Lisboa, Portugal · lisbonbbq.pt</div>
</div>
</body>
</html>`;
}

function codeEmail(event: any, code: string) {
  return `
<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><style>
  body { font-family: Arial, sans-serif; background: #f5f5f5; margin: 0; padding: 24px; }
  .card { background: #fff; border: 3px solid #111; max-width: 600px; margin: 0 auto; padding: 32px; text-align: center; }
  h1 { background: #F4B41A; color: #111; margin: -32px -32px 24px; padding: 20px 32px; font-size: 22px; border-bottom: 3px solid #111; text-align: left; }
  p { font-size: 16px; line-height: 1.6; color: #333; }
  .code { display: inline-block; background: #111; color: #F4B41A; font-size: 28px; font-weight: 900; letter-spacing: 2px; padding: 14px 24px; margin: 16px 0; }
  .footer { margin-top: 32px; font-size: 13px; color: #999; border-top: 1px solid #eee; padding-top: 16px; text-align: left; }
</style></head>
<body>
<div class="card">
  <h1>🔥 O teu código</h1>
  <p>Obrigado por teres estado no evento <strong>${event.title}</strong>. Aqui está o teu código de desconto:</p>
  <div class="code">${code}</div>
  <p>${event.referral_discount_eur}€ de desconto no teu próximo churrasco${event.referral_valid_until ? `, válido até ${new Date(event.referral_valid_until).toLocaleDateString("pt-PT", { timeZone: "Europe/Lisbon" })}` : ""}.</p>
  <p><a href="https://lisbonbbq.pt/#reservar">Pedir orçamento em lisbonbbq.pt</a></p>
  <div class="footer">LisbonBBQ · Lisboa, Portugal · lisbonbbq.pt</div>
</div>
</body>
</html>`;
}

async function handleGetEvent(req: any, res: any, slug: string) {
  const { data: event, error } = await supabase
    .from("events")
    .select("*")
    .eq("slug", slug)
    .eq("published", true)
    .maybeSingle();

  if (error) {
    console.error("[Events] Supabase error:", error);
    return res.status(500).json({ error: "Database error" });
  }
  if (!event) {
    return res.status(404).json({ error: "Not found" });
  }

  const { data: menuItems, error: menuError } = await supabase
    .from("event_menu_items")
    .select("*")
    .eq("event_id", event.id)
    .order("section", { ascending: true })
    .order("sort_order", { ascending: true });

  if (menuError) {
    console.error("[Events] Supabase menu error:", menuError);
    return res.status(500).json({ error: "Database error" });
  }

  return res.json({ event, menuItems: menuItems || [] });
}

async function handleIcs(req: any, res: any, slug: string) {
  const { data: event, error } = await supabase
    .from("events")
    .select("id, slug, title, starts_at, ends_at, venue_name, venue_address")
    .eq("slug", slug)
    .eq("published", true)
    .maybeSingle();

  if (error) {
    console.error("[EventIcs] Supabase error:", error);
    return res.status(500).json({ error: "Database error" });
  }
  if (!event) {
    return res.status(404).json({ error: "Not found" });
  }

  const dtStart = toIcsDate(event.starts_at);
  // Sem ends_at definido, assume um evento de 4 horas.
  const dtEnd = toIcsDate(event.ends_at || new Date(new Date(event.starts_at).getTime() + 4 * 60 * 60 * 1000).toISOString());
  const location = [event.venue_name, event.venue_address].filter(Boolean).join(", ");

  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//LisbonBBQ//Event//PT",
    "CALSCALE:GREGORIAN",
    "BEGIN:VEVENT",
    `UID:${event.id}@lisbonbbq.pt`,
    `DTSTAMP:${toIcsDate(new Date().toISOString())}`,
    `DTSTART:${dtStart}`,
    `DTEND:${dtEnd}`,
    `SUMMARY:${escapeIcsText(event.title)}`,
    location ? `LOCATION:${escapeIcsText(location)}` : null,
    "DESCRIPTION:Fire. Long Tables. Building Community. — LisbonBBQ",
    "END:VEVENT",
    "END:VCALENDAR",
  ].filter(Boolean);

  res.setHeader("Content-Type", "text/calendar; charset=utf-8");
  res.setHeader("Content-Disposition", `attachment; filename="${event.slug}.ics"`);
  return res.status(200).send(lines.join("\r\n"));
}

async function handleDieta(req: any, res: any, slug: string) {
  const { email, diet, detail, marketingOptin } = req.body || {};

  if (!email || !isValidEmail(email) || !diet) {
    return res.status(400).json({ error: "Dados inválidos" });
  }
  const normalizedEmail = String(email).trim().toLowerCase();

  const { data: event, error: eventError } = await supabase
    .from("events")
    .select("id, slug, title")
    .eq("slug", slug)
    .eq("published", true)
    .maybeSingle();

  if (eventError) {
    console.error("[EventDieta] Supabase error:", eventError);
    return res.status(500).json({ error: "Database error" });
  }
  if (!event) {
    return res.status(404).json({ error: "Not found" });
  }

  const now = new Date().toISOString();
  const optin = !!marketingOptin;

  // Preserve the original optin_at if the guest already opted in previously and
  // resubmits still checked — otherwise this upsert would overwrite it with
  // "now" every time, undermining the audit trail of when consent was given.
  const { data: existing } = await supabase
    .from("event_diet_responses")
    .select("optin_at")
    .eq("event_id", event.id)
    .eq("email", normalizedEmail)
    .maybeSingle();

  const { error: upsertError } = await supabase
    .from("event_diet_responses")
    .upsert(
      {
        event_id: event.id,
        email: normalizedEmail,
        diet,
        detail: detail || null,
        marketing_optin: optin,
        optin_at: optin ? existing?.optin_at || now : null,
        optin_source: optin ? "event_page" : null,
        updated_at: now,
      },
      { onConflict: "event_id,email" }
    );

  if (upsertError) {
    console.error("[EventDieta] Upsert error:", upsertError);
    return res.status(500).json({ error: "Database error" });
  }

  try {
    await Promise.all([
      resend.emails.send({
        from: FROM,
        to: NOTIFY_EMAIL,
        subject: `🌱 Dieta — ${event.title} — ${normalizedEmail}`,
        html: internalDietEmail(event, diet, detail, normalizedEmail),
      }),
      resend.emails.send({
        from: FROM,
        to: normalizedEmail,
        subject: `Anotado 🔥 — ${event.title}`,
        html: confirmationDietEmail(event, diet, detail),
      }),
    ]);
  } catch (err) {
    console.error("[EventDieta] Resend error:", err);
  }

  return res.json({ success: true });
}

async function handleCodigo(req: any, res: any, slug: string) {
  const { email } = req.body || {};

  if (!email || !isValidEmail(email)) {
    return res.status(400).json({ error: "Dados inválidos" });
  }
  const normalizedEmail = String(email).trim().toLowerCase();

  const { data: event, error: eventError } = await supabase
    .from("events")
    .select("id, slug, title, referral_code, referral_discount_eur, referral_valid_until")
    .eq("slug", slug)
    .eq("published", true)
    .maybeSingle();

  if (eventError) {
    console.error("[EventCodigo] Supabase error:", eventError);
    return res.status(500).json({ error: "Database error" });
  }
  if (!event) {
    return res.status(404).json({ error: "Not found" });
  }

  // Reenviar o mesmo código se a pessoa já o tinha pedido antes.
  const { data: existing } = await supabase
    .from("event_code_requests")
    .select("code")
    .eq("event_id", event.id)
    .eq("email", normalizedEmail)
    .maybeSingle();

  const code = event.referral_code || existing?.code || generateCode(event.slug);
  const now = new Date().toISOString();

  const { error: upsertError } = await supabase
    .from("event_code_requests")
    .upsert(
      { event_id: event.id, email: normalizedEmail, code, sent_at: now },
      { onConflict: "event_id,email" }
    );

  if (upsertError) {
    console.error("[EventCodigo] Upsert error:", upsertError);
    return res.status(500).json({ error: "Database error" });
  }

  try {
    await resend.emails.send({
      from: FROM,
      to: normalizedEmail,
      subject: `O teu código de desconto — ${event.title}`,
      html: codeEmail(event, code),
    });
  } catch (err) {
    console.error("[EventCodigo] Resend error:", err);
  }

  return res.json({ success: true });
}

export default async function handler(req: any, res: any) {
  const params: string[] = Array.isArray(req.query.params)
    ? req.query.params
    : req.query.params
    ? [req.query.params]
    : [];
  const [slug, action] = params;

  if (!slug) {
    return res.status(404).json({ error: "Not found" });
  }

  if (!action) {
    if (req.method !== "GET") return res.status(405).json({ error: "Method not allowed" });
    return handleGetEvent(req, res, slug);
  }

  if (action === "ics") {
    if (req.method !== "GET") return res.status(405).json({ error: "Method not allowed" });
    return handleIcs(req, res, slug);
  }

  if (action === "dieta") {
    if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });
    return handleDieta(req, res, slug);
  }

  if (action === "codigo") {
    if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });
    return handleCodigo(req, res, slug);
  }

  return res.status(404).json({ error: "Not found" });
}
