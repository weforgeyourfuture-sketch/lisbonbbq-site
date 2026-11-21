import { createClient } from "@supabase/supabase-js";
import { Resend } from "resend";
import { randomInt, createHmac, timingSafeEqual } from "crypto";

// Waiting list do workshop de churrasco (lisbonbbq.pt/workshop).
//
// POST: inscreve na lista, gera o código de convite pessoal e envia o email de
//       boas-vindas com o convite ("traz um camarada"). Se a inscrição vier de um
//       convite (?c=CODIGO), liga as duas pessoas e fixa o preço de convite.
// GET ?task=reminders: cron diário de lembretes (ver runReminders).
// GET ?c=CODIGO: valida um código e devolve o primeiro nome de quem convidou,
//       para a página mostrar "O Rui guardou-te um lugar".
// GET ?task=editions: datas de workshop à venda (tabela workshop_editions).
// POST ?task=checkout: cria a reserva pendente e a sessão Stripe Checkout.
// POST ?task=stripe-webhook: eventos da Stripe (conta "Lisbob BBQ") → marca a
//       reserva como paga/expirada/reembolsada e envia a confirmação.
// GET ?task=booking&session_id=…: estado da reserva para a página de regresso.
//
// Tudo neste ficheiro porque o plano Hobby da Vercel limita o deploy a 12
// funções em api/ (já estamos nas 12). O bodyParser está desligado para o
// webhook poder validar a assinatura sobre o corpo cru; os outros POST fazem
// JSON.parse à mão (readJsonBody).
//
// Os preços vivem aqui (e não no cliente) para ninguém escolher o próprio preço.
// Têm de ficar iguais a WORKSHOP_PRICES em components/WorkshopView.tsx — a Vercel
// empacota cada função de api/ isoladamente e não traça imports de fora.
const PRICES: Record<string, { public: number; invite: number }> = {
  a: { public: 110, invite: 90 },
  b: { public: 95, invite: 80 },
};

const SITE = "https://lisbonbbq.pt";
const FROM = "LisbonBBQ <noreply@lisbonbbq.pt>";
const REPLY_TO = "pitmasters@lisbonbbq.pt";
const NOTIFY_EMAIL = "pitmasters@lisbonbbq.pt";
const CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

const CONSENT_TEXT =
  "Autorizo a Lisbon BBQ a guardar estes dados para me contactar sobre o workshop de churrasco da Lisbon BBQ, de acordo com o RGPD. Posso pedir para os apagar a qualquer momento em pitmasters@lisbonbbq.pt.";

// O que a pessoa leu na versão inglesa da página: fica guardado tal e qual.
const CONSENT_TEXT_EN =
  "I authorise Lisbon BBQ to store this data to contact me about the Lisbon BBQ barbecue workshop, in accordance with the GDPR. I can ask for it to be deleted at any time at pitmasters@lisbonbbq.pt.";

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);
const resend = new Resend(process.env.RESEND_API_KEY);

function escapeHtml(text: string | undefined | null) {
  if (!text) return "";
  return String(text)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

const firstName = (name: string) => (name || "").trim().split(/\s+/)[0] || "";

function newCode() {
  let c = "";
  for (let i = 0; i < 6; i++) c += CODE_ALPHABET[randomInt(CODE_ALPHABET.length)];
  return c;
}

function cleanCode(raw: unknown) {
  const c = String(raw || "").toUpperCase().replace(/[^A-Z0-9]/g, "");
  return c.length === 6 ? c : null;
}

type Lang = "pt" | "en";

function str(v: unknown, max = 200) {
  return typeof v === "string" ? v.trim().slice(0, max) : "";
}

function inviteLink(code: string) {
  return `${SITE}/workshop?c=${code}`;
}

function layout(title: string, body: string, lang: Lang = "pt") {
  return `<!DOCTYPE html>
<html lang="${lang === "en" ? "en" : "pt-PT"}"><head><meta charset="utf-8"><style>
  body { font-family: Arial, sans-serif; background: #F9F7F2; margin: 0; padding: 24px; color: #1A1A1A; }
  .card { background: #fff; border: 4px solid #1A1A1A; max-width: 600px; margin: 0 auto; padding: 32px; }
  h1 { background: #D91A2A; color: #fff; margin: -32px -32px 24px; padding: 20px 32px; font-size: 22px; text-transform: uppercase; border-bottom: 4px solid #1A1A1A; }
  p { font-size: 16px; line-height: 1.6; margin: 0 0 16px; }
  .box { background: #F4B41A; border: 3px solid #1A1A1A; padding: 20px; margin: 24px 0; }
  .box p { margin: 0 0 12px; }
  .btn { display: inline-block; background: #1A1A1A; color: #F4B41A !important; text-decoration: none; font-weight: bold; text-transform: uppercase; padding: 14px 22px; letter-spacing: 1px; }
  .link { font-size: 13px; word-break: break-all; color: #1A1A1A; }
  .footer { margin-top: 32px; font-size: 13px; color: #6B7280; border-top: 1px solid #eee; padding-top: 16px; }
</style></head><body><div class="card">
  <h1>${title}</h1>
  ${body}
  <div class="footer">Lisbon Barbecue &amp; Churrasco · Lisboa · <a href="${SITE}" style="color:#6B7280">lisbonbbq.pt</a><br>
  ${lang === "en"
    ? `You are receiving this email because you joined the workshop waiting list. To stop receiving them, reply with "unsubscribe".`
    : `Recebes este email porque entraste na waiting list do workshop. Para deixares de receber, responde com "sair".`}</div>
</div></body></html>`;
}

function inviteBox(code: string, p: { public: number; invite: number }, lang: Lang = "pt") {
  const link = inviteLink(code);
  if (lang === "en") {
    return `<div class="box">
    <p><strong>You have an invite to give away.</strong> Anyone who signs up with your link joins your grill station, and you both pay <strong>€${p.invite} instead of €${p.public}</strong>.</p>
    <p>It works for as many mates as you like. Each pays €${p.invite}, and so do you.</p>
    <p style="margin:16px 0 8px"><a class="btn" href="${link}">Share my invite</a></p>
    <p class="link" style="margin:0">${link}</p>
  </div>`;
  }
  return `<div class="box">
    <p><strong>Tens um convite para oferecer.</strong> Quem se inscrever com o teu link fica na tua estação de grelha, e os dois pagam <strong>${p.invite}€ em vez de ${p.public}€</strong>.</p>
    <p>Vale para quantos camaradas quiseres. Cada um paga ${p.invite}€, e tu também.</p>
    <p style="margin:16px 0 8px"><a class="btn" href="${link}">Partilhar o meu convite</a></p>
    <p class="link" style="margin:0">${link}</p>
  </div>`;
}

function welcomeEmail(row: any, p: { public: number; invite: number }, inviterFirst?: string, lang: Lang = "pt") {
  const fn = escapeHtml(firstName(row.name));
  if (lang === "en") {
    const viaInviteEn = inviterFirst
      ? `<p>You came in through <strong>${escapeHtml(inviterFirst)}</strong>'s invite: your spot is <strong>€${p.invite}</strong>, at the same grill station.</p>`
      : "";
    return layout(
      "You're on the list",
      `<p>${fn}, you're on the waiting list for the Lisbon BBQ barbecue workshop.</p>
     ${viaInviteEn}
     <p>Whenever we open new workshop dates, you hear first: you get 48 hours of priority before we open to the public. You don't pay anything now.</p>
     ${inviteBox(row.invite_code, p, "en")}
     <p>See you at the embers,<br><strong>LisbonBBQ team</strong></p>`,
      "en"
    );
  }
  const viaInvite = inviterFirst
    ? `<p>Entraste pelo convite de <strong>${escapeHtml(inviterFirst)}</strong>: o teu lugar fica a <strong>${p.invite}€</strong>, na mesma estação de grelha.</p>`
    : "";
  return layout(
    "Estás na lista",
    `<p>${fn}, já estás na waiting list do workshop de churrasco da Lisbon BBQ.</p>
     ${viaInvite}
     <p>Sempre que abrirmos novas datas de workshop, avisamos-te primeiro: tens 48 horas de prioridade antes de abrirmos ao público. Não pagas nada agora.</p>
     ${inviteBox(row.invite_code, p)}
     <p>Até à brasa,<br><strong>Equipa LisbonBBQ</strong></p>`
  );
}

function inviterJoinedEmail(inviter: any, invitee: any, p: { public: number; invite: number }) {
  if (inviter.lang === "en") {
    return layout(
      "Your mate is in",
      `<p>${escapeHtml(firstName(inviter.name))}, <strong>${escapeHtml(firstName(invitee.name))}</strong> joined the waiting list with your invite.</p>
     <p>You'll be at the same grill station and you both pay <strong>€${p.invite}</strong> instead of €${p.public}. We'll let you both know when the dates open.</p>
     <p>Your invite still works for more mates: <a href="${inviteLink(inviter.invite_code)}">${inviteLink(inviter.invite_code)}</a></p>
     <p>See you at the embers,<br><strong>LisbonBBQ team</strong></p>`,
      "en"
    );
  }
  return layout(
    "O teu camarada entrou",
    `<p>${escapeHtml(firstName(inviter.name))}, <strong>${escapeHtml(firstName(invitee.name))}</strong> entrou na waiting list com o teu convite.</p>
     <p>Ficam na mesma estação de grelha e os dois pagam <strong>${p.invite}€</strong> em vez de ${p.public}€. Avisamos-vos quando abrirem as datas.</p>
     <p>O convite continua a valer para mais camaradas: <a href="${inviteLink(inviter.invite_code)}">${inviteLink(inviter.invite_code)}</a></p>
     <p>Até à brasa,<br><strong>Equipa LisbonBBQ</strong></p>`
  );
}

function internalEmail(row: any, inviter: any | null) {
  const rows: [string, string][] = [
    ["Nome", row.name],
    ["Email", row.email],
    ["Telemóvel", row.phone],
    ["Horário", row.preferred_slot],
    ["Já grelha?", row.experience],
    ["O que o traz", row.motive],
    ["Como soube", row.heard_from || "—"],
    ["Convidado por", inviter ? `${inviter.name} (${inviter.email})` : "—"],
    ["Preço", `${row.locked_price ?? row.public_price}€ (variante ${row.price_variant})`],
    ["UTM", row.utm ? JSON.stringify(row.utm) : "—"],
    ["Código", row.invite_code],
  ];
  return `<table style="font-family:Arial,sans-serif;font-size:14px;border-collapse:collapse">${rows
    .map(([k, v]) => `<tr><td style="padding:6px 12px;font-weight:bold;color:#555">${k}</td><td style="padding:6px 12px">${escapeHtml(v)}</td></tr>`)
    .join("")}</table>`;
}

function reminderEmail(row: any) {
  const link = `${SITE}/workshop?c=${row.invite_code}`;
  if (row.lang === "en") {
    return layout(
      "Your mate can still make it",
      `<p>${escapeHtml(firstName(row.name))}, your spot on the waiting list is saved.</p>
     <p>Your invite is still on: anyone who signs up with your link joins your grill station, and you both pay <strong>€${row.invite_price} instead of €${row.public_price}</strong>.</p>
     <p><a class="btn" href="${link}">Share my invite</a></p>
     <p style="font-size:13px;word-break:break-all">${link}</p>
     <p>See you at the embers,<br><strong>LisbonBBQ team</strong></p>`,
      "en"
    );
  }
  return `<!DOCTYPE html>
<html lang="pt-PT"><head><meta charset="utf-8"><style>
  body { font-family: Arial, sans-serif; background: #F9F7F2; margin: 0; padding: 24px; color: #1A1A1A; }
  .card { background: #fff; border: 4px solid #1A1A1A; max-width: 600px; margin: 0 auto; padding: 32px; }
  h1 { background: #D91A2A; color: #fff; margin: -32px -32px 24px; padding: 20px 32px; font-size: 22px; text-transform: uppercase; border-bottom: 4px solid #1A1A1A; }
  p { font-size: 16px; line-height: 1.6; margin: 0 0 16px; }
  .btn { display: inline-block; background: #1A1A1A; color: #F4B41A !important; text-decoration: none; font-weight: bold; text-transform: uppercase; padding: 14px 22px; letter-spacing: 1px; }
  .footer { margin-top: 32px; font-size: 13px; color: #6B7280; border-top: 1px solid #eee; padding-top: 16px; }
</style></head><body><div class="card">
  <h1>O teu camarada ainda vai a tempo</h1>
  <p>${escapeHtml(firstName(row.name))}, o teu lugar na waiting list está guardado.</p>
  <p>O teu convite continua de pé: quem se inscrever com o teu link fica na tua estação de grelha, e os dois pagam <strong>${row.invite_price}€ em vez de ${row.public_price}€</strong>.</p>
  <p><a class="btn" href="${link}">Partilhar o meu convite</a></p>
  <p style="font-size:13px;word-break:break-all">${link}</p>
  <p>Até à brasa,<br><strong>Equipa LisbonBBQ</strong></p>
  <div class="footer">Lisbon Barbecue &amp; Churrasco · Lisboa · <a href="${SITE}" style="color:#6B7280">lisbonbbq.pt</a><br>
  Recebes este email porque entraste na waiting list do workshop. Para deixares de receber, responde com "sair".</div>
</div></body></html>`;
}


async function runReminders(req: any, res: any) {
  const secret = process.env.CRON_SECRET;
  if (!secret || req.headers?.authorization !== `Bearer ${secret}`) {
    return res.status(401).json({ error: "unauthorized" });
  }

  const cutoff = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000).toISOString();
  const { data: due, error } = await supabase
    .from("workshop_waitlist")
    .select("id, name, email, invite_code, public_price, invite_price, created_at, lang")
    .is("reminder_sent_at", null)
    .is("invited_by", null)
    .eq("status", "waitlist")
    .lte("created_at", cutoff)
    .limit(100);
  if (error) {
    console.error("[workshop-reminders] query failed:", error);
    return res.status(500).json({ error: "query_failed" });
  }

  let sent = 0;
  for (const row of due || []) {
    // Já trouxe alguém? Então não precisa de lembrete; marca para não voltar a ver.
    const { count } = await supabase
      .from("workshop_waitlist")
      .select("id", { count: "exact", head: true })
      .eq("invited_by", row.id);
    if ((count || 0) === 0) {
      try {
        const { error: sendError } = await resend.emails.send({
          from: FROM, to: row.email, replyTo: REPLY_TO,
          subject: row.lang === "en" ? "Your mate can still make it" : "O teu camarada ainda vai a tempo",
          html: reminderEmail(row),
        });
        if (sendError) throw sendError;
        sent++;
      } catch (e) {
        console.error("[workshop-reminders] send failed:", row.id, e);
        continue;
      }
    }
    await supabase.from("workshop_waitlist").update({ reminder_sent_at: new Date().toISOString() }).eq("id", row.id);
  }

  return res.status(200).json({ checked: (due || []).length, sent });
}

// ───────────────────────── Datas e pagamentos (Stripe) ─────────────────────────
// Mesmo modelo do Forge (course_editions + orders + webhook), sem login: a
// reserva guarda nome/email/telemóvel e a Stripe Checkout trata do pagamento
// (cartão, MB Way, Apple Pay, Klarna… conforme os métodos ativos na conta).

export const config = { api: { bodyParser: false } };

const STRIPE_API = "https://api.stripe.com/v1";
const CHECKOUT_TTL_MIN = 30; // mínimo que a Stripe aceita; o lugar fica preso este tempo
const MAX_QTY = 6;

const BOOKING_CONSENT_TEXT =
  "Aceito que a Lisbon BBQ use estes dados para gerir a minha reserva no workshop de churrasco, de acordo com o RGPD e a política de privacidade.";
const BOOKING_CONSENT_TEXT_EN =
  "I agree that Lisbon BBQ may use this data to manage my workshop booking, in accordance with the GDPR and the privacy policy.";

async function readRawBody(req: any): Promise<string> {
  // Lê o stream antes de tocar em req.body (que, se existir, é um getter que o consome).
  if (req.readable !== false && !req.readableEnded) {
    const chunks: Buffer[] = [];
    for await (const chunk of req) chunks.push(typeof chunk === "string" ? Buffer.from(chunk) : chunk);
    const raw = Buffer.concat(chunks).toString("utf8");
    if (raw) return raw;
  }
  if (typeof req.body === "string") return req.body;
  if (Buffer.isBuffer(req.body)) return req.body.toString("utf8");
  if (req.body && typeof req.body === "object") return JSON.stringify(req.body);
  return "";
}

async function readJsonBody(req: any): Promise<any> {
  try { return JSON.parse((await readRawBody(req)) || "{}"); } catch { return {}; }
}

// Codifica objetos aninhados no formato form da API Stripe (a[b][0][c]=…).
function stripeForm(obj: any, prefix = "", out: string[] = []): string {
  for (const [k, v] of Object.entries(obj)) {
    if (v === undefined || v === null) continue;
    const key = prefix ? `${prefix}[${k}]` : k;
    if (typeof v === "object") stripeForm(v, key, out);
    else out.push(`${encodeURIComponent(key)}=${encodeURIComponent(String(v))}`);
  }
  return out.join("&");
}

async function stripe(method: "GET" | "POST", path: string, params?: any) {
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) throw new Error("STRIPE_SECRET_KEY em falta");
  const body = params ? stripeForm(params) : undefined;
  const url = method === "GET" && body ? `${STRIPE_API}${path}?${body}` : `${STRIPE_API}${path}`;
  const r = await fetch(url, {
    method,
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/x-www-form-urlencoded" },
    body: method === "POST" ? body : undefined,
  });
  const data = await r.json();
  if (!r.ok) throw new Error(data?.error?.message || `Stripe ${r.status}`);
  return data;
}

// Verificação da assinatura Stripe-Signature (t=…,v1=…), como stripe.webhooks.constructEvent.
function verifyStripeSignature(payload: string, header: string, secret: string, toleranceSec = 300) {
  const parts = Object.fromEntries(
    header.split(",").map((p) => p.split("=") as [string, string]).filter((p) => p.length === 2)
  ) as Record<string, string>;
  const sigs = header.split(",").filter((p) => p.startsWith("v1=")).map((p) => p.slice(3));
  const t = Number(parts.t);
  if (!t || !sigs.length) return false;
  if (Math.abs(Date.now() / 1000 - t) > toleranceSec) return false;
  const expected = createHmac("sha256", secret).update(`${t}.${payload}`, "utf8").digest("hex");
  const exp = Buffer.from(expected, "hex");
  return sigs.some((s) => {
    const b = Buffer.from(s, "hex");
    return b.length === exp.length && timingSafeEqual(b, exp);
  });
}

const MONTHS_PT = ["janeiro", "fevereiro", "março", "abril", "maio", "junho", "julho", "agosto", "setembro", "outubro", "novembro", "dezembro"];
const MONTHS_EN = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const DAYS_PT = ["domingo", "segunda-feira", "terça-feira", "quarta-feira", "quinta-feira", "sexta-feira", "sábado"];
const DAYS_EN = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

function editionWhen(e: any, lang: Lang) {
  const [y, m, d] = String(e.date).split("-").map(Number);
  const dow = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
  const hh = (t: string) => {
    const [h, min] = String(t).split(":");
    return min && min !== "00" ? `${Number(h)}h${min}` : `${Number(h)}h`;
  };
  return lang === "en"
    ? `${DAYS_EN[dow]}, ${d} ${MONTHS_EN[m - 1]} ${y}, ${hh(e.start_time)}–${hh(e.end_time)}`
    : `${DAYS_PT[dow]}, ${d} de ${MONTHS_PT[m - 1]} de ${y}, ${hh(e.start_time)}–${hh(e.end_time)}`;
}

function publicEdition(e: any) {
  return {
    id: e.id,
    date: e.date,
    startTime: String(e.start_time).slice(0, 5),
    endTime: String(e.end_time).slice(0, 5),
    titlePt: e.title_pt,
    titleEn: e.title_en,
    location: e.location,
    price: e.price_cents / 100,
    invitePrice: e.invite_price_cents != null ? e.invite_price_cents / 100 : null,
    capacity: e.max_attendees,
    left: Math.max(0, e.max_attendees - (e.taken || 0)),
    status: e.effective_status,
  };
}

async function getEditions(res: any) {
  const { data, error } = await supabase
    .from("workshop_editions_with_status")
    .select("*")
    .in("effective_status", ["available", "sold_out"])
    .order("date", { ascending: true });
  if (error) {
    console.error("[workshop-editions] query failed:", error);
    return res.status(500).json({ error: "query_failed" });
  }
  res.setHeader("Cache-Control", "no-store");
  return res.status(200).json({ editions: (data || []).map(publicEdition) });
}

function siteOrigin(req: any) {
  const host = String(req.headers?.host || "");
  if (/^(localhost|127\.0\.0\.1)(:\d+)?$/.test(host)) return `http://${host}`;
  return SITE;
}

// Pagamento dentro do site (Stripe Elements com Checkout Sessions, ui_mode
// "elements"): a sessão é a mesma (mesmo webhook, mesmos emails), só muda a UI.
// Sem embedded, mantém o redirecionamento para a página da Stripe.
// Métodos aceites (decisão do Bruno, 21/11): cartão (inclui Apple Pay), MB Way,
// Klarna e Revolut Pay. Sem Link, Bancontact, etc.
const PAYMENT_METHODS = ["card", "mb_way", "klarna", "revolut_pay"];

function sessionUi(embedded: boolean, successUrl: string, cancelUrl: string) {
  return embedded
    ? { ui_mode: "elements", return_url: successUrl, payment_method_types: PAYMENT_METHODS }
    : { success_url: successUrl, cancel_url: cancelUrl, payment_method_types: PAYMENT_METHODS };
}
function sessionReply(embedded: boolean, session: any) {
  return embedded ? { ok: true, clientSecret: session.client_secret } : { ok: true, url: session.url };
}

async function createCheckout(req: any, res: any) {
  const b = await readJsonBody(req);
  if (str(b.website)) return res.status(200).json({ ok: true });

  const name = str(b.name, 120);
  const email = str(b.email, 200).toLowerCase();
  const phone = str(b.phone, 40);
  const editionId = str(b.editionId, 60);
  const quantity = Math.floor(Number(b.quantity) || 0);
  const consent = b.consent === true;
  const lang: Lang = b.lang === "en" ? "en" : "pt";
  const giftCode = cleanGift(b.giftCode);

  const errors: string[] = [];
  if (!editionId) errors.push("data");
  if (!name) errors.push("nome");
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) errors.push("email");
  if (phone.replace(/\D/g, "").length < 9) errors.push("telemóvel");
  if (quantity < 1 || quantity > MAX_QTY) errors.push("lugares");
  if (!consent) errors.push("consentimento");
  if (errors.length) return res.status(400).json({ error: "invalid", fields: errors });

  const { data: ed } = await supabase
    .from("workshop_editions_with_status")
    .select("*")
    .eq("id", editionId)
    .maybeSingle();
  if (!ed || ed.effective_status !== "available") return res.status(409).json({ error: "unavailable" });
  const left = ed.max_attendees - (ed.taken || 0);
  if (quantity > left) return res.status(409).json({ error: "not_enough_spots", left });

  // Preço com convite: código válido no link, ou email da waiting list que já
  // ficou com preço de convite (locked_price). Decidido aqui, nunca no cliente.
  let invitePrice = false;
  let waitlistId: string | null = null;
  const code = cleanCode(b.inviteCode);
  if (code) {
    const { data } = await supabase.from("workshop_waitlist").select("id, email").eq("invite_code", code).maybeSingle();
    if (data) invitePrice = true;
  }
  const { data: wl } = await supabase.from("workshop_waitlist").select("id, locked_price").eq("email", email).maybeSingle();
  if (wl) {
    waitlistId = wl.id;
    if (wl.locked_price) invitePrice = true;
  }
  // Preço a dois: a partir de 2 lugares todos pagam o preço de convite.
  // Não acumula com o convite (é o mesmo preço unitário).
  const groupPrice = quantity >= 2;
  let unit = (invitePrice || groupPrice) && ed.invite_price_cents ? ed.invite_price_cents : ed.price_cents;
  let paidSeats = quantity;

  // Voucher Giftbox: cobre 1 lugar; os restantes pagam o preço de acompanhante.
  if (giftCode) {
    const check = await giftStatus(giftCode);
    if (!check.valid) return res.status(409).json({ error: "gift_invalid", reason: check.reason });
    unit = ed.invite_price_cents ?? ed.price_cents;
    paidSeats = quantity - 1;
    invitePrice = false;
  }
  const amount = unit * paidSeats;

  const expiresAt = new Date(Date.now() + CHECKOUT_TTL_MIN * 60 * 1000 + 30 * 1000);
  const { data: booking, error: insErr } = await supabase
    .from("workshop_bookings")
    .insert({
      edition_id: ed.id, name, email, phone, quantity,
      unit_price_cents: unit, amount_cents: amount, gift_code: giftCode,
      invite_code: invitePrice ? code : null, waitlist_id: waitlistId, lang,
      consent, consent_at: new Date().toISOString(),
      consent_text: lang === "en" ? BOOKING_CONSENT_TEXT_EN : BOOKING_CONSENT_TEXT,
      utm: b.utm && typeof b.utm === "object" ? b.utm : null,
      status: "pending", expires_at: expiresAt.toISOString(),
    })
    .select("id")
    .single();
  if (insErr || !booking) {
    console.error("[workshop-checkout] insert failed:", insErr);
    return res.status(500).json({ error: "save_failed" });
  }

  // Voucher que cobre tudo (1 lugar): não passa pela Stripe.
  if (giftCode && amount === 0) {
    await markBookingPaid({ id: null, metadata: { booking_id: booking.id }, amount_total: 0, payment_intent: null });
    return res.status(200).json({
      ok: true, free: true,
      booking: { status: "paid", firstName: firstName(name), quantity, amount: 0, edition: publicEdition(ed) },
    });
  }

  const origin = siteOrigin(req);
  const when = editionWhen(ed, lang);
  const productName = lang === "en" ? `Barbecue workshop · ${when}` : `Workshop de churrasco · ${when}`;
  try {
    const session = await stripe("POST", "/checkout/sessions", {
      mode: "payment",
      locale: lang === "en" ? "en" : "pt",
      customer_email: email,
      client_reference_id: booking.id,
      expires_at: Math.floor(expiresAt.getTime() / 1000) - 30,
      line_items: [{
        quantity: paidSeats,
        price_data: {
          currency: "eur",
          unit_amount: unit,
          product_data: {
            name: productName,
            description: giftCode
              ? (lang === "en" ? `Giftbox voucher covers 1 spot · ${ed.location}` : `Voucher Giftbox cobre 1 lugar · ${ed.location}`)
              : `${lang === "en" ? ed.title_en : ed.title_pt} · ${ed.location}`,
          },
        },
      }],
      metadata: { booking_id: booking.id, edition_id: ed.id, kind: "workshop" },
      payment_intent_data: {
        description: productName,
        metadata: { booking_id: booking.id, edition_id: ed.id, kind: "workshop" },
      },
      // Embebido: liga a recolha de telemóvel para a página poder pré-preencher o número
      // que já pedimos no formulário (ex.: MB Way). Sem isto a Stripe recusa o valor.
      ...(b.embedded === true ? { phone_number_collection: { enabled: true } } : {}),
      ...sessionUi(
        b.embedded === true,
        `${origin}/workshop?reserva=ok&session_id={CHECKOUT_SESSION_ID}${lang === "en" ? "&lang=en" : ""}`,
        `${origin}/workshop?reserva=cancelada${lang === "en" ? "&lang=en" : ""}#datas`,
      ),
    });
    await supabase.from("workshop_bookings").update({ stripe_session_id: session.id }).eq("id", booking.id);
    return res.status(200).json(sessionReply(b.embedded === true, session));
  } catch (e: any) {
    console.error("[workshop-checkout] stripe failed:", e?.message || e);
    await supabase.from("workshop_bookings").update({ status: "cancelled" }).eq("id", booking.id);
    return res.status(502).json({ error: "payment_unavailable" });
  }
}

function bookingConfirmationEmail(bk: any, ed: any) {
  const lang: Lang = bk.lang === "en" ? "en" : "pt";
  const fn = escapeHtml(firstName(bk.name));
  const when = escapeHtml(editionWhen(ed, lang));
  const total = (bk.amount_cents / 100).toFixed(2).replace(".", lang === "en" ? "." : ",");
  if (lang === "en") {
    return layout(
      "Your spot is booked",
      `<p>${fn}, payment received. You're in.</p>
       <div class="box">
         <p><strong>${when}</strong></p>
         <p>${escapeHtml(ed.title_en)}</p>
         <p>${escapeHtml(ed.location)}. We'll send the exact address a few days before.</p>
         <p style="margin:0">${bk.quantity} ${bk.quantity === 1 ? "spot" : "spots"} · €${total}${bk.gift_code ? " · 1 spot with Giftbox" : ""}</p>
       </div>
       <p>Just bring your appetite. If you can't make it, your spot can be transferred to someone else or to another date: reply to this email.</p>
       <p>See you at the embers,<br><strong>LisbonBBQ team</strong></p>`,
      "en"
    );
  }
  return layout(
    "Lugar reservado",
    `<p>${fn}, recebemos o pagamento. Estás dentro.</p>
     <div class="box">
       <p><strong>${when}</strong></p>
       <p>${escapeHtml(ed.title_pt)}</p>
       <p>${escapeHtml(ed.location)}. Enviamos a morada exata uns dias antes.</p>
       <p style="margin:0">${bk.quantity} ${bk.quantity === 1 ? "lugar" : "lugares"} · ${total}€${bk.gift_code ? " · 1 lugar com Giftbox" : ""}</p>
     </div>
     <p>Só trazes a fome. Se não puderes vir, o teu lugar é transferível para outra pessoa ou para outra data: basta responderes a este email.</p>
     <p>Até à brasa,<br><strong>Equipa LisbonBBQ</strong></p>`
  );
}

async function markBookingPaid(session: any) {
  const bookingId = session.metadata?.booking_id || session.client_reference_id;
  if (!bookingId) return;
  const { data: bk } = await supabase.from("workshop_bookings").select("*").eq("id", bookingId).maybeSingle();
  if (!bk) return console.error("[workshop-webhook] booking not found:", bookingId);

  if (bk.status !== "paid") {
    await supabase.from("workshop_bookings").update({
      status: "paid",
      paid_at: new Date().toISOString(),
      stripe_session_id: session.id,
      stripe_payment_intent_id: typeof session.payment_intent === "string" ? session.payment_intent : null,
      amount_cents: session.amount_total ?? bk.amount_cents,
    }).eq("id", bk.id);
    if (bk.waitlist_id) await supabase.from("workshop_waitlist").update({ status: "booked" }).eq("id", bk.waitlist_id);
    if (bk.gift_code) {
      await supabase.from("workshop_gift_vouchers")
        .update({ status: "redeemed", redeemed_at: new Date().toISOString(), redeemed_booking_id: bk.id })
        .eq("code", bk.gift_code).eq("status", "paid");
    }
  }
  if (bk.confirmation_sent_at) return; // a Stripe pode repetir o evento

  const { data: ed } = await supabase.from("workshop_editions_with_status").select("*").eq("id", bk.edition_id).maybeSingle();
  if (!ed) return;
  try {
    const { error: sendError } = await resend.emails.send({
      from: FROM, to: bk.email, replyTo: REPLY_TO,
      subject: bk.lang === "en" ? `Booked: barbecue workshop, ${editionWhen(ed, "en")}` : `Reservado: workshop de churrasco, ${editionWhen(ed, "pt")}`,
      html: bookingConfirmationEmail({ ...bk, amount_cents: session.amount_total ?? bk.amount_cents }, ed),
    });
    if (sendError) throw sendError;
    await supabase.from("workshop_bookings").update({ confirmation_sent_at: new Date().toISOString() }).eq("id", bk.id);
  } catch (e) {
    console.error("[workshop-webhook] confirmation email failed:", e);
  }
  try {
    await resend.emails.send({
      from: FROM, to: NOTIFY_EMAIL,
      subject: `💶 Workshop pago: ${bk.name} · ${bk.quantity}× · ${ed.date} (${(ed.taken || 0)}/${ed.max_attendees})`,
      html: `<table style="font-family:Arial,sans-serif;font-size:14px">${([
        ["Data", editionWhen(ed, "pt")], ["Nome", bk.name], ["Email", bk.email], ["Telemóvel", bk.phone],
        ["Lugares", String(bk.quantity)], ["Total", `${((session.amount_total ?? bk.amount_cents) / 100).toFixed(2)}€`],
        ["Convite", bk.invite_code || (bk.unit_price_cents < ed.price_cents ? "preço de convite / acompanhante" : "—")],
        ["Giftbox", bk.gift_code ? fmtGift(bk.gift_code) : "—"],
        ["Ocupação", `${ed.taken || 0}/${ed.max_attendees}`], ["Sessão Stripe", session.id],
      ] as [string, string][]).map(([k, v]) => `<tr><td style="padding:6px 12px;font-weight:bold;color:#555">${k}</td><td style="padding:6px 12px">${escapeHtml(v)}</td></tr>`).join("")}</table>`,
    });
  } catch (e) {
    console.error("[workshop-webhook] internal email failed:", e);
  }
}

// ── Giftbox ──
// Voucher digital de 1 lugar no workshop, válido 12 meses. Resgate: código no checkout
// do workshop (createCheckout); lugares extra pagam o preço de acompanhante.
const GIFT_PRICE_CENTS = 11000;
const GIFT_VALID_MONTHS = 12;
const GIFT_CONSENT_TEXT =
  "Autorizo a Lisbon BBQ a guardar estes dados para processar a compra da Giftbox e enviar o voucher, de acordo com o RGPD. Posso pedir para os apagar a qualquer momento em pitmasters@lisbonbbq.pt.";
const GIFT_CONSENT_TEXT_EN =
  "I authorise Lisbon BBQ to store this data to process the Giftbox purchase and send the voucher, in accordance with the GDPR. I can ask for it to be deleted at any time at pitmasters@lisbonbbq.pt.";

function newGiftCode() {
  let c = "";
  for (let i = 0; i < 8; i++) c += CODE_ALPHABET[randomInt(CODE_ALPHABET.length)];
  return c;
}
function cleanGift(raw: unknown) {
  const c = String(raw || "").toUpperCase().replace(/[^A-Z0-9]/g, "");
  return c.length === 8 ? c : null;
}
const fmtGift = (c: string) => `${c.slice(0, 4)}-${c.slice(4)}`;
const lisbonToday = () => new Date().toLocaleDateString("en-CA", { timeZone: "Europe/Lisbon" });

async function giftStatus(code: string): Promise<{ valid: boolean; reason?: string; validUntil?: string }> {
  const { data: g } = await supabase.from("workshop_gift_vouchers").select("status, valid_until").eq("code", code).maybeSingle();
  if (!g) return { valid: false, reason: "not_found" };
  if (g.status === "redeemed") return { valid: false, reason: "redeemed" };
  if (g.status !== "paid") return { valid: false, reason: "not_paid" };
  if (g.valid_until && g.valid_until < lisbonToday()) return { valid: false, reason: "expired" };
  // Reserva com este voucher à espera de pagamento: fica preso até expirar.
  const { data: pend } = await supabase.from("workshop_bookings").select("id")
    .eq("gift_code", code).eq("status", "pending").gt("expires_at", new Date().toISOString()).limit(1);
  if (pend && pend.length) return { valid: false, reason: "in_use" };
  return { valid: true, validUntil: g.valid_until };
}

async function checkGift(req: any, res: any) {
  const code = cleanGift(req.query?.code);
  res.setHeader("Cache-Control", "no-store");
  if (!code) return res.status(200).json({ valid: false, reason: "not_found" });
  return res.status(200).json(await giftStatus(code));
}

async function createGiftCheckout(req: any, res: any) {
  const b = await readJsonBody(req);
  if (str(b.website)) return res.status(200).json({ ok: true });

  const buyerName = str(b.buyerName, 120);
  const buyerEmail = str(b.buyerEmail, 200).toLowerCase();
  const recipientName = str(b.recipientName, 80);
  const message = str(b.message, 300);
  const consent = b.consent === true;
  const lang: Lang = b.lang === "en" ? "en" : "pt";

  const errors: string[] = [];
  if (!buyerName) errors.push("nome");
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(buyerEmail)) errors.push("email");
  if (!consent) errors.push("consentimento");
  if (errors.length) return res.status(400).json({ error: "invalid", fields: errors });

  const amount = GIFT_PRICE_CENTS;
  const expiresAt = new Date(Date.now() + CHECKOUT_TTL_MIN * 60 * 1000 + 30 * 1000);
  let gift: any = null;
  for (let attempt = 0; attempt < 5 && !gift; attempt++) {
    const { data, error } = await supabase.from("workshop_gift_vouchers").insert({
      code: newGiftCode(), buyer_name: buyerName, buyer_email: buyerEmail,
      recipient_name: recipientName || null, message: message || null, amount_cents: amount, lang,
      consent, consent_at: new Date().toISOString(), consent_text: lang === "en" ? GIFT_CONSENT_TEXT_EN : GIFT_CONSENT_TEXT,
      utm: b.utm && typeof b.utm === "object" ? b.utm : null,
      status: "pending", expires_at: expiresAt.toISOString(),
    }).select("id").single();
    if (data) gift = data;
    else if (error && error.code !== "23505") {
      console.error("[workshop-gift] insert failed:", error);
      return res.status(500).json({ error: "save_failed" });
    }
  }
  if (!gift) return res.status(500).json({ error: "save_failed" });

  const origin = siteOrigin(req);
  const en = lang === "en";
  const line_items = [{
    quantity: 1,
    price_data: {
      currency: "eur", unit_amount: GIFT_PRICE_CENTS,
      product_data: {
        name: en ? "Giftbox · Barbecue workshop" : "Giftbox · Workshop de churrasco",
        description: en ? "Voucher for 1 spot, valid for 12 months. Includes the meal and an apron." : "Voucher de 1 lugar, válido 12 meses. Inclui a refeição e o avental.",
      },
    },
  }];
  try {
    const session = await stripe("POST", "/checkout/sessions", {
      mode: "payment",
      locale: en ? "en" : "pt",
      customer_email: buyerEmail,
      client_reference_id: gift.id,
      expires_at: Math.floor(expiresAt.getTime() / 1000) - 30,
      line_items,
      metadata: { gift_id: gift.id, kind: "workshop" },
      payment_intent_data: { description: "Giftbox workshop", metadata: { gift_id: gift.id, kind: "workshop" } },
      ...sessionUi(
        b.embedded === true,
        `${origin}/workshop?giftbox=ok&session_id={CHECKOUT_SESSION_ID}${en ? "&lang=en" : ""}`,
        `${origin}/workshop?giftbox=cancelada${en ? "&lang=en" : ""}#datas`,
      ),
    });
    await supabase.from("workshop_gift_vouchers").update({ stripe_session_id: session.id }).eq("id", gift.id);
    return res.status(200).json(sessionReply(b.embedded === true, session));
  } catch (e: any) {
    console.error("[workshop-gift] stripe failed:", e?.message || e);
    return res.status(502).json({ error: "payment_unavailable" });
  }
}

function giftEmail(g: any) {
  const en = g.lang === "en";
  const fn = escapeHtml(firstName(g.buyer_name));
  const code = fmtGift(g.code);
  const link = `${SITE}/workshop?gift=${g.code}${en ? "&lang=en" : ""}`;
  const until = g.valid_until ? new Date(`${g.valid_until}T12:00:00Z`) : null;
  const untilTxt = until ? (en ? `${until.getUTCDate()} ${MONTHS_EN[until.getUTCMonth()]} ${until.getUTCFullYear()}` : `${until.getUTCDate()} de ${MONTHS_PT[until.getUTCMonth()]} de ${until.getUTCFullYear()}`) : "";
  const forWho = g.recipient_name ? escapeHtml(g.recipient_name) : "";
  if (en) {
    return layout(
      "Your Giftbox is ready",
      `<p>${fn}, payment received. Here's the voucher${forWho ? ` for <strong>${forWho}</strong>` : ""}.</p>
       <div class="box">
         <p style="font-size:24px;letter-spacing:2px"><strong>${code}</strong></p>
         <p>1 spot at the Lisbon BBQ barbecue workshop: 3 hours in Lisbon, the meal at the long table and an apron to take home.</p>
         <p style="margin:0">Valid until ${untilTxt}.</p>
       </div>
       <p><strong>How to use it:</strong> open <a href="${link}">${link}</a>, pick a date and the code is applied at checkout. Bringing someone? Each extra spot is €90.</p>
       <p>You can forward this email or print it and give it as a gift.</p>
       <p>See you at the embers,<br><strong>LisbonBBQ team</strong></p>`,
      "en"
    );
  }
  return layout(
    "A tua Giftbox está pronta",
    `<p>${fn}, recebemos o pagamento. Aqui está o voucher${forWho ? ` para <strong>${forWho}</strong>` : ""}.</p>
     <div class="box">
       <p style="font-size:24px;letter-spacing:2px"><strong>${code}</strong></p>
       <p>1 lugar no workshop de churrasco da Lisbon BBQ: 3 horas em Lisboa, a refeição à mesa longa e um avental para levar para casa.</p>
       <p style="margin:0">Válido até ${untilTxt}.</p>
     </div>
     <p><strong>Como usar:</strong> abre <a href="${link}">${link}</a>, escolhe a data e o código fica aplicado no pagamento. Quer levar alguém? Cada lugar extra fica a 90€.</p>
     <p>Podes reencaminhar este email ou imprimi-lo e oferecê-lo.</p>
     <p>Até à brasa,<br><strong>Equipa LisbonBBQ</strong></p>`
  );
}

async function markGiftPaid(session: any) {
  const giftId = session.metadata?.gift_id || session.client_reference_id;
  if (!giftId) return;
  const { data: g } = await supabase.from("workshop_gift_vouchers").select("*").eq("id", giftId).maybeSingle();
  if (!g) return console.error("[workshop-gift] voucher not found:", giftId);

  let row = g;
  if (g.status === "pending" || g.status === "expired") {
    const until = new Date();
    until.setMonth(until.getMonth() + GIFT_VALID_MONTHS);
    const update = {
      status: "paid",
      paid_at: new Date().toISOString(),
      valid_until: until.toLocaleDateString("en-CA", { timeZone: "Europe/Lisbon" }),
      stripe_session_id: session.id,
      stripe_payment_intent_id: typeof session.payment_intent === "string" ? session.payment_intent : null,
      amount_cents: session.amount_total ?? g.amount_cents,
    };
    await supabase.from("workshop_gift_vouchers").update(update).eq("id", g.id);
    row = { ...g, ...update };
  }
  if (row.email_sent_at) return; // a Stripe pode repetir o evento

  try {
    const { error: sendError } = await resend.emails.send({
      from: FROM, to: row.buyer_email, replyTo: REPLY_TO,
      subject: row.lang === "en" ? "Your Lisbon BBQ Giftbox" : "A tua Giftbox Lisbon BBQ",
      html: giftEmail(row),
    });
    if (sendError) throw sendError;
    await supabase.from("workshop_gift_vouchers").update({ email_sent_at: new Date().toISOString() }).eq("id", row.id);
  } catch (e) {
    console.error("[workshop-gift] voucher email failed:", e);
  }
  try {
    await resend.emails.send({
      from: FROM, to: NOTIFY_EMAIL,
      subject: `🎁 Giftbox paga: ${row.buyer_name}`,
      html: `<table style="font-family:Arial,sans-serif;font-size:14px">${([
        ["Código", fmtGift(row.code)], ["Comprador", row.buyer_name], ["Email", row.buyer_email],
        ["Para", row.recipient_name || "—"], ["Mensagem", row.message || "—"],
        ["Total", `${(row.amount_cents / 100).toFixed(2)}€`], ["Válido até", row.valid_until || "—"],
        ["Sessão Stripe", session.id],
      ] as [string, string][]).map(([k, v]) => `<tr><td style="padding:6px 12px;font-weight:bold;color:#555">${k}</td><td style="padding:6px 12px">${escapeHtml(v)}</td></tr>`).join("")}</table>`,
    });
  } catch (e) {
    console.error("[workshop-gift] internal email failed:", e);
  }
}

// Regresso do Checkout da Giftbox: estado sem expor o código (vai por email).
async function getGift(req: any, res: any) {
  const sessionId = str(req.query?.session_id, 200);
  if (!/^cs_(test|live)_[A-Za-z0-9]+$/.test(sessionId)) return res.status(400).json({ error: "invalid" });
  const { data: g } = await supabase.from("workshop_gift_vouchers").select("status, buyer_name, valid_until").eq("stripe_session_id", sessionId).maybeSingle();
  if (!g) return res.status(404).json({ error: "not_found" });
  let status = g.status;
  if (status === "pending") {
    try {
      const s = await stripe("GET", `/checkout/sessions/${sessionId}`);
      if (s.payment_status === "paid") { await markGiftPaid(s); status = "paid"; }
    } catch (e) {
      console.error("[workshop-gift] stripe lookup failed:", e);
    }
  }
  res.setHeader("Cache-Control", "no-store");
  return res.status(200).json({ status, firstName: firstName(g.buyer_name) });
}

async function stripeWebhook(req: any, res: any) {
  const secret = process.env.STRIPE_WEBHOOK_SECRET;
  const sig = String(req.headers?.["stripe-signature"] || "");
  const raw = await readRawBody(req);
  if (!secret || !sig || !verifyStripeSignature(raw, sig, secret)) {
    return res.status(400).json({ error: "bad_signature" });
  }
  let event: any;
  try { event = JSON.parse(raw); } catch { return res.status(400).json({ error: "bad_json" }); }
  const obj = event.data?.object || {};
  // A conta Stripe é só do LisbonBBQ, mas ignoramos o que não for workshop.
  const isWorkshop = (o: any) => o?.metadata?.kind === "workshop";

  try {
    switch (event.type) {
      case "checkout.session.completed":
      case "checkout.session.async_payment_succeeded":
        if (isWorkshop(obj) && obj.payment_status === "paid") {
          if (obj.metadata?.gift_id) await markGiftPaid(obj);
          else await markBookingPaid(obj);
        }
        break;
      case "checkout.session.async_payment_failed":
      case "checkout.session.expired": {
        if (!isWorkshop(obj)) break;
        if (obj.metadata?.gift_id) {
          await supabase.from("workshop_gift_vouchers").update({ status: event.type.endsWith("expired") ? "expired" : "cancelled" }).eq("id", obj.metadata.gift_id).eq("status", "pending");
          break;
        }
        const id = obj.metadata?.booking_id || obj.client_reference_id;
        if (id) await supabase.from("workshop_bookings").update({ status: event.type.endsWith("expired") ? "expired" : "cancelled" }).eq("id", id).eq("status", "pending");
        break;
      }
      case "charge.refunded": {
        const pi = typeof obj.payment_intent === "string" ? obj.payment_intent : null;
        if (pi && obj.refunded) {
          await supabase.from("workshop_bookings").update({ status: "refunded" }).eq("stripe_payment_intent_id", pi);
          await supabase.from("workshop_gift_vouchers").update({ status: "refunded" }).eq("stripe_payment_intent_id", pi);
        }
        break;
      }
      default:
        break;
    }
  } catch (e: any) {
    console.error("[workshop-webhook] handler error:", e);
    return res.status(500).json({ error: "handler_failed" });
  }
  return res.status(200).json({ received: true });
}

// Página de regresso do Checkout: confirma o estado sem expor dados pessoais.
async function getBooking(req: any, res: any) {
  const sessionId = str(req.query?.session_id, 200);
  if (!/^cs_(test|live)_[A-Za-z0-9]+$/.test(sessionId)) return res.status(400).json({ error: "invalid" });
  const { data: bk } = await supabase
    .from("workshop_bookings")
    .select("id, name, quantity, amount_cents, status, edition_id")
    .eq("stripe_session_id", sessionId)
    .maybeSingle();
  if (!bk) return res.status(404).json({ error: "not_found" });

  // O webhook pode chegar depois do regresso: confirma diretamente na Stripe.
  if (bk.status === "pending") {
    try {
      const s = await stripe("GET", `/checkout/sessions/${sessionId}`);
      if (s.payment_status === "paid") {
        await markBookingPaid(s);
        bk.status = "paid";
      }
    } catch (e) {
      console.error("[workshop-booking] stripe lookup failed:", e);
    }
  }
  const { data: ed } = await supabase.from("workshop_editions").select("*").eq("id", bk.edition_id).maybeSingle();
  res.setHeader("Cache-Control", "no-store");
  return res.status(200).json({
    status: bk.status,
    firstName: firstName(bk.name),
    quantity: bk.quantity,
    amount: bk.amount_cents / 100,
    edition: ed ? publicEdition({ ...ed, effective_status: ed.status }) : null,
  });
}

export default async function handler(req: any, res: any) {
  const task = req.query?.task;
  if (req.method === "POST" && task === "stripe-webhook") return stripeWebhook(req, res);
  if (req.method === "POST" && task === "checkout") return createCheckout(req, res);
  if (req.method === "GET" && task === "editions") return getEditions(res);
  if (req.method === "GET" && task === "booking") return getBooking(req, res);
  if (req.method === "POST" && task === "gift-checkout") return createGiftCheckout(req, res);
  if (req.method === "GET" && task === "gift") return getGift(req, res);
  if (req.method === "GET" && task === "gift-check") return checkGift(req, res);

  // Cron diário (vercel.json → crons): lembrete aos 3 dias. Vive neste ficheiro
  // porque o plano Hobby da Vercel limita o deploy a 12 funções em api/.
  if (req.method === "GET" && req.query?.task === "reminders") return runReminders(req, res);

  if (req.method === "GET") {
    const code = cleanCode(req.query?.c);
    if (!code) return res.status(200).json({ valid: false });
    const { data } = await supabase
      .from("workshop_waitlist")
      .select("name, price_variant")
      .eq("invite_code", code)
      .maybeSingle();
    if (!data) return res.status(200).json({ valid: false });
    const p = PRICES[data.price_variant] || PRICES.a;
    return res.status(200).json({ valid: true, firstName: firstName(data.name), invitePrice: p.invite, publicPrice: p.public });
  }

  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  const b = await readJsonBody(req);

  // Honeypot: campo escondido que só bots preenchem.
  if (str(b.website)) return res.status(200).json({ ok: true });

  const name = str(b.name, 120);
  const email = str(b.email, 200).toLowerCase();
  const phone = str(b.phone, 40);
  const preferred_slot = str(b.preferredSlot, 60);
  const experience = str(b.experience, 60);
  const motive = str(b.motive, 60);
  const heard_from = str(b.heardFrom, 60);
  const consent = b.consent === true;
  const lang: Lang = b.lang === "en" ? "en" : "pt";

  // quick: registo curto a partir do bloco de compra ("Nenhuma destas datas
  // dá?"): só nome, email, horário e consentimento.
  const quick = b.quick === true;
  const errors: string[] = [];
  if (!name) errors.push("nome");
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) errors.push("email");
  if (!quick && phone.replace(/\D/g, "").length < 9) errors.push("telemóvel");
  if (!preferred_slot) errors.push("horário");
  if (!quick && !experience) errors.push("experiência");
  if (!quick && !motive) errors.push("motivo");
  if (!consent) errors.push("consentimento");
  if (errors.length) return res.status(400).json({ error: "invalid", fields: errors });

  const variant = PRICES[b.priceVariant] ? String(b.priceVariant) : "a";
  const prices = PRICES[variant];

  // Convite: só conta se o código existir.
  let inviter: any = null;
  const code = cleanCode(b.inviteCode);
  if (code) {
    const { data } = await supabase
      .from("workshop_waitlist")
      .select("id, name, email, invite_code, price_variant, locked_price, public_price, invite_price, lang")
      .eq("invite_code", code)
      .maybeSingle();
    if (data && data.email.toLowerCase() !== email) inviter = data;
  }
  // Quem entra por convite fica com os preços da variante de quem convidou.
  const effective = inviter ? PRICES[inviter.price_variant] || prices : prices;

  // Já inscrito? Não duplica nem reenvia nada.
  const { data: existing } = await supabase
    .from("workshop_waitlist")
    .select("id")
    .eq("email", email)
    .maybeSingle();
  if (existing) return res.status(200).json({ ok: true, duplicate: true, firstName: firstName(name) });

  const utm = b.utm && typeof b.utm === "object" ? b.utm : null;

  let row: any = null;
  for (let attempt = 0; attempt < 5 && !row; attempt++) {
    const { data, error } = await supabase
      .from("workshop_waitlist")
      .insert({
        name, email, phone, preferred_slot, experience, motive, heard_from,
        consent, consent_at: new Date().toISOString(), consent_text: lang === "en" ? CONSENT_TEXT_EN : CONSENT_TEXT,
        lang,
        invite_code: newCode(),
        invited_by: inviter?.id ?? null,
        price_variant: inviter ? inviter.price_variant : variant,
        public_price: effective.public,
        invite_price: effective.invite,
        locked_price: inviter ? effective.invite : null,
        utm,
        landing_url: str(b.landingUrl, 500) || null,
        referrer: str(b.referrer, 500) || null,
      })
      .select("*")
      .single();
    if (data) row = data;
    else if (error && error.code !== "23505") {
      console.error("[workshop] insert error:", error);
      return res.status(500).json({ error: "save_failed" });
    } else if (error && /email/.test(error.message || "")) {
      return res.status(200).json({ ok: true, duplicate: true, firstName: firstName(name) });
    }
  }
  if (!row) return res.status(500).json({ error: "save_failed" });

  if (inviter && !inviter.locked_price) {
    await supabase.from("workshop_waitlist").update({ locked_price: effective.invite }).eq("id", inviter.id);
  }

  // Emails: uma falha aqui não desfaz a inscrição.
  try {
    // O SDK do Resend devolve { error } em vez de lançar exceção.
    const { error: sendError } = await resend.emails.send({
      from: FROM, to: email, replyTo: REPLY_TO,
      subject: lang === "en"
        ? (inviter ? `${firstName(inviter.name)} saved you a spot at the grill` : "You're on the list. Save a spot for a mate")
        : (inviter ? `${firstName(inviter.name)} guardou-te um lugar na grelha` : "Estás na lista. Guarda um lugar para um camarada"),
      html: welcomeEmail(row, effective, inviter ? firstName(inviter.name) : undefined, lang),
    });
    if (sendError) throw sendError;
    await supabase.from("workshop_waitlist").update({ welcome_sent_at: new Date().toISOString() }).eq("id", row.id);
  } catch (e) {
    console.error("[workshop] welcome email failed:", e);
  }
  if (inviter) {
    try {
      await resend.emails.send({
        from: FROM, to: inviter.email, replyTo: REPLY_TO,
        subject: inviter.lang === "en" ? `${firstName(row.name)} joined with your invite` : `${firstName(row.name)} entrou com o teu convite`,
        html: inviterJoinedEmail(inviter, row, effective),
      });
    } catch (e) {
      console.error("[workshop] inviter email failed:", e);
    }
  }
  try {
    await resend.emails.send({
      from: FROM, to: NOTIFY_EMAIL,
      subject: `🔥 Waiting list workshop: ${row.name}${inviter ? " (convite)" : ""}`,
      html: internalEmail(row, inviter),
    });
  } catch (e) {
    console.error("[workshop] internal email failed:", e);
  }

  return res.status(200).json({
    ok: true, firstName: firstName(row.name), inviteCode: row.invite_code, invited: !!inviter,
    invitePrice: effective.invite, publicPrice: effective.public,
  });
}
