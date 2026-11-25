// RaatPharmacy — night pharmacy finder for Dhaka.
// Plain static site: data lives in data/pharmacies.json, nothing is
// invented. "Open now" is computed from the visitor's own clock.
// Corrections a visitor reports are stored only in their own browser
// (localStorage) and shown as "not yet verified" — listed hours are
// never silently changed. The toast says so honestly, and offers a
// real "tell the team" link (mailto) instead of pretending it was sent.

const CORRECTIONS_KEY = 'raatpharmacy-corrections-v1';
const LANG_KEY = 'raatpharmacy-lang';
const DATA_SAVED_KEY = 'raatpharmacy-data-saved-at';
const TEAM_EMAIL = 'gmking147@gmail.com';

// ---------- time helpers (pure, unit-testable) ----------
// "HH:MM" (24h) -> minutes since midnight. "24:00" -> 1440.
function toMinutes(hhmm) {
  const [h, m] = hhmm.split(':').map(Number);
  return h * 60 + m;
}

// Is this pharmacy open at `nowMin` (minutes since midnight)?
// Returns true / false / null (null = hours not confirmed).
function isOpenAt(p, nowMin) {
  if (p.hours24) return true;
  if (!p.open || !p.close) return null;
  const open = toMinutes(p.open);
  const close = toMinutes(p.close);
  if (close > open) return nowMin >= open && nowMin < close;
  if (close === 0) return nowMin >= open; // closes at midnight
  return nowMin >= open || nowMin < close; // overnight, e.g. 08:00-01:30
}

// "Open past midnight" for the late-night filter: 24h, or closes after
// midnight (00:30 / 01:00 / 01:30 / 03:00), or opens at midnight.
function isLateNight(p) {
  if (p.hours24) return true;
  if (!p.open || !p.close) return false;
  const open = toMinutes(p.open);
  const close = toMinutes(p.close);
  if (open === 0) return true;
  return close <= open && close > 0 && close <= 210;
}

// Minutes until the pharmacy closes (if open) or opens (if closed).
// Returns { kind: 'closes' | 'opens', mins } or null (24h / unknown).
function minutesUntil(p, nowMin) {
  if (p.hours24) return null;
  if (!p.open || !p.close) return null;
  const open = toMinutes(p.open);
  const close = toMinutes(p.close);
  if (isOpenAt(p, nowMin) === true) {
    let mins;
    if (close > open) mins = close - nowMin;
    else if (nowMin >= open) mins = (1440 - nowMin) + close; // overnight
    else mins = close - nowMin; // after midnight, still open
    return { kind: 'closes', mins };
  }
  // Closed: next opening.
  let mins;
  if (close > open) mins = nowMin < open ? open - nowMin : (1440 - nowMin) + open;
  else mins = open - nowMin; // overnight schedule, closed between close and open
  if (mins <= 0) mins += 1440;
  return { kind: 'opens', mins };
}

// Effective closing time for "closes latest" sorting: 24h first, then
// overnight closes count after midnight (e.g. 01:30 -> 25:30).
function effectiveClose(p) {
  if (p.hours24) return 2880;
  if (!p.open || !p.close) return -1;
  const open = toMinutes(p.open);
  const close = toMinutes(p.close);
  return close <= open && close > 0 ? close + 1440 : close;
}

// Haversine distance in km between two lat/lng points.
function haversineKm(lat1, lng1, lat2, lng2) {
  const R = 6371;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLng = (lng2 - lng1) * Math.PI / 180;
  const a = Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
    Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

// Bangla day-part label by 24h hour — never "AM -> রাত".
// 4–5:59 ভোর, 6–11:59 সকাল, 12–15:59 দুপুর, 16–17:59 বিকাল,
// 18–19:59 সন্ধ্যা, 20–23:59 রাত, 0–3:59 রাত.
function bnDayPart(h24) {
  if (h24 >= 4 && h24 < 6) return 'ভোর';
  if (h24 >= 6 && h24 < 12) return 'সকাল';
  if (h24 >= 12 && h24 < 16) return 'দুপুর';
  if (h24 >= 16 && h24 < 18) return 'বিকাল';
  if (h24 >= 18 && h24 < 20) return 'সন্ধ্যা';
  return 'রাত';
}

// "8:30 সকাল" / "11:45 রাত" style display for a "HH:MM" value.
// "24:00" -> "12:00 রাত" (bn) / "12:00 AM" (en).
function formatTime(hhmm, lang) {
  let [h, m] = hhmm.split(':').map(Number);
  if (h === 24) h = 0;
  const h12 = h % 12 === 0 ? 12 : h % 12;
  const mm = String(m).padStart(2, '0');
  if (lang === 'bn') {
    return `${bnDigits(h12)}:${bnDigits(mm)} ${bnDayPart(h)}`;
  }
  const ampm = h < 12 ? 'AM' : 'PM';
  return `${h12}:${mm} ${ampm}`;
}

function bnDigits(s) {
  return String(s).replace(/[0-9]/g, d => '০১২৩৪৫৬৭৮৯'[Number(d)]);
}
function num(n, lang) {
  return lang === 'bn' ? bnDigits(n) : String(n);
}

// "2h 5m" / "২ ঘণ্টা ৫ মিনিট" style duration.
function formatDuration(mins, lang) {
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  if (lang === 'bn') {
    if (h === 0) return `${bnDigits(m)} মিনিট`;
    if (m === 0) return `${bnDigits(h)} ঘণ্টা`;
    return `${bnDigits(h)} ঘণ্টা ${bnDigits(m)} মিনিট`;
  }
  if (h === 0) return `${m}m`;
  if (m === 0) return `${h}h`;
  return `${h}h ${m}m`;
}

function formatDistance(km, lang) {
  const v = km < 10 ? km.toFixed(1) : String(Math.round(km));
  return lang === 'bn' ? `${bnDigits(v)} কিমি` : `${v} km`;
}

// Next transition text: "Closes at 1:30 AM" or "Opens at 8:00 AM".
// 24h pharmacies already state it in the hours line, so no repeat.
function nextLine(p, nowMin, lang, t) {
  if (p.hours24) return '';
  if (!p.open || !p.close) return '';
  const open = isOpenAt(p, nowMin);
  if (open) return `${t.closesAt} ${formatTime(p.close, lang)}`;
  return `${t.opensAt} ${formatTime(p.open, lang)}`;
}

// ---------- i18n ----------
const I18N = {
  bn: {
    skipLink: 'মূল বিষয়বস্তুতে যান',
    pitch: 'রাতে খোলা ফার্মেসি খুঁজুন — সময়, ফোন, দিকনির্দেশনা এক ট্যাপে।',
    heroTitle: 'আজ রাতে খোলা ফার্মেসি',
    heroSub: 'ঢাকায় এখন কোন ফার্মেসি খোলা আছে — এক নজরে দেখে নিন, তারপর কল করুন।',
    filtersTitle: 'খুঁজে নিন',
    sortLabel: 'সাজান',
    sortRecommended: 'সেরা মিল প্রথমে',
    sortLatest: 'দেরিতে বন্ধ হয় যেগুলো',
    sortName: 'নাম অনুযায়ী',
    sortNearest: 'সবচেয়ে কাছে প্রথমে',
    clearFilters: 'ফিল্টার মুছে ফেলুন',
    nearestBtn: 'সবচেয়ে কাছে',
    nearestOn: 'সবচেয়ে কাছে সাজানো হচ্ছে',
    nearestDenied: 'অবস্থান পাওয়া যায়নি — লোকেশন অনুমতি দিলে কাছের ফার্মেসি দেখাবে।',
    nearestUnsupported: 'এই ব্রাউজারে লোকেশন কাজ করে না।',
    nearestNoCoords: 'কোনো ফার্মেসির যাচাই করা অবস্থান এখনো নেই — দূরত্ব দেখানো যাচ্ছে না।',
    statTotal: 'ফার্মেসি', statOpen: 'এখন খোলা', statLate: 'রাত ১২টার পরেও খোলা',
    stockNote: 'স্টকের তথ্য লাইভ নয় — যাওয়ার আগে ফোন করে ওষুধ আছে কিনা জেনে নিন।',
    searchPlaceholder: 'ফার্মেসি, এলাকা বা ঠিকানা লিখুন…',
    area: 'এলাকা', allAreas: 'সব এলাকা',
    openNow: 'এখন খোলা', closed: 'বন্ধ', hoursUnknown: 'সময় নিশ্চিত নয়',
    open24: 'সারারাত খোলা — ২৪ ঘণ্টা',
    closesAt: 'বন্ধ হবে', opensAt: 'খুলবে',
    closesIn: mins => `বন্ধ হতে বাকি ${formatDuration(mins, 'bn')}`,
    opensIn: mins => `খুলতে বাকি ${formatDuration(mins, 'bn')}`,
    closingSoon: 'শীঘ্রই বন্ধ হবে — এখনই কল করুন',
    lateBadge: 'রাত ১২টার পরেও খোলা',
    call: 'কল করুন', whatsapp: 'WhatsApp', directions: 'দিকনির্দেশনা',
    share: 'শেয়ার করুন',
    phoneNotListed: 'ফোন নম্বর তালিকায় নেই',
    phoneUnverified: 'অযাচাইকৃত',
    phoneUnverifiedNote: 'এই নম্বরটি যাচাই হয়নি — কল করার আগে দেখে নিন।',
    confirmStock: 'ফোন করে স্টক নিশ্চিত করুন — ওষুধের মজুদ লাইভ দেখানো হয় না।',
    verifiedOn: 'যাচাই:',
    sourceOfficial: 'অফিসিয়াল', sourceDirectory: 'ডিরেক্টরি', sourceHospital: 'হাসপাতাল',
    hoursWrong: 'সময় ভুল মনে হচ্ছে?',
    correctionReported: 'সংশোধন জানানো হয়েছে — যাচাই হয়নি',
    results: (n, total) => `${num(total, 'bn')}টির মধ্যে ${num(n, 'bn')}টি দেখাচ্ছে`,
    empty: 'কোনো ফার্মেসি মেলেনি — খোঁজ বা ফিল্টার বদলে দেখুন।',
    emptyReset: 'সব ফিল্টার মুছুন',
    loading: 'তালিকা লোড হচ্ছে…',
    loadError: 'তালিকা আনা যায়নি — নেটওয়ার্ক দেখে আবার চেষ্টা করুন।',
    retry: 'আবার চেষ্টা করুন',
    offlineNote: savedAt => `আপনি অফলাইনে আছেন — সর্বশেষ সেভ করা তালিকা দেখাচ্ছেন (${savedAt})।`,
    aboutTitle: 'তথ্য যাচাই নিয়ে',
    aboutText: 'সব ফোন নম্বর, ঠিকানা ও সময় প্রকাশিত উৎস থেকে যাচাই করা — ২৫ নভেম্বর ২০২৬। কোনো নম্বর বা সময় বানানো হয়নি। যেখানে যাচাই করা যায়নি, সেখানে “নিশ্চিত নয়” লেখা আছে। সময় বদলাতে পারে, তাই যাওয়ার আগে ফোন করে নিন।',
    aboutSources: 'উৎস: Islamia Pharmacy (অফিসিয়াল সাইট), Lazz Pharma, Tamanna Pharmacy, হাসপাতাল ফার্মেসি, প্রকাশিত ডিরেক্টরি। পুরো তালিকা ও উৎস GitHub রিপোতে আছে।',
    footer: 'RaatPharmacy — Arohon Build for Bangladesh। জরুরি অবস্থায় ৯৯৯-এ কল করুন।',
    sheetTitle: 'সময় ভুল মনে হচ্ছে?',
    sheetLabel: 'সঠিক সময়টা লিখুন (ঐচ্ছিক)',
    sheetPlaceholder: 'যেমন: এখন রাত ১১টায় বন্ধ হয়',
    cancel: 'বাতিল', submit: 'জানান',
    sheetNote: 'আপনার জানানো তথ্য শুধু আপনার ব্রাউজারেই থাকবে, তালিকার সময় বদলাবে না — যাচাই না হওয়া পর্যন্ত “যাচাই হয়নি” হিসেবে দেখাবে। টিমকে সত্যিই জানাতে চাইলে মেইল করুন।',
    toastSaved: 'আপনার ব্রাউজারে সেভ হয়েছে — টিম এখনো জানে না।',
    tellTeam: 'টিমকে জানান',
    shareCopied: 'লিংক কপি হয়েছে।',
    langButton: 'English',
    clockSuffix: '',
  },
  en: {
    skipLink: 'Skip to main content',
    pitch: 'Find an open pharmacy near you at night — hours, phone, directions in one tap.',
    heroTitle: 'Open pharmacies tonight',
    heroSub: 'See which Dhaka pharmacies are open right now — then call ahead.',
    filtersTitle: 'Refine',
    sortLabel: 'Sort by',
    sortRecommended: 'Best match first',
    sortLatest: 'Closes latest',
    sortName: 'Name A–Z',
    sortNearest: 'Nearest first',
    clearFilters: 'Clear filters',
    nearestBtn: 'Nearest',
    nearestOn: 'Sorted by nearest',
    nearestDenied: 'Location not available — allow location access to see the nearest pharmacies.',
    nearestUnsupported: 'Location is not supported in this browser.',
    nearestNoCoords: 'No pharmacy has a verified location yet — distances cannot be shown.',
    statTotal: 'pharmacies', statOpen: 'open now', statLate: 'open past midnight',
    stockNote: 'Stock is not live — call ahead to confirm the medicine is in stock.',
    searchPlaceholder: 'Search pharmacy, area or address…',
    area: 'Area', allAreas: 'All areas',
    openNow: 'Open now', closed: 'Closed', hoursUnknown: 'Hours not confirmed',
    open24: 'Open all night — 24 hours',
    closesAt: 'Closes at', opensAt: 'Opens at',
    closesIn: mins => `Closes in ${formatDuration(mins, 'en')}`,
    opensIn: mins => `Opens in ${formatDuration(mins, 'en')}`,
    closingSoon: 'Closing soon — call now',
    lateBadge: 'Open past midnight',
    call: 'Call', whatsapp: 'WhatsApp', directions: 'Directions',
    share: 'Share',
    phoneNotListed: 'Phone not listed',
    phoneUnverified: 'Unverified',
    phoneUnverifiedNote: 'This number is not verified — double-check before calling.',
    confirmStock: 'Call to confirm stock — medicine stock is not shown live.',
    verifiedOn: 'Verified:',
    sourceOfficial: 'Official', sourceDirectory: 'Directory', sourceHospital: 'Hospital',
    hoursWrong: 'Hours wrong?',
    correctionReported: 'Correction reported — not yet verified',
    results: (n, total) => `Showing ${n} of ${total}`,
    empty: 'No pharmacy matched — try a different search or filter.',
    emptyReset: 'Clear all filters',
    loading: 'Loading list…',
    loadError: 'Could not load the list — check your network and try again.',
    retry: 'Try again',
    offlineNote: savedAt => `You are offline — showing the last saved list (${savedAt}).`,
    aboutTitle: 'About the data',
    aboutText: 'Every phone number, address and opening-hours value was verified from a published source — 25 Nov 2026. Nothing was invented. Where it could not be verified, it says “not confirmed”. Hours can change, so call ahead before going.',
    aboutSources: 'Sources: Islamia Pharmacy (official site), Lazz Pharma, Tamanna Pharmacy, hospital pharmacies, published directories. The full list and sources are in the GitHub repo.',
    footer: 'RaatPharmacy — Arohon Build for Bangladesh. In an emergency, call 999.',
    sheetTitle: 'Hours look wrong?',
    sheetLabel: 'Write the correct hours (optional)',
    sheetPlaceholder: 'e.g. now closes at 11 PM',
    cancel: 'Cancel', submit: 'Report',
    sheetNote: 'What you report stays only in your browser; the listed hours will not change — it will show as “not yet verified” until checked. To really tell the team, send an email.',
    toastSaved: 'Saved in your browser — the team has not been told yet.',
    tellTeam: 'Tell the team',
    shareCopied: 'Link copied.',
    langButton: 'বাংলা',
    clockSuffix: '',
  },
};

const AREA_BN = {
  Gulshan: 'গুলশান', Banani: 'বনানী', Bashundhara: 'বসুন্ধরা', Narsingdi: 'নরসিংদী',
  Panthapath: 'পান্থপথ', Rampura: 'রামপুরা', Shahbagh: 'শাহবাগ', Mirpur: 'মিরপুর',
  Dhanmondi: 'ধানমন্ডি', Mohammadpur: 'মোহাম্মদপুর', Uttara: 'উত্তরা', Khilgaon: 'খিলগাঁও',
  Kakrail: 'কাকরাইল', Shyamoli: 'শ্যামলী', Kalabagan: 'কলাবাগান', Pallabi: 'পল্লবী',
  Jatrabari: 'যাত্রাবাড়ী', Lalbagh: 'লালবাগ', Moghbazar: 'মগবাজার', Bashabo: 'বাসাবো',
  Malibagh: 'মালিবাগ',
};
function areaLabel(area, lang) {
  return lang === 'bn' ? (AREA_BN[area] || area) : area;
}
function sourceTierLabel(tier, lang) {
  const t = I18N[lang];
  if (tier === 'official') return t.sourceOfficial;
  if (tier === 'hospital') return t.sourceHospital;
  return t.sourceDirectory;
}

// ---------- state ----------
let pharmacies = [];
let lang = 'bn';
let corrections = {};
try { corrections = JSON.parse(localStorage.getItem(CORRECTIONS_KEY) || '{}'); } catch (e) { corrections = {}; }
try {
  const savedLang = localStorage.getItem(LANG_KEY);
  if (savedLang === 'bn' || savedLang === 'en') lang = savedLang;
} catch (e) { /* storage unavailable: keep default */ }

function loadCorrections() {
  try { return JSON.parse(localStorage.getItem(CORRECTIONS_KEY) || '{}'); } catch (e) { return {}; }
}
function saveCorrection(id, text) {
  const c = loadCorrections();
  c[id] = { text: text || '', at: new Date().toISOString() };
  localStorage.setItem(CORRECTIONS_KEY, JSON.stringify(c));
  corrections = c;
}

function nowMinutes() {
  const d = new Date();
  return d.getHours() * 60 + d.getMinutes();
}
function clockText() {
  const d = new Date();
  let h = d.getHours();
  const ampm = h < 12 ? 'AM' : 'PM';
  const h12 = h % 12 === 0 ? 12 : h % 12;
  const mm = String(d.getMinutes()).padStart(2, '0');
  const time = `${h12}:${mm} ${ampm}`;
  return lang === 'bn' ? `${bnDigits(time)} • ঢাকা` : `${time} • Dhaka`;
}

// ---------- filtering / sorting ----------
function matchesQuery(p, q) {
  if (!q) return true;
  // Include the Bangla area name so Bangla search terms match too.
  const hay = `${p.name} ${p.chain} ${p.area} ${areaLabel(p.area, 'bn')} ${p.address}`.toLowerCase();
  return hay.includes(q.toLowerCase());
}
function distanceTo(p, loc) {
  if (!loc || p.lat == null || p.lng == null) return null;
  return haversineKm(loc.lat, loc.lng, p.lat, p.lng);
}
function filteredList(state) {
  const now = nowMinutes();
  let list = pharmacies.filter(p => {
    if (state.area !== 'all' && p.area !== state.area) return false;
    if (!matchesQuery(p, state.q)) return false;
    if (state.openNow && isOpenAt(p, now) !== true) return false;
    if (state.late && !isLateNight(p)) return false;
    return true;
  });
  if (state.sort === 'name') {
    list.sort((a, b) => a.name.localeCompare(b.name));
  } else if (state.sort === 'latest') {
    list.sort((a, b) => effectiveClose(b) - effectiveClose(a) || a.name.localeCompare(b.name));
  } else if (state.sort === 'nearest' && state.userLoc) {
    list.sort((a, b) => {
      const da = distanceTo(a, state.userLoc);
      const db = distanceTo(b, state.userLoc);
      if (da == null && db == null) return a.name.localeCompare(b.name);
      if (da == null) return 1;
      if (db == null) return -1;
      return da - db || a.name.localeCompare(b.name);
    });
  } else {
    // Recommended: open now first, then late-night first, then name A–Z.
    list.sort((a, b) => {
      const oa = isOpenAt(a, now) === true ? 0 : 1;
      const ob = isOpenAt(b, now) === true ? 0 : 1;
      if (oa !== ob) return oa - ob;
      const la = isLateNight(a) ? 0 : 1;
      const lb = isLateNight(b) ? 0 : 1;
      if (la !== lb) return la - lb;
      return a.name.localeCompare(b.name);
    });
  }
  return list;
}

// ---------- URL state (shareable) ----------
function syncUrl() {
  const params = new URLSearchParams();
  if (state.q) params.set('q', state.q);
  if (state.area !== 'all') params.set('area', state.area);
  if (state.openNow) params.set('open', '1');
  if (state.late) params.set('late', '1');
  if (state.sort !== 'recommended') params.set('sort', state.sort);
  const qs = params.toString();
  const hash = location.hash || '';
  const url = location.pathname + (qs ? '?' + qs : '') + hash;
  history.replaceState(null, '', url);
}
function readUrlState() {
  const params = new URLSearchParams(location.search);
  if (params.get('q')) state.q = params.get('q');
  const area = params.get('area');
  if (area) state.area = area;
  if (params.get('open') === '1') state.openNow = true;
  if (params.get('late') === '1') state.late = true;
  const sort = params.get('sort');
  if (sort === 'name' || sort === 'latest') state.sort = sort;
}

// ---------- rendering ----------
const ICON_PHONE = '<svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M22 16.9v3a2 2 0 0 1-2.2 2 19.8 19.8 0 0 1-8.6-3.1 19.5 19.5 0 0 1-6-6A19.8 19.8 0 0 1 2.1 4.2 2 2 0 0 1 4.1 2h3a2 2 0 0 1 2 1.7c.13.96.36 1.9.7 2.8a2 2 0 0 1-.45 2.1L8.1 9.9a16 16 0 0 0 6 6l1.3-1.3a2 2 0 0 1 2.1-.45c.9.34 1.84.57 2.8.7A2 2 0 0 1 22 16.9z"/></svg>';
const ICON_CHAT = '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 11.5a8.5 8.5 0 0 1-8.5 8.5c-1.5 0-3-.4-4.2-1.1L3 20l1.1-5.3A8.5 8.5 0 1 1 21 11.5z"/></svg>';
const ICON_COMPASS = '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="10"/><polygon points="16.2 7.8 14.1 14.1 7.8 16.2 9.9 9.9 16.2 7.8"/></svg>';
const ICON_MOON = '<svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20.6 14.2A8.8 8.8 0 0 1 9.8 3.4 8.8 8.8 0 1 0 20.6 14.2Z"/></svg>';
const ICON_SHARE = '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><path d="m8.6 13.5 6.8 4M15.4 6.5l-6.8 4"/></svg>';

function el(html) {
  const t = document.createElement('template');
  t.innerHTML = html.trim();
  return t.content.firstElementChild;
}
function esc(s) {
  return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function statusBadge(p, t, now) {
  const open = isOpenAt(p, now);
  if (open === true) return `<span class="badge badge-open"><span class="dot" aria-hidden="true"></span>${esc(t.openNow)}</span>`;
  if (open === false) return `<span class="badge badge-closed"><span class="dot" aria-hidden="true"></span>${esc(t.closed)}</span>`;
  return `<span class="badge badge-unknown">${esc(t.hoursUnknown)}</span>`;
}

function cardHtml(p, t) {
  const now = nowMinutes();
  const open = isOpenAt(p, now);
  // All data strings (names, addresses, hours, notes, sources) are
  // English; when the page is Bangla, mark them lang="en" so screen
  // readers pronounce them correctly.
  const en = lang === 'bn' ? ' lang="en"' : '';
  const badge = statusBadge(p, t, now);
  const late = isLateNight(p) ? `<span class="badge badge-late">${ICON_MOON}${esc(t.lateBadge)}</span>` : '';
  const hoursLine = p.hours24
    ? `<p class="hours-line"><strong>${esc(t.open24)}</strong></p>`
    : p.hoursText
      ? `<p class="hours-line"><strong${en}>${esc(p.hoursText)}</strong></p>`
      : `<p class="hours-line">${esc(t.hoursUnknown)}</p>`;
  const next = nextLine(p, now, lang, t);
  const until = minutesUntil(p, now);
  let countdown = '';
  if (until && until.kind === 'closes') {
    const soon = until.mins <= 90;
    countdown = `<p class="countdown${soon ? ' countdown-soon' : ''}">${esc(soon ? t.closingSoon : t.closesIn(until.mins))}</p>`;
  } else if (until && until.kind === 'opens') {
    countdown = `<p class="countdown">${esc(t.opensIn(until.mins))}</p>`;
  }
  const dist = distanceTo(p, state.userLoc);
  const distLine = (state.nearest && dist != null)
    ? `<p class="distance">${esc(formatDistance(dist, lang))}</p>` : '';
  // Phone: shown as plain text (not a second link). One primary Call
  // button only. WhatsApp only when the number is verified as a mobile.
  const phoneVerified = p.phoneVerified !== false;
  const phoneBlock = p.phone
    ? `<p class="phone-line"><span class="phone-text"${en}>${esc(p.phoneDisplay)}</span>${phoneVerified ? '' : ` <span class="badge badge-unverified">${esc(t.phoneUnverified)}</span>`}</p>${phoneVerified ? '' : `<p class="unverified-note">${esc(t.phoneUnverifiedNote)}</p>`}`
    : `<p class="phone-line">${esc(t.phoneNotListed)}</p>`;
  const tel = p.phone ? p.phone.replace(/[\s-]/g, '') : '';
  const callBtn = p.phone
    ? `<a class="btn btn-call" href="tel:${esc(tel)}">${ICON_PHONE}${esc(t.call)}</a>` : '';
  const waBtn = (p.whatsapp && p.whatsappVerified !== false && p.phone)
    ? `<a class="btn btn-icon btn-wa" href="https://wa.me/${esc(p.phone.replace(/^\+/, '').replace(/[\s-]/g, ''))}" target="_blank" rel="noopener" aria-label="${esc(t.whatsapp)}" title="${esc(t.whatsapp)}">${ICON_CHAT}</a>` : '';
  const dirHref = (p.lat != null && p.lng != null)
    ? `https://www.google.com/maps/dir/?api=1&destination=${p.lat},${p.lng}`
    : `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(p.name + ', ' + p.address)}`;
  const dirBtn = `<a class="btn btn-icon btn-ghost" href="${dirHref}" target="_blank" rel="noopener" aria-label="${esc(t.directions)}" title="${esc(t.directions)}">${ICON_COMPASS}</a>`;
  const shareBtn = `<button class="btn btn-icon btn-ghost" type="button" data-share="${esc(p.id)}" aria-label="${esc(t.share)}" title="${esc(t.share)}">${ICON_SHARE}</button>`;
  const corr = corrections[p.id];
  const corrBadge = corr
    ? `<p class="correction-badge">${esc(t.correctionReported)}${corr.text ? ` — “${esc(corr.text)}”` : ''}</p>` : '';
  const notes = p.notes ? `<p class="notes"${en}>${esc(p.notes)}</p>` : '';
  const tier = p.sourceTier ? `<span class="tier-badge">${esc(sourceTierLabel(p.sourceTier, lang))}</span>` : '';
  return `
    <li class="card${open === true ? ' card-open' : ''}" data-id="${esc(p.id)}">
      <div class="card-head">
        <div>
          <h3${en}>${esc(p.name)}</h3>
          <p class="area">${esc(areaLabel(p.area, lang))} • <span${en}>${esc(p.chain)}</span></p>
        </div>
        <div class="card-badges">${badge}${late}</div>
      </div>
      ${hoursLine}
      ${next ? `<p class="next-line">${esc(next)}</p>` : ''}
      ${countdown}
      ${distLine}
      <p class="address"${en}>${esc(p.address)}</p>
      <div class="actions">${callBtn}${waBtn}${dirBtn}${shareBtn}</div>
      ${phoneBlock}
      <p class="meta-line">${esc(t.confirmStock)}</p>
      <p class="meta-line">${esc(t.verifiedOn)} ${esc(p.lastVerified)} • <span${en}>${esc(p.source)}</span> ${tier}</p>
      ${notes}
      ${corrBadge}
      <button class="link-btn" type="button" data-correct="${esc(p.id)}">${esc(t.hoursWrong)}</button>
    </li>`;
}

// Focus bookkeeping: remember where focus was before a re-render so it
// can be put back on the equivalent element afterwards.
function captureFocus() {
  const a = document.activeElement;
  if (!a || a === document.body) return null;
  if (a.id) return { byId: a.id, selStart: a.selectionStart, selEnd: a.selectionEnd };
  const correct = a.getAttribute && a.getAttribute('data-correct');
  if (correct) return { byAttr: 'data-correct', val: correct };
  const share = a.getAttribute && a.getAttribute('data-share');
  if (share) return { byAttr: 'data-share', val: share };
  return null;
}
function restoreFocus(desc) {
  if (!desc) return;
  let target = null;
  if (desc.byId) target = document.getElementById(desc.byId);
  else if (desc.byAttr) target = document.querySelector(`[${desc.byAttr}="${desc.val}"]`);
  if (target && typeof target.focus === 'function') {
    target.focus({ preventScroll: true });
    if (desc.selStart != null && target.setSelectionRange) {
      try { target.setSelectionRange(desc.selStart, desc.selEnd); } catch (e) { /* not a text field */ }
    }
  }
}

let areaOptionsSig = '';
function render(opts) {
  const announce = !!(opts && opts.announce);
  const focusDesc = captureFocus();
  const t = I18N[lang];
  document.documentElement.lang = lang;
  document.getElementById('skipLink').textContent = t.skipLink;
  document.getElementById('pitch').textContent = t.pitch;
  document.getElementById('heroTitle').textContent = t.heroTitle;
  document.getElementById('heroSub').textContent = t.heroSub;
  document.getElementById('filtersTitle').textContent = t.filtersTitle;
  document.getElementById('sortLabel').textContent = t.sortLabel;
  document.getElementById('sortRecommended').textContent = t.sortRecommended;
  document.getElementById('sortLatest').textContent = t.sortLatest;
  document.getElementById('sortName').textContent = t.sortName;
  const sortNearestOpt = document.getElementById('sortNearest');
  if (sortNearestOpt) sortNearestOpt.textContent = t.sortNearest;
  document.getElementById('clearFilters').textContent = t.clearFilters;
  document.getElementById('emptyText').textContent = t.empty;
  document.getElementById('emptyReset').textContent = t.emptyReset;
  document.getElementById('nearestBtn').textContent = t.nearestBtn;
  document.getElementById('stockNote').textContent = t.stockNote;
  document.getElementById('searchInput').placeholder = t.searchPlaceholder;
  document.getElementById('areaLabel').textContent = t.area;
  document.getElementById('aboutTitle').textContent = t.aboutTitle;
  document.getElementById('aboutText').textContent = t.aboutText;
  document.getElementById('aboutSources').textContent = t.aboutSources;
  document.getElementById('footerText').textContent = t.footer;
  document.getElementById('sheetTitle').textContent = t.sheetTitle;
  document.getElementById('correctLabel').textContent = t.sheetLabel;
  document.getElementById('correctInput').placeholder = t.sheetPlaceholder;
  document.getElementById('cancelCorrect').textContent = t.cancel;
  document.getElementById('submitCorrect').textContent = t.submit;
  document.getElementById('sheetNote').textContent = t.sheetNote;
  document.getElementById('langToggle').textContent = t.langButton;
  document.getElementById('clock').textContent = clockText();

  const now = nowMinutes();
  const openCount = pharmacies.filter(p => isOpenAt(p, now) === true).length;
  const lateCount = pharmacies.filter(isLateNight).length;
  document.getElementById('statTotal').textContent = num(pharmacies.length, lang);
  document.getElementById('statTotalLabel').textContent = t.statTotal;
  document.getElementById('statOpen').textContent = num(openCount, lang);
  document.getElementById('statOpenLabel').textContent = t.statOpen;
  document.getElementById('statLate').textContent = num(lateCount, lang);
  document.getElementById('statLateLabel').textContent = t.statLate;

  // Stat chips reflect the active filter.
  document.getElementById('statChipAll').setAttribute('aria-pressed', String(!state.openNow && !state.late));
  document.getElementById('statChipOpen').setAttribute('aria-pressed', String(state.openNow));
  document.getElementById('statChipLate').setAttribute('aria-pressed', String(state.late));
  document.getElementById('nearestBtn').setAttribute('aria-pressed', String(state.nearest));

  // Area options: rebuild only when the set of areas or language changes,
  // so focus inside the select is never destroyed by a re-render.
  const areas = [...new Set(pharmacies.map(p => p.area))].sort();
  const sig = lang + '|' + areas.join(',');
  if (sig !== areaOptionsSig) {
    areaOptionsSig = sig;
    const areaSel = document.getElementById('areaFilter');
    areaSel.innerHTML = `<option value="all">${esc(t.allAreas)}</option>` +
      areas.map(a => `<option value="${esc(a)}">${esc(areaLabel(a, lang))}</option>`).join('');
  }
  const areaSel = document.getElementById('areaFilter');
  // Normalise the area from the URL case-insensitively (?area=banani
  // must match the "Banani" option) once the area list is known.
  if (state.area !== 'all') {
    const match = areas.find(a => a.toLowerCase() === String(state.area).toLowerCase());
    if (match) state.area = match;
  }
  if (areas.includes(state.area)) areaSel.value = state.area;
  else { areaSel.value = 'all'; state.area = 'all'; }

  // "Nearest" sort option exists only once a location is known.
  const sortSel = document.getElementById('sortSelect');
  if (state.userLoc && !document.getElementById('sortNearest')) {
    const opt = document.createElement('option');
    opt.id = 'sortNearest'; opt.value = 'nearest'; opt.textContent = t.sortNearest;
    sortSel.appendChild(opt);
  }
  sortSel.value = state.sort;

  // Clear-filters is only usable when something is actually filtered.
  const hasFilter = state.q !== '' || state.area !== 'all' || state.openNow ||
    state.late || state.sort !== 'recommended' || state.nearest;
  const clearBtn = document.getElementById('clearFilters');
  clearBtn.disabled = !hasFilter;
  clearBtn.classList.toggle('hidden', !hasFilter);

  const list = filteredList(state);
  renderList(list, t);

  // The result count is an aria-live region: update it ONLY for user
  // actions (search/filter/sort/language), never on the 60s tick.
  if (announce) {
    document.getElementById('resultCount').textContent = t.results(list.length, pharmacies.length);
  }
  document.getElementById('emptyState').classList.toggle('hidden', list.length > 0);
  document.getElementById('loadingState').classList.add('hidden');
  restoreFocus(focusDesc);
  syncUrl();
}

// Keyed list reconciliation: reuse a card node when its generated HTML
// is unchanged, so focus inside a card survives re-renders.
function renderList(list, t) {
  const ul = document.getElementById('pharmacyList');
  // Skeleton cards (no data-id) are one-shot placeholders: drop them.
  Array.from(ul.children).forEach(li => {
    if (!li.dataset || !li.dataset.id) li.remove();
  });
  const existing = new Map();
  Array.from(ul.children).forEach(li => {
    if (li.dataset && li.dataset.id) existing.set(li.dataset.id, li);
  });
  const seen = new Set();
  const frag = document.createDocumentFragment();
  list.forEach(p => {
    seen.add(p.id);
    const html = cardHtml(p, t);
    let li = existing.get(p.id);
    if (li && li._html === html) {
      // Reuse: move into place, keep focus and DOM state.
    } else {
      li = el(html);
      li._html = html;
    }
    frag.appendChild(li);
  });
  existing.forEach((li, id) => { if (!seen.has(id)) li.remove(); });
  ul.appendChild(frag);
}

// The 60s tick updates ONLY the clock, the stat numbers, and each
// visible card's status badge / next line / countdown — never the whole
// list, never the aria-live result count, so focus is never lost.
function tick() {
  const t = I18N[lang];
  document.getElementById('clock').textContent = clockText();
  if (!pharmacies.length) return;
  const now = nowMinutes();
  const openCount = pharmacies.filter(p => isOpenAt(p, now) === true).length;
  const lateCount = pharmacies.filter(isLateNight).length;
  document.getElementById('statOpen').textContent = num(openCount, lang);
  document.getElementById('statLate').textContent = num(lateCount, lang);
  document.querySelectorAll('#pharmacyList .card').forEach(li => {
    const p = pharmacies.find(x => x.id === li.dataset.id);
    if (!p) return;
    const open = isOpenAt(p, now);
    li.classList.toggle('card-open', open === true);
    const badgeSlot = li.querySelector('.card-badges .badge');
    if (badgeSlot) badgeSlot.outerHTML = statusBadge(p, t, now);
    const nextEl = li.querySelector('.next-line');
    const nextText = nextLine(p, now, lang, t);
    if (nextEl) {
      if (nextText) nextEl.textContent = nextText;
      else nextEl.remove();
    } else if (nextText) {
      const hoursEl = li.querySelector('.hours-line');
      if (hoursEl) hoursEl.insertAdjacentHTML('afterend', `<p class="next-line">${esc(nextText)}</p>`);
    }
    const until = minutesUntil(p, now);
    let cdEl = li.querySelector('.countdown');
    let cdText = '';
    let soon = false;
    if (until && until.kind === 'closes') {
      soon = until.mins <= 90;
      cdText = soon ? t.closingSoon : t.closesIn(until.mins);
    } else if (until && until.kind === 'opens') {
      cdText = t.opensIn(until.mins);
    }
    if (cdText) {
      if (cdEl) { cdEl.textContent = cdText; cdEl.classList.toggle('countdown-soon', soon); }
      else {
        const anchor = li.querySelector('.next-line') || li.querySelector('.hours-line');
        if (anchor) anchor.insertAdjacentHTML('afterend', `<p class="countdown${soon ? ' countdown-soon' : ''}">${esc(cdText)}</p>`);
      }
    } else if (cdEl) cdEl.remove();
  });
}

// Shared filter state (chips, area, sort, search, nearest).
const state = { q: '', area: 'all', openNow: false, late: false, sort: 'recommended', nearest: false, userLoc: null };
function syncStateFromInputs() {
  state.q = document.getElementById('searchInput').value.trim();
  state.area = document.getElementById('areaFilter').value;
  state.sort = document.getElementById('sortSelect').value;
}
function clearFilters() {
  state.q = ''; state.area = 'all'; state.openNow = false; state.late = false;
  state.sort = 'recommended'; state.nearest = false;
  document.getElementById('searchInput').value = '';
  document.getElementById('areaFilter').value = 'all';
  document.getElementById('sortSelect').value = 'recommended';
  render({ announce: true });
}
function debounce(fn, ms) {
  let timer = null;
  return (...args) => {
    clearTimeout(timer);
    timer = setTimeout(() => fn(...args), ms);
  };
}

// ---------- sharing ----------
function pharmacyUrl(p) {
  const params = new URLSearchParams();
  if (state.q) params.set('q', state.q);
  if (state.area !== 'all') params.set('area', state.area);
  if (state.openNow) params.set('open', '1');
  if (state.late) params.set('late', '1');
  if (state.sort !== 'recommended') params.set('sort', state.sort);
  const qs = params.toString();
  return location.origin + location.pathname + (qs ? '?' + qs : '') + '#' + p.id;
}
function copyText(text) {
  if (navigator.clipboard && navigator.clipboard.writeText) {
    return navigator.clipboard.writeText(text);
  }
  return new Promise((resolve, reject) => {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.style.position = 'fixed'; ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    try { document.execCommand('copy'); resolve(); }
    catch (e) { reject(e); }
    document.body.removeChild(ta);
  });
}
function sharePharmacy(p) {
  const url = pharmacyUrl(p);
  const text = `${p.name} — ${I18N[lang].heroTitle}`;
  if (navigator.share) {
    navigator.share({ title: 'RaatPharmacy', text, url }).catch(() => { /* user cancelled */ });
  } else {
    copyText(url).then(() => showToast(I18N[lang].shareCopied)).catch(() => showToast(url));
  }
}
function scrollToHashCard() {
  const id = (location.hash || '').slice(1);
  if (!id) return;
  const li = document.querySelector(`#pharmacyList .card[data-id="${CSS.escape(id)}"]`);
  if (!li) return;
  try { li.scrollIntoView({ block: 'start' }); } catch (e) { /* jsdom / old browsers */ }
  li.classList.add('card-highlight');
  setTimeout(() => li.classList.remove('card-highlight'), 4000);
}

// ---------- correction sheet (focus managed) ----------
let correctingId = null;
let sheetTrigger = null;
let sheetKeyHandler = null;
function focusableInSheet() {
  // The sheet is visible whenever this runs; its input + buttons are the
  // only focusables. (offsetParent is unreliable here: jsdom reports null
  // for everything, and fixed-position ancestors behave inconsistently.)
  return Array.from(document.getElementById('correctSheet')
    .querySelectorAll('input, button'))
    .filter(elm => !elm.disabled);
}
function openSheet(id, trigger) {
  correctingId = id;
  sheetTrigger = trigger || null;
  const p = pharmacies.find(x => x.id === id);
  const sheetPharmacy = document.getElementById('sheetPharmacy');
  sheetPharmacy.textContent = p ? p.name : '';
  // Pharmacy names are English data.
  if (lang === 'bn') sheetPharmacy.setAttribute('lang', 'en');
  else sheetPharmacy.removeAttribute('lang');
  document.getElementById('correctInput').value = '';
  document.getElementById('correctSheet').classList.remove('hidden');
  document.getElementById('sheetBackdrop').classList.remove('hidden');
  // Background inert while the dialog is open.
  ['topbar', 'main', 'footer'].forEach(sel => {
    const node = document.querySelector(sel === 'topbar' ? 'header.topbar' : sel);
    if (node) node.setAttribute('inert', '');
  });
  document.querySelector('header.topbar').setAttribute('aria-hidden', 'true');
  document.getElementById('main').setAttribute('aria-hidden', 'true');
  document.querySelector('footer').setAttribute('aria-hidden', 'true');
  sheetKeyHandler = e => {
    if (e.key === 'Escape') { e.preventDefault(); closeSheet(); return; }
    if (e.key !== 'Tab') return;
    const f = focusableInSheet();
    if (!f.length) return;
    const first = f[0], last = f[f.length - 1];
    if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
  };
  document.getElementById('correctSheet').addEventListener('keydown', sheetKeyHandler);
  document.getElementById('correctInput').focus();
}
function closeSheet() {
  correctingId = null;
  document.getElementById('correctSheet').classList.add('hidden');
  document.getElementById('sheetBackdrop').classList.add('hidden');
  if (sheetKeyHandler) {
    document.getElementById('correctSheet').removeEventListener('keydown', sheetKeyHandler);
    sheetKeyHandler = null;
  }
  document.querySelectorAll('[inert]').forEach(node => node.removeAttribute('inert'));
  document.querySelector('header.topbar').removeAttribute('aria-hidden');
  document.getElementById('main').removeAttribute('aria-hidden');
  document.querySelector('footer').removeAttribute('aria-hidden');
  if (sheetTrigger && typeof sheetTrigger.focus === 'function') {
    sheetTrigger.focus({ preventScroll: true });
  }
  sheetTrigger = null;
}
let toastTimer = null;
function showToast(html, ms) {
  const toast = document.getElementById('toast');
  toast.innerHTML = html;
  toast.classList.remove('hidden');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toast.classList.add('hidden'), ms || 6000);
}
function tellTeamLink(p, text) {
  const subject = `RaatPharmacy সংশোধন: ${p ? p.name : ''}`;
  const body = `ফার্মেসি: ${p ? `${p.name} (${p.address})` : ''}\nসংশোধন: ${text || '(কিছু লেখা হয়নি)'}\n\n— RaatPharmacy থেকে পাঠানো`;
  return `mailto:${TEAM_EMAIL}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
}

// ---------- data loading ----------
function showSkeleton() {
  const ul = document.getElementById('pharmacyList');
  ul.innerHTML = '';
  for (let i = 0; i < 3; i++) {
    ul.appendChild(el('<li class="card skeleton" aria-hidden="true"><div class="sk-line sk-title"></div><div class="sk-line sk-sub"></div><div class="sk-line sk-btn"></div></li>'));
  }
  document.getElementById('loadingState').classList.remove('hidden');
  document.getElementById('errorState').classList.add('hidden');
}
function loadData() {
  showSkeleton();
  return fetch('data/pharmacies.json')
    .then(r => { if (!r.ok) throw new Error('Failed to load data'); return r.json(); })
    .then(d => {
      pharmacies = d.pharmacies || [];
      try { localStorage.setItem(DATA_SAVED_KEY, new Date().toISOString()); } catch (e) { /* ignore */ }
      document.getElementById('errorState').classList.add('hidden');
      render({ announce: true });
      showOfflineNoteIfNeeded();
      scrollToHashCard();
    })
    .catch(() => {
      document.getElementById('pharmacyList').innerHTML = '';
      document.getElementById('loadingState').classList.add('hidden');
      const err = document.getElementById('errorState');
      err.querySelector('.error-text').textContent = I18N[lang].loadError;
      err.querySelector('#retryLoad').textContent = I18N[lang].retry;
      err.classList.remove('hidden');
      showOfflineNoteIfNeeded();
    });
}
function showOfflineNoteIfNeeded() {
  const note = document.getElementById('offlineNote');
  if (!navigator.onLine) {
    let savedAt = '';
    try { savedAt = localStorage.getItem(DATA_SAVED_KEY) || ''; } catch (e) { /* ignore */ }
    if (savedAt) {
      const d = new Date(savedAt);
      const stamp = lang === 'bn'
        ? `${bnDigits(d.getDate())}/${bnDigits(d.getMonth() + 1)}/${bnDigits(d.getFullYear())}, ${bnDigits(String(d.getHours()).padStart(2, '0'))}:${bnDigits(String(d.getMinutes()).padStart(2, '0'))}`
        : d.toLocaleString();
      note.textContent = I18N[lang].offlineNote(stamp);
    } else {
      note.textContent = I18N[lang].offlineNote('');
    }
    note.classList.remove('hidden');
  } else {
    note.classList.add('hidden');
  }
}

// ---------- init ----------
function init() {
  readUrlState();
  // Restore inputs from URL state before first render.
  document.getElementById('searchInput').value = state.q || '';
  document.getElementById('areaFilter').value = state.area || 'all';
  document.getElementById('sortSelect').value = state.sort || 'recommended';

  const debouncedSearch = debounce(() => { syncStateFromInputs(); render({ announce: true }); }, 150);
  document.getElementById('searchInput').addEventListener('input', debouncedSearch);
  document.getElementById('areaFilter').addEventListener('change', () => { syncStateFromInputs(); render({ announce: true }); });
  document.getElementById('sortSelect').addEventListener('change', () => { syncStateFromInputs(); render({ announce: true }); });
  document.getElementById('clearFilters').addEventListener('click', clearFilters);
  document.getElementById('emptyReset').addEventListener('click', clearFilters);
  document.getElementById('retryLoad').addEventListener('click', () => loadData());
  document.getElementById('statChipAll').addEventListener('click', () => { state.openNow = false; state.late = false; render({ announce: true }); });
  document.getElementById('statChipOpen').addEventListener('click', () => { state.openNow = !state.openNow; render({ announce: true }); });
  document.getElementById('statChipLate').addEventListener('click', () => { state.late = !state.late; render({ announce: true }); });
  document.getElementById('nearestBtn').addEventListener('click', () => {
    if (state.nearest) { state.nearest = false; state.sort = 'recommended'; render({ announce: true }); return; }
    if (!('geolocation' in navigator)) { showToast(I18N[lang].nearestUnsupported); return; }
    navigator.geolocation.getCurrentPosition(
      pos => {
        // No verified coordinates exist yet (geocoding found 0/41), so
        // distances cannot be shown — say so instead of sorting silently.
        const anyGeo = pharmacies.some(p => p.lat != null && p.lng != null);
        if (!anyGeo) { showToast(I18N[lang].nearestNoCoords); return; }
        state.userLoc = { lat: pos.coords.latitude, lng: pos.coords.longitude };
        state.nearest = true;
        state.sort = 'nearest';
        render({ announce: true });
      },
      () => showToast(I18N[lang].nearestDenied),
      { timeout: 10000, maximumAge: 300000 }
    );
  });
  document.getElementById('langToggle').addEventListener('click', () => {
    lang = lang === 'bn' ? 'en' : 'bn';
    try { localStorage.setItem(LANG_KEY, lang); } catch (e) { /* ignore */ }
    render({ announce: true });
  });
  document.getElementById('pharmacyList').addEventListener('click', e => {
    const correctBtn = e.target.closest('[data-correct]');
    if (correctBtn) { openSheet(correctBtn.getAttribute('data-correct'), correctBtn); return; }
    const shareBtn = e.target.closest('[data-share]');
    if (shareBtn) {
      const p = pharmacies.find(x => x.id === shareBtn.getAttribute('data-share'));
      if (p) sharePharmacy(p);
    }
  });
  document.getElementById('cancelCorrect').addEventListener('click', closeSheet);
  document.getElementById('sheetBackdrop').addEventListener('click', closeSheet);
  document.getElementById('submitCorrect').addEventListener('click', () => {
    if (!correctingId) return;
    const text = document.getElementById('correctInput').value.trim();
    const p = pharmacies.find(x => x.id === correctingId);
    saveCorrection(correctingId, text);
    closeSheet();
    render({ announce: true });
    // Honest toast: saved only in this browser + a real way to tell the team.
    const t = I18N[lang];
    showToast(`${esc(t.toastSaved)} <a href="${tellTeamLink(p, text)}">${esc(t.tellTeam)} →</a>`, 8000);
  });
  // Clock + open-now status refresh every minute — badges/countdowns only.
  setInterval(tick, 60000);

  // Offline support: register the service worker only if it loads.
  if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
      navigator.serviceWorker.register('sw.js').catch(() => { /* works fine without it */ });
    });
  }
  window.addEventListener('online', showOfflineNoteIfNeeded);
  window.addEventListener('offline', showOfflineNoteIfNeeded);

  loadData();
}

if (typeof document !== 'undefined') {
  document.addEventListener('DOMContentLoaded', init);
}
// Export pure helpers for Node testing.
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { toMinutes, isOpenAt, isLateNight, formatTime, minutesUntil, effectiveClose, formatDuration, haversineKm, bnDayPart };
}
