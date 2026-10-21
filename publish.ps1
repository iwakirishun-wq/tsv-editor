[CmdletBinding()]
param([switch]$Prepare, [switch]$VerifyOnly)

$ErrorActionPreference = 'Stop'
$repo = $PSScriptRoot
$stage = 'preflight'
$verificationDir = $null
Push-Location $repo
try {
    $source = Join-Path $repo 'index.html'
    $gasSource = Join-Path $repo 'gas/index.html'
    if ($Prepare) {
        Copy-Item -LiteralPath $source -Destination $gasSource -Force
        Write-Host 'GAS frontend synchronized. Review, test and commit before running publish.ps1.'
        exit 0
    }
    if ((Get-FileHash $source).Hash -ne (Get-FileHash $gasSource).Hash) {
        throw 'Frontend copies differ. Run publish.ps1 -Prepare, review and commit both copies first.'
    }
    $branch = (& git branch --show-current).Trim()
    if ($LASTEXITCODE -ne 0 -or $branch -ne 'main') { throw 'Publish from main only.' }
    & git diff --quiet HEAD -- index.html gas sw.js manifest.json icon.svg vendor publish.ps1
    if ($LASTEXITCODE -ne 0) { throw 'Commit the release files before publishing.' }
    $commit = (& git rev-parse HEAD).Trim()
    $remote = (& git remote get-url origin).Trim()
    if ($LASTEXITCODE -ne 0 -or $remote -notmatch 'github\.com[:/]iwakirishun-wq/tsv-editor(?:\.git)?$') { throw 'Unexpected GitHub origin; stopping.' }
    $target = Get-Content -LiteralPath 'gas/deploy_target.json' -Raw -Encoding UTF8 | ConvertFrom-Json
    $config = Get-Content -LiteralPath 'gas/.clasp.json' -Raw -Encoding UTF8 | ConvertFrom-Json
    if (-not $target.deploymentId -or -not $config.scriptId) { throw 'Existing GAS target is missing.' }
    $pagesJson = & gh api repos/iwakirishun-wq/tsv-editor/pages
    if ($LASTEXITCODE -ne 0) { throw 'Cannot read GitHub Pages configuration.' }
    $pages = $pagesJson | ConvertFrom-Json
    if ($pages.source.branch -ne 'main') { throw 'GitHub Pages must publish main.' }

    if (-not $VerifyOnly) {
        $stage = 'GitHub push'
        & git push origin main
        if ($LASTEXITCODE -ne 0) { throw 'GitHub push failed; GAS has not been updated.' }
        $stage = 'GAS deployment (GitHub has been pushed)'
        & powershell.exe -NoProfile -NonInteractive -ExecutionPolicy Bypass -File (Join-Path $repo 'gas/deploy.ps1') -NonInteractive
        if ($LASTEXITCODE -ne 0) { throw 'GAS deployment failed. Rerun publish.ps1 after resolving the error.' }
    }

    $stage = 'GitHub main verification'
    $remoteMain = & git ls-remote origin refs/heads/main
    if ($LASTEXITCODE -ne 0 -or ($remoteMain -split '\s+')[0] -ne $commit) { throw 'GitHub main does not match the local release commit.' }
    $stage = 'GitHub Pages verification'
    $expected = [IO.File]::ReadAllText($source).Replace("`r`n", "`n")
    $pagesMatch = $false
    for ($attempt = 0; $attempt -lt 24; $attempt++) {
        try {
            $url = $pages.html_url.TrimEnd('/') + '/index.html?release=' + $commit + '&attempt=' + $attempt
            $response = Invoke-WebRequest -Uri $url -UseBasicParsing -TimeoutSec 30
            $actual = if ($response.Content -is [byte[]]) { [Text.Encoding]::UTF8.GetString($response.Content) } else { [string]$response.Content }
            if ($actual.Replace("`r`n", "`n") -ceq $expected) { $pagesMatch = $true; break }
        } catch { Write-Host 'Pages response not ready; retrying.' }
        Start-Sleep -Seconds 10
    }
    if (-not $pagesMatch) { throw 'Pages still differs from the local release. Both-site publication is NOT verified.' }
    foreach ($asset in @('manifest.json', 'sw.js', 'icon.svg')) {
        $assetUrl = $pages.html_url.TrimEnd('/') + '/' + $asset + '?release=' + $commit
        $assetResponse = Invoke-WebRequest -Uri $assetUrl -UseBasicParsing -TimeoutSec 30
        $assetText = if ($assetResponse.Content -is [byte[]]) { [Text.Encoding]::UTF8.GetString($assetResponse.Content) } else { [string]$assetResponse.Content }
        if ($assetText.Replace("`r`n", "`n") -cne [IO.File]::ReadAllText((Join-Path $repo $asset)).Replace("`r`n", "`n")) {
            throw ('Pages asset differs from the release: ' + $asset)
        }
    }

    $stage = 'GAS published-version verification'
    Push-Location (Join-Path $repo 'gas')
    try {
        $deploymentJson = & clasp list-deployments --json
        if ($LASTEXITCODE -ne 0) { throw 'Cannot read GAS deployments.' }
        $deployments = $deploymentJson | ConvertFrom-Json
        $deployment = $deployments | Where-Object { $_.deploymentId -eq $target.deploymentId }
    } finally { Pop-Location }
    if (-not $deployment.versionNumber) { throw 'Existing GAS deployment has no published version.' }
    $verificationDir = Join-Path $repo ('.agents/publish-verification/' + [guid]::NewGuid().ToString('N'))
    New-Item -ItemType Directory -Path $verificationDir -Force | Out-Null
    Push-Location $verificationDir
    try {
        & clasp clone-script $config.scriptId ([string]$deployment.versionNumber)
        if ($LASTEXITCODE -ne 0) { throw 'Cannot retrieve the immutable GAS published version.' }
        $published = [IO.File]::ReadAllText((Join-Path $verificationDir 'index.html')).Replace("`r`n", "`n")
        if ($published -cne $expected) { throw 'GAS published frontend differs from the release.' }
    } finally { Pop-Location }
    Write-Host 'VERIFIED: GitHub Pages and the existing GAS published version contain the same release.' -ForegroundColor Green
} catch {
    Write-Error ('Publication stopped at ' + $stage + ': ' + $_.Exception.Message) -ErrorAction Continue
    exit 1
} finally {
    if ($verificationDir -and (Test-Path -LiteralPath $verificationDir)) {
        $safeRoot = [IO.Path]::GetFullPath((Join-Path $repo '.agents/publish-verification')) + [IO.Path]::DirectorySeparatorChar
        $resolved = (Resolve-Path -LiteralPath $verificationDir).Path
        if ($resolved.StartsWith($safeRoot, [StringComparison]::OrdinalIgnoreCase)) {
            Remove-Item -LiteralPath $resolved -Recurse -Force
        }
    }
    Pop-Location
}
