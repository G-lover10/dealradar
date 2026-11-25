# Live store search

Typing a product and pressing Search asks each connected store's official search API, adds any posted listings that match, and sorts everything lowest price first. No store pages are scraped.

Status: built from the stores' documentation and tested against sample responses only. **None of the three adapters has been run against the real API.** Expect fixes on first contact.

## Stores

| Store | Adapter | Default | Keys needed |
|---|---|---|---|
| eBay | `src/adapters/ebay.js` | On | `EBAY_CLIENT_ID`, `EBAY_CLIENT_SECRET`, optional `EBAY_CAMPAIGN_ID` |
| Amazon | `src/adapters/amazon.js` | On | `AMAZON_CREDENTIAL_ID`, `AMAZON_CREDENTIAL_SECRET`, `AMAZON_PARTNER_TAG` |
| Best Buy | `src/adapters/bestbuy.js` | **Off** | `BESTBUY_API_KEY` |

A store with no keys is skipped and shown as "not connected yet". A store that fails shows one line and the other prices stay.

Keys go in a private `.env` file next to `package.json` (copy `.env.example`). Never commit it.

## Before going public: rules each store sets

Read each store's own terms. These points come from a first reading of their documentation on November 16, 2026 and are not legal advice.

**eBay** (API License Agreement and Buy API requirements)
- Production use of the Buy APIs is for eBay Partner Network partners. Apply there.
- Show the eBay logo, the seller's username, and the Buy It Now price. Show shipping separately, even when it is free.
- Keep eBay results visually separate from other stores' results.
- Listing data shown may be at most 6 hours old.
- Do not use eBay data to suggest or model prices. Check whether a "below usual" price check on eBay items would break this.
- Link to the eBay User Agreement and to this app's privacy policy in the footer.

**Best Buy** (developer.bestbuy.com/legal)
- Its terms say the service may not be used for third parties to analyze or review Best Buy pricing. That may rule out a price finder. The source stays off until the owner has read the page and decided.
- If used: attribute content to Best Buy, show its logo at the bottom of the screen, cache for no more than 72 hours.
- Over-limit calls return HTTP 403.

**Amazon** (Creators API, through Associates)
- New accounts get 1 request per second and 8,640 per day for the first 30 days. Access can be removed after 30 days without qualifying sales.
- The licence agreement and price-display rules could not be loaded and are not confirmed. Read the Associates Operating Agreement before switching this on in public.
- The Associates disclosure sentence is required on the site.

## Not done yet

- Store logos and the required attribution text on cards and in the footer.
- Showing "free shipping" explicitly on eBay cards.
- Separating eBay results from other stores in the layout.
- A per-visitor search limit. Today there is one shared cap (`live_searches_per_minute`).
- Trips are searched in posted listings only.

## Unverified details in the adapters

Each adapter file has comments with the documentation page for every request and field. The points below could not be confirmed from the documentation and need a real call to check:

- eBay: whether `price.value` is text or a number; the host of affiliate links; image host (`ebayimg.com` is assumed); how price sorting behaves without a delivery location.
- Best Buy: keyword encoding, value types of `shippingCost` and `onlineAvailability`, no sort is sent.
- Amazon: only the North America token endpoint is used; `Price:LowToHigh` sorting may surface accessories first.
