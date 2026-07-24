import Link from "next/link";

const STEPS = [
  { n: "1", t: "링크 또는 스크린샷", d: "쇼츠 링크를 붙여넣거나, 릴스 스크린샷을 올려요." },
  { n: "2", t: "지도에 자동 저장", d: "영상 속 장소를 찾아 지도에 핀으로 담아둬요." },
  { n: "3", t: "가까운 곳부터", d: "약속 당일, 내 위치에서 가까운 순으로 보여줘요." },
];

export default function Landing() {
  return (
    <div className="h-[100dvh] overflow-y-auto bg-white text-gray-900">
      <main className="min-h-full max-w-md mx-auto px-6 py-14 flex flex-col justify-center">
        <div className="flex items-center gap-2 mb-10">
          <span className="w-2.5 h-2.5 rounded-full bg-gray-900" />
          <span className="font-extrabold tracking-tight text-lg">PinItNow</span>
        </div>

        <h1 className="text-[28px] leading-[1.3] font-extrabold tracking-tight">
          릴스·쇼츠 속 그곳,
          <br />
          지금 내 위치에서.
        </h1>
        <p className="mt-4 text-[15px] leading-relaxed text-gray-500">
          저장만 해두고 잊어버린 릴스·쇼츠 속 맛집·카페,
          <br />
          약속 당일 내 주변에서 바로 꺼내 보세요.
        </p>

        <ol className="mt-10 flex flex-col gap-5">
          {STEPS.map((s) => (
            <li key={s.n} className="flex gap-3.5">
              <span className="shrink-0 w-7 h-7 rounded-full bg-gray-900 text-white text-[13px] font-semibold flex items-center justify-center">
                {s.n}
              </span>
              <div>
                <p className="font-semibold text-[15px]">{s.t}</p>
                <p className="text-[13px] text-gray-500 mt-0.5 leading-relaxed">{s.d}</p>
              </div>
            </li>
          ))}
        </ol>

        <Link
          href="/app"
          className="mt-12 py-4 rounded-2xl bg-gray-900 text-white text-center font-semibold hover:bg-black active:scale-[0.99] transition"
        >
          시작하기
        </Link>

        <p className="mt-4 text-center text-[12px] text-gray-400">
          현재 위치 기준으로 보여줘요 · 모바일에서 열면 더 좋아요
        </p>
      </main>
    </div>
  );
}
