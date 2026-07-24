// Gemini 장소 추출 → Kakao 좌표 확정 공용 파이프라인
// /api/extract (링크→캡션 텍스트)와 /api/extract-image (스크린샷)에서 함께 쓴다.

const COMMON_RULES = `카테고리는 반드시 아래 중 하나:
- "cafe": 카페, 디저트, 베이커리
- "restaurant": 식당, 맛집, 술집, 바
- "entertainment": 그 외 놀거리, 명소, 전시, 쇼핑

반드시 아래 JSON 형식으로만 답해. 다른 말 붙이지 마.
{"placeName": "상호명 또는 null", "category": "cafe|restaurant|entertainment", "region": "지역명 또는 null"}`;

async function callGemini(parts) {
  const key = process.env.GEMINI_API_KEY;
  if (!key) throw new Error("GEMINI_API_KEY 가 설정되지 않았습니다.");

  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/gemini-flash-latest:generateContent?key=${key}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{ parts }],
        generationConfig: { responseMimeType: "application/json", temperature: 0 },
      }),
    }
  );

  if (!res.ok) {
    const detail = await res.text();
    throw new Error(`Gemini 요청 실패: ${res.status} ${detail.slice(0, 200)}`);
  }

  const data = await res.json();
  const raw = data?.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!raw) throw new Error("Gemini 응답이 비어있습니다.");

  try {
    return JSON.parse(raw);
  } catch {
    return JSON.parse(raw.replace(/```json|```/g, "").trim());
  }
}

// 캡션 텍스트에서 장소명/카테고리 추출
export async function extractPlaceFromCaption(caption) {
  const prompt = `다음은 인스타그램 릴스나 유튜브 쇼츠 게시물의 텍스트야.
여기서 소개하는 "실제 장소"(카페, 식당, 맛집, 명소, 놀거리)의 이름을 정확히 하나만 뽑아줘.

매우 중요한 규칙:
- 텍스트에 "명시적으로 적힌" 상호명만 뽑아. 절대 추측하거나 지어내지 마.
- 텍스트에 구체적 상호명이 없고 지역/카테고리만 있으면(예: "성수 맛집 추천", "커피맛집 Top3") 반드시 placeName 을 null 로.
- 해시태그(#성수맛집)나 일반 명사는 상호명이 아님.
- 지역명 없이 상호명 위주로 (예: "판교 알레그리아" → "알레그리아")
- 여러 곳이면 가장 대표적인(제목에 가까운) 한 곳만

${COMMON_RULES}

게시물 텍스트:
"""
${caption}
"""`;

  return callGemini([{ text: prompt }]);
}

// 릴스/쇼츠 스크린샷에서 장소명/카테고리 추출 (화면 자막·위치태그 위주)
export async function extractPlaceFromImage(base64, mimeType) {
  const prompt = `이 이미지는 인스타그램 릴스나 유튜브 쇼츠의 스크린샷이야.
화면 속 자막, 위치 태그, 캡션 등에서 소개하는 "실제 장소"(카페, 식당, 맛집, 명소, 놀거리)의 이름을 정확히 하나만 뽑아줘.

매우 중요한 규칙:
- 이미지에 "실제로 보이는" 상호명만 뽑아. 절대 추측하거나 지어내지 마.
- 구체적 상호명이 없고 지역/카테고리만 보이면(예: "성수 맛집 추천") 반드시 placeName 을 null 로.
- 해시태그(#성수맛집)나 일반 명사는 상호명이 아님.
- 좋아요·팔로우·댓글 같은 앱 UI 텍스트나 계정 아이디는 상호명이 아님.
- 지역명 없이 상호명 위주로 (예: "판교 알레그리아" → "알레그리아")
- 여러 곳이면 가장 크게, 또는 반복해서 보이는 한 곳만

${COMMON_RULES}`;

  return callGemini([
    { text: prompt },
    { inline_data: { mime_type: mimeType, data: base64 } },
  ]);
}

// Kakao Local API로 장소명 → 좌표/주소 확정
export async function searchKakao(query, region) {
  const key = process.env.KAKAO_REST_KEY;
  if (!key) throw new Error("KAKAO_REST_KEY 가 설정되지 않았습니다.");

  const run = async (q) => {
    const res = await fetch(
      `https://dapi.kakao.com/v2/local/search/keyword.json?query=${encodeURIComponent(q)}&size=1`,
      { headers: { Authorization: `KakaoAK ${key}` } }
    );
    if (!res.ok) {
      const detail = await res.text();
      throw new Error(`Kakao 검색 실패: ${res.status} ${detail.slice(0, 200)}`);
    }
    return (await res.json())?.documents?.[0] || null;
  };

  // 지역명 붙여 검색 → 실패 시 상호명만으로 재검색
  let doc = await run(region ? `${region} ${query}` : query);
  if (!doc && region) doc = await run(query);
  return doc;
}

export function normalizeCategory(geminiCategory, kakaoGroupName) {
  const g = kakaoGroupName || "";
  if (g.includes("카페")) return "cafe";
  if (g.includes("음식점")) return "restaurant";
  if (["cafe", "restaurant", "entertainment"].includes(geminiCategory))
    return geminiCategory;
  return "entertainment";
}

// Kakao 검색 결과 → 프론트에 내려줄 place 객체
export function buildPlace(doc, extracted, reelUrl) {
  return {
    id: `p_${Date.now()}`,
    name: doc.place_name,
    category: normalizeCategory(extracted.category, doc.category_group_name),
    lat: parseFloat(doc.y),
    lng: parseFloat(doc.x),
    address: doc.road_address_name || doc.address_name,
    ...(reelUrl ? { reelUrl } : {}),
  };
}
