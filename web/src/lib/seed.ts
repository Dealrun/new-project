// 처음 실행 시 시연용 가상 데이터(실제 인원·부대 정보 아님)를 넣는다.
import { now, today } from './common';
import { Tx, insertMany } from './db';
import { World } from './engine';

const SURNAMES = '김이박최정강조윤장임한오서신권황안송류홍';
const GIVEN = ['민준', '서준', '도윤', '예준', '시우', '하준', '주원', '지호', '지후', '준우',
  '준서', '건우', '현우', '도현', '선우', '우진', '민재', '현준', '연우', '유준',
  '정우', '승우', '승현', '시윤', '준혁', '은우', '지환', '승민', '지우', '유찬',
  '윤우', '민성', '준영', '시후', '진우', '지원', '수현', '재윤', '시현', '동현'];
const DEPTS = ['인사과', '정보과', '작전과', '군수과'];
const NO_PHONE = new Set([5, 27]); // 알림 실패·재발송 시연용

export async function seedIfEmpty(db: Tx) {
  if (await db.q1('SELECT 1 FROM people LIMIT 1')) return false;
  const rows: unknown[][] = [['편성담당', '대위', '인사과', 'admin', 'admin@mail.test', '010-0000-0000', '', 1, 1]];
  for (let i = 0; i < 40; i++) {
    const officer = i < 20;
    const rank = (officer ? ['대위', '중위', '소위'] : ['상사', '중사', '하사'])[i % 3];
    const id = String(i + 1).padStart(2, '0');
    rows.push([SURNAMES[i % 20] + GIVEN[i], rank, DEPTS[i % 4], `user${id}`, `user${id}@mail.test`,
      NO_PHONE.has(i) ? '' : `010-0000-${String(i + 1).padStart(4, '0')}`,
      (officer ? 'dangjik' : 'iljik') + ',bisang,chachul', 1, 0]);
  }
  await insertMany(db, 'people', ['name', 'rank', 'dept', 'login_id', 'email', 'phone', 'duties', 'active', 'is_admin'], rows);
  const year = Number(today().slice(0, 4));
  await insertMany(db, 'holidays', ['date', 'name'], [[`${year}-12-25`, '성탄절'], [`${year + 1}-01-01`, '신정']]);
  const month = today().slice(0, 7);
  // 이번 달 휴가자 1명(편성 시 건너뛰기 시연). id 4 = 세 번째 근무자
  await db.ex("INSERT INTO unavail(person_id, kind, start_date, end_date, memo, created) VALUES(4, '휴가', $1, $2, '연가', $3)",
    [`${month}-10`, `${month}-14`, now()]);
  const w = await World.load(db);
  w.generateMonth(month, '시스템(초기 데이터)');
  w.confirmMonth(month, '시스템(초기 데이터)', false);
  await w.flush(db);
  return true;
}
