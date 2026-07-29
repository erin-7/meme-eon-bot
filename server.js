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

const {
  CONCEPT_ORDER,
  CONCEPT_META,
  CONTENT,
  classifyConcept,
  matchesMood,
  detectMoodCategories,
  generateQuote,
  pickStockQuery,
  getAllStockQueries,
} = require('./data/content');
const { simpleText, basicCard, textCard, messageButton, skillResponse } = require('./lib/kakao');
const { getSession, touch, markShown, markShownText, getShownTextsSet, resetConcept } = require('./lib/session');
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

// 오픈채팅방(그룹방)에서 버튼을 누르면, 카카오가 "@오늘의 밈언 " 같은 멘션을 자동으로
// 앞에 붙여서 그대로 다시 웹훅으로 보내주는 경우가 있습니다(1:1 채팅에는 멘션이 안 붙습니다).
// 이걸 그대로 CONCEPT_ORDER.includes(utterance)나 utterance === CMD.MORE_SAME 같은
// 정확히 일치(===) 비교에 넣으면 절대 매치가 안 돼서 - "비슷한 밈언 더"를 눌러도 그 분기를
// 타지 못하고 엉뚱하게 "컨셉을 못 알아들었다" 분기로 빠지면서 다시 텐션 선택 화면이 뜨고,
// 심지어 그 과정에서 session.mood가 이 지저분한 문자열로 덮어써져서 원래 기분/상황
// (예: "스트레스 받았어")까지 조용히 사라져버립니다. 그래서 버튼/컨셉 매칭에 쓰기 전에
// 반드시 이 멘션과 이모지를 먼저 떼어내고 비교해야 합니다.
const BOT_NAME = '오늘의 밈언';
// 이름 안의 공백은 "필수"가 아니라 "있을 수도 없을 수도" 있는 걸로 취급해야 하므로,
// 공백을 뺀 순수 글자들 사이사이에 \s*(있어도 없어도 됨)를 끼워 넣는다.
// 이렇게 해야 "@오늘의 밈언", "@오늘의밈언" 둘 다 정확히 잡아낸다.
const BOT_NAME_CHARS = BOT_NAME.replace(/\s+/g, '').split('');
const MENTION_PATTERN = new RegExp('^@?\\s*' + BOT_NAME_CHARS.join('\\s*') + '\\s*');
// 버튼 라벨에 쓰인 이모지들(😆🤔🤪😴🏛️🔁🔀🆕 등)을 광범위하게 걸러내는 정규식
const EMOJI_PATTERN = /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\u{2190}-\u{21FF}]/gu;

function normalizeUtterance(raw) {
  let t = (raw || '').trim();
  t = t.replace(MENTION_PATTERN, '');
  t = t.replace(EMOJI_PATTERN, '');
  return t.trim();
}

// ---- 완성된 이미지 캐시 (프로세스 메모리, 최초 1회만 합성) ---------------------
const imageCache = new Map(); // key: `${concept}:${id}` -> Buffer
const inFlight = new Map(); // 동시에 같은 이미지가 여러 번 요청될 때 중복 합성 방지

// 즉석에서 생성된 밈언(고정 id가 없는)을 잠깐 기억해두는 저장소.
// /api/card/:concept/:id 라우트가 나중에 카카오 클라이언트로부터 썸네일 요청을 받을 때
// 이 문구/이미지 검색어를 다시 찾아낼 수 있어야 하므로 필요함. 무한정 쌓이지 않도록
// 오래된 것부터 정리한다 (생성된 밈언은 어차피 한 번 보여주고 나면 다시 볼 일이 거의 없음).
const generatedItems = new Map(); // id -> item
const GENERATED_ITEMS_CAP = 2000;

function registerGeneratedItem(item) {
  if (generatedItems.size >= GENERATED_ITEMS_CAP) {
    const oldestId = generatedItems.keys().next().value;
    const oldest = generatedItems.get(oldestId);
    generatedItems.delete(oldestId);
    if (oldest) imageCache.delete(`${oldest.concept}:${oldest.id}`);
  }
  generatedItems.set(item.id, item);
}

function findItem(concept, id) {
  const curated = (CONTENT[concept] || []).find((it) => it.id === id);
  if (curated) return curated;
  return generatedItems.get(id);
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

// 큐레이션된 항목이 아직 남아있어도, 이 확률로는 굳이 즉석 생성 쪽을 섞어서 보여준다.
// (0.6 = 큐레이션 60%, 생성 40% - 손맛 좋은 고정 문구와 무한 변주가 둘 다 나오게 하는 비율)
const CURATED_VS_GENERATED_RATIO = 0.6;

// 즉석 생성기(GENERATOR_FRAMES 기반)는 "존잼/황당/썰렁"처럼 가벼운 유머 톤일 때만 씁니다.
// "진지"와 "철학"은 실존 인물의 실제 명언 + 위키피디아 초상 사진을 보여주는 게 컨셉의 핵심이라서,
// 절대로 즉석 생성된 유머 문구가 대신 나오면 안 됩니다(예전엔 이 구분이 없어서 "철학"을 눌렀는데
// 실존 철학자 명언 대신 "안 아픈 척 걷는 연기력" 같은 유머 문구가 튀어나오는 버그가 있었음).
const GENERATABLE_CONCEPTS = new Set(['존잼', '황당', '썰렁']);

function pickItem(session, concept) {
  const pool = CONTENT[concept] || [];
  const shown = session.shownIds[concept] || [];
  const canGenerate = GENERATABLE_CONCEPTS.has(concept);

  // 사용자가 말한 기분/상황(session.mood)에 맞는 카테고리를 먼저 알아냅니다. (예: "창피했어" -> 창피부끄러움)
  if (session.mood) {
    const categories = detectMoodCategories(session.mood);

    if (categories.length) {
      const category = categories[0];
      const moodPool = pool.filter((it) => matchesMood(it, session.mood));
      const unseenCurated = moodPool.filter((it) => !shown.includes(it.id));

      if (unseenCurated.length > 0) {
        // 큐레이션이 남아있으면: 존잼/황당/썰렁은 확률적으로 즉석 생성과 섞어서 보여주고
        // (아래로 안 빠지고 여기서 바로 return), 진지/철학은 즉석 생성을 아예 안 하므로
        // 무조건 큐레이션(실존 인물 명언)만 사용합니다.
        if (!canGenerate || Math.random() < CURATED_VS_GENERATED_RATIO) {
          return unseenCurated[Math.floor(Math.random() * unseenCurated.length)];
        }
      }

      if (canGenerate) {
        // "비슷한 밈언 더"를 아무리 눌러도 몇 개 안 되는 고정 문구만 뱅뱅 도는 대신,
        // frame x 상황조각 x 펀치라인조각 조합으로 매번 새로운 문장을 만들어서 사실상
        // 반복이 거의 안 보이게 합니다 (그래도 같은 카테고리 안이라 맥락은 벗어나지 않음).
        const shownTexts = getShownTextsSet(session, concept);
        const quote = generateQuote(category, session.mood, shownTexts);
        markShownText(session, concept, quote);
        const generated = {
          id: `gen-${concept}-${category}-${Date.now()}-${Math.floor(Math.random() * 100000)}`,
          concept,
          quote,
          source: '오늘의 밈언 (즉석 생성)',
          moodTags: [category],
          stockQuery: pickStockQuery(category),
        };
        registerGeneratedItem(generated);
        return generated;
      }
      // 진지/철학인데 이 카테고리에 맞는 큐레이션 명언이 하나도 없거나 이미 다 보여줬으면,
      // 즉석 생성으로 새지 않고 아래 "범용" 태그 풀(그래도 실존 인물 명언)로 넘어갑니다.
    }

    // 카테고리를 전혀 못 알아들었을 때, 또는 진지/철학인데 매칭되는 큐레이션이 소진됐을 때:
    // "배고픔" 얘기에 "돈 절약" 개그처럼 완전히 딴 얘기가 튀어나오는 것만은 막아야 하므로,
    // 어떤 상황에 갖다 붙여도 안전한 "범용" 태그 항목을 우선 사용합니다.
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

  // 카카오 클라이언트는 이 스킬 응답을 받은 "뒤에" 썸네일 이미지 URL(/api/card/...)을 따로
  // 요청합니다. 그때 가서야 위키피디아/스톡 사진 다운로드를 시작하면 시간이 빠듯하므로,
  // 텍스트 응답을 준비하는 지금 미리(비동기로, 기다리지 않고) 이미지 합성을 시작해둡니다.
  // 실패해도 여기서는 무시 - 실제 요청이 오면 getCardImage()가 같은 캐시/inFlight를 보고
  // 다시 시도하거나(이미 실패해 캐시되지 않았으므로) 정상적으로 재시도합니다.
  getCardImage(concept, item).catch(() => {});

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

  const rawUtterance = (d.content || '').trim();
  // 오픈채팅방에서 버튼을 누르면 "@오늘의 밈언 " 멘션과 버튼 라벨의 이모지가 그대로
  // 다시 들어올 수 있어서, 실제 비교/저장은 전부 이 "정리된" 버전으로 합니다.
  const utterance = normalizeUtterance(rawUtterance);
  const userId = d.botUserKey || 'anonymous';
  const callbackToken = d.callbackToken;

  if (rawUtterance !== utterance) {
    console.log(`[skill] 멘션/이모지 제거: "${rawUtterance}" -> "${utterance}"`);
  }

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

// ---- 이미지 캐시 예열 (서버 기동 시 백그라운드로 실행, 요청을 막지 않음) -----------
//
// 핵심 발견: /api/card/... URL을 사람이 브라우저로 직접 열어보면 사진이든 색깔카드든
// 잘 뜬다 -> 이미지 합성 로직 자체는 정상. 그런데 실제 카카오톡 안에서는 여전히 이미지가
// 하나도 안 보인다 -> 문제는 "카카오(또는 카카오톡 클라이언트)가 썸네일 이미지를 가져갈 때
// 허용하는 시간"이 사람이 나중에 눈으로 확인하는 것보다 훨씬 촉박하다는 것.
// 즉, 그 항목이 "그 순간 처음 요청되는(=아직 캐시에 없는) 콜드 상태"이면 위키/스톡 사진
// 다운로드가 몇 초 걸리는데, 카카오 쪽은 그 몇 초를 기다려주지 않고 이미지 없이 렌더링해버리는
// 것으로 보인다. 따라서 근본적인 해법은 "요청이 오는 순간 얼마나 빠른가"가 아니라,
// "애초에 콜드 상태인 항목이 하나도 없게" 만드는 것이다.
//
// 그래서 서버가 켜지자마자(트래픽을 막지 않고 백그라운드로):
// 1) 큐레이션된 항목(전체 존잼/황당/썰렁/진지/철학)을 전부 한 번씩 합성해서 imageCache를 채운다.
// 2) 즉석 생성기가 쓰는 스톡 검색어 풀(카테고리당 2개씩)을 전부 한 번씩 검색+다운로드해서
//    stock.js/compose.js의 캐시를 채운다 - 그러면 어떤 문장이 새로 생성되든, 그 카테고리의
//    배경 사진은 이미 캐시에 있으므로 네트워크 호출 없이 즉시 합성된다.
async function warmUpImageCaches() {
  console.log('[warmup] 이미지 캐시 예열 시작...');
  const started = Date.now();
  let ok = 0;
  let fail = 0;

  const curatedTasks = [];
  for (const concept of CONCEPT_ORDER) {
    for (const item of CONTENT[concept] || []) {
      curatedTasks.push({ concept, item });
    }
  }

  const stockQueryTasks = getAllStockQueries().map((q) => ({
    concept: '존잼', // 아무 컨셉이나 상관없음 - 검색어/이미지 다운로드 캐시만 채우면 되므로
    item: { quote: '', source: '', stockQuery: q },
  }));

  const tasks = [...curatedTasks, ...stockQueryTasks];

  // 한꺼번에 수십~수백 개를 동시에 쏘면 Openverse/위키피디아 쪽에서 rate limit에 걸릴 수
  // 있으므로, 5개씩 묶어서 순차적으로 예열한다.
  const BATCH_SIZE = 5;
  for (let i = 0; i < tasks.length; i += BATCH_SIZE) {
    const batch = tasks.slice(i, i + BATCH_SIZE);
    const results = await Promise.allSettled(
      batch.map(({ concept, item }) =>
        item.id ? getCardImage(concept, item) : composeCardImage(concept, item, CONCEPT_META[concept])
      )
    );
    for (const r of results) {
      if (r.status === 'fulfilled') ok++;
      else fail++;
    }
  }

  console.log(`[warmup] 이미지 캐시 예열 완료: 성공 ${ok} / 실패 ${fail} (${Date.now() - started}ms)`);
}

app.listen(PORT, () => {
  console.log(`오늘의 밈언 스킬 서버 실행 중: http://localhost:${PORT}`);
  // 서버를 켜는 것 자체는 예열이 끝날 때까지 기다리지 않는다 - 웹훅은 예열 중에도 정상 응답한다.
  warmUpImageCaches().catch((err) => console.error('[warmup] 예열 중 오류:', err));
});
