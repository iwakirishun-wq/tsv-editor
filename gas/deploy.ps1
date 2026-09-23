# =============================================================
#  GAS Web App デプロイスクリプト（共通版）
#
#  既定の動作:
#    同じフォルダの deploy_target.json に書かれた「正式デプロイID」を
#    そのまま更新する。公開URLは変わらないので、社内で共有済みの
#    ブックマークはそのまま使える。
#
#  使い方:
#    .\deploy.ps1            … コードをpushし、同じURLの中身を更新する（通常はこれ）
#    .\deploy.ps1 -PushOnly  … pushだけ行う（公開URLは更新されない）
#    .\deploy.ps1 -New       … 新しい別URLを発行する（通常は使わない）
#
#  このファイルは5つのGASプロジェクトで共通。アプリごとの違いは
#  すべて deploy_target.json 側に入っている。
# =============================================================
param(
    [switch]$New,
    [switch]$PushOnly
)

[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
$OutputEncoding = [System.Text.Encoding]::UTF8
$ErrorActionPreference = "Continue"

$CurrentDir = $PSScriptRoot
if ([string]::IsNullOrWhiteSpace($CurrentDir)) {
    $CurrentDir = Split-Path -Parent $MyInvocation.MyCommand.Path
}
Set-Location $CurrentDir

# --- 1. 前提ファイルの確認 -------------------------------------------------

if (-not (Test-Path ".clasp.json")) {
    Write-Host "[エラー] .clasp.json が見つかりません。" -ForegroundColor Red
    Write-Host "         このフォルダはGASプロジェクトとして初期化されていません。" -ForegroundColor Red
    exit 1
}

if (-not (Test-Path "$env:USERPROFILE\.clasprc.json")) {
    Write-Host "[!] clasp が未ログインです。ログインを開始します..." -ForegroundColor Yellow
    Write-Host "    ブラウザが開いたら、対象のGoogleアカウントで許可してください。" -ForegroundColor Yellow
    cmd.exe /c "clasp login"
    if ($LASTEXITCODE -ne 0) {
        Write-Host "[エラー] clasp login に失敗しました。" -ForegroundColor Red
        exit 1
    }
}

$targetPath = Join-Path $CurrentDir "deploy_target.json"
$label = "GAS Web App"
$deploymentId = ""

if (Test-Path $targetPath) {
    try {
        $target = Get-Content $targetPath -Raw -Encoding UTF8 | ConvertFrom-Json
        if ($target.label)        { $label = [string]$target.label }
        if ($target.deploymentId) { $deploymentId = [string]$target.deploymentId }
    } catch {
        Write-Host "[エラー] deploy_target.json を読み取れませんでした。" -ForegroundColor Red
        Write-Host "         $($_.Exception.Message)" -ForegroundColor Red
        exit 1
    }
}

Write-Host "================================================" -ForegroundColor Cyan
Write-Host " $label  GAS デプロイ" -ForegroundColor Cyan
Write-Host "================================================" -ForegroundColor Cyan

if (-not $New -and [string]::IsNullOrWhiteSpace($deploymentId)) {
    Write-Host "[エラー] 正式なデプロイIDが設定されていません。" -ForegroundColor Red
    Write-Host "" -ForegroundColor Red
    Write-Host "  対処: このフォルダの deploy_target.json に deploymentId を設定してください。" -ForegroundColor Yellow
    Write-Host "        現在のデプロイ一覧は次のコマンドで確認できます:" -ForegroundColor Yellow
    Write-Host "          clasp list-deployments" -ForegroundColor Yellow
    Write-Host "" -ForegroundColor Yellow
    Write-Host "  ※ IDが分からないまま新しいURLを発行すると、社内で共有済みのURLとは" -ForegroundColor Yellow
    Write-Host "     別物になってしまうため、ここでは自動作成しません。" -ForegroundColor Yellow
    exit 1
}

# --- 2. コードをGASへプッシュ ----------------------------------------------

Write-Host ""
# --- 0. エディタ本体をルートから同期 ---
# gas/index.html はルートの index.html のコピー。手でコピーする運用だと必ず忘れて、
# 「直したはずの機能がGAS版に無い」が起きる（2026-09-24のレビューで実際に指摘された）。
# 差分があればここで必ず上書きしてから push する。
$rootIndex = Join-Path (Split-Path -Parent $CurrentDir) "index.html"
$gasIndex = Join-Path $CurrentDir "index.html"
if (Test-Path $rootIndex) {
    $needCopy = $true
    if (Test-Path $gasIndex) {
        $a = (Get-FileHash $rootIndex -Algorithm SHA256).Hash
        $b = (Get-FileHash $gasIndex -Algorithm SHA256).Hash
        $needCopy = ($a -ne $b)
    }
    if ($needCopy) {
        Copy-Item $rootIndex $gasIndex -Force
        Write-Host "0. エディタ本体を同期しました (index.html <- ルート)" -ForegroundColor Yellow
    } else {
        Write-Host "0. エディタ本体は最新です" -ForegroundColor DarkGray
    }
} else {
    Write-Warning "ルートの index.html が見つかりません。gas/index.html をそのまま使います。"
}

Write-Host "1. GAS へコードをプッシュ中 (clasp push -f)..." -ForegroundColor Yellow
cmd.exe /c "clasp push -f"
if ($LASTEXITCODE -ne 0) {
    Write-Host "[エラー] clasp push に失敗しました。" -ForegroundColor Red
    Write-Host "         ログイン切れの可能性があります。`"clasp login`" を試してください。" -ForegroundColor Red
    exit 1
}

if ($PushOnly) {
    Write-Host ""
    Write-Host "[完了] push のみ実行しました。" -ForegroundColor Green
    Write-Host "       公開URLの内容はまだ更新されていません。" -ForegroundColor Yellow
    Write-Host "       反映するには -PushOnly を外して実行してください。" -ForegroundColor Yellow
    exit 0
}

# --- 3. デプロイ -----------------------------------------------------------

$tag = "v_" + (Get-Date -Format "yyyyMMdd_HHmmss")

if ($New) {
    Write-Host ""
    Write-Host "[警告] -New が指定されました。" -ForegroundColor Magenta
    Write-Host "       新しい公開URLが発行されます。既存の共有URL・ブックマークとは" -ForegroundColor Magenta
    Write-Host "       別物になり、既存URLは古い内容を配信し続けます。" -ForegroundColor Magenta
    Write-Host ""
    Write-Host "2. 新規デプロイを作成中 ($tag)..." -ForegroundColor Yellow
    cmd.exe /c "clasp create-deployment -d $tag"
} else {
    Write-Host ""
    Write-Host "2. 既存デプロイを更新中 ($tag)..." -ForegroundColor Yellow
    Write-Host "   対象デプロイID: $deploymentId" -ForegroundColor DarkGray
    cmd.exe /c "clasp create-deployment -i $deploymentId -d $tag"
}

if ($LASTEXITCODE -ne 0) {
    Write-Host "[エラー] デプロイに失敗しました。" -ForegroundColor Red
    if (-not $New) {
        Write-Host "         考えられる原因:" -ForegroundColor Red
        Write-Host "           ・deploy_target.json のデプロイIDが存在しない／削除された" -ForegroundColor Red
        Write-Host "           ・このGoogleアカウントに更新権限がない" -ForegroundColor Red
        Write-Host "         現在有効なデプロイIDを確認してください:" -ForegroundColor Yellow
        Write-Host "           clasp list-deployments" -ForegroundColor Yellow
    }
    exit 1
}

# --- 4. 結果表示 -----------------------------------------------------------

Write-Host ""
Write-Host "3. デプロイ一覧:" -ForegroundColor Yellow
cmd.exe /c "clasp list-deployments"

Write-Host ""
Write-Host "================================================" -ForegroundColor Green
Write-Host " $label  デプロイ完了" -ForegroundColor Green
Write-Host "================================================" -ForegroundColor Green

if ($New) {
    Write-Host ""
    Write-Host "新しいURLが発行されました。上の一覧から新IDを確認し、" -ForegroundColor Magenta
    Write-Host "これを正式URLにする場合は deploy_target.json を更新してください。" -ForegroundColor Magenta
} else {
    Write-Host ""
    Write-Host "公開URL (変更されていません):" -ForegroundColor Green
    Write-Host "  https://script.google.com/macros/s/$deploymentId/exec" -ForegroundColor White
    Write-Host ""
    Write-Host "URLは変わっていないので、共有済みのブックマークはそのまま使えます。" -ForegroundColor Green
}
Write-Host ""
