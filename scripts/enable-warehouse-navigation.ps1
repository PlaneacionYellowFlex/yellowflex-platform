$ErrorActionPreference = "Stop"
$Path = Join-Path (Get-Location) "components\topbar.tsx"
$Content = Get-Content -LiteralPath $Path -Raw
$Pattern = '\{\s*label:\s*"Almac[^"]*",\s*description:\s*"Inventarios y movimientos",\s*keywords:\s*"almacen inventario movimientos materiales",\s*comingSoon:\s*true\s*\},'
$Replacement = '{ label: "Almacén", description: "Inventarios y movimientos", href: "/modules/warehouse", keywords: "almacen inventario movimientos materiales ubicaciones existencias" },'
$Updated = [regex]::Replace($Content,$Pattern,$Replacement,1)
if($Updated -eq $Content){throw "No se encontró la entrada pendiente de Almacén. No se modificó topbar.tsx."}
Set-Content -LiteralPath $Path -Value $Updated -Encoding UTF8
Write-Host "OK: Almacén habilitado en components\topbar.tsx" -ForegroundColor Green
