import { useEffect } from "react";
import { Navigate } from "react-router-dom";
import { useAuth } from "@/hooks/useAuth";

// A página de vendas é a landing do Base44 renderizada em HTML (public/sistema-para-restaurante e
// demais nichos), gerada no repositório da landing com `npm run build:seo`.
// Na Vercel, /lp já redireciona antes de chegar aqui (vercel.json); isto cobre o dev e links antigos.
export const PAGINA_DE_VENDAS = "/sistema-para-restaurante";

/** Destino com a query e o hash atuais: anúncios podem apontar para a raiz, e UTMs e fbclid não podem se perder. */
export const destinoComParametros = (to: string, search: string, hash: string) => `${to}${search}${hash}`;

/** Sai do app para uma página estática (fora do React Router). */
export function IrParaPagina({ to }: { to: string }) {
  useEffect(() => {
    window.location.replace(destinoComParametros(to, window.location.search, window.location.hash));
  }, [to]);
  return null;
}

/** Raiz do domínio: quem está logado vai para o sistema; visitante (e o Google) vê a página de vendas. */
export function Inicio() {
  const { session, loading } = useAuth();
  if (loading) return null;
  if (session) return <Navigate to="/mesas" replace />;
  return <IrParaPagina to={PAGINA_DE_VENDAS} />;
}
