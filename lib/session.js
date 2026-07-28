// lib/session.js
// 카카오는 서버 세션을 대신 관리해주지 않으므로, botUserKey(사용자 id) 기준으로
// "마지막 기분/상황", "마지막으로 고른 컨셉", "이미 보여준 밈언 id" 를 메모리에 저장한다.
// (여러 서버 인스턴스로 스케일 아웃할 계획이라면 Redis 등으로 교체하면 된다.)

const SESSION_TTL_MS = 2 * 60 * 60 * 1000; // 2시간 동안 활동 없으면 초기화
const sessions = new Map();

function getSession(userId) {
  const s = sessions.get(userId);
  if (s && Date.now() - s.updatedAt < SESSION_TTL_MS) return s;
  const fresh = { mood: null, concept: null, shownIds: {}, shownTexts: {}, updatedAt: Date.now() };
  sessions.set(userId, fresh);
  return fresh;
}

function touch(session) {
  session.updatedAt = Date.now();
  return session;
}

function markShown(session, concept, id) {
  if (!session.shownIds[concept]) session.shownIds[concept] = [];
  if (!session.shownIds[concept].includes(id)) session.shownIds[concept].push(id);
}

// 즉석 생성된 밈언 문구(정적 id가 없는)를 텍스트 자체로 "봤음" 기록 - 같은 세션 안에서
// 방금 본 문장이 조합 생성기에서 또 나오는 것을 막는 데 쓰인다.
function markShownText(session, concept, text) {
  if (!session.shownTexts) session.shownTexts = {};
  if (!session.shownTexts[concept]) session.shownTexts[concept] = [];
  if (!session.shownTexts[concept].includes(text)) {
    session.shownTexts[concept].push(text);
    // 세션 하나가 무한정 커지지 않도록 최근 40개까지만 "회피 목록"으로 유지
    if (session.shownTexts[concept].length > 40) session.shownTexts[concept].shift();
  }
}

function getShownTextsSet(session, concept) {
  return new Set((session.shownTexts && session.shownTexts[concept]) || []);
}

function resetConcept(session, concept) {
  session.shownIds[concept] = [];
}

// 주기적으로 오래된 세션 정리 (메모리 누수 방지)
setInterval(() => {
  const now = Date.now();
  for (const [key, s] of sessions.entries()) {
    if (now - s.updatedAt > SESSION_TTL_MS) sessions.delete(key);
  }
}, 30 * 60 * 1000).unref();

module.exports = { getSession, touch, markShown, markShownText, getShownTextsSet, resetConcept };
