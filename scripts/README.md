# 문서 → 조각 만들기 스크립트

답변참고문서를 AI 가 찾기 좋은 조각(chunks)으로 만드는 순서. PowerShell 5.1 에서 돌린다.
스크립트 파일은 한글이 들어 있어 **UTF-8(BOM 포함)** 으로 저장해야 한다 — 아니면 글자가 깨져 실행이 안 된다.

## 순서

1. **받은 파일 넣기**: `docs/답변참고문서/원본` 에 넣는다. 원본은 고치거나 지우지 않는다(깃허브에는 올라가지 않음).
2. **.md 로 바꾸기** — `convert.ps1`
   ```powershell
   .\scripts\convert.ps1 -SrcDir docs\답변참고문서\원본 -OutDir docs\답변참고문서\청킹전
   ```
   - 법제처에서 받은 `.hwp` 는 실제로 XML(HWPML) 이라 그대로 읽는다. 진짜 한글 바이너리 `.hwp` 는 건너뛴다.
   - `.docx`, `.txt`(UTF-8, 안 되면 CP949) 도 바꾼다. 그림은 `{{IMG}}` 로 남으니 손으로 글자를 옮겨 적는다.
   - 질문 목록처럼 답의 근거가 아닌 파일은 청킹전에서 빼 `docs/테스트질문` 으로 옮긴다.
3. **조각 자르기** — `chunk.ps1` (임시 폴더에 먼저 만든다)
   ```powershell
   .\scripts\chunk.ps1 -SrcDir docs\답변참고문서\청킹전 -OutDir <임시폴더> -Max 1498
   ```
   - 법령·조례는 조마다, 그 밖에는 ## 소제목마다. 1500자 이하(출처·키워드 줄 제외), 100자 미만은 합친다(조문은 합치지 않음).
   - `-Max 1498` 은 출처 줄 뒤 빈 줄과 끝 줄바꿈 2자를 남기려는 것.
4. **키워드 넣기** — `addkw.ps1` + `keywords.txt`
   - 새 문서는 `keywords.txt` 에 「묶음|소제목|키워드」 줄을 사람이 읽고 더한다. `~` 는 이용자가 쓰는 비슷한 말.
   - 먼저 `-Apply` 없이 돌려 검사만 하고, 문제 목록을 본 뒤 `-Apply` 로 넣는다. 조각에 없는 말(~ 없는 것)은 자동으로 빠진다.
   - 새 문서 묶음 이름은 스크립트 안 `Fam` 함수에도 더한다.
   ```powershell
   .\scripts\addkw.ps1 -ChunkDir <임시폴더> -MapFile scripts\keywords.txt -Apply
   ```
5. **이름 바꿔 chunks 로 옮기기** — `rename_chunks.ps1`
   - 새 문서는 스크립트 안 `$codes` 에 「원본 이름 앞부분 = 문서코드(영문+호수)」를 더한다.
   ```powershell
   .\scripts\rename_chunks.ps1 -SrcDir <임시폴더> -OutDir chunks
   ```

## 배포용 저장 파일 만들기 (서버를 켜 둔 채 실행)
서버는 `node --env-file=.env dev-server.mjs` 로 켠다(주소 http://localhost:3000). 아래는 다른 터미널에서 실행한다.

| 파일 | 만드는 명령 | 언제 다시 만드나 |
|---|---|---|
| `data/demo-answers.json` — 예시 질문 6개의 답. 같은 질문이 오면 AI 를 부르지 않고 이 답을 보여 준다 | `node scripts/make-demo-answers.mjs` | `chunks/` 나 `api/ask.js` 의 프롬프트를 고친 뒤 |
| `data/law-snapshot.json` — 법제처에서 받은 현행 정보. 배포본에서 법제처가 막히면 「○월 ○일 확인해 저장해 둔 값」으로 대신 보여 준다 | `node scripts/make-law-snapshot.mjs` | 법령이 바뀌었을 때, 또는 배포 전에 한 번 |

- 예시 질문 문장을 바꾸면 `public/app.js` 의 `EXAMPLES` 와 `make-demo-answers.mjs` 의 `QUESTIONS` 를 같이 고친다.
- 두 파일은 `vercel.json` 의 `includeFiles`(`data/**`)로 배포본에 들어간다.

## 알아 둘 것
- `chunk.ps1`, `addkw.ps1` 은 같은 폴더에 `*_report.csv` 를 남긴다. 확인용이니 다 보면 지운다.
- 현행판 법령을 넣을 때도 이 순서를 그대로 쓴다. 과거판 조각과 섞이지 않게 문서코드에 호수를 꼭 넣는다.
