import { NextResponse } from "next/server";
import { extractPlaceFromImage, searchKakao, buildPlace } from "../_lib/place-pipeline";

// 릴스/쇼츠 스크린샷 → Gemini Vision으로 장소 추출 → Kakao로 좌표 확인
// 캡션 스크래핑이 막힌 인스타도, 스크린샷은 사용자가 직접 올리므로 플랫폼 제약이 없다.
// 릴스는 캡션보다 화면 자막에 상호명이 적힌 경우가 많아 추출 품질도 기대할 수 있다.

export const maxDuration = 30; // Gemini Vision 응답 대기 여유 (Vercel)

const MAX_IMAGE_BYTES = 8 * 1024 * 1024; // 프론트에서 리사이즈하지만 방어적으로 제한

export async function POST(request) {
  try {
    const form = await request.formData();
    const file = form.get("image");
    if (!file || typeof file === "string") {
      return NextResponse.json({ error: "스크린샷 이미지를 올려주세요." }, { status: 400 });
    }
    if (file.size > MAX_IMAGE_BYTES) {
      return NextResponse.json(
        { error: "이미지가 너무 커요. 8MB 이하로 올려주세요." },
        { status: 413 }
      );
    }

    const base64 = Buffer.from(await file.arrayBuffer()).toString("base64");
    const extracted = await extractPlaceFromImage(base64, file.type || "image/jpeg");
    if (!extracted?.placeName) {
      return NextResponse.json(
        {
          error: "스크린샷에서 장소를 찾지 못했어요. 장소명을 직접 검색해 추가해주세요.",
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

    return NextResponse.json({ place: buildPlace(doc, extracted) });
  } catch (err) {
    console.error("[extract-image] error:", err);
    return NextResponse.json(
      { error: "장소 추출 중 오류가 발생했어요. 잠시 후 다시 시도해주세요." },
      { status: 500 }
    );
  }
}
