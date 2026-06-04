import { createFileRoute } from "@tanstack/react-router";
import { motion, useScroll, useTransform, useInView, useMotionValue, animate } from "framer-motion";
import { useEffect, useRef, useState } from "react";
import heroBurger from "@/assets/hero-burger.jpg";
import floatBurger from "@/assets/float-burger.png";
import floatFries from "@/assets/float-fries.png";
import floatVeg from "@/assets/float-veg.png";
import {
  Settings, Timer, Users, Wallet, UtensilsCrossed, Armchair, Bike, TrendingUp,
  Gift, MessageCircle, Check, ArrowRight, Star, Instagram, Linkedin, Phone,
  ChevronDown, Flame,
} from "lucide-react";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Burguer Hub — Sistema de Gestão Completo para Hamburguerias" },
      { name: "description", content: "Cardápio, mesas, delivery, financeiro e fidelidade numa plataforma só. Aumente seus pedidos e organize sua hamburgueria com o Burguer Hub." },
      { property: "og:title", content: "Burguer Hub — Gestão Completa para Hamburguerias" },
      { property: "og:description", content: "A plataforma que organiza pedidos, delivery, mesas e fidelidade da sua hamburgueria." },
    ],
  }),
  component: Index,
});

const nav = [
  { href: "#problemas", label: "Soluções" },
  { href: "#funcionalidades", label: "Funcionalidades" },
  { href: "#como-funciona", label: "Como funciona" },
  { href: "#precos", label: "Preços" },
  { href: "#faq", label: "FAQ" },
];

const problemas = [
  { icon: Settings, title: "Múltiplos sistemas desconectados", desc: "Integre cardápio, mesas, delivery, financeiro e fidelidade em um só lugar." },
  { icon: Timer, title: "Gestão manual e lenta", desc: "Automação de pedidos, notificações e fluxo de caixa em tempo real." },
  { icon: Users, title: "Perda de clientes", desc: "Programa de fidelidade robusto com pontos, resgates e segmentação." },
  { icon: Wallet, title: "Controle financeiro deficiente", desc: "Dashboards de lucro, contas fixas e recorrentes automatizadas." },
];

const features = [
  { icon: UtensilsCrossed, title: "Cardápio Inteligente", desc: "Produtos, categorias, adicionais e destaques. Cardápio público personalizável." },
  { icon: Armchair, title: "Mesas & Atendimento", desc: "Controle de mesas, pedidos presenciais, fidelidade integrada e impressão de cupons." },
  { icon: Bike, title: "Delivery Completo", desc: "Gestão de pedidos, rotas e taxas por bairro. Integração nativa com WhatsApp." },
  { icon: TrendingUp, title: "Financeiro Avançado", desc: "Contas a pagar/receber, lucro semanal e mensal, caixa e fechamento diário." },
  { icon: Gift, title: "Programa de Fidelidade", desc: "Pontos por pedido, resgates, metas configuráveis e isolamento multi-tenant." },
  { icon: MessageCircle, title: "Integração WhatsApp", desc: "Notificações automáticas de pedidos, status e validação de cupons via Zapi." },
];

const steps = [
  { n: "01", title: "Configure seu negócio", desc: "Nome, horário, cardápio e taxas de entrega em poucos minutos." },
  { n: "02", title: "Comece a receber pedidos", desc: "Clientes pedem pelo cardápio público, nas mesas ou pelo delivery." },
  { n: "03", title: "Gerencie tudo facilmente", desc: "Dashboard centralizado com analytics, financeiro e relatórios." },
];

const recursos = [
  "Cardápio público configurável com múltiplas categorias",
  "Sistema de pedidos em mesas com impressão integrada",
  "Módulo de delivery com rotas e taxas por bairro",
  "Programa de fidelidade com pontos e recompensas",
  "Sistema de cupons e descontos",
  "Relatórios financeiros em tempo real",
  "Gestão de clientes com histórico de pedidos",
  "Integração com WhatsApp (Zapi)",
  "Suporte a múltiplas lojas (multi-tenant)",
  "Dashboard com gráficos e métricas",
  "Compatível com web, tablet e mobile",
  "Backup automático com Supabase",
];

const planos = [
  { name: "Básico", price: "R$ 89", desc: "Para hamburguerias começando online",
    features: ["1 loja", "Até 300 pedidos/mês", "Cardápio público", "Suporte por e-mail"], cta: "Começar grátis" },
  { name: "Profissional", price: "R$ 189", desc: "Para operações em crescimento",
    features: ["Até 3 lojas", "Pedidos ilimitados", "Analytics avançado", "Fidelidade & cupons", "Suporte prioritário"], cta: "Quero esse plano", highlight: true },
  { name: "Enterprise", price: "Sob consulta", desc: "Para redes e franquias",
    features: ["Lojas ilimitadas", "Customizações", "Integrações dedicadas", "Onboarding white-glove", "Suporte 24/7"], cta: "Falar com vendas" },
];

const depoimentos = [
  { name: "Rafael Moura", biz: "Burguer do Rafa — Curitiba", text: "Aumentei 42% dos pedidos online no primeiro mês. O delivery por bairro virou outra coisa.", initial: "R" },
  { name: "Camila Torres", biz: "Tonha Lanches — Recife", text: "Finalmente parei de usar três planilhas. Fechamento de caixa em 2 cliques é viciante.", initial: "C" },
  { name: "Diego Albuquerque", biz: "Hot Grill — São Paulo", text: "O programa de fidelidade trouxe clientes recorrentes que eu nem sabia que existiam.", initial: "D" },
];

const faqs = [
  { q: "Meus dados estão seguros?", a: "Sim. Usamos infraestrutura Supabase com criptografia em repouso e em trânsito, backups automáticos diários e isolamento por proprietário (multi-tenant)." },
  { q: "Quanto tempo leva para configurar?", a: "A configuração inicial leva em média 20 minutos. Importamos seu cardápio atual e configuramos taxas de entrega por bairro junto com você." },
  { q: "Funciona com minha impressora térmica?", a: "Sim. Suportamos as principais impressoras térmicas de cupom (USB e rede) tanto para mesas quanto para delivery." },
  { q: "Posso integrar com sistemas que já uso?", a: "Oferecemos integração nativa com WhatsApp (Zapi) e APIs abertas para conectar ERPs, gateways de pagamento e plataformas de delivery." },
  { q: "Qual o custo de implantação?", a: "Zero. O onboarding está incluso em todos os planos, e você tem 30 dias grátis para validar antes de pagar." },
  { q: "Vocês treinam minha equipe?", a: "Sim. Sessões guiadas de treinamento ao vivo, documentação completa e vídeos curtos por funcionalidade." },
];

const stats = [
  { value: 500, suffix: "+", label: "Hamburguerias ativas" },
  { value: 2, suffix: "M+", label: "Pedidos processados" },
  { value: 42, suffix: "%", label: "Aumento médio em vendas" },
  { value: 99.9, suffix: "%", label: "Uptime garantido" },
];

/* ----------------- Reusable animation primitives ----------------- */

function Reveal({
  children, delay = 0, x = 0, className = "",
}: { children: React.ReactNode; delay?: number; x?: number; className?: string }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 30, x, scale: 0.95 }}
      whileInView={{ opacity: 1, y: 0, x: 0, scale: 1 }}
      viewport={{ once: true, margin: "-80px" }}
      transition={{ duration: 0.6, delay, ease: [0.22, 1, 0.36, 1] }}
      className={className}
    >
      {children}
    </motion.div>
  );
}

function Counter({ to, suffix = "", duration = 1.6 }: { to: number; suffix?: string; duration?: number }) {
  const ref = useRef<HTMLSpanElement>(null);
  const inView = useInView(ref, { once: true, margin: "-50px" });
  const mv = useMotionValue(0);
  const [display, setDisplay] = useState("0");

  useEffect(() => {
    if (!inView) return;
    const controls = animate(mv, to, {
      duration, ease: [0.22, 1, 0.36, 1],
      onUpdate: (v) => {
        const isFloat = to % 1 !== 0;
        setDisplay(isFloat ? v.toFixed(1) : Math.round(v).toLocaleString("pt-BR"));
      },
    });
    return controls.stop;
  }, [inView, to, duration, mv]);

  return <span ref={ref}>{display}{suffix}</span>;
}

/* ----------------- Page ----------------- */

function Index() {
  return (
    <div className="min-h-screen bg-transparent text-foreground overflow-x-hidden">
      <Nav />
      <Hero />
      <Stats />
      <Problemas />
      <Funcionalidades />
      <ComoFunciona />
      <Recursos />
      <Precos />
      <Depoimentos />
      <FAQ />
      <CTAFinal />
      <Footer />
    </div>
  );
}

function Nav() {
  const [open, setOpen] = useState(false);
  return (
    <header className="sticky top-0 z-50 border-b border-border/60 bg-background/80 backdrop-blur-lg">
      <div className="mx-auto flex max-w-7xl items-center justify-between px-6 py-4">
        <a href="#" className="flex items-center gap-2">
          <span className="grid h-9 w-9 place-items-center rounded-xl bg-gradient-primary text-primary-foreground shadow-glow">
            <Flame className="h-5 w-5" />
          </span>
          <span className="font-display text-2xl tracking-wide">BURGUER HUB</span>
        </a>
        <nav className="hidden items-center gap-8 md:flex">
          {nav.map((n) => (
            <a key={n.href} href={n.href} className="text-sm font-medium text-muted-foreground transition hover:text-foreground">
              {n.label}
            </a>
          ))}
        </nav>
        <div className="hidden items-center gap-3 md:flex">
          <a href="#cta" className="text-sm font-medium text-muted-foreground hover:text-foreground">Entrar</a>
          <a href="#cta" className="inline-flex items-center gap-2 rounded-full bg-gradient-primary px-5 py-2.5 text-sm font-semibold text-primary-foreground shadow-glow transition hover:scale-105">
            Teste Grátis <ArrowRight className="h-4 w-4" />
          </a>
        </div>
        <button onClick={() => setOpen(!open)} className="md:hidden" aria-label="Menu">
          <ChevronDown className={`h-6 w-6 transition ${open ? "rotate-180" : ""}`} />
        </button>
      </div>
      {open && (
        <div className="border-t border-border bg-background md:hidden">
          <div className="flex flex-col gap-3 px-6 py-4">
            {nav.map((n) => (
              <a key={n.href} href={n.href} onClick={() => setOpen(false)} className="text-sm font-medium text-muted-foreground">
                {n.label}
              </a>
            ))}
            <a href="#cta" className="mt-2 rounded-full bg-gradient-primary px-5 py-2.5 text-center text-sm font-semibold text-primary-foreground">
              Teste Grátis
            </a>
          </div>
        </div>
      )}
    </header>
  );
}

function Hero() {
  const ref = useRef<HTMLElement>(null);
  const { scrollY } = useScroll();
  // Parallax: background moves slower, decorations move at different speeds
  const yBg = useTransform(scrollY, [0, 800], [0, 240]);
  const yOverlay = useTransform(scrollY, [0, 800], [0, 120]);
  const opacity = useTransform(scrollY, [0, 500], [1, 0.3]);
  const yFloat1 = useTransform(scrollY, [0, 800], [0, -160]);
  const yFloat2 = useTransform(scrollY, [0, 800], [0, -400]);
  const yFloat3 = useTransform(scrollY, [0, 800], [0, -260]);
  const rotateFloat = useTransform(scrollY, [0, 800], [0, 35]);

  return (
    <section ref={ref} className="relative overflow-hidden">
      <motion.div style={{ y: yBg }} className="absolute inset-0 -z-10 scale-110">
        <img src={heroBurger} alt="Hambúrguer artesanal" width={1920} height={1080} className="h-full w-full object-cover" />
      </motion.div>
      <motion.div style={{ y: yOverlay }} className="absolute inset-0 -z-10 bg-gradient-to-r from-secondary/95 via-secondary/80 to-secondary/30" />
      <div className="absolute inset-0 -z-10 bg-gradient-to-t from-background via-transparent to-transparent" />

      {/* Floating decorations */}
      <motion.img
        src={floatFries} alt="" aria-hidden style={{ y: yFloat1, rotate: rotateFloat }}
        className="pointer-events-none absolute right-[8%] top-[15%] hidden h-32 w-32 opacity-90 will-change-transform md:block"
      />
      <motion.img
        src={floatVeg} alt="" aria-hidden style={{ y: yFloat2, rotate: useTransform(scrollY, [0, 800], [0, -45]) }}
        className="pointer-events-none absolute left-[5%] bottom-[20%] hidden h-24 w-24 opacity-80 will-change-transform md:block"
      />
      <motion.img
        src={floatBurger} alt="" aria-hidden style={{ y: yFloat3, rotate: useTransform(scrollY, [0, 800], [0, 25]) }}
        className="pointer-events-none absolute right-[18%] bottom-[10%] hidden h-40 w-40 opacity-90 will-change-transform lg:block"
      />

      <div className="mx-auto grid max-w-7xl gap-12 px-6 py-24 md:py-32 lg:grid-cols-2 lg:py-40">
        <motion.div style={{ opacity }} className="text-secondary-foreground">
          <motion.span
            initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.6 }}
            className="inline-flex items-center gap-2 rounded-full border border-white/20 bg-white/10 px-4 py-1.5 text-xs font-semibold uppercase tracking-wider backdrop-blur"
          >
            <Flame className="h-3.5 w-3.5 text-highlight" /> Sistema #1 para hamburguerias
          </motion.span>
          <motion.h1
            initial={{ opacity: 0, y: 30 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.8, delay: 0.1 }}
            className="mt-6 font-display text-5xl leading-[0.95] sm:text-6xl lg:text-7xl"
          >
            Seu sistema completo de gestão de <span className="text-gradient">hamburguerias</span>
          </motion.h1>
          <motion.p
            initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.8, delay: 0.25 }}
            className="mt-6 max-w-xl text-lg text-white/80"
          >
            Gerencie cardápio, pedidos, delivery, financeiro e fidelidade de clientes em uma única plataforma intuitiva.
          </motion.p>
          <motion.div
            initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.8, delay: 0.4 }}
            className="mt-10 flex flex-wrap gap-4"
          >
            <a href="#cta" className="inline-flex items-center gap-2 rounded-full bg-gradient-primary px-7 py-4 text-base font-semibold text-primary-foreground shadow-glow transition hover:scale-105">
              Começar Teste Grátis <ArrowRight className="h-5 w-5" />
            </a>
            <a href="#funcionalidades" className="inline-flex items-center gap-2 rounded-full border border-white/30 bg-white/5 px-7 py-4 text-base font-semibold text-white backdrop-blur transition hover:bg-white/10">
              Ver Demo
            </a>
          </motion.div>
          <motion.div
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 0.8, delay: 0.6 }}
            className="mt-10 flex flex-wrap items-center gap-6 text-sm text-white/70"
          >
            <div className="flex items-center gap-1">
              {[...Array(5)].map((_, i) => <Star key={i} className="h-4 w-4 fill-highlight text-highlight" />)}
              <span className="ml-2">4.9/5 — +800 hamburguerias</span>
            </div>
            <span>30 dias grátis · sem cartão</span>
          </motion.div>
        </motion.div>

        <div className="relative hidden lg:block">
          <motion.div
            initial={{ opacity: 0, x: 40 }} animate={{ opacity: 1, x: 0 }} transition={{ duration: 0.8, delay: 0.3 }}
            className="absolute right-0 top-10 w-80 rounded-2xl bg-card p-5 shadow-elevated animate-float"
          >
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold uppercase text-muted-foreground">Pedidos hoje</span>
              <span className="rounded-full bg-primary/10 px-2 py-0.5 text-xs font-bold text-primary">+24%</span>
            </div>
            <div className="mt-2 font-display text-4xl">R$ 4.872</div>
            <div className="mt-4 grid grid-cols-3 gap-2 text-center text-xs">
              <div className="rounded-lg bg-muted p-2"><div className="font-bold text-foreground">87</div>Delivery</div>
              <div className="rounded-lg bg-muted p-2"><div className="font-bold text-foreground">34</div>Mesas</div>
              <div className="rounded-lg bg-muted p-2"><div className="font-bold text-foreground">12</div>Balcão</div>
            </div>
          </motion.div>
          <motion.div
            initial={{ opacity: 0, x: -40 }} animate={{ opacity: 1, x: 0 }} transition={{ duration: 0.8, delay: 0.5 }}
            className="absolute bottom-0 left-0 w-72 rounded-2xl bg-card p-5 shadow-elevated animate-float"
            style={{ animationDelay: "1s" }}
          >
            <div className="flex items-center gap-3">
              <div className="grid h-10 w-10 place-items-center rounded-full bg-gradient-warm">
                <Gift className="h-5 w-5 text-secondary" />
              </div>
              <div>
                <div className="text-xs text-muted-foreground">Cliente fidelizado</div>
                <div className="font-semibold">+50 pontos resgatados</div>
              </div>
            </div>
          </motion.div>
        </div>
      </div>
    </section>
  );
}

function Stats() {
  const ref = useRef<HTMLElement>(null);
  const { scrollY } = useScroll();
  const yBg = useTransform(scrollY, [800, 1600], [0, 100]);
  
  return (
    <section ref={ref} className="relative overflow-hidden border-b border-border py-14">
      {/* Fundo paralaxado VIBRANTE */}
      <motion.div
        style={{ y: yBg }}
        className="absolute inset-0 -z-10"
      >
        <div className="absolute inset-0 bg-gradient-to-r from-slate-900 via-slate-800 to-slate-900" />
        <div className="absolute top-0 right-1/4 w-96 h-96 bg-orange-500 opacity-40 blur-3xl" />
        <div className="absolute bottom-0 left-1/4 w-96 h-96 bg-red-500 opacity-30 blur-3xl" />
      </motion.div>

      <div className="relative mx-auto grid max-w-7xl gap-8 px-6 sm:grid-cols-2 lg:grid-cols-4 text-secondary-foreground">
        {stats.map((s, i) => (
          <Reveal key={s.label} delay={i * 0.1}>
            <div className="text-center">
              <div className="font-display text-5xl text-gradient sm:text-6xl">
                <Counter to={s.value} suffix={s.suffix} />
              </div>
              <div className="mt-2 text-sm uppercase tracking-wider text-white/70">{s.label}</div>
            </div>
          </Reveal>
        ))}
      </div>
    </section>
  );
}

function SectionTitle({ eyebrow, title, desc }: { eyebrow: string; title: string; desc?: string }) {
  return (
    <Reveal>
      <div className="mx-auto max-w-3xl text-center">
        <span className="text-xs font-semibold uppercase tracking-[0.2em] text-primary">{eyebrow}</span>
        <h2 className="mt-3 font-display text-4xl sm:text-5xl">{title}</h2>
        {desc && <p className="mt-4 text-lg text-muted-foreground">{desc}</p>}
      </div>
    </Reveal>
  );
}

function Problemas() {
  const ref = useRef<HTMLElement>(null);
  const { scrollY } = useScroll();
  const yBg = useTransform(scrollY, [1200, 2400], [0, 200]);
  
  return (
    <section id="problemas" className="relative overflow-hidden py-24">
      {/* Fundo paralaxado VIBRANTE */}
      <motion.div
        ref={ref}
        style={{ y: yBg }}
        className="absolute inset-0 -z-10"
      >
        <div className="absolute inset-0 bg-gradient-to-br from-orange-100 via-red-50 to-yellow-100" />
        <div className="absolute top-1/4 right-0 w-96 h-96 bg-orange-400 opacity-50 blur-3xl" />
        <div className="absolute bottom-1/4 left-0 w-96 h-96 bg-red-400 opacity-40 blur-3xl" />
      </motion.div>

      <div className="relative mx-auto max-w-7xl px-6">
        <SectionTitle eyebrow="Problemas & Soluções" title="Pare de remediar. Comece a operar." desc="O que toda hamburgueria enfrenta — e como o Burguer Hub resolve." />
        <div className="mt-16 grid gap-6 md:grid-cols-2 lg:grid-cols-4">
          {problemas.map((p, i) => (
            <Reveal key={p.title} delay={i * 0.1}>
              <div className="group h-full rounded-2xl border border-border bg-white/60 backdrop-blur-sm p-7 shadow-card transition hover:-translate-y-1 hover:shadow-elevated">
                <div className="grid h-12 w-12 place-items-center rounded-xl bg-gradient-primary text-primary-foreground shadow-glow transition group-hover:scale-110 group-hover:rotate-6">
                  <p.icon className="h-6 w-6" />
                </div>
                <h3 className="mt-5 font-display text-xl">{p.title}</h3>
                <p className="mt-2 text-sm text-muted-foreground">{p.desc}</p>
              </div>
            </Reveal>
          ))}
        </div>
      </div>
    </section>
  );
}

function Funcionalidades() {
  const ref = useRef<HTMLElement>(null);
  const { scrollY } = useScroll();
  const yBg = useTransform(scrollY, [2400, 3600], [0, -200]);
  
  return (
    <section id="funcionalidades" className="relative overflow-hidden py-24">
      {/* Fundo paralaxado VIBRANTE */}
      <motion.div
        ref={ref}
        style={{ y: yBg }}
        className="absolute inset-0 -z-10"
      >
        <div className="absolute inset-0 bg-gradient-to-br from-blue-100 via-purple-100 to-pink-100" />
        <div className="absolute top-1/4 left-0 w-96 h-96 bg-purple-500 opacity-50 blur-3xl" />
        <div className="absolute bottom-1/4 right-0 w-96 h-96 bg-pink-500 opacity-40 blur-3xl" />
      </motion.div>

      <div className="relative mx-auto max-w-7xl px-6">
        <SectionTitle eyebrow="Funcionalidades" title="Tudo o que sua hamburgueria precisa" desc="Seis módulos integrados, um só painel." />
        <div className="mt-16 grid gap-6 md:grid-cols-2 lg:grid-cols-3">
          {features.map((f, i) => {
            const col = i % 3;
            const x = col === 0 ? -60 : col === 2 ? 60 : 0;
            return (
              <Reveal key={f.title} delay={(i % 3) * 0.1 + Math.floor(i / 3) * 0.15} x={x}>
                <div className="group relative h-full overflow-hidden rounded-2xl border border-border bg-white/60 backdrop-blur-sm p-8 shadow-card transition hover:shadow-elevated">
                  <div className="absolute -right-6 -top-6 h-24 w-24 rounded-full bg-gradient-primary opacity-10 transition group-hover:scale-150 group-hover:opacity-20" />
                  <div className="relative grid h-14 w-14 place-items-center rounded-2xl bg-secondary text-primary transition group-hover:bg-gradient-primary group-hover:text-primary-foreground">
                    <f.icon className="h-7 w-7" />
                  </div>
                  <h3 className="mt-6 font-display text-2xl">{f.title}</h3>
                  <p className="mt-2 text-muted-foreground">{f.desc}</p>
                </div>
              </Reveal>
            );
          })}
        </div>
      </div>
    </section>
  );
}

function ComoFunciona() {
  return (
    <section id="como-funciona" className="relative overflow-hidden bg-gradient-dark py-24 text-secondary-foreground">
      <div className="mx-auto max-w-7xl px-6">
        <div className="mx-auto max-w-3xl text-center">
          <Reveal>
            <span className="text-xs font-semibold uppercase tracking-[0.2em] text-highlight">Como funciona</span>
            <h2 className="mt-3 font-display text-4xl sm:text-5xl">Em 3 passos você está vendendo</h2>
          </Reveal>
        </div>
        <div className="mt-16 grid gap-8 md:grid-cols-3">
          {steps.map((s, i) => (
            <motion.div
              key={s.n}
              initial={{ opacity: 0, y: 40, rotate: -8 }}
              whileInView={{ opacity: 1, y: 0, rotate: 0 }}
              viewport={{ once: true, margin: "-80px" }}
              transition={{ duration: 0.7, delay: i * 0.15, ease: [0.22, 1, 0.36, 1] }}
              className="relative rounded-2xl border border-white/10 bg-white/5 p-8 backdrop-blur"
            >
              <div className="font-display text-6xl text-gradient">{s.n}</div>
              <h3 className="mt-4 font-display text-2xl">{s.title}</h3>
              <p className="mt-2 text-white/70">{s.desc}</p>
              {i < steps.length - 1 && (
                <ArrowRight className="absolute -right-4 top-1/2 hidden h-8 w-8 -translate-y-1/2 text-primary md:block" />
              )}
            </motion.div>
          ))}
        </div>
      </div>
    </section>
  );
}

function Recursos() {
  const ref = useRef<HTMLElement>(null);
  const { scrollY } = useScroll();
  const yBg = useTransform(scrollY, [4800, 6000], [0, 150]);
  
  return (
    <section ref={ref} className="relative overflow-hidden py-24">
      {/* Fundo paralaxado VIBRANTE */}
      <motion.div
        style={{ y: yBg }}
        className="absolute inset-0 -z-10"
      >
        <div className="absolute inset-0 bg-gradient-to-br from-green-100 via-emerald-100 to-teal-100" />
        <div className="absolute top-0 right-1/3 w-96 h-96 bg-green-500 opacity-50 blur-3xl" />
        <div className="absolute bottom-0 left-1/3 w-96 h-96 bg-emerald-500 opacity-40 blur-3xl" />
      </motion.div>

      <div className="relative mx-auto grid max-w-7xl gap-16 px-6 lg:grid-cols-2 lg:items-center">
        <Reveal x={-50}>
          <span className="text-xs font-semibold uppercase tracking-[0.2em] text-primary">Recursos</span>
          <h2 className="mt-3 font-display text-4xl sm:text-5xl">Tudo incluído. Sem letras miúdas.</h2>
          <p className="mt-4 text-lg text-muted-foreground">
            Construído na stack mais moderna do mercado: React, TypeScript e Supabase. Performance global e
            confiabilidade enterprise para o seu negócio.
          </p>
          <div className="mt-8 flex flex-wrap gap-3">
            {["React", "TypeScript", "Supabase", "WhatsApp Zapi", "Vercel"].map((t) => (
              <span key={t} className="rounded-full border border-border bg-white/60 backdrop-blur px-4 py-1.5 text-sm font-medium">{t}</span>
            ))}
          </div>
        </Reveal>
        <ul className="grid gap-3 sm:grid-cols-2">
          {recursos.map((r, i) => (
            <motion.li
              key={r}
              initial={{ opacity: 0, x: 30 }}
              whileInView={{ opacity: 1, x: 0 }}
              viewport={{ once: true, margin: "-50px" }}
              transition={{ duration: 0.4, delay: i * 0.05, ease: "easeOut" }}
              className="flex items-start gap-3 rounded-xl border border-border bg-white/60 backdrop-blur p-4 shadow-card"
            >
              <span className="grid h-6 w-6 shrink-0 place-items-center rounded-full bg-gradient-primary text-primary-foreground">
                <Check className="h-3.5 w-3.5" strokeWidth={3} />
              </span>
              <span className="text-sm font-medium">{r}</span>
            </motion.li>
          ))}
        </ul>
      </div>
    </section>
  );
}

function Precos() {
  const ref = useRef<HTMLElement>(null);
  const { scrollY } = useScroll();
  const yBg = useTransform(scrollY, [6000, 7200], [0, 200]);
  
  return (
    <section ref={ref} id="precos" className="relative overflow-hidden py-24">
      {/* Fundo paralaxado VIBRANTE */}
      <motion.div
        style={{ y: yBg }}
        className="absolute inset-0 -z-10"
      >
        <div className="absolute inset-0 bg-gradient-to-br from-orange-100 via-red-100 to-pink-100" />
        <div className="absolute top-1/3 right-0 w-96 h-96 bg-orange-500 opacity-50 blur-3xl" />
        <div className="absolute bottom-1/3 left-0 w-96 h-96 bg-red-500 opacity-40 blur-3xl" />
      </motion.div>

      <div className="relative mx-auto max-w-7xl px-6">
        <SectionTitle eyebrow="Preços" title="Planos para cada estágio" desc="Comece grátis por 30 dias. Sem cartão de crédito." />
        <div className="mt-16 grid gap-6 lg:grid-cols-3">
          {planos.map((p, i) => {
            const col = i % 3;
            const x = col === 0 ? -50 : col === 2 ? 50 : 0;
            return (
              <Reveal key={p.name} delay={i * 0.12} x={x}>
                <div className={`relative h-full rounded-3xl border p-8 transition hover:-translate-y-2 ${
                  p.highlight ? "border-primary bg-slate-900 text-secondary-foreground shadow-glow" : "border-border bg-white/60 backdrop-blur-sm shadow-card"
                }`}>
                  {p.highlight && (
                    <span className="absolute -top-3 left-1/2 -translate-x-1/2 rounded-full bg-highlight px-4 py-1 text-xs font-bold uppercase text-highlight-foreground">
                      Mais popular
                    </span>
                  )}
                  <h3 className="font-display text-2xl">{p.name}</h3>
                  <p className={`mt-1 text-sm ${p.highlight ? "text-white/70" : "text-muted-foreground"}`}>{p.desc}</p>
                  <div className="mt-6 flex items-baseline gap-1">
                    <span className="font-display text-5xl">{p.price}</span>
                    {p.price.startsWith("R$") && <span className="text-sm opacity-70">/mês</span>}
                  </div>
                  <ul className="mt-6 space-y-3">
                    {p.features.map((f) => (
                      <li key={f} className="flex items-center gap-2 text-sm">
                        <Check className={`h-4 w-4 ${p.highlight ? "text-highlight" : "text-primary"}`} strokeWidth={3} />
                        {f}
                      </li>
                    ))}
                  </ul>
                  <a href="#cta" className={`mt-8 inline-flex w-full items-center justify-center gap-2 rounded-full px-6 py-3 text-sm font-semibold transition ${
                    p.highlight ? "bg-gradient-primary text-primary-foreground hover:scale-105" : "border border-border bg-background hover:bg-muted"
                  }`}>
                    {p.cta} <ArrowRight className="h-4 w-4" />
                  </a>
                </div>
              </Reveal>
            );
          })}
        </div>
      </div>
    </section>
  );
}

function Depoimentos() {
  const ref = useRef<HTMLElement>(null);
  const { scrollY } = useScroll();
  const yBg = useTransform(scrollY, [7200, 8400], [0, -150]);
  
  return (
    <section ref={ref} className="relative overflow-hidden py-24">
      {/* Fundo paralaxado VIBRANTE */}
      <motion.div
        style={{ y: yBg }}
        className="absolute inset-0 -z-10"
      >
        <div className="absolute inset-0 bg-gradient-to-br from-blue-100 via-indigo-100 to-cyan-100" />
        <div className="absolute top-1/2 left-1/4 w-96 h-96 bg-blue-500 opacity-50 blur-3xl" />
        <div className="absolute bottom-1/2 right-1/4 w-96 h-96 bg-indigo-500 opacity-40 blur-3xl" />
      </motion.div>

      <div className="relative mx-auto max-w-7xl px-6">
        <SectionTitle eyebrow="Depoimentos" title="Quem usa, recomenda" />
        <div className="mt-16 grid gap-6 md:grid-cols-3">
          {depoimentos.map((d, i) => (
            <Reveal key={d.name} delay={i * 0.12} x={i === 0 ? -40 : i === 2 ? 40 : 0}>
              <div className="h-full rounded-2xl border border-border bg-white/60 backdrop-blur p-7 shadow-card">
                <div className="flex gap-1">
                  {[...Array(5)].map((_, i) => <Star key={i} className="h-4 w-4 fill-highlight text-highlight" />)}
                </div>
                <p className="mt-4 text-lg leading-relaxed">"{d.text}"</p>
                <div className="mt-6 flex items-center gap-3">
                  <div className="grid h-11 w-11 place-items-center rounded-full bg-gradient-primary font-display text-lg text-primary-foreground">
                    {d.initial}
                  </div>
                  <div>
                    <div className="font-semibold">{d.name}</div>
                    <div className="text-xs text-muted-foreground">{d.biz}</div>
                  </div>
                </div>
              </div>
            </Reveal>
          ))}
        </div>
      </div>
    </section>
  );
}

function FAQ() {
  const ref = useRef<HTMLElement>(null);
  const { scrollY } = useScroll();
  const yBg = useTransform(scrollY, [8400, 9600], [0, 180]);
  const [open, setOpen] = useState<number | null>(0);
  
  return (
    <section ref={ref} id="faq" className="relative overflow-hidden py-24">
      {/* Fundo paralaxado VIBRANTE */}
      <motion.div
        style={{ y: yBg }}
        className="absolute inset-0 -z-10"
      >
        <div className="absolute inset-0 bg-gradient-to-br from-yellow-100 via-amber-100 to-orange-100" />
        <div className="absolute top-0 left-1/3 w-96 h-96 bg-yellow-500 opacity-50 blur-3xl" />
        <div className="absolute bottom-0 right-1/3 w-96 h-96 bg-amber-500 opacity-40 blur-3xl" />
      </motion.div>

      <div className="relative mx-auto max-w-3xl px-6">
        <SectionTitle eyebrow="FAQ" title="Perguntas frequentes" />
        <div className="mt-12 space-y-3">
          {faqs.map((f, i) => (
            <Reveal key={f.q} delay={i * 0.05}>
              <div className="overflow-hidden rounded-2xl border border-border bg-white/60 backdrop-blur shadow-card">
                <button
                  onClick={() => setOpen(open === i ? null : i)}
                  className="flex w-full items-center justify-between gap-4 px-6 py-5 text-left"
                >
                  <span className="font-semibold">{f.q}</span>
                  <ChevronDown className={`h-5 w-5 shrink-0 text-primary transition ${open === i ? "rotate-180" : ""}`} />
                </button>
                <motion.div
                  initial={false}
                  animate={{ height: open === i ? "auto" : 0, opacity: open === i ? 1 : 0 }}
                  transition={{ duration: 0.3, ease: "easeInOut" }}
                  className="overflow-hidden"
                >
                  <div className="px-6 pb-5 text-muted-foreground">{f.a}</div>
                </motion.div>
              </div>
            </Reveal>
          ))}
        </div>
      </div>
    </section>
  );
}

function CTAFinal() {
  return (
    <section id="cta" className="py-24">
      <div className="mx-auto max-w-6xl px-6">
        <Reveal>
          <div className="relative overflow-hidden rounded-3xl bg-gradient-dark p-12 text-center text-secondary-foreground shadow-elevated md:p-20">
            <motion.div
              animate={{ scale: [1, 1.2, 1], opacity: [0.3, 0.5, 0.3] }}
              transition={{ duration: 6, repeat: Infinity, ease: "easeInOut" }}
              className="absolute -right-20 -top-20 h-72 w-72 rounded-full bg-gradient-primary blur-3xl"
            />
            <motion.div
              animate={{ scale: [1, 1.3, 1], opacity: [0.2, 0.4, 0.2] }}
              transition={{ duration: 8, repeat: Infinity, ease: "easeInOut", delay: 1 }}
              className="absolute -bottom-20 -left-20 h-72 w-72 rounded-full bg-gradient-warm blur-3xl"
            />
            <div className="relative">
              <motion.div
                animate={{ y: [0, -8, 0] }}
                transition={{ duration: 2.4, repeat: Infinity, ease: "easeInOut" }}
              >
                <Flame className="mx-auto h-12 w-12 text-highlight" />
              </motion.div>
              <h2 className="mt-6 font-display text-4xl sm:text-6xl">Pronto para revolucionar seu negócio?</h2>
              <p className="mx-auto mt-4 max-w-xl text-lg text-white/70">
                Sem cartão de crédito. 30 dias grátis. Configuração em menos de 20 minutos.
              </p>
              <div className="mt-10 flex flex-wrap justify-center gap-4">
                <motion.a
                  href="#"
                  whileHover={{ scale: 1.05 }}
                  animate={{ boxShadow: ["0 20px 60px -20px oklch(0.68 0.22 38 / 0.5)", "0 20px 80px -10px oklch(0.68 0.22 38 / 0.8)", "0 20px 60px -20px oklch(0.68 0.22 38 / 0.5)"] }}
                  transition={{ boxShadow: { duration: 2.5, repeat: Infinity, ease: "easeInOut" } }}
                  className="inline-flex items-center gap-2 rounded-full bg-gradient-primary px-8 py-4 text-base font-semibold text-primary-foreground"
                >
                  Começar Gratuitamente <ArrowRight className="h-5 w-5" />
                </motion.a>
                <a href="#" className="inline-flex items-center gap-2 rounded-full border border-white/30 bg-white/5 px-8 py-4 text-base font-semibold backdrop-blur transition hover:bg-white/10">
                  Agendar Demo
                </a>
              </div>
            </div>
          </div>
        </Reveal>
      </div>
    </section>
  );
}

function Footer() {
  return (
    <footer className="border-t border-border bg-background py-12">
      <div className="mx-auto grid max-w-7xl gap-8 px-6 md:grid-cols-4">
        <div className="md:col-span-2">
          <div className="flex items-center gap-2">
            <span className="grid h-9 w-9 place-items-center rounded-xl bg-gradient-primary text-primary-foreground">
              <Flame className="h-5 w-5" />
            </span>
            <span className="font-display text-2xl">BURGUER HUB</span>
          </div>
          <p className="mt-4 max-w-sm text-sm text-muted-foreground">
            O sistema completo de gestão para hamburguerias modernas.
          </p>
          <div className="mt-6 flex gap-3">
            {[Instagram, Linkedin, Phone].map((Icon, i) => (
              <a key={i} href="#" className="grid h-10 w-10 place-items-center rounded-full border border-border transition hover:bg-muted">
                <Icon className="h-4 w-4" />
              </a>
            ))}
          </div>
        </div>
        <div>
          <h4 className="font-display text-lg">Navegação</h4>
          <ul className="mt-4 space-y-2 text-sm text-muted-foreground">
            {nav.map((n) => <li key={n.href}><a href={n.href} className="hover:text-foreground">{n.label}</a></li>)}
          </ul>
        </div>
        <div>
          <h4 className="font-display text-lg">Legal</h4>
          <ul className="mt-4 space-y-2 text-sm text-muted-foreground">
            <li><a href="#" className="hover:text-foreground">Termos de uso</a></li>
            <li><a href="#" className="hover:text-foreground">Privacidade</a></li>
            <li><a href="#" className="hover:text-foreground">Contato</a></li>
          </ul>
        </div>
      </div>
      <div className="mx-auto mt-10 max-w-7xl border-t border-border px-6 pt-6 text-center text-xs text-muted-foreground">
        © {new Date().getFullYear()} Burguer Hub. Todos os direitos reservados.
      </div>
    </footer>
  );
}
