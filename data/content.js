// data/content.js
// "오늘의 밈언" 콘텐츠 데이터베이스
// - 존잼 / 황당 / 썰렁: 주제에 맞는 무료 CC 라이선스 스톡 사진(Openverse)을 배경으로 쓰고,
//   그 위에 자막을 합성합니다(lib/compose.js의 tryStockPhoto). 사진 조회는 3.5초 시간 예산
//   안에서만 시도하고, 실패/지연 시 즉시 자체 제작 컬러 카드로 대체하므로 항상 빠르고
//   안정적으로 응답이 나갑니다. (템플릿 밈 항목들은 사진 없이 100% 직접 그린 벡터입니다.)
// - 진지 / 철학: 실존 인물의 유명한 어록 + 위키피디아에서 실시간으로 가져오는 초상 이미지
//   (인물 사진도 동일하게 엄격한 타임아웃을 두고, 실패/지연 시 즉시 컬러 카드로 대체합니다)
//
// stockQuery: Openverse(무료/CC 라이선스 스톡 이미지 검색)에 보낼 검색어. 한국어보다 영어
// 검색어가 결과가 훨씬 풍부해서 영어로 넣습니다. 사진에는 항상 작가명(크레딧)이 자동으로
// 자막에 함께 표기됩니다(lib/compose.js 참고).
//
// 실제 방송 캡처짤(무한도전 등)을 쓰고 싶다면 저작권 문제 없이 본인이 보유한 이미지를
// public/memes/ 폴더에 넣고 아래 항목에 imageUrl(로컬 경로, 예: "/memes/jj1.jpg")을 직접
// 추가하면 그 이미지가 최우선으로 사용됩니다.
//
// moodTags: 사용자가 입력한 기분/상황 문장에서 감지된 "카테고리"(아래 MOOD_TRIGGERS 참고)와
// 겹치는 항목을 같은 컨셉 안에서 우선적으로 골라줍니다(server.js의 pickItem 참고).
// 예전에는 moodTags에 특정 단어 원문("배고", "스트레스")을 그대로 넣고 사용자의 문장이 그
// 단어를 정확히 포함하는지만 봤는데, "배가 너무 고파" 처럼 실제 문장은 "배고"를 그대로
// 포함하지 않는 경우가 훨씬 많아서 매칭이 자주 실패했습니다. 그래서 지금은 카테고리 방식으로
// 바꿔서, moodTags에는 카테고리 이름(예: '배고픔')만 넣고, 그 카테고리에 해당하는 다양한
// 실제 표현들(고프다/먹어도/출출/치킨 등)은 MOOD_TRIGGERS에서 한 번에 관리합니다.

const CONCEPT_ORDER = ['존잼', '진지', '황당', '썰렁', '철학'];

// captionStyle: 사진 배경 위에 자막을 어떤 스타일로 합성할지 (lib/cardImage.js 참고)
//   burst = 예능 자막풍 삐죽 말풍선 / bar = 하단 그라데이션 자막바 / plain = 사진 위에 외곽선 글씨만
const CONCEPT_META = {
  존잼: {
    emoji: '😆', label: '존잼', bg: 'FFD400', fg: '111111', desc: '빵 터지는 드립 밈', captionStyle: 'burst',
    keywords: ['존잼', '웃긴', '웃긴거', '빵터', '개그', '재밌', '재미', '유머', '꿀잼', '드립'],
  },
  진지: {
    // 주의: '스트레스'/'힘들다' 같은 "상황" 단어는 여기 넣지 않습니다. 그런 단어만으로
    // 무조건 진지 컨셉으로 보내버리면, 사실은 재밌는 반응을 원하는 사람한테도 매번 명언만
    // 나가게 됩니다. 여기엔 "진지하게/위로해줘"처럼 톤 자체를 명시적으로 요청하는 단어만 둡니다.
    emoji: '🧐', label: '진지', bg: '1F3C88', fg: 'FFFFFF', desc: '진심이 담긴 찐 명언', captionStyle: 'bar',
    keywords: ['진지', '위로', '응원', '동기부여', '명언', '진심'],
  },
  황당: {
    emoji: '🤯', label: '황당', bg: 'E63946', fg: 'FFFFFF', desc: '이게 맞나 싶은 드립', captionStyle: 'burst',
    keywords: ['황당', '팩폭', '팩트폭행', '뼈때', '현실자각', '정색', '어이없', '빡침', '빡쳐'],
  },
  썰렁: {
    emoji: '🥶', label: '썰렁', bg: 'A0AEC0', fg: '111111', desc: '정통 아재개그', captionStyle: 'bar',
    keywords: ['썰렁', '아재', '아재개그', '유치'],
  },
  철학: {
    emoji: '🏛️', label: '철학', bg: '6B4226', fg: 'FFFFFF', desc: '고대 철학자의 한마디', captionStyle: 'plain',
    keywords: ['철학', '고대', '사색', '생각', '인생'],
  },
};

// 사용자가 자유 텍스트로 입력한 문장에서 컨셉을 유추합니다.
// 정확히 "존잼" 같은 단어가 포함돼 있거나, 위 keywords 중 하나라도 포함돼 있으면 매칭.
function classifyConcept(text) {
  if (!text) return null;
  const t = text.replace(/\s+/g, '');
  for (const concept of CONCEPT_ORDER) {
    const meta = CONCEPT_META[concept];
    const words = [concept, ...(meta.keywords || [])];
    if (words.some((w) => t.includes(w))) return concept;
  }
  return null;
}

// ---------------------------------------------------------------------------
// 기분/상황 카테고리 감지
//
// 사람들은 같은 상황도 다양한 방식으로 표현합니다("배가 너무 고파", "먹어도 될까",
// "출출한데" 전부 "배고픔" 상황). 카테고리별로 실제 표현 여러 개를 등록해두고,
// 문장 안에 그 중 하나라도 포함돼 있으면 해당 카테고리로 인식합니다.
// 한 문장에서 여러 카테고리가 동시에 감지될 수도 있습니다(정상 동작).
const MOOD_TRIGGERS = {
  // "기분이 너무 나쁜 상태야" 처럼 일반적인 부정적 감정 표현. "기분나쁨"처럼 두 단어를
  // 붙여서 트리거를 만들면 "기분이 너무 나쁜"처럼 그 사이에 다른 말이 끼어 있을 때
  // 매칭이 깨지므로(= "배고" 버그와 같은 원인), 여기서는 감정을 나타내는 단일 어간
  // ("나쁜", "우울", "속상" 등) 하나만으로도 감지되도록 합니다.
  기분나쁨: ['나쁜', '나빠', '안좋', '안 좋', '최악', '우울', '속상', '슬프', '슬퍼', '다운돼', '다운됐', '꿀꿀', '힘들', '짜증나', '열받아', '멘붕', '눈물'],
  // 부정적인 감정만이 아니라 기쁨/놀람/지루함/부끄러움/뻔뻔함 같은 다른 감정들도
  // 같은 원칙(단일 어간, 두 단어 붙여쓰기 지양)으로 감지합니다.
  기쁨행복: ['행복해', '행복한', '행복하다', '기뻐', '기쁘다', '기쁜', '좋은일', '신난다', '신나', '즐거워', '즐겁다', '뿌듯', '최고다', '최고야', '완전좋아'],
  놀라움: ['놀랐', '놀라운', '놀라워', '대박', '헐', '충격', '깜짝', '실화냐', '실화임'],
  지루함: ['지루해', '지루한', '심심해', '심심한', '따분해', '따분한', '무료해', '무료함'],
  창피부끄러움: ['창피해', '창피한', '부끄러워', '부끄러운', '부끄럽', '쪽팔려', '쪽팔린', '민망해', '민망한', '흑역사'],
  뻔뻔함: ['뻔뻔해', '뻔뻔한', '뻔뻔하다', '철판', '당당하게', '민폐인데'],
  배고픔: ['배고파', '배고픈', '배고픔', '배고품', '고프다', '고픈', '고파', '먹어도', '먹을까', '먹고싶', '먹고 싶', '출출', '간식', '치킨', '야식', '저녁', '점심', '밥맛', '뭐먹', '뭐 먹'],
  월요일출근: ['월요일', '출근', '회사가기', '직장', '회사'],
  야근퇴근: ['야근', '퇴근', '칼퇴', '금요일'],
  다이어트: ['다이어트', '살쪄', '살찌', '살빠', '운동', '헬스', '체중'],
  스트레스짜증: ['스트레스', '짜증', '화나', '화남', '열받', '빡쳐', '빡침', '빡친', '빡치'],
  귀찮미루: ['귀찮', '미루', '하기싫', '눕고싶', '눕기', '의욕없'],
  실패좌절: ['실패', '좌절', '망했', '떨어졌', '안됐'],
  관계위로: ['관계', '친구', '연애', '이별', '위로', '외롭', '서운'],
  시간고민: ['시간', '바쁘', '여유없', '촉박'],
  공부시험: ['공부', '시험', '합격', '불합격', '과제', '수능'],
  불안긴장: ['불안', '긴장', '떨려', '걱정', '발표'],
  피곤졸림: ['피곤', '졸려', '졸린', '잠온다', '잠와', '눈꺼풀'],
  포기도전: ['포기', '도전', '의지', '그만두고싶'],
  지각약속: ['지각', '늦었', '약속'],
  돈절약: ['돈', '재테크', '절약', '텅장'],
  계획음모: ['계획', '음모'],
  고민결정: ['고민', '결정', '선택'],
  눈치상황: ['눈치', '분위기', '상황'],
  외로움협업: ['외로', '협업', '팀워크', '혼자'],
  습관노력: ['습관', '노력'],
  생각마음: ['생각', '마음', '사색'],
  배움앎: ['배움', '앎', '모르는'],
};

function detectMoodCategories(text) {
  if (!text) return [];
  const t = text.replace(/\s+/g, '');
  return Object.keys(MOOD_TRIGGERS).filter((category) =>
    MOOD_TRIGGERS[category].some((trigger) => t.includes(trigger.replace(/\s+/g, '')))
  );
}

// 기분/상황 텍스트에서 감지된 카테고리와 item.moodTags가 하나라도 겹치면 이 항목을 우선 노출합니다.
function matchesMood(item, moodText) {
  if (!moodText || !item.moodTags) return false;
  const categories = detectMoodCategories(moodText);
  if (!categories.length) return false;
  return item.moodTags.some((tag) => categories.includes(tag));
}

// person: 위키피디아에서 초상 이미지를 실시간으로 찾아올 인물 정보 (ko/en 제목)
// stockQuery: Openverse에서 찾아올 CC 라이선스 스톡 사진 검색어 (영어)
const CONTENT = {
  존잼: [
    { id: 'jj1', quote: '늦었다고 생각할 때가 이미 늦은 거다', source: '박명수 (무한도전 어록)', moodTags: ['지각약속'], stockQuery: 'alarm clock running late' },
    { id: 'jj7', quote: '티끌 모아 티끌', source: '박명수 (무한도전 어록)', moodTags: ['돈절약'], stockQuery: 'piggy bank coins saving' },
    { id: 'jj2', quote: '포기하면 편해', source: '국룰 짤방 명언', moodTags: ['포기도전', '귀찮미루', '범용'], stockQuery: 'tired person lying down' },
    { id: 'jj3', quote: '인생은 실전이다, 연습 경기는 없다', source: '인터넷 밈', moodTags: ['불안긴장', '공부시험'], stockQuery: 'student exam stress' },
    { id: 'jj4', quote: '그래, 다 계획이 있구나', source: '영화 명대사 패러디', moodTags: ['계획음모'], stockQuery: 'planning notebook desk' },
    { id: 'jj5', quote: '아 몰라, 일단 저지르고 보자', source: '오늘의 밈언 자체 제작', moodTags: ['고민결정', '범용'], stockQuery: 'person thinking decision' },
    { id: 'jj6', quote: '분위기 파악은 못해도 눈치는 안 봐', source: 'MZ 어록', moodTags: ['눈치상황'], stockQuery: 'awkward silence people' },
    { id: 'jj10', quote: '점심 먹은 지 한 시간밖에 안 지났다고? 그럼 지금은 저녁이라고 생각해', source: '오늘의 밈언 자체 제작', moodTags: ['배고픔'], stockQuery: 'fried chicken food' },
    { id: 'jj11', quote: '월요일이 싫은 게 아니라 일하는 게 싫은 거다, 정확하게 알아두자', source: '직장인 어록', moodTags: ['월요일출근'], stockQuery: 'tired office monday morning' },
    { id: 'jj12', quote: '스트레스 받을 땐 일단 숨을 크게 쉬어라, 숨 쉬는 것도 스트레스면 그건 나도 모른다', source: '오늘의 밈언 자체 제작', moodTags: ['스트레스짜증'], stockQuery: 'stressed office worker' },
    { id: 'jj13', quote: '야근은 하루의 마지막까지 최선을 다하는 게 아니라, 그냥 야근이다', source: '직장인 어록', moodTags: ['야근퇴근'], stockQuery: 'office late night work' },
    { id: 'jj14', quote: '다이어트는 내일부터, 오늘은 준비운동 기간이다', source: '국룰 짤방 명언', moodTags: ['다이어트'], stockQuery: 'diet salad healthy food' },
    { id: 'jj15', quote: '퇴 사', source: '오늘의 밈언 자체 제작 · 직장인 만국 공통 정답', moodTags: ['월요일출근', '스트레스짜증', '야근퇴근'], stockQuery: 'office desk resignation' },
    { id: 'jj16', quote: '그만두는 상상은 무료입니다', source: '직장인 어록', moodTags: ['월요일출근', '포기도전'], stockQuery: 'daydreaming office window' },
    // 배고픔/식욕 관련 상황에 바로 나가는 "팩폭" 존잼 카드들
    { id: 'jj22', quote: '응, 음식은 살 안 쪄~ 살은 너가 찌는 거지', source: '오늘의 밈언 (팩폭 밈)', moodTags: ['배고픔', '다이어트'], stockQuery: 'fried chicken fast food' },
    { id: 'jj23', quote: '먹어도 되냐고 물어본 순간, 이미 마음속으로는 다 먹기로 결정 났다', source: '오늘의 밈언 (팩폭 밈)', moodTags: ['배고픔'], stockQuery: 'eating food table' },
    { id: 'jj24', quote: '지금 참으면 30분 뒤에 더 배고파서 두 그릇 먹는다, 그냥 지금 먹어', source: '오늘의 밈언 (팩폭 밈)', moodTags: ['배고픔'], stockQuery: 'delicious food craving' },
    // 기분이 안 좋다는 일반적인 부정적 감정 표현에 걸리는 카드들 (특정 소재가 아니라
    // "기분 나쁨" 자체를 다루므로, 웃긴 컨셉이라도 엉뚱한 소재로 튀지 않습니다)
    { id: 'jj25', quote: '기분 나쁠 땐 그냥 나쁘다고 인정하는 게 제일 빠르다, 억지로 괜찮은 척 하지 마', source: '오늘의 밈언 자체 제작', moodTags: ['기분나쁨'], stockQuery: 'person resting quiet moment' },
    { id: 'jj26', quote: '오늘 하루가 유독 나를 미워하나보다, 내일은 또 모르는 일이다', source: '오늘의 밈언 자체 제작', moodTags: ['기분나쁨'], stockQuery: 'calm sunset sky' },
    // 기쁨/놀람/지루함/부끄러움/뻔뻔함 같은 다른 감정에 대응하는 카드들
    { id: 'jj27', quote: '기분 좋을 때 조심해야 할 건 딱 하나, 그 텐션 그대로 톡 보내다가 오타 내는 거', source: '오늘의 밈언 자체 제작', moodTags: ['기쁨행복'], stockQuery: 'happy person smiling' },
    { id: 'jj28', quote: '헐 대박이라고 말하는 순간 이미 반은 없던 일도 있던 일이 된다', source: '오늘의 밈언 자체 제작', moodTags: ['놀라움'], stockQuery: 'surprised shocked face' },
    { id: 'jj29', quote: '심심하다는 건 뇌가 새로고침을 기다리고 있다는 뜻이다, 일단 냉장고부터 열어봐', source: '오늘의 밈언 자체 제작', moodTags: ['지루함'], stockQuery: 'bored person couch' },
    { id: 'jj30', quote: '창피한 기억은 사실 나만 기억한다, 남들은 이미 다 잊었다', source: '오늘의 밈언 자체 제작', moodTags: ['창피부끄러움'], stockQuery: 'embarrassed face palm' },
    { id: 'jj31', quote: '뻔뻔함은 재능이다, 그 재능 그대로 밀고 나가라', source: '오늘의 밈언 자체 제작', moodTags: ['뻔뻔함'], stockQuery: 'confident person smirk' },
    // 아래부터는 "진짜 밈 포맷"(직접 그린 얼굴/아이콘 + 레이아웃, 저작권 프리) 항목들입니다.
    // 사진 대신 벡터로 직접 그리므로 stockQuery가 필요 없습니다.
    {
      id: 'jj17', template: 'macro', mood: 'shock',
      topText: '팀장이 "잠깐 얘기 좀 할까?"', bottomText: '나 (심장 쿵)',
      quote: '팀장이 "잠깐 얘기 좀 할까?" 할 때의 내 심장', source: '오늘의 밈언 (자체 제작 밈)',
      moodTags: ['월요일출근', '스트레스짜증', '불안긴장'],
    },
    {
      id: 'jj18', template: 'macro', mood: 'happy',
      topText: '금요일 퇴근 5분 전', bottomText: '전 직원 텔레파시 일치',
      quote: '금요일 퇴근 5분 전, 전 직원의 텔레파시', source: '오늘의 밈언 (자체 제작 밈)',
      moodTags: ['야근퇴근'],
    },
    {
      id: 'jj19', template: 'compare', rejectText: '지금 당장 다이어트 시작', acceptText: '일단 치킨 먹고 내일부터',
      quote: '다이어트 vs 일단 치킨', source: '오늘의 밈언 (자체 제작 밈)',
      moodTags: ['다이어트', '배고픔'],
    },
    {
      id: 'jj20', template: 'compare', rejectText: '할 일 지금 끝내기', acceptText: '일단 좀 눕기',
      quote: '해야 할 일 vs 일단 눕기', source: '오늘의 밈언 (자체 제작 밈)',
      moodTags: ['귀찮미루'],
    },
    {
      id: 'jj21', template: 'brain', quote: '스트레스 해소 단계 (뇌 확장 밈)', source: '오늘의 밈언 (자체 제작 밈)',
      stages: ['그냥 참는다', '커피를 마신다', '동료한테 하소연한다', '사직서를 쓴다 (진짜 안 냄)'],
      moodTags: ['스트레스짜증', '월요일출근'],
    },
  ],
  황당: [
    { id: 'hd1', quote: '물고기는 물을 마시지 않는다, 물에 살 뿐이다', source: '아무말 대잔치', moodTags: ['범용'], stockQuery: 'fish swimming underwater' },
    { id: 'hd2', quote: '지구가 둥근 이유는 네모나면 모서리에서 넘어지기 때문이다', source: '아무말 대잔치', moodTags: ['범용'], stockQuery: 'earth globe space' },
    { id: 'hd3', quote: '고양이가 상자를 좋아하는 이유는 상자가 고양이를 좋아하기 때문이다', source: '아무말 대잔치', moodTags: ['범용'], stockQuery: 'cat sitting in box' },
    { id: 'hd13', quote: '기분이 나쁜 건 사실 뇌 속 세로토닌이 오늘 파업 중이라서다, 파업은 대부분 하루 안에 끝난다', source: '아무말 대잔치', moodTags: ['기분나쁨'], stockQuery: 'quiet calm room' },
    { id: 'hd14', quote: '기분이 좋은 건 사실 도파민이 오늘만 특근 수당 받는 거다', source: '아무말 대잔치', moodTags: ['기쁨행복'], stockQuery: 'joyful celebration confetti' },
    { id: 'hd15', quote: '심심함은 우주가 우리에게 주는 무료 명상 시간이다', source: '아무말 대잔치', moodTags: ['지루함'], stockQuery: 'empty room meditation' },
    { id: 'hd4', quote: '새벽 3시에 세운 계획은 국가 기밀급으로 다뤄야 한다', source: '오늘의 밈언 자체 제작', moodTags: ['계획음모'], stockQuery: 'late night notebook writing' },
    { id: 'hd5', quote: '라면은 사실 국물이 메인이고 면은 곁들임이다', source: '아무말 대잔치', moodTags: ['배고픔'], stockQuery: 'ramen noodles bowl' },
    { id: 'hd6', quote: '월요일은 일주일의 시작이 아니라 주말의 후유증이다', source: '직장인 어록', moodTags: ['월요일출근'], stockQuery: 'monday alarm clock tired' },
    { id: 'hd7', quote: '스트레스는 눈에 안 보인다, 그러니까 없는 셈 치자', source: '오늘의 밈언 자체 제작', moodTags: ['스트레스짜증'], stockQuery: 'frustrated person head in hands' },
    { id: 'hd8', quote: '야근하다 보면 어느새 출근 시간이다, 이건 야근이 아니라 그냥 출근 연장이다', source: '직장인 어록', moodTags: ['야근퇴근'], stockQuery: 'office overtime night city' },
    { id: 'hd9', quote: '사직서는 만병통치약이다, 부작용은 통장 잔고뿐이다', source: '직장인 어록', moodTags: ['월요일출근', '포기도전'], stockQuery: 'resignation letter desk' },
    { id: 'hd12', quote: '배고픔은 착각이라던데, 그 착각 때문에 손이 이미 냉장고 문을 열고 있다', source: '아무말 대잔치', moodTags: ['배고픔'], stockQuery: 'open refrigerator kitchen' },
    {
      id: 'hd10', template: 'macro', mood: 'confused',
      topText: '월요일 아침 알람 소리', bottomText: '내 정신 상태',
      quote: '월요일 아침 알람 소리를 들은 내 정신 상태', source: '오늘의 밈언 (자체 제작 밈)',
      moodTags: ['월요일출근', '피곤졸림'],
    },
    {
      id: 'hd11', template: 'brain', quote: '점심 메뉴 고민 단계 (뇌 확장 밈)', source: '오늘의 밈언 (자체 제작 밈)',
      stages: ['아무거나 먹자', '어제 뭐 먹었더라', '결국 어제랑 똑같은 거', '그냥 라면 먹는다'],
      moodTags: ['배고픔'],
    },
  ],
  썰렁: [
    { id: 'sr1', quote: '원숭이 엉덩이는 왜 빨갈까? 사과를 너무 많이 먹어서', source: '정통 아재개그', moodTags: ['범용'], stockQuery: 'monkey portrait' },
    { id: 'sr2', quote: '바나나가 웃으면? 바나나킥', source: '정통 아재개그', moodTags: ['범용'], stockQuery: 'banana fruit' },
    { id: 'sr3', quote: '세상에서 가장 뜨거운 바다는? 열바다', source: '정통 아재개그', moodTags: ['범용'], stockQuery: 'ocean sea waves' },
    { id: 'sr4', quote: '닭이 우물에 빠지면? 닭죽', source: '정통 아재개그', moodTags: ['범용'], stockQuery: 'chicken farm' },
    { id: 'sr10', quote: '기분이 안 좋을 때 최고의 명약은? 시간, 그리고 약간의 아이스크림', source: '정통 아재개그', moodTags: ['기분나쁨'], stockQuery: 'ice cream dessert' },
    { id: 'sr11', quote: '깜짝 놀랄 때 나는 소리는? 헐（홀）스타인! (놀람의 소)', source: '정통 아재개그', moodTags: ['놀라움'], stockQuery: 'cow farm surprised' },
    { id: 'sr12', quote: '창피할 때 숨는 곳은? 이불킥 존', source: '정통 아재개그', moodTags: ['창피부끄러움'], stockQuery: 'blanket bed cozy' },
    { id: 'sr5', quote: '냉장고가 화나면? 냉장고 문다', source: '정통 아재개그', moodTags: ['스트레스짜증'], stockQuery: 'refrigerator kitchen' },
    { id: 'sr6', quote: '도둑이 훔친 우유는? 도독 우유', source: '정통 아재개그', stockQuery: 'milk carton glass' },
    { id: 'sr7', quote: '스트레스가 심한 빵은? 스트레스빵(트레스빵)', source: '정통 아재개그', moodTags: ['스트레스짜증'], stockQuery: 'bread bakery' },
    { id: 'sr8', quote: '출출할 때 먹으면 안 되는 과일은? 안출과일(안 되는 과일)... 이 아니라 그냥 아무거나 드세요', source: '정통 아재개그', moodTags: ['배고픔'], stockQuery: 'fresh fruit basket' },
    { id: 'sr9', quote: '배가 고프면 꼭 먹어야 하는 빵은? 배(고)빵... 그냥 아무 빵이나 드세요', source: '정통 아재개그', moodTags: ['배고픔'], stockQuery: 'bread bakery pastry' },
  ],
  // 진지: 실존 인물 명언 + 위키피디아 실사진. moodTags를 넣어 스트레스/지침 등과 매칭되게 함.
  진지: [
    { id: 'jj_jobs', quote: '너의 시간은 한정되어 있다, 다른 사람의 삶을 사느라 시간을 낭비하지 마라', source: '스티브 잡스', person: { ko: '스티브 잡스', en: 'Steve Jobs' }, moodTags: ['시간고민', '고민결정', '범용'] },
    { id: 'jj_einstein', quote: '상상력은 지식보다 중요하다', source: '알베르트 아인슈타인', person: { ko: '알베르트 아인슈타인', en: 'Albert Einstein' }, moodTags: ['공부시험'] },
    { id: 'jj_curie', quote: '인생에서 두려워할 것은 없다, 이해해야 할 것이 있을 뿐이다', source: '마리 퀴리', person: { ko: '마리 퀴리', en: 'Marie Curie' }, moodTags: ['불안긴장'] },
    { id: 'jj_keller', quote: '혼자서는 할 수 있는 일이 거의 없지만, 함께라면 아주 많은 것을 할 수 있다', source: '헬렌 켈러', person: { ko: '헬렌 켈러', en: 'Helen Keller' }, moodTags: ['외로움협업', '범용'] },
    { id: 'jj_mandela', quote: '나는 절대 지지 않는다, 이기거나 배울 뿐이다', source: '넬슨 만델라', person: { ko: '넬슨 만델라', en: 'Nelson Mandela' }, moodTags: ['실패좌절', '기분나쁨'] },
    { id: 'jj_ali', quote: '불가능, 그것은 사실이 아니라 의견일 뿐이다', source: '무하마드 알리', person: { ko: '무하마드 알리', en: 'Muhammad Ali' }, moodTags: ['포기도전'] },
    { id: 'jj_jordan', quote: '나는 실패를 받아들일 수 있다, 그러나 시도하지 않는 것은 받아들일 수 없다', source: '마이클 조던', person: { ko: '마이클 조던', en: 'Michael Jordan' }, moodTags: ['실패좌절', '스트레스짜증'] },
    { id: 'jj_maya', quote: '사람들은 당신이 한 말은 잊어도, 당신이 준 느낌은 잊지 않는다', source: '마야 안젤루', person: { ko: '마야 안젤루', en: 'Maya Angelou' }, moodTags: ['관계위로', '기분나쁨'] },
  ],
  철학: [
    { id: 'ph_socrates', quote: '너 자신을 알라', source: '소크라테스', person: { ko: '소크라테스', en: 'Socrates' }, moodTags: ['고민결정', '생각마음', '범용'] },
    { id: 'ph_confucius', quote: '아는 것을 안다고 하고 모르는 것을 모른다고 하는 것, 그것이 곧 아는 것이다', source: '공자', person: { ko: '공자', en: 'Confucius' }, moodTags: ['공부시험', '배움앎', '범용'] },
    { id: 'ph_aristotle', quote: '우리는 반복적으로 행하는 것으로 만들어진다, 탁월함은 행위가 아니라 습관이다', source: '아리스토텔레스', person: { ko: '아리스토텔레스', en: 'Aristotle' }, moodTags: ['습관노력'] },
    { id: 'ph_nietzsche', quote: '나를 죽이지 못하는 고통은 나를 더 강하게 만든다', source: '프리드리히 니체', person: { ko: '프리드리히 니체', en: 'Friedrich Nietzsche' }, moodTags: ['스트레스짜증', '실패좌절', '기분나쁨'] },
    { id: 'ph_aurelius', quote: '우리의 삶은 우리의 생각이 만들어가는 것이다', source: '마르쿠스 아우렐리우스', person: { ko: '마르쿠스 아우렐리우스', en: 'Marcus Aurelius' }, moodTags: ['생각마음', '기분나쁨'] },
  ],
};

module.exports = { CONCEPT_ORDER, CONCEPT_META, CONTENT, classifyConcept, matchesMood, detectMoodCategories };
