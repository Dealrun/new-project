'use client';
import { ReactNode, useState } from 'react';
import { LogTab, QueueTab, SettingsTab } from '@/components/admin/InfoTabs';
import { PeopleTab } from '@/components/admin/PeopleTab';
import { PlanTab } from '@/components/admin/PlanTab';
import { DrawTab, HolidaysTab, UnavailTab } from '@/components/admin/RecordTabs';
import { PageHero } from '@/components/ui';
import { S } from '@/lib/client';

const TABS: [string, string, () => ReactNode][] = [
  ['plan', '자동 편성·확정', PlanTab], ['people', '인원 관리', PeopleTab], ['unavail', '휴가·출장', UnavailTab],
  ['holidays', '공휴일', HolidaysTab], ['draw', '차출 뽑기', DrawTab], ['queue', '순번·보충 대기열', QueueTab],
  ['log', '변경 기록', LogTab], ['settings', '설정', SettingsTab],
];

export default function AdminPage() {
  const [tab, setTab] = useState(S.adminTab);
  const Current = (TABS.find((t) => t[0] === tab) ?? TABS[0])[2];
  return (
    <>
      <PageHero eyebrow="Planning" title="편성 관리" desc="인원·휴가를 입력하고 버튼 한 번으로 근무표를 채웁니다. 모든 변경은 기록에 남습니다." />
      <div className="container page">
        <div className="tabs">
          {TABS.map(([k, label]) => (
            <button key={k} className={tab === k ? 'active' : ''} onClick={() => { S.adminTab = k; setTab(k); }}>{label}</button>
          ))}
        </div>
        <Current key={tab} />
      </div>
    </>
  );
}
