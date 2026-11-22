# Set up the local ShapePS extension from this GitHub Desktop checkout.
$ErrorActionPreference = 'Stop'
$repo = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$manifest = Join-Path $repo 'CSXS\manifest.xml'
if (-not (Test-Path -LiteralPath $manifest -PathType Leaf)) {
    throw 'Run this script from the tools folder in the ShapePS checkout.'
}
if ($repo.Contains('#')) {
    throw 'Move the ShapePS checkout to a path without a # character.'
}

$extensions = Join-Path $env:APPDATA 'Adobe\CEP\extensions'
$installed = Join-Path $extensions 'com.nickroy.shapeps.local'
New-Item -ItemType Directory -Path $extensions -Force | Out-Null
$existing = Get-Item -LiteralPath $installed -Force -ErrorAction SilentlyContinue
if ($null -eq $existing) {
    New-Item -ItemType Junction -Path $installed -Target $repo | Out-Null
} elseif ($existing.LinkType -ne 'Junction' -or (@($existing.Target) -notcontains $repo)) {
    throw "A ShapePS folder or link already exists at $installed. Keep it as a backup and move it out of the extensions folder before installing here."
}

# Adobe CEP 12 uses this per-user development setting for unpacked extensions.
$cepPreference = 'HKCU:\Software\Adobe\CSXS.12'
if (-not (Test-Path -LiteralPath $cepPreference)) {
    New-Item -Path $cepPreference | Out-Null
}
New-ItemProperty -Path $cepPreference -Name PlayerDebugMode -Value '1' -PropertyType String -Force | Out-Null

Write-Host 'ShapePS is linked to this checkout.'
Write-Host 'Restart Photoshop once, then open Window > Extensions (Legacy) > ShapePS.'
