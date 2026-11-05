import { describe, expect, it, vi } from "vitest";
import { contaLiberada, whatsappLiberado } from "./assinatura.ts";
import { mesmoCelular, normalizarCelularBr } from "./telefone.ts";

const cliente = (data: unknown, error: { message: string } | null = null) => {
  const rpc = vi.fn().mockResolvedValue({ data, error });
  return { rpc };
};

describe("regras de acesso nas Edge Functions", () => {
  it("cada regra consulta a função certa do banco", async () => {
    const c = cliente(true);
    await contaLiberada(c, "dono");
    await whatsappLiberado(c, "dono");
    expect(c.rpc).toHaveBeenNthCalledWith(1, "conta_liberada", { p_owner: "dono" });
    expect(c.rpc).toHaveBeenNthCalledWith(2, "conta_whatsapp_liberada", { p_owner: "dono" });
  });

  it("só true libera", async () => {
    expect(await whatsappLiberado(cliente(false), "dono")).toBe(false);
    expect(await whatsappLiberado(cliente(null), "dono")).toBe(false);
    expect(await whatsappLiberado(cliente(true), "dono")).toBe(true);
  });

  it("erro de banco não derruba quem paga", async () => {
    const erro = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(await whatsappLiberado(cliente(null, { message: "falhou" }), "dono")).toBe(true);
    erro.mockRestore();
  });
});

describe("telefones", () => {
  it("normaliza DDI, máscara e o 9 que falta", () => {
    expect(normalizarCelularBr("(74) 99999-0000")?.formatted).toBe("5574999990000");
    expect(normalizarCelularBr("5574999990000")?.local).toBe("74999990000");
    expect(normalizarCelularBr("7499990000")?.local).toBe("74999990000");
  });

  it("recusa o que não é celular", () => {
    expect(normalizarCelularBr("")).toBeNull();
    expect(normalizarCelularBr("123")).toBeNull();
  });

  it("compara o mesmo número em formatos diferentes", () => {
    expect(mesmoCelular("(74) 99999-0000", "5574999990000")).toBe(true);
    expect(mesmoCelular("74999990000", "74999991111")).toBe(false);
  });

  it("número inválido nunca é igual", () => {
    expect(mesmoCelular("", "")).toBe(false);
    expect(mesmoCelular(null, "74999990000")).toBe(false);
    expect(mesmoCelular("abc", "abc")).toBe(false);
  });
});
