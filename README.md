# K-BID Browser

Client-side helper app for browsing K-BID auctions faster.

Current MVP features:
- Track only auction URLs/IDs you care about.
- Browse existing auctions from the K-BID list page, then import directly.
- Auction browse filters for distance radius (10/25/50) and distance ZIP (default 55014).
- Manual refresh per tracked auction.
- Swipe-style lot review flow (right = save, left = ignore).
- Keyboard arrows and touch swipe gestures for fast triage.
- Favorites view with direct link-out to each K-BID lot for bidding.
- Store tracked auctions, settings, and save/ignore decisions in localStorage.

## Tech Stack

- React + TypeScript + Vite
- No backend required for local development
- GitHub Pages-compatible static build

## Important Notes

- This app is read-only and does not place bids.
- Auction parsing depends on K-BID markup and may require updates if their page structure changes.
- Browser CORS policies may block direct fetches from GitHub Pages.
  - Use the in-app Proxy Prefix setting when needed.
  - Example preset: https://api.allorigins.win/raw?url=

## Local Development

1. Install dependencies:

   npm install

2. Start dev server:

   npm run dev

3. Open the printed local URL (typically http://localhost:5173).

## Build and Validation

- Build production bundle:

  npm run build

- Run lint checks:

  npm run lint

## GitHub Pages Deployment

This repository includes a workflow that publishes static assets to GitHub Pages.

Steps:

1. Push this repo to GitHub.
2. In repo settings, enable GitHub Pages source: GitHub Actions.
3. Push to main branch (or run workflow manually).

The deploy workflow sets VITE_BASE_PATH automatically to /<repo-name>/.

## Roadmap (next)

- Add parser fixture tests to reduce breakages from markup drift.
- Add CSV export for filtered lots.
- Add optional serverless proxy reference implementation.
