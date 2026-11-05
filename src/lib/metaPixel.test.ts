import { beforeEach, describe, expect, it, vi } from "vitest";
import { destinoComParametros } from "@/pages/LandingPage";
import { diasRestantesTeste, linkAssinar, whatsappValido } from "./assinatura";
import {
  idPixelPara,
  PIXEL_PRODUCAO,
  registrarEventoUnico,
  registrarPagina,
  reiniciarPixelParaTeste,
  rotaSemPixel,
} from "./metaPixel";
import { capturarOrigem, lerOrigem, utmsParaStripe } from "./origemAnuncio";

const chamadas = () => (window.fbq?.queue ?? []).map((c) => Array.from(c as unknown as unknown[]));
const eventos = () => chamadas().filter((c) => c[0] === "track").map((c) => c[1]);

beforeEach(() => {
  localStorage.clear();
  document.head.querySelectorAll("script[src*='fbevents']").forEach((s) => s.remove());
  reiniciarPixelParaTeste();
  vi.stubEnv("VITE_META_PIXEL_ID", "123456789012345");
});

describe("rotas com pixel", () => {
  it.each(["/", "/lp", "/cardapio", "/minha-loja/cardapio", "/pedido/abc"])("%s fica sem pixel", (rota) => {
    expect(rotaSemPixel(rota)).toBe(true);
  });

  it.each(["/auth", "/mesas", "/admin/cardapio", "/privacidade"])("%s tem pixel", (rota) => {
    expect(rotaSemPixel(rota)).toBe(false);
  });
});

describe("qual pixel carregar", () => {
  it("em produção usa o pixel do Easy Food Hub", () => {
    expect(idPixelPara("www.easyfoodhub.com.br", "")).toBe(PIXEL_PRODUCAO);
    expect(idPixelPara("easyfoodhub.com.br", "")).toBe(PIXEL_PRODUCAO);
  });

  it("fora de produção não carrega, a menos que o ambiente peça", () => {
    expect(idPixelPara("localhost", "")).toBe("");
    expect(idPixelPara("burguer-hub-abc.vercel.app", "")).toBe("");
    expect(idPixelPara("easyfoodhub.com.br.golpe.com", "")).toBe("");
    expect(idPixelPara("localhost", "111")).toBe("111");
  });
});

describe("pixel", () => {
  it("sem id não carrega nada", () => {
    vi.stubEnv("VITE_META_PIXEL_ID", "");
    registrarPagina("/auth");
    registrarEventoUnico("StartTrial", "conta");
    expect(window.fbq).toBeUndefined();
    expect(document.head.querySelector("script[src*='fbevents']")).toBeNull();
  });

  it("desliga a captura automática antes de iniciar", () => {
    registrarPagina("/auth");
    expect(chamadas()[0]).toEqual(["set", "autoConfig", false, "123456789012345"]);
    expect(chamadas()[1]).toEqual(["init", "123456789012345"]);
  });

  it("carrega o script uma vez só, mesmo com vários eventos", () => {
    registrarPagina("/auth");
    registrarPagina("/mesas");
    registrarEventoUnico("StartTrial", "conta");
    expect(document.head.querySelectorAll("script[src*='fbevents']")).toHaveLength(1);
  });

  it("conta a visita uma vez por página", () => {
    registrarPagina("/auth");
    registrarPagina("/auth");
    registrarPagina("/mesas");
    expect(eventos()).toEqual(["PageView", "PageView"]);
  });

  it("não conta visita no cardápio do restaurante", () => {
    registrarPagina("/minha-loja/cardapio");
    expect(window.fbq).toBeUndefined();
  });

  it("evento de conversão conta uma vez por conta, mesmo depois de recarregar", () => {
    registrarEventoUnico("Subscribe", "conta-1", { value: 199, currency: "BRL" });
    registrarEventoUnico("Subscribe", "conta-1", { value: 199, currency: "BRL" });
    expect(eventos()).toEqual(["Subscribe"]);

    reiniciarPixelParaTeste();
    registrarEventoUnico("Subscribe", "conta-1", { value: 199, currency: "BRL" });
    expect(window.fbq).toBeUndefined();

    registrarEventoUnico("Subscribe", "conta-2", { value: 199, currency: "BRL" });
    expect(eventos()).toEqual(["Subscribe"]);
  });

  it("nenhum evento leva dado pessoal", () => {
    registrarEventoUnico("CompleteRegistration", "conta");
    registrarEventoUnico("StartTrial", "conta");
    registrarEventoUnico("Subscribe", "conta", { value: 199, currency: "BRL" });
    expect(JSON.stringify(chamadas())).not.toMatch(/@|conta"/);
  });
});

describe("origem do anúncio", () => {
  it("guarda só os parâmetros conhecidos", () => {
    capturarOrigem("?utm_source=meta&utm_content=video1&fbclid=abc&email=a@b.com");
    expect(lerOrigem()).toEqual({ utm_source: "meta", utm_content: "video1", fbclid: "abc" });
  });

  it("URL sem parâmetros não apaga a origem", () => {
    capturarOrigem("?utm_source=meta");
    capturarOrigem("");
    expect(lerOrigem()).toEqual({ utm_source: "meta" });
  });

  it("anúncio novo substitui o anterior", () => {
    capturarOrigem("?utm_source=meta&utm_content=video1");
    capturarOrigem("?utm_source=google");
    expect(lerOrigem()).toEqual({ utm_source: "google" });
  });

  it("origem antiga expira", () => {
    localStorage.setItem("efh_origem", JSON.stringify({ utm_source: "meta", capturado_em: Date.now() - 31 * 86_400_000 }));
    expect(lerOrigem()).toEqual({});
  });

  it("não quebra com valor corrompido", () => {
    localStorage.setItem("efh_origem", "{");
    expect(lerOrigem()).toEqual({});
  });

  it("só repassa à Stripe UTM com caracteres aceitos, nunca o fbclid", () => {
    expect(utmsParaStripe({ utm_source: "meta", utm_campaign: "com espaço", fbclid: "abc" })).toEqual([["utm_source", "meta"]]);
  });
});

describe("link de assinatura", () => {
  it("identifica a conta sem colocar o e-mail na URL", () => {
    const url = new URL(linkAssinar({ id: "conta-1" }, { utm_source: "meta" }));
    expect(url.searchParams.get("client_reference_id")).toBe("conta-1");
    expect(url.searchParams.get("utm_source")).toBe("meta");
    expect(url.searchParams.has("prefilled_email")).toBe(false);
  });

  it("sem conta leva ao WhatsApp", () => {
    expect(linkAssinar(null)).toContain("wa.me");
  });
});

describe("teste grátis na tela", () => {
  const agora = Date.parse("2026-11-05T12:00:00Z");

  it("conta os dias para cima", () => {
    expect(diasRestantesTeste("2026-11-12T12:00:00Z", agora)).toBe(7);
    expect(diasRestantesTeste("2026-11-05T13:00:00Z", agora)).toBe(1);
  });

  it("vencido ou sem data dá zero", () => {
    expect(diasRestantesTeste("2026-11-05T11:00:00Z", agora)).toBe(0);
    expect(diasRestantesTeste(null, agora)).toBe(0);
  });
});

describe("WhatsApp do cadastro", () => {
  it("aceita com máscara e DDI, e devolve só dígitos", () => {
    expect(whatsappValido("(74) 99999-0000")).toBe("74999990000");
    expect(whatsappValido("+55 74 99999-0000")).toBe("74999990000");
  });

  it("recusa sem DDD", () => {
    expect(whatsappValido("99999-0000")).toBeNull();
    expect(whatsappValido("")).toBeNull();
  });
});

describe("redirecionamento da raiz", () => {
  it("mantém UTMs e fbclid", () => {
    expect(destinoComParametros("/sistema-para-restaurante", "?utm_source=meta&fbclid=abc", "#planos")).toBe(
      "/sistema-para-restaurante?utm_source=meta&fbclid=abc#planos",
    );
  });
});
