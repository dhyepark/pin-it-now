// 개발 모드 전용 안전망 — 현재 위치 좌표가 우리 서버로 새는 것을 막는다.
//
// PinItNow 에서 좌표의 용도는 "이미 가지고 있는 장소들을 거리순으로 정렬"하는 것 하나뿐이고,
// 그 계산은 전부 브라우저에서 끝난다. 그래서 좌표는 우리 서버로 나갈 이유가 없다.
// 나가는 순간 위치정보법상 '수집'이 시작되고, 코드에 저장을 안 짜도
// 액세스 로그·APM·에러 리포터가 알아서 남긴다.
//
// 문제는 이 규칙을 어겨도 아무 증상이 없다는 것이다. 기능은 잘 되고 테스트도 통과한다.
// 그래서 사람이 기억하는 대신 런타임이 강제하게 만든다:
// getCurrentPosition 이 내준 실제 좌표값을 기억해 뒀다가,
// 같은 오리진으로 나가는 요청에 그 숫자가 보이면 즉시 throw 한다.
//
// 한계 — 개발 중 실제로 실행된 코드 경로만 잡는다. 증명이 아니라 값싼 안전망이다.
// 바이너리 본문(이미지 등)은 검사하지 않는다. 사진 EXIF 의 GPS 는
// 업로드 직전 캔버스 재인코딩으로 따로 제거한다 (app/app/page.js 의 downscaleImage).

const seen = new Set();

// 좌표를 반올림해 보내도 걸리도록 몇 가지 정밀도를 함께 등록한다.
// 소수점 3자리(약 100m 격자)로 뭉개도 위치정보인 건 마찬가지라 잡는 게 맞다.
const remember = (n) => {
  for (const v of [String(n), n.toFixed(5), n.toFixed(4), n.toFixed(3)]) {
    if (v.length > 5) seen.add(v);
  }
};

const serializeBody = (body) => {
  if (!body) return "";
  if (typeof body === "string") return body;
  if (body instanceof URLSearchParams) return body.toString();
  if (body instanceof FormData) {
    let out = "";
    for (const [k, v] of body) out += `${k}=${typeof v === "string" ? v : ""}&`;
    return out;
  }
  return ""; // Blob/ArrayBuffer 등은 검사 불가
};

const PREFIX = "[location-guard]";

export function installLocationGuard() {
  if (process.env.NODE_ENV === "production") return;
  if (typeof window === "undefined" || window.__locationGuard) return;
  window.__locationGuard = true;

  // 1) 좌표가 앱으로 들어오는 지점을 감시한다 — 앱 코드는 건드리지 않는다.
  const geo = navigator.geolocation;
  if (geo) {
    for (const name of ["getCurrentPosition", "watchPosition"]) {
      const orig = geo[name]?.bind(geo);
      if (!orig) continue;
      geo[name] = (onSuccess, onError, options) =>
        orig(
          (pos) => {
            remember(pos.coords.latitude);
            remember(pos.coords.longitude);
            onSuccess?.(pos);
          },
          onError,
          options
        );
    }
  }

  // 2) 좌표가 나가는 지점을 감시한다.
  const origFetch = window.fetch.bind(window);
  window.fetch = (input, init) => {
    try {
      const raw = typeof input === "string" ? input : (input?.url ?? String(input));
      const url = new URL(raw, location.href);
      const haystack =
        decodeURIComponent(url.pathname + url.search) + serializeBody(init?.body);
      const hit = [...seen].find((v) => haystack.includes(v));

      if (hit) {
        const ours = url.origin === location.origin;
        const msg = `${PREFIX} 현재 위치 좌표(${hit})가 ${ours ? url.pathname : url.origin} 요청에 실렸습니다.`;
        // 우리 서버로 가면 차단한다. 외부(예: 카카오 직접 호출)는 의도된 설계일 수 있어 경고만 남긴다.
        if (ours) throw new Error(`${msg} 좌표는 우리 서버로 보내지 않습니다.`);
        console.warn(msg, "의도한 전송인지 확인하세요.");
      }
    } catch (err) {
      // 가드가 던진 것만 통과시키고, URL 파싱 실패 등은 삼킨다 — 가드가 앱을 망가뜨리면 안 된다.
      if (err instanceof Error && err.message.startsWith(PREFIX)) throw err;
    }
    return origFetch(input, init);
  };
}
