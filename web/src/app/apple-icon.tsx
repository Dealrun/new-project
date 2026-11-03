import { renderIcon } from '@/lib/ogIcon';

// 아이폰 홈 화면에 추가할 때 쓰는 아이콘
export const size = { width: 180, height: 180 };
export const contentType = 'image/png';

export default function AppleIcon() {
  return renderIcon(size.width);
}
