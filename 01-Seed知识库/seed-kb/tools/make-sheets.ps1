Add-Type -AssemblyName System.Drawing
$dir = "C:\Users\XC\.zcode\workspace\default\seed-kb\tools\imgs"
$out = "C:\Users\XC\.zcode\workspace\default\seed-kb\tools\sheets"
New-Item -ItemType Directory -Force -Path $out | Out-Null
$files = Get-ChildItem $dir -Filter *.jpg | Sort-Object Name
$thumbW = 300; $cols = 3; $rows = 2; $per = $cols * $rows
$cellH = 250
$sheetIdx = 0
for ($s = 0; $s -lt $files.Count; $s += $per) {
  $bmp = New-Object System.Drawing.Bitmap ($cols * $thumbW), ($rows * $cellH)
  $g = [System.Drawing.Graphics]::FromImage($bmp)
  $g.Clear([System.Drawing.Color]::White)
  for ($i = 0; $i -lt $per -and ($s + $i) -lt $files.Count; $i++) {
    $f = $files[$s + $i]
    $img = [System.Drawing.Image]::FromFile($f.FullName)
    $scale = [Math]::Min($thumbW / $img.Width, 215 / $img.Height)
    $tw = [int]($img.Width * $scale); $th = [int]($img.Height * $scale)
    $cx = ($i % $cols) * $thumbW; $cy = [int][Math]::Floor($i / $cols) * $cellH
    $g.DrawImage($img, $cx, $cy + 28, $tw, $th)
    $font = New-Object System.Drawing.Font ('Arial', 13)
    $g.DrawString($f.BaseName, $font, [System.Drawing.Brushes]::Red, ($cx + 4), ($cy + 4))
    $img.Dispose()
  }
  $sheetIdx++
  $name = "sheet_" + $sheetIdx.ToString("00") + ".jpg"
  $bmp.Save(($out + "\" + $name), [System.Drawing.Imaging.ImageFormat]::Jpeg)
  $g.Dispose(); $bmp.Dispose()
}
Write-Host "sheets: $sheetIdx"
