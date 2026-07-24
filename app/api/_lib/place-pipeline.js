// Gemini 장소 추출 → Kakao 좌표 확정 공용 파이프라인
// /api/extract (링크→캡션 텍스트)와 /api/extract-image (스크린샷)에서 함께 쓴다.
// 모음 릴스("대구 카페 10곳")처럼 여러 장소가 담긴 경우가 많아 항상 배열로 다룬다.

const MAX_PLACES = 15; // 모음 릴스 상한 (Kakao 호출 폭주 방지)

const COMMON_RULES = `각 장소의 카테고리는 반드시 아래 중 하나:
- "cafe": 카페, 디저트, 베이커리
- "restaurant": 식당, 맛집, 술집, 바
- "entertainment": 그 외 놀거리, 명소, 전시, 쇼핑

반드시 아래 JSON 형식으로만 답해. 다른 말 붙이지 마.
{"places": [{"placeName": "상호명", "category": "cafe|restaurant|entertainment", "region": "지역명 또는 null"}]}

장소를 하나도 찾지 못하면 {"places": []} 로 답해.
최대 ${MAX_PLACES}곳까지만.`;

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

  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    parsed = JSON.parse(raw.replace(/```json|```/g, "").trim());
  }
  return normalizeExtracted(parsed);
}

// 응답을 [{placeName, category, region}] 배열로 정규화
// (모델이 단일 객체로 답하는 경우도 있어 방어적으로 받는다)
function normalizeExtracted(parsed) {
  const list = Array.isArray(parsed?.places)
    ? parsed.places
    : parsed?.placeName
      ? [parsed]
      : [];

  const seen = new Set();
  return list
    .filter((p) => typeof p?.placeName === "string" && p.placeName.trim())
    .map((p) => ({
      placeName: p.placeName.trim(),
      category: p.category,
      region: typeof p.region === "string" && p.region.trim() ? p.region.trim() : null,
    }))
    .filter((p) => {
      const k = p.placeName.toLowerCase();
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    })
    .slice(0, MAX_PLACES);
}

// 캡션 텍스트에서 장소 추출
export async function extractPlacesFromCaption(caption) {
  const prompt = `다음은 인스타그램 릴스나 유튜브 쇼츠 게시물의 텍스트야.
여기서 소개하는 "실제 장소"(카페, 식당, 맛집, 명소, 놀거리)의 이름을 모두 뽑아줘.

매우 중요한 규칙:
- 텍스트에 "명시적으로 적힌" 상호명만 뽑아. 절대 추측하거나 지어내지 마.
- 여러 곳을 소개하는 모음 게시물이면 나온 곳을 전부 뽑아. 한 곳만 있으면 한 곳만.
- 구체적 상호명이 없고 지역/카테고리만 있으면(예: "성수 맛집 추천", "커피맛집 Top3") 빈 배열로.
- 해시태그(#성수맛집)나 일반 명사는 상호명이 아님.
- 지역명은 상호명에서 분리해 region 에 (예: "판교 알레그리아" → placeName "알레그리아", region "판교")
- 게시물 전체에 공통으로 적용되는 지역(해시태그 #대구카페 등)이 있으면 각 장소의 region 에 넣어줘.

${COMMON_RULES}

게시물 텍스트:
"""
${caption}
"""`;

  return callGemini([{ text: prompt }]);
}

// 릴스/쇼츠 스크린샷에서 장소 추출 (화면 자막·위치태그·캡션 목록 위주)
export async function extractPlacesFromImage(base64, mimeType) {
  const prompt = `이 이미지는 인스타그램 릴스나 유튜브 쇼츠의 스크린샷이야.
화면 속 자막, 위치 태그, 캡션에서 소개하는 "실제 장소"(카페, 식당, 맛집, 명소, 놀거리)의 이름을 모두 뽑아줘.

매우 중요한 규칙:
- 이미지에 "실제로 보이는" 상호명만 뽑아. 절대 추측하거나 지어내지 마.
- 여러 곳을 나열한 모음 게시물이면(📍 목록 등) 나열된 곳을 전부 뽑아. 한 곳만 있으면 한 곳만.
- 구체적 상호명이 없고 지역/카테고리만 보이면(예: "성수 맛집 추천") 빈 배열로.
- 해시태그(#성수맛집)나 일반 명사는 상호명이 아님.
- 좋아요·팔로우·댓글 같은 앱 UI 텍스트는 상호명이 아님.
- @계정아이디는 상호명이 아니지만, 바로 옆에 한글 상호명이 적혀 있으면 그 한글 상호명을 뽑아.
- 지역명은 상호명에서 분리해 region 에 (예: "판교 알레그리아" → placeName "알레그리아", region "판교")
- 해시태그(#대구카페)나 화면에서 지역을 알 수 있으면 각 장소의 region 에 그 지역을 넣어줘.

${COMMON_RULES}`;

  return callGemini([
    { text: prompt },
    { inline_data: { mime_type: mimeType, data: base64 } },
  ]);
}

const MAJOR_REGIONS = [
  "서울", "부산", "대구", "인천", "광주", "대전", "울산", "세종",
  "경기", "강원", "충북", "충남", "전북", "전남", "경북", "경남", "제주",
  "충청", "전라", "경상",
];

// "대구광역시" → "대구" 처럼 행정구역 접미사를 떼어 주소 문자열과 비교 가능하게
const normalizeRegion = (s) =>
  s.replace(/특별자치시|특별자치도|특별시|광역시|자치도/g, "").trim();

// Kakao 결과가 엉뚱한 지역인지 판단한다.
// 키워드 검색은 못 찾으면 "비슷한 이름의 다른 지역 가게"를 돌려주기 때문에 걸러내야 한다.
//
// 단, 시/도 단위로만 비교한다:
// - 모델은 지역을 "대구 범어동"처럼 조합해 내놓는데 실제 주소는 "대구 수성구 범어동"이라
//   통짜 문자열 비교는 실패한다.
// - 홍대·성수처럼 흔히 쓰는 동네 이름은 공식 주소에 아예 없는 경우도 많다.
// 그래서 판단 가능한 시/도가 없으면 "충돌 아님"으로 두고, 지역을 붙인 검색 결과를 믿는다.
function conflictsWithRegion(doc, region) {
  const major = MAJOR_REGIONS.find((r) => normalizeRegion(region).includes(r));
  if (!major) return false;
  const addr = `${doc.road_address_name || ""} ${doc.address_name || ""}`;
  return !addr.includes(major);
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

  if (!region) return run(query);

  // 지역명을 붙여 검색하고, 결과가 다른 시/도면 버린다
  const withRegion = await run(`${region} ${query}`);
  if (withRegion && !conflictsWithRegion(withRegion, region)) return withRegion;

  // 상호명만으로 재검색 — 이때도 시/도가 어긋나면 버린다.
  // 엉뚱한 지역의 비슷한 이름을 저장하느니 "못 찾음"으로 두는 편이 낫다.
  const withoutRegion = await run(query);
  return withoutRegion && !conflictsWithRegion(withoutRegion, region) ? withoutRegion : null;
}

export function normalizeCategory(geminiCategory, kakaoGroupName) {
  const g = kakaoGroupName || "";
  if (g.includes("카페")) return "cafe";
  if (g.includes("음식점")) return "restaurant";
  if (["cafe", "restaurant", "entertainment"].includes(geminiCategory))
    return geminiCategory;
  return "entertainment";
}

// 추출된 장소들을 한꺼번에 좌표 확정
// 일부만 실패해도 나머지는 살린다 (모음 릴스에서 한 곳 못 찾는다고 전부 버릴 이유 없음)
export async function geocodePlaces(extractedList, reelUrl) {
  const results = await Promise.all(
    extractedList.map(async (ex, i) => {
      try {
        const doc = await searchKakao(ex.placeName, ex.region);
        if (!doc) return { failed: ex.placeName };
        return {
          place: {
            id: `p_${Date.now()}_${i}`,
            name: doc.place_name,
            category: normalizeCategory(ex.category, doc.category_group_name),
            lat: parseFloat(doc.y),
            lng: parseFloat(doc.x),
            address: doc.road_address_name || doc.address_name,
            ...(reelUrl ? { reelUrl } : {}),
          },
        };
      } catch {
        return { failed: ex.placeName };
      }
    })
  );

  return {
    places: results.filter((r) => r.place).map((r) => r.place),
    failedNames: results.filter((r) => r.failed).map((r) => r.failed),
  };
}
