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

# 失敗時は他の定期タスクと同じく MAIN の ROUTINE_FAILURES.md へ記録し、朝のブリーフィングで拾う。
# 以前は終了コードがタスク履歴に残るだけで、2026-07-07〜08-01の25日間と2026-09-15〜10-02の18日間、
# 誰も気づかないまま毎晩失敗していた（2026-10-03〜10-11はntfy通知、以降はログ記録）。
$routineFailure = "C:\Users\test\MAIN\10_AI_NEXUS\Tasks\RoutineFailure.ps1"
if ($exitCode -ne 0 -and (Test-Path -LiteralPath $routineFailure)) {
    try {
        . $routineFailure
        Write-RoutineFailure -Source "TsvEditor_NightlyUiCheck" `
            -Message "exitCode=$exitCode。repos/tsv-editor/.agents/nightly/log/latest.md を確認"
    } catch {}
}

exit $exitCode
