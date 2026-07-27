// server.js
// "오늘의 밈언" 카카오톡 챗봇 스킬 서버
//
// 대화 흐름
// 1) 사용자가 오늘 기분/상황을 자유롭게 입력 -> 컨셉 선택 버튼(존잼/진지/황당/썰렁/철학) 제공
// 2) 컨셉 버튼 클릭 -> 해당 컨셉의 밈언 카드(이미지+텍스트) 응답 + 후속 액션 버튼 제공
//    - 🔁 비슷한 밈언 더   : 같은 컨셉에서 다른 항목
//    - 🔀 다른 컨셉        : 컨셉 선택 화면으로 복귀
//    - 🆕 다른 기분/상황    : 세션 초기화 후 처음부터 다시
//
// 이미지 파이프라인 (lib/compose.js 참고)
// - 채팅 응답(/skill)은 이미지 URL만 즉시 돌려주고(카카오 스킬 타임아웃 5초 안에 끝나야 함),
//   실제 이미지 합성(위키피디아 조회 등 네트워크가 걸리는 작업)은 카카오 클라이언트가
//   그 이미지 URL(/api/card/...)을 따로 요청할 때 수행 + 캐시한다.
//
// 스킬 응답 포맷: https://kakaobusiness.gitbook.io/main/tool/chatbot/skill_guide/answer_json_format

const express = require('express');
const path = require('path');

const { CONCEPT_ORDER, CONCEPT_META, CONTENT } = require('./data/content');
const { simpleText, basicCard, skillResponse, quickReply } = require('./lib/kakao');
const { getSession, touch, markShown, resetConcept } = require('./lib/session');
const { composeCardImage } = require('./lib/compose');

const app = express();
app.set('trust proxy', true);
app.use(express.json({ limit: '1mb' }));
app.use('/memes', express.static(path.join(__dirname, 'public', 'memes')));

const PORT = process.env.PORT || 3000;

// ---- 대화 명령어 상수 ----------------------------------------------------
const CMD = {
  MORE_SAME: '비슷한 밈언 더',
  OTHER_CONCEPT: '다른 컨셉',
  RESET_MOOD: '다른 기분/상황',
};

// ---- 완성된 이미지 캐시 (프로세스 메모리, 최초 1회만 합성) ---------------------
const imageCache = new Map(); // key: `${concept}:${id}` -> Buffer
const inFlight = new Map(); // 동시에 같은 이미지가 여러 번 요청될 때 중복 합성 방지

function findItem(concept, id) {
  return (CONTENT[concept] || []).find((it) => it.id === id);
}

async function getCardImage(concept, item) {
  const key = `${concept}:${item.id}`;
  if (imageCache.has(key)) return imageCache.get(key);
  if (inFlight.has(key)) return inFlight.get(key);

  const promise = composeCardImage(concept, item, CONCEPT_META[concept])
    .then((buf) => {
      imageCache.set(key, buf);
      inFlight.delete(key);
      return buf;
    })
    .catch((err) => {
      inFlight.delete(key);
      throw err;
    });
  inFlight.set(key, promise);
  return promise;
}

function baseUrl(req) {
  return process.env.PUBLIC_BASE_URL || `${req.protocol}://${req.get('host')}`;
}

function thumbnailUrlFor(req, concept, item) {
  return `${baseUrl(req)}/api/card/${encodeURIComponent(concept)}/${encodeURIComponent(item.id)}.png`;
}

function pickItem(session, concept) {
  const pool = CONTENT[concept] || [];
  const shown = session.shownIds[concept] || [];
  let candidates = pool.filter((it) => !shown.includes(it.id));
  if (candidates.length === 0) {
    resetConcept(session, concept);
    candidates = pool;
  }
  return candidates[Math.floor(Math.random() * candidates.length)];
}

function conceptQuickReplies() {
  return CONCEPT_ORDER.map((c) => {
    const m = CONCEPT_META[c];
    return quickReply(`${m.emoji} ${c}`, c);
  });
}

function followUpQuickReplies() {
  return [
    quickReply('🔁 비슷한 밈언 더', CMD.MORE_SAME),
    quickReply('🔀 다른 컨셉', CMD.OTHER_CONCEPT),
    quickReply('🆕 다른 기분/상황', CMD.RESET_MOOD),
  ];
}

function conceptPickerResponse(moodText) {
  const intro = moodText
    ? `"${moodText}" 그런 기분/상황이시군요!\n오늘은 어떤 텐션의 밈언이 필요하세요?`
    : '오늘 기분이나 상황을 말씀해주셔도 좋고, 아래에서 바로 텐션을 골라도 좋아요!';
  return skillResponse([simpleText(intro)], conceptQuickReplies());
}

function conceptAnswerResponse(req, session, concept) {
  const item = pickItem(session, concept);
  markShown(session, concept, item.id);
  const meta = CONCEPT_META[concept];

  const card = basicCard({
    title: `${meta.emoji} ${concept} 밈언`,
    description: `"${item.quote}"\n- ${item.source}`,
    thumbnailUrl: thumbnailUrlFor(req, concept, item),
  });

  return skillResponse([card], followUpQuickReplies());
}

// ---- 라우트 ----------------------------------------------------------------

app.get('/', (_req, res) => {
  res.type('text/plain').send('오늘의 밈언 스킬 서버가 살아있어요 🎉');
});

// 밈 카드 이미지 (basicCard.thumbnail.imageUrl 이 가리키는 실제 이미지)
app.get('/api/card/:concept/:idPng', async (req, res) => {
  const concept = decodeURIComponent(req.params.concept);
  const id = decodeURIComponent(req.params.idPng).replace(/\.png$/i, '');
  const item = findItem(concept, id);
  if (!item) return res.status(404).send('not found');

  try {
    const buf = await getCardImage(concept, item);
    res.set('Content-Type', 'image/png');
    res.set('Cache-Control', 'public, max-age=31536000, immutable');
    res.send(buf);
  } catch (err) {
    console.error('[card image error]', err);
    res.status(500).send('image render failed');
  }
});

// (선택) 보안 헤더 검증 - Open Builder 스킬 서버 설정의 "헤더" 에 아래와 같은
// 값을 넣어두면, 아무나 웹훅 URL을 알아내 호출하는 것을 막을 수 있습니다.
function verifySkillSecret(req, res, next) {
  const expected = process.env.KAKAO_SKILL_SECRET;
  if (!expected) return next(); // 설정 안 했으면 검증 생략
  const headerName = (process.env.KAKAO_SKILL_HEADER || 'x-kakao-skill-secret').toLowerCase();
  const got = req.headers[headerName];
  if (got !== expected) return res.status(403).json({ error: 'invalid skill secret' });
  return next();
}

app.post('/skill', verifySkillSecret, (req, res) => {
  try {
    const utterance = (req.body?.userRequest?.utterance || '').trim();
    const userId = req.body?.userRequest?.user?.id || 'anonymous';
    const session = touch(getSession(userId));

    let response;

    if (CONCEPT_ORDER.includes(utterance)) {
      session.concept = utterance;
      response = conceptAnswerResponse(req, session, utterance);
    } else if (utterance === CMD.MORE_SAME && session.concept) {
      response = conceptAnswerResponse(req, session, session.concept);
    } else if (utterance === CMD.OTHER_CONCEPT) {
      response = conceptPickerResponse(session.mood);
    } else if (utterance === CMD.RESET_MOOD) {
      session.mood = null;
      session.concept = null;
      response = skillResponse([
        simpleText('좋아요, 처음부터 다시 가볼게요!\n오늘 기분이나 상황을 편하게 말해주세요 🙂'),
      ]);
    } else {
      // 새로운 기분/상황 입력으로 간주
      session.mood = utterance || null;
      response = conceptPickerResponse(session.mood);
    }

    res.json(response);
  } catch (err) {
    console.error('[skill error]', err);
    res.json(
      skillResponse([
        simpleText('앗, 밈언을 준비하다가 딸꾹질을 했어요 😵 다시 한 번 말씀해주시겠어요?'),
      ])
    );
  }
});

app.listen(PORT, () => {
  console.log(`오늘의 밈언 스킬 서버 실행 중: http://localhost:${PORT}`);
});
