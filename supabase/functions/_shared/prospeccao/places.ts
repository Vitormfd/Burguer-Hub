// Google Places API (New) — Text Search. Opcional: só roda com GOOGLE_PLACES_API_KEY.
// É a forma permitida de usar dados do Google Maps (nada de raspar a página do Maps).
import type { CandidatoMaps } from "./ia.ts";

export const placesDisponivel = (): boolean => Boolean(Deno.env.get("GOOGLE_PLACES_API_KEY"));

const CAMPOS = [
  "places.id",
  "places.displayName",
  "places.formattedAddress",
  "places.nationalPhoneNumber",
  "places.websiteUri",
  "places.businessStatus",
  "places.userRatingCount",
  "places.primaryType",
  "places.types",
].join(",");

const TIPOS_COMIDA = /restaurant|food|meal_|cafe|bakery|ice_cream|acai|sandwich|pizza|hamburger|snack|bar_and_grill|confectionery|dessert/;

export interface LugarMaps extends CandidatoMaps {
  placeId: string;
  aberto: boolean;
}

interface PlaceApi {
  id: string;
  displayName?: { text?: string };
  formattedAddress?: string;
  nationalPhoneNumber?: string;
  websiteUri?: string;
  businessStatus?: string;
  userRatingCount?: number;
  primaryType?: string;
  types?: string[];
}

export async function buscarNoMaps(consulta: string): Promise<LugarMaps[]> {
  const key = Deno.env.get("GOOGLE_PLACES_API_KEY");
  if (!key) return [];
  const res = await fetch("https://places.googleapis.com/v1/places:searchText", {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Goog-Api-Key": key, "X-Goog-FieldMask": CAMPOS },
    body: JSON.stringify({ textQuery: consulta, languageCode: "pt-BR", regionCode: "BR", pageSize: 15 }),
    signal: AbortSignal.timeout(20000),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`Google Places HTTP ${res.status}: ${text.slice(0, 300)}`);
  const data = JSON.parse(text || "{}") as { places?: PlaceApi[] };
  return (data.places ?? [])
    .filter((p) => TIPOS_COMIDA.test([p.primaryType, ...(p.types ?? [])].join(" ")))
    .map((p) => ({
      placeId: p.id,
      nome: p.displayName?.text || "",
      telefone: p.nationalPhoneNumber || null,
      site: p.websiteUri || null,
      endereco: p.formattedAddress || null,
      avaliacoes: p.userRatingCount ?? null,
      aberto: p.businessStatus !== "CLOSED_PERMANENTLY" && p.businessStatus !== "CLOSED_TEMPORARILY",
    }))
    .filter((p) => p.nome);
}
