// 썸네일·아이콘 이미지용 글꼴. 쓰인 글자만 Google Fonts에서 잘라 받아온다(한글 포함).
type Weight = 500 | 800;

async function load(text: string, weight: Weight): Promise<ArrayBuffer | null> {
  try {
    const chars = Array.from(new Set(text.replace(/\s/g, ''))).join('');
    const css = await (await fetch(
      `https://fonts.googleapis.com/css2?family=Noto+Sans+KR:wght@${weight}&text=${encodeURIComponent(chars)}`,
    )).text();
    const url = css.match(/src: url\((.+?)\) format\('(?:opentype|truetype)'\)/)?.[1];
    if (!url) return null;
    return await (await fetch(url)).arrayBuffer();
  } catch {
    return null; // 글꼴을 못 받아도 이미지는 만든다
  }
}

export async function ogFonts(text: string, weights: Weight[] = [500, 800]) {
  const fonts = await Promise.all(weights.map(async (weight) => {
    const data = await load(text, weight);
    return data ? { name: 'Noto Sans KR', data, weight, style: 'normal' as const } : null;
  }));
  return fonts.filter((f) => f !== null);
}
