# DealRadar (US Freebies and Promotions): Build Spec

Hand-off for Claude Code, Grok Build, or Kimi. Paste this whole file and say: "Build the project in this spec, starting with Phase 1. Ask before adding any paid service or any source not listed as approved."

## 0. Read first

- This spec is modeled on PerkRadar (github.com/luobinger/PerkRadar, MIT). I read its README and developer docs. Its architecture is worth reusing. Its sources are Chinese-language sites, so they don't apply to a US app.
- You can fork PerkRadar and swap its sources, or build fresh with this spec. Either way, check the MIT license file and keep its notices.
- **Every source below is a candidate that must be verified before you rely on it.** I didn't verify the terms, endpoints, or current status of any of them.

## 1. Goal

A self-hosted board that collects **free and limited-time US offers** (free games, free software and trials, promo codes, and freebies) from approved sources, shows each one with its source and fetch time, and has a **Holiday mode** for Black Friday, Cyber Monday, and Christmas.

Primary user: one person. Optional read-only family link later.

## 2. Non-goals

- No price tracking or price-history scoring. Not a retail price-drop tool.
- No scraping of retailer or deal-site pages that block it or forbid it.
- No buying, claiming, or logging in on a user's behalf.
- No public multi-user service.

## 3. Approved sources (verify each before enabling)

Each source is an adapter with `fetchItems(config) -> Item[]`. Start with 2 sources.

| Candidate | Method | Status |
|---|---|---|
| Epic Games Store free promotions | JSON endpoint (PerkRadar uses one) | Undocumented endpoint. Verify it and Epic's terms before using it. |
| Reddit free-game and freebie subreddits | Official Reddit API | Check current Reddit API terms and rate limits. |
| Deal and freebie sites that publish RSS | RSS/Atom | Check each site's terms and robots.txt. |
| Software and app promotions (e.g., developer or retailer newsletters you subscribe to) | Manual entry or email forwarding | Allowed. No scraping. |
| Manual "paste a link" box | User enters the title, link, and expiry | Allowed. |

Rules for every adapter:
- Store `source`, `source_url`, `fetched_at`, and `expires_at` (nullable). Only show an expiry when the source provides one.
- Validate links: `https` only, no embedded credentials, allowed domains only.
- Titles up to 300 characters; summaries up to 160. Never render raw HTML from a source.
- A failed source doesn't clear the others. Timeout 25 seconds. Cap items per fetch.

## 4. Data model (SQLite)

- `items`: id, title, summary, original_url, source, external_id (unique per source), category, expires_at (nullable), first_seen, last_seen
- `fetch_runs`: id, source, started_at, ok, item_count, error (short text)
- `user_marks`: item_id, bookmarked (bool), claimed (bool), updated_at (server-side, single user; drop localStorage if you want it to survive browser resets)
- `seasons`: id, name (e.g., "Black Friday 2026"), starts_on, ends_on, notes, confidence ("confirmed" or "expected")

## 5. Classification

- Keyword rules on title and summary, in one config file (`config/categories.yml`). Categories: Games, Software and apps, Subscriptions and trials, Promo codes, Other.
- Keep "Other" hidden by default, as PerkRadar does, so mistakes don't clutter the board.
- Add a manual override: the user can re-categorize any item.

## 6. Features

### Phase 1 (MVP)
- Config file for approved sources, on/off switches, and intervals.
- In-process scheduler (every 2 hours) plus a manual refresh button with a cooldown.
- Dedupe by source + external_id.
- Board: search by literal substring, filter by source and category, sort by newest or expiring soon.
- Bookmark and "claimed" marks.
- Per-source status: last fetch, item count, last error.
- Docker Compose, bound to `127.0.0.1` only, with a README.
- Offline tests using fixture files; no live network in tests.

### Phase 2 (Holiday mode and polish)
- **Holiday mode:** a page for Black Friday, Cyber Monday, and Christmas. Shows a countdown, the season's items sorted by expiry, and any manually entered sale calendar entries.
- **Sale calendar:** you enter known sale dates and tag each "confirmed" (from the retailer) or "expected." Never show an "expected" date as confirmed.
- **Expiring soon:** items whose `expires_at` falls within 3 days get a badge.
- **Digest:** a daily or weekly email or ntfy push listing new items in your chosen categories.
- **Quiet hours** for push alerts.

### Phase 3 (nice to have)
- Telegram bot for `/new` and `/expiring`.
- Read-only family link protected by a token.
- CSV export.
- Browser extension that marks items already on your board when you visit their page (no data sent off your machine).

## 7. Safety and legal (must follow)

- Use only approved sources. Respect each one's terms, rate limits, and attribution.
- Keep API keys in `.env`, never in code or git.
- If the app adds affiliate links, disclose them on the page.
- Mark every item as a **lead, not a verified offer**, and link to the original page. Say so on the board.
- Do not expose the app publicly without authentication, TLS, and rate limits on the refresh endpoint. PerkRadar's README makes the same warning.

## 8. Project layout

```
dealradar/
  README.md
  .env.example
  docker-compose.yml
  config/
    sources.yml
    categories.yml
    seasons.yml
  src/
    server.ts
    scheduler.ts
    db/
    adapters/        # one file per approved source
    classify/
    web/
  tests/fixtures/
  data/              # SQLite file, gitignored
```

## 9. Acceptance checks

- Phase 1: fixture data loads into the board; dedupe keeps one copy of a repeated item; a failing source shows an error without hiding the others; refresh respects the cooldown.
- Classification: tests for each category, plus a test that "Other" stays hidden by default.
- Docker: `docker compose up` serves the board at `http://127.0.0.1:<port>`; nothing listens on a public interface.
- Holiday mode: countdown is correct; "expected" dates are labeled as expected.

## 10. GitHub setup

1. Create a **private** repository named `dealradar` on github.com.
2. Add the README, a `.gitignore` covering `.env`, `data/`, and `node_modules/`, and this spec as `docs/SPEC.md`.
3. Have your coding tool work on `feature/phase-1` and open a pull request. Don't push to `main`.

## 11. Hand-off prompt

> Read `docs/SPEC.md`. Build Phase 1 only. Start with the project layout (Section 8), the SQLite schema (Section 4), the classifier with tests (Section 5), and a fixture-based adapter. Don't add live source adapters until I approve each one. Ask before any paid service. Commit in small steps on `feature/phase-1`.
