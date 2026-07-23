import type { CarrosselSlide, Configuracao } from "@/types/db";
import type { Promocao } from "@/lib/promocoes/types";

export function normalizeCarrosselSlide(raw: unknown): CarrosselSlide | null {
  if (typeof raw === "string") {
    const url = raw.trim();
    return url ? { url, produto_id: null, promocao_id: null } : null;
  }
  if (!raw || typeof raw !== "object") return null;
  const obj = raw as Record<string, unknown>;
  const url = typeof obj.url === "string" ? obj.url.trim() : "";
  if (!url) return null;
  return {
    url,
    produto_id: typeof obj.produto_id === "string" && obj.produto_id ? obj.produto_id : null,
    promocao_id: typeof obj.promocao_id === "string" && obj.promocao_id ? obj.promocao_id : null,
  };
}

/** Lê slides tipados; fallback para carrossel_imagens (legado). */
export function getCarrosselSlides(cfg: Pick<Configuracao, "carrossel_slides" | "carrossel_imagens"> | null | undefined): CarrosselSlide[] {
  if (!cfg) return [];

  const fromSlides = (cfg.carrossel_slides || [])
    .map(normalizeCarrosselSlide)
    .filter((s): s is CarrosselSlide => !!s);
  if (fromSlides.length > 0) return fromSlides;

  return (cfg.carrossel_imagens || [])
    .map(normalizeCarrosselSlide)
    .filter((s): s is CarrosselSlide => !!s);
}

export function slidesToUrls(slides: CarrosselSlide[]): string[] {
  return slides.map((s) => s.url).filter(Boolean);
}

export function slideIsClickable(slide: CarrosselSlide): boolean {
  return Boolean(slide.produto_id || slide.promocao_id);
}

/** Resolve produtos/quantidades a partir da ação da promoção. */
export function produtosDaPromocao(promo: Promocao): { produtoId: string; qtd: number }[] {
  const acao = promo.acao || {};

  if (acao.combo?.itens?.length) {
    return acao.combo.itens.map((item) => ({
      produtoId: item.produto_id,
      qtd: Math.max(1, Number(item.qtd) || 1),
    }));
  }

  if (acao.compre_x_leve_y?.produto_id) {
    return [
      {
        produtoId: acao.compre_x_leve_y.produto_id,
        qtd: Math.max(1, Number(acao.compre_x_leve_y.qtd_compra) || 1),
      },
    ];
  }

  if (acao.desconto_produto?.produto_ids?.length) {
    return acao.desconto_produto.produto_ids.map((id) => ({ produtoId: id, qtd: 1 }));
  }

  if (acao.leve_mais?.produto_ids?.length) {
    const minFaixa = Math.min(...(acao.leve_mais.faixas || []).map((f) => f.qtd).filter((n) => n > 0));
    const qtd = Number.isFinite(minFaixa) && minFaixa > 0 ? minFaixa : 1;
    return acao.leve_mais.produto_ids.map((id) => ({ produtoId: id, qtd }));
  }

  if (promo.escopo_produtos?.modo === "produtos" && promo.escopo_produtos.produto_ids?.length) {
    return promo.escopo_produtos.produto_ids.map((id) => ({ produtoId: id, qtd: 1 }));
  }

  return [];
}
