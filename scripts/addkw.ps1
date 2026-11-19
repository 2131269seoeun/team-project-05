param([string]$ChunkDir, [string]$MapFile, [switch]$Apply)
$utf8 = New-Object Text.UTF8Encoding($false)
$map = @{}; $wild = @()
foreach ($l in [IO.File]::ReadAllLines($MapFile, [Text.Encoding]::UTF8)) {
    if ($l -match '^\s*#' -or $l.Trim() -eq '') { continue }
    $p = $l -split '\|'
    $fam = $p[0]; $kw = $p[-1]; $title = ($p[1..($p.Count - 2)] -join '|')
    if ($title.EndsWith('*')) { $wild += [pscustomobject]@{ Fam = $fam; Prefix = $title.TrimEnd('*'); Kw = $kw } }
    else { $map["$fam|$title"] = $kw }
}
function Fam($n) {
    if ($n.StartsWith('서울특별시')) { '조례' } elseif ($n.StartsWith('폐기물관리법 시행규칙')) { '규칙' }
    elseif ($n.StartsWith('폐기물관리법(법률)')) { '법률' } elseif ($n.StartsWith('폐기물관리법 안전기준')) { '사례' } else { '질문' }
}
$rows = @(); $problems = @()
foreach ($f in Get-ChildItem $ChunkDir -File | Sort-Object Name) {
    $raw = [IO.File]::ReadAllText($f.FullName, [Text.Encoding]::UTF8)
    $nl = $raw.IndexOf("`n"); $head = $raw.Substring(0, $nl); $rest = $raw.Substring($nl + 1)
    if ($rest.StartsWith('키워드:')) { $rest = $rest.Substring($rest.IndexOf("`n") + 1) }
    $title = (($head -split ' · ## ')[1])
    $fam = Fam $f.Name
    $kw = $map["$fam|$title"]
    if (-not $kw) { $w = $wild | Where-Object { $_.Fam -eq $fam -and $title.StartsWith($_.Prefix) } | Sort-Object { $_.Prefix.Length } -Descending | Select-Object -First 1; if ($w) { $kw = $w.Kw } }
    if (-not $kw) { $problems += "키워드 없음: $($f.Name) [$fam|$title]"; continue }
    $items = $kw -split ',\s*' | ForEach-Object { $_.Trim() } | Where-Object { $_ }
    if ($items.Count -gt 5) { $problems += "5개 초과: $($f.Name)" }
    $norm = ($raw -replace '\s', '')
    foreach ($k in $items) {
        if ($k -match '\d,\d') { $problems += "숫자 쉼표: $($f.Name) [$k]" }
        if (-not $k.StartsWith('~') -and -not $norm.Contains(($k -replace '\s', ''))) { $problems += "뺌(조각에 없음): $($f.Name) [$k]" }
    }
    $items = @($items | Where-Object { $_.StartsWith('~') -or $norm.Contains(($_ -replace '\s', '')) })
    $clean = ($items | ForEach-Object { $_.TrimStart('~') }) -join ', '
    $rows += [pscustomobject]@{ File = $f.Name; Keywords = $clean }
    if ($Apply) { [IO.File]::WriteAllText($f.FullName, "$head`n키워드: $clean`n$rest", $utf8) }
}
$rows | Export-Csv -NoTypeInformation -Encoding UTF8 (Join-Path (Split-Path $PSCommandPath) 'kw_report.csv')
"조각 수: $($rows.Count)  문제: $($problems.Count)"
$problems
