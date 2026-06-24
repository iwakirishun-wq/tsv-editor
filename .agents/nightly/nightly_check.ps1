# tsv-editor 夜間UI回帰チェック（タスクスケジューラ "TsvEditor_NightlyUiCheck" から起動）
# 実マスター(MAIN内のBO-F-21030 / m_seat_type_area)をローカルChromeに読み込ませてUIをチェックする。
# 結果は .agents\nightly\log\<日付>.md / .json とスクリーンショットに保存される。

$ErrorActionPreference = "Stop"
$nightlyDir = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $nightlyDir

$logDir = Join-Path $nightlyDir "log"
if (-not (Test-Path $logDir)) { New-Item -ItemType Directory -Path $logDir | Out-Null }

$stamp = Get-Date -Format "yyyy-MM-dd_HHmmss"
$runLog = Join-Path $logDir "run_$stamp.log"

try {
    & node run_nightly_check.js *>> $runLog
    $exitCode = $LASTEXITCODE
} catch {
    "$($_.Exception.Message)" | Out-File -FilePath $runLog -Append -Encoding utf8
    $exitCode = 1
}

exit $exitCode
