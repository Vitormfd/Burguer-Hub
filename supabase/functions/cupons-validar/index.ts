import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

type CupomTipo = "percentual" | "fixo" | "frete_gratis";
type TipoEntrega = "delivery" | "retirada";

interface ValidatePayload {
  codigo?: string;
  telefone?: string | null;
  subtotal?: number;
  taxa_entrega?: number;
  tipo_entrega?: TipoEntrega;
  produto_ids?: string[];
  commit?: boolean;
  pedido_id?: string;
  cliente_id?: string | null;
}

const normalizePhone = (value: string | null | undefined) =>
  (value ?? "").replace(/\D/g, "").trim();

const todayInSaoPaulo = () =>
  new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Sao_Paulo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

    if (!supabaseUrl || !serviceRoleKey) {
      return json({ error: "Variaveis SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY sao obrigatorias" }, 500);
    }

    const supabase = createClient(supabaseUrl, serviceRoleKey, {
      auth: { persistSession: false },
    });

    const payload = (await req.json().catch(() => null)) as ValidatePayload | null;
    const codigo = (payload?.codigo || "").trim().toUpperCase();
    const subtotal = Number(payload?.subtotal || 0);
    const tipoEntrega: TipoEntrega = payload?.tipo_entrega === "retirada" ? "retirada" : "delivery";
    const taxaEntrega = tipoEntrega === "retirada" ? 0 : Number(payload?.taxa_entrega || 0);
    const telefone = normalizePhone(payload?.telefone);

    if (!codigo) {
      return json({ error: "Cupom inválido ou inexistente" }, 400);
    }

    const { data: cupom, error } = await supabase
      .from("cupons")
      .select("id, codigo, descricao, tipo, valor, valor_minimo_pedido, limite_usos_total, usos_realizados, uso_unico_por_cliente, data_inicio, data_expiracao, ativo")
      .eq("codigo", codigo)
      .maybeSingle();

    if (error) {
      return json({ error: error.message }, 500);
    }

    if (!cupom || !cupom.ativo) {
      return json({ error: "Cupom inválido ou inexistente" }, 404);
    }

    const hoje = todayInSaoPaulo();
    if ((cupom.data_inicio && hoje < cupom.data_inicio) || (cupom.data_expiracao && hoje > cupom.data_expiracao)) {
      return json({ error: "Esse cupom expirou" }, 400);
    }

    if (cupom.limite_usos_total != null && Number(cupom.usos_realizados || 0) >= Number(cupom.limite_usos_total || 0)) {
      return json({ error: "Esse cupom atingiu o limite de usos" }, 400);
    }

    if (cupom.uso_unico_por_cliente && telefone) {
      const { data: usoAnterior, error: usoError } = await supabase
        .from("cupom_usos")
        .select("id")
        .eq("cupom_id", cupom.id)
        .eq("telefone_cliente", telefone)
        .maybeSingle();

      if (usoError) {
        return json({ error: usoError.message }, 500);
      }

      if (usoAnterior) {
        return json({ error: "Você já utilizou esse cupom" }, 400);
      }
    }

    if (subtotal < Number(cupom.valor_minimo_pedido || 0)) {
      const minimo = Number(cupom.valor_minimo_pedido || 0).toFixed(2).replace(".", ",");
      return json({ error: `Pedido mínimo de R$${minimo} para usar esse cupom` }, 400);
    }

    const produtoIds = Array.from(
      new Set((payload?.produto_ids || []).map((id) => String(id || "").trim()).filter(Boolean)),
    );

    if (produtoIds.length > 0) {
      const { data: produtosPromocao, error: promoError } = await supabase
        .from("produtos")
        .select("id")
        .in("id", produtoIds)
        .eq("promocao", true)
        .not("preco_promocional", "is", null);

      if (promoError) {
        return json({ error: promoError.message }, 500);
      }

      if ((produtosPromocao || []).length > 0) {
        return json({ error: "Não é possível usar cupom com produtos em promoção" }, 400);
      }
    }

    const valorBase = Math.max(subtotal, 0);
    const descontoCalculado = (() => {
      if (cupom.tipo === "percentual") {
        return valorBase * (Number(cupom.valor || 0) / 100);
      }

      if (cupom.tipo === "fixo") {
        return Number(cupom.valor || 0);
      }

      return taxaEntrega;
    })();

    const descontoMaximo = Math.max(valorBase + Math.max(taxaEntrega, 0) - 0.01, 0);
    const valorDescontoAplicado = Math.min(Math.max(descontoCalculado, 0), descontoMaximo);

    if (payload?.commit) {
      if (!payload.pedido_id) {
        return json({ error: "Pedido inválido para registrar cupom" }, 400);
      }

      const { error: commitError } = await supabase.rpc("registrar_uso_cupom", {
        p_cupom_id: cupom.id,
        p_pedido_id: payload.pedido_id,
        p_cliente_id: payload.cliente_id ?? null,
        p_telefone_cliente: telefone || null,
        p_valor_desconto_aplicado: valorDescontoAplicado,
      });

      if (commitError) {
        const message = commitError.message.includes("limite")
          ? "Esse cupom atingiu o limite de usos"
          : commitError.message.includes("expirou")
            ? "Esse cupom expirou"
            : commitError.message.includes("utilizou")
              ? "Você já utilizou esse cupom"
              : commitError.message.includes("inexistente")
                ? "Cupom inválido ou inexistente"
                : commitError.message;

        return json({ error: message }, 409);
      }
    }

    return json({
      cupom: {
        id: cupom.id,
        codigo: cupom.codigo,
        descricao: cupom.descricao,
        tipo: cupom.tipo as CupomTipo,
        valor: cupom.valor == null ? null : Number(cupom.valor),
        valor_minimo_pedido: Number(cupom.valor_minimo_pedido || 0),
      },
      valor_desconto_aplicado: Number(valorDescontoAplicado.toFixed(2)),
      taxa_entrega_zerada: cupom.tipo === "frete_gratis" && tipoEntrega === "delivery",
    });
  } catch (error) {
    return json({ error: error instanceof Error ? error.message : "Erro inesperado" }, 500);
  }
});