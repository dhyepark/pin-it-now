import { NextResponse } from "next/server";
import { extractPlaceFromCaption, searchKakao, buildPlace } from "../_lib/place-pipeline";

// 릴스/쇼츠 링크 → 캡션 확보 → Gemini로 장소 추출 → Kakao로 좌표 확인
// - 유튜브: 공식 oEmbed (무료, 안정적)
// - 인스타: RapidAPI 스크래퍼 (서버에서 인스타 직접 스크래핑은 로그인 벽에 막힘)
// 흐름 중 하나라도 실패하면 프론트에서 "직접 검색" 폴백을 띄운다.

export const maxDuration = 30; // 스크래퍼 응답 대기 여유 (Vercel)

const BROWSER_UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 " +
  "(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

function decodeEntities(s) {
  return s
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&#x2F;/g, "/");
}

// ── 인스타: RapidAPI 스크래퍼로 캡션 + 위치 확보 ──────────────
// 제공자마다 응답 구조가 달라, 알려진 키들을 방어적으로 훑는다.
async function fetchInstagramCaption(url) {
  const key = process.env.RAPIDAPI_KEY;
  const host = process.env.RAPIDAPI_HOST || "instagram-scraper-api2.p.rapidapi.com";
  const path = process.env.RAPIDAPI_PATH || "/v1/post_info";
  const param = process.env.RAPIDAPI_PARAM || "code_or_id_or_url";
  if (!key) return null; // 키 없으면 스크래핑 불가 → 폴백

  const endpoint = `https://${host}${path}?${param}=${encodeURIComponent(url)}`;
  const res = await fetch(endpoint, {
    headers: { "x-rapidapi-key": key, "x-rapidapi-host": host },
  });
  if (!res.ok) return null;

  const json = await res.json();
  const caption = pickCaption(json);
  const location = pickLocation(json);
  if (!caption && !location) return null;

  return [caption, location && `위치태그: ${location}`].filter(Boolean).join("\n");
}

// 응답 JSON에서 캡션 텍스트 찾기 (알려진 경로 우선 → 깊은 탐색 폴백)
function pickCaption(json) {
  const d = json?.data ?? json;
  const candidates = [
    d?.caption?.text,
    typeof d?.caption === "string" ? d.caption : null,
    d?.edge_media_to_caption?.edges?.[0]?.node?.text,
    d?.title,
    d?.description,
    json?.caption?.text,
    json?.title,
  ].filter((v) => typeof v === "string" && v.trim());
  if (candidates.length) return candidates[0].trim();

  // 폴백: 가장 긴 문자열 값을 캡션으로 추정
  let longest = "";
  const walk = (v) => {
    if (typeof v === "string") {
      if (v.length > longest.length && v.length < 3000) longest = v;
    } else if (v && typeof v === "object") {
      Object.values(v).forEach(walk);
    }
  };
  walk(json);
  return longest.trim() || null;
}

function pickLocation(json) {
  const d = json?.data ?? json;
  const loc =
    d?.location?.name ||
    d?.location_name ||
    (typeof d?.location === "string" ? d.location : null);
  return typeof loc === "string" && loc.trim() ? loc.trim() : null;
}

// ── 유튜브 + 일반 페이지: og 메타 스크래핑 ──────────────────────
// 유튜브: 제목(oEmbed) + 설명(페이지 스크래핑)을 함께 확보
// 가게명은 제목보다 설명에 적혀있는 경우가 많다.
async function fetchYoutubeCaption(url) {
  let title = "";
  let description = "";

  try {
    const res = await fetch(
      `https://www.youtube.com/oembed?url=${encodeURIComponent(url)}&format=json`,
      { headers: { "User-Agent": BROWSER_UA } }
    );
    if (res.ok) {
      const data = await res.json();
      title = data.title || "";
    }
  } catch {
    // oEmbed 실패 → 스크래핑만으로 진행
  }

  try {
    const res = await fetch(url, { headers: { "User-Agent": BROWSER_UA } });
    if (res.ok) {
      const html = await res.text();
      const m = html.match(/"shortDescription":"((?:[^"\\]|\\.)*)"/);
      if (m && m[1]) {
        description = JSON.parse(`"${m[1]}"`); // \n, \uXXXX 등 이스케이프 해제
      }
    }
  } catch {
    // 스크래핑 실패 → 제목만으로 진행
  }

  const text = [title, description].filter(Boolean).join("\n").trim();
  return text || null;
}

async function fetchGenericCaption(url) {
  if (/youtube\.com|youtu\.be/.test(url)) {
    const yt = await fetchYoutubeCaption(url).catch(() => null);
    if (yt) return yt;
  }

  const res = await fetch(url, {
    headers: { "User-Agent": BROWSER_UA, "Accept-Language": "ko-KR,ko;q=0.9" },
  });
  if (!res.ok) return null;

  const html = await res.text();
  const pieces = [];
  const grab = (re) => {
    const m = html.match(re);
    if (m && m[1]) pieces.push(decodeEntities(m[1]));
  };
  grab(/<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']+)["']/i);
  grab(/<meta[^>]+property=["']og:description["'][^>]+content=["']([^"']+)["']/i);
  grab(/<meta[^>]+name=["']description["'][^>]+content=["']([^"']+)["']/i);
  grab(/<title>([^<]+)<\/title>/i);

  const text = pieces.join("\n").trim();
  return text || null;
}

// 링크에서 캡션 텍스트 확보 (플랫폼별 분기)
async function fetchCaption(url) {
  if (/instagram\.com/.test(url)) {
    const viaApi = await fetchInstagramCaption(url).catch(() => null);
    if (viaApi) return viaApi;
    // RapidAPI 실패 시, 혹시 몰라 일반 스크래핑도 시도 (대개 막힘)
    return fetchGenericCaption(url).catch(() => null);
  }
  return fetchGenericCaption(url);
}

export async function POST(request) {
  try {
    const { url } = await request.json();
    if (!url || typeof url !== "string") {
      return NextResponse.json({ error: "링크를 입력해주세요." }, { status: 400 });
    }

    // 인스타는 스크래퍼 키가 없으면 자동 추출 불가 → 유튜브로 안내
    if (/instagram\.com/.test(url) && !process.env.RAPIDAPI_KEY) {
      return NextResponse.json(
        {
          error: "인스타 릴스는 아직 준비 중이에요. 유튜브 쇼츠 링크로 시도해주세요 🙏",
          fallback: false,
        },
        { status: 422 }
      );
    }

    const caption = await fetchCaption(url).catch(() => null);
    if (!caption) {
      return NextResponse.json(
        {
          error: "링크에서 정보를 가져오지 못했어요. 장소명을 직접 검색해 추가해주세요.",
          fallback: true,
        },
        { status: 422 }
      );
    }

    const extracted = await extractPlaceFromCaption(caption);
    if (!extracted?.placeName) {
      return NextResponse.json(
        {
          error: "게시물에서 장소를 찾지 못했어요. 장소명을 직접 검색해 추가해주세요.",
          fallback: true,
        },
        { status: 422 }
      );
    }

    const doc = await searchKakao(extracted.placeName, extracted.region);
    if (!doc) {
      return NextResponse.json(
        {
          error: `'${extracted.placeName}'의 위치를 찾지 못했어요. 직접 검색해 추가해주세요.`,
          fallback: true,
          guess: extracted.placeName,
        },
        { status: 422 }
      );
    }

    return NextResponse.json({ place: buildPlace(doc, extracted, url) });
  } catch (err) {
    console.error("[extract] error:", err);
    return NextResponse.json(
      { error: "장소 추출 중 오류가 발생했어요. 잠시 후 다시 시도해주세요." },
      { status: 500 }
    );
  }
}
