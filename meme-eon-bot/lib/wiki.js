// lib/wiki.js
// 위키피디아 REST 요약 API로 실존 인물의 초상 이미지를 실시간으로 가져온다.
// 한국어 위키 -> 실패 시 영어 위키 순으로 시도하고, 그마저 실패하면 null을 반환한다.
// 짧은 시간(24시간) 동안 결과를 메모리에 캐싱해 매 요청마다 위키피디아를 호출하지 않는다.

const CACHE_TTL_MS = 24 * 60 * 60 * 1000; // 24시간
const cache = new Map(); // key: `${lang}:${title}` -> { url, expiresAt }

async function fetchSummaryThumbnail(lang, title) {
  const key = `${lang}:${title}`;
  const cached = cache.get(key);
  if (cached && cached.expiresAt > Date.now()) return cached.url;

  const endpoint = `https://${lang}.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(title)}`;
  try {
    const res = await fetch(endpoint, {
      headers: { 'User-Agent': 'today-meme-eon-bot/1.0 (hackathon project)' },
      signal: AbortSignal.timeout(4000),
    });
    if (!res.ok) throw new Error(`wiki ${lang} ${title} -> ${res.status}`);
    const json = await res.json();
    const url = json?.thumbnail?.source || json?.originalimage?.source || null;
    cache.set(key, { url, expiresAt: Date.now() + CACHE_TTL_MS });
    return url;
  } catch (err) {
    cache.set(key, { url: null, expiresAt: Date.now() + 5 * 60 * 1000 }); // 실패는 5분만 캐싱
    return null;
  }
}

/**
 * person: { ko: '소크라테스', en: 'Socrates' }
 * 반환: 이미지 URL 문자열 또는 null (못 찾으면 null, 호출부에서 자체 제작 카드로 대체)
 */
async function getPersonPortrait(person) {
  if (!person) return null;
  if (person.ko) {
    const url = await fetchSummaryThumbnail('ko', person.ko);
    if (url) return url;
  }
  if (person.en) {
    const url = await fetchSummaryThumbnail('en', person.en);
    if (url) return url;
  }
  return null;
}

module.exports = { getPersonPortrait };
