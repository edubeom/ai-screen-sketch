#Requires -RunAsAdministrator
<#
  공유기 안의 다른 기기(노트북·태블릿)에서 스케치 도구를 열 수 있게 한다.  (관리자 PowerShell 에서 실행)

    powershell -ExecutionPolicy Bypass -File scripts\windows\lan-access.ps1            # 켜기
    powershell -ExecutionPolicy Bypass -File scripts\windows\lan-access.ps1 -Remove    # 끄기

  - 이 PC 의 공유기 주소:5173 → 127.0.0.1:5173 으로 넘긴다. WSL 이 localhost 로 넘겨 주므로
    재부팅으로 WSL 내부 주소가 바뀌어도 그대로 된다.
  - 방화벽은 "개인(Private)" 네트워크에서만 연다. 공용 와이파이에서는 열리지 않는다.
  - 로그인이 없는 도구라 같은 공유기에 있는 사람은 누구나 열 수 있다. 설계는 각자 브라우저에만 저장되어
    다른 사람의 설계는 보이지 않는다.
#>
param(
  [int]$Port = 5173,
  [string]$ListenAddress,
  [switch]$Remove
)
$ErrorActionPreference = 'Stop'
$ruleName = "ai-screen-sketch $Port"

# 같은 포트의 예전 넘기기 규칙을 지운다 (예: 0.0.0.0 → WSL 내부 주소)
foreach ($line in (netsh interface portproxy show v4tov4)) {
  if ($line -match "^\s*(\S+)\s+$Port\s+") {
    netsh interface portproxy delete v4tov4 listenaddress=$($Matches[1]) listenport=$Port | Out-Null
    Write-Host "지움: $($Matches[1]):$Port 넘기기"
  }
}

if ($Remove) {
  Get-NetFirewallRule -DisplayName $ruleName -ErrorAction SilentlyContinue | Remove-NetFirewallRule
  Write-Host "끔: 다른 기기에서 열 수 없습니다 (이 PC 의 http://localhost:$Port 는 그대로)"
  return
}

if (-not $ListenAddress) {
  $ListenAddress = (Get-NetIPAddress -AddressFamily IPv4 |
    Where-Object { $_.IPAddress -notlike '127.*' -and $_.IPAddress -notlike '169.254.*' -and $_.InterfaceAlias -notlike 'vEthernet*' -and $_.PrefixOrigin -in @('Dhcp', 'Manual') } |
    Select-Object -First 1).IPAddress
}
if (-not $ListenAddress) { throw '공유기 주소를 찾지 못했습니다. -ListenAddress 192.168.x.x 로 알려 주세요.' }

netsh interface portproxy add v4tov4 listenaddress=$ListenAddress listenport=$Port connectaddress=127.0.0.1 connectport=$Port | Out-Null

$rule = Get-NetFirewallRule -DisplayName $ruleName -ErrorAction SilentlyContinue
if ($rule) { $rule | Set-NetFirewallRule -Profile Private -Action Allow -Enabled True }
else { New-NetFirewallRule -DisplayName $ruleName -Direction Inbound -Protocol TCP -LocalPort $Port -Action Allow -Profile Private | Out-Null }

$category = (Get-NetConnectionProfile | Select-Object -First 1).NetworkCategory
Write-Host ""
Write-Host "켬: 같은 공유기의 다른 기기에서  http://$($ListenAddress):$Port"
if ($category -ne 'Private') { Write-Host "주의: 지금 네트워크가 '$category' 입니다. 설정 > 네트워크에서 '개인 네트워크'로 바꿔야 열립니다." }
Write-Host "공유기 주소가 바뀌면(DHCP) 이 스크립트를 다시 실행하세요. 서버는 WSL 에서 npm run dev 로 켜져 있어야 합니다 (autostart.ps1 참고)."
