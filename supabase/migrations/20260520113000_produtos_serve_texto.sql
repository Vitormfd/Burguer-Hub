alter table public.produtos
  add column if not exists serve_texto text;

update public.produtos
set serve_texto = 'Serve 1 pessoa'
where serve_texto is null;

alter table public.produtos
  alter column serve_texto set default 'Serve 1 pessoa';
