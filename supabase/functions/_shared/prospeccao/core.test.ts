import { describe, expect, it } from "vitest";
import {
  type ConfigProspeccao,
  type EstabelecimentoBruto,
  type PedidoEnvio,
  type UsoHoje,
  INTENCOES,
  aberturaDe,
  autorizarEnvio,
  chavesDedup,
  cidadesBase,
  classificarErro,
  compararPreco,
  custoUsd,
  decidirExecucao,
  dentroDaAgenda,
  detectarRecusa,
  detectarSistema,
  efeitoDaIntencao,
  extrairValorMensal,
  inicioDoPeriodo,
  mensagemFollowup,
  mensagemReserva,
  mesclarProspect,
  normalizarTelefoneBR,
  prepararProspect,
  proximaBusca,
  proximaExecucao,
  proximaJanela,
  validarMensagem,
} from "./core.ts";

const cfg: ConfigProspeccao = {
  ativo: true,
  dias_semana: [1, 2, 3, 4, 5],
  hora_inicio: "09:00",
  hora_fim: "18:00",
  fuso: "America/Sao_Paulo",
  minutos_diarios: 120,
  meta_qualificados_dia: 20,
  meta_contatos_dia: 15,
  especialidades: ["hamburgueria", "pizzaria", "açaí"],
  estados: [],
  cidades: [],
  peso_anota_ai: 60,
  peso_sem_sistema: 40,
  pontuacao_minima: 45,
  limite_gasto_diario_usd: 3,
  limite_gasto_mensal_usd: 50,
  limite_buscas_web_dia: 60,
  limite_places_dia: 30,
  limite_respostas_ia_dia: 200,
  preco_mensal: 199,
  teste_gratis_dias: 0,
  bot_whatsapp: "consultar",
  link_site: "https://easyfoodhub.com.br/lp",
  link_demo: "",
  nome_remetente: "",
  responder_automatico: true,
};

// Segunda-feira, 26/10/2026, 10:00 em Brasília (13:00 UTC).
const SEG_10H = new Date("2026-10-26T13:00:00Z");

const anotaInstagram: EstabelecimentoBruto = {
  nome: "Smash do Bairro",
  categoria: "Hamburgueria artesanal",
  cidade: "Feira de Santana",
  uf: "ba",
  instagram: "https://www.instagram.com/smashdobairro/",
  telefone: "(75) 99812-3456",
  links: ["https://pedido.anota.ai/loja/smash-do-bairro", "https://wa.me/5575998123456"],
  sistema_observado: "anota_ai",
  evidencias: [{ tipo: "link", url: "https://www.instagram.com/smashdobairro/", trecho: "Peça pelo link 👇 pedido.anota.ai/loja/smash-do-bairro" }],
  sinais: { delivery: true, retirada: true, ativo_recente: true, seguidores: 4200 },
  fonte: "https://www.instagram.com/smashdobairro/",
};

const semSistema: EstabelecimentoBruto = {
  nome: "Pizzaria Dona Rosa",
  categoria: "pizzaria",
  cidade: "Vitória da Conquista",
  uf: "BA",
  instagram: "@pizzariadonarosa",
  telefone: "77 98877-1122",
  links: ["https://wa.me/5577988771122"],
  sistema_observado: "sem_sistema",
  evidencias: [{ tipo: "texto", url: "https://instagram.com/pizzariadonarosa", trecho: "Delivery: chama no zap (77) 98877-1122" }],
  sinais: { delivery: true, pedidos_whatsapp: true, ativo_recente: true },
};

const usoZerado: UsoHoje = { minutosHoje: 0, custoHojeUsd: 0, custoMesUsd: 0, buscasWebHoje: 0, qualificadosHoje: 0 };

describe("1. descoberta e cadastro", () => {
  it("transforma o achado da pesquisa em prospect qualificado, com dados normalizados", () => {
    const p = prepararProspect(semSistema, cfg, "A");
    expect(p.status).toBe("qualificado");
    expect(p.nome).toBe("Pizzaria Dona Rosa");
    expect(p.categoria).toBe("pizzaria");
    expect(p.uf).toBe("BA");
    expect(p.telefone).toBe("77988771122");
    expect(p.instagram).toBe("pizzariadonarosa");
    expect(p.publico).toBe("A");
    expect(p.pontuacao).toBeGreaterThanOrEqual(cfg.pontuacao_minima);
    expect(p.evidencias.length).toBeGreaterThan(0);
  });

  it("planeja buscas pelo Brasil inteiro, sem repetir as já feitas, incluindo o interior", () => {
    const feitas = new Set<string>();
    const cidades = new Set<string>();
    for (let i = 0; i < 400; i++) {
      const b = proximaBusca(cfg, feitas, [], i);
      expect(b).not.toBeNull();
      expect(feitas.has(b!.chave)).toBe(false);
      feitas.add(b!.chave);
      cidades.add(`${b!.cidade}-${b!.uf}`);
    }
    expect(cidades.size).toBeGreaterThan(50);
    expect(cidades.has("Feira de Santana-BA") || [...cidades].some((c) => !cidadesBase().slice(0, 27).some(([n, u]) => `${n}-${u}` === c))).toBe(true);
    const publicos = [...feitas].map((k) => k[0]);
    const b = publicos.filter((x) => x === "B").length;
    expect(b / publicos.length).toBeGreaterThan(0.45); // peso 60 x 40 favorece o Anota AI
  });

  it("respeita estados e cidades escolhidos no painel", () => {
    const soBa = proximaBusca({ ...cfg, estados: ["BA"] }, new Set(), [], 0);
    expect(soBa?.uf).toBe("BA");
    const cidade = proximaBusca({ ...cfg, cidades: ["Feira de Santana - BA"] }, new Set(), [], 0);
    expect(cidade?.cidade).toBe("Feira de Santana");
  });
});

describe("2. identificação do Anota AI", () => {
  it("link de cardápio no domínio anota.ai confirma com confiança alta", () => {
    const r = detectarSistema(anotaInstagram);
    expect(r.sistema).toBe("anota_ai");
    expect(r.confianca).toBe("alta");
    expect(r.evidencias[0].url).toContain("anota.ai");
  });

  it("menção explícita do próprio estabelecimento vale confiança média", () => {
    const r = detectarSistema({ ...semSistema, links: [], evidencias: [{ tipo: "texto", url: "https://instagram.com/x", trecho: "Agora com pedidos pelo Anota Aí!" }] });
    expect(r.sistema).toBe("anota_ai");
    expect(r.confianca).toBe("media");
  });

  it("ter cardápio digital ou a IA 'achar' que é Anota AI não basta", () => {
    const r = detectarSistema({ nome: "Lanche X", links: ["https://lanchex.com.br/cardapio"], sistema_observado: "anota_ai", evidencias: [] });
    expect(r.sistema).not.toBe("anota_ai");
    const home = detectarSistema({ nome: "Lanche Y", links: ["https://anota.ai/"], evidencias: [] });
    expect(home.sistema).not.toBe("anota_ai");
  });
});

describe("3. estabelecimento sem sistema aparente", () => {
  it("pedidos só pelo WhatsApp viram 'sem_sistema', nunca com confiança alta", () => {
    const r = detectarSistema(semSistema);
    expect(r.sistema).toBe("sem_sistema");
    expect(r.confianca).not.toBe("alta");
    expect(r.pedidosWhatsapp).toBe(true);
  });

  it("link de outra plataforma é concorrente; iFood sozinho não é sistema próprio", () => {
    expect(detectarSistema({ nome: "A", links: ["https://goomer.app/a"] }).sistema).toBe("concorrente");
    const ifood = detectarSistema({ nome: "B", links: ["https://www.ifood.com.br/delivery/x"], sinais: { pedidos_whatsapp: true }, instagram: "@b" });
    expect(ifood.sistema).toBe("sem_sistema");
    expect(ifood.marketplaces).toContain("iFood");
  });

  it("sem evidência nenhuma fica indeterminado", () => {
    expect(detectarSistema({ nome: "C" }).sistema).toBe("indeterminado");
  });
});

describe("4. exclusão de grandes redes", () => {
  it("desqualifica franquias conhecidas e quem tem indício de rede", () => {
    const bk = prepararProspect({ ...semSistema, nome: "Burger King Feira de Santana" }, cfg);
    expect(bk.status).toBe("desqualificado");
    expect(bk.motivo_desqualificacao).toBe("rede_ou_franquia");
    const rede = prepararProspect({ ...semSistema, nome: "Pizza da Esquina", sinais: { rede_ou_franquia: true } }, cfg);
    expect(rede.status).toBe("desqualificado");
  });

  it("não confunde negócio local com rede", () => {
    expect(prepararProspect({ ...semSistema, nome: "Lanchonete do Bob" }, cfg).status).toBe("qualificado");
  });
});

describe("5. deduplicação entre redes", () => {
  it("Instagram, Google Maps e Facebook do mesmo restaurante compartilham identificadores", () => {
    const insta = prepararProspect(semSistema, cfg, "A");
    const maps = prepararProspect(
      { nome: "Pizzaria Dona Rosa", cidade: "Vitória da Conquista", uf: "BA", telefone: "+55 (77) 98877-1122", site: "https://instagram.com/pizzariadonarosa", google_place_id: "ChIJabc" },
      cfg,
    );
    const face = prepararProspect({ nome: "Dona Rosa Pizzaria", cidade: "Vitória da Conquista", uf: "BA", facebook: "https://www.facebook.com/donarosapizzas", instagram: "pizzariadonarosa" }, cfg);
    const k = (p: typeof insta) => new Set(chavesDedup(p).map((c) => `${c.tipo}:${c.valor}`));
    const ki = k(insta);
    expect([...k(maps)].some((x) => ki.has(x))).toBe(true);
    expect([...k(face)].some((x) => ki.has(x))).toBe(true);
  });

  it("normaliza telefones em formatos diferentes para a mesma chave", () => {
    expect(normalizarTelefoneBR("+55 (75) 99812-3456")).toBe("75998123456");
    expect(normalizarTelefoneBR("075 9812-3456")).toBe("75998123456");
    expect(normalizarTelefoneBR("(75) 3221-0000")).toBe("7532210000");
    expect(normalizarTelefoneBR("123")).toBeNull();
  });

  it("mescla completa lacunas e soma evidências sem duplicar", () => {
    const a = prepararProspect({ nome: "Pizzaria Dona Rosa", cidade: "Vitória da Conquista", uf: "BA", instagram: "@pizzariadonarosa", sinais: { delivery: true } }, cfg);
    const b = prepararProspect(semSistema, cfg, "A");
    const m = mesclarProspect({ ...a, bloqueado: false }, b, cfg);
    expect(m.telefone).toBe("77988771122");
    expect(m.sistema).toBe("sem_sistema");
    expect(m.status).toBe("qualificado");
    const deNovo = mesclarProspect({ ...m, bloqueado: false }, b, cfg);
    expect(deNovo.evidencias.length).toBe(m.evidencias.length);
  });
});

describe("6. mensagens personalizadas", () => {
  const ctx = (sistema: "anota_ai" | "sem_sistema", confianca: "alta" | "media" = "alta") => ({
    tipo: "primeiro_contato" as const,
    sistema,
    sistemaConfianca: confianca,
    precoMensal: 199,
    testeGratisDias: 0,
  });

  it("modelos de reserva passam nas regras e usam dados reais", () => {
    const anota = prepararProspect(anotaInstagram, cfg, "B");
    const sem = prepararProspect(semSistema, cfg, "A");
    const aberturas = new Set<string>();
    for (const semente of ["a", "b", "c", "d", "e", "f"]) {
      const m1 = mensagemReserva(anota, cfg, semente);
      const v1 = validarMensagem(m1, ctx("anota_ai"));
      expect(v1.problemas).toEqual([]);
      expect(m1).toMatch(/Easy Food Hub/);
      const m2 = mensagemReserva(sem, cfg, semente);
      expect(validarMensagem(m2, ctx("sem_sistema")).problemas).toEqual([]);
      expect(m2).not.toMatch(/anota/i);
      aberturas.add(aberturaDe(m2));
    }
    expect(aberturas.size).toBeGreaterThan(1);
  });

  it("remove travessões e barra o que as regras proíbem", () => {
    expect(validarMensagem("Oi — tudo bem? Sou do Easy Food Hub – posso ajudar?", ctx("sem_sistema")).texto).not.toMatch(/[—–]/);
    const casos: [string, string][] = [
      ["Oi! Fiz um pedido aí ontem. Aqui é do Easy Food Hub.", "finge que fez pedido"],
      ["Oi! Seu cardápio é incrível! Aqui é do Easy Food Hub.", "elogio artificial"],
      ["Oi, vi que vocês usam o Anota AI. Aqui é do Easy Food Hub.", "cita Anota AI sem evidência de uso"],
      ["Oi! Easy Food Hub por R$ 99 por mês.", "valor não confirmado (R$ 99)"],
      ["Oi! Easy Food Hub com 30 dias grátis.", "oferece teste grátis não configurado"],
      ["Oi! Com o Easy Food Hub você vai aumentar suas vendas em 40%.", "promete resultado"],
      ["Oi, tudo bem? Queria apresentar um sistema de pedidos.", "não se identifica como Easy Food Hub"],
    ];
    for (const [texto, problema] of casos) {
      expect(validarMensagem(texto, ctx("sem_sistema")).problemas).toContain(problema);
    }
    expect(validarMensagem("Oi! Easy Food Hub por R$ 199 por mês.", ctx("sem_sistema")).ok).toBe(true);
    expect(validarMensagem("Oi! Easy Food Hub com 30 dias grátis.", { ...ctx("sem_sistema"), testeGratisDias: 30 }).ok).toBe(true);
  });

  it("follow-up também respeita as regras", () => {
    expect(validarMensagem(mensagemFollowup("x"), { ...ctx("sem_sistema"), tipo: "followup" }).ok).toBe(true);
  });
});

describe("7. comparação de preços", () => {
  it("só compara com valor informado e calcula a diferença certa", () => {
    expect(extrairValorMensal("hoje pago 289,90 por mês no anota")).toBe(289.9);
    expect(extrairValorMensal("a mensalidade é 249")).toBe(249);
    expect(extrairValorMensal("tenho 3 lojas")).toBeNull();
    const c = compararPreco(289.9, 199)!;
    expect(c.maisBarato).toBe(true);
    expect(c.diferencaMensal).toBe(90.9);
    expect(c.diferencaAnual).toBe(1090.8);
    expect(compararPreco(150, 199)!.maisBarato).toBe(false);
    expect(compararPreco(null, 199)).toBeNull();
  });

  it("a resposta só pode citar valores confirmados ou calculados", () => {
    const c = compararPreco(289.9, 199)!;
    const ctx = { tipo: "resposta" as const, sistema: "anota_ai" as const, sistemaConfianca: "alta" as const, precoMensal: 199, testeGratisDias: 0 };
    const permitidos = [c.valorConcorrente, c.diferencaMensal, c.diferencaAnual];
    expect(validarMensagem("Nosso plano é R$ 199 por mês, R$ 90,90 a menos que os R$ 289,90 de hoje (R$ 1.090,80 por ano).", { ...ctx, valoresPermitidos: permitidos }).ok).toBe(true);
    expect(validarMensagem("Você economiza R$ 150 por mês.", { ...ctx, valoresPermitidos: permitidos }).ok).toBe(false);
  });
});

describe("8. respostas e objeções", () => {
  it("detecta recusas sem depender da IA", () => {
    expect(detectarRecusa("Não tenho interesse")).toBe("sem_interesse");
    expect(detectarRecusa("não, obrigado")).toBe("sem_interesse");
    expect(detectarRecusa("Para de me mandar mensagem")).toBe("nao_contatar");
    expect(detectarRecusa("me tira dessa lista")).toBe("nao_contatar");
    expect(detectarRecusa("quanto custa?")).toBeNull();
    expect(detectarRecusa("não tenho sistema, uso só o zap")).toBeNull();
  });

  it("cada intenção leva ao status e à próxima ação certos", () => {
    expect(INTENCOES).toHaveLength(11);
    expect(efeitoDaIntencao("quer_demonstracao", "respondeu")).toMatchObject({ status: "demonstracao", humano: true, interesse: "alto" });
    expect(efeitoDaIntencao("pediu_link", "respondeu")).toMatchObject({ status: "interessado", humano: false });
    expect(efeitoDaIntencao("pergunta_preco", "contatado").status).toBe("interessado");
    expect(efeitoDaIntencao("objecao_preco", "interessado").status).toBe("respondeu");
    expect(efeitoDaIntencao("usa_outro_sistema", "respondeu").proximaAcao).toMatch(/Comparar/);
    expect(efeitoDaIntencao("precisa_humano", "respondeu").humano).toBe(true);
    expect(efeitoDaIntencao("ambigua", "respondeu").humano).toBe(false);
    expect(efeitoDaIntencao("sem_interesse", "interessado")).toMatchObject({ status: "sem_interesse", bloquear: true });
    expect(efeitoDaIntencao("nao_contatar", "respondeu")).toMatchObject({ status: "nao_contatar", bloquear: true });
    expect(efeitoDaIntencao("pergunta_funcionalidade", "cliente").status).toBe("cliente");
  });
});

const pedido = (over: Partial<PedidoEnvio> = {}, prospect: Partial<PedidoEnvio["prospect"]> = {}): PedidoEnvio => ({
  origem: "operador",
  tipo: "primeiro_contato",
  prospect: { status: "qualificado", bloqueado: false, telefone: "77988771122", atendimento_humano: false, contatado_em: null, followups: 0, ...prospect },
  ultimaEntradaEm: null,
  contatosHoje: 0,
  respostasIaHoje: 0,
  cfg,
  agora: SEG_10H,
  ...over,
});

describe("9. bloqueio após recusa", () => {
  it("ninguém contata de novo quem recusou ou pediu para parar", () => {
    for (const status of ["sem_interesse", "nao_contatar"] as const) {
      expect(autorizarEnvio(pedido({}, { status, bloqueado: true })).ok).toBe(false);
      expect(autorizarEnvio(pedido({ tipo: "followup" }, { status, bloqueado: true, contatado_em: "2026-10-01" })).ok).toBe(false);
      expect(autorizarEnvio(pedido({ origem: "agente", tipo: "resposta", ultimaEntradaEm: SEG_10H.toISOString() }, { status, bloqueado: true })).ok).toBe(false);
    }
  });

  it("redescobrir o estabelecimento em outra rede não destrava o bloqueio", () => {
    const recusou = { ...prepararProspect(semSistema, cfg, "A"), status: "sem_interesse" as const, bloqueado: true };
    const achadoDeNovo = prepararProspect({ ...semSistema, links: ["https://pedido.anota.ai/loja/dona-rosa"] }, cfg, "B");
    expect(mesclarProspect(recusou, achadoDeNovo, cfg).status).toBe("sem_interesse");
  });
});

describe("10. horários programados", () => {
  it("só trabalha nos dias e horas configurados, no fuso configurado", () => {
    expect(dentroDaAgenda(cfg, SEG_10H)).toBe(true);
    expect(dentroDaAgenda(cfg, new Date("2026-10-26T11:30:00Z"))).toBe(false); // 08:30 em Brasília
    expect(dentroDaAgenda(cfg, new Date("2026-10-26T21:00:00Z"))).toBe(false); // 18:00, fim exclusivo
    expect(dentroDaAgenda(cfg, new Date("2026-10-25T13:00:00Z"))).toBe(false); // domingo
    expect(dentroDaAgenda({ ...cfg, fuso: "America/Manaus" }, new Date("2026-10-26T12:30:00Z"))).toBe(false); // 08:30 em Manaus
  });

  it("explica por que não executou e quando volta", () => {
    expect(decidirExecucao({ ...cfg, ativo: false }, SEG_10H, usoZerado)).toEqual({ executar: false, motivo: "pausado" });
    expect(decidirExecucao(cfg, new Date("2026-10-25T13:00:00Z"), usoZerado)).toEqual({ executar: false, motivo: "fora_da_agenda" });
    expect(decidirExecucao(cfg, SEG_10H, { ...usoZerado, minutosHoje: 120 })).toMatchObject({ motivo: "tempo_diario_esgotado" });
    expect(decidirExecucao(cfg, SEG_10H, { ...usoZerado, qualificadosHoje: 20 })).toMatchObject({ motivo: "meta_qualificados_atingida" });
    expect(decidirExecucao(cfg, SEG_10H, { ...usoZerado, custoHojeUsd: 3 })).toMatchObject({ motivo: "limite_gasto_diario" });
    expect(decidirExecucao(cfg, SEG_10H, usoZerado)).toEqual({ executar: true });
    // "Executar agora" ignora a agenda, mas não os limites de gasto.
    expect(decidirExecucao({ ...cfg, ativo: false }, new Date("2026-10-25T13:00:00Z"), usoZerado, { manual: true })).toEqual({ executar: true });
    expect(decidirExecucao(cfg, SEG_10H, { ...usoZerado, custoMesUsd: 50 }, { manual: true })).toMatchObject({ motivo: "limite_gasto_mensal" });

    const domingo = new Date("2026-10-25T15:00:00Z");
    expect(proximaJanela(cfg, domingo)?.toISOString()).toBe("2026-10-26T12:00:00.000Z"); // segunda 09:00
    expect(proximaExecucao(cfg, "tempo_diario_esgotado", SEG_10H)?.toISOString()).toBe("2026-10-27T12:00:00.000Z");
    expect(proximaExecucao({ ...cfg, ativo: false }, "pausado", SEG_10H)).toBeNull();
  });

  it("calcula início do dia e do mês no fuso", () => {
    expect(inicioDoPeriodo(SEG_10H, "America/Sao_Paulo", "dia").toISOString()).toBe("2026-10-26T03:00:00.000Z");
    expect(inicioDoPeriodo(SEG_10H, "America/Sao_Paulo", "mes").toISOString()).toBe("2026-10-01T03:00:00.000Z");
  });
});

describe("12. erros de integração", () => {
  it("classifica falhas para registrar e avisar o operador", () => {
    expect(classificarErro(Object.assign(new Error("invalid x-api-key"), { status: 401 })).tipo).toBe("autenticacao");
    expect(classificarErro(new Error("Google Places HTTP 403: API key not valid")).tipo).toBe("autenticacao");
    expect(classificarErro(Object.assign(new Error("rate limit"), { status: 429 })).tipo).toBe("limite");
    expect(classificarErro(new Error("Evolution POST /message/sendText HTTP 502: bad gateway")).tipo).toBe("indisponivel");
    expect(classificarErro(new Error("ANTHROPIC_API_KEY não configurada")).tipo).toBe("configuracao");
  });

  it("estima custo com tokens, buscas e Places", () => {
    expect(custoUsd({ entrada: 1_000_000, saida: 100_000, buscasWeb: 5, places: 1 })).toBeCloseTo(4 + 2 + 0.05 + 0.04, 4);
  });
});

describe("13. bloqueio de envios não autorizados", () => {
  it("primeiro contato e follow-up só com o clique do operador", () => {
    expect(autorizarEnvio(pedido()).ok).toBe(true);
    expect(autorizarEnvio(pedido({ origem: "cron" })).ok).toBe(false);
    expect(autorizarEnvio(pedido({ origem: "agente" })).ok).toBe(false);
    expect(autorizarEnvio(pedido({ origem: "agente", tipo: "followup" }, { contatado_em: "2026-10-20" })).ok).toBe(false);
  });

  it("respeita limite diário, horário comercial, telefone válido e repetição", () => {
    expect(autorizarEnvio(pedido({ contatosHoje: 15 })).ok).toBe(false);
    expect(autorizarEnvio(pedido({ agora: new Date("2026-10-27T00:30:00Z") })).ok).toBe(false); // 21:30
    expect(autorizarEnvio(pedido({}, { telefone: "7532210000" })).ok).toBe(false); // fixo, sem WhatsApp
    expect(autorizarEnvio(pedido({}, { contatado_em: "2026-10-20" })).ok).toBe(false);
    expect(autorizarEnvio(pedido({ tipo: "followup" }, { contatado_em: "2026-10-20", followups: 1 })).ok).toBe(false);
  });

  it("a IA só responde dentro de uma conversa aberta pelo prospect", () => {
    const resposta = (over: Partial<PedidoEnvio> = {}, pr: Partial<PedidoEnvio["prospect"]> = {}) =>
      autorizarEnvio(pedido({ origem: "agente", tipo: "resposta", ultimaEntradaEm: SEG_10H.toISOString(), ...over }, { status: "respondeu", contatado_em: "2026-10-20", ...pr }));
    expect(resposta().ok).toBe(true);
    expect(resposta({ ultimaEntradaEm: null }).ok).toBe(false);
    expect(resposta({ ultimaEntradaEm: "2026-10-24T10:00:00Z" }).ok).toBe(false);
    expect(resposta({}, { atendimento_humano: true }).ok).toBe(false);
    expect(resposta({ cfg: { ...cfg, responder_automatico: false } }).ok).toBe(false);
    expect(resposta({ respostasIaHoje: 200 }).ok).toBe(false);
  });
});
