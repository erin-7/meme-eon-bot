// lib/session.js
// 카카오는 서버 세션을 대신 관리해주지 않으므로, botUserKey(사용자 id) 기준으로
// "마지막 기분/상황", "마지막으로 고른 컨셉", "이미 보여준 밈언 id" 를 메모리에 저장한다.
// (여러 서버 인스턴스로 스케일 아웃할 계획이라면 Redis 등으로 교체하면 된다.)

const SESSION_TTL_MS = 2 * 60 * 60 * 1000; // 2시간 동안 활동 없으면 초기화
const sessions = new Map();

function getSession(userId) {
  const s = sessions.get(userId);
  if (s && Date.now() - s.updatedAt < SESSION_TTL_MS) return s;
  const fresh = { mood: null, concept: null, shownIds: {}, updatedAt: Date.now() };
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

module.exports = { getSession, touch, markShown, resetConcept };
