import { installLocationGuard } from "@/app/_lib/location-guard";

// 하이드레이션 전에 실행되므로, 앱이 첫 요청을 보내기 전에 가드가 걸린다.
// 프로덕션 빌드에서는 installLocationGuard 가 즉시 반환한다.
try {
  installLocationGuard();
} catch {
  // 가드 설치 실패가 앱 부팅을 막지 않도록 한다.
}
