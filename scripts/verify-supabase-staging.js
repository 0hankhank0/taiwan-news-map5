const fs = require("fs");
const path = require("path");
const { Client } = require("pg");

if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is required");
const apply = process.argv.includes("--apply");
const migrationPath = path.join(__dirname, "..", "supabase", "migrations", "20260718_fix_publish_event_candidate.sql");
const db = new Client({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });

async function state() {
  const [functions, constraint, columns] = await Promise.all([
    db.query(`select p.oid::regprocedure::text as signature, pg_get_functiondef(p.oid) as definition,
      has_function_privilege('anon', p.oid, 'execute') as anon_execute,
      has_function_privilege('authenticated', p.oid, 'execute') as authenticated_execute,
      has_function_privilege('service_role', p.oid, 'execute') as service_role_execute
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public' and p.proname in ('publish_event_candidate', 'publish_event_candidate_test')
      order by signature`),
    db.query(`select conname, pg_get_constraintdef(oid) as definition from pg_constraint
      where conrelid = 'public.official_events'::regclass and contype = 'u'`),
    db.query(`select column_name from information_schema.columns
      where table_schema = 'public' and table_name = 'event_candidates'
        and column_name in ('candidate_id', 'status', 'published_event_id') order by column_name`),
  ]);
  return {
    functions: functions.rows.map(({ definition, ...row }) => ({ ...row, hasRollbackHook: definition.includes('TEST_ONLY_ROLLBACK_AFTER_EVENT_INSERT') })),
    uniqueConstraints: constraint.rows,
    candidateColumns: columns.rows.map((row) => row.column_name),
  };
}

(async () => {
  await db.connect();
  let before = await state();
  const canonical = before.functions.find((item) => item.signature.startsWith('publish_event_candidate('));
  const test = before.functions.find((item) => item.signature.startsWith('publish_event_candidate_test('));
  const current = canonical && !canonical.hasRollbackHook && test?.hasRollbackHook
    && !canonical.anon_execute && !canonical.authenticated_execute && canonical.service_role_execute
    && !test.anon_execute && !test.authenticated_execute && test.service_role_execute;
  if (!current && apply) {
    await db.query(fs.readFileSync(migrationPath, "utf8"));
    before = await state();
  }
  console.log(JSON.stringify({ applied: current || apply, state: before }, null, 2));
  if (!(current || apply)) process.exitCode = 2;
})().catch((error) => { console.error(`Supabase staging verification failed: ${error.message}`); process.exitCode = 1; })
  .finally(() => db.end());
