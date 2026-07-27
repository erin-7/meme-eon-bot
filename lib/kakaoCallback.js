// lib/kakaoCallback.js
// "카카오톡 봇" 콜백 응답 전송
//
// 이 봇 제품은 Open Builder와 달리, 웹훅 요청에 답변을 바로 실어 보내는 게 아니라
// 1) 웹훅(/skill)은 그냥 200으로 받았다고만 응답하고
// 2) 실제 답장은 이벤트에 들어있는 callbackToken을 이용해 별도로
//    POST https://kapi.kakao.com/v1/bot/callback 를 호출해서 전달합니다.
//
// 참고: https://developers.kakao.com/docs/in/bot/rest-api#callback-msg-sample-request
// 콜백 토큰은 5분 이내에만 사용할 수 있습니다.

const CALLBACK_URL = 'https://kapi.kakao.com/v1/bot/callback';

/**
 * @param {string} callbackToken  이벤트의 d.callbackToken
 * @param {object} skillResponseBody  { version: "2.0", template: { outputs, quickReplies } }
 * @param {string} [botToken]  봇 인증 토큰(어드민 키). 기본값: process.env.KAKAO_BOT_TOKEN
 */
async function sendSkillCallback(callbackToken, skillResponseBody, botToken = process.env.KAKAO_BOT_TOKEN) {
  if (!botToken) {
    throw new Error('KAKAO_BOT_TOKEN 환경변수가 설정되어 있지 않습니다.');
  }
  if (!callbackToken) {
    throw new Error('callbackToken이 없습니다.');
  }

  const res = await fetch(CALLBACK_URL, {
    method: 'POST',
    headers: {
      Authorization: `KakaoAK ${botToken}`,
      'X-Bot-Callback-Token': callbackToken,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ skillResponse: skillResponseBody }),
  });

  const text = await res.text();
  let json;
  try {
    json = JSON.parse(text);
  } catch (_e) {
    json = { raw: text };
  }

  if (!res.ok) {
    const err = new Error(`콜백 전송 실패 (HTTP ${res.status}): ${text}`);
    err.status = res.status;
    err.body = json;
    throw err;
  }

  console.log('[콜백 전송 성공]', JSON.stringify(json));
  return json; // { totalCount, sendCount, errorCount }
}

module.exports = { sendSkillCallback };
