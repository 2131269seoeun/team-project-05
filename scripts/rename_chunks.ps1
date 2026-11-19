param([string]$SrcDir, [string]$OutDir)
# 청킹 조각을 「문서코드_번호.md」로 바꿔 OutDir 로 옮긴다. 원래 제목은 조각 첫 줄 「출처」에 남아 있다.
# 새 문서를 넣으면 아래 $codes 에 「원본 이름 앞부분 = 문서코드」를 한 줄 더한다. 문서코드는 영문+호수로 짓는다.
$codes = [ordered]@{
    '서울특별시 성북구 폐기물 관리 조례(서울특별시 성북구조례)(제1349호)' = 'ord1349'
    '서울특별시 성북구 폐기물 관리 조례(서울특별시 성북구조례)(제1396호)' = 'ord1396'
    '폐기물관리법(법률)(제16318호)'                                       = 'law16318'
    '폐기물관리법 시행규칙(환경부령)(제00830호)'                           = 'rule830'
    '폐기물관리법 시행규칙(환경부령)(제00843호)'                           = 'rule843'
    '폐기물관리법 안전기준 위임과 성북구 조례 정비 사례'                   = 'case_safety'
}
New-Item -ItemType Directory -Force $OutDir | Out-Null
foreach ($f in Get-ChildItem $SrcDir -File -Filter *.md) {
    $code = $null
    foreach ($k in $codes.Keys) { if ($f.Name.StartsWith($k)) { $code = $codes[$k]; $rest = $f.Name.Substring($k.Length); break } }
    if (-not $code) { "코드 없음(옮기지 않음): $($f.Name)"; continue }
    $m = [regex]::Match($rest, '_(\d{2,3})_')
    if (-not $m.Success) { "번호 없음(옮기지 않음): $($f.Name)"; continue }
    $new = Join-Path $OutDir ("{0}_{1}.md" -f $code, $m.Groups[1].Value)
    if (Test-Path $new) { "이미 있음(옮기지 않음): $new"; continue }
    Move-Item -LiteralPath $f.FullName -Destination $new
}
