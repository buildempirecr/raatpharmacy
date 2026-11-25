# RaatPharmacy — Find an Open Pharmacy at Night (Dhaka)

> **One-line pitch:** Find an open pharmacy near you at night — hours, phone, directions in one tap.

**Arohon "Build for Bangladesh" entry.** Submissions close 10 Dec 2026; top two entries win a GTA 6 copy.

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

**Vercel (primary)** — static site, no build step. `vercel.json` at the repo root enables clean URLs:

```bash
vercel --prod
# or: import the GitHub repo at vercel.com/new — no build command, no output directory needed.
```

**GitHub Pages (fallback)** — the same files work at a subpath too (all local paths are relative):

- Repo Settings → Pages → Deploy from branch → pick the branch and `/` (root) folder.
- The site then lives at `https://<user>.github.io/raatpharmacy/`.

## Features

- **41 verified pharmacies** across 21 Dhaka areas (plus one verified Islamia branch in Narsingdi, labelled as outside Dhaka)
- **Search** by pharmacy name, area or address
- **"Open now" toggle** — computed live from the visitor's own clock, including overnight hours (e.g. 8:00 AM–1:30 AM counts as open at 1:00 AM)
- **"Open past midnight" filter** — 22 pharmacies are open past midnight or 24 hours
- **Each card:** name, area, address, hours, "Closes at / Opens at", phone, big Call button (`tel:`), WhatsApp button (mobile numbers only), Google Maps directions link, and "last verified" date
- **"Call to confirm stock"** on every card — stock is never claimed live
- **"Hours wrong?"** — a visitor can report a correction; it is saved only in their own browser (`localStorage`) and shown as "Correction reported — not yet verified". Listed hours are never silently changed
- **Bangla + English toggle** (default Bangla), mobile-first, dark night-friendly design, big tap targets

## What is verified vs not verified

- **Verified:** every phone number, address and opening-hours value in `data/pharmacies.json` was copied from a published source listed in that entry's `source` field (Islamia Pharmacy official site, Lazz Pharma branch listings, Tamanna Pharmacy listings, hospital pharmacy pages, published directories). All entries carry `lastVerified: "2026-11-25"`.
- **Not verified / not listed:** where a phone or hours could not be verified, the field is `null` and the UI says "Phone not listed" / "Hours not confirmed" — never a guess. 4 entries have unconfirmed hours; 1 entry has no listed phone.
- **Conflicts handled:** where two listings disagreed, the official site was used first for Islamia; for Lazz the bdyellowpages listing was used and the conflict noted in the entry. Tamanna Bashundhara lists "24 hours" in one place and "7 AM–1 AM" on the North South University safety page — the safer 7 AM–1 AM is used, with a note.
- **Stock:** never shown. The app always tells the visitor to call ahead.

## Project structure

```
raatpharmacy/
├── index.html        # Page structure: header, summary, search/filters, list, about
├── styles.css        # Night-friendly mobile-first styles, no framework
├── app.js            # All logic: open-now math, filters, i18n, corrections
├── data/
│   └── pharmacies.json  # 41 verified pharmacies + sources + verification note
├── vercel.json       # Static hosting config (clean URLs)
└── README.md
```

## Tech

- Plain HTML / CSS / JavaScript — no framework, no build step
- `fetch` for the pharmacy list; `localStorage` only for the visitor's own correction reports
- No tracking, no account, no server
