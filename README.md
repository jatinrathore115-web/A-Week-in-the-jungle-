# A Week in the Jungle

A 3D storybook: a real hardcover that swings open, full-bleed video pages that
peel over at the corner, an idle "turn the page" nudge and a closing **The End**
page. No build step, no frameworks, nothing to install.

**Open `index.html` and it runs.** (Better: serve the folder — see *Running it*.)

---

## What's in this book

| | |
|---|---|
| Cover | `pages/cover page.png` (1672×941, 16:9) |
| Pages | `pages/1.mp4` … `pages/6.mp4` — 6 video pages, ~3m29s total |
| Then | The End page, with **Read again** |
| Sound | The clips carry their own audio. `sfx/` is empty, so the two UI cues (page turn, Play tap) are **synthesised** with the Web Audio API. Drop in real Ogg Opus files whenever you want them — see `sfx/README.txt`. |

⚠️ **The download is 120 MB.** Every reader fetches all of it before the Play
button appears. That's a long wait on anything but a fast connection — see
**Shrinking the download** below, which gets it under ~20 MB with no visible
loss.

The reading order lives in `pages:` in `story.js` — the filenames mean nothing to
the engine. Reorder those lines and you reorder the book.

**To change the story you edit one file — `story.js` — and drop your media in
`pages/` and `sfx/`.** The engine (`script.js`, `styles.css`, `index.html`,
`gsap.min.js`) stays exactly as it is.

Two things in `index.html` are the exception, and only if you *rename* a file:
the `<link rel="preload">` for the cover, and the `<img class="play-img">` src.

---

## Changing the pages

Everything is one array in `story.js`:

```js
window.STORY = {
  cover: "pages/cover page.png",
  pages: [
    { type: "video", src: "pages/1.mp4", delay: 400 },
    { type: "video", src: "pages/2.mp4", delay: 400 },
    // … 3 – 6 …
    { type: "end" }              // ← keep last
  ]
};
```

Add, remove or reorder those lines freely — the loading bar, the preloader and
the thickness of the paper stack all follow from this file. `delay: 400` holds
each page on its own first frame for 400 ms after the sheet lands, so the
voice-over doesn't start under the tail of the page-turn.

Adding a **new** clip is: drop the file into `pages/`, add a line here, re-run
`node tools/asset-sizes.mjs` and paste the result over `assetSizes`. Keep clips
at 720p and a couple of MB each — every reader downloads every clip before Play
appears.

To change the cover, point `cover:` at the new file. If you give it a different
name, update the `<link rel="preload">` in `index.html` to match (percent-encode
spaces: `cover page.png` → `cover%20page.png`).

---

## Running it

**Best — serve the folder over http.** Any one of these, from inside the folder:

```
python -m http.server 8000        →  http://localhost:8000
npx serve .
```

You get the real experience: every asset is fetched up front behind a progress
bar and Play only appears at 100%.

**Also works — double-click `index.html`.** On `file://` the browser forbids
`fetch()`, so the preloader stands down and media loads on demand instead. The
book works fine; you just may see a clip buffer on arrival.

---

## What you can put on a page

Full reference is in the comment block at the top of `story.js`. In short:

| Page type | Config |
|---|---|
| Video | `{ type:"video", src, delay, tap }` |
| Image | `{ type:"image", src, alt, bubble }` |
| Cross-dissolving scenes | `{ scenes:[ { src, hold, fx, bubble }, … ] }` |
| Pick-a-hotspot | `{ type:"interactive", src, requireAll, hotspots:[…] }` |
| The End | `{ type:"end" }` — must be last |

- **`delay`** holds a video page on frame 0 for N ms before it starts.
- **`tap: { time, x, y, w, h }`** freezes a clip mid-play and waits for the
  reader to tap a spot, then plays on — an interaction inside a video.
- **`fx`** adds ambient motion over a scene: `"popcorn"`, `"scan"`,
  `"sparkle"`, `"shake"`, or `{ type:"pulse", x, y }`.
- **Interactive pages** show a hand nudge at each hotspot; tapping one plays its
  clip with sound, then dissolves back with the remaining nudges. By default
  Next stays locked until all of them are watched (`requireAll: false` frees
  it). Leaving and returning resets the page.
- **Ambient beds** — `videoSfx` maps a clip to a track that plays under it. See
  `sfx/README.txt`.

### Speech bubbles: read this first

The `bubble` option is wired up, but the **balloon artwork is not included** in
this template — there is no `images/` folder — so a bubble currently renders as
text with nothing behind it. Add your own art and re-measure the crop in the
`kind:"speech"` block in `styles.css` before using bubbles. The video clips
carry their own voice-over, which is how this book normally speaks.

---

## How reading works

- **Forward is earned.** The Next arrow and the drag-forward gesture stay locked
  until the page has played out — its clip finished, its scenes done, or all its
  hotspots watched. Going **back** is always allowed.
- **☰ Skip** (top-right) is the escape hatch: it ends the current page's beat
  and turns forward. Revisiting the page still replays it.
- **Turning pages:** the corner arrows, ← → keys, or dragging the page's corner
  (with a flick shortcut).
- **Idle nudge:** if a reader stalls after a page finishes, a hand cue appears,
  the page corner peels a little as a demo, and the Next arrow blinks.
- **Read again** on The End closes the book — the pages riffle back and the
  cover swings shut — landing on the front cover ready for another read.
- **Fullscreen** is entered on the Play tap (that's the user gesture browsers
  require) and left when you return to the cover.
- **Landscape only** on touch devices; portrait shows a rotate prompt.

---

## Formats

| | Format | Notes |
|---|---|---|
| Video | **MP4** (H.264 + AAC) or WebM (VP9 + Opus), `yuv420p` | this book uses MP4 |
| Audio | Ogg Opus — 64k mono / 96k stereo | falls back to synthesised cues |
| Images | PNG, WebP or JPEG | this book uses PNG |

The engine takes either video container — it reads the extension, and a page
carries exactly one file (there are no `<source>` siblings, so no per-browser
fallback). **MP4/H.264 is the safe choice**: it plays everywhere, including old
Safari and locked-down school tablets. WebM/VP9 files are meaningfully smaller
but need Chrome, Edge, Firefox or Safari 14.1+ (macOS 11+ / iOS 14.5+).

---

## Shrinking the download

120 MB is a lot to sit through, and it's all bitrate — 3m29s of video shouldn't
cost more than ~20 MB at the 1280×720 the book renders into. `4.mp4` alone is
59 MB. Nothing about the book needs changing; just re-encode the files in place.

Install [ffmpeg](https://ffmpeg.org/download.html), then from this folder:

```bash
mkdir small
for f in pages/*.mp4; do
  ffmpeg -i "$f" -vf "scale=1280:-2" -c:v libx264 -crf 26 -preset slow \
         -pix_fmt yuv420p -movflags +faststart -c:a aac -b:a 96k "small/$(basename "$f")"
done
```

Check them, then move `small/*.mp4` over the originals. Raise `-crf` for smaller
files, lower it for better quality — 23 is visually lossless, 28 is where
artefacts start to show on flat colour. `+faststart` matters: it moves the index
to the front of the file so playback can begin before the download finishes.

Prefer WebM (roughly 30% smaller again, at the cost of old-Safari support):

```bash
ffmpeg -i "pages/1.mp4" -vf "scale=1280:-2" -c:v libvpx-vp9 -crf 34 -b:v 0 \
       -row-mt 1 -pix_fmt yuv420p -c:a libopus -b:a 96k "pages/1.webm"
```

Then update the `pages:` list in `story.js` to the new extensions.

**Either way, finish by refreshing the loading-bar weights** — they're baked into
`story.js` and will be wrong after a re-encode:

```
node tools/asset-sizes.mjs
```

Paste its output over the `assetSizes` block. Cosmetic only, but the bar will
lie to your readers until you do.

The cover and Play button (2.1 MB and 1.9 MB) are worth a pass too — saved as
WebP at quality 80 they land around 200 KB each with no visible difference. If
you rename them, update `cover:` in `story.js` and both `<link rel="preload">`
tags plus the `.play-img` src in `index.html`.

---

## The colour theme

Everything around the art — the board, the backdrop, the buttons, The End page —
is painted from colours **sampled off this story's own frames**, so the book and
the pictures inside it read as one piece. The whole palette lives in the `:root`
block at the top of `styles.css`; that comment block lists each sampled family
with its hex values.

The composition is the cover art's own: a **warm wooden object against deep green
jungle, under a cyan sky**.

| Part | Colour | Where it came from |
|---|---|---|
| Backdrop / side areas | cyan sky → canopy green → deep jungle, with a sand-gold glow under the book | the establishing shot every clip opens on |
| Book board + spine | varnished sign-wood | the hanging sign that carries the title |
| Buttons | gold face, leaf-green ring, white glyph | `pages/play button.png`, exactly as drawn |
| The End page | deep canopy shade, gold lettering | the cover's own gold-on-green title |
| **Page corners, fore-edges, the paper block** | **off-white** | left alone on purpose — see below |

**The paper is deliberately not themed.** `--page-edge`, `--page-back` and
`--page-back-2` stay off-white so the board reads as a cover with real paper
bound into it, and so the peeled corner — which is how a reader learns the pages
turn — keeps announcing itself. Tinting them would collapse the board and the
page block into one flat slab.

**Why the buttons are gold-on-green and not green-on-gold.** The nav arrows sit
*outside* the book, on the green backdrop. A green face disappears there at the
size those arrows use. Gold-on-green is both the strongest pairing this art
offers and the way the artwork already solves the same problem — the Play orb is
gold precisely so it can be found against leaves.

To retheme for a different story, change the `:root` tokens; the rest of the
stylesheet reads from them.

---

## Tuning the feel

Two numbers are duplicated between JS and CSS **on purpose**, and must be
changed together:

| What | `script.js` | `styles.css` |
|---|---|---|
| Page-turn duration | `FLIP_MS` | `--flip-ms` |
| Hotspot dissolve | `HUB_DISSOLVE_MS` | `--hub-dis` |

Other knobs worth knowing, all in `script.js`:

- `HINT_AFTER_DONE_MS` — how long after a page finishes before the hand nudge
  appears (then `NUDGE_SHOW_MS` on screen, repeating every `NUDGE_GAP_MS`).
- `ML_BEATS` — the curved "wing-beat" speed streaks that sweep across on every
  turn. Each row is one stroke: `y` position, `len`, `th` thickness, `bow`
  curvature, `d` stagger. The matching travel/fade is the `mlBeat` keyframes in
  `styles.css`.
- `LEAF_WINDOW` — how many pages either side stay GPU-renderable.

---

## Optional: a smoother loading bar

The preloader finds your files by itself and learns each real size from the
server's `Content-Length`. If you want the bar perfectly weighted from the first
frame, generate the sizes and paste them into `story.js` as `assetSizes`:

```
node tools/asset-sizes.mjs
```

Purely cosmetic — skip it and everything still loads.

---

## Files

```
index.html      ⚙ engine — the page shell. Only edit <title> (+ the cover preload).
script.js       ⚙ engine — flip physics, media, sound, preloader.
styles.css      ⚙ engine — the book's look. Theme colours are at the top.
gsap.min.js     ⚙ engine — vendored GSAP 3.13, drives the corner peel.
story.js        ★ THE STORY — the only file you need to edit.
pages/
  cover page.png    ★ the cover art
  1–6.mp4           ★ the six video pages
  handNudge.webp    ⚙ engine chrome — keep
  play button.png   ⚙ engine chrome — keep (restyle by overwriting; see below)
sfx/            ★ sounds — EMPTY, so cues synthesise (see sfx/README.txt)
tools/          optional helper script
```

**One thing to know about `play button.png`:** it has an *opaque* dark-green
backdrop rather than a transparent one, so `styles.css` masks it back to a disc
(the `.play-img` rule) and puts the button's glow on the parent `.core` — CSS
applies `filter` before `mask`, so a glow set on the image itself would be sliced
off at the mask's edge. If you swap in artwork with a real alpha channel, delete
those two `mask-image` lines; alpha does the job better on its own.

**If the book won't open:** open the browser console. A real JavaScript error is
also printed as a red bar across the bottom of the page, and the engine logs
which sounds loaded, which fell back to synth, and any asset the preloader had
to skip.

**Nothing blocks the Play button.** A missing file, a 404, a stall, a clip that
won't decode — each counts as "done" for the loading bar and the book opens
anyway. A page whose video can't play unlocks itself, so a reader is never
trapped.

---

## Robustness worth knowing about

The non-obvious safeguards already built in, so you don't have to rediscover
them:

- **Three ways forward.** Any control gated on a video appears on `ended`, on
  `error`, *or* via a watchdog timer — a clip that stalls without firing either
  event can't trap the reader.
- **A clip never starts mid-turn.** A page's video is held on frame 0 until its
  sheet has landed, so the voice-over doesn't talk over the page-turn swoosh.
- **Only the current and next page buffer**, and only those are gesture-primed
  for sound — priming everything at once was the original opening lag.
- **Layer windowing.** Pages more than two away are marked dormant so the GPU
  can drop their textures; without it, a long book starts painting blank pages
  on real machines.
