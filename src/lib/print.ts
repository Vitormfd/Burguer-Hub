// ─── Config de impressão ───────────────────────────────────────────────────────

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

export interface PrintItem {
  nome: string;
  quantidade: number;
  preco_unitario: number;
  observacao?: string | null;
  adicionais?: Array<{ nome: string; quantidade: number; preco_unitario: number }>;
}

export interface PrintMesaData {
  tipo: "mesa";
  loja_nome?: string;
  mesa_numero: number;
  pedidos: Array<{
    numero: number;
    criado_em: string;
    itens: PrintItem[];
  }>;
  total: number;
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

function renderItems(itens: PrintItem[]): string {
  return itens
    .map((item) => {
      const total = brlPrint(item.quantidade * item.preco_unitario);
      let html = `<div class="item"><span>${item.quantidade}x ${esc(item.nome)}</span><span>${total}</span></div>`;
      if (item.adicionais?.length) {
        item.adicionais.forEach((a) => {
          html += `<div class="sub"><span>+${a.quantidade}x ${esc(a.nome)}</span><span>${brlPrint(a.quantidade * a.preco_unitario)}</span></div>`;
        });
      }
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
  const lojaName = esc(data.loja_nome ?? "Burguer Hub");

  let body = "";

  if (data.tipo === "mesa") {
    body += `<div class="section-title">MESA ${String(data.mesa_numero).padStart(2, "0")}</div>`;
    data.pedidos.forEach((p) => {
      body += `<div class="sep-dashed"></div>`;
      body += `<div class="pedido-header">Pedido #${p.numero} &mdash; ${new Date(p.criado_em).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}</div>`;
      body += renderItems(p.itens);
    });
    body += `<div class="sep"></div>`;
    body += `<div class="total-line"><span>TOTAL</span><span>${brlPrint(data.total)}</span></div>`;
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
        cartao: "Cart\u00e3o",
      };
      body += `<div class="sep-dashed"></div>`;
      body += `<div class="subtotal-line"><span>Pagamento</span><span>${esc(formaLabel[data.forma_pagamento] ?? data.forma_pagamento)}</span></div>`;
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

  const fontSizeMap: Record<PrintConfig["fonte"], { base: number; small: number; title: number; total: number }> = {
    pequena: { base: 11, small: 10, title: 14, total: 14 },
    normal:  { base: 13, small: 12, title: 16, total: 16 },
    grande:  { base: 15, small: 13, title: 18, total: 18 },
  };
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
  <style>
    *{margin:0;padding:0;box-sizing:border-box}
    body{font-family:'Courier New',Courier,monospace;font-size:${fs.base}px;font-weight:700;line-height:1.3;width:${w};padding:5mm 4mm;color:#000;background:#fff;-webkit-print-color-adjust:exact;print-color-adjust:exact}
    .header{text-align:center;margin-bottom:6px}
    .header h1{font-size:${fs.title + 1}px;font-weight:900;text-transform:uppercase}
    .header .datetime{font-size:${fs.small}px;font-weight:700;color:#000;margin-top:2px}
    .sep{border-top:2.4px solid #000;margin:5px 0}
    .sep-dashed{border-top:1.5px solid #000;margin:4px 0}
    .section-title{font-size:${fs.title}px;font-weight:bold;text-align:center;margin:5px 0;text-transform:uppercase}
    .pedido-header{font-size:${fs.small}px;font-weight:700;color:#000;margin:3px 0 2px}
    .item{display:flex;justify-content:space-between;gap:6px;margin:3px 0;font-weight:800}
    .item span:first-child{flex:1}
    .sub{display:flex;justify-content:space-between;gap:6px;padding-left:10px;font-size:${fs.small}px;font-weight:700;color:#000;margin:1px 0}
    .sub span:first-child{flex:1}
    .obs{padding-left:10px;font-size:${fs.small}px;font-weight:700;color:#000;margin:1px 0}
    .info-line{margin:2px 0;font-size:${fs.small}px;font-weight:700;word-break:break-word}
    .subtotal-line{display:flex;justify-content:space-between;gap:6px;margin:2px 0;font-size:${fs.small}px;font-weight:700}
    .subtotal-line span:first-child{flex:1}
    .total-line{display:flex;justify-content:space-between;gap:6px;margin:5px 0;padding:2px 0;border-top:1.6px solid #000;border-bottom:1.6px solid #000;font-size:${fs.total}px;font-weight:900}
    .total-line span:first-child{flex:1}
    .troco{font-weight:900}
    .footer{text-align:center;font-size:${fs.small}px;font-weight:700;color:#000;margin-top:10px;padding-top:6px;border-top:1.5px solid #000}
    @media print{
      html,body{width:${w};-webkit-print-color-adjust:exact;print-color-adjust:exact}
      @page{size:${w} auto;margin:0}
    }
  </style>
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

  // Tenta abrir popup para impressão
  const win = window.open("", "_blank", "width=440,height=680,scrollbars=yes,resizable=yes");
  if (win) {
    win.document.open();
    win.document.write(html);
    win.document.close();
    win.focus();
    // Aguarda renderização antes de chamar print
    setTimeout(() => {
      win.print();
      // Fecha somente depois que o diálogo de impressão for dispensado
      // (evita cortar o job antes de enviar para a impressora)
      win.onafterprint = () => win.close();
    }, 500);
    return;
  }

  // Fallback: iframe oculto (para quando popup estiver bloqueado)
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
