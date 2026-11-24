param([switch]$VerifyOnly)
$ErrorActionPreference = 'Stop'
$qaUrl = [Environment]::GetEnvironmentVariable('YELLOWFLEX_TEST_DATABASE_URL', 'User')
if (-not $qaUrl) { $qaUrl = [Environment]::GetEnvironmentVariable('YELLOWFLEX_TEST_DATABASE_URL', 'Machine') }
if (-not $qaUrl) { throw 'Falta la variable exclusiva de pruebas.' }
$qaUri = [Uri]$qaUrl
if ($qaUri.Scheme -notin @('postgres','postgresql') -or $qaUri.Host -cne '127.0.0.1' -or $qaUri.Port -ne 55432 -or $qaUri.AbsolutePath -cne '/yellowflex_restore_test' -or $qaUri.Query -or $qaUri.Fragment) { throw 'Destino de prueba rechazado.' }
$qaParts = $qaUri.UserInfo.Split(':',2)
if ($qaParts.Count -ne 2) { throw 'Falta la credencial local.' }
$qaNames = @('PGPASSWORD','PGOPTIONS')
$qaPrevious = @{}
foreach ($qaName in $qaNames) { $qaPrevious[$qaName] = [Environment]::GetEnvironmentVariable($qaName, 'Process') }
try {
 $env:PGPASSWORD = [Uri]::UnescapeDataString($qaParts[1])
 $env:PGOPTIONS = '-c default_transaction_read_only=on'
 $qaPsql = 'C:/Program Files/PostgreSQL/17/bin/psql.exe'
 $qaIdentitySql = "SELECT json_build_object('database',current_database(),'host',host(inet_server_addr()),'port',inet_server_port(),'read_only',current_setting('transaction_read_only'),'foreign_servers',(SELECT count(*) FROM pg_foreign_server));"
 $qaOutput = & $qaPsql -X -w -h 127.0.0.1 -p 55432 -U ([Uri]::UnescapeDataString($qaParts[0])) -d yellowflex_restore_test -v ON_ERROR_STOP=1 -t -A -c $qaIdentitySql
 if ($LASTEXITCODE -ne 0) { throw 'No fue posible verificar la base local; no se habilitan escrituras.' }
 $qaIdentity = ($qaOutput -join '') | ConvertFrom-Json
 if ($qaIdentity.database -cne 'yellowflex_restore_test' -or $qaIdentity.host -cne '127.0.0.1' -or $qaIdentity.port -ne 55432 -or $qaIdentity.read_only -ne 'on' -or $qaIdentity.foreign_servers -ne 0) { throw 'Identidad o aislamiento rechazados.' }
 $qaIdentity | ConvertTo-Json -Compress
 $qaSchemaSql = @'
SELECT json_build_object(
 'applied_names',(SELECT json_agg(migration_name ORDER BY migration_name) FROM "_prisma_migrations" WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL),
 'migrations',(SELECT count(*) FROM "_prisma_migrations" WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL),
 'tables_ready', to_regclass('public."InventoryCustodyOperation"') IS NOT NULL AND to_regclass('public."WarehouseStockOperation"') IS NOT NULL AND to_regclass('public."CorporateSession"') IS NOT NULL AND to_regclass('public."CorporateModulePermission"') IS NOT NULL AND to_regclass('public."CorporatePermissionAudit"') IS NOT NULL,
 'password_flag', EXISTS(SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='User' AND column_name='passwordMustChange'),
 'email_nullable', EXISTS(SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='User' AND column_name='email' AND is_nullable='YES'));
'@
 $qaSchemaOutput = & $qaPsql -X -w -h 127.0.0.1 -p 55432 -U ([Uri]::UnescapeDataString($qaParts[0])) -d yellowflex_restore_test -v ON_ERROR_STOP=1 -t -A -c $qaSchemaSql
 if ($LASTEXITCODE -ne 0) { throw 'No se pudo verificar el esquema restaurado.' }
 $qaSchema = ($qaSchemaOutput -join '') | ConvertFrom-Json
 $qaApplied = @($qaSchema.applied_names)
 $qaLocal = @(Get-ChildItem -LiteralPath (Join-Path $PSScriptRoot '../prisma/migrations') -Directory | Select-Object -ExpandProperty Name)
 $qaPending = @($qaLocal | Where-Object { $_ -notin $qaApplied })
 [PSCustomObject]@{migrations=$qaSchema.migrations; tables_ready=$qaSchema.tables_ready; password_flag=$qaSchema.password_flag; email_nullable=$qaSchema.email_nullable; pending_local_migrations=$qaPending} | ConvertTo-Json -Compress
 if (-not $qaSchema.tables_ready -or -not $qaSchema.password_flag -or -not $qaSchema.email_nullable) { throw 'El esquema aislado no contiene los requisitos de las pruebas. No se habilitan escrituras.' }

} finally {
 foreach ($qaName in $qaNames) { [Environment]::SetEnvironmentVariable($qaName, $qaPrevious[$qaName], 'Process') }
}
