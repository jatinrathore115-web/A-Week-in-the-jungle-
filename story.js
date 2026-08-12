/* ============================================================================
   ██  YOUR STORY  —  this is the ONLY file you edit to make a new flipbook  ██
   ----------------------------------------------------------------------------
   Put your videos + art in  pages/  and your sounds in  sfx/ , then list them
   below. You never need to touch the engine (script.js, styles.css, index.html).

   QUICK START
   ----------------------------------------------------------------------------
     1. Drop your clips into  pages/   (MP4 or WebM — see README.md)
     2. Point `cover` below at your cover art (16:9), and update the matching
        <link rel="preload"> in index.html if you rename the file
     3. List your clips in `pages` below, in reading order
     4. Open index.html (or serve the folder) — that's it. The loading bar, the
        preloader and the paper stack all follow this file automatically.

   THIS BOOK — "A Week in the Jungle"
   ----------------------------------------------------------------------------
   Six video pages (1.mp4 … 6.mp4, ~3m29s total) behind a jungle cover, then The
   End. No sound files in  sfx/ : the two UI cues (page turn, Play tap) fall back
   to synthesised versions built with the Web Audio API, so the book is fully
   playable while silent-on-disk; drop real Ogg Opus files into  sfx/  whenever
   you want them (see sfx/README.txt). The clips carry their own audio.
   The other two images are engine chrome: handNudge.webp and play button.png.

   HOW A PAGE WORKS
   ----------------------------------------------------------------------------
   • Each entry in `pages` is ONE page of the book, shown in order after the
     cover. A page is either a single image/video, or a list of `scenes` that
     cross-dissolve into each other (1.1s) on the same page.

   • A single-video page:  { type:"video", src, delay, tap }
       src   : the clip, e.g. "pages/1.webm"
       delay : ms to hold on frame 0 before the clip starts (optional)
       tap   : { time, x, y, w, h } — freeze at `time` seconds and wait for the
               reader to tap (x,y), then play on. A mid-clip interaction.
     A single-image page:   { type:"image", src, alt, bubble }

   • A scene:  { src, hold, fx, bubble }
       src    : the image ("pages/x.webp") or video (".webm").
       hold   : ms to linger before dissolving to the next scene
                (default 1600; a video with no hold advances when it ends).
       fx     : optional ambient animation over the art —
                "popcorn" | "scan" | "sparkle" | "shake"
                | { type:"pulse", x:"48%", y:"62%" }  (a glow at a point)
       bubble : optional speech bubble (below).

   • A speech bubble:  bubble: { kind:"speech", text, box, flip, typeSpeed }
       text     : the words. Use "\n" to choose where the line breaks.
       box      : { top / left / right / bottom, w } — position (CSS %) and
                  WIDTH in book-space px (the book is 1280 x 720).
       flip     : true → mirror the bubble so its tail points the other way.
       typeSpeed: ms per typed character (default 45) — lower = faster.
     NOTE: bubble ART is not shipped with this template (there is no images/
     folder), so a bubble currently renders as text with no balloon behind it.
     See the "kind:speech" note in styles.css if you want to add the artwork.

   • Video pages need NO companion poster image: the engine loads each clip's
     metadata so the browser paints the video's own first frame as the page's
     opening still, then buffers the rest lazily.

   • An INTERACTIVE page — one still, several clips the reader picks:
         { type:"interactive", src, requireAll, hotspots:[ … ] }
       src        : the still that IS the page (stays the top layer; every clip
                    sits in a layer BEHIND it and is revealed on tap).
       hotspots   : the tappable places. Each one is
                      { src, label, x, y, w, h }
                        src   : the clip that plays when this spot is tapped
                        label : screen-reader name ("the disco ball")
                        x, y  : CENTRE of the spot, in CSS % of the page
                        w, h  : size of the tap target, in CSS % of the page
                    A small hand nudge appears at every spot. Tapping one
                    hides all the nudges, cross-dissolves to that clip, plays it
                    with sound, then dissolves back to the still and brings the
                    REMAINING nudges back. A tapped spot's nudge is spent.
       requireAll : true (default) → the forward turn stays locked until every
                    hotspot has been watched. false → forward is free at once.
                    (☰ Skip always overrides, exactly as on a video page.)
     Leaving the page and coming back RESETS it — all nudges return.

   • Last entry must be  { type: "end" }  — the closing "The End" page.
   ============================================================================ */
window.STORY = {

  /* ── THE COVER ────────────────────────────────────────────────────────────
     The art on the closed book — 16:9, painted into the book's 1280x720 stage.
     What ships here is a PLACEHOLDER: replace the file with your own art (keep
     the name), or point this at a different file. WebP at 1280x720 keeps the
     wait before the Play button appears as short as possible. */
  cover: "pages/cover page.png",

  /* ── THE PAGES ────────────────────────────────────────────────────────────
     THIS ARRAY decides the reading order — the filenames do not. Add, remove
     or reorder freely; the engine reads the length for the paper stack and
     preloads whatever it finds here.

     Each video page waits for its clip to FINISH before the Next arrow appears
     (☰ Skip is always there as an escape hatch). Revisiting a page replays it. */
  pages: [

    /* ── A WEEK IN THE JUNGLE — six video pages, in reading order ───────────
       Each page holds on its own first frame for a beat after the sheet lands,
       then plays; the Next arrow appears when the clip finishes (☰ Skip is
       always available as an escape hatch). Reorder these lines to reorder the
       book — the filenames carry no meaning to the engine. */
    { type: "video", src: "pages/1.mp4", delay: 400 },
    { type: "video", src: "pages/2.mp4", delay: 400 },
    { type: "video", src: "pages/3.mp4", delay: 400 },
    { type: "video", src: "pages/4.mp4", delay: 400 },
    { type: "video", src: "pages/5.mp4", delay: 400 },
    { type: "video", src: "pages/6.mp4", delay: 400 },

    /* ── EXAMPLE: cross-dissolving scenes on ONE page ───────────────────────
    { scenes: [
        { src: "pages/dawn.webp",  hold: 2000, fx: "sparkle" },
        { src: "pages/noon.webp",  hold: 1800, fx: { type: "pulse", x: "48%", y: "62%" } },
        { src: "pages/night.webp", hold: 2200 }
      ] },
    */

    /* ── EXAMPLE: an interactive "explore the scene" page ───────────────────
       Point it at your own still + clips. x/y are the CENTRE of each tap
       target as a % of the page, w/h its size.

    {
      type: "interactive",
      src: "pages/interaction screen.webp",
      requireAll: true,          // Next unlocks once all of them are watched
      hotspots: [
        { src: "pages/clip a.webm", label: "the first thing",
          x: "50%", y: "16%", w: "15%", h: "26%" },
        { src: "pages/clip b.webm", label: "the second thing",
          x: "50%", y: "65%", w: "24%", h: "20%" }
      ]
    },
    */

    /* ── EXAMPLE: a page that pauses mid-clip for a tap ────────────────────
    { type: "video", src: "pages/4.webm",
      tap: { time: 6.5, x: "62%", y: "48%", w: "22%", h: "50%" } },
    */

    { type: "end" }    // ← keep this last: the closing "The End" page
  ],

  /* ── AMBIENT SOUND BEDS (optional) ────────────────────────────────────────
     An extra track that rides UNDER one specific clip's own audio. Key is the
     clip's src exactly as written above; `vol` (0..1) keeps it below the
     voice-over — 0.5-0.6 is a good starting point. Leave this block commented
     out if your clips carry all the sound they need.

  videoSfx: {
    "pages/2.webm": { url: "sfx/crowd.ogg", vol: 0.55 },
    "pages/3.webm": { url: "sfx/drums.ogg", vol: 0.50 }
  },
  */

  /* ── LOADING-BAR WEIGHTS (optional) ───────────────────────────────────────
     The preloader finds your files by itself; this only makes the progress bar
     smoother by telling it each file's size UP FRONT instead of waiting for the
     server's Content-Length. Once your own media is in place, generate the
     block with:

         node tools/asset-sizes.mjs

     and paste its output here, replacing the stub below. Safe to leave out
     entirely — it is purely cosmetic. */
  /* Generated by tools/asset-sizes.mjs — re-run it after adding your media. */
  assetSizes: {
    "pages/handNudge.webp":         6546,
    "pages/play button.png":     1947478,
    "pages/cover page.png":      2112886,
    "pages/6.mp4":               6338752,
    "pages/5.mp4":               8723331,
    "pages/3.mp4":              11578281,
    "pages/2.mp4":              13988422,
    "pages/1.mp4":              19438537,
    "pages/4.mp4":              61334065
  }
  // 9 files, 119.7 MB — what a first-time reader downloads before Play appears.
  // That is a LOT (3m29s of video at ~4.7 Mbps). See "Shrinking the download" at
  // the bottom of README.md — re-encoding gets this under ~20 MB with no visible
  // loss at the 1280x720 the book renders into. Re-run tools/asset-sizes.mjs and
  // paste the new block here afterwards.
};
