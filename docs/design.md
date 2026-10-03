# Flick design spec

Date: 2026-10-03

## What it is

A desktop app for watching the movies and shows in `E:\Media`. You open it from the Start menu, watch something, close it. Nothing keeps running after the window closes.

Goals, in Shrey's words: a local Netflix with a clean UI and a good player, artwork pulled and saved automatically, progress remembered, English subtitles downloaded on the fly, new torrents sorted automatically, and it has to look right on a 21:9 monitor.

Not goals for v1: streaming anything that isn't on disk, image-based (PGS) subtitles, multiple user profiles, access from other devices, trailers.

## Library layout (already in place)

```
E:\Media\Shows and Movies\   qBittorrent drops downloads here (the inbox)
E:\Media\Movies\Title (Year)\Title (Year).ext
E:\Media\TV Shows\Show\Season N\Show SxxEyy.ext
```

Current library: 14 movies, 1 show (16 episodes). Codecs seen: H.264, HEVC 10-bit 4K, AV1 10-bit; audio AAC, AC3, DTS, Opus; subs SRT, ASS, mov_text, PGS.

## Stack

- Electron 44 (bundles Node 24). The main process is the backend. The renderer is React 19 + TypeScript, built with Vite.
- SQLite through Node's built-in `node:sqlite` (no native module to rebuild).
- ffmpeg and ffprobe from `C:\Program Files\ffmpeg\bin` (on PATH). The path can be changed in Settings.
- `parse-torrent-title` for reading release names.
- JASSUB (libass compiled to WebAssembly) for styled ASS subtitles.
- vitest for tests.
- Packaged with electron-builder as an unpacked folder (`release\win-unpacked\Flick.exe`). A Start menu shortcut called "Flick" points at it.

## Look

From the mockups. Near-black background `#0C0C0D`, warm off-white text `#EEEAE3`, secondary text `#A39E96`, muted text `#85817A`, one accent: amber `#F2B544`. Amber is only used for progress, the active tab or selection, and things that need a look. Primary buttons are off-white with dark text. One font: Schibsted Grotesk (bundled with the app, not loaded from Google). Titles are 800 weight with tight letter spacing. Corner radius 6px on art and buttons, 10px on floating panels. No glass blur, no glow, no gradients except the dark scrims that keep text readable over backdrops.

UI text follows the rules in the no-AI-sounding-copy note: short, plain, specific.

### 21:9 handling

Layouts are fluid and use the full width; nothing is boxed into a centred 16:9 column. Side gutters are 120px at 3440 wide and scale down with width (`clamp(24px, 3.5vw, 120px)`). Poster grids use `repeat(auto-fill, minmax(240px, 1fr))`, which gives 11 columns at 3440. Hero text is capped at about 1000px wide so lines stay readable. Checked at 3440x1440, 2560x1080 and 1920x1080.

The window opens maximised, with the native title bar hidden. Windows draws its own min/max/close buttons over the header (`titleBarOverlay`, dark). F11 toggles fullscreen. The player always goes fullscreen.

## Screens

Top menu on every browse screen: Flick wordmark, Home, Movies, Shows, then search and settings icons on the right.

**Home.** A big banner for the last thing you were watching, with a Resume button and time left. If there's nothing in progress, it shows the newest addition. Then rows:
- Continue watching: 16:9 thumbnails with a progress bar.
- Recently added.
- Marvel, Star Wars, Anime (see Collections).
- Shows.

Only Continue watching uses wide thumbnails; every other row uses posters. Rows scroll sideways with the mouse wheel and arrow buttons.

**Movies / Shows.** A poster grid. Filter buttons: All, Marvel, Star Wars, Anime, Unwatched. Sort: Recently added, A to Z, Year. Half-watched titles show a thin progress bar on the poster.

**Search.** A large input. Results update on every keystroke, searching the in-memory library with no network calls. It matches title, original title, year, cast, director and collection name. The matched part of each title is highlighted in amber. Filters: All, Movies, Shows. Results are posters.

**Movie page.** Backdrop, title, year, runtime, rating, genres, overview, director and cast. Buttons: Play or Resume, Start over (only when there's progress), a subtitles indicator, and mark as watched. A small line gives file details (resolution, codec, audio, size, path). Then a poster row of related titles from the library (same collection first, then same genre).

**Show page.** The same header, with a Resume button that names the next episode. Season tabs and an "N of M watched" count. Episode cards show the still image, number and title, and runtime. Watched episodes are dimmed with a tick, and a partly watched one has a progress bar.

**Player.** Fullscreen video. Controls fade out after 2.5s without mouse movement and come back on any movement.
- Top left: back button, title (or show plus episode number and title).
- Bottom: seek bar (4px, 6px on hover). Hovering shows a preview frame and the exact time.
- Controls row: play/pause, back 10s, forward 10s, volume and slider, elapsed / total time, then captions and audio, speed, fullscreen.
- For episodes, a "Next episode" button shows up during the credits (last 30s, or at the TMDB end-credits mark if there is one). The next episode autoplays after a 10s countdown that you can cancel.

**Captions menu** (opens above the captions button):
- Tabs: Subtitles, Audio.
- Subtitles tab: Off, then every English track (embedded or sidecar file). The auto-downloaded one is labelled "Downloaded, same release" when the file hash matched.
- Two links: "Style and timing" (shows the current size and delay) and "Find more subtitles".
- Audio tab: every audio track, with language and channels. Tracks that need conversion say "converted while playing".

**Style and timing** submenu:
- Size: number in px with − / + buttons (step 2, range 16 to 120).
- Font: picker with Schibsted Grotesk, Arial, Verdana, Georgia, Trebuchet MS.
- Text colour: white, yellow, light grey, cyan.
- Background: none, black, dark grey, white, plus an opacity slider (0 to 100%).
- Outline: width in px with − / + (0 to 8), plus a colour swatch (black or white).
- Shadow: None, Soft, Strong.
- Position: height from the bottom of the frame, slider from 2% to 40%.
- Delay: − / + in 0.1s steps. `[` and `]` change it while watching.
- Reset.

Style settings are global. Delay is saved per file.

ASS tracks keep their own styling and only take Delay and Position. The other controls are greyed out with the note "This track has its own styling".

**Find more subtitles** submenu: a search box prefilled with the title and year, and English results from OpenSubtitles.
- The result whose file hash matches is marked "Same release", and the one in use has a tick.
- One click downloads a result and switches to it. A spinner shows while it downloads.
- The footer shows how many downloads are left today.

**Settings.** A left list: Library, Sorting queue, Subtitles, Playback, API keys, About.
- **Library:** the media folders, plus a "Scan now" button.
- **Sorting queue:** see below.
- **Subtitles:** whether to auto-download, default style, and OpenSubtitles login.
- **Playback:** autoplay next episode, skip length, the watched threshold, and the ffmpeg path.
- **API keys:** the TMDB key and OpenSubtitles key.
- **About:** version, plus a link to the log file.

**First launch.** One screen asks for the TMDB key, the OpenSubtitles key, and optionally an OpenSubtitles username and password (20 downloads a day instead of 5). It has links to where you get each one. Secrets are stored with Electron `safeStorage`, which encrypts them to the Windows user.

## Sorting queue

Runs by itself: when Flick opens, then every 5 minutes while it's open. Nothing pops up on Home. The Settings → Sorting queue page shows progress, and the sidebar shows a badge with the number of items left.

1. **Scan the inbox.** Each top-level entry in `Shows and Movies` is a candidate. It's skipped (and shown as "Still downloading, will retry") if:
   - any file is a partial (`.!qb`, `.part`, `.crdownload`, `.tmp`), or
   - anything in it changed in the last 10 minutes.
2. **Move.** Ported from `E:\GitHub\kodi-media\organize.py`:
   - The release name is parsed, with the same special cases that script has (alternative titles, "Part Two" as part of the title, multi-episode files, samples ignored, subtitle files renamed to `<video>.<lang>[.sdh|.forced].ext`).
   - Moves happen on the same drive, so they're instant renames.
   - If a target already exists, the item goes to "Needs a look".
   - Leftover folders (txt, nfo, samples) go to the Recycle Bin.
3. **Metadata.** TMDB lookup by title and year, falling back to title only.
   - If the best result scores too low, the item goes to "Needs a look" with a Fix match button. That opens a dialog to search TMDB and pick the right result.
   - Saves `poster.jpg`, `backdrop.jpg`, `logo.png` (if TMDB has one) and `flick.json` (the TMDB fields Flick uses) into the title's folder.
   - For shows it also saves `Season N\SxxEyy.jpg` episode stills and episode names.
4. **Subtitles.** Skipped if the video already has an English text track (embedded or sidecar).
   - Otherwise it searches OpenSubtitles by file hash first, then by name. The best English match is saved as `<video>.eng.srt`.
   - If nothing is found, the item goes to "Needs a look" with a Search button.
   - If the daily quota runs out, the item waits as "Waiting for subtitle quota" and the queue carries on with the other steps.

**Queue mechanics.** The queue lives in SQLite (`queue` table: id, source path, kind, target path, step, status, error, attempts, updated). That means it survives restarts and can hold any number of items.
- Moves run one at a time.
- Metadata runs 4 at a time.
- Subtitle downloads run one at a time.
- A failed network step retries 3 times with backoff, then goes to "Needs a look".
- Tabs: All, Working, Waiting, Needs a look, Done. The list is virtualised so thousands of rows scroll smoothly. Pause and resume buttons stop and restart it. Done items are cleared after 7 days.

The same metadata and subtitle steps also run for anything found in Movies / TV Shows that has no `flick.json` yet. That covers the current 15 titles on first launch and anything you move in by hand.

## Library scan and data

On launch, Flick walks Movies and TV Shows and reconciles them with the database:
- New files are added and queued for metadata.
- Missing files are hidden. Their progress is kept, keyed by TMDB id, so a re-download picks up where you left off.
- Each file is probed once with ffprobe and the results are cached against its size and modified time.

SQLite file: `%APPDATA%\Flick\flick.db`. Tables:
- `titles`: TMDB id, kind, folder, metadata JSON.
- `files`: path, title id, season, episode, probe JSON, size, mtime.
- `progress`: file id, position, duration, watched, updated.
- `sub_prefs`: per file, chosen track and delay.
- `settings`.
- `queue`.

Caches go in `%APPDATA%\Flick\cache\`: seek preview sprites and the ffprobe output.

## Collections

Worked out from TMDB data, no hand-kept lists:

| Collection | Rule |
|---|---|
| Marvel | Production company Marvel Studios (id 420), or the keyword "marvel cinematic universe" |
| Star Wars | TMDB collection "Star Wars Collection", or production company Lucasfilm with "Star Wars" in the title/keywords (covers The Mandalorian) |
| Anime | Genre Animation and original language Japanese |

Rules live in one file (`collections.ts`) so adding one later is a small change.

## Playback

Flick runs a small HTTP server in the main process, on 127.0.0.1 and a random port. When you press Play, it uses the cached probe to pick one of three paths.

1. **Direct.** The container is mp4/m4v/webm, the video is H.264/HEVC/AV1/VP9, and the audio is AAC/Opus/MP3. The file is served as-is, with Range support, and the browser `<video>` element plays and seeks it.
2. **Remux.** The codecs are fine but the container isn't (mkv with H.264 + AAC, for example). ffmpeg rewraps it into fragmented MP4 on the fly with `-c copy`. This costs almost no CPU.
3. **Audio convert.** The audio is DTS/AC3/E-AC3/TrueHD/FLAC. The video is copied and only the chosen audio track is converted to AAC (stereo, or 5.1 where possible), streamed as fragmented MP4.

The RTX 3080 decodes HEVC 10-bit and AV1 in Chromium, so video is never re-encoded in v1.

**Exact seeking on paths 2 and 3.** A seek to time T restarts ffmpeg at the last keyframe K at or before T. Keyframe times come from a one-off `ffprobe -skip_frame nokey` pass, cached. The player then moves T − K into the new stream, so it lands on T itself, not just the nearest keyframe. Switching audio tracks reuses the same restart.

**Seek preview.** On first play, ffmpeg builds a sprite sheet in the background: one 320px-wide frame every 10s, keyframes only, tiled 10x10 per image. A small index file maps time to tile. Until it's ready, hovering the seek bar shows just the time.

**Subtitles.**
- Text tracks (sidecar SRT/ASS/VTT, or embedded subrip/ass/mov_text) are extracted with ffmpeg once and cached.
- SRT-style tracks are drawn by Flick's own overlay, which is what makes every style setting work.
- ASS tracks go through JASSUB so anime subs keep their styling.
- PGS tracks are listed but disabled ("Image subtitles aren't supported yet").

**Progress.**
- Saved every 5s, on pause, and when the player closes.
- Watched at 92%, or once the end credits start for episodes.
- Resume starts 3s before the saved spot.
- Continue watching lists anything between 2% and the watched mark, newest first. For a show it lists the next unwatched episode.

**Keys.**

| Key | Action |
|---|---|
| Space | Play / pause |
| ← / → | Back / forward 10s |
| ↑ / ↓ | Volume |
| F | Fullscreen |
| C | Captions menu |
| `[` `]` | Subtitle delay |
| N | Next episode |
| Esc | Leave the player |

## Process layout

```
electron/          main process
  main.ts          window, lifecycle, IPC wiring
  db.ts            node:sqlite schema and queries
  library.ts       scan Movies / TV Shows, reconcile
  probe.ts         ffprobe + keyframe index + cache
  parse.ts         release-name parsing (port of organize.py rules)
  sorter.ts        inbox scan + moves
  queue.ts         persistent job queue and workers
  tmdb.ts          TMDB client, scoring, artwork download
  subtitles.ts     OpenSubtitles client, file hash, download, quota
  stream.ts        local HTTP server: direct / remux / audio convert, sprite, subtitle extraction
  settings.ts      settings + safeStorage secrets
  collections.ts   collection rules
src/               renderer (React)
  routes/          Home, Movies, Shows, Search, Title, Show, Player, Settings, FirstRun
  components/      Row, PosterCard, ThumbCard, Hero, SeekBar, CaptionsMenu, SubtitleOverlay, QueueList ...
  lib/             ipc client, search index, formatting
```

The renderer talks to the main process only through a typed IPC bridge (`contextIsolation` on, no Node in the renderer). Media and subtitles reach the `<video>` element over the localhost server.

## Errors

| Problem | What Flick does |
|---|---|
| No API keys | First-launch screen; browsing works, sorting waits |
| TMDB/OpenSubtitles down or offline | Queue items retry later; the library still works from saved art |
| No good TMDB match | "Needs a look" with Fix match |
| Target already exists when moving | "Needs a look", nothing overwritten |
| ffmpeg missing | Banner on Home linking to Settings → Playback |
| File won't play (damaged, e.g. Your Name's broken block) | Player shows "This file stopped playing at 1:24:10" with a Retry button; it never fails silently |
| Subtitle quota used up | "Waiting for subtitle quota", resumes next day |

Logs go to `%APPDATA%\Flick\logs\flick.log`, rotated at 5 MB.

## Testing

- **Unit tests (vitest):**
  - Release-name parsing against real names: everything in `kodi-media\organize.log` plus the current library as fixtures.
  - Sorter moves in a temp directory, including still-downloading and existing-target cases.
  - Queue state transitions and retries.
  - Collection rules.
  - Progress and watched thresholds.
  - Search ranking.
  - The playback path picker, fed the real ffprobe output of each file in the library.
- **Manual checks before calling it done:**
  - Play Dune (AC3 → convert), Ant-Man (DTS → convert), Rise of Skywalker (4K HEVC, remux), Weathering with You (AV1 + Opus + ASS subs), a Mandalorian episode (mp4 direct, AC3 audio → convert).
  - On each: seek to an exact time, switch audio, toggle subs, change every style setting.
  - Drop a test release into the inbox and watch it go through the queue.
  - Close and reopen to check resume.
  - Look at every screen at 3440x1440 and 1920x1080.

## Kodi

Flick doesn't read or change anything in `E:\Kodi`. Kodi's shortcut still runs `organize.py` on its own; both sort the same way, so using either is fine. The Kodi watch history isn't imported in v1.
