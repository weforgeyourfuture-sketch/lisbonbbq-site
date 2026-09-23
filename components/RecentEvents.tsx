import React, { useEffect, useState } from 'react';
import { Quote, Users, MapPin, Instagram, ArrowUpRight } from 'lucide-react';
import { fetchShowcaseEvents, getTestimonials, ShowcaseEvent, Testimonial } from '../services/publicData';

interface Props {
  lang: 'pt' | 'en';
}

// Só aceitamos imagens alojadas no nosso storage Supabase — nada de hotlinks
// para Instagram ou outros serviços externos.
const STORAGE_PREFIX = 'https://mlqdpjiolbyewcumvajn.supabase.co/storage/v1/object/public/';

function storageImages(images: unknown): string[] {
  if (!Array.isArray(images)) return [];
  return images
    .filter((url): url is string => typeof url === 'string' && url.startsWith(STORAGE_PREFIX))
    .slice(0, 3);
}

// Link "Ver mais": só posts de Instagram (é o que o estilo do botão promete).
function instagramUrl(url: string | null): string | null {
  return url && /^https:\/\/(www\.)?instagram\.com\//.test(url) ? url : null;
}

// Eventos recentes com autorização do cliente (published = true e
// showcase = true), lidos por RLS com a chave pública. Sem eventos ou com
// erro, a secção não renderiza. A data (starts_at) só serve para ordenar —
// não aparece no card.
export const RecentEvents: React.FC<Props> = ({ lang }) => {
  const [events, setEvents] = useState<ShowcaseEvent[]>([]);
  const [quotes, setQuotes] = useState<Record<string, Testimonial>>({});

  useEffect(() => {
    let cancelled = false;
    fetchShowcaseEvents(6)
      .then((rows) => { if (!cancelled) setEvents(rows); })
      .catch(() => { if (!cancelled) setEvents([]); });
    getTestimonials()
      .then((rows) => {
        if (cancelled) return;
        const byEvent: Record<string, Testimonial> = {};
        for (const t of rows) {
          if (t.event_id && !byEvent[t.event_id]) byEvent[t.event_id] = t;
        }
        setQuotes(byEvent);
      })
      .catch(() => {});
    return () => { cancelled = true; };
  }, []);

  if (events.length === 0) return null;

  const pt = lang === 'pt';

  return (
    <section className="py-24 px-4 bg-bbq-cream border-b-4 border-bbq-black">
      <div className="max-w-6xl mx-auto">
        <h2 className="text-5xl md:text-6xl font-black uppercase tracking-tighter leading-none mb-4">
          {pt ? 'Eventos' : 'Latest'} <span className="text-bbq-red">{pt ? 'mais recentes' : 'Events'}</span>
        </h2>
        <div className="h-2 w-24 bg-bbq-red mb-12"></div>

        <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-8">
          {events.map((ev) => {
            const images = storageImages(ev.showcase_images);
            const igUrl = instagramUrl(ev.showcase_url);
            const name = ev.showcase_name || (pt ? 'Evento privado' : 'Private event');
            const quote = quotes[ev.id];
            const altBase = pt
              ? `Churrasco LisbonBBQ para ${name}${ev.venue_name ? ` em ${ev.venue_name}` : ''}`
              : `LisbonBBQ barbecue for ${name}${ev.venue_name ? ` at ${ev.venue_name}` : ''}`;

            return (
              <article key={ev.id} className="bg-white border-4 border-bbq-black shadow-hard flex flex-col">
                {images.length > 0 && (
                  <div className={`grid gap-1 border-b-4 border-bbq-black bg-bbq-black ${images.length > 1 ? 'grid-cols-2' : 'grid-cols-1'}`}>
                    {images.map((src, i) => (
                      <img
                        key={src}
                        src={src}
                        alt={images.length > 1 ? `${altBase} (${pt ? 'foto' : 'photo'} ${i + 1} ${pt ? 'de' : 'of'} ${images.length})` : altBase}
                        loading="lazy"
                        decoding="async"
                        className={`w-full object-cover ${i === 0 && images.length === 3 ? 'col-span-2 h-48' : images.length === 1 ? 'h-56' : 'h-32'}`}
                      />
                    ))}
                  </div>
                )}
                <div className="p-6 flex flex-col flex-1">
                  <h3 className="text-2xl font-black uppercase tracking-tight leading-tight mb-3">{name}</h3>
                  <ul className="space-y-1 text-xs font-black uppercase tracking-widest text-gray-500 mb-4">
                    {ev.venue_name && (
                      <li className="flex items-center gap-2"><MapPin size={14} className="text-bbq-red" /> {ev.venue_name}</li>
                    )}
                    {ev.guest_count != null && (
                      <li className="flex items-center gap-2"><Users size={14} className="text-bbq-red" /> {ev.guest_count} {pt ? 'convidados' : 'guests'}</li>
                    )}
                  </ul>
                  {ev.showcase_blurb && (
                    <p className="font-bold text-gray-700 leading-relaxed">{ev.showcase_blurb}</p>
                  )}
                  {quote && (
                    <figure className="mt-6 pt-4 border-t-2 border-bbq-black">
                      <Quote size={20} className="text-bbq-red mb-2" />
                      <blockquote className="italic font-bold text-sm leading-relaxed">"{quote.quote}"</blockquote>
                      <figcaption className="mt-2 text-xs font-black uppercase tracking-widest text-bbq-red">— {quote.author_name}</figcaption>
                    </figure>
                  )}
                  {igUrl && (
                    <a
                      href={igUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      aria-label={pt ? `Ver mais sobre ${name} no Instagram (abre numa nova tab)` : `See more about ${name} on Instagram (opens in a new tab)`}
                      className="mt-auto pt-6 self-start"
                    >
                      <span className="inline-flex items-center gap-2 px-5 py-2.5 rounded-full text-white text-sm font-black uppercase tracking-widest bg-[linear-gradient(45deg,#F58529,#DD2A7B_50%,#8134AF_75%,#515BD4)] hover:brightness-110 transition-[filter]">
                        <Instagram size={18} />
                        {pt ? 'Ver mais' : 'See more'}
                        <ArrowUpRight size={16} />
                      </span>
                    </a>
                  )}
                </div>
              </article>
            );
          })}
        </div>
      </div>
    </section>
  );
};
