param(
  [string]$In = "C:\Users\XC\.zcode\workspace\default\xuandao-ppt\out\deck.pptx",
  [string]$OutDir = "C:\Users\XC\.zcode\workspace\default\xuandao-ppt\out\render"
)
$ErrorActionPreference = "Stop"
if (!(Test-Path $OutDir)) { New-Item -ItemType Directory -Path $OutDir | Out-Null }
$app = New-Object -ComObject PowerPoint.Application
try {
  $pres = $app.Presentations.Open($In, $true, $false, $false)
  $n = $pres.Slides.Count
  Write-Output "slides: $n"
  for ($i = 1; $i -le $n; $i++) {
    $p = Join-Path $OutDir ("slide-{0:d2}.png" -f $i)
    $pres.Slides.Item($i).Export($p, "PNG", 1920, 1080)
  }
  $pres.Close()
  Write-Output "exported to $OutDir"
} finally {
  $app.Quit()
  [System.Runtime.InteropServices.Marshal]::ReleaseComObject($app) | Out-Null
}
