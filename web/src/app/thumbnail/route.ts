import { renderThumbnail } from '@/lib/thumbnail';

// 갤러리·발표용 대표 이미지 (16:10, 1800×1125). 카드가 16:10으로 잘라도 글자가 잘리지 않는다
export const dynamic = 'force-static';

export function GET() {
  return renderThumbnail(750, 1.5);
}
