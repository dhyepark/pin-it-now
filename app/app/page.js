"use client";

import React from "react";
import Link from "next/link";

// 위치 권한이 없을 때 기본값 (판교역)
const DEFAULT_POS = { lat: 37.3942, lng: 127.1104 };
const STORAGE_KEY = "pinitnow_places";
const NEAR_RADIUS_KM = 15;
const KOREA_BOUNDS = [
  [33.0, 125.0],
  [38.7, 131.0],
];

const CATEGORIES = {
  cafe: { label: "카페", color: "#b45309" },
  restaurant: { label: "맛집", color: "#be123c" },
  entertainment: { label: "놀거리", color: "#6d28d9" },
};
const CATEGORY_KEYS = ["all", "cafe", "restaurant", "entertainment"];

const getDistance = (lat1, lon1, lat2, lon2) => {
  const R = 6371;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLon / 2) *
      Math.sin(dLon / 2);
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
};
const formatDistance = (d) => (d < 1 ? `${Math.round(d * 1000)}m` : `${d.toFixed(1)}km`);
const cx = (...c) => c.filter(Boolean).join(" ");

const Icon = ({ path, size = 20, fill = false }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill={fill ? "currentColor" : "none"} stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
    {path}
  </svg>
);
const Icons = {
  locate: (p) => <Icon {...p} path={<><circle cx="12" cy="12" r="7" /><line x1="12" y1="2" x2="12" y2="4" /><line x1="12" y1="20" x2="12" y2="22" /><line x1="2" y1="12" x2="4" y2="12" /><line x1="20" y1="12" x2="22" y2="12" /><circle cx="12" cy="12" r="2.5" fill="currentColor" stroke="none" /></>} />,
  link: (p) => <Icon {...p} path={<><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" /><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" /></>} />,
  search: (p) => <Icon {...p} path={<><circle cx="11" cy="11" r="8" /><path d="m21 21-4.3-4.3" /></>} />,
  play: (p) => <Icon {...p} path={<polygon points="6 3 20 12 6 21 6 3" />} fill />,
  trash: (p) => <Icon {...p} path={<><polyline points="3 6 5 6 21 6" /><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" /></>} />,
  close: (p) => <Icon {...p} path={<><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></>} />,
  pin: (p) => <Icon {...p} path={<><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0Z" /><circle cx="12" cy="10" r="3" /></>} />,
  image: (p) => <Icon {...p} path={<><rect x="3" y="3" width="18" height="18" rx="2" /><circle cx="8.5" cy="8.5" r="1.5" /><path d="m21 15-5-5L5 21" /></>} />,
};

// 업로드 전 리사이즈: Gemini 비용·전송 시간 절약 (실패 시 원본 그대로, HEIC 등은 Gemini가 직접 처리)
const downscaleImage = (file, maxDim = 1280) =>
  new Promise((resolve) => {
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = () => {
      URL.revokeObjectURL(url);
      const scale = Math.min(1, maxDim / Math.max(img.width, img.height));
      const canvas = document.createElement("canvas");
      canvas.width = Math.round(img.width * scale);
      canvas.height = Math.round(img.height * scale);
      canvas.getContext("2d").drawImage(img, 0, 0, canvas.width, canvas.height);
      canvas.toBlob((blob) => resolve(blob || file), "image/jpeg", 0.85);
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      resolve(file);
    };
    img.src = url;
  });

export default function App() {
  const [places, setPlaces] = React.useState([]);
  const [currentPos, setCurrentPos] = React.useState(DEFAULT_POS);
  const [scope, setScope] = React.useState("near");
  const [categoryFilter, setCategoryFilter] = React.useState("all");
  // 선택은 id 로만 들고, 실제 객체는 거리까지 계산된 목록에서 파생시킨다
  // (원본 객체를 그대로 담으면 distance 가 없거나 위치 갱신에 뒤처진다)
  const [selectedId, setSelectedId] = React.useState(null);
  const [linkInput, setLinkInput] = React.useState("");
  const [isLoading, setIsLoading] = React.useState(false);
  const [toastMsg, setToastMsg] = React.useState("");

  const [searchOpen, setSearchOpen] = React.useState(false);
  const [searchQuery, setSearchQuery] = React.useState("");
  const [searchResults, setSearchResults] = React.useState([]);
  const [searchLoading, setSearchLoading] = React.useState(false);
  const pendingReelUrl = React.useRef("");
  const fileInputRef = React.useRef(null);
  const placesRef = React.useRef([]); // 중복 판정을 동기적으로 하기 위한 최신 목록

  const LRef = React.useRef(null);
  const mapRef = React.useRef(null);
  const markersRef = React.useRef(null);
  const currentMarkerRef = React.useRef(null);
  const didInitialFly = React.useRef(false);
  const [mapReady, setMapReady] = React.useState(false);

  React.useEffect(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (saved) {
        const parsed = JSON.parse(saved);
        placesRef.current = parsed;
        setPlaces(parsed);
      }
    } catch {}
  }, []);
  React.useEffect(() => {
    placesRef.current = places;
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(places));
    } catch {}
  }, [places]);

  React.useEffect(() => {
    if (!navigator.geolocation) return;
    navigator.geolocation.getCurrentPosition(
      (pos) => setCurrentPos({ lat: pos.coords.latitude, lng: pos.coords.longitude }),
      () => setToastMsg("위치 권한이 없어 판교 기준으로 표시해요."),
      { enableHighAccuracy: true, timeout: 8000 }
    );
  }, []);

  React.useEffect(() => {
    let cancelled = false;
    import("leaflet").then((mod) => {
      if (cancelled) return;
      const L = mod.default;
      LRef.current = L;
      const el = document.getElementById("map");
      if (!el || el._leaflet_id) return;
      const map = L.map(el, { zoomControl: false }).setView([DEFAULT_POS.lat, DEFAULT_POS.lng], 14);
      L.tileLayer("https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png", {
        attribution: "&copy; OpenStreetMap &copy; CARTO",
        maxZoom: 20,
      }).addTo(map);
      markersRef.current = L.layerGroup().addTo(map);
      mapRef.current = map;
      setMapReady(true);
      setTimeout(() => map.invalidateSize(), 200);
    });
    return () => {
      cancelled = true;
      if (mapRef.current) {
        mapRef.current.remove();
        mapRef.current = null;
      }
    };
  }, []);

  React.useEffect(() => {
    const L = LRef.current;
    const map = mapRef.current;
    if (!L || !map || !mapReady) return;
    const curIcon = L.divIcon({ className: "", html: '<div class="pin-current"></div>', iconSize: [16, 16], iconAnchor: [8, 8] });
    if (!currentMarkerRef.current) {
      currentMarkerRef.current = L.marker([currentPos.lat, currentPos.lng], { icon: curIcon, zIndexOffset: 1000 }).addTo(map);
    } else {
      currentMarkerRef.current.setLatLng([currentPos.lat, currentPos.lng]);
    }
    if (!didInitialFly.current && currentPos !== DEFAULT_POS) {
      map.flyTo([currentPos.lat, currentPos.lng], 15, { duration: 1.2 });
      didInitialFly.current = true;
    }
  }, [currentPos, mapReady]);

  const processedPlaces = React.useMemo(
    () => places.map((p) => ({ ...p, distance: getDistance(currentPos.lat, currentPos.lng, p.lat, p.lng) })),
    [places, currentPos]
  );
  const filteredPlaces = React.useMemo(
    () =>
      processedPlaces
        .filter((p) => {
          if (scope === "near" && p.distance > NEAR_RADIUS_KM) return false;
          if (categoryFilter !== "all" && p.category !== categoryFilter) return false;
          return true;
        })
        .sort((a, b) => a.distance - b.distance),
    [processedPlaces, scope, categoryFilter]
  );
  const selectedPlace = React.useMemo(
    () => processedPlaces.find((p) => p.id === selectedId) || null,
    [processedPlaces, selectedId]
  );

  React.useEffect(() => {
    const L = LRef.current;
    if (!L || !markersRef.current) return;
    markersRef.current.clearLayers();
    filteredPlaces.forEach((place) => {
      const color = CATEGORIES[place.category]?.color || "#111111";
      const selected = selectedId === place.id;
      const icon = L.divIcon({
        className: "",
        html: `<div class="pin-place ${selected ? "pin-place-selected" : ""}" style="background:${color}"></div>`,
        iconSize: [15, 15],
        iconAnchor: [7.5, 7.5],
      });
      L.marker([place.lat, place.lng], { icon }).addTo(markersRef.current).on("click", () => setSelectedId(place.id));
    });
  }, [filteredPlaces, selectedId, mapReady]);

  React.useEffect(() => {
    const onResize = () => mapRef.current?.invalidateSize();
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  React.useEffect(() => {
    if (!toastMsg) return;
    const t = setTimeout(() => setToastMsg(""), 3500);
    return () => clearTimeout(t);
  }, [toastMsg]);

  // 스크린샷을 클립보드에서 바로 붙여넣기 (Ctrl/Cmd+V)
  React.useEffect(() => {
    const onPaste = (e) => {
      const item = [...(e.clipboardData?.items || [])].find((i) => i.type.startsWith("image/"));
      if (!item) return;
      const file = item.getAsFile();
      if (file) {
        e.preventDefault();
        uploadScreenshot(file);
      }
    };
    window.addEventListener("paste", onPaste);
    return () => window.removeEventListener("paste", onPaste);
  });

  const isSamePlace = (a, b) =>
    a.name === b.name &&
    Math.abs(a.lat - b.lat) < 0.0005 &&
    Math.abs(a.lng - b.lng) < 0.0005;

  // 추가한 장소가 현재 필터에 걸려 지도에서 안 보이는 상황을 막는다
  const revealPlaces = (list) => {
    if (categoryFilter !== "all" && list.some((p) => p.category !== categoryFilter)) {
      setCategoryFilter("all");
    }
    const farAway = list.some(
      (p) => getDistance(currentPos.lat, currentPos.lng, p.lat, p.lng) > NEAR_RADIUS_KM
    );
    if (scope === "near" && farAway) setScope("all");

    const map = mapRef.current;
    const L = LRef.current;
    if (!map || !L) return;
    if (list.length === 1) {
      map.flyTo([list[0].lat, list[0].lng], 16, { duration: 1.2 });
    } else {
      map.flyToBounds(L.latLngBounds(list.map((p) => [p.lat, p.lng])), {
        padding: [60, 60],
        maxZoom: 15,
        duration: 1.2,
      });
    }
  };

  // 여러 장소를 한 번에 추가 (모음 릴스 대응)
  // 상태 업데이터는 순수해야 하므로, 중복 판정은 ref 로 동기적으로 처리한다
  const addPlaces = (incoming, { failedNames = [] } = {}) => {
    const current = placesRef.current;
    const added = [];
    const dups = [];
    incoming.forEach((place) => {
      if (current.some((p) => isSamePlace(p, place)) || added.some((p) => isSamePlace(p, place))) {
        dups.push(place.name);
      } else {
        added.push(place);
      }
    });

    if (added.length > 0) {
      const next = [...current, ...added];
      placesRef.current = next;
      setPlaces(next);
      setSelectedId(added.length === 1 ? added[0].id : null);
      revealPlaces(added);
    }

    const parts = [];
    if (added.length === 1) parts.push(`'${added[0].name}' 추가됨`);
    else if (added.length > 1) parts.push(`${added.length}곳 추가됨`);
    if (dups.length > 0) parts.push(`${dups.length}곳은 이미 있어요`);
    if (failedNames.length > 0) parts.push(`${failedNames.length}곳은 위치를 못 찾았어요`);
    setToastMsg(parts.join(" · ") || "추가할 장소가 없어요.");
  };

  const addPlace = (place) => addPlaces([place]);

  const handleAddLink = async (e) => {
    e.preventDefault();
    const url = linkInput.trim();
    if (!url || isLoading) return;
    setIsLoading(true);
    try {
      const res = await fetch("/api/extract", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url }),
      });
      const data = await res.json();
      if (res.ok && data.places?.length) {
        addPlaces(data.places, { failedNames: data.failedNames });
        setLinkInput("");
      } else if (data.fallback) {
        pendingReelUrl.current = url;
        setSearchQuery(data.guess || "");
        setSearchResults([]);
        setSearchOpen(true);
        setToastMsg(data.error || "장소를 찾지 못했어요. 직접 검색해주세요.");
      } else {
        setToastMsg(data.error || "추가에 실패했어요.");
      }
    } catch {
      setToastMsg("네트워크 오류가 발생했어요.");
    } finally {
      setIsLoading(false);
    }
  };

  // 스크린샷 업로드 → /api/extract-image (캡션이 없어도 화면 자막에서 상호명 추출)
  const handleAddImage = (e) => {
    const file = e.target.files?.[0];
    e.target.value = ""; // 같은 파일 재선택 허용
    if (file) uploadScreenshot(file);
  };

  const uploadScreenshot = async (file) => {
    if (isLoading) return;
    setIsLoading(true);
    try {
      const resized = await downscaleImage(file);
      const form = new FormData();
      form.append("image", resized, "screenshot.jpg");
      const res = await fetch("/api/extract-image", { method: "POST", body: form });
      const data = await res.json();
      if (res.ok && data.places?.length) {
        addPlaces(data.places, { failedNames: data.failedNames });
      } else if (data.fallback) {
        pendingReelUrl.current = "";
        setSearchQuery(data.guess || "");
        setSearchResults([]);
        setSearchOpen(true);
        setToastMsg(data.error || "장소를 찾지 못했어요. 직접 검색해주세요.");
      } else {
        setToastMsg(data.error || "추가에 실패했어요.");
      }
    } catch {
      setToastMsg("네트워크 오류가 발생했어요.");
    } finally {
      setIsLoading(false);
    }
  };

  React.useEffect(() => {
    if (!searchOpen) return;
    const q = searchQuery.trim();
    if (q.length < 2) {
      setSearchResults([]);
      return;
    }
    setSearchLoading(true);
    const t = setTimeout(async () => {
      try {
        const res = await fetch(`/api/search?q=${encodeURIComponent(q)}`);
        const data = await res.json();
        setSearchResults(data.places || []);
      } catch {
        setSearchResults([]);
      } finally {
        setSearchLoading(false);
      }
    }, 350);
    return () => clearTimeout(t);
  }, [searchQuery, searchOpen]);

  const handlePickSearchResult = (place) => {
    addPlace({ ...place, reelUrl: pendingReelUrl.current || undefined });
    setSearchOpen(false);
    setSearchQuery("");
    setSearchResults([]);
    setLinkInput("");
    pendingReelUrl.current = "";
  };

  const goToCurrentLocation = () => {
    if (mapRef.current) {
      mapRef.current.flyTo([currentPos.lat, currentPos.lng], 15, { duration: 1.2 });
      setScope("near");
      setToastMsg(`내 주변 ${NEAR_RADIUS_KM}km 이내만 표시해요.`);
    }
  };

  const handleDelete = (id) => {
    const next = placesRef.current.filter((p) => p.id !== id);
    placesRef.current = next;
    setPlaces(next);
    setSelectedId(null);
    setToastMsg("장소를 삭제했어요.");
  };

  // ── 재사용 UI ──
  // 주어진 장소들이 한 화면에 들어오도록 지도를 맞춘다
  const fitTo = (list) => {
    const map = mapRef.current;
    const L = LRef.current;
    if (!map || !L) return;
    if (list.length === 0) {
      map.flyToBounds(L.latLngBounds(KOREA_BOUNDS), { duration: 1.2 });
      return;
    }
    map.flyToBounds(L.latLngBounds(list.map((p) => [p.lat, p.lng])), {
      padding: [60, 60],
      maxZoom: 15,
      duration: 1.2,
    });
  };

  // 전국 전체로 전환 + 저장된 장소가 다 보이게 (없으면 남한 전역)
  const showAllScope = () => {
    setScope("all");
    const all = placesRef.current;
    fitTo(all.length > 0 ? [...all, currentPos] : []);
  };

  const handleToggleScope = () => {
    if (scope === "near") {
      showAllScope();
      return;
    }
    setScope("near");
    mapRef.current?.flyTo([currentPos.lat, currentPos.lng], 15, { duration: 1.2 });
  };

  // 카테고리를 바꾸면 그 카테고리로 보이는 장소들에 지도를 맞춘다
  const handleCategoryFilter = (c) => {
    setCategoryFilter(c);
    const visible = placesRef.current.filter((p) => {
      if (c !== "all" && p.category !== c) return false;
      if (scope === "near" && getDistance(currentPos.lat, currentPos.lng, p.lat, p.lng) > NEAR_RADIUS_KM)
        return false;
      return true;
    });
    if (visible.length > 0) fitTo(scope === "near" ? [...visible, currentPos] : visible);
  };

  const scopeToggle = (
    <button
      type="button"
      onClick={handleToggleScope}
      className="flex items-center gap-1.5 text-[13px] font-medium text-gray-600 hover:text-gray-900 transition"
    >
      <span className={cx("w-1.5 h-1.5 rounded-full", scope === "near" ? "bg-gray-900" : "bg-gray-300")} />
      {scope === "near" ? `내 주변 ${NEAR_RADIUS_KM}km` : "전국 전체"}
    </button>
  );

  const addForm = (
    <div className="flex flex-col gap-2">
      <form onSubmit={handleAddLink} className="flex gap-2">
        <label className="flex-1 flex items-center gap-2 h-11 px-3 rounded-xl border border-gray-200 bg-gray-50 focus-within:border-gray-900 focus-within:bg-white transition">
          <span className="text-gray-400 shrink-0"><Icons.link size={17} /></span>
          <input
            type="text"
            value={linkInput}
            onChange={(e) => setLinkInput(e.target.value)}
            placeholder="쇼츠 링크 붙여넣기"
            disabled={isLoading}
            className="w-full bg-transparent outline-none text-sm placeholder-gray-400 disabled:opacity-50"
          />
        </label>
        <button
          type="submit"
          disabled={isLoading}
          className="h-11 px-4 rounded-xl bg-gray-900 text-white text-sm font-semibold whitespace-nowrap hover:bg-black active:scale-[0.98] transition disabled:opacity-50 min-w-[60px]"
        >
          {isLoading ? "분석중" : "추가"}
        </button>
      </form>

      <input ref={fileInputRef} type="file" accept="image/*" className="hidden" onChange={handleAddImage} />
      <button
        type="button"
        onClick={() => fileInputRef.current?.click()}
        disabled={isLoading}
        className="flex items-center justify-center gap-2 h-11 rounded-xl border border-dashed border-gray-300 bg-white text-gray-600 text-sm font-medium hover:border-gray-900 hover:text-gray-900 transition disabled:opacity-50"
      >
        <Icons.image size={17} />
        {isLoading ? "분석중…" : "스크린샷으로 추가"}
        <span className="text-[11px] text-gray-400 font-normal">인스타 릴스는 이쪽</span>
      </button>
    </div>
  );

  const filterChips = (
    <div className="flex gap-1.5 overflow-x-auto no-scrollbar">
      {CATEGORY_KEYS.map((c) => (
        <button
          key={c}
          onClick={() => handleCategoryFilter(c)}
          className={cx(
            "px-3 h-8 rounded-full text-[13px] font-medium whitespace-nowrap transition border",
            categoryFilter === c ? "bg-gray-900 text-white border-gray-900" : "bg-white text-gray-500 border-gray-200 hover:border-gray-400"
          )}
        >
          {c === "all" ? "전체" : CATEGORIES[c].label}
        </button>
      ))}
    </div>
  );

  const listHeader = (
    <div className="flex items-baseline justify-between mb-1.5">
      <h2 className="text-sm font-semibold text-gray-900">
        갈 곳 모음 <span className="text-gray-400 font-normal">{filteredPlaces.length}</span>
      </h2>
    </div>
  );

  const placeList =
    places.length === 0 ? (
      <div className="flex flex-col items-center justify-center text-center gap-3 py-14 px-6">
        <div className="w-12 h-12 rounded-full bg-gray-100 flex items-center justify-center text-gray-400"><Icons.pin size={22} /></div>
        <div>
          <p className="font-semibold text-gray-900 text-sm">아직 저장한 곳이 없어요</p>
          <p className="text-[13px] text-gray-400 mt-1">쇼츠 링크를 붙여넣거나, 릴스 스크린샷을 올려 첫 장소를 담아보세요.<br />여러 곳을 소개하는 모음 릴스도 한 번에 담겨요.</p>
        </div>
      </div>
    ) : filteredPlaces.length === 0 ? (
      <div className="flex flex-col items-center justify-center text-center gap-2 py-14">
        <p className="text-[13px] text-gray-400">{scope === "near" ? "내 주변에" : "이 조건에"} 맞는 장소가 없어요.</p>
        {scope === "near" && (
          <button onClick={showAllScope} className="text-[13px] font-semibold text-gray-900 underline underline-offset-2">전국 전체 보기</button>
        )}
      </div>
    ) : (
      <ul className="divide-y divide-gray-100">
        {filteredPlaces.map((p) => (
          <li key={p.id}>
            <button onClick={() => setSelectedId(p.id)} className="w-full flex items-center gap-3 py-3.5 text-left hover:bg-gray-50 -mx-5 px-5 transition">
              <span className="w-2 h-2 rounded-full shrink-0" style={{ background: CATEGORIES[p.category]?.color || "#111" }} />
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <span className="font-semibold text-[15px] text-gray-900 truncate">{p.name}</span>
                  <span className="text-[11px] text-gray-400 shrink-0">{CATEGORIES[p.category]?.label || "기타"}</span>
                </div>
                <p className="text-[13px] text-gray-400 truncate mt-0.5">{p.address}</p>
              </div>
              <span className="text-[13px] font-semibold text-gray-900 tabular-nums shrink-0">{formatDistance(p.distance)}</span>
            </button>
          </li>
        ))}
      </ul>
    );

  return (
    <div className="h-[100dvh] w-full md:bg-[#f4f4f5]">
      <div className="h-full w-full md:max-w-5xl md:mx-auto bg-white flex flex-col md:flex-row overflow-hidden md:border-x md:border-gray-200">
        {/* 사이드바(데스크탑) / 상단 입력영역(모바일) */}
        <section className="flex flex-col shrink-0 z-[1000] md:w-[400px] md:h-full md:border-r md:border-gray-100">
          <div className="flex items-center justify-between px-5 h-14 border-b border-gray-100 shrink-0">
            <Link href="/" className="font-extrabold tracking-tight text-[17px] hover:opacity-70 transition">
              PinItNow
            </Link>
            {scopeToggle}
          </div>
          <div className="px-5 py-3 border-b border-gray-100 shrink-0">{addForm}</div>
          {/* 데스크탑 전용: 필터 + 리스트 */}
          <div className="hidden md:block px-5 py-3 shrink-0">{filterChips}</div>
          <div className="hidden md:flex md:flex-col md:flex-1 md:min-h-0 md:overflow-y-auto px-5 pb-6">
            {listHeader}
            {placeList}
          </div>
        </section>

        {/* 지도 */}
        <section className="relative flex-1 min-h-0">
          <div id="map" />
          <button
            type="button"
            onClick={goToCurrentLocation}
            aria-label="내 위치로"
            className="absolute bottom-5 right-4 w-11 h-11 rounded-full bg-white shadow-md border border-gray-100 flex items-center justify-center text-gray-900 hover:bg-gray-50 active:scale-95 transition z-[600]"
          >
            <Icons.locate size={20} />
          </button>
        </section>

        {/* 모바일 전용: 지도 아래 목록 시트 */}
        <section className="md:hidden shrink-0 h-[46%] bg-white rounded-t-2xl -mt-4 border-t border-gray-100 shadow-[0_-6px_20px_-8px_rgba(0,0,0,0.15)] relative z-[500] flex flex-col">
          <div className="pt-2 pb-1"><div className="w-9 h-1 bg-gray-200 rounded-full mx-auto" /></div>
          <div className="px-5 pt-2 pb-3 shrink-0">{filterChips}</div>
          <div className="flex-1 min-h-0 overflow-y-auto px-5 pb-6">
            {listHeader}
            {placeList}
          </div>
        </section>
      </div>

      {/* 토스트 */}
      {toastMsg && (
        <div className="fixed top-20 md:top-6 left-1/2 -translate-x-1/2 bg-gray-900 text-white px-4 py-2.5 rounded-full text-[13px] font-medium z-[9999] whitespace-nowrap shadow-lg max-w-[90vw] text-center">
          {toastMsg}
        </div>
      )}

      {/* 직접 검색(폴백) */}
      {searchOpen && (
        <div className="fixed inset-0 z-[9000] bg-white flex flex-col">
          <div className="flex items-center gap-2 px-4 h-14 border-b border-gray-100 shrink-0">
            <button onClick={() => setSearchOpen(false)} aria-label="닫기" className="w-9 h-9 flex items-center justify-center text-gray-500 hover:text-gray-900"><Icons.close size={20} /></button>
            <h2 className="text-base font-bold">장소 직접 검색</h2>
          </div>
          <div className="p-4 shrink-0 max-w-md w-full mx-auto">
            <label className="flex items-center gap-2 h-11 px-3 rounded-xl border border-gray-200 bg-gray-50 focus-within:border-gray-900 focus-within:bg-white transition">
              <span className="text-gray-400"><Icons.search size={18} /></span>
              <input autoFocus type="text" value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)} placeholder="가게 이름을 검색하세요" className="w-full bg-transparent outline-none text-sm" />
            </label>
          </div>
          <div className="flex-1 overflow-y-auto px-4 pb-6 max-w-md w-full mx-auto">
            {searchLoading && <p className="text-gray-400 text-[13px] text-center py-6">검색중…</p>}
            {!searchLoading && searchQuery.trim().length >= 2 && searchResults.length === 0 && <p className="text-gray-400 text-[13px] text-center py-6">결과가 없어요.</p>}
            <ul className="divide-y divide-gray-100">
              {searchResults.map((r) => (
                <li key={r.id}>
                  <button onClick={() => handlePickSearchResult(r)} className="w-full flex items-center gap-3 py-3.5 text-left hover:bg-gray-50 -mx-4 px-4 transition">
                    <span className="w-2 h-2 rounded-full shrink-0" style={{ background: CATEGORIES[r.category]?.color || "#111" }} />
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <span className="font-semibold text-[15px] truncate">{r.name}</span>
                        <span className="text-[11px] text-gray-400 shrink-0">{CATEGORIES[r.category]?.label || "기타"}</span>
                      </div>
                      <p className="text-[13px] text-gray-400 truncate mt-0.5">{r.address}</p>
                    </div>
                  </button>
                </li>
              ))}
            </ul>
          </div>
        </div>
      )}

      {/* 상세 시트 */}
      {selectedPlace && (
        <div className="fixed inset-0 z-[9000] flex items-end md:items-center justify-center bg-black/40" onClick={() => setSelectedId(null)}>
          <div className="w-full md:max-w-sm bg-white rounded-t-3xl md:rounded-3xl p-5 pb-8 md:pb-5" onClick={(e) => e.stopPropagation()}>
            <div className="md:hidden w-10 h-1 bg-gray-200 rounded-full mx-auto mb-5" />
            <div className="flex items-start justify-between gap-3 mb-1">
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <span className="w-2 h-2 rounded-full shrink-0" style={{ background: CATEGORIES[selectedPlace.category]?.color || "#111" }} />
                  <span className="text-[12px] text-gray-400">{CATEGORIES[selectedPlace.category]?.label || "기타"}</span>
                </div>
                <h2 className="text-xl font-bold text-gray-900 mt-1 leading-snug">{selectedPlace.name}</h2>
              </div>
              <span className="text-[13px] font-semibold text-gray-900 tabular-nums shrink-0 mt-1">{formatDistance(selectedPlace.distance)}</span>
            </div>
            <p className="text-[13px] text-gray-500 mb-5">{selectedPlace.address}</p>
            <div className="flex flex-col gap-2">
              {selectedPlace.reelUrl && (
                <a href={selectedPlace.reelUrl} target="_blank" rel="noreferrer" className="flex items-center justify-center gap-2 h-12 rounded-xl bg-gray-900 text-white text-sm font-semibold hover:bg-black transition">
                  <Icons.play size={15} /> 저장한 영상 다시 보기
                </a>
              )}
              <div className="grid grid-cols-2 gap-2">
                <a href={`https://map.naver.com/v5/search/${encodeURIComponent(selectedPlace.name)}`} target="_blank" rel="noreferrer" className="flex items-center justify-center h-12 rounded-xl border border-gray-200 text-sm font-semibold text-gray-900 hover:bg-gray-50 transition">네이버 지도</a>
                <a href={`https://map.kakao.com/link/search/${encodeURIComponent(selectedPlace.name)}`} target="_blank" rel="noreferrer" className="flex items-center justify-center h-12 rounded-xl border border-gray-200 text-sm font-semibold text-gray-900 hover:bg-gray-50 transition">카카오맵</a>
              </div>
              <div className="flex items-center justify-between pt-1">
                <button onClick={() => handleDelete(selectedPlace.id)} className="flex items-center gap-1.5 text-[13px] text-gray-400 hover:text-red-500 transition px-1 py-2"><Icons.trash size={15} /> 삭제</button>
                <button onClick={() => setSelectedId(null)} className="text-[13px] font-medium text-gray-500 hover:text-gray-900 px-1 py-2">닫기</button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
