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

const { CONCEPT_ORDER, CONCEPT_META, CONTENT, classifyConcept, matchesMood } = require('./data/content');
const { simpleText, basicCard, textCard, messageButton, skillResponse } = require('./lib/kakao');
const { getSession, touch, markShown, resetConcept } = require('./lib/session');
const { composeCardImage } = require('./lib/compose');
const { sendSkillCallback } = require('./lib/kakaoCallback');

const app = express();
app.set('trust proxy', true);
app.use(express.json({ limit: '1mb' }));
app.use((req, _res, next) => {
  console.log(`[요청] ${req.method} ${req.originalUrl}`);
  next();
});
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

  // 사용자가 말한 기분/상황(session.mood)에 맞는 항목이 이 컨셉 안에 있는지 먼저,
  // "이미 보여준 것" 필터를 적용하기 전에 통째로 확인합니다. (예: "창피했어" -> 창피부끄러움)
  // 이렇게 해야 "비슷한 밈언 더"를 여러 번 눌러서 그 카테고리 항목을 다 보여준 뒤에도
  // 엉뚱한 "범용"/랜덤 카테고리로 새지 않고, 같은 주제 안에서 돌려가며 계속 보여줄 수 있습니다.
  if (session.mood) {
    const moodPool = pool.filter((it) => matchesMood(it, session.mood));
    if (moodPool.length) {
      let candidates = moodPool.filter((it) => !shown.includes(it.id));
      if (candidates.length === 0) {
        // 이 기분 카테고리 항목을 이미 다 보여줬으면, 컨셉 전체가 아니라 이 카테고리 안에서만
        // "본 것"을 리셋하고 다시 돌려가며 보여줍니다 (엉뚱한 주제로 새지 않도록).
        session.shownIds[concept] = shown.filter((id) => !moodPool.some((it) => it.id === id));
        candidates = moodPool;
      }
      return candidates[Math.floor(Math.random() * candidates.length)];
    }

    // 이 컨셉 안에 구체적인 카테고리와 맞는 항목이 아예 없을 때만(=아직 못 알아듣는 표현이어도),
    // "배고픔" 얘기에 "돈 절약" 개그처럼 완전히 딴 얘기가 튀어나오는 것만은 막아야 합니다.
    // 그래서 어떤 상황에 갖다 붙여도 안전한 "범용" 태그 항목을 우선 사용합니다.
    const universalPool = pool.filter((it) => it.moodTags && it.moodTags.includes('범용'));
    if (universalPool.length) {
      let candidates = universalPool.filter((it) => !shown.includes(it.id));
      if (candidates.length === 0) {
        session.shownIds[concept] = shown.filter((id) => !universalPool.some((it) => it.id === id));
        candidates = universalPool;
      }
      return candidates[Math.floor(Math.random() * candidates.length)];
    }
  }

  // mood 태그가 아예 없거나(다른 컨셉 고르기 등) 이 컨셉엔 관련/범용 항목이 하나도 없을 때: 전체 랜덤
  let candidates = pool.filter((it) => !shown.includes(it.id));
  if (candidates.length === 0) {
    resetConcept(session, concept);
    candidates = pool;
  }
  return candidates[Math.floor(Math.random() * candidates.length)];
}

// 이 봇 제품은 Open Builder의 quickReplies(말풍선 아래 칩)를 지원하지 않아서,
// 실제로 눌리는 버튼은 textCard/basicCard 안의 buttons 뿐입니다. 그래서 선택지는
// 전부 textCard 버튼으로 제공하고, 혹시 사용자가 버튼 대신 그냥 텍스트로
// "팩폭", "웃긴거" 처럼 자연스럽게 타이핑해도 classifyConcept()로 알아서 인식합니다.
function conceptButtons() {
  return CONCEPT_ORDER.map((c) => {
    const m = CONCEPT_META[c];
    return messageButton(`${m.emoji} ${c}`, c);
  });
}

function followUpButtons() {
  return [
    messageButton('🔁 비슷한 밈언 더', CMD.MORE_SAME),
    messageButton('🔀 다른 컨셉', CMD.OTHER_CONCEPT),
    messageButton('🆕 다른 기분/상황', CMD.RESET_MOOD),
  ];
}

function conceptPickerResponse(moodText) {
  const intro = moodText
    ? `"${moodText}" 그런 기분/상황이시군요!\n오늘은 어떤 텐션의 밈언이 필요하세요?`
    : '오늘 기분이나 상황을 말씀해주셔도 좋고, 아래 버튼으로 바로 텐션을 골라도 좋아요!';
  const card = textCard({
    title: '어떤 텐션이 필요하세요?',
    description: intro,
    buttons: conceptButtons(),
  });
  return skillResponse([card]);
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

  const followUp = textCard({
    title: '다음은 뭐 하실래요?',
    description: '더 보고 싶으면 아래에서 골라주세요!',
    buttons: followUpButtons(),
  });

  return skillResponse([card, followUp]);
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

// 이 "카카오톡 봇" 제품은 Open Builder와 다르게, 웹훅 요청 자체에 답을 실어 보내지 않습니다.
// 대신:
//   1) 웹훅으로 { op, d, t } 형태의 이벤트가 오면 (d.type === 'MESSAGE_CREATE')
//   2) 우리는 먼저 웹훅에 200으로 "잘 받았다"고만 응답하고
//   3) d.callbackToken 을 이용해 별도로 POST https://kapi.kakao.com/v1/bot/callback 을
//      호출해서 실제 답장(SkillResponse)을 전달합니다. (콜백 토큰은 5분 이내에만 유효)
// 참고: https://developers.kakao.com/docs/in/bot/rest-api#callback-msg-sample-request
app.post('/skill', verifySkillSecret, async (req, res) => {
  console.log('[skill 요청 원본 바디]', JSON.stringify(req.body));

  const evt = req.body || {};
  const d = evt.d || {};
  const type = d.type || evt.t;

  // MESSAGE_CREATE가 아닌 다른 이벤트(초대 등)는 일단 ack만 하고 무시합니다.
  if (type !== 'MESSAGE_CREATE') {
    return res.sendStatus(200);
  }

  const utterance = (d.content || '').trim();
  const userId = d.botUserKey || 'anonymous';
  const callbackToken = d.callbackToken;

  // 웹훅은 여기서 바로 ack. 실제 답장은 아래에서 콜백 API로 비동기 전송합니다.
  res.sendStatus(200);

  if (!callbackToken) {
    console.error('[skill] callbackToken이 없어서 답장을 보낼 수 없습니다:', JSON.stringify(d));
    return;
  }

  try {
    const session = touch(getSession(userId));
    let response;

    const isExplicitConceptButton = CONCEPT_ORDER.includes(utterance);
    const matchedConcept = isExplicitConceptButton ? utterance : classifyConcept(utterance);

    if (matchedConcept) {
      // 버튼을 눌렀거나("존잼"), 자유 텍스트에 컨셉을 알아볼 수 있는 단어가
      // 있으면("팩폭이 필요해!") 바로 그 컨셉의 밈언을 보여줍니다.
      session.concept = matchedConcept;
      if (!isExplicitConceptButton) {
        // 자유 텍스트로 컨셉을 골랐다면 그 문장 자체를 기분/상황으로도 기억해서
        // pickItem()의 moodTags 매칭에 활용합니다. 버튼을 그냥 누른 경우엔 그 전에
        // 입력했던 진짜 기분/상황(session.mood)을 그대로 유지합니다.
        session.mood = utterance;
      }
      response = conceptAnswerResponse(req, session, matchedConcept);
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
      // 컨셉을 못 알아들었으면, 기분/상황으로 저장해두고 버튼으로 골라달라고 요청
      session.mood = utterance || null;
      response = conceptPickerResponse(session.mood);
    }

    await sendSkillCallback(callbackToken, response);
    console.log('[skill] 콜백 답장 전송 완료:', userId, '->', utterance);
  } catch (err) {
    console.error('[skill error]', err);
    try {
      await sendSkillCallback(
        callbackToken,
        skillResponse([
          simpleText('앗, 밈언을 준비하다가 딸꾹질을 했어요 😵 다시 한 번 말씀해주시겠어요?'),
        ])
      );
    } catch (cbErr) {
      console.error('[skill error - 콜백 전송도 실패]', cbErr);
    }
  }
});

app.listen(PORT, () => {
  console.log(`오늘의 밈언 스킬 서버 실행 중: http://localhost:${PORT}`);
});
