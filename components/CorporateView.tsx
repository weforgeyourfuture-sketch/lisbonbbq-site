
import React, { useState, useEffect, useRef } from 'react';
import { Flame, Check, MessageCircle, Images, X, ChevronLeft, ChevronRight } from 'lucide-react';
import { LOCATIONS, OWN_LOCATION_ID, OWN_LOCATION_NAME } from '../constants';
import { responsiveImage } from '../services/responsiveImage';

interface CorporateViewProps {
  lang: 'pt' | 'en';
  onBack: () => void;
  onSubmit: (data: any) => Promise<boolean>;
  onPartialCapture: (data: { name: string; email: string; phone: string; locationId: string; bbqStyle: string; guests: string; date: string; message: string }) => void;
  isSending: boolean;
}

// Assinatura visual do contexto corporate — desligável.
const SHOW_DOTS = true;

const IMG = 'https://mlqdpjiolbyewcumvajn.supabase.co/storage/v1/object/public/lisbonbbq-media/Fotos';

const scrollToId = (id: string) => {
  const el = document.getElementById(id);
  if (el) window.scrollTo({ top: el.getBoundingClientRect().top + window.scrollY - 72, behavior: 'smooth' });
};

const Dots: React.FC = () => (
  SHOW_DOTS ? (
    <div
      className="absolute inset-0 pointer-events-none"
      style={{ backgroundImage: 'radial-gradient(rgba(26,26,26,0.14) 1.5px, transparent 1.5px)', backgroundSize: '24px 24px' }}
    />
  ) : null
);

const Badge: React.FC<{ variant: 'red' | 'black' | 'yellow'; children: React.ReactNode }> = ({ variant, children }) => {
  const colors = {
    red: 'bg-bbq-red text-white',
    black: 'bg-bbq-black text-bbq-cream',
    yellow: 'bg-bbq-yellow text-bbq-black',
  };
  return (
    <span className={`inline-block border-2 border-bbq-black shadow-hard-sm px-4 py-1.5 font-black uppercase text-xs tracking-widest ${colors[variant]}`}>
      {children}
    </span>
  );
};

const btnBase = 'inline-flex items-center justify-center gap-3 border-4 border-bbq-black shadow-hard px-10 py-5 font-black uppercase text-lg tracking-tight transition-all active:translate-x-[2px] active:translate-y-[2px] active:shadow-none cursor-pointer';

export const CorporateView: React.FC<CorporateViewProps> = ({ lang, onSubmit, onPartialCapture, isSending }) => {
  const [formData, setFormData] = useState({
    name: '',
    email: '',
    phone: '',
    locationId: '',
    bbqStyle: '',
    guests: '',
    date: '',
    message: ''
  });
  const [submitted, setSubmitted] = useState(false);
  const [error, setError] = useState<string | false>(false);
  const partialCapturedRef = useRef(false);
  const formDataRef = useRef(formData);
  formDataRef.current = formData;
  const [gallery, setGallery] = useState<{ name: string; images: string[]; index: number } | null>(null);
  const heroVideoRef = useRef<HTMLVideoElement>(null);

  // Navegação da galeria por teclado (Esc fecha, setas avançam/recuam).
  useEffect(() => {
    if (!gallery) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setGallery(null);
      if (e.key === 'ArrowRight') setGallery(g => g && { ...g, index: (g.index + 1) % g.images.length });
      if (e.key === 'ArrowLeft') setGallery(g => g && { ...g, index: (g.index - 1 + g.images.length) % g.images.length });
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [gallery]);

  // O vídeo do hero só é montado (e portanto só é transferido) em ecrãs a
  // partir de tablet e quando o visitante não pediu menos movimento — em
  // mobile e com prefers-reduced-motion mostra-se só o poster estático, que
  // já está sempre presente por baixo. Evita puxar ~450KB de vídeo onde a
  // maioria do tráfego de Search entra (mobile).
  const [showVideo, setShowVideo] = useState(false);
  useEffect(() => {
    const mqDesktop = window.matchMedia('(min-width: 768px)');
    const mqMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
    const update = () => setShowVideo(mqDesktop.matches && !mqMotion.matches);
    update();
    mqDesktop.addEventListener('change', update);
    mqMotion.addEventListener('change', update);
    return () => {
      mqDesktop.removeEventListener('change', update);
      mqMotion.removeEventListener('change', update);
    };
  }, []);

  // Retoma o loop quando a tab volta a estar visível (o browser pausa
  // vídeos em tabs em segundo plano).
  useEffect(() => {
    if (!showVideo) return;
    const vid = heroVideoRef.current;
    if (!vid) return;
    const resume = () => {
      if (document.visibilityState === 'visible') vid.play().catch(() => {});
    };
    document.addEventListener('visibilitychange', resume);
    resume();
    return () => document.removeEventListener('visibilitychange', resume);
  }, [showVideo]);

  const handleFormChange = (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) => {
    setFormData(prev => ({ ...prev, [e.target.name]: e.target.value }));
  };

  // Só algarismos — nunca deixa entrar "e", "-", "." ou outro lixo do teclado de número.
  const handleGuestsChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const digitsOnly = e.target.value.replace(/\D/g, '');
    setFormData(prev => ({ ...prev, guests: digitsOnly }));
  };

  // Lead capture parcial: se a pessoa sair da página (mudar de separador,
  // fechar) sem submeter, grava o que já tinha preenchido — não só nome e
  // contacto, mas também local, convidados, data, churrasco e mensagem, tal
  // como estavam no momento em que saiu.
  useEffect(() => {
    const trySendPartial = () => {
      if (partialCapturedRef.current) return;
      const d = formDataRef.current;
      if (d.name.trim() && d.email.trim() && d.phone.trim()) {
        partialCapturedRef.current = true;
        onPartialCapture({ ...d });
      }
    };
    const onVisibilityChange = () => {
      if (document.visibilityState === 'hidden') trySendPartial();
    };
    document.addEventListener('visibilitychange', onVisibilityChange);
    window.addEventListener('pagehide', trySendPartial);
    return () => {
      document.removeEventListener('visibilitychange', onVisibilityChange);
      window.removeEventListener('pagehide', trySendPartial);
    };
  }, [onPartialCapture]);

  const showDetails = formData.phone.trim().length > 0;

  const internalSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (parseInt(formData.guests, 10) < 20) {
      setError(pt ? 'Mínimo de 20 pessoas para eventos corporativos.' : 'Minimum of 20 people for corporate events.');
      return;
    }
    setError(false);
    const success = await onSubmit(formData);
    if (success) {
      setSubmitted(true);
      setFormData({ name: '', email: '', phone: '', locationId: '', bbqStyle: '', guests: '', date: '', message: '' });
      partialCapturedRef.current = false;
    } else {
      setError(pt ? 'Erro ao enviar. Tenta novamente ou WhatsApp.' : 'Error sending. Try again or WhatsApp.');
    }
  };

  // SEO & GEO Optimization: JSON-LD Structured Data
  useEffect(() => {
    const script = document.createElement('script');
    script.type = 'application/ld+json';
    const schema = {
      "@context": "https://schema.org",
      "@type": "Service",
      "name": "LisbonBBQ Eventos Corporativos & Team Building",
      "serviceType": "Eventos corporativos, team building e festas de empresa",
      "provider": {
        "@type": "Organization",
        "name": "Lisbon BBQ",
        "url": window.location.origin
      },
      "areaServed": {
        "@type": "City",
        "name": "Lisbon"
      },
      "description": "Churrascos privados chave-na-mão para empresas em Lisboa, para equipas de 20 a 300 pessoas, desde 35€/pessoa."
    };
    script.innerHTML = JSON.stringify(schema);
    document.head.appendChild(script);
    return () => {
      document.head.removeChild(script);
    };
  }, []);

  const pt = lang === 'pt';

  const facts = pt
    ? ['Desde 35€/pessoa', 'Equipas de 20 a 300', '4+ espaços em Lisboa', 'Logística 100% incluída']
    : ['From €35/person', 'Teams of 20 to 300', '4+ venues in Lisbon', 'Logistics 100% included'];

  const conceptCards = [
    {
      img: `${IMG}/Churrasco%20People.png`,
      alt: pt ? 'Equipa à volta do grelhador' : 'Team around the grill',
      title: pt ? 'Conversa a sério' : 'Real conversation',
      text: pt
        ? 'Comida de qualidade, conversa com significado e presença humana genuína, em vez de música alta e espaços lotados'
        : 'Quality food, meaningful conversation and genuine human presence, instead of loud music and crowded venues'
    },
    {
      img: `${IMG}/grill.webp`,
      alt: pt ? 'Grelhador em ação' : 'Grill in action',
      title: pt ? 'O fogo faz o trabalho' : 'The fire does the work',
      text: pt
        ? 'Grelhar juntos é o team building mais antigo do mundo. Não é preciso guião, dinâmicas nem quebra-gelos forçados.'
        : "Grilling together is the world's oldest team building. No script, no dynamics, no forced icebreakers."
    },
    {
      img: `${IMG}/Carrinho%20de%20mao%20gelo.webp`,
      alt: pt ? 'Bebidas frescas no gelo' : 'Cold drinks on ice',
      title: pt ? 'Zero trabalho para ti' : 'Zero work for you',
      text: pt
        ? 'Espaço, carvão, comida, bebida fresca e limpeza — tudo tratado. Quem organiza também merece aproveitar o evento.'
        : 'Venue, charcoal, food, cold drinks and cleanup — all handled. Whoever organizes deserves to enjoy the event too.'
    }
  ];

  const steps = [
    {
      title: pt ? 'Escolhe data e espaço' : 'Pick a date and venue',
      text: pt
        ? 'Diz-nos quantos são e quando. Ajudamos a escolher o espaço certo para a tua equipa.'
        : 'Tell us how many you are and when. We help you pick the right venue for your team.'
    },
    {
      title: pt ? 'Nós montamos tudo' : 'We set everything up',
      text: pt
        ? 'Grelhador aceso, comida pronta a grelhar, bebidas no gelo, mesas postas. Antes de vocês chegarem.'
        : 'Grill lit, food ready to grill, drinks on ice, tables set. Before you arrive.'
    },
    {
      title: pt ? 'A equipa aparece' : 'The team shows up',
      text: pt
        ? 'E fica. Sem louça para lavar, sem emails de logística no dia seguinte.'
        : 'And stays. No dishes to wash, no logistics emails the next day.'
    }
  ];

  const venueImages = (id: string) => LOCATIONS.find(l => l.id === id)?.images ?? [];

  const venues = [
    {
      images: venueImages('alcantara_rooftop'),
      cover: 0,
      tag: pt ? 'Lisboa · Alcântara' : 'Lisbon · Alcântara',
      name: 'Alcântara',
      text: pt
        ? 'Rooftop com Lisboa e o rio aos pés. O cenário certo para summer parties em grande.'
        : 'A rooftop with Lisbon and the river at your feet. The right stage for summer parties at scale.',
      capacity: pt ? '80–300 pessoas' : '80–300 people'
    },
    {
      images: venueImages('musa_marvila'),
      cover: 1,
      tag: pt ? 'Lisboa · Marvila' : 'Lisbon · Marvila',
      name: 'Marvila',
      text: pt
        ? 'Ambiente industrial e criativo na zona mais cool da cidade, com cerveja artesanal ao lado.'
        : "Industrial, creative vibe in the city's coolest quarter, with craft beer next door.",
      capacity: pt ? '30–80 pessoas' : '30–80 people'
    },
    {
      images: venueImages('tapadinha_lisboa'),
      cover: 0,
      tag: pt ? 'Lisboa · Tapadinha' : 'Lisbon · Tapadinha',
      name: 'Tapadinha',
      text: pt
        ? 'Quintal amplo à sombra das árvores, feito para equipas grandes. O clássico dos nossos churrascos de empresa.'
        : 'A big backyard in the shade of the trees, built for large teams. The classic of our company barbecues.',
      capacity: pt ? '50+ pessoas' : '50+ people'
    },
    {
      images: venueImages('expo_rooftop'),
      cover: 0,
      tag: pt ? 'Parque das Nações' : 'Parque das Nações',
      name: 'Expo',
      text: pt
        ? 'Prático para equipas na zona oriental. Chega-se a pé do escritório, sai-se com cheiro a fumo e boa disposição.'
        : 'Convenient for teams on the east side. Walk over from the office, leave smelling of smoke and in high spirits.',
      capacity: pt ? '30–500 pessoas' : '30–500 people'
    }
  ];

  // Carnide: a última foto do LOCATIONS é a que abre a box/galeria.
  const carnideImages = venueImages('carnide_local');
  const miniVenues = [
    { images: [...carnideImages.slice(-1), ...carnideImages.slice(0, -1)], cover: 0, name: 'Carnide' },
    { images: venueImages('benfica'), cover: 2, name: 'Benfica' },
    { images: venueImages('alvito'), cover: 0, name: 'Alvito' },
    { images: venueImages('restelo_urban'), cover: 1, name: 'Restelo' }
  ];

  const included = pt
    ? [
        { strong: 'Espaço reservado', text: ' — só para a vossa equipa, sem estranhos na festa.' },
        { strong: 'Grelhador + carvão', text: ' — o fogo está pronto quando chegam.' },
        { strong: 'Comida e bebida', text: ' — carnes, acompanhamentos e bebidas frescas no gelo.' },
        { strong: 'Utensílios e descartáveis', text: ' — ninguém traz nada de casa.' },
        { strong: 'Setup e limpeza', text: ' — chegam a evento montado, saem sem olhar para trás.' }
      ]
    : [
        { strong: 'Reserved venue', text: ' — just for your team, no strangers at the party.' },
        { strong: 'Grill + charcoal', text: ' — the fire is ready when you arrive.' },
        { strong: 'Food and drinks', text: ' — meats, sides and cold drinks on ice.' },
        { strong: 'Utensils and disposables', text: ' — nobody brings anything from home.' },
        { strong: 'Setup and cleanup', text: ' — arrive to a ready event, leave without looking back.' }
      ];

  const occasions = pt
    ? ['Team building', 'Summer party', 'Onboarding', 'Fecho de trimestre', 'Offsite', 'Despedida de colega', '"Precisamos de sair do escritório"']
    : ['Team building', 'Summer party', 'Onboarding', 'End of quarter', 'Offsite', 'Colleague farewell', '"We need to get out of the office"'];

  const faqs = pt
    ? [
        { q: 'Temos de grelhar nós?', a: 'Só se quiserem. Há sempre alguém da nossa equipa a dominar o fogo — mas quem quiser pegar na pinça tem lugar cativo ao pé do grelhador. É metade da graça.' },
        { q: 'E se chover?', a: 'Acompanhamos a meteorologia contigo na semana do evento e, se for preciso, remarcamos ou mudamos para um espaço com cobertura. Ninguém fica à chuva.' },
        { q: 'Há opções vegetarianas e restrições alimentares?', a: 'Sim. Diz-nos as restrições no pedido de proposta e o menu adapta-se — vegetariano, sem glúten, sem porco, o que a equipa precisar.' },
        { q: 'Quanto tempo dura o evento?', a: 'Tipicamente 3 a 5 horas, mas o formato é vosso. Tarde, fim de dia, sunset — combinamos o horário que fizer sentido para a equipa.' },
        { q: 'O que temos de organizar internamente?', a: 'Nada. Escolhem a data, confirmam o número de pessoas e aparecem. Toda a logística — espaço, comida, bebida, material e limpeza — é connosco.' }
      ]
    : [
        { q: 'Do we have to do the grilling?', a: "Only if you want to. Someone from our team is always in charge of the fire — but anyone who wants to grab the tongs has a reserved spot by the grill. It's half the fun." },
        { q: 'What if it rains?', a: 'We track the weather with you during the week of the event and, if needed, we reschedule or move to a covered venue. Nobody gets rained on.' },
        { q: 'Are there vegetarian options and dietary restrictions?', a: 'Yes. Tell us the restrictions in your proposal request and the menu adapts — vegetarian, gluten-free, no pork, whatever the team needs.' },
        { q: 'How long does the event last?', a: 'Typically 3 to 5 hours, but the format is yours. Afternoon, end of day, sunset — we set the schedule that makes sense for the team.' },
        { q: 'What do we need to organize internally?', a: 'Nothing. Pick the date, confirm the headcount and show up. All the logistics — venue, food, drinks, equipment and cleanup — are on us.' }
      ];

  const inputClass = 'w-full box-border min-w-0 border-4 border-bbq-black rounded-none p-3.5 font-sans font-bold text-base bg-white focus:outline-4 focus:outline-bbq-yellow';
  const labelClass = 'font-black text-xs uppercase tracking-widest grid gap-2';

  return (
    <div className="min-h-screen bg-bbq-cream font-sans text-bbq-black selection:bg-bbq-red selection:text-white">
      {/* Floating WhatsApp */}
      <a
        href="https://wa.me/351961058571"
        target="_blank"
        rel="noopener noreferrer"
        className="fixed bottom-6 right-6 z-50 bg-[#25D366] text-white p-4 rounded-full shadow-hard transition-transform hover:scale-110 flex items-center justify-center"
      >
        <MessageCircle size={24} />
      </a>

      {/* HERO */}
      <section className="relative min-h-[86vh] flex items-center overflow-hidden">
        <div className="absolute inset-0 bg-cover bg-center" style={{ backgroundImage: "url('/videos/hero-corporate-poster.webp')" }} />
        {showVideo && (
          <video
            ref={heroVideoRef}
            autoPlay
            muted
            loop
            playsInline
            poster="/videos/hero-corporate-poster.webp"
            className="absolute inset-0 w-full h-full object-cover"
          >
            <source src="/videos/hero-corporate.webm" type="video/webm" />
            <source src="/videos/hero-corporate.mp4" type="video/mp4" />
          </video>
        )}
        <div className="absolute inset-0" style={{ background: 'linear-gradient(to top, rgba(0,0,0,0.95), rgba(0,0,0,0.3) 55%, rgba(0,0,0,0.5))' }} />
        <div className="relative w-full max-w-6xl mx-auto text-center px-6 pt-28 pb-24">
          <h1 className="mx-auto max-w-[14ch] text-[clamp(48px,8.5vw,120px)] font-black uppercase tracking-tighter leading-[0.95] text-white [text-shadow:10px_10px_0_#1A1A1A]">
            {pt ? 'A tua equipa ' : 'Your team '}
            <span className="text-bbq-yellow">{pt ? 'à volta do fogo' : 'around the fire'}</span>
          </h1>
          <p className="text-white font-bold uppercase tracking-tight text-[clamp(15px,1.6vw,19px)] max-w-[60ch] mx-auto mt-8 mb-6 leading-relaxed [text-shadow:2px_2px_0_rgba(26,26,26,0.85)]">
            {pt
              ? 'Churrascos privados para empresas em Lisboa. Pensado para conexões reais de team bonding.'
              : 'Private barbecues for companies in Lisbon. Arrive, party and leave. Built for real connections.'}
          </p>
          <div className="flex gap-5 justify-center flex-wrap">
            <button onClick={() => scrollToId('proposta')} className={`${btnBase} bg-bbq-red text-white hover:bg-bbq-yellow hover:text-bbq-black`}>
              {pt ? 'Pedir proposta' : 'Request a proposal'}
            </button>
            <button onClick={() => scrollToId('espacos')} className={`${btnBase} bg-bbq-yellow text-bbq-black hover:bg-white`}>
              <Flame size={22} /> {pt ? 'Ver os espaços' : 'See the venues'}
            </button>
          </div>
        </div>
      </section>

      {/* FACTS BAND */}
      <div className="bg-bbq-yellow border-y-4 border-bbq-black">
        <div className="max-w-6xl mx-auto flex justify-center gap-x-14 gap-y-1 flex-wrap px-6 py-[18px]">
          {facts.map((f, i) => (
            <div key={i} className="font-black uppercase tracking-wide text-[15px]">{f}</div>
          ))}
        </div>
      </div>

      {/* CONCEPT */}
      <section className="relative py-24">
        <Dots />
        <div className="relative max-w-6xl mx-auto px-6">
          <div className="mb-6"><Badge variant="red">{pt ? 'Porquê um churrasco?' : 'Why a barbecue?'}</Badge></div>
          <p className="m-0 font-black uppercase tracking-tighter text-[clamp(26px,3.4vw,42px)] leading-[1.1]">
            {pt ? 'A profundidade da conversa e o calor da brasa ' : 'The depth of the conversation and the heat of the coals '}
            <span className="text-bbq-red">{pt ? 'serão as únicas métricas que interessam.' : 'will be the only metrics that matter.'}</span>
          </p>
          <div className="grid grid-cols-[repeat(auto-fit,minmax(280px,1fr))] gap-8 mt-14">
            {conceptCards.map((card, i) => (
              <div key={i} className="group bg-white border-4 border-bbq-black shadow-hard transition-transform duration-150 hover:-translate-y-1">
                <div className="h-[220px] overflow-hidden border-b-4 border-bbq-black">
                  <img
                    {...responsiveImage(card.img)}
                    sizes="(min-width: 640px) 350px, 100vw"
                    alt={card.alt}
                    referrerPolicy="no-referrer"
                    loading="lazy"
                    decoding="async"
                    className="w-full h-full object-cover transition-transform duration-700 ease-out group-hover:scale-110"
                  />
                </div>
                <div className="p-6">
                  <h3 className="m-0 mb-3 text-xl font-black uppercase tracking-tighter">{card.title}</h3>
                  <p className="m-0 text-[13px] font-bold uppercase tracking-tight leading-[1.7] text-gray-500">{card.text}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* MANIFESTO STRIP */}
      <div className="bg-bbq-black py-13 border-t-4 border-bbq-black">
        <div className="max-w-6xl mx-auto px-6 py-2">
          <p className="m-0 text-bbq-cream font-black uppercase tracking-tight text-[clamp(21px,2.8vw,34px)] text-center leading-tight">
            {pt ? 'Menos ecrãs, mais brasas. ' : 'Fewer screens, more embers. '}
            <span className="text-bbq-yellow">{pt ? 'É disto que uma equipa precisa.' : "It's what a team needs."}</span>
          </p>
        </div>
      </div>

      {/* HOW IT WORKS */}
      <section id="como" className="relative py-24">
        <Dots />
        <div className="relative max-w-6xl mx-auto px-6">
          <div className="mb-6"><Badge variant="black">{pt ? 'Como funciona' : 'How it works'}</Badge></div>
          <h2 className="m-0 text-[clamp(30px,4vw,48px)] font-black uppercase tracking-tighter leading-none">
            {pt ? 'Simples de propósito.' : 'Simple on purpose.'}
          </h2>
          <div className="grid grid-cols-[repeat(auto-fit,minmax(280px,1fr))] gap-8 mt-12">
            {steps.map((step, i) => (
              <div key={i} className="bg-white border-4 border-bbq-black shadow-hard p-8">
                <div className="font-black text-8xl leading-[0.8] text-bbq-red/10">{i + 1}</div>
                <h3 className="mt-4 mb-2.5 text-[19px] font-black uppercase tracking-tighter">{step.title}</h3>
                <p className="m-0 text-[13px] font-bold uppercase tracking-tight leading-[1.7] text-gray-500">{step.text}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* VENUES */}
      <section id="espacos" className="bg-bbq-red py-24 border-y-4 border-bbq-black text-white">
        <div className="max-w-6xl mx-auto px-6">
          <div className="mb-6"><Badge variant="yellow">{pt ? 'Os espaços' : 'The venues'}</Badge></div>
          <h2 className="m-0 text-[clamp(30px,4vw,48px)] font-black uppercase tracking-tighter leading-none text-white [text-shadow:4px_4px_0_#1A1A1A]">
            {pt ? 'O backyard que a tua empresa não tem.' : "The backyard your company doesn't have."}
          </h2>
          <p className="mt-4 mb-0 font-bold uppercase tracking-wide text-[15px] max-w-[60ch]">
            {pt
              ? 'Espaços privados ao ar livre, todos em Lisboa, todos com grelhador pronto a trabalhar.'
              : 'Private outdoor venues, all in Lisbon, all with a grill ready to work.'}
          </p>
          <div className="grid grid-cols-[repeat(auto-fit,minmax(min(380px,100%),1fr))] gap-10 mt-12">
            {venues.map((venue, i) => (
              <div key={i} className="group border-4 border-bbq-black bg-bbq-cream text-bbq-black shadow-hard">
                <div className="relative h-[330px] overflow-hidden cursor-zoom-in" onClick={() => setGallery({ name: venue.name, images: venue.images, index: venue.cover })}>
                  <img
                    {...responsiveImage(venue.images[venue.cover])}
                    sizes="(min-width: 1024px) 380px, (min-width: 640px) 50vw, 100vw"
                    alt={`${pt ? 'Espaço' : 'Venue'} ${venue.name}`}
                    referrerPolicy="no-referrer"
                    loading="lazy"
                    decoding="async"
                    className="w-full h-full object-cover transition-transform duration-700 ease-out group-hover:scale-110"
                  />
                  <span className="absolute top-4 left-4 bg-bbq-yellow border-2 border-bbq-black shadow-hard-sm px-3 py-1 font-black uppercase text-xs tracking-wide">{venue.tag}</span>
                  <button
                    onClick={(e) => { e.stopPropagation(); setGallery({ name: venue.name, images: venue.images, index: venue.cover }); }}
                    aria-label={pt ? `Ver fotos de ${venue.name}` : `See photos of ${venue.name}`}
                    className="absolute bottom-4 right-4 bg-bbq-yellow border-2 border-bbq-black shadow-hard-sm px-3 py-2 flex items-center gap-2 font-black uppercase text-xs tracking-wide cursor-pointer hover:bg-white transition-colors"
                  >
                    <Images size={16} strokeWidth={2.5} /> {pt ? 'Ver fotos' : 'See photos'}
                  </button>
                </div>
                <div className="p-6 border-t-4 border-bbq-black">
                  <h3 className="m-0 mb-2 text-[26px] font-black uppercase tracking-tighter">{venue.name}</h3>
                  <p className="m-0 mb-4 text-[13px] font-bold uppercase tracking-tight leading-[1.7] text-gray-500">{venue.text}</p>
                  <div className="flex gap-7 text-xs font-bold uppercase tracking-widest text-gray-500">
                    <span>{venue.capacity}</span>
                    <span>{pt ? 'Ar livre' : 'Outdoor'}</span>
                  </div>
                </div>
              </div>
            ))}
          </div>
          <div className="mt-14">
            <h3 className="m-0 mb-6 text-xl font-black uppercase tracking-tight text-white">
              {pt ? 'E ainda: mais quintais na rede' : 'And also: more backyards in the network'}
            </h3>
            <div className="grid grid-cols-[repeat(auto-fit,minmax(240px,1fr))] gap-6">
              {miniVenues.map((venue, i) => (
                <div key={i} className="group border-4 border-bbq-black bg-bbq-cream text-bbq-black shadow-hard">
                  <div className="relative h-[150px] overflow-hidden border-b-4 border-bbq-black cursor-zoom-in" onClick={() => setGallery({ name: venue.name, images: venue.images, index: venue.cover })}>
                    <img
                      {...responsiveImage(venue.images[venue.cover])}
                      sizes="(min-width: 640px) 300px, 100vw"
                      alt={`${pt ? 'Espaço' : 'Venue'} ${venue.name}`}
                      referrerPolicy="no-referrer"
                      loading="lazy"
                      decoding="async"
                      className="w-full h-full object-cover transition-transform duration-700 ease-out group-hover:scale-110"
                    />
                    <button
                      onClick={(e) => { e.stopPropagation(); setGallery({ name: venue.name, images: venue.images, index: venue.cover }); }}
                      aria-label={pt ? `Ver fotos de ${venue.name}` : `See photos of ${venue.name}`}
                      className="absolute bottom-2 right-2 bg-bbq-yellow border-2 border-bbq-black shadow-hard-sm p-1.5 flex items-center justify-center cursor-pointer hover:bg-white transition-colors"
                    >
                      <Images size={16} strokeWidth={2.5} />
                    </button>
                  </div>
                  <div className="px-4 py-3.5 font-black uppercase text-sm tracking-wide">{venue.name}</div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* INCLUDED + OCCASIONS */}
      <section className="relative pt-24">
        <Dots />
        <div className="relative max-w-6xl mx-auto px-6 pb-24">
          <div className="mb-6"><Badge variant="red">{pt ? 'O que está incluído' : "What's included"}</Badge></div>
          <h2 className="m-0 text-[clamp(30px,4vw,48px)] font-black uppercase tracking-tighter leading-none">
            {pt ? 'Chave na mão. Literalmente.' : 'Turnkey. Literally.'}
          </h2>
          <div className="grid grid-cols-[repeat(auto-fit,minmax(min(380px,100%),1fr))] gap-12 items-center mt-10">
            <div>
              <div className="grid gap-4">
                {included.map((item, i) => (
                  <div key={i} className="bg-white border-4 border-bbq-black shadow-hard px-5 py-4 flex gap-3.5 items-start text-[15px] leading-normal">
                    <span className="shrink-0 w-7 h-7 bg-bbq-yellow border-2 border-bbq-black flex items-center justify-center">
                      <Check size={16} strokeWidth={4} />
                    </span>
                    <span><strong className="uppercase font-black">{item.strong}</strong>{item.text}</span>
                  </div>
                ))}
              </div>
              <p className="mt-5 mb-0 text-[13px] font-bold uppercase tracking-tight text-gray-500">
                {pt
                  ? 'Addons disponíveis: fotógrafo, música, jogos de quintal e mais — é só pedir na proposta.'
                  : 'Add-ons available: photographer, music, backyard games and more — just ask in the proposal.'}
              </p>
            </div>
            <div className="group border-4 border-bbq-black shadow-hard overflow-hidden">
              <img
                {...responsiveImage('/images/mesa-churrasco.webp')}
                sizes="(min-width: 768px) 500px, 100vw"
                alt={pt ? 'Mesa de churrasco com carne grelhada, batatas fritas e salada' : 'Barbecue table with grilled meat, fries and salad'}
                loading="lazy"
                decoding="async"
                className="block w-full h-[470px] object-cover transition-transform duration-700 ease-out group-hover:scale-110"
              />
            </div>
          </div>
          <div className="mt-20">
            <div className="mb-6"><Badge variant="black">{pt ? 'Serve para' : 'Perfect for'}</Badge></div>
            <div className="flex flex-wrap gap-4">
              {occasions.map((occasion, i) => (
                <span key={i} className="bg-white border-2 border-bbq-black shadow-hard-sm px-4.5 py-2.5 font-black uppercase text-[13px] tracking-wide">
                  {occasion}
                </span>
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* PRICE BAND */}
      <section className="bg-bbq-yellow border-y-4 border-bbq-black py-20">
        <div className="max-w-6xl mx-auto px-6 flex gap-12 items-center justify-between flex-wrap">
          <div className="font-black uppercase tracking-tighter text-[clamp(48px,7vw,80px)] leading-none">
            {pt ? 'Desde 35€' : 'From €35'}
            <small className="text-[15px] block font-bold tracking-widest mt-3">
              {pt ? 'por pessoa · tudo incluído' : 'per person · all included'}
            </small>
          </div>
          <p className="m-0 max-w-[42ch] font-bold uppercase text-sm tracking-tight leading-[1.7]">
            {pt
              ? 'O valor final depende do número de pessoas e dos addons que escolherem. Sem custos escondidos, sem surpresas na fatura — dizemos-te o preço fechado antes de confirmares.'
              : 'The final price depends on headcount and the add-ons you choose. No hidden costs, no surprises on the invoice — we give you a closed price before you confirm.'}
          </p>
          <button onClick={() => scrollToId('proposta')} className={`${btnBase} bg-bbq-black text-white hover:bg-bbq-red`}>
            {pt ? 'Pedir orçamento' : 'Request a quote'}
          </button>
        </div>
      </section>

      {/* FAQ */}
      <section id="faq" className="relative py-24">
        <Dots />
        <div className="relative max-w-6xl mx-auto px-6">
          <div className="mb-6"><Badge variant="red">{pt ? 'Perguntas frequentes' : 'Frequently asked questions'}</Badge></div>
          {faqs.map((faq, i) => (
            <details key={i} className="group bg-white border-4 border-bbq-black shadow-hard mb-4">
              <summary className="cursor-pointer px-6 py-5 font-black uppercase text-[15px] tracking-tight list-none [&::-webkit-details-marker]:hidden flex justify-between items-center gap-4">
                {faq.q}
                <span className="text-2xl font-black shrink-0">
                  <span className="group-open:hidden">+</span>
                  <span className="hidden group-open:inline">–</span>
                </span>
              </summary>
              <p className="m-0 px-6 pb-5.5 text-[15px] leading-[1.65] font-medium">{faq.a}</p>
            </details>
          ))}
        </div>
      </section>

      {/* PROPOSAL FORM */}
      <section id="proposta" className="bg-bbq-red text-white py-24 border-t-4 border-bbq-black">
        <div className="max-w-6xl mx-auto px-6 grid grid-cols-[repeat(auto-fit,minmax(min(380px,100%),1fr))] gap-16 items-start">
          <div>
            <div className="mb-6"><Badge variant="yellow">{pt ? 'Pedir proposta' : 'Request a proposal'}</Badge></div>
            <h2 className="m-0 text-[clamp(32px,4.2vw,54px)] font-black uppercase tracking-tighter leading-none text-white [text-shadow:4px_4px_0_#1A1A1A]">
              {pt ? 'Diz-nos quantos são. Nós tratamos do resto.' : 'Tell us how many you are. We handle the rest.'}
            </h2>
            <p className="mt-6 mb-0 font-bold uppercase text-sm tracking-tight max-w-[42ch] leading-[1.7]">
              {pt
                ? 'Respondemos em menos de 24h úteis com uma proposta fechada: espaço, menu, bebidas e preço final. Sem reuniões de alinhamento.'
                : 'We reply in under 24 business hours with a closed proposal: venue, menu, drinks and final price. No alignment meetings.'}
            </p>
            <div className="mt-8 font-bold leading-loose text-base">
              <a href="mailto:pitmasters@lisbonbbq.pt" className="text-bbq-yellow no-underline hover:text-white">pitmasters@lisbonbbq.pt</a><br />
              <a href="tel:+351961058571" className="text-bbq-yellow no-underline hover:text-white">+351 961 058 571</a>
            </div>
          </div>
          <div className="bg-bbq-cream border-4 border-bbq-black shadow-hard p-8 text-bbq-black">
            {submitted ? (
              <div className="text-center py-10">
                <div className="w-16 h-16 bg-bbq-yellow border-4 border-bbq-black shadow-hard-sm flex items-center justify-center mx-auto mb-6">
                  <Check size={32} strokeWidth={4} />
                </div>
                <h3 className="m-0 mb-2 text-2xl font-black uppercase tracking-tighter">{pt ? 'Pedido enviado!' : 'Request sent!'}</h3>
                <p className="m-0 font-bold uppercase text-xs tracking-widest text-gray-500">
                  {pt ? 'Respondemos em menos de 24h úteis.' : 'We reply in under 24 business hours.'}
                </p>
                <button
                  onClick={() => setSubmitted(false)}
                  className="mt-8 text-bbq-red font-black uppercase text-xs tracking-widest underline underline-offset-4 cursor-pointer bg-transparent border-none"
                >
                  {pt ? 'Enviar outro pedido' : 'Send another request'}
                </button>
              </div>
            ) : (
              <form onSubmit={internalSubmit} className="grid gap-[18px]">
                <label className={labelClass}>{pt ? 'Nome do responsável' : 'Contact name'}
                  <input required type="text" name="name" value={formData.name} onChange={handleFormChange} placeholder={pt ? 'O teu nome' : 'Your name'} className={inputClass} />
                </label>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-[18px]">
                  <label className={labelClass}>{pt ? 'Email corporativo' : 'Company email'}
                    <input required type="email" name="email" value={formData.email} onChange={handleFormChange} placeholder={pt ? 'nome@empresa.pt' : 'name@company.com'} className={inputClass} />
                  </label>
                  <label className={labelClass}>{pt ? 'Telemóvel' : 'Phone'}
                    <input required type="tel" name="phone" value={formData.phone} onChange={handleFormChange} placeholder="+351" className={inputClass} />
                  </label>
                </div>
                {showDetails && (
                  <>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-[18px]">
                      <label className={labelClass}>{pt ? 'Local preferido' : 'Preferred venue'}
                        <select name="locationId" value={formData.locationId} onChange={handleFormChange} className={inputClass}>
                          <option value="">{pt ? 'Aceito recomendações' : 'Open to recommendations'}</option>
                          {LOCATIONS.map(loc => <option key={loc.id} value={loc.id}>{loc.name}</option>)}
                          <option value={OWN_LOCATION_ID}>{pt ? 'No local da empresa' : "At the company's own venue"}</option>
                        </select>
                      </label>
                      <label className={labelClass}>{pt ? 'Número de pessoas (mín. 20)' : 'Number of people (min. 20)'}
                        <input required type="text" inputMode="numeric" pattern="[0-9]*" name="guests" value={formData.guests} onChange={handleGuestsChange} placeholder={pt ? 'ex: 80' : 'e.g. 80'} className={inputClass} />
                      </label>
                    </div>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-[18px]">
                      <label className={labelClass}>{pt ? 'Data pretendida' : 'Intended date'}
                        <input required type="date" name="date" value={formData.date} onChange={handleFormChange} className={inputClass} />
                      </label>
                      <label className={labelClass}>{pt ? 'Preferência de churrasco' : 'BBQ preference'}
                        <select name="bbqStyle" value={formData.bbqStyle} onChange={handleFormChange} className={inputClass}>
                          <option value="">{pt ? 'Ainda não sei' : "Don't know yet"}</option>
                          <option value="portuguese">{pt ? 'Português' : 'Portuguese'}</option>
                          <option value="brazilian">{pt ? 'Brasileiro' : 'Brazilian'}</option>
                          <option value="argentinian">{pt ? 'Argentino' : 'Argentinian'}</option>
                        </select>
                      </label>
                    </div>
                    <label className={labelClass}>{pt ? 'Mensagem (opcional)' : 'Message (optional)'}
                      <textarea rows={4} name="message" value={formData.message} onChange={handleFormChange} placeholder={pt ? 'Addons, restrições alimentares, horário preferido…' : 'Add-ons, dietary restrictions, preferred time…'} className={`${inputClass} resize-y`} />
                    </label>
                    {error && (
                      <p className="m-0 text-bbq-red font-black uppercase text-[10px] text-center">
                        {error}
                      </p>
                    )}
                    <button disabled={isSending} className={`${btnBase} w-full bg-bbq-yellow text-bbq-black hover:bg-white disabled:opacity-50`}>
                      <Flame size={22} /> {isSending ? (pt ? 'A enviar…' : 'Sending…') : (pt ? 'Enviar pedido' : 'Send request')}
                    </button>
                  </>
                )}
              </form>
            )}
          </div>
        </div>
      </section>

      {/* GALLERY LIGHTBOX */}
      {gallery && (
        <div className="fixed inset-0 z-[70] bg-black/85 flex items-center justify-center p-4 sm:p-8" onClick={() => setGallery(null)}>
          <div className="relative w-full max-w-4xl" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-3">
              <span className="bg-bbq-yellow border-2 border-bbq-black shadow-hard-sm px-3 py-1 font-black uppercase text-xs tracking-wide">
                {gallery.name} · {gallery.index + 1}/{gallery.images.length}
              </span>
              <button
                onClick={() => setGallery(null)}
                aria-label={pt ? 'Fechar galeria' : 'Close gallery'}
                className="bg-bbq-red text-white border-2 border-bbq-black shadow-hard-sm p-1.5 cursor-pointer hover:bg-bbq-yellow hover:text-bbq-black transition-colors"
              >
                <X size={18} strokeWidth={3} />
              </button>
            </div>
            <div className="relative border-4 border-bbq-black shadow-hard bg-bbq-black">
              <img
                src={gallery.images[gallery.index]}
                alt={`${gallery.name} — ${pt ? 'foto' : 'photo'} ${gallery.index + 1}`}
                referrerPolicy="no-referrer"
                className="block w-full max-h-[75vh] object-contain"
              />
              {gallery.images.length > 1 && (
                <>
                  <button
                    onClick={() => setGallery(g => g && { ...g, index: (g.index - 1 + g.images.length) % g.images.length })}
                    aria-label={pt ? 'Foto anterior' : 'Previous photo'}
                    className="absolute left-3 top-1/2 -translate-y-1/2 bg-bbq-yellow border-2 border-bbq-black shadow-hard-sm p-2 cursor-pointer hover:bg-white transition-colors"
                  >
                    <ChevronLeft size={22} strokeWidth={3} />
                  </button>
                  <button
                    onClick={() => setGallery(g => g && { ...g, index: (g.index + 1) % g.images.length })}
                    aria-label={pt ? 'Foto seguinte' : 'Next photo'}
                    className="absolute right-3 top-1/2 -translate-y-1/2 bg-bbq-yellow border-2 border-bbq-black shadow-hard-sm p-2 cursor-pointer hover:bg-white transition-colors"
                  >
                    <ChevronRight size={22} strokeWidth={3} />
                  </button>
                </>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
