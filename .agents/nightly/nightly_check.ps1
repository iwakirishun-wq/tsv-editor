# tsv-editor 夜間UI回帰チェック（タスクスケジューラ "TsvEditor_NightlyUiCheck" から起動）
# 実際のレポート(.md/.json)はrun_nightly_check.js自身がUTF-8で書き出すため、
# このラッパーはnodeの起動と終了コードの記録だけを行う。
# （以前はnodeの標準出力をPowerShellの *>> でリダイレクトしていたが、PowerShell 5.1の
#   既定エンコーディング(UTF-16)とnodeのUTF-8出力が噛み合わず日本語が文字化けしていたため廃止）

$ErrorActionPreference = "Stop"
$nightlyDir = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $nightlyDir

$logDir = Join-Path $nightlyDir "log"
if (-not (Test-Path $logDir)) { New-Item -ItemType Directory -Path $logDir | Out-Null }

$stamp = Get-Date -Format "yyyy-MM-dd_HHmmss"
$runMarker = Join-Path $logDir "run_$stamp.txt"

try {
    & node run_nightly_check.js | Out-Null
    $exitCode = $LASTEXITCODE
    "$stamp exitCode=$exitCode" | Out-File -FilePath $runMarker -Encoding utf8
} catch {
    $exitCode = 1
    "$stamp 起動失敗: $($_.Exception.Message)" | Out-File -FilePath $runMarker -Encoding utf8
}

exit $exitCode
