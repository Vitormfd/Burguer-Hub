insert into storage.buckets (id, name, public) values ('loja', 'loja', true)
on conflict (id) do nothing;

create policy "Loja pública leitura"
on storage.objects for select
to anon, authenticated
using (bucket_id = 'loja');

create policy "Autenticados upload loja"
on storage.objects for insert
to authenticated
with check (bucket_id = 'loja');

create policy "Autenticados atualizam loja"
on storage.objects for update
to authenticated
using (bucket_id = 'loja');

create policy "Autenticados deletam loja"
on storage.objects for delete
to authenticated
using (bucket_id = 'loja');