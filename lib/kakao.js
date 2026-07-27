// lib/kakao.js
// 카카오 i 오픈빌더 스킬 응답(SkillResponse) 포맷 빌더 헬퍼
// 스펙 참고: https://kakaobusiness.gitbook.io/main/tool/chatbot/skill_guide/answer_json_format

function simpleText(text) {
  return { simpleText: { text } };
}

function basicCard({ title, description, thumbnailUrl, buttons = [] }) {
  return {
    basicCard: {
      title,
      description,
      thumbnail: { imageUrl: thumbnailUrl },
      buttons,
    },
  };
}

function messageButton(label, messageText) {
  return { action: 'message', label, messageText: messageText ?? label };
}

// 이 봇 제품은 Open Builder의 quickReplies(말풍선 아래 칩 버튼)를 지원하지 않는 것으로
// 보입니다. 대신 textCard/basicCard 안의 buttons(action: 'message')는 실제로 눌리는
// 버튼으로 렌더링되므로, 선택지를 줄 때는 이 textCard를 사용합니다.
function textCard({ title, description, buttons = [] }) {
  return {
    textCard: {
      title,
      description,
      buttons,
    },
  };
}

function quickReply(label, messageText) {
  return { label, action: 'message', messageText: messageText ?? label };
}

/**
 * outputs: Component[] (1~3개)
 * quickReplies: QuickReply[] (0~10개)
 */
function skillResponse(outputs, quickReplies = []) {
  const template = { outputs };
  if (quickReplies.length) template.quickReplies = quickReplies;
  return { version: '2.0', template };
}

module.exports = { simpleText, basicCard, textCard, messageButton, quickReply, skillResponse };
