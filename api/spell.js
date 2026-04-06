/**
 * Vercel Edge Function: 부산대 맞춤법 검사기 프록시
 * 
 * 브라우저 CORS 제한을 우회하기 위해 Vercel 서버에서 부산대 API를 대신 호출합니다.
 * 
 * 호출 방법 (HTML에서):
 *   POST /api/spell
 *   Body: { "text": "검사할 텍스트" }
 *   Response: { "result": "...(부산대 응답 HTML)" }
 */

export const config = { runtime: 'edge' };

export default async function handler(req) {
  // CORS 헤더 - 같은 Vercel 도메인에서만 허용
  const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Content-Type': 'application/json',
  };

  // Preflight
  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: corsHeaders });
  }

  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'POST만 허용됩니다' }), {
      status: 405, headers: corsHeaders,
    });
  }

  let body;
  try {
    body = await req.json();
  } catch {
    return new Response(JSON.stringify({ error: '잘못된 요청 형식' }), {
      status: 400, headers: corsHeaders,
    });
  }

  const text = body?.text;
  if (!text || typeof text !== 'string') {
    return new Response(JSON.stringify({ error: 'text 필드가 필요합니다' }), {
      status: 400, headers: corsHeaders,
    });
  }

  // 500자 초과 시 자름 (부산대 API 권장 단위)
  const chunk = text.slice(0, 500);

  try {
    const formData = new URLSearchParams();
    formData.append('text1', chunk);

    const res = await fetch('http://speller.cs.pusan.ac.kr/results', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'User-Agent': 'Mozilla/5.0',
        'Referer': 'http://speller.cs.pusan.ac.kr/',
      },
      body: formData.toString(),
    });

    if (!res.ok) {
      return new Response(JSON.stringify({ error: `부산대 API 오류: ${res.status}` }), {
        status: 502, headers: corsHeaders,
      });
    }

    const html = await res.text();

    // 오류 항목 파싱
    const issues = [];
    const errBlockRe = /<span[^>]*class="[^"]*errored[^"]*"[^>]*>([\s\S]*?)<\/span>/gi;
    let blockMatch;
    while ((blockMatch = errBlockRe.exec(html)) !== null) {
      const block = blockMatch[1];
      // 잘못된 표현 추출
      const wrongMatch = block.match(/<span[^>]*class="[^"]*wrong[^"]*"[^>]*>([\s\S]*?)<\/span>/i);
      // 대안 추출
      const candMatch = block.match(/candWord['":\s]+([^\s,}<"']+)/i) ||
                        block.match(/<a[^>]*class="[^"]*cand[^"]*"[^>]*>([\s\S]*?)<\/a>/i);

      if (wrongMatch) {
        const wrong = wrongMatch[1].replace(/<[^>]+>/g, '').trim();
        const correct = candMatch ? candMatch[1].replace(/<[^>]+>/g, '').trim() : '';
        if (wrong && wrong !== correct) {
          issues.push({ wrong, correct: correct || '(대안 없음)' });
        }
      }
    }

    // 파싱이 안 된 경우를 대비해 원본 HTML도 함께 반환
    return new Response(JSON.stringify({ issues, rawHtml: html }), {
      status: 200, headers: corsHeaders,
    });

  } catch (err) {
    return new Response(JSON.stringify({ error: '프록시 오류: ' + err.message }), {
      status: 500, headers: corsHeaders,
    });
  }
}
