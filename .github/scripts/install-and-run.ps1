# Kurulum dosyasını sessizce kurar, uygulamayı açar ve açık kaldığını doğrular.
# Çıktı: kurulu exe'nin yolu ($env:GITHUB_OUTPUT içine app_exe olarak yazılır).
$ErrorActionPreference = 'Stop'

$setup = Join-Path $PWD 'dist\AULA-F75-Setup.exe'
Write-Host "Installing $setup"
$p = Start-Process -FilePath $setup -ArgumentList '/S' -Wait -PassThru
if ($p.ExitCode -ne 0) { throw "Installer exited with code $($p.ExitCode)" }

$exe = Get-ChildItem -Path (Join-Path $env:LOCALAPPDATA 'Programs') -Recurse -Filter 'AULA F75.exe' -ErrorAction SilentlyContinue | Select-Object -First 1
if (-not $exe) { throw 'Installed AULA F75.exe not found' }
Write-Host "Installed at $($exe.FullName)"

Start-Process -FilePath $exe.FullName
Start-Sleep -Seconds 20
$running = Get-Process -Name 'AULA F75' -ErrorAction SilentlyContinue
if (-not $running) { throw 'App is not running 20 seconds after launch' }
Write-Host "App is running ($($running.Count) processes)"

if ($env:GITHUB_OUTPUT) { "app_exe=$($exe.FullName)" | Out-File -FilePath $env:GITHUB_OUTPUT -Append -Encoding utf8 }
