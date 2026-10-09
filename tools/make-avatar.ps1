Add-Type -AssemblyName System.Drawing
# avatar-main.jpg (108x170 portrait) -> center-top square crop -> 216x216 JPEG -> base64 one-liner
$src = [System.Drawing.Image]::FromFile('C:\Users\XC\.zcode\workspace\default\passport-backup\avatar-main.jpg')
$sq = [Math]::Min($src.Width, $src.Height)
$cropY = [int](($src.Height - $sq) * 0.18)   # bias toward the face (upper part)
$bmp = New-Object System.Drawing.Bitmap(216, 216)
$g = [System.Drawing.Graphics]::FromImage($bmp)
$g.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
$g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode].HighQuality
$g.DrawImage($src, (New-Object System.Drawing.Rectangle(0,0,216,216)), (New-Object System.Drawing.Rectangle(0,$cropY,$sq,$sq)), [System.Drawing.GraphicsUnit]::Pixel)
$g.Dispose(); $src.Dispose()
$enc = [System.Drawing.Imaging.ImageCodecInfo]::GetImageEncoders() | Where-Object { $_.MimeType -eq 'image/jpeg' }
$ep = New-Object System.Drawing.Imaging.EncoderParameters(1)
$ep.Param[0] = New-Object System.Drawing.Imaging.EncoderParameter([System.Drawing.Imaging.Encoder]::Quality, [long]88)
$out = 'C:\Users\XC\.zcode\workspace\default\el-taller\tools\avatar-216.jpg'
$bmp.Save($out, $enc, $ep); $bmp.Dispose()
$b64 = [Convert]::ToBase64String([IO.File]::ReadAllBytes($out))
[IO.File]::WriteAllText('C:\Users\XC\.zcode\workspace\default\el-taller\tools\avatar-216.b64.txt', $b64)
Write-Output ('OK bytes=' + (Get-Item $out).Length + ' b64len=' + $b64.Length)
