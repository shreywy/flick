# Flick

A Windows app for watching the movies and shows on your own drive. You open it, pick something, close it when you're done. No server, no account, no Docker.

It's built for a 3440x1440 ultrawide but scales down to normal screens.

## What it does

- Reads `Movies` and `TV Shows` under one media folder (mine is `E:\Media`) and pulls posters, backdrops, logos, cast and episode stills from TMDB. Art is saved next to the files, so it's only fetched once.
- Sorts new downloads. Anything dropped in `Shows and Movies` gets renamed and moved into the right folder on launch, then gets its art and an English subtitle. Names it can't read show up in Settings with a Fix match button.
- Plays nearly anything. MP4s with AAC audio play directly. Everything else goes through ffmpeg: video is copied as is, and DTS, AC3, TrueHD and 5.1 Opus audio is converted to AAC. The stream is fed through Media Source Extensions, so seeking lands on the exact second.
- Remembers where you stopped, per episode. Resuming opens paused at that point.
- Skip intro and skip credits for shows. It compares an episode's audio with the episodes either side of it (Chromaprint), so it works without chapter markers.
- Subtitles: picks up `.srt`, `.ass` and embedded tracks, renders styled anime subs with libass, and can search and download English subs from OpenSubtitles or SubDL while you watch. Size, font, colours, outline, shadow, position and delay are all adjustable.
- Picture modes for ultrawide screens. Fill finds burned-in black bars and scales until the picture reaches the edges, without stretching. Ctrl + scroll zooms by hand.
- Seek previews, a next-episode card when the credits start, and a right-click menu for removing things from Continue watching or Recently added.

## Running it

You need Node 24 and ffmpeg (with Chromaprint, which the gyan.dev full build has). Flick looks for ffmpeg in `C:\Program Files\ffmpeg\bin`, and you can point it somewhere else in Settings.

```
npm install
npm start
```

The first launch asks for the media folder and a TMDB key (free at themoviedb.org). Subtitle downloads need an OpenSubtitles or SubDL key, added in Settings.

To build the app into `release\win-unpacked\Flick.exe`:

```
npm run dist
```

Close Flick first, or Windows won't let the build replace the running exe.

## Folder layout

```
E:\Media
  Movies\Dune (2021)\Dune (2021).mkv
  TV Shows\The Mandalorian\Season 1\The Mandalorian S01E01.mp4
  Shows and Movies\   <- new downloads go here
```

Each title folder gets a `flick.json` with its metadata. Progress, settings and the sorting queue live in `%APPDATA%\Flick\flick.db`. Keys are encrypted with Windows' own credential storage.

## Code

| | |
|---|---|
| `electron/` | Main process: library scan, sorting queue, TMDB, subtitles, ffmpeg streaming, intro and credits detection |
| `src/` | React interface and the player |
| `shared/` | Types used by both sides |
| `test/` | Unit tests (`npm test`) |
| `e2e/` | Playwright runs against the real app (`node e2e/run.mjs <scenario>`) |

Stack: Electron, React 19, TypeScript, Vite, `node:sqlite`, JASSUB for subtitles.
