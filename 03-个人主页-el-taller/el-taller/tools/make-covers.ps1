Add-Type -AssemblyName System.Drawing
# 三张作品封面统一裁成 640x320 (2:1) JPEG，输出到 el-taller\assets\
$outDir = 'C:\Users\XC\.zcode\workspace\default\el-taller\assets'
if (-not (Test-Path $outDir)) { New-Item -ItemType Directory -Path $outDir | Out-Null }

function Save-Cover($srcPath, $cropX, $cropY, $cropW, $cropH, $outName) {
  $src = [System.Drawing.Image]::FromFile($srcPath)
  $bmp = New-Object System.Drawing.Bitmap(640, 320)
  $g = [System.Drawing.Graphics]::FromImage($bmp)
  $g.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
  $g.DrawImage($src, (New-Object System.Drawing.Rectangle(0,0,640,320)), (New-Object System.Drawing.Rectangle($cropX,$cropY,$cropW,$cropH)), [System.Drawing.GraphicsUnit]::Pixel)
  $g.Dispose()
  $enc = [System.Drawing.Imaging.ImageCodecInfo]::GetImageEncoders() | Where-Object { $_.MimeType -eq 'image/jpeg' }
  $ep = New-Object System.Drawing.Imaging.EncoderParameters(1)
  $ep.Param[0] = New-Object System.Drawing.Imaging.EncoderParameter([System.Drawing.Imaging.Encoder]::Quality, [long]88)
  $out = Join-Path $outDir $outName
  $bmp.Save($out, $enc, $ep); $bmp.Dispose(); $src.Dispose()
  Write-Output ($outName + ' bytes=' + (Get-Item $out).Length)
}

# 1) Kindle 墨水屏看板：顶部 天气+时钟+GLM用量带 (758 宽, 2:1 裁 758x379)
Save-Cover 'C:\Users\XC\.zcode\workspace\default\kindle-pw2-mod\tools\shot-v091d.png' 0 18 758 379 'cover-kindle.jpg'

# 2) GLM 挂件：玻璃卡 GLM Coding Plan 特写 (rp-t14 右侧面板顶部 2:1 带)
Save-Cover 'C:\Users\XC\.zcode\workspace\default\glm-widget\rp-t14.png' 408 0 267 134 'cover-widget.jpg'

# 3) 海报产线：成片海报居中 2:1 裁
Save-Cover 'C:\Users\XC\.zcode\workspace\default\海报系列-Seed知识手册\s3-01.png' 0 48 1344 672 'cover-poster.jpg'
