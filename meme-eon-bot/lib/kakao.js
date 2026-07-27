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

module.exports = { simpleText, basicCard, messageButton, quickReply, skillResponse };
