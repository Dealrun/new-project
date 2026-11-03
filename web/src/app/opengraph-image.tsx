import { renderThumbnail } from '@/lib/thumbnail';

// 링크 공유(카카오톡·메신저 등) 미리보기 썸네일
export const alt = 'OnDuty - 근무표는 자동으로, 변동은 즉시';
export const size = { width: 1200, height: 630 };
export const contentType = 'image/png';

export default function Image() {
  return renderThumbnail(size.height);
}
