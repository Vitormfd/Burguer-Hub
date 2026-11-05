import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { beforeAll, describe, expect, it } from "vitest";
import { type Banco, cadastrar, comoApi, criarBanco } from "./banco";

const MIGRATION = "20261105120000_teste_gratis.sql";
const sqlDaMigration = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "..", "migrations", MIGRATION), "utf8");

const assinaturaDe = async (db: Banco, owner: string) =>
  (await db.query<Record<string, unknown>>("select * from public.assinaturas where owner_id = $1", [owner])).rows[0];

const liberada = async (db: Banco, owner: string) =>
  (await db.query<{ ok: boolean }>("select public.conta_liberada($1) ok", [owner])).rows[0].ok;

const whatsappLiberado = async (db: Banco, owner: string) =>
  (await db.query<{ ok: boolean }>("select public.conta_whatsapp_liberada($1) ok", [owner])).rows[0].ok;

const vencerTeste = (db: Banco, owner: string) =>
  db.query("update public.assinaturas set teste_ate = now() - interval '1 minute' where owner_id = $1", [owner]);

/** Loja mínima, criada como o painel faria (dono logado). */
async function montarLoja(db: Banco, owner: string) {
  const [categoria] = await comoApi<{ id: string }>(db, "authenticated", owner,
    "insert into public.categorias (nome) values ('Lanches') returning id");
  const [produto] = await comoApi<{ id: string }>(db, "authenticated", owner,
    "insert into public.produtos (nome, preco, categoria_id) values ('X-Burger', 20, $1) returning id", [categoria.id]);
  return produto.id;
}

/** Pedido do cliente no cardápio público: mesma RPC, com o papel anônimo. */
const pedirNoCardapio = (db: Banco, owner: string, produtoId: string) =>
  comoApi<{ r: { pedido_id: string } }>(db, "anon", null,
    `select public.create_public_delivery_order(
       p_owner_id => $1::uuid, p_tipo_entrega => 'retirada', p_cliente_nome => 'Cliente',
       p_cliente_telefone => '74999990000', p_endereco => '', p_numero => '', p_complemento => '',
       p_bairro => '', p_taxa_entrega => 0, p_forma_pagamento => 'dinheiro',
       p_subtotal => 20, p_total => 20,
       p_items => $2::jsonb) as r`,
    [owner, JSON.stringify([{ produto_id: produtoId, quantidade: 1, preco_unitario: 20 }])]);

describe("conta nova", () => {
  let db: Banco;
  let owner: string;
  let produtoId: string;

  beforeAll(async () => {
    db = await criarBanco();
    owner = await cadastrar(db, "nova@teste.local", {
      whatsapp: "(74) 99999-0000",
      origem: { utm_source: "meta", utm_content: "video1", fbclid: "abc", plano: "pago" },
      // Nada disto pode dar acesso: o navegador controla este JSON.
      liberado_manual: true,
      teste_ate: "2099-01-01T00:00:00Z",
      stripe_status: "active",
    });
    produtoId = await montarLoja(db, owner);
  });

  it("nasce com 7 dias e ignora o que o navegador manda sobre acesso", async () => {
    const a = await assinaturaDe(db, owner);
    const dias = (new Date(a.teste_ate as string).getTime() - Date.now()) / 86_400_000;
    expect(dias).toBeGreaterThan(6.99);
    expect(dias).toBeLessThanOrEqual(7);
    expect(a.liberado_manual).toBe(false);
    expect(a.stripe_status).toBeNull();
    expect(a.teste_whatsapp).toBe(false);
  });

  it("guarda só o contato e os campos de origem conhecidos", async () => {
    const a = await assinaturaDe(db, owner);
    expect(a.whatsapp_contato).toBe("74999990000");
    expect(a.origem).toEqual({ utm_source: "meta", utm_content: "video1", fbclid: "abc" });
  });

  it("opera no teste, mas sem WhatsApp", async () => {
    expect(await liberada(db, owner)).toBe(true);
    expect(await whatsappLiberado(db, owner)).toBe(false);
    const [{ r }] = await comoApi<{ r: Record<string, unknown> }>(db, "authenticated", owner, "select public.minha_assinatura() r");
    expect(r).toMatchObject({ liberada: true, em_teste: true, paga: false, whatsapp_liberado: false });
  });

  it("recebe um pedido real, e o pedido chega ao painel da loja", async () => {
    const [{ r }] = await pedirNoCardapio(db, owner, produtoId);
    expect(r.pedido_id).toBeTruthy();
    const noPainel = await comoApi(db, "authenticated", owner, "select id from public.pedidos where id = $1", [r.pedido_id]);
    expect(noPainel).toHaveLength(1);
    const entrega = await comoApi<{ cliente_telefone: string }>(db, "authenticated", owner,
      "select cliente_telefone from public.entregas where pedido_id = $1", [r.pedido_id]);
    expect(entrega[0].cliente_telefone).toBe("74999990000");
  });

  it("abre mesa no teste", async () => {
    const [mesa] = await comoApi<{ id: string }>(db, "authenticated", owner, "insert into public.mesas (numero) values (1) returning id");
    const conta = await comoApi(db, "authenticated", owner, "insert into public.contas (mesa_id) values ($1) returning id", [mesa.id]);
    expect(conta).toHaveLength(1);
  });

  it("ao vencer, volta a ser bloqueada no servidor em todos os caminhos", async () => {
    await vencerTeste(db, owner);
    expect(await liberada(db, owner)).toBe(false);
    await expect(pedirNoCardapio(db, owner, produtoId)).rejects.toThrow(/Assinatura inativa/);

    const [mesa] = await comoApi<{ id: string }>(db, "authenticated", owner, "insert into public.mesas (numero) values (2) returning id");
    await expect(
      comoApi(db, "authenticated", owner, "insert into public.contas (mesa_id) values ($1)", [mesa.id]),
    ).rejects.toThrow(/Assinatura inativa/);
    await expect(
      comoApi(db, "authenticated", owner, "insert into public.pedidos (tipo, owner_id) values ('delivery', $1)", [owner]),
    ).rejects.toThrow(/Assinatura inativa/);
    await expect(
      comoApi(db, "anon", null, "insert into public.pedidos (tipo, owner_id) values ('delivery', $1)", [owner]),
    ).rejects.toThrow(/Assinatura inativa/);

    const [{ r }] = await comoApi<{ r: Record<string, unknown> }>(db, "authenticated", owner, "select public.minha_assinatura() r");
    expect(r).toMatchObject({ liberada: false, em_teste: false });
  });

  it("os dados continuam lá depois de vencer", async () => {
    const pedidos = await comoApi(db, "authenticated", owner, "select id from public.pedidos");
    const produtos = await comoApi(db, "authenticated", owner, "select id from public.produtos");
    expect(pedidos.length).toBeGreaterThan(0);
    expect(produtos.length).toBeGreaterThan(0);
  });
});

describe("liberar o próprio acesso pela API", () => {
  let db: Banco;
  let owner: string;
  let outro: string;

  beforeAll(async () => {
    db = await criarBanco();
    owner = await cadastrar(db, "atacante@teste.local");
    outro = await cadastrar(db, "outro@teste.local");
    await vencerTeste(db, owner);
  });

  const tentativas: [string, string, unknown[]][] = [
    ["estender o teste", "update public.assinaturas set teste_ate = '2099-01-01' where owner_id = auth.uid()", []],
    ["ligar liberação manual", "update public.assinaturas set liberado_manual = true where owner_id = auth.uid()", []],
    ["fingir pagamento", "update public.assinaturas set stripe_status = 'active' where owner_id = auth.uid()", []],
    ["ligar WhatsApp no teste", "update public.assinaturas set teste_whatsapp = true where owner_id = auth.uid()", []],
    ["recriar a própria linha", "insert into public.assinaturas (owner_id, teste_ate) values (auth.uid(), '2099-01-01') on conflict (owner_id) do update set teste_ate = '2099-01-01'", []],
    ["apagar a própria linha", "delete from public.assinaturas where owner_id = auth.uid()", []],
    ["forjar evento da Stripe", "insert into public.stripe_eventos (id, tipo, payload) values ('x', 'y', '{}')", []],
    ["virar administrador", "insert into public.prospeccao_admins (user_id) values (auth.uid())", []],
    ["usar a função de teste do administrador", "select public.admin_definir_teste(auth.uid(), 30, true)", []],
    ["usar a liberação do administrador", "select public.admin_definir_liberacao(auth.uid(), true, 'x')", []],
    ["chamar a função interna do gatilho", "select public.iniciar_teste_gratis()", []],
    ["consultar a regra do WhatsApp diretamente", "select public.conta_whatsapp_liberada(auth.uid())", []],
  ];

  it.each(tentativas)("não consegue %s", async (_nome, sql, parametros) => {
    await expect(comoApi(db, "authenticated", owner, sql, parametros)).rejects.toThrow();
    expect(await liberada(db, owner)).toBe(false);
  });

  it("anônimo também não escreve em assinaturas", async () => {
    await expect(
      comoApi(db, "anon", null, "update public.assinaturas set teste_ate = '2099-01-01' where owner_id = $1", [owner]),
    ).rejects.toThrow();
  });

  it("não ganha outro teste recriando o perfil", async () => {
    await expect(
      comoApi(db, "authenticated", owner, "insert into public.profiles (id, nome) values (auth.uid(), 'x')"),
    ).rejects.toThrow();
    await expect(comoApi(db, "authenticated", owner, "delete from public.profiles where id = auth.uid()")).resolves.toHaveLength(0);
    expect(await liberada(db, owner)).toBe(false);
  });

  it("não vê a assinatura de outra conta", async () => {
    const linhas = await comoApi(db, "authenticated", owner, "select owner_id from public.assinaturas where owner_id = $1", [outro]);
    expect(linhas).toHaveLength(0);
  });

  it("lista de administrador vem vazia para quem não é administrador", async () => {
    expect(await comoApi(db, "authenticated", owner, "select * from public.admin_assinaturas()")).toHaveLength(0);
  });

  it("anônimo não executa a lista de administrador", async () => {
    await expect(comoApi(db, "anon", null, "select * from public.admin_assinaturas()")).rejects.toThrow();
  });
});

describe("contas que já existiam", () => {
  let db: Banco;
  let manual: string;
  let pagante: string;
  let demonstracao: string;

  beforeAll(async () => {
    db = await criarBanco({ parar: MIGRATION });
    manual = await cadastrar(db, "manual@teste.local");
    pagante = await cadastrar(db, "pagante@teste.local");
    demonstracao = await cadastrar(db, "demo@teste.local");
    await db.query("insert into public.assinaturas (owner_id, liberado_manual) values ($1, true)", [manual]);
    await db.query("insert into public.assinaturas (owner_id, stripe_status) values ($1, 'active')", [pagante]);
    await db.exec(sqlDaMigration);
  });

  it("não perdem acesso", async () => {
    expect(await liberada(db, manual)).toBe(true);
    expect(await liberada(db, pagante)).toBe(true);
    expect(await whatsappLiberado(db, manual)).toBe(true);
    expect(await whatsappLiberado(db, pagante)).toBe(true);
  });

  it("não ganham teste", async () => {
    expect((await assinaturaDe(db, manual)).teste_ate).toBeNull();
    expect((await assinaturaDe(db, pagante)).teste_ate).toBeNull();
    expect(await assinaturaDe(db, demonstracao)).toBeUndefined();
    expect(await liberada(db, demonstracao)).toBe(false);
  });

  it("conta antiga que só agora ganhou perfil não recebe teste", async () => {
    const { rows } = await db.query<{ id: string }>(
      "insert into auth.users (email, created_at) values ('antiga@teste.local', now() - interval '60 days') returning id",
    );
    expect(await liberada(db, rows[0].id)).toBe(false);
  });

  it("a migration pode rodar de novo sem mudar nada", async () => {
    await db.exec(sqlDaMigration);
    expect(await liberada(db, manual)).toBe(true);
    expect(await liberada(db, demonstracao)).toBe(false);
  });
});

describe("administrador e Stripe", () => {
  let db: Banco;
  let admin: string;

  beforeAll(async () => {
    db = await criarBanco();
    admin = await cadastrar(db, "admin@teste.local");
    await db.query("insert into public.prospeccao_admins (user_id) values ($1)", [admin]);
  });

  it("bloquear a conta encerra o teste na hora", async () => {
    const owner = await cadastrar(db, "bloqueada@teste.local");
    expect(await liberada(db, owner)).toBe(true);
    await comoApi(db, "authenticated", admin, "select public.admin_definir_liberacao($1, false, 'bloqueio')", [owner]);
    expect(await liberada(db, owner)).toBe(false);
  });

  it("dá teste a uma conta antiga, uma a uma, e encerra com 0 dias", async () => {
    const { rows } = await db.query<{ id: string }>(
      "insert into auth.users (email, created_at) values ('antiga2@teste.local', now() - interval '60 days') returning id",
    );
    const owner = rows[0].id;
    await comoApi(db, "authenticated", admin, "select public.admin_definir_teste($1, 7)", [owner]);
    expect(await liberada(db, owner)).toBe(true);
    await comoApi(db, "authenticated", admin, "select public.admin_definir_teste($1, 0)", [owner]);
    expect(await liberada(db, owner)).toBe(false);
  });

  it("WhatsApp no teste só com a liberação do administrador, e acaba com o teste", async () => {
    const owner = await cadastrar(db, "whats@teste.local");
    expect(await whatsappLiberado(db, owner)).toBe(false);
    await comoApi(db, "authenticated", admin, "select public.admin_definir_teste($1, null, true)", [owner]);
    expect(await whatsappLiberado(db, owner)).toBe(true);
    await vencerTeste(db, owner);
    expect(await whatsappLiberado(db, owner)).toBe(false);
  });

  it("recusa teste acima de 30 dias", async () => {
    const owner = await cadastrar(db, "longo@teste.local");
    await expect(comoApi(db, "authenticated", admin, "select public.admin_definir_teste($1, 365)", [owner])).rejects.toThrow(/30 dias/);
  });

  it("pagar no teste mantém a data e libera o WhatsApp; cancelar depois de vencer bloqueia", async () => {
    const owner = await cadastrar(db, "assina@teste.local");
    // Mesmo upsert do stripe-webhook, com a service role.
    await comoApi(db, "service_role", null,
      `insert into public.assinaturas (owner_id, stripe_status, stripe_subscription_id) values ($1, 'active', 'sub_1')
       on conflict (owner_id) do update set stripe_status = excluded.stripe_status, stripe_subscription_id = excluded.stripe_subscription_id`,
      [owner]);
    expect((await assinaturaDe(db, owner)).teste_ate).not.toBeNull();
    expect(await whatsappLiberado(db, owner)).toBe(true);
    const [{ r }] = await comoApi<{ r: Record<string, unknown> }>(db, "authenticated", owner, "select public.minha_assinatura() r");
    expect(r).toMatchObject({ paga: true, liberada: true });

    await vencerTeste(db, owner);
    expect(await liberada(db, owner)).toBe(true);
    await db.query("update public.assinaturas set stripe_status = 'canceled' where owner_id = $1", [owner]);
    expect(await liberada(db, owner)).toBe(false);
  });
});
