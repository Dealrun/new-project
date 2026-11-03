"""처음 실행 시 시연용 가상 데이터(실제 인원·부대 정보 아님)를 넣는다."""
from . import engine as E
from .common import today

SURNAMES = '김이박최정강조윤장임한오서신권황안송류홍'
GIVEN = ['민준', '서준', '도윤', '예준', '시우', '하준', '주원', '지호', '지후', '준우',
         '준서', '건우', '현우', '도현', '선우', '우진', '민재', '현준', '연우', '유준',
         '정우', '승우', '승현', '시윤', '준혁', '은우', '지환', '승민', '지우', '유찬',
         '윤우', '민성', '준영', '시후', '진우', '지원', '수현', '재윤', '시현', '동현']
DEPTS = ['인사과', '정보과', '작전과', '군수과']
NO_PHONE = {5, 27}  # 알림 실패·재발송 시연용


def seed_if_empty(db):
    if db.q1('SELECT 1 FROM people'):
        return False
    db.ex('INSERT INTO people(name, rank, dept, login_id, email, phone, duties, active, is_admin) '
          "VALUES('편성담당', '대위', '인사과', 'admin', 'admin@mail.test', '010-0000-0000', '', 1, 1)")
    for i in range(40):
        officer = i < 20
        rank = (['대위', '중위', '소위'] if officer else ['상사', '중사', '하사'])[i % 3]
        duties = ('dangjik' if officer else 'iljik') + ',bisang,chachul'
        db.ex('INSERT INTO people(name, rank, dept, login_id, email, phone, duties) VALUES(?,?,?,?,?,?,?)',
              (SURNAMES[i % 20] + GIVEN[i], rank, DEPTS[i % 4], f'user{i + 1:02d}', f'user{i + 1:02d}@mail.test',
               '' if i in NO_PHONE else f'010-0000-{i + 1:04d}', duties))
    year = int(today()[:4])
    for date, name in [(f'{year}-12-25', '성탄절'), (f'{year + 1}-01-01', '신정')]:
        db.ex('INSERT INTO holidays(date, name) VALUES(?,?)', (date, name))
    month = today()[:7]
    # 이번 달 휴가자 1명(편성 시 건너뛰기 시연)
    db.ex("INSERT INTO unavail(person_id, kind, start, end, memo, created) VALUES(4, '휴가', ?, ?, '연가', ?)",
          (f'{month}-10', f'{month}-14', E.now()))
    E.generate_month(db, month, '시스템(초기 데이터)')
    E.confirm_month(db, None, month, '시스템(초기 데이터)')
    return True
