## Project structure

- `index.html`: main page HTML structure, SEO metadata, external CDN imports, and references to split frontend assets.
- `assets/index/index.css`: main page styles for desktop, mobile, map markers, popups, event cards, and modals.
- `assets/index/main.js`: main page interactions including Mapbox setup, event rendering, markers, filters, search, nearby mode, reports, and donations.
- `assets/index/data-trust.js`: data status and trust panel logic for the event list.
- `frontend-shared.js`: shared frontend/backend data helpers when needed.
- `api/`: Vercel serverless API handlers.
- `scraper.js`: news and traffic data crawling, AI filtering, and cache updates.
- `.github/workflows/`: GitHub Actions scheduled jobs.

The old root `app.js` and `styles.css` files were removed after the main page was split into `assets/index/*`. Keep new page-specific frontend files under `assets/index/` unless `index.html` is updated at the same time.
