import { NextResponse } from "next/server";

// 장소명 직접 검색 (추출 실패 시 폴백 + 자동완성용)
export async function GET(request) {
  const key = process.env.KAKAO_REST_KEY;
  if (!key) {
    return NextResponse.json({ error: "KAKAO_REST_KEY 미설정" }, { status: 500 });
  }

  const query = request.nextUrl.searchParams.get("q");
  if (!query || query.trim().length < 2) {
    return NextResponse.json({ places: [] });
  }

  try {
    const res = await fetch(
      `https://dapi.kakao.com/v2/local/search/keyword.json?query=${encodeURIComponent(query)}&size=8`,
      { headers: { Authorization: `KakaoAK ${key}` } }
    );
    if (!res.ok) throw new Error(`Kakao ${res.status}`);

    const data = await res.json();
    const places = (data.documents || []).map((doc) => ({
      id: `p_${doc.id}`,
      name: doc.place_name,
      category: doc.category_group_name?.includes("카페")
        ? "cafe"
        : doc.category_group_name?.includes("음식점")
          ? "restaurant"
          : "entertainment",
      lat: parseFloat(doc.y),
      lng: parseFloat(doc.x),
      address: doc.road_address_name || doc.address_name,
    }));

    return NextResponse.json({ places });
  } catch (err) {
    console.error("[search] error:", err);
    return NextResponse.json({ error: "검색 실패" }, { status: 500 });
  }
}
