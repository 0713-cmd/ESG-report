/**
 * Vercel Edge Function: Gemini 1.5 Pro 오타 검사 프록시
 *
 * Vercel 환경변수 설정 필요:
 *   GEMINI_API_KEY = AIza...
 *
 * POST /api/gemini
 * Body: { "text": "전체 PDF 텍스트", "pageMap": [{pageNum, start, end}, ...] }
 * Response: { "issues": [{page, wrong, correct, context, type}, ...] }
 */

export const config = { runtime: 'edge' };

const SYSTEM_PROMPT = `당신은 한국어·영어 ESG 보고서 전문 교정 AI입니다.
주어진 텍스트에서 다음 유형의 오류만 찾아 JSON으로 반환하세요.

찾아야 할 오류:
1. 한국어 오타 (예: 전기차동차→전기자동차, 온신가스→온실가스)
2. 영어 오타 (예: Intiative→Initiative, Sustanability→Sustainability)
3. 숫자+단위 명백한 오류 (예: 100% 이상의 퍼센트 값)
4. 명백한 중복 단어 (예: "지속 지속가능한")

절대 오류로 잡지 말 것:
- 정상적인 복합어, 접두어 단어 (지속가능경영보고서 등)
- 날짜 표기 방식 차이
- 영문 약어 (ESG, CDP, SBTi, GHG 등)
- 고유명사 (코웨이, Coway 등)

반드시 아래 JSON 형식만 반환하세요. 다른 텍스트 없이:
{
  "issues": [
    {
      "page": 3,
      "wrong": "Intiative",
      "correct": "Initiative",
      "context": "...주변 텍스트...",
      "type": "영어오타"
    }
  ]
}

오류가 없으면: {"issues": []}`;

export default async function handler(req) {
  const cors = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Content-Type': 'application/json',
  };

  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
  if (req.method !== 'POST') return new Response(JSON.stringify({ error: 'POST만 허용' }), { status: 405, headers: cors });

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) return new Response(JSON.stringify({ error: 'GEMINI_API_KEY 환경변수가 설정되지 않았습니다' }), { status: 500, headers: cors });

  let body;
  try { body = await req.json(); }
  catch { return new Response(JSON.stringify({ error: '잘못된 요청 형식' }), { status: 400, headers: cors }); }

  const { text, pageMap } = body;
  if (!text) return new Response(JSON.stringify({ error: 'text 필드 필요' }), { status: 400, headers: cors });

  // 페이지 번호 포함 텍스트 구성
  let fullText = '';
  if (pageMap && pageMap.length > 0) {
    for (const pg of pageMap) {
      fullText += `\n\n[페이지 ${pg.pageNum}]\n${text.slice(pg.start, pg.end)}`;
    }
  } else {
    fullText = text;
  }

  const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-3.1-pro-preview:generateContent?key=${apiKey}`;

  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts: [{ text: SYSTEM_PROMPT + '\n\n---\n\n검사할 텍스트:\n' + fullText }] }],
        generationConfig: { temperature: 0.1, maxOutputTokens: 4096 },
      }),
    });

    if (!res.ok) {
      const err = await res.text();
      return new Response(JSON.stringify({ error: 'Gemini API 오류: ' + err }), { status: 502, headers: cors });
    }

    const data = await res.json();
    const raw = data.candidates?.[0]?.content?.parts?.[0]?.text || '{"issues":[]}';

    // JSON 파싱 (```json ... ``` 마크다운 제거)
    const clean = raw.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
    let parsed;
    try { parsed = JSON.parse(clean); }
    catch { parsed = { issues: [], parseError: true, raw: clean.slice(0, 200) }; }

    return new Response(JSON.stringify(parsed), { status: 200, headers: cors });

  } catch (err) {
    return new Response(JSON.stringify({ error: '프록시 오류: ' + err.message }), { status: 500, headers: cors });
  }
}
