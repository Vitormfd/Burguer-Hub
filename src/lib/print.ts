import type { Cart } from "@/components/cardapio/cartTypes";
import { supabase } from "@/integrations/supabase/client";

export interface PrintConfig {
  largura: "58mm" | "80mm";
  fonte: "pequena" | "normal" | "grande";
  mostrar_rodape: boolean;
  rodape_texto: string;
}

const PRINT_CONFIG_KEY = "burgerhub:print-config:v1";

const DEFAULT_PRINT_CONFIG: PrintConfig = {
  largura: "80mm",
  fonte: "normal",
  mostrar_rodape: true,
  rodape_texto: "Obrigado pela preferência!",
};

export function readPrintConfig(): PrintConfig {
  try {
    const raw = localStorage.getItem(PRINT_CONFIG_KEY);
    if (!raw) return { ...DEFAULT_PRINT_CONFIG };
    const parsed = JSON.parse(raw) as Partial<PrintConfig>;
    return { ...DEFAULT_PRINT_CONFIG, ...parsed };
  } catch {
    return { ...DEFAULT_PRINT_CONFIG };
  }
}

export function savePrintConfig(config: PrintConfig): void {
  try {
    localStorage.setItem(PRINT_CONFIG_KEY, JSON.stringify(config));
  } catch {
    // Ignore storage limits/private mode
  }
}

// ─── Tipos públicos ────────────────────────────────────────────────────────────

export interface PrintAdicional {
  nome: string;
  quantidade: number;
  preco_unitario: number;
  grupo_nome?: string;
}

export interface PrintItem {
  nome: string;
  quantidade: number;
  preco_unitario: number;
  observacao?: string | null;
  adicionais?: PrintAdicional[];
}

export interface PrintMesaData {
  tipo: "mesa";
  loja_nome?: string;
  mesa_numero: number;
  modalidade_consumo?: "local" | "levar";
  nome?: string | null;
  pedidos: Array<{
    numero: number;
    criado_em: string;
    itens: PrintItem[];
  }>;
  total: number;
  forma_pagamento?: string | null;
  troco_para?: number | null;
  pagamentos?: Array<{ forma: string; valor: number }>;
}

export interface PrintDeliveryData {
  tipo: "delivery" | "retirada";
  loja_nome?: string;
  cliente_nome: string;
  cliente_telefone: string;
  endereco: string;
  numero?: string | null;
  complemento?: string | null;
  bairro?: string | null;
  taxa_entrega: number;
  desconto?: number;
  cupom_codigo?: string | null;
  forma_pagamento?: string | null;
  troco_para?: number | null;
  itens: PrintItem[];
  subtotal: number;
  total: number;
  criado_em: string;
}

export type PrintData = PrintMesaData | PrintDeliveryData;

type PedidoItemAdicionalRow = {
  pedido_item_id: string;
  adicional_id: string | null;
  nome: string | null;
  quantidade: number;
  preco_unitario: number;
};

export function mapCartToPrintItems(cart: Cart): PrintItem[] {
  return cart.map((item) => ({
    nome: item.produto.nome,
    quantidade: item.quantidade,
    preco_unitario: item.precoUnit,
    observacao: item.observacao || null,
    adicionais: item.adicionais.map((adicional) => ({
      nome: adicional.adicionalNome,
      quantidade: adicional.quantidade,
      preco_unitario: adicional.precoUnitario,
      grupo_nome: adicional.grupoNome,
    })),
  }));
}

export async function loadPrintAdicionaisPorItem(
  itemIds: string[],
): Promise<Map<string, PrintAdicional[]>> {
  if (!itemIds.length) return new Map();

  try {
    // Preferência: inclui `nome` snapshot (migração 20260819120000).
    // Fallback: se a coluna ainda não existir no banco, busca sem ela.
    let rows: PedidoItemAdicionalRow[] = [];

    const withNome = await supabase
      .from("pedido_item_adicionais")
      .select("pedido_item_id, adicional_id, nome, quantidade, preco_unitario")
      .in("pedido_item_id", itemIds);

    if (withNome.error) {
      const withoutNome = await supabase
        .from("pedido_item_adicionais")
        .select("pedido_item_id, adicional_id, quantidade, preco_unitario")
        .in("pedido_item_id", itemIds);

      if (withoutNome.error) {
        console.warn("Falha ao carregar adicionais para impressão:", withoutNome.error.message);
        return new Map();
      }

      rows = (withoutNome.data || []).map((row) => ({
        ...row,
        nome: null,
      })) as PedidoItemAdicionalRow[];
    } else {
      rows = (withNome.data || []) as PedidoItemAdicionalRow[];
    }

    const adicionalIds = Array.from(new Set(rows.map((row) => row.adicional_id).filter(Boolean))) as string[];

    const { data: adicionais } = adicionalIds.length
      ? await supabase.from("adicionais").select("id, nome, grupo_id").in("id", adicionalIds)
      : { data: [] as { id: string; nome: string; grupo_id: string | null }[] };

    const grupoIds = Array.from(
      new Set((adicionais || []).map((adicional) => adicional.grupo_id).filter(Boolean)),
    ) as string[];

    const { data: grupos } = grupoIds.length
      ? await supabase.from("grupos_adicionais").select("id, nome").in("id", grupoIds)
      : { data: [] as { id: string; nome: string }[] };

    const grupoMap = new Map((grupos || []).map((grupo) => [grupo.id, grupo.nome]));
    const adicionalMap = new Map(
      (adicionais || []).map((adicional) => [
        adicional.id,
        {
          nome: adicional.nome,
          grupo_nome: adicional.grupo_id ? grupoMap.get(adicional.grupo_id) : undefined,
        },
      ]),
    );

    const adPorItem = new Map<string, PrintAdicional[]>();
    rows.forEach((row) => {
      const meta = row.adicional_id ? adicionalMap.get(row.adicional_id) : undefined;
      const atual = adPorItem.get(row.pedido_item_id) ?? [];
      atual.push({
        nome: row.nome?.trim() || meta?.nome || "Adicional",
        quantidade: row.quantidade,
        preco_unitario: Number(row.preco_unitario),
        grupo_nome: meta?.grupo_nome,
      });
      adPorItem.set(row.pedido_item_id, atual);
    });

    return adPorItem;
  } catch (err) {
    console.warn("Falha ao carregar adicionais para impressão:", err);
    return new Map();
  }
}

// ─── Helpers internos ──────────────────────────────────────────────────────────

const brlPrint = (v: number) =>
  new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(v || 0);

function esc(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

const fontSizeMap: Record<PrintConfig["fonte"], { base: number; small: number; title: number; total: number }> = {
  pequena: { base: 11, small: 10, title: 14, total: 14 },
  normal: { base: 13, small: 12, title: 16, total: 16 },
  grande: { base: 15, small: 13, title: 18, total: 18 },
};

function buildPrintStyles(fs: (typeof fontSizeMap)[PrintConfig["fonte"]], w: PrintConfig["largura"]): string {
  return `
    *{margin:0;padding:0;box-sizing:border-box}
    html,body{margin:0}
    body{
      font-family:'Courier New',Courier,monospace;
      font-size:${fs.base}px;
      font-weight:700;
      line-height:1.25;
      width:${w};
      max-width:${w};
      padding:0 2mm 2mm;
      color:#000;
      background:#fff;
      overflow-wrap:anywhere;
      word-break:break-word;
      -webkit-print-color-adjust:exact;
      print-color-adjust:exact;
    }
    .header{text-align:center;margin:0 0 4px}
    .header h1{font-size:${fs.title + 1}px;font-weight:900;text-transform:uppercase;margin:0}
    .header .datetime{font-size:${fs.small}px;font-weight:700;color:#000;margin:2px 0 0}
    .sep{border-top:2.4px solid #000;margin:4px 0}
    .sep-dashed{border-top:1.5px solid #000;margin:3px 0}
    .section-title{font-size:${fs.title}px;font-weight:bold;text-align:center;margin:4px 0;text-transform:uppercase}
    .pedido-header{font-size:${fs.small}px;font-weight:700;color:#000;margin:2px 0}
    .item{display:flex;justify-content:space-between;align-items:flex-start;gap:4px;margin:2px 0;font-weight:800}
    .item span:first-child{flex:1;min-width:0}
    .item span:last-child{flex-shrink:0;white-space:nowrap}
    .sub{display:flex;justify-content:space-between;align-items:flex-start;gap:4px;padding-left:8px;font-size:${fs.small}px;font-weight:700;color:#000;margin:1px 0}
    .sub span:first-child{flex:1;min-width:0}
    .sub span:last-child{flex-shrink:0;white-space:nowrap}
    .obs{padding-left:8px;font-size:${fs.small}px;font-weight:700;color:#000;margin:1px 0}
    .info-line{margin:2px 0;font-size:${fs.small}px;font-weight:700;word-break:break-word}
    .subtotal-line{display:flex;justify-content:space-between;align-items:flex-start;gap:4px;margin:2px 0;font-size:${fs.small}px;font-weight:700}
    .subtotal-line span:first-child{flex:1;min-width:0}
    .subtotal-line span:last-child{flex-shrink:0;white-space:nowrap}
    .total-line{margin:4px 0;padding:3px 0;border-top:1.6px solid #000;border-bottom:1.6px solid #000;font-size:${fs.total}px;font-weight:900}
    .total-line span{display:block}
    .total-line span:last-child{text-align:right;margin-top:1px}
    .troco{font-weight:900}
    .footer{text-align:center;font-size:${fs.small}px;font-weight:700;color:#000;margin-top:8px;padding-top:4px;border-top:1.5px solid #000}
    @media print{
      html,body{
        width:${w};
        max-width:${w};
        margin:0!important;
        padding:0 2mm 2mm!important;
        -webkit-print-color-adjust:exact;
        print-color-adjust:exact;
      }
      @page{size:${w} auto;margin:0}
    }
  `;
}

function openAndPrint(html: string): void {
  const win = window.open("", "_blank", "width=440,height=680,scrollbars=yes,resizable=yes");
  if (win) {
    win.document.open();
    win.document.write(html);
    win.document.close();
    win.focus();
    setTimeout(() => {
      win.print();
      win.onafterprint = () => win.close();
    }, 500);
    return;
  }

  const iframe = document.createElement("iframe");
  iframe.style.cssText = "position:fixed;right:0;bottom:0;width:0;height:0;border:0;visibility:hidden";
  document.body.appendChild(iframe);
  const doc = iframe.contentDocument ?? iframe.contentWindow?.document;
  if (doc) {
    doc.open();
    doc.write(html);
    doc.close();
    setTimeout(() => {
      iframe.contentWindow?.focus();
      iframe.contentWindow?.print();
      if (iframe.contentWindow) {
        iframe.contentWindow.onafterprint = () => document.body.removeChild(iframe);
      } else {
        setTimeout(() => document.body.removeChild(iframe), 5000);
      }
    }, 500);
  }
}

function adicionaisPorUnidade(adicionais: PrintAdicional[] = []): number {
  return adicionais.reduce((sum, adicional) => sum + adicional.quantidade * adicional.preco_unitario, 0);
}

function formatPrintAdicionalLabel(adicional: PrintAdicional): string {
  return adicional.grupo_nome ? `${adicional.grupo_nome}: ${adicional.nome}` : adicional.nome;
}

function renderItems(itens: PrintItem[]): string {
  return itens
    .map((item) => {
      const adicionais = item.adicionais ?? [];
      const addonsPerUnit = adicionaisPorUnidade(adicionais);
      const baseUnit = Math.max(0, item.preco_unitario - addonsPerUnit);
      const lineTotal = item.quantidade * item.preco_unitario;
      const mainLineTotal = adicionais.length
        ? item.quantidade * baseUnit
        : lineTotal;

      let html = `<div class="item"><span>${item.quantidade}x ${esc(item.nome)}</span><span>${brlPrint(mainLineTotal)}</span></div>`;

      adicionais.forEach((adicional) => {
        const qtyTotal = adicional.quantidade * item.quantidade;
        const addonTotal = qtyTotal * adicional.preco_unitario;
        const priceHtml = addonTotal > 0 ? `<span>${brlPrint(addonTotal)}</span>` : "<span></span>";
        html += `<div class="sub"><span>+${qtyTotal}x ${esc(formatPrintAdicionalLabel(adicional))}</span>${priceHtml}</div>`;
      });

      if (item.observacao) {
        html += `<div class="obs">&#8627; ${esc(item.observacao)}</div>`;
      }
      return html;
    })
    .join("");
}

// ─── Função principal ──────────────────────────────────────────────────────────

export function printReceipt(data: PrintData, config?: PrintConfig): void {
  config = config ?? readPrintConfig();
  const now = new Date();
  const dateStr = now.toLocaleDateString("pt-BR");
  const timeStr = now.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
  const lojaName = esc(data.loja_nome ?? "Easy Food Hub");

  let body = "";

  if (data.tipo === "mesa") {
    body += `<div class="section-title">MESA ${String(data.mesa_numero).padStart(2, "0")}</div>`;
    if (data.nome?.trim()) {
      body += `<div class="info-line"><strong>Nome:</strong> ${esc(data.nome.trim())}</div>`;
    }
    if (data.modalidade_consumo) {
      const modalidadeTxt = data.modalidade_consumo === "levar" ? "LEVAR" : "CONSUMIR NO LOCAL";
      body += `<div class="section-title">${modalidadeTxt}</div>`;
    }
    data.pedidos.forEach((p) => {
      body += `<div class="sep-dashed"></div>`;
      body += `<div class="pedido-header">Pedido #${p.numero} &mdash; ${new Date(p.criado_em).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}</div>`;
      body += renderItems(p.itens);
    });
    body += `<div class="sep"></div>`;
    body += `<div class="total-line"><span>TOTAL</span><span>${brlPrint(data.total)}</span></div>`;
    {
      const formaLabel: Record<string, string> = {
        dinheiro: "Dinheiro",
        pix: "PIX",
        cartao: "Cartão",
        boleto: "Boleto",
      };
      if (data.pagamentos?.length) {
        body += `<div class="sep-dashed"></div>`;
        body += `<div class="section-title">PAGAMENTO</div>`;
        data.pagamentos.forEach((pagamento) => {
          body += `<div class="subtotal-line"><span>${esc(formaLabel[pagamento.forma] ?? pagamento.forma)}</span><span>${brlPrint(pagamento.valor)}</span></div>`;
        });
      } else if (data.forma_pagamento) {
        body += `<div class="sep-dashed"></div>`;
        body += `<div class="section-title">PAGAMENTO</div>`;
        body += `<div class="subtotal-line"><span>Forma</span><span>${esc(formaLabel[data.forma_pagamento] ?? data.forma_pagamento)}</span></div>`;
      }
      const valorDinheiroMesa = (data.pagamentos ?? [])
        .filter((p) => p.forma === "dinheiro")
        .reduce((s, p) => s + p.valor, 0);
      const baseTrocoMesa = data.pagamentos?.length ? valorDinheiroMesa : data.total;
      if (
        data.troco_para != null &&
        baseTrocoMesa > 0 &&
        data.troco_para > baseTrocoMesa
      ) {
        body += `<div class="subtotal-line"><span>Troco para</span><span>${brlPrint(data.troco_para)}</span></div>`;
        body += `<div class="subtotal-line troco"><span>Troco</span><span>${brlPrint(data.troco_para - baseTrocoMesa)}</span></div>`;
      }
    }
  } else {
    body += `<div class="section-title">${data.tipo === "retirada" ? "RETIRADA" : "DELIVERY"}</div>`;
    body += `<div class="info-line"><b>${esc(data.cliente_nome)}</b></div>`;
    body += `<div class="info-line">${esc(data.cliente_telefone)}</div>`;
    if (data.tipo === "delivery") {
      const numero = data.numero ? `, ${esc(data.numero)}` : "";
      const complemento = data.complemento ? ` - ${esc(data.complemento)}` : "";
      const addr = `${esc(data.endereco)}${numero}${complemento}` + (data.bairro ? ` &mdash; ${esc(data.bairro)}` : "");
      body += `<div class="info-line">${addr}</div>`;
    } else {
      body += `<div class="info-line">Retirada no balcão</div>`;
    }
    body += `<div class="sep-dashed"></div>`;
    body += renderItems(data.itens);
    body += `<div class="sep"></div>`;
    body += `<div class="subtotal-line"><span>Subtotal</span><span>${brlPrint(data.subtotal)}</span></div>`;
    body += `<div class="subtotal-line"><span>${data.tipo === "retirada" ? "Taxa" : "Taxa de entrega"}</span><span>${brlPrint(data.taxa_entrega)}</span></div>`;
    if (data.desconto && data.desconto > 0) {
      body += `<div class="subtotal-line"><span>Desconto${data.cupom_codigo ? ` (${esc(data.cupom_codigo)})` : ""}</span><span>- ${brlPrint(data.desconto)}</span></div>`;
    }
    body += `<div class="total-line"><span>TOTAL</span><span>${brlPrint(data.total)}</span></div>`;
    if (data.forma_pagamento) {
      const formaLabel: Record<string, string> = {
        dinheiro: "Dinheiro",
        pix: "PIX",
        cartao: "Cartão",
        boleto: "Boleto",
      };
      body += `<div class="sep-dashed"></div>`;
      body += `<div class="section-title">PAGAMENTO</div>`;
      body += `<div class="subtotal-line"><span>Forma</span><span>${esc(formaLabel[data.forma_pagamento] ?? data.forma_pagamento)}</span></div>`;
      if (
        data.forma_pagamento === "dinheiro" &&
        data.troco_para != null &&
        data.troco_para > data.total
      ) {
        body += `<div class="subtotal-line"><span>Troco para</span><span>${brlPrint(data.troco_para)}</span></div>`;
        body += `<div class="subtotal-line troco"><span>Troco</span><span>${brlPrint(data.troco_para - data.total)}</span></div>`;
      }
    }
  }

  const fs = fontSizeMap[config.fonte];
  const w = config.largura;
  const rodapeHtml = config.mostrar_rodape && config.rodape_texto
    ? `<div class="footer">${esc(config.rodape_texto)}</div>`
    : "";

  const html = `<!DOCTYPE html>
<html lang="pt-BR">
<head>
  <meta charset="UTF-8">
  <title>${lojaName}</title>
  <style>${buildPrintStyles(fs, w)}</style>
</head>
<body>
  <div class="header">
    <h1>${lojaName}</h1>
    <div class="datetime">${dateStr} &agrave;s ${timeStr}</div>
  </div>
  <div class="sep"></div>
  ${body}
  ${rodapeHtml}
</body>
</html>`;

  openAndPrint(html);
}

// ─── Impressão: Resumo do caixa ───────────────────────────────────────────────
export interface CashSummary {
  loja_nome?: string;
  caixa: {
    id: string;
    valor_inicial: number;
    valor_final: number | null;
    aberto_em: string;
    fechado_em: string | null;
    observacoes?: string | null;
  };
  vendas_mesas?: { total: number; quantidade: number };
  vendas_delivery?: { total: number; quantidade: number };
  total_vendas: number;
  contas_count: number;
  delivery_count?: number;
  pagamentos: Array<{ forma: string; valor: number }>;
  movimentacoes: { retirada: number; suprimento: number };
  dinheiro_esperado?: number;
  diferenca?: number | null;
}

export function printCashSummary(summary: CashSummary, config?: PrintConfig) {
  config = config ?? readPrintConfig();
  const now = new Date();
  const dateStr = now.toLocaleDateString("pt-BR");
  const timeStr = now.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
  const lojaName = esc(summary.loja_nome || "Easy Food Hub");

  const fs = fontSizeMap[config.fonte];
  const w = config.largura;

  const brl = (v: number) => new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(v || 0);

  const vendasMesas = summary.vendas_mesas ?? { total: summary.total_vendas, quantidade: summary.contas_count };
  const vendasDelivery = summary.vendas_delivery ?? { total: 0, quantidade: summary.delivery_count ?? 0 };
  const dinheiroEsperado =
    summary.dinheiro_esperado ??
    summary.caixa.valor_inicial +
      (summary.pagamentos.find((p) => p.forma.toLowerCase().includes("dinheiro"))?.valor || 0) +
      summary.movimentacoes.suprimento -
      summary.movimentacoes.retirada;

  let body = "";
  body += `<div class="section-title">RESUMO DO CAIXA</div>`;
  body += `<div class="info-line">Período: ${new Date(summary.caixa.aberto_em).toLocaleString("pt-BR")} — ${summary.caixa.fechado_em ? new Date(summary.caixa.fechado_em).toLocaleString("pt-BR") : "(em aberto)"}</div>`;
  body += `<div class="sep-dashed"></div>`;
  body += `<div class="section-title">Vendas no sistema</div>`;
  body += `<div class="subtotal-line"><span>Mesas (${vendasMesas.quantidade})</span><span>${brl(vendasMesas.total)}</span></div>`;
  body += `<div class="subtotal-line"><span>Delivery (${vendasDelivery.quantidade})</span><span>${brl(vendasDelivery.total)}</span></div>`;
  body += `<div class="subtotal-line"><span>Total vendas</span><span>${brl(summary.total_vendas)}</span></div>`;
  body += `<div class="sep-dashed"></div>`;
  body += `<div class="section-title">Por forma de pagamento</div>`;
  if (summary.pagamentos.length) {
    summary.pagamentos.forEach((p) => {
      body += `<div class="subtotal-line"><span>${esc(p.forma)}</span><span>${brl(p.valor)}</span></div>`;
    });
  } else {
    body += `<div class="info-line">Nenhum pagamento registrado no período.</div>`;
  }
  body += `<div class="sep-dashed"></div>`;
  body += `<div class="section-title">Movimentações do caixa</div>`;
  body += `<div class="subtotal-line"><span>Valor inicial (abertura)</span><span>${brl(summary.caixa.valor_inicial)}</span></div>`;
  body += `<div class="subtotal-line"><span>Retiradas</span><span>- ${brl(summary.movimentacoes.retirada)}</span></div>`;
  body += `<div class="subtotal-line"><span>Suprimentos</span><span>+ ${brl(summary.movimentacoes.suprimento)}</span></div>`;
  body += `<div class="sep"></div>`;
  body += `<div class="total-line"><span>Dinheiro esperado</span><span>${brl(dinheiroEsperado)}</span></div>`;
  body += `<div class="total-line"><span>Valor contado</span><span>${brl(summary.caixa.valor_final ?? 0)}</span></div>`;
  if (summary.diferenca != null) {
    const diffLabel = summary.diferenca === 0 ? "Conferido" : summary.diferenca > 0 ? "Sobra" : "Falta";
    body += `<div class="total-line"><span>Diferença (${diffLabel})</span><span>${brl(summary.diferenca)}</span></div>`;
  }

  const rodapeHtml = config.mostrar_rodape && config.rodape_texto ? `<div class="footer">${esc(config.rodape_texto)}</div>` : "";

  const html = `<!DOCTYPE html>
<html lang="pt-BR">
<head>
  <meta charset="utf-8">
  <title>${lojaName} - Resumo</title>
  <style>${buildPrintStyles(fs, w)}</style>
</head>
<body>
  <div class="header">
    <h1>${lojaName}</h1>
    <div class="datetime">${dateStr} &agrave;s ${timeStr}</div>
  </div>
  <div class="sep"></div>
  ${body}
  ${rodapeHtml}
</body>
</html>`;

  openAndPrint(html);
}
