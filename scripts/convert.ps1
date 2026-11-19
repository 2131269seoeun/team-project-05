param([string]$SrcDir, [string]$OutDir)
# 원본 폴더의 파일을 읽기만 하고, .md 를 OutDir 에 쓴다.
$utf8 = New-Object Text.UTF8Encoding($false)
Add-Type -AssemblyName System.IO.Compression.FileSystem

function Esc-Cell([string]$s) { ($s -replace '\|', '\|').Trim() }
function Md-Table($rows) {
    # $rows: 배열의 배열. 첫 줄을 머리줄로 쓴다.
    $out = @()
    $w = ($rows | ForEach-Object { @($_).Count } | Measure-Object -Maximum).Maximum
    $i = 0
    foreach ($r in $rows) {
        $cells = @($r) + @('') * ($w - @($r).Count)
        $out += '| ' + (($cells | ForEach-Object { Esc-Cell $_ }) -join ' | ') + ' |'
        if ($i -eq 0) { $out += '|' + ((1..$w | ForEach-Object { ' --- ' }) -join '|') + '|' }
        $i++
    }
    $out
}

# ---------- HWPML (.hwp 이지만 XML) ----------
function HwpParaText($p) {
    $sb = New-Object Text.StringBuilder
    foreach ($t in $p.SelectNodes('./TEXT')) {
        foreach ($c in $t.SelectNodes('./CHAR')) {
            foreach ($cc in $c.ChildNodes) {
                if ($cc.NodeType -in 'Text','Whitespace','SignificantWhitespace') { [void]$sb.Append($cc.Value) }
                elseif ($cc.Name -eq 'HYPHEN') { [void]$sb.Append('-') }
                elseif ($cc.Name -in 'TAB','LINEBREAK','NBSPACE','FWSPACE') { [void]$sb.Append(' ') }
                else { [void]$sb.Append($cc.InnerText) }
            }
        }
    }
    $sb.ToString()
}

function Convert-Hwpml($file) {
    $x = [xml][IO.File]::ReadAllText($file.FullName, [Text.Encoding]::UTF8)
    $paras = @()
    foreach ($sec in $x.SelectNodes('//BODY/SECTION')) {
        foreach ($p in $sec.SelectNodes('./P')) { $paras += ((HwpParaText $p) -replace '^\s+|\s+$', '') }
    }
    $md = New-Object Collections.Generic.List[string]
    $md.Add("# $($file.BaseName)")
    $md.Add('')
    $md.Add('## 문서 정보')
    $mode = 'cover'
    $reArticle = '^(제\d+조(?:의\d+)?\((?:[^()]|\([^()]*\))*\))\s*(.*)$'
    $reDeleted = '^(제\d+조(?:의\d+)?)\s+(삭제.*)$'
    foreach ($t in $paras) {
        if ($t -eq '') { continue }
        if ($t -match '^(제\d+(장|절|관))(\s|$)' -and $mode -ne 'addenda') {
            $mode = 'body'; $md.Add(''); $md.Add("## $t"); continue
        }
        if ($t -match '^부칙(\s|<|$)') {
            $mode = 'addenda'; $md.Add(''); $md.Add("## " + ($t -replace '\s{2,}', ' ')); continue
        }
        if ($mode -ne 'addenda') {
            if ($t -match $reArticle) {
                $mode = 'body'; $md.Add(''); $md.Add("## $($Matches[1])")
                if ($Matches[2] -ne '') { $md.Add(''); $md.Add($Matches[2]) }
                continue
            }
            if ($t -match $reDeleted) {
                $mode = 'body'; $md.Add(''); $md.Add("## $($Matches[1])"); $md.Add(''); $md.Add($Matches[2]); continue
            }
        }
        $md.Add(''); $md.Add($t)
    }
    $md
}

# ---------- DOCX ----------
function Convert-Docx($file) {
    $z = [IO.Compression.ZipFile]::OpenRead($file.FullName)
    $rd = { param($n) $r = New-Object IO.StreamReader($z.GetEntry($n).Open(), [Text.Encoding]::UTF8); $s = $r.ReadToEnd(); $r.Close(); $s }
    $x = [xml](& $rd 'word/document.xml')
    $rels = [xml](& $rd 'word/_rels/document.xml.rels')
    $z.Dispose()
    $W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main'
    $R = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships'
    $ns = New-Object Xml.XmlNamespaceManager($x.NameTable); $ns.AddNamespace('w', $W)
    $link = @{}; foreach ($rl in $rels.Relationships.Relationship) { if ($rl.TargetMode -eq 'External') { $link[$rl.Id] = $rl.Target } }

    function PT($p) {
        $sb = New-Object Text.StringBuilder
        foreach ($n in $p.ChildNodes) {
            if ($n.LocalName -eq 'hyperlink') {
                $txt = ($n.SelectNodes('.//w:t', $ns) | ForEach-Object { $_.InnerText }) -join ''
                $id = $n.GetAttribute('id', $R)
                if ($link.ContainsKey($id)) { [void]$sb.Append("[$txt]($($link[$id]))") } else { [void]$sb.Append($txt) }
            } elseif ($n.LocalName -eq 'r') {
                foreach ($m in $n.ChildNodes) {
                    switch ($m.LocalName) { 't' { [void]$sb.Append($m.InnerText) } 'tab' { [void]$sb.Append(' ') } 'br' { [void]$sb.Append(' ') } 'drawing' { [void]$sb.Append('{{IMG}}') } 'pict' { [void]$sb.Append('{{IMG}}') } }
                }
            }
        }
        $sb.ToString().Trim()
    }

    $md = New-Object Collections.Generic.List[string]
    $counters = @{}
    $prevList = $false
    foreach ($el in $x.SelectSingleNode('//w:body', $ns).ChildNodes) {
        if ($el.LocalName -eq 'p') {
            $st = $el.SelectSingleNode('./w:pPr/w:pStyle', $ns); $sn = if ($st) { $st.GetAttribute('val', $W) } else { '' }
            $num = $el.SelectSingleNode('./w:pPr/w:numPr/w:numId', $ns)
            $t = PT $el
            if ($t -eq '') { continue }
            if ($t -eq '{{IMG}}') { $md.Add(''); $md.Add('{{IMG}}'); $prevList = $false; continue }
            if ($sn -eq 'Heading1') { $md.Add("# $t"); $prevList = $false; continue }
            if ($sn -match '^Heading(\d)$') { $md.Add(''); $md.Add(('#' * [int]$Matches[1]) + " $t"); $prevList = $false; continue }
            if ($num) {
                $id = $num.GetAttribute('val', $W)
                if (-not $prevList) { $md.Add('') }
                if ($id -eq '1') { $md.Add("- $t") } else { $counters[$id] = 1 + [int]$counters[$id]; $md.Add("$($counters[$id]). $t") }
                $prevList = $true; continue
            }
            $prevList = $false
            $md.Add('')
            if ($sn -eq 'Quote') { $md.Add("> $t") } else { $md.Add($t) }
        } elseif ($el.LocalName -eq 'tbl') {
            $rows = @()
            foreach ($row in $el.SelectNodes('./w:tr', $ns)) {
                $cells = @(foreach ($c in $row.SelectNodes('./w:tc', $ns)) { (@($c.SelectNodes('./w:p', $ns) | ForEach-Object { PT $_ } | Where-Object { $_ }) -join ' / ') })
                $rows += , $cells
            }
            $md.Add(''); foreach ($l in (Md-Table $rows)) { $md.Add($l) }
            $prevList = $false
        }
    }
    $md
}

# ---------- TXT ----------
function Read-TextAuto($path) {
    $b = [IO.File]::ReadAllBytes($path)
    $u = (New-Object Text.UTF8Encoding($false, $true))
    try { return @{ Text = $u.GetString($b); Enc = 'UTF-8' } } catch { return @{ Text = [Text.Encoding]::GetEncoding(949).GetString($b); Enc = 'CP949' } }
}
function Convert-Txt($file) {
    $r = Read-TextAuto $file.FullName
    $script:lastEnc = $r.Enc
    $lines = $r.Text -replace "^﻿", '' -split "\r?\n"
    $md = New-Object Collections.Generic.List[string]
    $md.Add("# $($file.BaseName)"); $md.Add(''); $md.Add("## $($file.BaseName)"); $md.Add('')
    while ($lines.Count -gt 0 -and $lines[-1].Trim() -eq '') { $lines = $lines[0..($lines.Count - 2)] }
    foreach ($l in $lines) { $md.Add($l.TrimEnd()) }
    $md
}

New-Item -ItemType Directory -Force $OutDir | Out-Null
foreach ($f in Get-ChildItem $SrcDir -File) {
    $script:lastEnc = ''
    $raw = [IO.File]::ReadAllBytes($f.FullName)
    $isXml = $raw.Length -gt 5 -and $raw[0] -eq 0x3C -and $raw[1] -eq 0x3F
    switch -Regex ($f.Extension.ToLower()) {
        '\.hwp' { if ($isXml) { $md = Convert-Hwpml $f } else { "SKIP(바이너리 hwp) $($f.Name)"; continue } }
        '\.docx' { $md = Convert-Docx $f }
        '\.txt' { $md = Convert-Txt $f }
        '\.md' { $md = Get-Content $f.FullName -Encoding utf8 }
        default { "SKIP $($f.Name)"; continue }
    }
    $out = Join-Path $OutDir ($f.BaseName + '.md')
    [IO.File]::WriteAllText($out, (($md -join "`n") + "`n"), $utf8)
    "OK $($f.Name) -> $([IO.Path]::GetFileName($out)) $($script:lastEnc)"
}
