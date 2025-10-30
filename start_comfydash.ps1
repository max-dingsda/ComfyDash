# ComfyDash One-Click Start (Windows PowerShell 5.1+)
# Starts:
#   - Python mini API (mini_server.py) on http://127.0.0.1:8000
#   - Vite dev server (comfydash) on http://localhost:5173
# Then opens the browser.
# Save this file as plain UTF-8 (no BOM is fine). ASCII-only text used.

param(
  [string]$ApiHost = "127.0.0.1",
  [int]$ApiPort = 8000,
  [int]$VitePort = 5173,
  [string]$ComfyUIRoot = "F:\AI\ComfyUI"
)

$ErrorActionPreference = "Stop"

# Paths
$Root      = Split-Path -Parent $MyInvocation.MyCommand.Path
$DashDir   = Join-Path $Root "comfydash"
$ApiScript = Join-Path $Root "mini_server.py"

if (-not (Test-Path $DashDir))   { throw "Folder 'comfydash' not found: $DashDir" }
if (-not (Test-Path $ApiScript)) { throw "File 'mini_server.py' not found: $ApiScript" }

Write-Host "Starting API $($ApiHost):$($ApiPort) ..."
$apiArgs = @($ApiScript, "--host", $ApiHost, "--port", $ApiPort.ToString())
Start-Process -FilePath "python" -ArgumentList $apiArgs -WorkingDirectory $Root -WindowStyle Minimized

Write-Host "Starting Vite dev server on port $VitePort ..."
# Use cmd.exe to avoid npm.ps1 being opened in an editor
$npmCmd = "/c npm run dev -- --port $VitePort"
Start-Process -FilePath "cmd.exe" -ArgumentList $npmCmd -WorkingDirectory $DashDir -WindowStyle Minimized

function Test-HttpReady {
  param([string]$Url, [int]$TimeoutSec = 25)
  $t0 = Get-Date
  while ((Get-Date) - $t0 -lt (New-TimeSpan -Seconds $TimeoutSec)) {
    try {
      $r = Invoke-WebRequest -Uri $Url -UseBasicParsing -TimeoutSec 2
      if ($r.StatusCode -ge 200 -and $r.StatusCode -lt 500) { return $true }
    } catch {
      Start-Sleep -Milliseconds 500
    }
  }
  return $false
}

$apiUrl  = "http://$($ApiHost):$($ApiPort)/health"
$viteUrl = "http://localhost:$($VitePort)"

[void](Test-HttpReady -Url $apiUrl  -TimeoutSec 25)
[void](Test-HttpReady -Url $viteUrl -TimeoutSec 25)

Write-Host "Opening browser ..."
Start-Process $viteUrl

Write-Host "ComfyDash started."
Write-Host "Note: ComfyUI root is '$ComfyUIRoot' (settable in the UI)."
