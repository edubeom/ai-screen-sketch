<#
  Windows 에 로그인하면 스케치 도구 서버(WSL 의 npm run dev, 5173)를 저절로 켠다.  (관리자 권한 필요 없음)

    powershell -ExecutionPolicy Bypass -File scripts\windows\autostart.ps1            # 등록하고 지금 켜기
    powershell -ExecutionPolicy Bypass -File scripts\windows\autostart.ps1 -Remove    # 등록 지우기

  작업 스케줄러에 "ai-screen-sketch server" 로 등록된다. 창 없이 돈다.
#>
param(
  [string]$Distro = 'Ubuntu-24.04',
  [string]$ProjectDir = '~/project/ai-screen-sketch',
  [switch]$Remove
)
$ErrorActionPreference = 'Stop'
$name = 'ai-screen-sketch server'

if ($Remove) {
  Unregister-ScheduledTask -TaskName $name -Confirm:$false -ErrorAction SilentlyContinue
  Write-Host "지움: 로그인할 때 서버를 켜지 않습니다"
  return
}

# bash -i: nvm(node)이 .bashrc 에서 잡히도록
$wsl = "wsl.exe -d $Distro -- bash -ic 'cd $ProjectDir && npm run dev'"
$action = New-ScheduledTaskAction -Execute 'powershell.exe' -Argument "-NoProfile -WindowStyle Hidden -Command `"$wsl`""
$trigger = New-ScheduledTaskTrigger -AtLogOn -User $env:USERNAME
$settings = New-ScheduledTaskSettingsSet -ExecutionTimeLimit ([TimeSpan]::Zero) -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -MultipleInstances IgnoreNew
Register-ScheduledTask -TaskName $name -Action $action -Trigger $trigger -Settings $settings -Description 'AI 화면 스케치 개발 서버 (WSL, 5173)' -Force | Out-Null
Start-ScheduledTask -TaskName $name
Write-Host "등록함: 로그인하면 서버가 켜집니다. 지금도 켰습니다 -- 잠시 뒤 http://localhost:5173"
