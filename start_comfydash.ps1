# ComfyDash One‑Click Start (Windows PowerShell 5.1+)
# Startet:
# - Python Mini‑API (mini_server.py) auf http://127.0.0.1:8000
# - Vite Dev Server im Ordner "comfydash" auf http://localhost:5173
# Öffnet anschließend den Browser.


param(
[string]$ApiHost = "127.0.0.1",
[int]$ApiPort = 8000,
[int]$VitePort = 5173,
[string]$ComfyUIRoot = "F:\\AI\\ComfyUI" # optionaler Hinweis; im UI setzbar
)


$ErrorActionPreference = "Stop"


# Projektpfade
$Root = Split-Path -Parent $MyInvocation.MyCommand.Path
$DashDir = Join-Path $Root "comfydash"
$ApiScript = Join-Path $Root "mini_server.py"


if (-not (Test-Path $DashDir)) { throw "Ordner 'comfydash' nicht gefunden: $DashDir" }
if (-not (Test-Path $ApiScript)) { throw "Datei 'mini_server.py' nicht gefunden: $ApiScript" }


Write-Host "▶ Starte API $($ApiHost):$($ApiPort) …"
$apiArgs = @($ApiScript, "--host", $ApiHost, "--port", $ApiPort.ToString())
Start-Process -FilePath "python" -ArgumentList $apiArgs -WorkingDirectory $Root -WindowStyle Minimized


Write-Host "▶ Starte Vite Dev Server (Port $VitePort) …"
Start-Process -FilePath "npm" -ArgumentList @("run","dev","--","--port", $VitePort.ToString()) -WorkingDirectory $DashDir -WindowStyle Minimized


function Test-HttpReady {
param([string]$Url, [int]$TimeoutSec = 25)
$t0 = Get-Date
while ((Get-Date) - $t0 -lt (New-TimeSpan -Seconds $TimeoutSec)) {
try {
$r = Invoke-WebRequest -Uri $Url -UseBasicParsing -TimeoutSec 2
if ($r.StatusCode -ge 200 -and $r.StatusCode -lt 500) { return $true }
} catch { Start-Sleep -Milliseconds 500 }
}
return $false
}


# ACHTUNG: Variablen vor Doppelpunkten via $() sub‑exprimieren, sonst kann PowerShell '$Var:' als Scope interpretieren
$apiUrl = "http://$($ApiHost):$($ApiPort)/health"
$viteUrl = "http://localhost:$($VitePort)"


[void](Test-HttpReady -Url $apiUrl -TimeoutSec 25)
[void](Test-HttpReady -Url $viteUrl -TimeoutSec 25)


Write-Host "▶ Öffne Browser …"
Start-Process $viteUrl


Write-Host "✔ ComfyDash gestartet."
Write-Host "Hinweis: ComfyUI Root ist '$ComfyUIRoot' (im UI einstellbar)."