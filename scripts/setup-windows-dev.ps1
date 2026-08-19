# Run this from an elevated (Run as Administrator) PowerShell prompt.
# One-time machine setup for Flutter/Node development on Windows — see
# docs/product/roadmap.md Phase 0 §0.2 for why each of these matters.

Write-Host "Enabling Developer Mode (required for Flutter plugin symlink support)..."
$devModeKey = "HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\AppModelUnlock"
if (-not (Test-Path $devModeKey)) { New-Item -Path $devModeKey -Force | Out-Null }
Set-ItemProperty -Path $devModeKey -Name "AllowDevelopmentWithoutDevLicense" -Value 1 -Type DWord

Write-Host "Enabling NTFS long path support..."
Set-ItemProperty -Path "HKLM:\SYSTEM\CurrentControlSet\Control\FileSystem" -Name "LongPathsEnabled" -Value 1 -Type DWord

Write-Host "Excluding repo and dev SDKs from Windows Defender real-time scanning..."
Add-MpPreference -ExclusionPath "C:\Users\Mostafa Ashraf\Desktop\FORJD"
Add-MpPreference -ExclusionPath "C:\dev"

Write-Host "Enabling WSL2 (required by Docker Desktop)..."
Enable-WindowsOptionalFeature -Online -FeatureName Microsoft-Windows-Subsystem-Linux -NoRestart
Enable-WindowsOptionalFeature -Online -FeatureName VirtualMachinePlatform -NoRestart
wsl --set-default-version 2

Write-Host ""
Write-Host "Done. A REBOOT is required for WSL2 and Developer Mode to take effect." -ForegroundColor Yellow
Write-Host "After rebooting, launch Docker Desktop once manually to finish its" -ForegroundColor Yellow
Write-Host "first-run setup (license acceptance) - this one step needs a human click." -ForegroundColor Yellow
