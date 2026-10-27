import { describe, expect, it } from "vitest";
import { createHmac } from "node:crypto";
import { interpretarEvento, verificarAssinaturaStripe } from "./stripe.ts";

const SEGREDO = "whsec_teste";
const assinar = (corpo: string, t: number, segredo = SEGREDO) =>
  `t=${t},v1=${createHmac("sha256", segredo).update(`${t}.${corpo}`).digest("hex")}`;

describe("verificarAssinaturaStripe", () => {
  const corpo = JSON.stringify({ id: "evt_1", type: "checkout.session.completed" });
  const t = 1_800_000_000;

  it("aceita a assinatura certa dentro da tolerância", async () => {
    expect(await verificarAssinaturaStripe(corpo, assinar(corpo, t), SEGREDO, t + 10)).toBe(true);
  });

  it("recusa corpo alterado, segredo errado, assinatura velha e cabeçalho ausente", async () => {
    expect(await verificarAssinaturaStripe(corpo + " ", assinar(corpo, t), SEGREDO, t)).toBe(false);
    expect(await verificarAssinaturaStripe(corpo, assinar(corpo, t, "whsec_outro"), SEGREDO, t)).toBe(false);
    expect(await verificarAssinaturaStripe(corpo, assinar(corpo, t), SEGREDO, t + 301)).toBe(false);
    expect(await verificarAssinaturaStripe(corpo, null, SEGREDO, t)).toBe(false);
    expect(await verificarAssinaturaStripe(corpo, assinar(corpo, t), "", t)).toBe(false);
  });

  it("aceita quando uma das assinaturas v1 confere (troca de segredo)", async () => {
    const cab = `t=${t},v1=deadbeef,${assinar(corpo, t).split(",")[1]}`;
    expect(await verificarAssinaturaStripe(corpo, cab, SEGREDO, t)).toBe(true);
  });
});

describe("interpretarEvento", () => {
  const dono = "6f1c2b9e-1d2a-4c3b-9e8f-0a1b2c3d4e5f";

  it("checkout pago vincula a conta pelo client_reference_id", () => {
    const acao = interpretarEvento({
      id: "evt_1",
      type: "checkout.session.completed",
      data: {
        object: {
          mode: "subscription",
          payment_status: "paid",
          client_reference_id: dono,
          customer: "cus_1",
          subscription: "sub_1",
          customer_details: { email: "Loja@Exemplo.com" },
        },
      },
    });
    expect(acao).toEqual({
      tipo: "vincular",
      ownerId: dono,
      email: "Loja@Exemplo.com",
      customer: "cus_1",
      subscription: "sub_1",
      status: "active",
    });
  });

  it("checkout sem referência válida cai para o e-mail; teste grátis vira trialing", () => {
    const acao = interpretarEvento({
      id: "evt_2",
      type: "checkout.session.completed",
      data: { object: { mode: "subscription", payment_status: "no_payment_required", client_reference_id: "x", customer_email: "a@b.com" } },
    });
    expect(acao).toMatchObject({ tipo: "vincular", ownerId: null, email: "a@b.com", status: "trialing" });
  });

  it("ignora checkout que não é assinatura ou não foi pago", () => {
    expect(interpretarEvento({ id: "e", type: "checkout.session.completed", data: { object: { mode: "payment" } } }).tipo).toBe("ignorar");
    expect(
      interpretarEvento({ id: "e", type: "checkout.session.completed", data: { object: { mode: "subscription", payment_status: "unpaid" } } }).tipo,
    ).toBe("ignorar");
  });

  it("atualização da assinatura lê status e fim do período (API nova e antiga)", () => {
    const fim = 1_800_000_000;
    expect(
      interpretarEvento({
        id: "e",
        type: "customer.subscription.updated",
        data: { object: { id: "sub_1", customer: "cus_1", status: "past_due", cancel_at_period_end: true, items: { data: [{ current_period_end: fim }] } } },
      }),
    ).toEqual({
      tipo: "atualizar",
      subscription: "sub_1",
      customer: "cus_1",
      status: "past_due",
      periodoFim: new Date(fim * 1000).toISOString(),
      cancelaNoFim: true,
    });
    expect(
      interpretarEvento({ id: "e", type: "customer.subscription.updated", data: { object: { id: "sub_1", status: "active", current_period_end: fim } } }),
    ).toMatchObject({ periodoFim: new Date(fim * 1000).toISOString(), cancelaNoFim: false });
  });

  it("assinatura apagada vira canceled; outros eventos são ignorados", () => {
    expect(
      interpretarEvento({ id: "e", type: "customer.subscription.deleted", data: { object: { id: "sub_1", status: "active" } } }),
    ).toMatchObject({ tipo: "atualizar", status: "canceled" });
    expect(interpretarEvento({ id: "e", type: "invoice.paid", data: { object: {} } }).tipo).toBe("ignorar");
  });
});
