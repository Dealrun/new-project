# OnDuty (웹 버전 · Vercel + Supabase)

당직사관 · 일직사관 · 비상대기 · 차출 근무표를 순번 규칙에 따라 자동 편성하고, 변동을 즉시 반영하며, 근무자 알림을 남기는 웹 앱입니다. 요구사항은 상위 폴더의 `PRD-근무순번도우미.md`를 따릅니다.

- **Next.js + TypeScript**: Vercel에 그대로 배포할 수 있는 구조
- **데이터**: `DATABASE_URL`이 있으면 **Supabase(PostgreSQL)**, 없으면 **내 PC 안의 내장 DB**(`.pglite` 폴더)를 씁니다. 그래서 Supabase 없이도 바로 실행해 볼 수 있습니다.
- 표 생성과 시연용 가상 데이터는 **처음 접속할 때 자동으로** 만들어집니다(SQL을 따로 실행할 필요 없음).

## 1. 내 PC에서 실행하기

필요한 것: **Node.js 20 이상** (설치 확인: 터미널에서 `node -v`)

1. 터미널(PowerShell)을 열고 이 `web` 폴더로 이동합니다.
   ```bash
   cd "C:\Users\dillo\OneDrive\바탕 화면\성균관대 AI\11월 보수교육\new project\web"
   ```
2. 처음 한 번만 패키지를 설치합니다.
   ```bash
   npm install
   ```
3. 실행합니다.
   ```bash
   npm run dev
   ```
4. 브라우저에서 **http://localhost:3000** 을 엽니다.
5. 로그인 화면에서 `대위 편성담당`(간부) 또는 아무 근무자 계정을 고릅니다.
6. 끌 때는 터미널에서 `Ctrl + C`.

처음 상태(시연 데이터)로 되돌리려면 서버를 끈 뒤 아래 명령을 실행하고 다시 `npm run dev` 하세요.
```bash
npm run reset-local
```

## 2. Supabase 연결하기 (온라인 저장)

1. https://supabase.com 에서 프로젝트를 만듭니다. (현재 연결된 프로젝트: `iypvnppcybdbsdkwjmjj`, 지역 eu-central-1)
2. 대시보드 상단 **Connect** → **Transaction pooler** 주소(포트 `6543`)를 복사합니다.
3. 이 폴더의 `.env.example`을 복사해 **`.env.local`** 로 저장하고, `DATABASE_URL=` 뒤에 붙여 넣습니다. `[YOUR-PASSWORD]`는 프로젝트 만들 때 정한 DB 비밀번호로 바꿉니다.
4. `npm run dev`로 다시 실행하면 Supabase에 표와 시연 데이터가 자동으로 만들어집니다. 화면 맨 아래에 `데이터 저장소: Supabase`로 표시됩니다.

> `.env.local`에는 비밀번호가 들어 있으므로 다른 사람과 공유하거나 GitHub에 올리지 마세요(`.gitignore`로 제외되어 있음).
> 모든 표에 RLS가 켜져 있어 Supabase 공개 키로는 데이터를 읽을 수 없고, 이 앱의 서버만 접근합니다.

## 3. Vercel에 배포하기

현재 배포 주소: **https://onduty-kappa.vercel.app** (Vercel 프로젝트 `dealrun/onduty`)

GitHub 저장소 `Dealrun/new-project`와 연결되어 있어서, `main` 브랜치에 올리면(push) 자동으로 다시 배포됩니다.
다른 브랜치에 올리면 미리보기 주소가 따로 만들어집니다.

처음부터 새로 연결할 때는 아래 순서를 따릅니다.

1. 이 프로젝트를 GitHub 저장소에 올립니다(Git 필요).
2. https://vercel.com 에서 **Add New → Project** 로 저장소를 가져옵니다. **Root Directory** 를 `web` 으로 지정합니다.
3. **Environment Variables** 에 다음을 넣습니다.
   - `DATABASE_URL`: 위 Supabase 주소
   - `CRON_SECRET`: 아무 긴 임의 문자열
   - `DEV_LOGIN`: 시연 중엔 `true`, 운영 전환 시 `false`
4. Deploy. 매일 17:00(한국 시간) 알림은 `vercel.json`의 Cron(08:00 UTC)이 자동으로 실행합니다.
   `vercel.json`의 서버 지역(`regions`)은 **Supabase 프로젝트와 같은 지역**이어야 빠릅니다.
   현재 Supabase 프로젝트가 프랑크푸르트(eu-central-1)라서 `fra1`로 맞춰 두었습니다. (서울 프로젝트라면 `icn1`)

> 내 PC에서 Supabase에 연결해 실행하면, 요청마다 DB가 있는 지역까지 여러 번 오가서 한 화면에 2~4초쯤 걸릴 수 있습니다.
> 배포된 Vercel에서는 서버와 DB가 같은 지역이라 이 지연이 거의 없습니다. PC에서 빠르게 확인하려면 `.env.local`의 `DATABASE_URL` 줄 앞에 `#`을 붙여 내장 DB로 실행하세요.

> ⚠️ PRD상 이 시스템은 **군 내부망 운영**이 전제입니다. Vercel·Supabase는 외부 인터넷 서비스이므로, 실제 인원 이름·연락처·일정은 넣지 말고 **시연용 가상 데이터로만** 사용하세요.

## 시연 순서 (완료 기준 D1~D8)

| 장면 | 하는 방법 |
|---|---|
| A. 월말 편성 (D1, D2, D8) | 간부 로그인 → **편성 관리 → 자동 편성·확정** → 다음 달 [자동 편성] → 검증·인원별 횟수 확인 → [달력에서 보기·수정]에서 칸 수정 → [확정] |
| B. 중간 변동 (D3) | **편성 관리 → 휴가·출장**에서 확정된 날짜 근무자를 휴가 등록 → 그 날짜만 바뀜, **순번·보충 대기열**에 오름, **변경 기록**에 남음 |
| C. 내 근무·교대 (D4, D5) | 근무자 로그인 → 첫 화면에 내 다음 근무 → 월간 근무표에서 노란 내 칸 클릭 → [교대 요청] → 상대방으로 로그인해 [수락] |
| D. 전날 알림 (D7) | 매일 17:00 자동. **알림 관리 → [지금 바로 실행 (시연)]**으로 즉시 확인 |
| E. 차출 (D6) | **편성 관리 → 차출 뽑기**에 인원 수 입력 |

## 환경변수

| 이름 | 설명 |
|---|---|
| `DATABASE_URL` | Supabase 연결 주소. 비우면 내 PC 내장 DB |
| `DEV_LOGIN` | 개발·시연용 임시 로그인 (`false`로 끔) |
| `DAILY_NOTIFY_TIME` | 전날 알림 시각, 기본 `17:00` (바꾸면 `vercel.json` cron도 맞춤) |
| `CRON_SECRET` | Vercel Cron 호출 확인용 비밀값 |
| `MAIL_ENABLED` / `MAIL_ENDPOINT` | 군 메일 연동(X2). `false`면 테스트 모드 |
| `ALIMTALK_ENABLED` / `ALIMTALK_ENDPOINT` | 알림톡 연동(X3). `false`면 테스트 모드 |

## 폴더 구조

```
src/app/login/              로그인 화면
src/app/(main)/page.tsx     S1 오늘 · 내 근무
src/app/(main)/calendar/    S2 월간 근무표
src/app/(main)/admin/       S3 편성 관리 (탭: src/components/admin/)
src/app/(main)/notify/      S4 알림 관리
src/app/api/[...path]/      API 입구 → src/lib/api.ts
src/app/api/cron/daily/     매일 17:00 알림 (Vercel Cron)
src/lib/engine.ts           편성 엔진 (순번·보충 대기열·규칙 R1~R7·교대·차출)
src/lib/db.ts, schema.ts    DB 연결(Supabase/내장)과 표 정의
src/lib/notifier.ts         메일·알림톡 어댑터, 알림 문구
src/lib/seed.ts             시연용 가상 데이터
src/app/globals.css         디자인
```
