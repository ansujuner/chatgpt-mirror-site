param(
  [Parameter(Mandatory = $true)]
  [string]$OutputPath
)

$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName UIAutomationClient
Add-Type -AssemblyName UIAutomationTypes
Add-Type -AssemblyName System.Drawing

$edge = Get-Process msedge -ErrorAction Stop |
  Where-Object { $_.MainWindowHandle -ne 0 } |
  Select-Object -First 1

if (-not $edge) {
  throw 'No visible Edge window was found.'
}

$element = [System.Windows.Automation.AutomationElement]::FromHandle($edge.MainWindowHandle)
$rect = $element.Current.BoundingRectangle
$left = [int][Math]::Round($rect.X)
$top = [int][Math]::Round($rect.Y)
$width = [int][Math]::Round($rect.Width)
$height = [int][Math]::Round($rect.Height)

$bitmap = New-Object System.Drawing.Bitmap $width, $height
$graphics = [System.Drawing.Graphics]::FromImage($bitmap)
$graphics.CopyFromScreen($left, $top, 0, 0, $bitmap.Size)

$resolved = [System.IO.Path]::GetFullPath($OutputPath)
[System.IO.Directory]::CreateDirectory([System.IO.Path]::GetDirectoryName($resolved)) | Out-Null
$bitmap.Save($resolved, [System.Drawing.Imaging.ImageFormat]::Png)
$graphics.Dispose()
$bitmap.Dispose()

Write-Output "$resolved ($width x $height)"
