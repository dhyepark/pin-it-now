import "./globals.css";

export const metadata = {
  title: "PinItNow - 릴스 속 그곳, 지금 여기",
  description:
    "릴스나 쇼츠로 저장해 둔 장소를 지도에 모아, 지금 내 위치에서 가까운 곳부터 보여줘요.",
};

export const viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
};

export default function RootLayout({ children }) {
  return (
    <html lang="ko">
      <body>{children}</body>
    </html>
  );
}
