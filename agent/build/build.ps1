# Builds the Windows agent binary with the AV/EDR mitigations discussed in
# the project docs: no UPX/packer, no aggressive symbol stripping, and an
# embedded version-info resource (company/product/description) so the exe
# doesn't look "anonymous" to heuristic scanners. Also builds the Inno Setup
# installer and code-signs everything, both optional and both skipped with
# a warning (not a build failure) if their tool/config isn't present - see
# agent/README.md's "Instalador" and "Assinatura de código" sections.
#
# Requires goversioninfo to embed the resource:
#   go install github.com/josephspurrier/goversioninfo/cmd/goversioninfo@latest
# Requires Inno Setup 6 (iscc on PATH) to build the installer:
#   https://jrsoftware.org/isdl.php
# Requires signtool (Windows SDK, usually already on PATH via a VS/SDK
# install) plus $env:CODE_SIGN_CERT_THUMBPRINT to sign both artifacts.
param(
	[string]$Version = "0.1.0"
)

Push-Location "$PSScriptRoot\.."

if (Get-Command goversioninfo -ErrorAction SilentlyContinue) {
	goversioninfo -o cmd/agent/resource.syso build/versioninfo.json
} else {
	Write-Warning "goversioninfo not found - building without embedded Windows version info."
	Write-Warning "Install with: go install github.com/josephspurrier/goversioninfo/cmd/goversioninfo@latest"
}

$env:CGO_ENABLED = "0"
go build -trimpath -ldflags "-X main.version=$Version" -o dist/omniprint-agent.exe ./cmd/agent

function Sign-Artifact([string]$Path) {
	if (-not $env:CODE_SIGN_CERT_THUMBPRINT) {
		return
	}
	if (-not (Get-Command signtool -ErrorAction SilentlyContinue)) {
		Write-Warning "CODE_SIGN_CERT_THUMBPRINT is set but signtool wasn't found on PATH - skipping signing of $Path."
		return
	}
	$timestampServer = if ($env:CODE_SIGN_TIMESTAMP_URL) { $env:CODE_SIGN_TIMESTAMP_URL } else { "http://timestamp.digicert.com" }
	signtool sign /sha1 $env:CODE_SIGN_CERT_THUMBPRINT /tr $timestampServer /td sha256 /fd sha256 $Path
	if ($LASTEXITCODE -ne 0) {
		throw "signtool failed signing $Path"
	}
}

Sign-Artifact "dist/omniprint-agent.exe"

# PATH first, then Inno Setup's default install locations - its installer
# doesn't add itself to PATH, and a per-user install (no admin) lands under
# LOCALAPPDATA, which is how it's installed on the machine that builds the
# real releases.
$iscc = (Get-Command iscc -ErrorAction SilentlyContinue).Source
if (-not $iscc) {
	$iscc = @(
		"$env:LOCALAPPDATA\Programs\Inno Setup 6\ISCC.exe",
		"${env:ProgramFiles(x86)}\Inno Setup 6\ISCC.exe",
		"$env:ProgramFiles\Inno Setup 6\ISCC.exe"
	) | Where-Object { Test-Path $_ } | Select-Object -First 1
}

if ($iscc) {
	& $iscc "/DMyAppVersion=$Version" installer/omniprint-agent.iss
	if ($LASTEXITCODE -ne 0) {
		throw "iscc failed compiling the installer"
	}
	Sign-Artifact "dist/OmniPrintAgentSetup-$Version.exe"
} else {
	Write-Warning "iscc (Inno Setup Compiler) not found - skipping installer build."
	Write-Warning "Install Inno Setup 6 from https://jrsoftware.org/isdl.php and add its folder to PATH."
}

Pop-Location
