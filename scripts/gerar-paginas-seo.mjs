// Gera as páginas públicas de busca em public/<slug>/index.html e o public/sitemap.xml.
// São HTML puro (sem React): o Google lê o texto direto, sem precisar rodar JavaScript.
// Uso: node scripts/gerar-paginas-seo.mjs

import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { SITE, WHATSAPP, paginas } from "./seo/paginas.mjs";

const raiz = join(dirname(fileURLToPath(import.meta.url)), "..");
const publico = join(raiz, "public");
const hoje = new Date().toISOString().slice(0, 10);

const esc = (s) =>
  String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const linkWhats = (texto) => `https://wa.me/${WHATSAPP}?text=${encodeURIComponent(texto)}`;
const url = (p) => `${SITE}/${p.slug}`;

const ICONE = `<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" aria-hidden="true"><path d="M4 7h16M4 12h16M4 17h10"/></svg>`;
const ICONE_WHATS = `<svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor" aria-hidden="true"><path d="M12 2a10 10 0 0 0-8.6 15.1L2 22l5-1.3A10 10 0 1 0 12 2Zm0 18.2a8.2 8.2 0 0 1-4.2-1.2l-.3-.2-3 .8.8-2.9-.2-.3A8.2 8.2 0 1 1 12 20.2Zm4.5-6.1c-.2-.1-1.5-.7-1.7-.8s-.4-.1-.6.1-.7.8-.8 1-.3.2-.5.1a6.7 6.7 0 0 1-3.3-2.9c-.3-.4.2-.4.7-1.3a.4.4 0 0 0 0-.4l-.8-1.8c-.2-.5-.4-.4-.6-.4h-.5a1 1 0 0 0-.7.3 3 3 0 0 0-.9 2.2 5.2 5.2 0 0 0 1.1 2.8 11.9 11.9 0 0 0 4.6 4c1.7.7 2.3.8 3.2.7a2.7 2.7 0 0 0 1.8-1.3 2.2 2.2 0 0 0 .2-1.3c-.1-.1-.3-.2-.5-.3Z"/></svg>`;

const CSS = `
:root{--laranja:#ff5a1f;--laranja-escuro:#e14a12;--tinta:#0f172a;--texto:#334155;--suave:#64748b;--linha:#e2e8f0;--fundo:#ffffff;--creme:#fff6f1;--card:#ffffff}
*{box-sizing:border-box}html{-webkit-text-size-adjust:100%}
body{margin:0;font-family:Inter,system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;color:var(--texto);background:var(--fundo);line-height:1.6;font-size:17px}
a{color:inherit}img{max-width:100%}
.c{max-width:1120px;margin:0 auto;padding:0 20px}
header{position:sticky;top:0;z-index:10;background:rgba(255,255,255,.92);backdrop-filter:blur(8px);border-bottom:1px solid var(--linha)}
.top{display:flex;align-items:center;justify-content:space-between;height:64px;gap:12px}
.marca{display:flex;align-items:center;gap:10px;font-weight:800;color:var(--tinta);text-decoration:none;font-size:18px;white-space:nowrap}
.marca i{display:grid;place-items:center;width:34px;height:34px;border-radius:10px;background:var(--laranja);color:#fff}
nav{display:flex;align-items:center;gap:18px;font-size:15px}
nav a{text-decoration:none;color:var(--texto)}nav a:hover{color:var(--tinta)}
.so-largo{display:none}
@media(min-width:760px){.so-largo{display:inline}}
.btn{white-space:nowrap;display:inline-flex;align-items:center;justify-content:center;gap:8px;padding:13px 22px;border-radius:12px;font-weight:700;text-decoration:none;font-size:16px;border:2px solid transparent;transition:background .15s,transform .15s}
.btn:hover{transform:translateY(-1px)}
.btn-p{background:var(--laranja);color:#fff}.btn-p:hover{background:var(--laranja-escuro)}
.btn-s{border-color:var(--linha);color:var(--tinta);background:#fff}
.btn-peq{padding:9px 14px;font-size:14px;border-radius:10px}
.hero{background:linear-gradient(180deg,var(--creme),#fff);padding:56px 0 64px}
.hero .c{display:grid;gap:40px;align-items:center}
@media(min-width:900px){.hero .c{grid-template-columns:1.1fr .9fr}}
.selo{display:inline-block;background:#ffe7dc;color:var(--laranja-escuro);font-weight:700;font-size:13px;padding:6px 12px;border-radius:99px;margin-bottom:16px}
h1{font-size:clamp(30px,5vw,48px);line-height:1.12;color:var(--tinta);margin:0 0 18px;letter-spacing:-.02em}
h2{font-size:clamp(25px,3.6vw,34px);line-height:1.2;color:var(--tinta);margin:0 0 14px;letter-spacing:-.01em}
h3{font-size:18px;color:var(--tinta);margin:0 0 6px}
.lead{font-size:19px;margin:0 0 28px;max-width:600px}
.acoes{display:flex;flex-wrap:wrap;gap:12px}
.nota{font-size:14px;color:var(--suave);margin-top:14px}
.painel{background:var(--tinta);border-radius:20px;padding:18px;box-shadow:0 30px 60px -20px rgba(15,23,42,.35);color:#e2e8f0;font-size:14px}
.painel .barra{display:flex;gap:6px;margin-bottom:14px}.painel .barra span{width:10px;height:10px;border-radius:50%;background:#334155}
.ped{background:#1e293b;border-radius:12px;padding:12px 14px;margin-top:10px;display:flex;justify-content:space-between;gap:10px;align-items:flex-start}
.ped b{color:#fff;display:block}.ped small{color:#94a3b8}
.tag{font-size:12px;font-weight:700;padding:3px 9px;border-radius:99px;white-space:nowrap}
.t1{background:#fde68a;color:#78350f}.t2{background:#bbf7d0;color:#14532d}.t3{background:#ffd5c2;color:#9a3412}
section{padding:64px 0}
.cinza{background:#f8fafc}
.intro{max-width:720px;margin-bottom:32px}
.dores{display:grid;gap:12px;grid-template-columns:repeat(auto-fit,minmax(260px,1fr));list-style:none;padding:0;margin:0}
.dores li{background:#fff;border:1px solid var(--linha);border-radius:14px;padding:16px 18px 16px 46px;position:relative}
.dores li:before{content:"✕";position:absolute;left:18px;top:15px;color:#dc2626;font-weight:800}
.grade{display:grid;gap:16px;grid-template-columns:repeat(auto-fit,minmax(240px,1fr))}
.rec{background:var(--card);border:1px solid var(--linha);border-radius:16px;padding:22px}
.rec p{margin:0;font-size:15.5px}
.rec .ic{display:grid;place-items:center;width:38px;height:38px;border-radius:10px;background:#ffe7dc;color:var(--laranja-escuro);font-weight:800;margin-bottom:12px}
.texto p{max-width:760px}
.passos{display:grid;gap:16px;grid-template-columns:repeat(auto-fit,minmax(240px,1fr));counter-reset:p}
.passo{border-left:3px solid var(--laranja);padding:4px 0 4px 18px}
.passo p{margin:0}
.whats{background:var(--tinta);color:#cbd5e1;border-radius:24px;padding:36px;display:grid;gap:24px}
.whats h2{color:#fff}
@media(min-width:860px){.whats{grid-template-columns:1.2fr .8fr;align-items:center}}
.fluxo{display:flex;flex-wrap:wrap;gap:8px;list-style:none;padding:0;margin:18px 0 0}
.fluxo li{background:#1e293b;color:#fff;border-radius:99px;padding:6px 12px;font-size:14px}
.bolhas{display:grid;gap:10px}
.b{max-width:85%;padding:10px 14px;border-radius:14px;font-size:15px}
.b1{background:#1e293b;color:#e2e8f0;justify-self:start}.b2{background:#16a34a;color:#fff;justify-self:end}
.nichos{display:grid;gap:12px;grid-template-columns:repeat(auto-fit,minmax(200px,1fr))}
.nichos a{display:flex;align-items:center;gap:10px;padding:16px;border:1px solid var(--linha);border-radius:14px;text-decoration:none;color:var(--tinta);font-weight:700;background:#fff}
.nichos a:hover{border-color:var(--laranja)}
.nichos a[aria-current]{border-color:var(--laranja);background:var(--creme)}
details{border:1px solid var(--linha);border-radius:14px;padding:0 18px;margin-bottom:10px;background:#fff}
summary{cursor:pointer;font-weight:700;color:var(--tinta);padding:16px 0;list-style:none;display:flex;justify-content:space-between;gap:12px}
summary::-webkit-details-marker{display:none}
summary:after{content:"+";color:var(--laranja);font-size:22px;line-height:1}
details[open] summary:after{content:"−"}
details p{margin:0 0 16px}
.final{background:var(--laranja);color:#fff;text-align:center;border-radius:24px;padding:48px 24px}
.final h2{color:#fff}.final p{max-width:560px;margin:0 auto 24px}
.final .btn-p{background:#fff;color:var(--laranja-escuro)}
footer{padding:40px 0;border-top:1px solid var(--linha);font-size:14px;color:var(--suave)}
footer .c{display:grid;gap:20px}
@media(min-width:760px){footer .c{grid-template-columns:1fr 1fr}}
footer ul{list-style:none;padding:0;margin:0;display:grid;gap:6px}
footer a{text-decoration:none}footer a:hover{color:var(--tinta)}
.flutuante{position:fixed;right:16px;bottom:16px;z-index:20;width:56px;height:56px;border-radius:50%;background:#16a34a;color:#fff;display:grid;place-items:center;box-shadow:0 10px 30px -8px rgba(0,0,0,.4)}
.flutuante svg{width:28px;height:28px}
`;

function jsonLd(p) {
  const grafo = [
    {
      "@type": "Organization",
      "@id": `${SITE}/#org`,
      name: "Easy Food Hub",
      url: `${SITE}/sistema-para-restaurante`,
      parentOrganization: { "@type": "Organization", name: "Easy System" },
      contactPoint: { "@type": "ContactPoint", telephone: `+${WHATSAPP}`, contactType: "sales", availableLanguage: "Portuguese" },
    },
    {
      "@type": "SoftwareApplication",
      name: "Easy Food Hub",
      applicationCategory: "BusinessApplication",
      operatingSystem: "Web, Android, iOS, Windows",
      description: p.descricao,
      url: url(p),
      publisher: { "@id": `${SITE}/#org` },
    },
    {
      "@type": "FAQPage",
      mainEntity: p.faq.map(([q, a]) => ({ "@type": "Question", name: q, acceptedAnswer: { "@type": "Answer", text: a } })),
    },
    {
      "@type": "BreadcrumbList",
      itemListElement: [
        { "@type": "ListItem", position: 1, name: "Easy Food Hub", item: `${SITE}/sistema-para-restaurante` },
        ...(p.principal ? [] : [{ "@type": "ListItem", position: 2, name: p.rotulo, item: url(p) }]),
      ],
    },
  ];
  return JSON.stringify({ "@context": "https://schema.org", "@graph": grafo }).replace(/</g, "\\u003c");
}

function pagina(p) {
  const whats = linkWhats(p.whatsTexto);
  const outras = paginas
    .map((o) => `<a href="/${o.slug}"${o.slug === p.slug ? ' aria-current="page"' : ""}><span aria-hidden="true">${o.emoji}</span>${esc(o.rotulo)}</a>`)
    .join("");
  return `<!doctype html>
<html lang="pt-BR">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(p.titulo)}</title>
<meta name="description" content="${esc(p.descricao)}">
<link rel="canonical" href="${url(p)}">
<meta name="robots" content="index, follow">
<meta name="theme-color" content="#ff5a1f">
<link rel="icon" type="image/svg+xml" href="/favicon.svg">
<meta property="og:type" content="website">
<meta property="og:locale" content="pt_BR">
<meta property="og:site_name" content="Easy Food Hub">
<meta property="og:url" content="${url(p)}">
<meta property="og:title" content="${esc(p.titulo)}">
<meta property="og:description" content="${esc(p.descricao)}">
<meta name="twitter:card" content="summary">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;600;700;800&display=swap" rel="stylesheet">
<style>${CSS.replace(/\n/g, "")}</style>
<script type="application/ld+json">${jsonLd(p)}</script>
</head>
<body>
<header><div class="c top">
  <a class="marca" href="/sistema-para-restaurante"><i>${ICONE}</i>Easy Food Hub</a>
  <nav>
    <a class="so-largo" href="#recursos">Recursos</a>
    <a class="so-largo" href="#duvidas">Dúvidas</a>
    <a href="/auth">Entrar</a>
    <a class="btn btn-p btn-peq" href="${whats}" target="_blank" rel="noopener"><span class="so-largo">Falar no&nbsp;</span>WhatsApp</a>
  </nav>
</div></header>

<main>
<section class="hero"><div class="c">
  <div>
    <span class="selo">${p.emoji} Easy Food Hub para ${esc(p.rotulo.toLowerCase())}</span>
    <h1>${esc(p.h1)}</h1>
    <p class="lead">${esc(p.sub)}</p>
    <div class="acoes">
      <a class="btn btn-p" href="${whats}" target="_blank" rel="noopener">${ICONE_WHATS}Quero conhecer</a>
      <a class="btn btn-s" href="#recursos">Ver os recursos</a>
    </div>
    <p class="nota">Funciona no navegador do computador, tablet ou celular. Implantação com ajuda da equipe.</p>
  </div>
  <div class="painel" aria-hidden="true">
    <div class="barra"><span></span><span></span><span></span></div>
    <strong style="color:#fff">Pedidos de hoje</strong>
    <div class="ped"><div><b>#128 · Delivery</b><small>2 itens · Pix pago · Centro</small></div><span class="tag t1">Em preparo</span></div>
    <div class="ped"><div><b>Mesa 4</b><small>5 itens · conta aberta</small></div><span class="tag t3">Consumindo</span></div>
    <div class="ped"><div><b>#127 · Retirada</b><small>1 item · dinheiro</small></div><span class="tag t2">Pronto</span></div>
    <div class="ped"><div><b>#126 · WhatsApp</b><small>3 itens · cartão na entrega</small></div><span class="tag t2">Saiu para entrega</span></div>
  </div>
</div></section>

<section class="cinza"><div class="c">
  <div class="intro">
    <h2>Isso acontece no seu negócio?</h2>
    <p>Se uma ou mais situações abaixo fazem parte da sua rotina, o problema não é falta de esforço. É falta de um sistema que junte tudo.</p>
  </div>
  <ul class="dores">${p.dores.map((d) => `<li>${esc(d)}</li>`).join("")}</ul>
</div></section>

<section id="recursos"><div class="c">
  <div class="intro">
    <h2>O que o Easy Food Hub faz ${esc(p.pelo)}</h2>
    <p>Os recursos que você usa no dia a dia, num sistema só.</p>
  </div>
  <div class="grade">${p.recursos
    .map(([t, d], i) => `<div class="rec"><div class="ic" aria-hidden="true">${i + 1}</div><h3>${esc(t)}</h3><p>${esc(d)}</p></div>`)
    .join("")}</div>
</div></section>

<section class="cinza texto"><div class="c">
  <h2>${esc(p.explicacao.titulo)}</h2>
  ${p.explicacao.paragrafos.map((t) => `<p>${esc(t)}</p>`).join("\n  ")}
</div></section>

<section><div class="c">
  <div class="whats">
    <div>
      <h2>Atendimento pelo WhatsApp mesmo no horário de pico</h2>
      <p>Um robô com IA, no número do seu próprio negócio, responde dúvidas sobre o cardápio e conduz o cliente até o pedido confirmado. Você continua podendo assumir a conversa quando quiser.</p>
      <ul class="fluxo"><li>Produto</li><li>Adicionais</li><li>Bebida</li><li>Pagamento</li><li>Endereço</li><li>Pedido confirmado</li></ul>
      <p class="nota" style="color:#94a3b8">A automação pelo WhatsApp pode depender do plano contratado.</p>
    </div>
    <div class="bolhas" aria-hidden="true">
      <div class="b b2">Oi! Quero fazer um pedido</div>
      <div class="b b1">Olá! Aqui está o nosso cardápio. O que vai ser hoje?</div>
      <div class="b b2">Um X-bacon sem cebola e uma Coca lata</div>
      <div class="b b1">Anotado! Vai ser entrega ou retirada?</div>
    </div>
  </div>
</div></section>

<section class="cinza"><div class="c">
  <div class="intro"><h2>Começar é simples</h2></div>
  <div class="passos">
    <div class="passo"><h3>1. Conversa com a equipe</h3><p>Você conta como funciona o seu negócio e tira as dúvidas pelo WhatsApp.</p></div>
    <div class="passo"><h3>2. Configuração</h3><p>Cadastramos juntos o cardápio, os adicionais, as mesas e as taxas de entrega.</p></div>
    <div class="passo"><h3>3. Pedidos no sistema</h3><p>Você divulga o link do cardápio e passa a receber e organizar os pedidos no Easy Food Hub.</p></div>
  </div>
</div></section>

<section id="duvidas"><div class="c">
  <div class="intro"><h2>Perguntas frequentes</h2></div>
  ${p.faq.map(([q, a]) => `<details><summary>${esc(q)}</summary><p>${esc(a)}</p></details>`).join("\n  ")}
</div></section>

<section class="cinza"><div class="c">
  <div class="intro"><h2>Easy Food Hub para cada tipo de negócio</h2><p>O mesmo sistema, ajustado ao jeito de trabalhar de cada operação de alimentação.</p></div>
  <nav class="nichos" aria-label="Tipos de negócio">${outras}</nav>
</div></section>

<section><div class="c">
  <div class="final">
    <h2>Vamos organizar ${esc(p.alvo)}?</h2>
    <p>Fale com a equipe do Easy Food Hub pelo WhatsApp e veja o sistema funcionando com o seu cardápio.</p>
    <a class="btn btn-p" href="${whats}" target="_blank" rel="noopener">${ICONE_WHATS}Falar no WhatsApp</a>
  </div>
</div></section>
</main>

<footer><div class="c">
  <div>
    <a class="marca" href="/sistema-para-restaurante"><i>${ICONE}</i>Easy Food Hub</a>
    <p>Sistema para restaurantes, hamburguerias, pizzarias, lanchonetes e delivery. Um produto da Easy System.</p>
    <p>© ${new Date().getFullYear()} Easy Food Hub</p>
  </div>
  <ul>
    ${paginas.map((o) => `<li><a href="/${o.slug}">${esc(o.titulo.split(" | ")[0])}</a></li>`).join("\n    ")}
    <li><a href="/auth">Entrar no sistema</a></li>
  </ul>
</div></footer>
<a class="flutuante" href="${whats}" target="_blank" rel="noopener" aria-label="Falar no WhatsApp">${ICONE_WHATS}</a>
</body>
</html>
`;
}

for (const p of paginas) {
  const destino = join(publico, p.slug, "index.html");
  mkdirSync(dirname(destino), { recursive: true });
  writeFileSync(destino, pagina(p));
  console.log(`public/${p.slug}/index.html`);
}

const sitemap = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${paginas.map((p) => `  <url><loc>${url(p)}</loc><lastmod>${hoje}</lastmod><priority>${p.principal ? "1.0" : "0.8"}</priority></url>`).join("\n")}
</urlset>
`;
writeFileSync(join(publico, "sitemap.xml"), sitemap);
console.log("public/sitemap.xml");
