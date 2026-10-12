$ErrorActionPreference = "Stop"
$dir = "C:\Users\XC\.zcode\workspace\default\hr_ppt"
New-Item -ItemType Directory -Force -Path "$dir\render" | Out-Null
$pp = New-Object -ComObject PowerPoint.Application
$pres = $pp.Presentations.Open("$dir\hr_plan.pptx", $true, $false, $false)
$n = $pres.Slides.Count
for ($i = 1; $i -le $n; $i++) {
  $idx = "{0:D2}" -f $i
  $pres.Slides.Item($i).Export("$dir\render\slide-$idx.png", "PNG", 1920, 1080)
}
$pres.Close()
$pp.Quit()
[System.Runtime.Interopservices.Marshal]::ReleaseComObject($pp) | Out-Null
Write-Output "EXPORTED $n slides"
