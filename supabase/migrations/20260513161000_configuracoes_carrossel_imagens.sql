alter table public.configuracoes
add column if not exists carrossel_imagens text[] not null default '{}';

update public.configuracoes
set carrossel_imagens = case
  when banner_url is not null and banner_url <> '' then array[banner_url]
  else carrossel_imagens
end
where coalesce(array_length(carrossel_imagens, 1), 0) = 0;