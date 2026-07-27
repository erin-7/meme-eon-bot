// lib/compose.js
// concept + item -> 최종 PNG Buffer 를 만드는 오케스트레이션 레이어.
//
// 이미지 소스 우선순위
// 1) item.localImage 가 있고 public/memes/ 안에 실제 파일이 있으면
//    -> 이미 자막이 박혀있는 이미지로 보고 리사이즈만 해서 그대로 사용 (renderRawPhoto)
//       (본인이 사용 권한을 가진 이미지를 직접 넣고 싶을 때를 위한 확장 포인트. 기본으로는
//        어떤 파일도 들어있지 않음.)
// 2) item.person 이 있으면(진지/철학) -> 위키피디아에서 실시간으로 초상 사진을 가져와
//    그 위에 명언 자막을 합성 (renderPhotoCard)
// 3) item.stockQuery 가 있으면(존잼/황당/썰렁 등) -> Openverse(무료 CC 라이선스 스톡 이미지
//    검색 API)에서 어울리는 사진을 가져와 그 위에 자막을 합성 (renderPhotoCard)
// 4) 그 무엇도 없거나 전부 실패하면 -> 자체 제작 컬러 카드 (renderQuoteCard)

const fs = require('fs');
const path = require('path');
const { getPersonPortrait } = require('./wiki');
const { searchStockImage } = require('./stock');
const { renderQuoteCard, renderPhotoCard, renderRawPhoto } = require('./cardImage');

const MEMES_DIR = path.join(__dirname, '..', 'public', 'memes');

async function fetchImageBuffer(url) {
  const res = await fetch(url, {
    headers: { 'User-Agent': 'today-meme-eon-bot/1.0 (hackathon project)' },
    signal: AbortSignal.timeout(6000),
  });
  if (!res.ok) throw new Error(`image fetch failed: ${url} -> ${res.status}`);
  const arrayBuffer = await res.arrayBuffer();
  return Buffer.from(arrayBuffer);
}

async function composeCardImage(concept, item, meta) {
  // 1) 직접 넣어둔 이미지 (이미 자막이 있는 캡처짤 등) - 기본 제공되지 않음, 확장 포인트
  if (item.localImage) {
    const filePath = path.join(MEMES_DIR, item.localImage);
    if (fs.existsSync(filePath)) {
      try {
        const buf = fs.readFileSync(filePath);
        return await renderRawPhoto(buf);
      } catch (err) {
        console.error(`[compose] localImage 처리 실패 (${item.localImage}):`, err.message);
      }
    }
  }

  // 2) 실존 인물 -> 위키피디아 초상 사진 + 자막 합성
  if (item.person) {
    try {
      const portraitUrl = await getPersonPortrait(item.person);
      if (portraitUrl) {
        const buf = await fetchImageBuffer(portraitUrl);
        return await renderPhotoCard({
          backgroundBuffer: buf,
          quote: item.quote,
          source: item.source,
          captionStyle: meta.captionStyle || 'bar',
        });
      }
    } catch (err) {
      console.error(`[compose] 인물 사진 합성 실패 (${item.person?.ko}):`, err.message);
    }
  }

  // 3) 무료 CC 스톡 이미지(Openverse) + 자막 합성
  if (item.stockQuery) {
    try {
      const stock = await searchStockImage(item.stockQuery);
      if (stock?.url) {
        const buf = await fetchImageBuffer(stock.url);
        // CC 라이선스 요구사항에 맞춰 사진 출처(작가명)를 자막 하단에 함께 표기
        const source = stock.credit ? `${item.source} · 사진: ${stock.credit} (Openverse)` : item.source;
        return await renderPhotoCard({
          backgroundBuffer: buf,
          quote: item.quote,
          source,
          captionStyle: meta.captionStyle || 'bar',
        });
      }
    } catch (err) {
      console.error(`[compose] 스톡 이미지 합성 실패 (${item.stockQuery}):`, err.message);
    }
  }

  // 4) fallback: 자체 제작 컬러 카드
  return renderQuoteCard({ bg: meta.bg, fg: meta.fg, label: meta.label, quote: item.quote, source: item.source });
}

module.exports = { composeCardImage };
