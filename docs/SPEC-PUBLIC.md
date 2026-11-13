# Public deal finder: build spec (draft)

Working name: DealRadar. The name is not final. Check for trademark and app-store conflicts before launch.

Status: draft for Eric's review. Nothing here is built. Every source, network, and term below is a candidate that must be verified against the provider's own current pages before it is relied on.

## 0. Two tracks

| Track | What it is | Branch | Data sources |
|---|---|---|---|
| Private | Eric's personal tool and design prototype (the Grok browser build) | `feature/price-finder` | Personal-use feeds only. Never deployed publicly. |
| Public | The product other people use | `feature/public-*` | Licensed or permitted sources only (Section 3) |

Code may move from private to public. Data sources may not. The Reddit and Slickdeals adapters stay out of the public app unless a written agreement with that provider says otherwise.

`docs/SPEC.md` on `feature/phase-1` is the original freebies spec. Its server layout, adapter rules, and safety rules are reused here. Its "no price tracking" non-goal is dropped.

## 1. Goal

A deal and trip price finder that people trust because it never overstates what it knows.

- Deals: lowest posted price first, with source, posted date, and age on every card.
- Trips: Ski, Near the lifts, Beach, Cruise, Stays.
- Every row is a lead, not a verified checkout price.

## 2. What makes it better than most deal apps

1. **Honest labels.** Lead vs. confirmed. "Expected" is never shown as "Confirmed." Post age is always visible.
2. **Real discount check.** Percent-off is shown as "vs stated was price." Ranking never uses percent alone. Where price history exists, show "below usual" from the history, not from the merchant's claim.
3. **All-in cost.** Shipping, membership required, and for trips: resort fees, cleaning fees, lift tickets not included. Unknown costs are labeled unknown.
4. **One card per deal.** The same offer from several sources merges into one card that lists every source.
5. **Alerts that fit the user.** Keyword alerts and target-price alerts, with quiet hours.
6. **A score with reasons.** Any deal score lists its inputs (age, source, history, all-in cost). No unexplained number.
7. **Less noise.** Seen and hide marks. Expired rows drop off on their own.
8. **Disclosed money.** Affiliate links are labeled on the card. Ranking is never changed by commission.

Not offered at launch: stock checks. Rows are labeled "not stock-checked" until a permitted source provides stock data.

## 3. Data sources (public track)

Each source is an adapter. Each must be approved by Eric and verified before it is switched on.

| Candidate | Why | Must verify first |
|---|---|---|
| Affiliate network deal and product feeds | Built for publishers. Also the income source. | Which networks accept a new site, feed terms, caching and price-display rules, approval requirements |
| Merchant product APIs offered to affiliates | Current price and sometimes stock | Access rules, rate limits, how fresh a displayed price must be |
| User-submitted deals with voting | Community signal, no third-party licence needed | Moderation load, spam controls, terms for user content |
| Merchant or publisher feeds that permit reuse | Extra coverage | Each feed's terms and robots.txt, one at a time |
| Manual entry by Eric | Seeding and corrections | None |

Not permitted in the public track:
- Reddit data, unless a commercial agreement with Reddit is in place.
- Slickdeals data, unless a commercial partnership with Slickdeals is in place.
- Scraping store, resort, cruise-line, or Airbnb pages.
- Any workaround for a rate limit or block. On HTTP 429: back off and reduce frequency.

## 4. Rules carried over

- Show source link, posted date, and age on every card.
- Trip cards say: "The price can change in the cart. Open the link before you pay."
- Dated rows expire automatically.
- No "freebies" wording.
- Keyword matches need a price or a package word to count as a deal.
- Links: `https` only, no embedded credentials, allowed domains only. Never render raw HTML from a source.
- A failed source does not clear the others.

## 5. Architecture

- Server with a database and scheduled fetches. Browser `localStorage` is for view preferences only.
- Accounts are needed for watch lists and alerts. Collect the minimum: an email or a push token.
- Price history is stored server-side from permitted sources only.
- Stack, hosting, database, and every package or paid service need Eric's approval before they are added.
- Secrets live in environment variables, never in git. This repository is public.

## 6. Design standard

The app has to look like a product people would choose, not a prototype.

- Phone first. Most deal browsing is on a phone.
- One type scale, one spacing scale, one colour set with a tested dark mode.
- Cards: photo, title, price, all-in note, source, age, trust label. The same layout everywhere.
- Real states: loading, empty, error, and expired. No blank screens.
- Accessibility: contrast that passes WCAG AA, visible focus, labels on every control, no meaning carried by colour alone.
- Fast first load. Images sized and lazy-loaded.
- Every screen is checked with screenshots at phone and desktop widths before a pull request is opened.

## 7. Legal and trust (must be in place before public launch)

- Affiliate disclosure on the page and next to affiliate links, using each program's required wording.
- Privacy policy and terms of use.
- A way to report a wrong or expired deal.
- Moderation rules for user submissions.
- Have the terms of every enabled source read and saved with the date checked.

This list is not legal advice. Have a professional review it before launch.

## 8. Phases

1. **Foundation.** Server, database, adapter interface, fixture-based tests, design system, card layout with trust labels and "as of" times.
2. **First licensed source.** One affiliate feed, after approval. Automatic expiry. Dedupe.
3. **Accounts and alerts.** Watch list, keyword and target-price alerts, quiet hours.
4. **Price history and score.** "Below usual" check and the explained score.
5. **Submissions.** User-submitted deals, voting, moderation, reporting.
6. **Launch checks.** Section 7 complete, load test, accessibility pass.

## 9. Decisions waiting on Eric

1. Which affiliate network to apply to first.
2. Stack and hosting (paid services need approval).
3. Final name.
4. Whether user accounts use email, push only, or both.

## 10. Acceptance checks

- No adapter for a source outside Section 3 exists in the public build.
- Every card shows source, posted date, age, and a trust label. A test fails if any is missing.
- An "expected" item never renders as "confirmed."
- Dated rows disappear after their date without a manual step.
- Affiliate links carry a visible label.
- Tests run offline from fixtures. No live network in tests.
