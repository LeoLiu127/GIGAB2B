$ports = 5181,5182,5173
foreach ($port in $ports) {
    $conns = Get-NetTCPConnection -LocalPort $port -ErrorAction SilentlyContinue
    foreach ($c in $conns) {
        try { Stop-Process -Id $c.OwningProcess -Force -ErrorAction Stop } catch {}
    }
}
Start-Sleep -Seconds 5
Write-Host "--- Remaining listeners ---"
Get-NetTCPConnection -State Listen -LocalPort $ports -ErrorAction SilentlyContinue | Select-Object LocalPort
Write-Host "--- All connections on those ports ---"
Get-NetTCPConnection -LocalPort $ports -ErrorAction SilentlyContinue | Select-Object LocalPort, State, OwningProcess
