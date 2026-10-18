# AI Games Center

The family games site (Cloudflare Pages, project output folder: `site/`).

- `site/` – what gets published: home page, `ofek.js` (shared login), `_worker.js` (server + database API), one folder per game.
- `build/` – scripts that turn the latest game versions from Claude into the site versions
  (add the family tables, the home button and home-screen support).

The database (D1, binding `DB`) and the optional `FAMILY_CODE` secret are set in the Cloudflare project settings, not in this repository.
