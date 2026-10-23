# How a deploy ("הפץ") is done

1. Read the deploy request in the dashboard (ids of the games to refresh / add).
2. Fetch the latest version of each game artifact from Claude into a folder per artifact id.
   Then `python3 build/rebuild_all.py THAT_FOLDER` runs steps 3 and 4 for every game (including WOW Dungeons, single player, via build_wow.py).
3. Games with family tables have their own scripts: build_breakout.py, build_blocks.py, build_snake.py, then add_home.py.
   Other games: `python3 build/port_game.py SOURCE ID "Name" THEME [corner]` (corner of the home button: tl/tr/bl/br).
   Current corners: pulse-lanes tl, boom tl, wonders-dice tr, architects tr, puzzle tl.
   Puzzle: replace the "saving photos not available" notice (see deploy of 2026-10-18).
4. Run `python3 build/safe_area.py` (keeps every game clear of the iPhone status bar and home indicator).
5. Update site/catalog.json (onSite, icon, href), bump the cache name in site/sw.js, commit and push.
6. In the dashboard, the games the owner switched on appear on the home page.


New games added to the site show on the home page automatically (the dashboard remembers which games existed when the owner last chose), until the owner turns them off.
