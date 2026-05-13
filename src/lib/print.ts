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
  tipo: "delivery";
  loja_nome?: string;
  cliente_nome: string;
  cliente_telefone: string;
  endereco: string;
  bairro?: string | null;
  taxa_entrega: number;
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

export function printReceipt(data: PrintData): void {
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
    body += `<div class="section-title">DELIVERY</div>`;
    body += `<div class="info-line"><b>${esc(data.cliente_nome)}</b></div>`;
    body += `<div class="info-line">${esc(data.cliente_telefone)}</div>`;
    const addr = esc(data.endereco) + (data.bairro ? ` &mdash; ${esc(data.bairro)}` : "");
    body += `<div class="info-line">${addr}</div>`;
    body += `<div class="sep-dashed"></div>`;
    body += renderItems(data.itens);
    body += `<div class="sep"></div>`;
    body += `<div class="subtotal-line"><span>Subtotal</span><span>${brlPrint(data.subtotal)}</span></div>`;
    body += `<div class="subtotal-line"><span>Taxa de entrega</span><span>${brlPrint(data.taxa_entrega)}</span></div>`;
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

  const html = `<!DOCTYPE html>
<html lang="pt-BR">
<head>
  <meta charset="UTF-8">
  <title>${lojaName}</title>
  <style>
    *{margin:0;padding:0;box-sizing:border-box}
    body{font-family:'Courier New',Courier,monospace;font-size:12px;width:80mm;padding:5mm 4mm;color:#000;background:#fff}
    .header{text-align:center;margin-bottom:6px}
    .header h1{font-size:16px;font-weight:bold;text-transform:uppercase;letter-spacing:2px}
    .header .datetime{font-size:10px;color:#444;margin-top:2px}
    .sep{border-top:2px solid #000;margin:5px 0}
    .sep-dashed{border-top:1px dashed #aaa;margin:4px 0}
    .section-title{font-size:15px;font-weight:bold;text-align:center;margin:5px 0;text-transform:uppercase;letter-spacing:2px}
    .pedido-header{font-size:10px;color:#666;margin:3px 0 2px}
    .item{display:flex;justify-content:space-between;gap:6px;margin:3px 0;font-weight:600}
    .item span:first-child{flex:1}
    .sub{display:flex;justify-content:space-between;gap:6px;padding-left:10px;font-size:11px;color:#555;margin:1px 0}
    .sub span:first-child{flex:1}
    .obs{padding-left:10px;font-size:10px;color:#777;font-style:italic;margin:1px 0}
    .info-line{margin:2px 0;font-size:11px;word-break:break-word}
    .subtotal-line{display:flex;justify-content:space-between;gap:6px;margin:2px 0;font-size:11px}
    .subtotal-line span:first-child{flex:1}
    .total-line{display:flex;justify-content:space-between;gap:6px;margin:5px 0;font-size:15px;font-weight:bold}
    .total-line span:first-child{flex:1}
    .troco{font-weight:bold}
    .footer{text-align:center;font-size:10px;color:#888;margin-top:10px;padding-top:6px;border-top:1px dashed #ccc}
    @media print{
      html,body{width:80mm}
      @page{size:80mm auto;margin:0}
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
  <div class="footer">Obrigado pela prefer&ecirc;ncia!</div>
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
      win.close();
    }, 300);
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
    iframe.contentWindow?.focus();
    iframe.contentWindow?.print();
  }
  setTimeout(() => document.body.removeChild(iframe), 3000);
}
