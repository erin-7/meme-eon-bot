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
const { renderQuoteCard, renderPhotoCard, renderRawPhoto, renderMemeMacro, renderCompareCard, renderBrainCard } = require('./cardImage');

const MEMES_DIR = path.join(__dirname, '..', 'public', 'memes');

// 실제로 다운로드한 이미지 원본 바이트를 URL별로 캐싱한다. 같은 사진(같은 인물/같은 스톡컷)을
// 다른 밈언 항목이 재사용하는 경우가 많아서, 매번 새로 다운로드하지 않고 재사용하면
// 두 번째부터는 네트워크 왕복이 통째로 사라져서 훨씬 빨라진다.
const IMAGE_BUFFER_CACHE_TTL_MS = 24 * 60 * 60 * 1000;
const imageBufferCache = new Map(); // url -> { buffer, expiresAt }

async function fetchImageBuffer(url) {
  const cached = imageBufferCache.get(url);
  if (cached && cached.expiresAt > Date.now()) return cached.buffer;

  const res = await fetch(url, {
    headers: { 'User-Agent': 'today-meme-eon-bot/1.0 (hackathon project)' },
    signal: AbortSignal.timeout(8000),
  });
  if (!res.ok) throw new Error(`image fetch failed: ${url} -> ${res.status}`);
  const arrayBuffer = await res.arrayBuffer();
  const buffer = Buffer.from(arrayBuffer);
  imageBufferCache.set(url, { buffer, expiresAt: Date.now() + IMAGE_BUFFER_CACHE_TTL_MS });
  return buffer;
}

// 외부 네트워크(위키피디아/Openverse)에 의존하는 경로 전체에 거는 최대 예산 시간.
//
// 예전엔 이 값이 3.5초였는데, 이게 실제로 이미지가 거의 안 나오던 원인이었다: Openverse
// 검색 API 호출(수백ms~1초) + 실제 사진 바이너리 다운로드(수백KB~수MB, 1~수초)가 순서대로
// 일어나기 때문에 둘을 합치면 3.5초를 넘기기 매우 쉬웠고, 그러면 조용히 실패 처리되어
// 색깔만 있는 기본 카드로 계속 대체됐다.
//
// 이 봇은 Open Builder의 "5초 안에 동기 응답" 방식이 아니라, 웹훅에는 즉시 200으로만
// 응답하고 실제 답장은 콜백 API로 비동기 전송하는 구조라서, 텍스트 응답 자체는 이 예산과
// 무관하게 이미 끝난 상태다. 이 예산은 오직 "카카오 클라이언트가 나중에 썸네일 이미지 URL을
// 요청했을 때, 그 한 번의 HTTP 요청이 얼마나 기다려줄 것인가"에 대한 것이므로 여유 있게 늘린다.
const NETWORK_BUDGET_MS = 8000;

function timeoutAfter(ms) {
  return new Promise((resolve) => setTimeout(() => resolve(null), ms));
}

async function tryPersonPhoto(item, meta) {
  const portraitUrl = await getPersonPortrait(item.person);
  if (!portraitUrl) return null;
  const buf = await fetchImageBuffer(portraitUrl);
  return renderPhotoCard({
    backgroundBuffer: buf,
    quote: item.quote,
    source: item.source,
    captionStyle: meta.captionStyle || 'bar',
  });
}

async function tryStockPhoto(item, meta) {
  const stock = await searchStockImage(item.stockQuery);
  if (!stock?.url) return null;
  const buf = await fetchImageBuffer(stock.url);
  // CC 라이선스 요구사항에 맞춰 사진 출처(작가명)를 자막 하단에 함께 표기
  const source = stock.credit ? `${item.source} · 사진: ${stock.credit} (Openverse)` : item.source;
  return renderPhotoCard({
    backgroundBuffer: buf,
    quote: item.quote,
    source,
    captionStyle: meta.captionStyle || 'bar',
  });
}

async function composeCardImage(concept, item, meta) {
  // 0) "진짜 밈 포맷" 템플릿 (외부 네트워크 전혀 없음, 저작권 있는 사진/캐릭터도 없음).
  //    실제 밈에서 흔한 레이아웃(상하 자막 매크로, 인정/부정 2단 비교, 점점 커지는 뇌)을
  //    이모지 + 우리가 그린 도형으로 재현합니다. (data/content.js의 item.template 참고)
  if (item.template === 'macro') {
    return renderMemeMacro({ topText: item.topText, bottomText: item.bottomText, mood: item.mood, bg: meta.bg });
  }
  if (item.template === 'compare') {
    return renderCompareCard({ rejectText: item.rejectText, acceptText: item.acceptText });
  }
  if (item.template === 'brain') {
    return renderBrainCard({ stages: item.stages || [] });
  }

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

  // 2) 실존 인물 -> 위키피디아 초상 사진 + 자막 합성 (시간 예산 안에서만)
  if (item.person) {
    try {
      const result = await Promise.race([tryPersonPhoto(item, meta), timeoutAfter(NETWORK_BUDGET_MS)]);
      if (result) return result;
      console.warn(`[compose] 인물 사진 시간 초과/실패 -> 컬러 카드로 대체 (${item.person?.ko})`);
    } catch (err) {
      console.error(`[compose] 인물 사진 합성 실패 (${item.person?.ko}):`, err.message);
    }
  }

  // 3) 무료 CC 스톡 이미지(Openverse) + 자막 합성 (시간 예산 안에서만)
  if (item.stockQuery) {
    try {
      const result = await Promise.race([tryStockPhoto(item, meta), timeoutAfter(NETWORK_BUDGET_MS)]);
      if (result) return result;
      console.warn(`[compose] 스톡 이미지 시간 초과/실패 -> 컬러 카드로 대체 (${item.stockQuery})`);
    } catch (err) {
      console.error(`[compose] 스톡 이미지 합성 실패 (${item.stockQuery}):`, err.message);
    }
  }

  // 4) fallback: 자체 제작 컬러 카드 (외부 네트워크 전혀 없음, 항상 즉시 성공)
  return renderQuoteCard({ bg: meta.bg, fg: meta.fg, label: meta.label, quote: item.quote, source: item.source });
}

module.exports = { composeCardImage };
