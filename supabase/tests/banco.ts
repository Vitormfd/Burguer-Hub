// Banco local para testar as migrations: Postgres real (PGlite) com o mínimo do Supabase
// que elas usam (papéis, auth, storage e cron). Não conversa com nenhum servidor.
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { PGlite } from "@electric-sql/pglite";

const MIGRATIONS = join(dirname(fileURLToPath(import.meta.url)), "..", "migrations");

const BASE_SUPABASE = `
  CREATE ROLE anon NOLOGIN;
  CREATE ROLE authenticated NOLOGIN;
  CREATE ROLE service_role NOLOGIN BYPASSRLS;
  CREATE ROLE supabase_realtime_admin NOLOGIN;
  GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;
  ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO anon, authenticated, service_role;
  ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON SEQUENCES TO anon, authenticated, service_role;
  ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON FUNCTIONS TO anon, authenticated, service_role;

  CREATE SCHEMA auth;
  GRANT USAGE ON SCHEMA auth TO anon, authenticated, service_role;
  CREATE TABLE auth.users (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    email text UNIQUE,
    encrypted_password text,
    raw_user_meta_data jsonb DEFAULT '{}'::jsonb,
    created_at timestamptz NOT NULL DEFAULT now()
  );
  CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS
    $$ SELECT NULLIF(current_setting('request.jwt.sub', true), '')::uuid $$;
  CREATE FUNCTION auth.role() RETURNS text LANGUAGE sql STABLE AS
    $$ SELECT COALESCE(NULLIF(current_setting('request.jwt.role', true), ''), 'anon') $$;
  CREATE FUNCTION auth.jwt() RETURNS jsonb LANGUAGE sql STABLE AS
    $$ SELECT jsonb_build_object('sub', auth.uid(), 'role', auth.role()) $$;
  GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA auth TO anon, authenticated, service_role;

  CREATE SCHEMA storage;
  CREATE TABLE storage.buckets (id text PRIMARY KEY, name text, public boolean DEFAULT false, file_size_limit bigint, allowed_mime_types text[]);
  CREATE TABLE storage.objects (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), bucket_id text, name text, owner uuid);
  ALTER TABLE storage.objects ENABLE ROW LEVEL SECURITY;
  CREATE FUNCTION storage.foldername(name text) RETURNS text[] LANGUAGE sql IMMUTABLE AS $$ SELECT string_to_array(name, '/') $$;

  CREATE SCHEMA cron;
  CREATE TABLE cron.job (jobid bigserial PRIMARY KEY, jobname text, schedule text, command text);
  CREATE FUNCTION cron.schedule(jobname text, schedule text, command text) RETURNS bigint LANGUAGE sql AS
    $$ INSERT INTO cron.job (jobname, schedule, command) VALUES (jobname, schedule, command) RETURNING jobid $$;
  CREATE FUNCTION cron.unschedule(jobname text) RETURNS boolean LANGUAGE sql AS
    $$ DELETE FROM cron.job WHERE cron.job.jobname = unschedule.jobname; SELECT true $$;

  CREATE SCHEMA net;
  CREATE FUNCTION net.http_post(url text, headers jsonb DEFAULT '{}', body jsonb DEFAULT '{}', params jsonb DEFAULT '{}', timeout_milliseconds integer DEFAULT 5000)
    RETURNS bigint LANGUAGE sql AS $$ SELECT 1::bigint $$;

  CREATE SCHEMA extensions;
  CREATE PUBLICATION supabase_realtime;
`;

/** CREATE EXTENSION de algo que o PGlite não traz vira comentário; o teste não depende delas. */
const semExtensoes = (sql: string) =>
  sql.replace(/CREATE EXTENSION[^;]*;/gi, "/* extensão ignorada no teste */");

export async function criarBanco(opcoes: { parar?: string } = {}) {
  const db = new PGlite();
  await db.exec(BASE_SUPABASE);

  const arquivos = readdirSync(MIGRATIONS).filter((f) => f.endsWith(".sql")).sort();
  for (const arquivo of arquivos) {
    if (opcoes.parar && arquivo >= opcoes.parar) break;
    const sql = semExtensoes(readFileSync(join(MIGRATIONS, arquivo), "utf8"));
    try {
      await db.exec(sql);
    } catch (erro) {
      throw new Error(`Migration ${arquivo}: ${erro instanceof Error ? erro.message : String(erro)}`);
    }
  }
  return db;
}

export type Banco = Awaited<ReturnType<typeof criarBanco>>;
type Papel = "anon" | "authenticated" | "service_role";

/** Roda SQL como a API faria: com o papel da requisição e o usuário do token. */
export async function comoApi<T = Record<string, unknown>>(
  db: Banco,
  papel: Papel,
  usuario: string | null,
  sql: string,
  parametros: unknown[] = [],
): Promise<T[]> {
  return db.transaction(async (tx) => {
    await tx.query(`SELECT set_config('request.jwt.sub', $1, true), set_config('request.jwt.role', $2, true)`, [usuario ?? "", papel]);
    await tx.exec(`SET LOCAL ROLE ${papel}`);
    const { rows } = await tx.query<T>(sql, parametros);
    return rows;
  }) as Promise<T[]>;
}

/** Cadastro: grava em auth.users como o Supabase faz, disparando os gatilhos reais. */
export async function cadastrar(db: Banco, email: string, meta: Record<string, unknown> = {}): Promise<string> {
  const { rows } = await db.query<{ id: string }>(
    `INSERT INTO auth.users (email, raw_user_meta_data) VALUES ($1, $2::jsonb) RETURNING id`,
    [email, JSON.stringify({ nome: "Loja Teste", ...meta })],
  );
  return rows[0].id;
}
