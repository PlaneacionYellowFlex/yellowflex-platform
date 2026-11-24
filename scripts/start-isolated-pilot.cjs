const fs = require('node:fs');
const { spawn } = require('node:child_process');
const { configureIsolatedConnection, assertIsolatedIdentity } = require('../tests/helpers/isolated-postgres.cjs');
async function main() {
  const url = configureIsolatedConnection();
  const { PrismaClient } = require('@prisma/client');
  const db = new PrismaClient({ datasourceUrl: url });
  let foodReference;
  try {
    await assertIsolatedIdentity(db);
    if (fs.existsSync('data/qa-food-reference.json')) {
      const food = JSON.parse(fs.readFileSync('data/qa-food-reference.json', 'utf8'));
      if (food.database !== 'yellowflex_restore_test') throw new Error('Referencia QA rechazada');
      foodReference = food.referenceDate;
      process.env.FOOD_QA_ISOLATED = '1';
      process.env.FOOD_QA_REFERENCE_DATE = foodReference;
      const ts = require('typescript');
      const source = ts.transpileModule(fs.readFileSync('lib/food-services/reference-date.ts', 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText;
      const mod = { exports: {} };
      new Function('require', 'exports', source)(id => { if (id === 'server-only') return {}; throw new Error('Dependencia de fecha QA rechazada'); }, mod.exports);
      mod.exports.getFoodReferenceDate();
      console.log('Food Services usa una referencia QA ficticia de servidor: ' + foodReference);
    }
    const manifest = JSON.parse(fs.readFileSync('data/qa-pilot-local-manifest.json', 'utf8'));
    if (manifest.database !== 'yellowflex_restore_test' || manifest.profiles.length !== 6) throw new Error('Manifiesto local inválido');
    const count = await db.user.count({ where: { id: { in: manifest.profiles.map(profile => profile.userId) }, active: true } });
    if (count !== 6) throw new Error('Faltan perfiles locales');
    const migrations = await db.$queryRawUnsafe('SELECT count(*)::int AS count FROM "_prisma_migrations" WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL');
    if (migrations[0].count !== 29) throw new Error('Esquema local no validado');
    const columns = await db.$queryRawUnsafe("SELECT is_nullable FROM information_schema.columns WHERE table_schema='public' AND table_name='User' AND column_name='email'");
    if (columns[0]?.is_nullable !== 'YES') throw new Error('User.email incompatible');
  } finally { await db.$disconnect(); }
  console.log('Aplicación de piloto: http://127.0.0.1:3100. PostgreSQL local verificado; Storage externo deshabilitado.');
  const child = spawn(process.execPath, ['node_modules/next/dist/bin/next', 'dev', '--hostname', '127.0.0.1', '--port', '3100'], {
    stdio: 'inherit', env: { ...process.env, DATABASE_URL: url, DIRECT_URL: url,
      ...(foodReference ? { FOOD_QA_ISOLATED: '1', FOOD_QA_REFERENCE_DATE: foodReference } : {}), NEXT_TELEMETRY_DISABLED: '1',
      SUPABASE_URL: 'http://127.0.0.1:1', SUPABASE_SECRET_KEY: 'qa-storage-disabled', SUPABASE_PURCHASE_BUCKET: 'qa-disabled',
      NEXT_PUBLIC_SUPABASE_URL: 'http://127.0.0.1:1', NEXT_PUBLIC_SUPABASE_ANON_KEY: 'qa-disabled',
    },
  });
  child.on('exit', code => { process.exitCode = code ?? 1; });
  child.on('error', () => { console.error('No se pudo iniciar la aplicación local'); process.exitCode = 1; });
}
main().catch(() => { console.error('DETENIDO: la aplicación no se inicia porque falló una comprobación local.'); process.exitCode = 1; });
