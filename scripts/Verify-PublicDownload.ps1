param(
  [string]$ManifestPath = "downloads/OuroborosChatGPT.manifest.json",
  [string]$ExpectedSignerSubject = $env:EXPECTED_SIGNER_SUBJECT,
  [string]$ExpectedSignerThumbprint = $env:EXPECTED_SIGNER_THUMBPRINT
)

$ErrorActionPreference = "Stop"

function Fail([string]$Message) {
  Write-Error "public download verification failed: $Message"
  exit 1
}

function Is-PlaceholderSigner([AllowNull()][string]$Value) {
  if ([string]::IsNullOrWhiteSpace($Value)) {
    return $true
  }

  return $Value.Trim() -match "^(0+|n/a|na|none|null|unknown|unsigned|todo|tbd|placeholder|changeme|change-me|cn\s*=\s*(todo|unknown|placeholder|changeme))$"
}

if (-not (Test-Path -LiteralPath $ManifestPath)) {
  Fail "manifest not found at $ManifestPath"
}

$manifest = Get-Content -LiteralPath $ManifestPath -Raw | ConvertFrom-Json

if ($manifest.availability -eq 'disabled') {
  $executables = @(Get-ChildItem -LiteralPath (Split-Path -Parent $ManifestPath) -Filter '*.exe' -File)
  if ($manifest.production -isnot [bool] -or $manifest.production -ne $false -or $null -ne $manifest.file -or $null -ne $manifest.sha256 -or $null -ne $manifest.expectedSignerSubject -or $null -ne $manifest.expectedSignerThumbprint) {
    Fail "disabled downloads require production=false and null file, hash, signer, and signer thumbprint"
  }
  if ($executables.Count -ne 0) {
    Fail "disabled downloads must contain no executable files"
  }
  Write-Host 'public download verification ok: Windows download is safely disabled'
  exit 0
}

if ($manifest.availability -ne 'enabled') {
  Fail "manifest availability must be enabled or disabled"
}

if ($manifest.production -isnot [bool] -or $manifest.production -ne $true) {
  Fail "manifest production must be true before this download can be released"
}

if (Is-PlaceholderSigner $ExpectedSignerSubject) {
  Fail "protected EXPECTED_SIGNER_SUBJECT is missing or a placeholder"
}
if ($ExpectedSignerThumbprint -notmatch '^[A-Fa-f0-9]{40}$') {
  Fail "protected EXPECTED_SIGNER_THUMBPRINT must be a 40-character certificate thumbprint"
}
$ExpectedSignerThumbprint = $ExpectedSignerThumbprint.ToUpperInvariant()
if ($manifest.expectedSignerSubject -cne $ExpectedSignerSubject -or $manifest.expectedSignerThumbprint -ine $ExpectedSignerThumbprint) {
  Fail "manifest signer does not match the protected signing identity"
}
if ($manifest.file -isnot [string] -or $manifest.file -notmatch '^[A-Za-z0-9._-]+\.exe$') {
  Fail "manifest file must be an executable directly under downloads/"
}
if ($manifest.sha256 -isnot [string] -or $manifest.sha256 -cnotmatch '^[a-f0-9]{64}$') {
  Fail "manifest sha256 must be a lowercase SHA-256 digest"
}

$downloadPath = Join-Path (Split-Path -Parent $ManifestPath) $manifest.file
if (-not (Test-Path -LiteralPath $downloadPath)) {
  Fail "download file not found at $downloadPath"
}

$actualSha256 = (Get-FileHash -LiteralPath $downloadPath -Algorithm SHA256).Hash.ToLowerInvariant()
if ($actualSha256 -ne $manifest.sha256) {
  Fail "manifest sha256 $($manifest.sha256) does not match $downloadPath $actualSha256"
}

$signature = Get-AuthenticodeSignature -LiteralPath $downloadPath
if ($signature.Status -ne "Valid") {
  Fail "Authenticode status is $($signature.Status), expected Valid"
}

if ($null -eq $signature.SignerCertificate) {
  Fail "signer certificate is missing"
}

$actualSignerSubject = $signature.SignerCertificate.Subject
if (Is-PlaceholderSigner $actualSignerSubject) {
  Fail "signer subject is empty, zero, or a placeholder"
}

if ($actualSignerSubject -cne $ExpectedSignerSubject) {
  Fail "signer subject '$actualSignerSubject' does not match expected '$ExpectedSignerSubject'"
}

$actualSignerThumbprint = $signature.SignerCertificate.Thumbprint.Replace(' ', '').ToUpperInvariant()
if ($actualSignerThumbprint -cne $ExpectedSignerThumbprint) {
  Fail "signer thumbprint '$actualSignerThumbprint' does not match expected '$ExpectedSignerThumbprint'"
}

if ($null -eq $signature.TimeStamperCertificate) {
  Fail "timestamp certificate is missing"
}

if (Is-PlaceholderSigner $signature.TimeStamperCertificate.Subject) {
  Fail "timestamp certificate subject is empty, zero, or a placeholder"
}

$kitsRoot = Join-Path ${env:ProgramFiles(x86)} 'Windows Kits\10\bin'
if (-not (Test-Path -LiteralPath $kitsRoot)) {
  Fail "Windows SDK signing tools directory was not found"
}
$signTool = Get-ChildItem -Path $kitsRoot -Filter signtool.exe -File -Recurse |
  Where-Object { $_.FullName -match '\\x64\\signtool\.exe$' } |
  Sort-Object FullName -Descending |
  Select-Object -First 1
if ($null -eq $signTool) {
  Fail "Windows SDK x64 signtool.exe was not found"
}
& $signTool.FullName verify /pa /all /v $downloadPath | Out-Null
if ($LASTEXITCODE -ne 0) {
  Fail "signtool trust verification failed"
}

Write-Host "public download verification ok: $downloadPath"
Write-Host "sha256: $actualSha256"
Write-Host "signer: $actualSignerSubject"
Write-Host "signer thumbprint: $actualSignerThumbprint"
Write-Host "timestamp: $($signature.TimeStamperCertificate.Subject)"
