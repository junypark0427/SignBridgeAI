# Supabase 공용 데이터베이스

기존 SignBridgeAI 프로젝트 `oswaoslijdmjymebwknh`를 사용합니다. 새 프로젝트 생성·기존 자료 초기화는 하지 않습니다. Project Settings → API Keys에서 Project URL과 Publishable Key를 확인합니다. Secret/service_role은 쓰지 않습니다.

## 설정과 SQL

`.env.example`을 `.env.local`로 복사해 VITE_SUPABASE_URL과 VITE_SUPABASE_PUBLISHABLE_KEY를 입력합니다. 실제 값은 Git 제외입니다. 설정이 없어도 로컬 기능은 유지하고, 실제 SELECT 응답 전에는 연결됨으로 표시하지 않습니다.

기존 Table Editor·RLS를 먼저 확인한 뒤 SQL Editor에서 `supabase/migrations/202610240001_sign_samples.sql` 전체를 실행합니다. 마지막 결과는 anon_select/anon_insert=true, anon_update/anon_delete=false여야 합니다. 다음 조회는 true여야 합니다.

이후 `supabase/migrations/202610250001_sample_archive.sql`을 실행합니다. 기존 휴지통 호환을 위해 `archived` 열만 익명 UPDATE를 허용합니다. 원본 프레임·시간·라벨은 수정할 수 없습니다.

마지막으로 **`supabase/migrations/202610310001_sample_delete.sql`**을 실행합니다. 2026-10-31 사용자 승인에 따라 anon DELETE와 `sb_anon_delete` RLS 정책을 추가합니다. 실제 프로젝트 적용 결과는 `delete_allowed=true`, `raw_update_allowed=false`입니다. 기존 실제 행을 지우는 SQL은 없습니다. 앞선 마이그레이션을 다시 실행하면 권한이 초기화되므로 세 파일을 날짜 순서로 모두 실행하세요.

삭제 UUID·시각만 보관하는 `sign_sample_deletions`는 RLS SELECT만 공개하고 INSERT·UPDATE·DELETE를 부여하지 않습니다. `sb_guard_sample_deletion`은 고정 search_path의 SECURITY DEFINER 트리거로 DELETE 전 UUID를 기록하고 INSERT 전 과거 삭제 여부를 확인합니다. 같은 UUID에 트랜잭션 advisory lock을 사용해 지연 업로드와 삭제를 직렬화합니다. 함수 직접 실행 권한은 공개하지 않습니다. 이 표에는 원본 좌표·단어·촬영자·세션을 복사하지 않습니다.

```sql
select relrowsecurity from pg_class where oid='public.sign_samples'::regclass;
```

마이그레이션은 트랜잭션으로 테이블·CHECK·인덱스·RLS·GRANT를 구성하며 테이블/행을 DROP·UPDATE하지 않습니다. 호환 구조에 복원용 추가 컬럼을 보완하고 필수 컬럼/PK/자료가 다르면 전체를 실패시킵니다. 오류 시 임의 삭제 대신 별도 이관을 설계하세요. 반복 실행 가능하며 JSON 검증 함수는 비노출 signbridge_private 스키마의 SECURITY INVOKER 함수입니다.

## sign_samples 구조

| 컬럼 | 의미 |
|---|---|
| id | UUID PK, 원본 sample_id 유지 |
| language | KSL / ASL |
| sign_id, concept_id, label | 표현·의미·단어 이름 |
| signer_id, session_id | 익명 촬영자·세션 |
| schema_version, preprocessing_version | 1.0.0, wrist-scale-spatial-v1 |
| duration_ms | double precision, 실측 양수 경과 |
| frame_count | integer, 1~7200, 배열 길이 일치 |
| frames | JSONB, 단어 동작 전체 |
| created_at | timestamptz, 수집 시작 |
| start_timestamp, end_timestamp | timestamptz, 원본 시간 복원 |
| capture | JSONB, 너비·높이·비반전 입력 |
| sign_metadata | JSONB, 설명·출처·대응 검증 표시 포함 |
| uploaded_at | timestamptz default now(), 서버 저장 시각 |
| is_test | boolean default false, 합성 DB 검증은 true |
| archived | boolean default false, 공용 휴지통 여부. 원본은 보존 |

프레임마다 요청하지 않고 시퀀스 하나를 한 행에 INSERT합니다. DB도 21개 유한 좌표, 좌우·손 수, 시간 순서/길이, 메타데이터를 검사합니다. frames는 최대 32MiB이며 원본 x/y를 clamp하지 않습니다. 언어+표현/촬영자/세션, 수집 시각 인덱스를 둡니다. 샘플이 없는 단어 등록은 로컬에만 존재합니다.

## 공개 정책

최종 권한은 anon SELECT·INSERT·DELETE, archived 열 UPDATE입니다. sb_anon_read·sb_anon_delete는 using(true), sb_anon_insert는 with check(true)이며 INSERT 형식은 CHECK로 제한합니다. 다른 열 UPDATE·TRUNCATE·upsert는 허용하지 않습니다. 회원 인증은 추가하지 않습니다.

로그인 없이 누구나 관절 데이터와 익명 ID를 조회·추가하고 **모든 공용 샘플을 영구 삭제할 수 있습니다**. 키를 숨기는 접근 통제가 아닙니다. 웹페이지의 삭제 확인창은 실수 방지 UI이며 API 권한을 제한하지 않습니다. 실명·영상·민감 정보를 저장하지 않고 촬영 동의·공유 범위를 팀이 관리합니다. 사용자별 데이터 오염/과다 추가 차단은 없습니다. 다른 기기에 이미 내려받은 사본을 원격 삭제할 수는 없지만 삭제 UUID 재업로드는 DB가 차단합니다.

## 동기화와 조회

IndexedDB 완료 → 프로젝트/UUID별 상태·내용 SHA-256 → INSERT → 서버 내용 일치 확인 순서입니다. UUID 중복(23505)은 SELECT로 같은 내용인지 확인합니다. 같으면 완료, 다르면 충돌입니다. 저장 직후 통신이 끊겨도 같은 UUID로 재시도합니다. 내용이나 프로젝트가 달라지면 과거 완료 표시를 재사용하지 않습니다. 실패/오프라인은 로컬에 보존하고 재연결·앱 시작·재시도 버튼으로 복구합니다.

목록은 25개 메타데이터 페이지, 전체 JSON/학습 조회는 10개씩 전체 프레임을 받습니다. 서버가 적은 행을 반환해도 실제 마지막 ID에서 이어 조회합니다. 전후 총수가 다르면 재시도하며, 동시 변경이 전혀 없는 DB 스냅샷은 보장하지 않습니다. is_test=true는 기본 조회/내보내기/학습에서 제외합니다. 기본 조회는 KSL·ASL 전체이며, 촬영 라디오와 공용 필터의 이벤트를 분리합니다. 공용 전체 개수·조건별 개수·마지막 조회 시각을 표시하고 수집 화면 진입/탭 복귀/동기화 종료 시 갱신합니다. 진행 중 들어온 갱신 요청은 한 번 추가 실행하여 최신 요청이 사라지지 않게 합니다. 실시간 구독은 없습니다. 기기별 수집 목록과 공용 목록은 별개이며 자세한 점검 절차는 README의 '다른 기기에서 데이터가 안 보일 때'를 따릅니다.

## 검사와 Netlify

`npm run test:archive`는 기존 is_test 합성 행의 휴지통 이동·원본 불변·복원을 확인하고 존재하지 않는 UUID로 원본 UPDATE 거절·DELETE 허용을 검사합니다. 정상 목록은 archived=false이며 이전 휴지통 목록에서는 복원과 실제 삭제가 가능합니다.

`npm test`는 합성 데이터·모의 저장소로 오프라인·재시도·내용 충돌·삭제 재업로드 방지·DTW를 검사합니다. `npm run test:database`는 실제 DB에 is_test 빈 손 시퀀스 2개를 추가하고 SELECT·필터·중복·형식 오류·원본 UPDATE 거절을 확인한 뒤, 이번 실행에서 만든 UUID만 삭제하고 재INSERT 차단을 확인합니다. 실제 영상/수어 자료는 지우지 않습니다.

`npm run test:comparison`은 기존 활성 자료 조회·트림과 자기 자신 비교만 수행합니다(실제 인식 정확도 평가 아님). `--prepare-delete`는 삭제 검증 전용 합성 행 하나를 만들고 UUID를 .tools에 기록합니다. 웹 UI에서 해당 테스트 행만 삭제한 뒤 `--verify-delete`를 실행하면 별도 클라이언트에서 부재·삭제 기록·재업로드 차단·기존 UUID 보존을 검증합니다. 테스트 행은 실제 수어가 아니며 검증 직후 삭제하세요.

웹 삭제는 UUID·is_test=false 조건 DELETE → 응답 검사 → ID SELECT 부재 → 삭제 기록 확인 순서입니다. 확인 전에는 성공으로 표시하지 않습니다. 삭제와 업로드가 경합해도 서버의 트리거가 재등록을 막습니다. 로컬 동기화는 삭제 기록 조회 또는 SB_SAMPLE_DELETED 응답을 `deleted` 상태로 저장하고 재시도하지 않습니다. 네트워크 실패는 원본을 보존합니다.

[Supabase DELETE 문서](https://supabase.com/docs/reference/javascript/delete), [RLS 문서](https://supabase.com/docs/guides/database/postgres/row-level-security)를 참고하세요.

기존 signbridgeai1 프로젝트 → Project configuration → Environment variables에서 두 VITE 변수를 Build에 제공하고 Deploys에서 재배포합니다. 기존 JS는 환경 변수 변경만으로 갱신되지 않습니다. 빌드 npm run build, publish dist, Node 24입니다. netlify.toml에 실제 키를 넣지 않습니다. 수동 배포는 환경 변수가 반영된 dist를 기존 사이트에 올립니다. 공개 주소만으로 관리 설정을 바꿀 수 없고 로그인·계정 사용량 문제는 기존 소유자가 해결해야 합니다.
