// lib/stock.js
// Openverse(openverse.org) API로 무료/CC 라이선스 스톡 이미지를 검색한다.
// API 키가 필요 없어서 별도 가입 없이 바로 쓸 수 있다 (단, 인증 없이는 호출 빈도 제한이 있으므로
// 검색 결과를 24시간 캐싱해서 같은 검색어를 반복 호출하지 않는다).
// license_type=commercial 로 걸어서 비교적 자유롭게 재사용 가능한 라이선스만 받아온다.

const CACHE_TTL_MS = 24 * 60 * 60 * 1000;
const cache = new Map(); // query -> { data, expiresAt }

async function searchStockImage(query) {
  const cached = cache.get(query);
  if (cached && cached.expiresAt > Date.now()) return cached.data;

  const endpoint = `https://api.openverse.org/v1/images/?${new URLSearchParams({
    q: query,
    page_size: '10',
    license_type: 'commercial',
    mature: 'false',
  })}`;

  try {
    const res = await fetch(endpoint, {
      headers: { 'User-Agent': 'today-meme-eon-bot/1.0 (hackathon project)' },
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) throw new Error(`openverse ${query} -> ${res.status}`);
    const json = await res.json();
    const results = (json.results || []).filter((r) => r.url);
    if (!results.length) throw new Error(`openverse ${query} -> no results`);

    const pick = results[Math.floor(Math.random() * Math.min(results.length, 5))];
    const data = {
      url: pick.url,
      credit: pick.creator || null,
      landingUrl: pick.foreign_landing_url || null,
      license: pick.license || null,
    };
    cache.set(query, { data, expiresAt: Date.now() + CACHE_TTL_MS });
    return data;
  } catch (err) {
    cache.set(query, { data: null, expiresAt: Date.now() + 5 * 60 * 1000 });
    return null;
  }
}

module.exports = { searchStockImage };
