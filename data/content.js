// data/content.js
// "오늘의 밈언" 콘텐츠 데이터베이스
// - 존잼 / 황당 / 썰렁: 100% 자체 제작 컬러 카드(외부 이미지 네트워크 호출 없음 -> 항상 즉시, 안정적으로 렌더링)
// - 진지 / 철학: 실존 인물의 유명한 어록 + 위키피디아에서 실시간으로 가져오는 초상 이미지
//   (인물 사진은 lib/compose.js에서 엄격한 타임아웃을 두고, 실패/지연 시 즉시 컬러 카드로 대체합니다)
//
// 실제 방송 캡처짤(무한도전 등)을 쓰고 싶다면 저작권 문제 없이 본인이 보유한 이미지를
// public/memes/ 폴더에 넣고 아래 항목에 imageUrl(로컬 경로, 예: "/memes/jj1.jpg")을 직접
// 추가하면 그 이미지가 최우선으로 사용됩니다.
//
// moodTags: 사용자가 입력한 기분/상황 문장에 이 태그 중 하나라도 포함되면, 같은 컨셉 안에서도
// 이 항목을 우선적으로 골라줍니다(server.js의 pickItem 참고). 완전히 안 맞아도 랜덤으로는 나갑니다.

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

// 기분/상황 텍스트 안에 아래 태그 단어가 있으면 해당 moodTags를 가진 콘텐츠를 우선 노출합니다.
function matchesMood(item, moodText) {
  if (!moodText || !item.moodTags) return false;
  const t = moodText.replace(/\s+/g, '');
  return item.moodTags.some((tag) => t.includes(tag));
}

// person: 위키피디아에서 초상 이미지를 실시간으로 찾아올 인물 정보 (ko/en 제목)
const CONTENT = {
  // 존잼: 전부 외부 네트워크 없이 서버가 즉시 그려내는 컬러 카드입니다 (빠르고 100% 안정적).
  존잼: [
    { id: 'jj1', quote: '늦었다고 생각할 때가 이미 늦은 거다', source: '박명수 (무한도전 어록)', moodTags: ['지각', '약속', '늦'] },
    { id: 'jj7', quote: '티끌 모아 티끌', source: '박명수 (무한도전 어록)', moodTags: ['돈', '재테크', '절약'] },
    { id: 'jj2', quote: '포기하면 편해', source: '국룰 짤방 명언', moodTags: ['포기', '지침', '귀찮'] },
    { id: 'jj3', quote: '인생은 실전이다, 연습 경기는 없다', source: '인터넷 밈', moodTags: ['긴장', '시험', '발표'] },
    { id: 'jj4', quote: '그래, 다 계획이 있구나', source: '영화 명대사 패러디', moodTags: ['계획', '음모'] },
    { id: 'jj5', quote: '아 몰라, 일단 저지르고 보자', source: '오늘의 밈언 자체 제작', moodTags: ['고민', '결정장애'] },
    { id: 'jj6', quote: '분위기 파악은 못해도 눈치는 안 봐', source: 'MZ 어록', moodTags: ['눈치', '상황'] },
    { id: 'jj10', quote: '점심 먹은 지 한 시간밖에 안 지났다고? 그럼 지금은 저녁이라고 생각해', source: '오늘의 밈언 자체 제작', moodTags: ['배고', '출출', '점심', '저녁', '간식'] },
    { id: 'jj11', quote: '월요일이 싫은 게 아니라 일하는 게 싫은 거다, 정확하게 알아두자', source: '직장인 어록', moodTags: ['월요일', '출근', '회사', '일'] },
    { id: 'jj12', quote: '스트레스 받을 땐 일단 숨을 크게 쉬어라, 숨 쉬는 것도 스트레스면 그건 나도 모른다', source: '오늘의 밈언 자체 제작', moodTags: ['스트레스', '짜증', '화남'] },
    { id: 'jj13', quote: '야근은 하루의 마지막까지 최선을 다하는 게 아니라, 그냥 야근이다', source: '직장인 어록', moodTags: ['야근', '퇴근', '회사'] },
    { id: 'jj14', quote: '다이어트는 내일부터, 오늘은 준비운동 기간이다', source: '국룰 짤방 명언', moodTags: ['다이어트', '살', '운동'] },
    { id: 'jj15', quote: '퇴 사', source: '오늘의 밈언 자체 제작 · 직장인 만국 공통 정답', moodTags: ['회사', '스트레스', '상사', '야근', '직장', '뭐해야', '뭘해야'] },
    { id: 'jj16', quote: '그만두는 상상은 무료입니다', source: '직장인 어록', moodTags: ['회사', '그만', '상사', '직장'] },
  ],
  // 황당: 존잼과 마찬가지로 전부 즉시 렌더링되는 컬러 카드입니다.
  황당: [
    { id: 'hd1', quote: '물고기는 물을 마시지 않는다, 물에 살 뿐이다', source: '아무말 대잔치' },
    { id: 'hd2', quote: '지구가 둥근 이유는 네모나면 모서리에서 넘어지기 때문이다', source: '아무말 대잔치' },
    { id: 'hd3', quote: '고양이가 상자를 좋아하는 이유는 상자가 고양이를 좋아하기 때문이다', source: '아무말 대잔치' },
    { id: 'hd4', quote: '새벽 3시에 세운 계획은 국가 기밀급으로 다뤄야 한다', source: '오늘의 밈언 자체 제작', moodTags: ['계획', '새벽'] },
    { id: 'hd5', quote: '라면은 사실 국물이 메인이고 면은 곁들임이다', source: '아무말 대잔치', moodTags: ['배고', '출출', '야식'] },
    { id: 'hd6', quote: '월요일은 일주일의 시작이 아니라 주말의 후유증이다', source: '직장인 어록', moodTags: ['월요일', '출근'] },
    { id: 'hd7', quote: '스트레스는 눈에 안 보인다, 그러니까 없는 셈 치자', source: '오늘의 밈언 자체 제작', moodTags: ['스트레스', '짜증'] },
    { id: 'hd8', quote: '야근하다 보면 어느새 출근 시간이다, 이건 야근이 아니라 그냥 출근 연장이다', source: '직장인 어록', moodTags: ['야근', '회사'] },
    { id: 'hd9', quote: '사직서는 만병통치약이다, 부작용은 통장 잔고뿐이다', source: '직장인 어록', moodTags: ['회사', '스트레스', '상사', '그만'] },
  ],
  썰렁: [
    { id: 'sr1', quote: '원숭이 엉덩이는 왜 빨갈까? 사과를 너무 많이 먹어서', source: '정통 아재개그' },
    { id: 'sr2', quote: '바나나가 웃으면? 바나나킥', source: '정통 아재개그' },
    { id: 'sr3', quote: '세상에서 가장 뜨거운 바다는? 열바다', source: '정통 아재개그' },
    { id: 'sr4', quote: '닭이 우물에 빠지면? 닭죽', source: '정통 아재개그' },
    { id: 'sr5', quote: '냉장고가 화나면? 냉장고 문다', source: '정통 아재개그', moodTags: ['화남', '짜증'] },
    { id: 'sr6', quote: '도둑이 훔친 우유는? 도독 우유', source: '정통 아재개그' },
    { id: 'sr7', quote: '스트레스가 심한 빵은? 스트레스빵(트레스빵)', source: '정통 아재개그', moodTags: ['스트레스'] },
    { id: 'sr8', quote: '출출할 때 먹으면 안 되는 과일은? 안출과일(안 되는 과일)... 이 아니라 그냥 아무거나 드세요', source: '정통 아재개그', moodTags: ['배고', '출출'] },
  ],
  // 진지: 실존 인물 명언 + 위키피디아 실사진. moodTags를 넣어 스트레스/지침 등과 매칭되게 함.
  진지: [
    { id: 'jj_jobs', quote: '너의 시간은 한정되어 있다, 다른 사람의 삶을 사느라 시간을 낭비하지 마라', source: '스티브 잡스', person: { ko: '스티브 잡스', en: 'Steve Jobs' }, moodTags: ['시간', '고민'] },
    { id: 'jj_einstein', quote: '상상력은 지식보다 중요하다', source: '알베르트 아인슈타인', person: { ko: '알베르트 아인슈타인', en: 'Albert Einstein' }, moodTags: ['공부', '시험'] },
    { id: 'jj_curie', quote: '인생에서 두려워할 것은 없다, 이해해야 할 것이 있을 뿐이다', source: '마리 퀴리', person: { ko: '마리 퀴리', en: 'Marie Curie' }, moodTags: ['불안', '긴장'] },
    { id: 'jj_keller', quote: '혼자서는 할 수 있는 일이 거의 없지만, 함께라면 아주 많은 것을 할 수 있다', source: '헬렌 켈러', person: { ko: '헬렌 켈러', en: 'Helen Keller' }, moodTags: ['외로', '협업', '팀'] },
    { id: 'jj_mandela', quote: '나는 절대 지지 않는다, 이기거나 배울 뿐이다', source: '넬슨 만델라', person: { ko: '넬슨 만델라', en: 'Nelson Mandela' }, moodTags: ['실패', '좌절'] },
    { id: 'jj_ali', quote: '불가능, 그것은 사실이 아니라 의견일 뿐이다', source: '무하마드 알리', person: { ko: '무하마드 알리', en: 'Muhammad Ali' }, moodTags: ['포기', '도전', '지침'] },
    { id: 'jj_jordan', quote: '나는 실패를 받아들일 수 있다, 그러나 시도하지 않는 것은 받아들일 수 없다', source: '마이클 조던', person: { ko: '마이클 조던', en: 'Michael Jordan' }, moodTags: ['실패', '스트레스', '좌절'] },
    { id: 'jj_maya', quote: '사람들은 당신이 한 말은 잊어도, 당신이 준 느낌은 잊지 않는다', source: '마야 안젤루', person: { ko: '마야 안젤루', en: 'Maya Angelou' }, moodTags: ['관계', '위로'] },
  ],
  철학: [
    { id: 'ph_socrates', quote: '너 자신을 알라', source: '소크라테스', person: { ko: '소크라테스', en: 'Socrates' }, moodTags: ['고민', '생각'] },
    { id: 'ph_confucius', quote: '아는 것을 안다고 하고 모르는 것을 모른다고 하는 것, 그것이 곧 아는 것이다', source: '공자', person: { ko: '공자', en: 'Confucius' }, moodTags: ['공부', '배움'] },
    { id: 'ph_aristotle', quote: '우리는 반복적으로 행하는 것으로 만들어진다, 탁월함은 행위가 아니라 습관이다', source: '아리스토텔레스', person: { ko: '아리스토텔레스', en: 'Aristotle' }, moodTags: ['습관', '노력'] },
    { id: 'ph_nietzsche', quote: '나를 죽이지 못하는 고통은 나를 더 강하게 만든다', source: '프리드리히 니체', person: { ko: '프리드리히 니체', en: 'Friedrich Nietzsche' }, moodTags: ['스트레스', '힘들', '고통'] },
    { id: 'ph_aurelius', quote: '우리의 삶은 우리의 생각이 만들어가는 것이다', source: '마르쿠스 아우렐리우스', person: { ko: '마르쿠스 아우렐리우스', en: 'Marcus Aurelius' }, moodTags: ['생각', '마음'] },
  ],
};

module.exports = { CONCEPT_ORDER, CONCEPT_META, CONTENT, classifyConcept, matchesMood };
