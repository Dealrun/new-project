import datetime as dt

WEEKDAYS = ['월', '화', '수', '목', '금', '토', '일']


class ApiError(Exception):
    def __init__(self, status, message):
        super().__init__(message)
        self.status = status
        self.message = message


def now():
    return dt.datetime.now().strftime('%Y-%m-%d %H:%M:%S')


def today():
    return dt.date.today().isoformat()


def parse_date(s):
    try:
        return dt.date.fromisoformat(s)
    except (TypeError, ValueError):
        raise ApiError(400, f'날짜 형식이 올바르지 않습니다: {s}')


def add_days(s, n):
    return (parse_date(s) + dt.timedelta(days=n)).isoformat()


def fmt_date(s):
    d = parse_date(s)
    return f'{d.month}월 {d.day}일({WEEKDAYS[d.weekday()]})'
