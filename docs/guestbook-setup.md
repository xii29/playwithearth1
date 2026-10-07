# Supabase 방명록 연결 안내

구현은 GitHub Pages 정적 사이트 → Supabase 직접 연결 방식입니다. 별도 서버나 로그인 설정은 필요하지 않습니다. 기존 갤러리 우상단 **방명록 ↗**으로 들어가며 주소는 `기존사이트주소/#guestbook`입니다. 해시 주소이므로 GitHub Pages에서 직접 접속하거나 새로고침해도 404가 발생하지 않습니다.

## 1. Supabase에 테이블 만들기

1. 생성해 둔 Supabase 프로젝트를 엽니다.
2. **SQL Editor → New query**를 엽니다.
3. 이 저장소의 [`supabase/guestbook.sql`](../supabase/guestbook.sql) 전체를 복사해 붙여 넣고 **Run**을 누릅니다.
4. **Table Editor**에 `guestbook_entries`가 생성되었는지 확인합니다.

이 SQL은 테이블·인덱스·RLS 정책을 만들고 Realtime publication에 테이블을 등록합니다. 이름은 1~30자, 메시지는 1~500자로 제한합니다. 브라우저 방문자는 조회와 작성만 가능하며 수정·삭제 권한은 없습니다. ID와 작성 시각은 데이터베이스가 정합니다. 같은 SQL을 다시 실행할 수 있습니다. 기존에 같은 이름으로 다른 구조의 테이블을 만든 경우에는 구조를 먼저 비교하세요.

프로젝트에서 Data API를 별도로 꺼 두었다면 다시 활성화하고 `public` 스키마가 노출 대상에 포함되어 있는지 확인하세요.

## 2. URL과 공개 키 확인

프로젝트 상단 **Connect**에서 Project URL과 Publishable key를 확인합니다. API 키는 프로젝트 **Settings → API Keys**에서도 확인할 수 있습니다.

- URL 예시: `https://abcdefgh.supabase.co`
- Publishable key 예시: `sb_publishable_...`
- 기존 프로젝트의 legacy `anon` 키도 같은 환경변수에 넣어 사용할 수 있습니다.

**`service_role`, `sb_secret_...`, 데이터베이스 비밀번호는 넣지 마세요.** 이 웹사이트는 브라우저에서 실행되므로 Vite 환경변수 값은 배포된 JavaScript에 포함됩니다. Publishable key는 공개 클라이언트용이고, 접근 권한은 1단계의 RLS와 테이블 권한으로 제한합니다. [Supabase API 키 안내](https://supabase.com/docs/guides/getting-started/api-keys)

## 3. 로컬에서 연결 확인하기

터미널에서 프로젝트 폴더로 이동한 뒤 실행합니다.

```bash
cp .env.example .env.local
```

`.env.local`을 열어 다음 두 값을 실제 프로젝트 값으로 바꿉니다.

```dotenv
VITE_SUPABASE_URL=https://실제프로젝트ID.supabase.co
VITE_SUPABASE_PUBLISHABLE_KEY=sb_publishable_실제공개키
```

```bash
npm install
npm run dev
```

터미널에 표시된 주소로 접속합니다. 현재 프로젝트의 개발 서버는 기존 설정대로 HTTPS를 사용합니다. `.env.local`은 Git에서 제외됩니다. 환경변수를 바꾸면 개발 서버를 껐다가 다시 실행하세요.

## 4. GitHub Pages에 공개 설정값 등록하기

로컬 `.env.local`은 GitHub Actions로 전달되지 않으므로 배포용 값도 별도로 등록합니다.

1. GitHub에서 현재 사이트 저장소를 엽니다.
2. **Settings → Secrets and variables → Actions → Variables** 탭을 엽니다.
3. **New repository variable**로 아래 두 개를 만듭니다. 이름은 대소문자까지 동일하게 입력하세요.

| Name | Value |
| --- | --- |
| `VITE_SUPABASE_URL` | 2단계의 Project URL |
| `VITE_SUPABASE_PUBLISHABLE_KEY` | 2단계의 Publishable key 또는 legacy anon 키 |

현재 워크플로는 **Repository variables**를 우선 읽고, 없으면 같은 이름의 **Repository secrets**를 읽습니다. 두 곳에 중복 등록했다면 Variables 값이 우선이므로 오래된 값은 수정하거나 제거하세요. URL 또는 공개 키가 누락되거나 형식이 잘못되면 빌드 전에 오류로 중단하여 연결되지 않는 사이트의 배포를 방지합니다. [GitHub 변수 안내](https://docs.github.com/en/actions/how-tos/write-workflows/choose-what-workflows-do/use-variables)

## 5. 변경 코드 배포하기

1. 이번 변경 파일을 커밋하고 저장소의 `main` 브랜치에 반영합니다. `.env.local`은 올리지 않습니다.
2. **Actions → Deploy to GitHub Pages**에서 `build`, `deploy`가 모두 성공하는지 확인합니다.
3. 이미 코드가 반영되어 있고 변수만 추가·변경했다면 **Run workflow → main → Run workflow**로 새 빌드를 실행합니다. 변수 변경만으로 기존 사이트가 갱신되지는 않습니다.
4. **Settings → Pages**의 배포 주소로 접속합니다. 기존 Pages 설정은 GitHub Actions를 그대로 사용합니다.

워크플로에 환경변수 주입을 추가해 두었으며 저장소 하위 경로(`/<저장소명>/`)와 커스텀 도메인 모두 기존 설정을 따릅니다.

## 6. 최종 동작 확인

1. 메인 페이지 우상단 **방명록 ↗**을 눌러 이동합니다.
2. 이름과 메시지를 입력하고 **작성하기**를 누릅니다.
3. 저장 성공 안내와 함께 새 포스트잇이 목록 맨 위에 붙는지 확인합니다.
4. 새로고침해도 글이 남아 있는지 확인합니다.
5. 시크릿 창 또는 다른 기기에서도 방명록을 열고 한쪽에서 글을 작성합니다. 다른 쪽에서도 자동으로 포스트잇이 생겨야 합니다.
6. Supabase **Table Editor → guestbook_entries**에 같은 내용이 저장되었는지 확인합니다.

최근 50개부터 표시하며 **이전 방명록 더 보기**로 과거 글을 가져옵니다. 실시간 연결이 끊기면 재접속을 시도하고, 화면이 활성화된 동안 30초 간격으로 최신 글을 다시 조회합니다. 조회·저장 요청은 최대 12초까지 기다린 뒤 중단하고 버튼과 입력을 복구합니다. 저장은 자동 재전송하지 않습니다. 네트워크 오류 시 작성 내용을 유지하며, 저장 응답을 확인하지 못한 경우에는 중복 작성 전에 목록을 확인하도록 안내합니다.

## 문제 해결

| 화면/현상 | 확인할 항목 |
| --- | --- |
| “연결을 준비하고 있어요”, 작성 버튼 비활성화 | 두 변수의 이름·값 확인. 로컬은 서버 재시작, 배포는 새 빌드 필요 |
| “방명록을 불러오지 못했어요” | Supabase 프로젝트 실행 상태, URL·키, SQL 실행 성공, Data API 활성화 확인 |
| 조회는 되지만 저장 실패 | SQL의 INSERT 정책과 컬럼 권한 적용 여부 확인. 이름 30자·메시지 500자 제한 확인 |
| 다른 창의 글이 즉시 나타나지 않음 | Database의 Publications에서 `supabase_realtime`에 `guestbook_entries`가 포함되는지 확인. SQL 재실행 가능. 네트워크의 WebSocket 차단 여부 확인 |
| 변수 등록 후에도 준비 중 | Repository variables 또는 secrets의 이름을 확인하고 Actions 새 빌드 후 강력 새로고침 |
| 원치 않는 글 삭제 | Supabase Table Editor에서 관리자가 해당 행을 직접 삭제. 이미 열린 화면에는 새로고침 후 반영 |

로그인 없는 공개 방명록이므로 누구나 이름을 정해 작성할 수 있고 작성자 인증·서버 측 스팸 방지는 포함하지 않습니다. 글은 공개되며 이름/내용/작성 시각만 저장합니다. 현재 단계에서 실제 Supabase 프로젝트 연결, 데이터 저장, RLS 실행 결과는 위 설정 후 확인해야 합니다.

공식 문서: [RLS](https://supabase.com/docs/guides/database/postgres/row-level-security), [Realtime Postgres Changes](https://supabase.com/docs/guides/realtime/postgres-changes).

## 개발 검증

`npm run build`로 타입 검사와 정적 빌드를 실행합니다. `node scripts/check-pages.mjs`는 배포 경로와 정적 파일을 검사합니다.

Playwright가 설치된 환경에서는 실제 프로젝트에 글을 쓰지 않고 브라우저의 REST/WebSocket 요청을 모의 응답으로 검증할 수 있습니다.

```bash
VITE_SUPABASE_URL=https://guestbook.supabase.co VITE_SUPABASE_PUBLISHABLE_KEY=sb_publishable_test PAGES_BASE_PATH=/int/ npm run build
PAGES_BASE_PATH=/int/ node scripts/check-guestbook.mjs
```

필요하면 `PLAYWRIGHT_MODULE`(Playwright 모듈 경로), `CHROME_PATH`(Chrome 실행 파일 경로)를 지정합니다. 이 테스트용 URL·키는 실제 배포 설정에 사용하지 않습니다. 테스트 후에는 실제 환경변수로 다시 빌드하세요. 모의 테스트는 실제 프로젝트에서 SQL·RLS·Realtime이 설정되었는지까지 보장하지 않으므로 6단계의 최종 확인이 필요합니다.
