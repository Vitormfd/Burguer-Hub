-- Slides do carrossel com vínculo opcional a produto e/ou promoção de campanha.
-- Formato: [{ "url": "...", "produto_id": null, "promocao_id": null }, ...]

alter table public.configuracoes
add column if not exists carrossel_slides jsonb not null default '[]'::jsonb;

-- Migra URLs legadas de carrossel_imagens (text[]) para carrossel_slides
update public.configuracoes
set carrossel_slides = coalesce(
  (
    select jsonb_agg(jsonb_build_object('url', u, 'produto_id', null, 'promocao_id', null))
    from unnest(carrossel_imagens) as u
    where coalesce(u, '') <> ''
  ),
  '[]'::jsonb
)
where coalesce(jsonb_array_length(carrossel_slides), 0) = 0
  and coalesce(array_length(carrossel_imagens, 1), 0) > 0;

comment on column public.configuracoes.carrossel_slides is
  'Slides do carrossel público: url + produto_id/promocao_id opcionais para CTA de adicionar ao carrinho';
