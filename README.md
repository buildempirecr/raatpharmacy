# RaatPharmacy — Find an Open Pharmacy at Night (Dhaka)

> **One-line pitch:** Find an open pharmacy near you at night — hours, phone, directions in one tap.

**Arohon "Build for Bangladesh" entry.** Submissions close 10 Dec 2026; top two entries win a GTA 6 copy. Submitted 25 Nov 2026 (receipt `01-DDWJFX2`); the live site updates automatically, so later improvements reach the submitted entry without resubmitting.

Live site: https://buildempirecr.github.io/raatpharmacy/
Repo: https://github.com/buildempirecr/raatpharmacy

## The problem

Medicine is needed at night, but nobody knows which pharmacy near them is still open. Opening hours are scattered across websites and listings, and a sick family at 1 AM cannot afford to drive around checking shutters. RaatPharmacy answers one question in seconds: *which pharmacy near me is open right now, and how do I call or reach it?*

## How to run

No build step, no backend, no account. Just serve the folder:

```bash
cd raatpharmacy
python3 -m http.server 8000
# then open http://localhost:8000
```

(Opening `index.html` directly also works for the page itself, but the pharmacy list loads via `fetch`, so a local server is the reliable way.)

## Deploy

**GitHub Pages (live)** — the same files work at a subpath (all local paths are relative):

- Repo Settings → Pages → Deploy from branch → pick the branch and `/` (root) folder.
- The site then lives at `https://<user>.github.io/raatpharmacy/`.

**Vercel** — static site, no build step. `vercel.json` at the repo root enables clean URLs:

```bash
vercel --prod
# or: import the GitHub repo at vercel.com/new — no build command, no output directory needed.
```

## Features

- **94 verified pharmacies** across 41 Dhaka areas (plus one verified Islamia branch in Narsingdi, labelled as outside Dhaka)
- **Search** by pharmacy name, area, address or phone number (Bangla + English; a phone search matches `01677…`, `+8801677…` and the spaced display form alike)
- **Empty search suggests the closest area** — a typo like "gulsan" offers "Did you mean Gulshan?" instead of a dead end
- **"Open now" toggle** — computed live from the visitor's own clock, including overnight hours (e.g. 8:00 AM–1:30 AM counts as open at 1:00 AM) and per-day hours where a source states them (see "Day-based hours" below)
- **"Open past midnight" filter** — 14 pharmacies are open 24 hours
- **"Nearest" sort** — after the visitor taps "Nearest" and shares a location, pharmacies with verified coordinates show their distance ("X.X কিমি") and sort nearest-first; pharmacies without coordinates never show a distance. A one-line note under the button explains before asking that the location is used only for sorting, never sent or stored. A shared `?sort=nearest` link asks for location once on load, and falls back to Recommended if denied.
- **Each card:** name, area, address, hours, "Closes at / Opens at" countdown, phone, big Call button (`tel:`), WhatsApp button (verified mobiles only), Google Maps directions link (exact coordinates when known, otherwise a name+address search), and "last verified" date
- **"Call to confirm stock"** on every card — stock is never claimed live
- **"Hours wrong?"** — a visitor can report a correction; it is saved only in their own browser (`localStorage`) and shown as "Correction reported — not yet verified". Listed hours are never silently changed, and the toast says plainly that the team has not been told yet (with a mail link to tell them)
- **Shareable links** — search, filters and sort live in the URL, and every card has a share button (deep link to that pharmacy). A deep link scrolls to its card even when opened while already on the finder, and if the current filters would hide the card they are cleared so the link always lands.
- **Bangla + English toggle** (default Bangla, remembered), mobile-first, dark night-friendly design, big tap targets (≥44px), keyboard focus kept during typing, dialog with focus trap + Escape
- **Offline** — service worker caches the app shell + data; manifest, skeleton loading and a Bangla error message with retry when the data fails to load

## What is verified vs not verified

- **Verified:** every phone number, address and opening-hours value in `data/pharmacies.json` was copied from a published source listed in that entry's `source` field. All entries carry a `lastVerified` date (25 Nov 2026 for the original 41, 26 Nov 2026 for the 53 added later).
- **Not verified / not listed:** where a phone or hours could not be verified, the field is `null` and the UI says "Phone not listed" / "Hours not confirmed" — never a guess. 2 entries have no listed phone; 33 have unconfirmed hours (mostly Lazz branches — the chain's official list publishes phone + address but no hours).
- **Phone verification:** a number is flagged `phoneVerified: false` when it looks like a placeholder (an ascending/descending run of 5+ digits or 5+ identical digits) — e.g. Care Pharmacy Banani `+8801612345680` contains `123456`, so it is shown unverified with no WhatsApp button. A 4-digit repeat alone does not flag a number: Islamia Habib `+8801763666686` (contains `6666`) stays verified because it is published on the chain's own official site. 86 of the 92 listed phones are verified.
- **Conflicts handled:** where two listings disagreed, the official site was used first for Islamia; for Lazz the bdyellowpages listing was used and the conflict noted in the entry. Tamanna Bashundhara lists "24 hours" in one place and "7 AM–1 AM" on the North South University safety page — the safer 7 AM–1 AM is used, with a note. Popular Diagnostics' official homepage shows head-office hotline `09666 787801`, but the site footer and older directories show `09613 787801` — the homepage number is used and the discrepancy is noted on each Popular entry.
- **Stock:** never shown. The app always tells the visitor to call ahead.

## Day-based hours

Most pharmacies keep the same hours every day. Where a source actually states different hours, the entry carries an `hoursByDay` field and the open-now math, countdown and card display use the correct day — nothing is guessed for Fridays:

- **Bangladesh Pharmacy, Uttara (Chalbon)** — closed on Fridays (`hoursByDay.fri: null`); other days 9 AM–2 PM and 4 PM–12 AM, with a `breaks: [["14:00","16:00"]]` interval so the app never claims it is open at 3 PM.
- **Sadiya Pharmacy, Dakshinkhan** — closed on Fridays; other days 9 AM–9:30 PM.
- **Islamia Pharmacy (all 7 branches)** and **Popular Medicine Corner** — open on Fridays, same hours as other days (confirmed on the official sites).
- **Ramadan hours:** no source stated any, so none are recorded.

## Distances

21 of the 94 pharmacies have verified coordinates (`lat`/`lng`). They were geocoded on 26 Nov 2026 with OpenStreetMap Nominatim and Google Maps place listings, and a point was accepted only when the pharmacy name **and** road/area both matched — no area-centre guesses, no invented points. The other 73 stay without coordinates (no confident match exists in the map data yet). A distance is shown only for pharmacies that have coordinates, and only after the visitor shares a location; the directions link uses `lat,lng` when known, otherwise a name+address search.

## Share preview (SEO)

- Canonical URL, Open Graph tags and a Twitter `summary_large_image` card in `index.html`; `og.png` (1200×630, drawn with Python/PIL from the brand — deep emerald + mint, moon mark, no stock photos, no invented claims).
- JSON-LD `ItemList` in `index.html` — one `Pharmacy` item per entry, with `telephone` only where `phoneVerified` is true and `openingHoursSpecification` only where hours are verified. **If the data changes, regenerate this block too.**

## Blog / guides (SEO)

6 Bangla guides under `blog/`, generated by `blog/build_blog.py` from `data/pharmacies.json` — every listed phone/hours comes from the data, never typed by hand. Each article has a flat illustration in `img/` (clearly labelled as an illustration, never presented as a photo of a real pharmacy) with Bangla alt text, plus a thumbnail on the blog index. The finder links to the guides from its own "গাইড ও টিপস" section after the results — never from the hero, which stays focused on one job: finding an open pharmacy right now.

The site carries its own guides at `/blog/` so Google can find it without any social-media posting. The blog index (`blog/index.html`) lists all guides; the finder links to it from its "গাইড ও টিপস" section after the results, the About section and the footer — never from the hero or the header, which stay focused on finding a pharmacy.

- **6 articles, all in Bangla** (26 Nov 2026): how to find a night pharmacy in Dhaka (pillar page), Gulshan–Banani, Dhanmondi–Mohammadpur, Mirpur–Uttara, what to do when emergency medicine is needed at night, and how to tell whether a pharmacy is open. Each article is 615–729 words of prose plus a pharmacy list rendered from the data.
- **Built, not hand-typed:** `blog/build_blog.py` reads `data/pharmacies.json` and renders every article, including each pharmacy list — so no phone, address or hours in an article can ever disagree with the finder. Re-run it after any data change: `python3 blog/build_blog.py`. It also regenerates `sitemap.xml` and `robots.txt`.
- **Per-article SEO:** unique title (≤60 chars) and description (≤155 chars), canonical URL, Open Graph + Twitter tags (reusing `og.png`), JSON-LD `Article` + `BreadcrumbList` inside `<head>`, one `h1`, `lang="bn"`. The guide index carries `CollectionPage` + `ItemList` JSON-LD. Each article ends with a CTA back to the finder (with the right `?area=` / `?open=` query) and links to 2–3 other articles. Blog pages share the finder's header (live Dhaka clock, Finder/Guide nav) and footer, so they read as one product.
- **Honesty rules, same as the finder:** an entry with no verified hours is shown as "সময় নিশ্চিত নয়", an unverified phone is labelled "অযাচাইকৃত", and an entry with no phone shows no phone. Friday closures and the 2–4 PM break are stated where the data says so; nothing is guessed.

## Project structure

```
raatpharmacy/
├── index.html            # Page structure + SEO/OG tags + JSON-LD
├── styles.css            # Night-friendly mobile-first styles, no framework
├── app.js                # All logic: open-now math, filters, i18n, corrections
├── sw.js                 # Service worker (cache-first app shell + data)
├── manifest.webmanifest  # Installable PWA manifest
├── og.png                # Share preview image (1200×630)
├── icon.svg / icon-192.png / icon-512.png
├── vercel.json           # Static hosting config (clean URLs)
├── data/
│   └── pharmacies.json   # 94 verified pharmacies + sources + verification note
├── blog/
│   ├── build_blog.py     # Generates all blog pages + sitemap + robots from pharmacies.json
│   ├── blog.css          # Article typography (reuses styles.css for the rest)
│   ├── index.html        # Guide list (generated — do not edit by hand)
│   └── *.html            # 6 articles (generated — do not edit by hand)
├── sitemap.xml           # Homepage + blog index + 6 articles (generated)
├── robots.txt            # Allow all + sitemap (generated)
├── new-pharmacies.json   # Research output: the 53 entries added 26 Nov 2026
├── coordinates.json      # Research output: the 21 confident geocoding matches
└── README.md
```

## How to add a new article

1. In `blog/build_blog.py`, add a new `body()` function (Bangla prose, 600–900 words) and an entry in `ARTICLES` with `slug`, `title` (≤60 chars), `description` (≤155 chars), `h1`, `lede`, `teaser`, `cta_href` (finder link with query params) and `cta_text`.
2. Add the slug to `RELATED` (2–3 other articles) and to the other articles' related lists where it fits.
3. Add the slug to the `ASSETS` list in `sw.js` and bump the cache name (`raatpharmacy-v6` → `v7`).
4. If the article needs an illustration, add a flat illustration to `img/` (named `blog-<slug>.webp`, 960×540, WebP) and set the article's `image` + `image_alt` fields — never use a photo of a real pharmacy, and label every image as an illustration.
5. Run `python3 blog/build_blog.py` and check the printed word counts and the verification script before pushing.

## Code style (readable code)

This project is judged partly on readable code, so every line is written for a reader years from now: clear descriptive names (no cryptic abbreviations), short functions that do one thing, a short comment above each section explaining **why** it exists (not just what it does), consistent formatting, no clever one-liners, no dead code. If shorter and clearer conflict, clearer wins. The service worker cache name (`raatpharmacy-v6` in `sw.js`) must be bumped on every release that changes a cached file, or visitors keep seeing the old version.

## Design (premium, human — not AI-generic)

One visual system, used everywhere: deep emerald + warm neutrals + one warm amber accent, Sora + Hind Siliguri, one radius scale, one shadow scale. No purple-blue gradients, no glassmorphism-everywhere (the header is the single frosted surface; cards stay solid), no emoji-style icons, no stock-photo look. The background is a restrained night gradient with a soft moon glow and faint stars that fade below the hero (pure CSS, no photo, no motion); light mode is the same idea in warm mint. The hero has one job — finding an open pharmacy right now — with a single big "এখন খোলা ফার্মেসি দেখুন" button; the guides live in their own section after the results. Illustrations are flat and editorial, each captioned as an illustration. Contrast is ≥4.5:1 everywhere; animation is disabled under `prefers-reduced-motion`.

## Tech

- Plain HTML / CSS / JavaScript — no framework, no build step
- `fetch` for the pharmacy list; `localStorage` only for the visitor's own correction reports and language choice
- No tracking, no account, no server
