param([string]$SrcDir, [string]$OutDir, [int]$Max = 1500, [int]$Min = 100)
# 청킹전 .md 를 읽어 청킹 폴더에 조각을 쓴다. 원본은 읽기만 한다.
$utf8 = New-Object Text.UTF8Encoding($false)
New-Item -ItemType Directory -Force $OutDir | Out-Null

function New-Unit($titles, $text, $kind) { [pscustomobject]@{ Titles = @($titles); Text = $text; Kind = $kind } }

# 문단(빈 줄로 나뉜 덩어리) 목록. 표는 줄마다 쪼갤 수 있게 표시한다.
function Get-Blocks([string]$text) {
    $paras = [regex]::Split($text.Trim("`n"), "\n{2,}") | Where-Object { $_ -ne '' }
    foreach ($p in $paras) {
        $lines = $p -split "`n"
        if ($lines.Count -ge 2 -and $lines[0].StartsWith('|') -and $lines[1] -match '^\|(\s*---\s*\|)+$') {
            [pscustomobject]@{ Type = 'table'; Header = ($lines[0..1] -join "`n"); Rows = @($lines[2..($lines.Count - 1)]) }
        } else { [pscustomobject]@{ Type = 'para'; Text = $p } }
    }
}

# 1500자가 넘는 문단은 문장 끝에서 자른다.
function Split-Sentences([string]$p, [int]$max) {
    $sent = [regex]::Split($p, '(?<=[.다요음함됨임\)]\.?)\s+(?=\S)') | Where-Object { $_ -ne '' }
    $out = @(); $cur = ''
    foreach ($s in $sent) {
        $cand = if ($cur) { "$cur $s" } else { $s }
        if ($cand.Length -le $max -or -not $cur) { $cur = $cand } else { $out += $cur; $cur = $s }
    }
    if ($cur) { $out += $cur }
    $out
}

function Split-Unit($u) {
    if ($u.Text.Length -le $Max) { return , @($u.Text) }
    $parts = @(); $cur = ''
    foreach ($b in (Get-Blocks $u.Text)) {
        if ($b.Type -eq 'para') {
            $pieces = if ($b.Text.Length -gt $Max) { Split-Sentences $b.Text $Max } else { @($b.Text) }
            foreach ($pc in $pieces) {
                $cand = if ($cur) { "$cur`n`n$pc" } else { $pc }
                if ($cand.Length -le $Max -or -not $cur) { $cur = $cand } else { $parts += $cur; $cur = $pc }
            }
        } else {
            # 표: 머리글은 첫 조각에만. 다음 조각은 머리글 자리를 남긴다.
            $hdrRoom = $b.Header.Length + 1
            $first = $true
            $tcur = if ($cur) { "$cur`n`n$($b.Header)" } else { $b.Header }
            if ($tcur.Length -gt $Max -and $cur) { $parts += $cur; $tcur = $b.Header }
            $cur = $tcur
            foreach ($row in $b.Rows) {
                $limit = if ($first) { $Max } else { $Max - $hdrRoom }
                $cand = if ($cur) { "$cur`n$row" } else { $row }
                if ($cand.Length -le $limit -or -not $cur) { $cur = $cand }
                else { $parts += $cur; $cur = $row; $first = $false }
            }
        }
    }
    if ($cur) { $parts += $cur }
    , $parts
}

$report = @()
foreach ($f in Get-ChildItem $SrcDir -Filter *.md) {
    $t = [IO.File]::ReadAllText($f.FullName, [Text.Encoding]::UTF8) -replace "`r", ''
    $docTitle = ([regex]::Match($t, '^# (.*)')).Groups[1].Value.Trim()
    $secs = [regex]::Split($t, '(?m)^(?=## )')
    $pre = ($secs[0] -replace '^# .*\n?', '').Trim()
    $isLaw = [regex]::IsMatch($t, '(?m)^## 제\d+조')
    $units = New-Object Collections.Generic.List[object]
    if ($pre) { $units.Add((New-Unit @('문서정보') $pre 'normal')) }
    $pendingTitle = ''
    foreach ($s in $secs[1..($secs.Count - 1)]) {
        $s = $s.TrimEnd()
        $head = ([regex]::Match($s, '^## (.*)')).Groups[1].Value.Trim()
        $body = ($s -replace '^## .*\n?', '').Trim()
        if ($body -eq '') { $pendingTitle += "## $head`n`n"; continue }   # 제목만 있는 장 → 다음 조각 앞에
        if ($isLaw -and $head -match '^부칙') {
            # 부칙: 안에 조가 있으면 조마다, 없으면 부칙 하나를 한 조각
            $paras = [regex]::Split($body, "\n{2,}")
            $groups = @(); $cur = $null
            foreach ($p in $paras) {
                if ($p -match '^(제\d+조(?:의\d+)?\((?:[^()]|\([^()]*\))*\))') { if ($cur) { $groups += , $cur }; $cur = @{ T = $Matches[1]; P = @($p) } }
                elseif ($cur) { $cur.P += $p } else { $cur = @{ T = ''; P = @($p) } }
            }
            if ($cur) { $groups += , $cur }
            $firstG = $true
            foreach ($g in $groups) {
                $title = if ($g.T) { "$head $($g.T)" } else { $head }
                $txt = ($g.P -join "`n`n")
                if ($firstG) { $txt = "$pendingTitle## $head`n`n$txt"; $pendingTitle = '' ; $firstG = $false }
                $units.Add((New-Unit @($title) $txt 'article'))
            }
            continue
        }
        $kind = if ($isLaw -and $head -match '^제\d+조') { 'article' } else { 'normal' }
        $units.Add((New-Unit @($head) "$pendingTitle## $head`n`n$body" $kind)); $pendingTitle = ''
    }
    # 1500자 넘는 것 다시 자르기
    $chunks = New-Object Collections.Generic.List[object]
    foreach ($u in $units) {
        foreach ($p in (Split-Unit $u)) { $chunks.Add((New-Unit $u.Titles $p $u.Kind)) }
    }
    # 100자 미만 합치기 (조문 · 부칙은 합치지 않음)
    $changed = $true
    while ($changed) {
        $changed = $false
        for ($i = 0; $i -lt $chunks.Count; $i++) {
            $c = $chunks[$i]
            if ($c.Kind -eq 'article' -or $c.Text.Length -ge $Min) { continue }
            if ($i + 1 -lt $chunks.Count) {
                $n = $chunks[$i + 1]
                if ($n.Kind -ne 'article' -and ($c.Text.Length + 2 + $n.Text.Length) -le $Max) {
                    $titles = @($c.Titles) + @($n.Titles | Where-Object { $c.Titles -notcontains $_ })
                    $chunks[$i] = New-Unit $titles "$($c.Text)`n`n$($n.Text)" 'normal'; $chunks.RemoveAt($i + 1); $changed = $true; break
                }
            } elseif ($i -gt 0) {
                $p = $chunks[$i - 1]
                if ($p.Kind -ne 'article' -and ($p.Text.Length + 2 + $c.Text.Length) -le $Max) {
                    $titles = @($p.Titles) + @($c.Titles | Where-Object { $p.Titles -notcontains $_ })
                    $chunks[$i - 1] = New-Unit $titles "$($p.Text)`n`n$($c.Text)" 'normal'; $chunks.RemoveAt($i); $changed = $true; break
                }
            }
        }
    }
    # 쓰기
    $digits = if ($chunks.Count -gt 100) { 3 } else { 2 }
    $n = 0
    foreach ($c in $chunks) {
        $n++
        $sub = ($c.Titles[0] -replace '\s', '') -replace '[\\/:*?"<>|]', ''
        $sub = $sub.TrimEnd('.')
        $name = "{0}_{1}_{2}.md" -f $f.BaseName, $n.ToString("D$digits"), $sub
        $src = "출처: # $docTitle · " + (($c.Titles | ForEach-Object { "## $_" }) -join ' · ')
        $body = $c.Text.Trim()
        [IO.File]::WriteAllText((Join-Path $OutDir $name), "$src`n`n$body`n", $utf8)
        $report += [pscustomobject]@{ File = $f.BaseName; No = $n; Name = $name; Len = ("`n$body`n").Length; Kind = $c.Kind; Merged = ($c.Titles.Count -gt 1) }
    }
}
$report | Export-Csv -NoTypeInformation -Encoding UTF8 (Join-Path (Split-Path $PSCommandPath) 'chunk_report.csv')
$report | Group-Object File | ForEach-Object { "{0} | 조각={1} | 최소={2} 최대={3} | 1500초과={4} | 100미만={5} | 합친조각={6}" -f $_.Name, $_.Count, ($_.Group.Len | Measure-Object -Minimum).Minimum, ($_.Group.Len | Measure-Object -Maximum).Maximum, @($_.Group | Where-Object { $_.Len -gt $Max }).Count, @($_.Group | Where-Object { $_.Len -lt $Min }).Count, @($_.Group | Where-Object Merged).Count }
