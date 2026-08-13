/* ============================================================================
   FLIPBOOK ENGINE — the book's behaviour. Your story lives in story.js.
   Diagnostic first: surface any REAL JavaScript error on screen (a silent error
   would stop the click handlers from ever attaching). Image / video / network
   load failures are ignored — they have no .message and are handled per-element.
   ============================================================================ */
window.addEventListener("error", function (ev) {
  if (!ev || !ev.message) return;                 // ignore resource-load errors
  var b = document.getElementById("__jsErr");
  if (!b) {
    b = document.createElement("div");
    b.id = "__jsErr";
    b.style.cssText = "position:fixed;left:0;right:0;bottom:0;z-index:100000;" +
      "background:#b00020;color:#fff;font:13px/1.5 monospace;padding:10px;white-space:pre-wrap";
    (document.body || document.documentElement).appendChild(b);
  }
  b.textContent = "JavaScript error (this is likely why the book won't open):\n" +
    ev.message + "\n" + (ev.filename || "") + " : line " + ev.lineno;
});

// If you can read this line in the console, the script parsed with NO syntax
// error and you are running the CURRENT file (not a cached copy).
console.log("%c[flipbook] loaded — 3D book, full-bleed pages, speech bubbles.",
            "font-weight:bold;color:#7d5fd0;font-size:13px");

/* ============================================================================
   ██  THE STORY LIVES IN  story.js  —  edit THAT file, not this one  ██
   ----------------------------------------------------------------------------
   story.js sets  window.STORY = { cover, music, pages }.  Everything below is
   the reusable ENGINE — the book, the flip physics, the buttons, the
   dialogue/scene player. You should not need to touch it to make a new story.
   ============================================================================ */
const STORY = window.STORY || {};

/* ==========================================================================
   PRELOAD REGISTRY  —  MUST STAY AT THE TOP OF THIS FILE.
   --------------------------------------------------------------------------
   These are `const`/`function` declarations used by the very next block (the
   cover art) and by every media builder below. `const` is hoisted but sits in
   the temporal dead zone until its line runs, so declaring this lower down
   throws "Cannot access '_assetTargets' before initialization" on the cover's
   onAssetReady() call — which kills the whole script at boot. Keep it here.

   PRELOAD_ACTIVE is false on file://, where fetch() is blocked by CORS: there is
   nothing to preload from, so every element just keeps its own src and the
   loading bar completes immediately. Anything that behaves differently under the
   preloader keys off this flag rather than sniffing for failures later.
   ========================================================================== */
const PRELOAD_ACTIVE = (location.protocol === "http:" || location.protocol === "https:");

/* Manifest keys are percent-encoded; element srcs are written with real spaces.
   Normalise both ends so "sfx/page flip.ogg" and "sfx/page%20flip.ogg" match. */
function normUrl(u) { return String(u || "").split(" ").join("%20"); }

/* url -> [ fn(blobUrl) ]. The preloader calls these once the bytes are local. */
const _assetTargets = new Map();
function onAssetReady(url, apply) {
  const k = normUrl(url);
  if (!_assetTargets.has(k)) _assetTargets.set(k, []);
  _assetTargets.get(k).push(apply);
}

/* Swap a media element onto a blob: URL, with the section-3 safety net: if the
   blob ever fails to decode, revert to the original file URL ONCE and (for a
   video) pick playback back up where it was. */
function useBlob(el, originalUrl, blobUrl) {
  if (!el || !blobUrl) return;
  if (!el._blobGuard) {
    el._blobGuard = true;
    el.addEventListener("error", function () {
      if (el._blobReverted) return;              // only ever fall back once
      el._blobReverted = true;
      const at = el.currentTime || 0;
      const wasPlaying = el.tagName === "VIDEO" && !el.paused && !el.ended;
      console.warn("[flipbook] blob failed for " + originalUrl + " — reverting to the file");
      el.src = originalUrl;
      try { el.load(); } catch (_) {}
      if (wasPlaying) {
        el.addEventListener("loadeddata", function once() {
          el.removeEventListener("loadeddata", once);
          try { el.currentTime = at; } catch (_) {}
          const p = el.play(); if (p && p.catch) p.catch(function () {});
        });
      }
    });
  }
  el.src = blobUrl;
}

// Cover art — themed from story.js so the whole book is configured in one place.
(function () {
  const ci = document.querySelector(".cover-img");
  if (!ci || !STORY.cover) return;
  ci.style.backgroundImage = "url('" + encodeURI(STORY.cover) + "')";
  // the cover is a CSS background, so its "blob swap" is a re-set of the url()
  onAssetReady(STORY.cover, function (blobUrl) {
    ci.style.backgroundImage = "url('" + blobUrl + "')";
  });
})();

// The Play button artwork is static markup (index.html), not built by the engine,
// so it needs registering by hand — otherwise the preloader fetches it but nothing
// ever adopts the bytes and the element quietly keeps downloading it a second time.
(function () {
  const img = document.querySelector(".play-img");
  if (!img) return;
  const src = img.getAttribute("src");
  onAssetReady(src, function (blobUrl) { useBlob(img, src, blobUrl); });
})();
const pages = STORY.pages || [];   // ← the story's pages (defined in story.js)

/* THE HAND used by every "tap here" cue in the book — the idle page-turn hint and
   the interactive page's hotspot nudges. One piece of artwork
   (pages/handNudge.webp, the gold outline hand), so every cue points with the
   SAME hand. It rides in PRELOAD_MANIFEST like every other asset, so each <img>
   registers for the blob swap too. CSS sizes the hand by WIDTH alone; the file's
   own 254x358 ratio gives the height. */
const HAND_NUDGE_SRC = "pages/handNudge.webp";
function makeHandImg(cls) {
  const img = document.createElement("img");
  img.className = cls;
  img.alt = "";
  img.draggable = false;                        // a dragged cue would ghost-drag the page
  img.setAttribute("aria-hidden", "true");
  img.src = HAND_NUDGE_SRC;
  onAssetReady(HAND_NUDGE_SRC, function (blobUrl) {
    useBlob(img, HAND_NUDGE_SRC, blobUrl);
  });
  return img;
}

/* The PAGE-TURN cue's motion streaks — three tapering GOLD lines that trail
   BEHIND the hand (to its right) showing which way the page travels:
   right-to-left, matching the ghost peel it plays with. Kept as an inline SVG,
   separate from the hand image, so CSS can animate the trail on its own timeline
   while the hand runs the swipe. CSS lays it out against the hand's right side. */
const FLIP_TRAIL_SVG =
  '<svg class="fh-trail" viewBox="0 0 18 22" aria-hidden="true">' +
    /* longest in the middle, fading as they trail off */
    '<g stroke="#f6be10" stroke-linecap="round" stroke-width="3.2" fill="none">' +
      '<path d="M2 4  h5"  opacity="0.9"/>' +
      '<path d="M2 11 h12" opacity="0.62"/>' +
      '<path d="M2 18 h5"  opacity="0.34"/>' +
    '</g>' +
  '</svg>';

/* ==========================================================================
   PER-VIDEO SOUND BEDS  —  an ambient track that rides ONE specific clip.
   --------------------------------------------------------------------------
   Some clips want a layer under their own audio: a disco ball wants music, a
   band wants drums, a bubble stall wants bubbles. YOU CONFIGURE THESE IN
   story.js, not here — `videoSfx` maps a clip's src (exactly as written in
   `pages`) to the track that should ride under it:

       videoSfx: {
         "pages/disco ball.webm": { url: "sfx/disco ball sound.ogg", vol: 0.55 }
       }

   `vol` sits the bed UNDER the clip's own voice-over — a bed at full volume
   buries the dialogue. Leave `videoSfx` out entirely and no clip gets a bed.

   HOW IT STAYS IN STEP: the bed is bound to the VIDEO ELEMENT'S OWN events, not
   to the hub/page logic. So every path that already starts, pauses or ends a
   clip — tapping a hotspot, leaving the page, Skip, a tab switch, the hub's
   dissolve-back — moves the bed with it, with no extra wiring in those places.

   WHY `ended` MATTERS: a bed is usually LONGER than its clip, so without
   stopping on `ended` the sound would carry on playing over the page after the
   picture had finished.
   ========================================================================== */
const VIDEO_SFX = {};
Object.keys(STORY.videoSfx || {}).forEach(function (clip) {
  const cfg = STORY.videoSfx[clip];
  if (!cfg || !cfg.url) return;
  // Spaces are legal in story.js but must be percent-encoded in the URL the
  // <audio> element and the preloader use, so both ends agree on one key. The
  // KEY stays exactly as authored — attachVideoSfx looks it up by page.src.
  VIDEO_SFX[clip] = { url: normUrl(cfg.url), vol: (cfg.vol == null ? 0.55 : cfg.vol) };
});

function attachVideoSfx(video, src) {
  const cfg = VIDEO_SFX[src];
  if (!cfg) return;                        // this clip has no bed — nothing to do
  let bed = null, failed = false;
  function get() {
    if (bed || failed) return bed;
    try {
      bed = new Audio(cfg.url);
      // PRELOADED: the preloader hands this element a blob: URL, so it must not
      // also fetch the file itself — that would be a double download.
      bed.preload = PRELOAD_ACTIVE ? "none" : "auto";
      bed.loop = false;                    // the bed outlasts the clip; see above
      bed.volume = cfg.vol;
      // a missing/undecodable file must never break the video
      bed.addEventListener("error", function () { failed = true; bed = null; });
    } catch (_) { failed = true; bed = null; }
    return bed;
  }
  get();                                   // buffer it alongside the page
  onAssetReady(cfg.url, function (blobUrl) {
    const b = get();
    if (b) { useBlob(b, cfg.url, blobUrl); b.preload = "auto"; }
  });

  function stop(reset) {
    if (!bed) return;
    try { bed.pause(); if (reset) bed.currentTime = 0; } catch (_) {}
  }

  video.addEventListener("play", function () {
    const b = get();
    if (!b || sfxMuted) return;
    // Lock the bed to the clip's position on every start. One rule covers both
    // cases: a fresh hotspot tap (the hub rewinds to 0, so the bed restarts)
    // and a resume after a pause or tab switch (the bed picks up in step).
    try {
      const d = b.duration;
      b.currentTime = (isFinite(d) && video.currentTime < d) ? video.currentTime : 0;
    } catch (_) {}
    const p = b.play();
    if (p && p.catch) p.catch(function () {});
  });
  video.addEventListener("pause",   function () { stop(false); });
  video.addEventListener("ended",   function () { stop(true);  });
  video.addEventListener("emptied", function () { stop(true);  });
  video._sfxStop = stop;                   // so other code can silence it outright
}

/* ---- Build one page face's media (image OR video) ------------------------ */
function makeMedia(page) {
  const media = page.type === "video"
    ? document.createElement("video")
    : document.createElement("img");
  media.className = "page-media";
  media.draggable = false;                           // never let the image "ghost-drag" out
  media.addEventListener("dragstart", function (e) { e.preventDefault(); });
  media.src = page.src;
  // Preloaded: once the bytes are local this element is re-pointed at a blob URL
  // (with a one-time revert-to-file guard inside useBlob). Until then the element
  // must NOT fetch for itself — see the preload note in the video branch.
  onAssetReady(page.src, function (blobUrl) {
    useBlob(media, page.src, blobUrl);
    if (media.tagName === "VIDEO") { media.preload = "metadata"; try { media.load(); } catch (_) {} }
  });
  if (page.type === "video") {
    media.loop = false;
    attachVideoSfx(media, page.src);        // ambient bed for this clip, if it has one
    media.playsInline = true;
    media.setAttribute("playsinline", "");            // iOS Safari inline playback
    media.setAttribute("webkit-playsinline", "");
    // NO POSTER IMAGE: there are no per-video first-frame .webp files any more, so
    // the clip itself has to supply the still that's shown before playback starts —
    // otherwise the page surface (--paper, deep night-blue) would show through as a
    // BLANK page while the video buffers.
    //   preload="metadata" fetches just the header + first frame (a few hundred KB,
    // NOT the whole clip), which the browser paints as the page's opening still. It
    // is by definition frame 0, so there's no jump when playback then begins.
    //   Full buffering still happens lazily for the current + next page only
    // (see warmVideo) — preload="auto" on all of them was the original opening lag.
    //   UNDER THE PRELOADER: "none". The preloader is already fetching this exact
    // file, so leaving this at "metadata" made every one of the 9 clips fetch a
    // SECOND time in parallel with it — 9 extra connections on top of the
    // preloader's pool, which is enough to make Chrome fail requests outright
    // with ERR_INSUFFICIENT_RESOURCES. The blob callback above puts "metadata"
    // back once the bytes are local, and preloadFinish() restores it for any
    // clip the preloader could not fetch, so nothing is left unable to load.
    media.preload = PRELOAD_ACTIVE ? "none" : "metadata";
    // Tap the video to start it WITH sound — a guaranteed user gesture, so
    // browsers that blocked the auto-start's audio will now allow it. A clip
    // that has FINISHED stays frozen on its last frame (Next moves the story
    // on; it only replays after leaving and returning to the page).
    media.addEventListener("click", function () {
      if (media.ended) return;
      media.muted = false;
      const p = media.play(); if (p && p.catch) p.catch(function () {});
    });
    // ⚡ TAP-GATE (story.js `tap:{time,x,y}` on a video page): when the clip
    // reaches the target frame, freeze there and wait for the reader to tap
    // the on-screen switch, then play on (see showTapGate above).
    if (page.tap) {
      media.addEventListener("timeupdate", function () {
        if (media._tapDone || media.ended) return;
        if (media.currentTime < (page.tap.time || 0)) return;
        if (!opened || !leaves[flipped] || !leaves[flipped].contains(media)) return;
        media._tapDone = true;               // once per page visit
        try { media.pause(); } catch (_) {}
        showTapGate(media, page.tap);
      });
    }
    // A FULL-PAGE video (not a scene clip) counts as the page's "dialogue":
    // only when it finishes may the Next arrow / nudge appear (refreshMedia
    // defers dialogueDone for these pages — see the no-bubble branch there).
    media.addEventListener("ended", function () {
      if (media.closest(".page-scene")) return;   // scene clips: the scene player decides
      if (media.classList.contains("hub-vid")) return;  // hotspot clips: the hub decides
      if (!leaves[flipped] || !leaves[flipped].contains(media)) return;
      dialogueDone(flipped);
    });
    // When THIS page's video FULLY finishes, blink + gold-glow the forward arrow
    // for 2s as a "turn the page" cue. Fires ONCE per page arrival (armBlink) so a
    // short clip won't blink repeatedly. Skipped on the last page.
    media.addEventListener("ended", function () {
      if (!opened || !ready || flipped >= totalPages - 1) return;
      if (media.classList.contains("hub-vid")) return;  // a hotspot clip is not the page ending
      if (!leaves[flipped] || !leaves[flipped].contains(media)) return;   // only the current page
      if (!armBlink || !cornerNext) return;      // already blinked for this visit
      armBlink = false;                          // one blink per page arrival
      cornerNext.classList.remove("blink1");
      void cornerNext.offsetWidth;               // restart the animation cleanly
      cornerNext.classList.add("blink1");
      setTimeout(function () { cornerNext.classList.remove("blink1"); }, 2050);
    });
  } else {
    media.decoding = "async";
    media.alt = page.alt || "story page";
  }
  return media;
}

/* ---- Build an INTERACTIVE page (story.js `type:"interactive"`) -------------
   One still + several clips the reader chooses between. The LAYER ORDER is the
   whole trick, and it is deliberate:

     z1  .hub-vid   — every hotspot's clip, stacked full-bleed, opacity 0
     z2  .hub-still — the interaction-screen art: the page's TOP art layer
     z3  .hub-spots — the tap targets + their white hand nudges

   So the clips sit BEHIND the still. Tapping a spot fades the still out and
   the chosen clip (already behind it) shows through — a cross-dissolve between
   two layers of the same scene, with no page-coloured flash between them and
   no re-layering at runtime. The still is never removed, so the page always
   has art on it while it turns.

   Everything here is per-VISIT state, cleared by hubReset(). */
function buildHub(page) {
  const hub = document.createElement("div");
  hub.className = "hub";
  const spots = document.createElement("div");
  spots.className = "hub-spots";

  (page.hotspots || []).forEach(function (hs, i) {
    // ── the clip (layer z1, behind the still) ──
    const v = makeMedia({ type: "video", src: hs.src });
    v.classList.add("hub-vid");        // marks it as the hub's, not the page's own
    v.dataset.hub = String(i);
    hub.appendChild(v);

    // ── the tap target (layer z3) ──
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "hub-spot";
    btn.dataset.hub = String(i);
    btn.setAttribute("aria-label", "Tap " + (hs.label || "here"));
    btn.style.cssText = "left:" + hs.x + ";top:" + hs.y +
                        ";width:" + (hs.w || "18%") + ";height:" + (hs.h || "18%");

    // ── the hand nudge (pages/handNudge.webp), centred on the spot and riding
    //    just below it so it points UP at the target (layer z3, never tappable) ──
    const nudge = document.createElement("div");
    nudge.className = "hub-nudge";
    nudge.dataset.hub = String(i);
    nudge.setAttribute("aria-hidden", "true");
    nudge.style.cssText = "left:" + hs.x + ";top:" + hs.y;
    nudge.appendChild(makeHandImg("nudge-hand"));
    nudge.style.setProperty("--delay", (i * 0.26).toFixed(2) + "s");  // stagger the three taps

    spots.appendChild(btn);
    spots.appendChild(nudge);
  });

  // DOM order == paint order here (and the CSS pins the same z-indexes):
  // clips (added above) → the still → the tap targets.
  const still = makeMedia({ type: "image", src: page.src, alt: page.alt || "story page" });
  still.classList.add("hub-still");    // layer z2 — above the clips, below the spots
  hub.appendChild(still);
  hub.appendChild(spots);

  // One delegated handler for the whole hub. Every click STOPS here: a stray tap
  // on the art must never reach a clip's own tap-to-play handler and start
  // something the reader didn't choose.
  hub.addEventListener("click", function (e) {
    e.stopPropagation();
    const btn = e.target.closest && e.target.closest(".hub-spot");
    if (btn && !btn.disabled) hubOpen(hub, +btn.dataset.hub);
  });
  return hub;
}

/* ---- Build one speech bubble (hidden until the page fully lands) ---------
   The bubble artwork + crop live in styles.css (.bubble.neel / .bubble.everywhere).
   Here we only apply the per-page geometry (position, width, flip) + the text. */
function makeBubble(bubble) {
  const wrap = document.createElement("div");
  wrap.className = "bubble" + (bubble.kind ? " " + bubble.kind : "");

  const box = bubble.box || {};
  ["top", "left", "right", "bottom"].forEach(function (k) {
    if (box[k] != null) wrap.style[k] = box[k];
  });
  if (box.w != null) wrap.style.setProperty("--w", box.w + "px");

  // FIT: the bubble art is a wide flat rectangle, so at its natural aspect a
  // 1-2 line text leaves big margins above/below. Squash the art vertically
  // (--sq, used by .bubble.speech CSS) to comfortably wrap the text block:
  //   needed  = lines × line-height (--dialogue-fs 21.33px × 1.2) + padding
  //   natural = the art's body height (above the tail) at this width
  // The text itself NEVER scales (32 Semi Bold rule) — only the bubble does.
  if (bubble.kind === "speech" && bubble.text && box.w) {
    const lines = String(bubble.text).split("\n").length;
    const needH = lines * (32 * 2 / 3) * 1.2 + 42;   // keep font in sync with --dialogue-fs
    const artH  = box.w * 0.4405;
    wrap.style.setProperty("--sq", Math.max(0.7, Math.min(1, needH / artH)).toFixed(3));
  }

  const bg = document.createElement("div");
  bg.className = "bubble-bg" + (bubble.flip ? " flip" : "");
  wrap.appendChild(bg);

  if (bubble.text) {
    const t = document.createElement("div");
    t.className = "bubble-text";
    t.textContent = bubble.text;
    t.dataset.full = bubble.text;              // kept so the typewriter can replay
    if (bubble.textLeft) t.style.left = bubble.textLeft;
    if (bubble.textTop)  t.style.top  = bubble.textTop;
    if (bubble.fontSize) t.style.fontSize = bubble.fontSize;
    wrap.appendChild(t);
  }
  if (bubble.typeSpeed) wrap.dataset.typeSpeed = bubble.typeSpeed;   // ms/char
  return wrap;
}

/* ---- Build one SVG speech bubble (white + black outline + purple glow) -----
   cfg = { text, box:{top,left,right,bottom,w}, tail, rot, fontSize }
     box   : position of the bubble box + its WIDTH in book-space px
     tail  : "down" | "down-left" | "down-right"  (which way the tail points)
     rot   : tilt in degrees (optional)
   Hidden until the page lands (revealed by refreshMedia). */
const SBUB_TAILS = {
  "down":       "M42 57 L58 57 L50 73 Z",
  "down-left":  "M30 55 L47 59 L16 73 Z",
  "down-right": "M53 59 L70 55 L84 73 Z"
};
function makeSpeechBubble(cfg) {
  const wrap = document.createElement("div");
  wrap.className = "sbub";
  const box = cfg.box || {};
  ["top", "left", "right", "bottom"].forEach(function (k) {
    if (box[k] != null) wrap.style[k] = box[k];
  });
  if (box.w != null) wrap.style.setProperty("--sbw", box.w + "px");
  if (cfg.rot)       wrap.style.setProperty("--sbrot", cfg.rot + "deg");

  const tailPath = SBUB_TAILS[cfg.tail] || SBUB_TAILS.down;
  wrap.innerHTML =
    '<svg class="sbub-svg" viewBox="0 0 100 74" aria-hidden="true">' +
      '<g class="sbub-shape">' +
        '<path d="' + tailPath + '"/>' +
        '<ellipse cx="50" cy="32" rx="47" ry="29"/>' +
      '</g>' +
    '</svg>';

  const t = document.createElement("div");
  t.className = "sbub-text";
  t.textContent = cfg.text || "";
  if (cfg.fontSize) t.style.fontSize = cfg.fontSize + "px";
  wrap.appendChild(t);
  return wrap;
}

/* ---- Build one scene's ambient FX layer (fx: on a scene) -----------------
   Types: "scan" (pure CSS beam), "popcorn" (falling kernels), "sparkle"
   (gold twinkles), {type:"pulse", x, y} (breathing glow at a point),
   "shake" (whole-scene jitter — a class on the layer, no element).
   Particle positions/timings are randomized once at build; the loops are
   pure CSS so they cost nothing to run. */
function makeFx(fx, layer) {
  const cfg = typeof fx === "string" ? { type: fx } : fx;
  if (cfg.type === "shake") {                  // CSS on the layer's media
    layer.classList.add("fx-shake");
    return null;
  }
  const el = document.createElement("div");
  el.className = "fx fx-" + cfg.type;
  el.setAttribute("aria-hidden", "true");
  if (cfg.type === "popcorn") {
    for (let i = 0; i < 14; i++) {             // kernels spill from the machine
      const k = document.createElement("i");
      k.className = "fx-kernel";
      k.style.left = (24 + Math.random() * 46) + "%";
      k.style.top  = (26 + Math.random() * 10) + "%";
      k.style.animationDelay    = (Math.random() * 2.4).toFixed(2) + "s";
      k.style.animationDuration = (1.7 + Math.random() * 1.1).toFixed(2) + "s";
      k.style.setProperty("--kx", (Math.random() * 140 - 70).toFixed(0) + "px");
      k.style.setProperty("--kr", (Math.random() * 500 - 250).toFixed(0) + "deg");
      k.style.setProperty("--ks", (0.6 + Math.random() * 0.7).toFixed(2));
      el.appendChild(k);
    }
  } else if (cfg.type === "sparkle") {
    for (let i = 0; i < 12; i++) {
      const s = document.createElement("i");
      s.className = "fx-spark";
      s.style.left = (8 + Math.random() * 84) + "%";
      s.style.top  = (8 + Math.random() * 72) + "%";
      s.style.animationDelay    = (Math.random() * 2.8).toFixed(2) + "s";
      s.style.animationDuration = (1.5 + Math.random() * 1.4).toFixed(2) + "s";
      el.appendChild(s);
    }
  } else if (cfg.type === "pulse") {
    const p = document.createElement("i");
    p.className = "fx-glow";
    p.style.left = cfg.x || "50%";
    p.style.top  = cfg.y || "50%";
    el.appendChild(p);
  }
  return el;
}

/* ---- Build the pages (one CSS 3D "leaf" per entry) ---------------------- */
const flipbookEl  = document.getElementById("flipbook");
const pageStackEl = flipbookEl ? flipbookEl.querySelector(".page-stack") : null;   // right-side page stack
const flipScaleEl = document.getElementById("flipScale");
const coverScene  = document.getElementById("coverScene");
// ONE full 16:9 page per view (single display). page 1 = entry 1. The themed
// book frame forms the left spine/cover edge (always visible when open); pages
// flip normally. No two-page spread.
const totalPages = pages.length;

// Each leaf is a full 16:9 page hinged on the LEFT spine:
//   • FRONT = the page's full-bleed image / video (+ its speech bubble, if any).
//   • BACK  = a BLANK parchment sheet (seen edge-on while the page turns).
const leaves = [];
pages.forEach(function (page, i) {
  const leaf = document.createElement("div");
  leaf.className = "leaf";

  const front = document.createElement("div");
  front.className = "face front";
  if (page.type === "end") {
    // THE END — a real final page in the BOOK's own night-and-gold look
    // (template-neutral: nothing story-specific, works for any story).
    front.classList.add("end-page");
    front.innerHTML =
      '<div class="end-page-inner">' +
        '<div class="end-rule" aria-hidden="true"><svg viewBox="0 0 24 24">' +
          '<path fill="currentColor" d="M12 2l2.2 7.8L22 12l-7.8 2.2L12 22l-2.2-7.8L2 12l7.8-2.2z"/>' +
        '</svg></div>' +
        '<div class="end-title">The End</div>' +
        '<div class="end-rule" aria-hidden="true"><svg viewBox="0 0 24 24">' +
          '<path fill="currentColor" d="M12 2l2.2 7.8L22 12l-7.8 2.2L12 22l-2.2-7.8L2 12l7.8-2.2z"/>' +
        '</svg></div>' +
        '<button class="replay-btn" id="replayBtn" type="button" aria-label="Read the story again">' +
          '<svg viewBox="0 0 24 24" aria-hidden="true">' +
            '<path d="M12 5V1L7 6l5 5V7c3.31 0 6 2.69 6 6s-2.69 6-6 6-6-2.69-6-6H4c0 4.42 3.58 8 8 8s8-3.58 8-8-3.58-8-8-8z"/>' +
          '</svg>' +
          '<span>Read again</span>' +
        '</button>' +
      '</div>';
  } else if (page.type === "interactive") {
    // PICK-A-HOTSPOT page: one still + a clip per hotspot, all in one leaf
    // (see buildHub for the layer order and hubOpen/hubReset for the behaviour).
    front.appendChild(buildHub(page));
  } else if (page.scenes) {
    // MULTI-SCENE page: the storyboard screens stack as full-bleed layers and
    // the scene player (playScenes) cross-dissolves through them. Scene 0
    // starts visible so the page has art on it while it turns. A scene whose
    // src is a video plays when its scene lands (see playScenes).
    page.scenes.forEach(function (sc, si) {
      const layer = document.createElement("div");
      layer.className = "page-scene" + (si === 0 ? " on" : "");
      const isVideo = /\.(mp4|webm)$/i.test(sc.src);
      layer.appendChild(makeMedia({ type: isVideo ? "video" : "image", src: sc.src, alt: sc.alt }));
      if (sc.fx) {
        const fxEl = makeFx(sc.fx, layer);     // ambient animation for this scene
        if (fxEl) layer.appendChild(fxEl);
      }
      if (sc.bubble) layer.appendChild(makeBubble(sc.bubble));
      front.appendChild(layer);
    });
  } else {
    front.appendChild(makeMedia(page));                       // full-bleed image / video
    if (page.bubble) front.appendChild(makeBubble(page.bubble));  // PNG speech bubble (revealed on land)
  }
  const curl = document.createElement("div");               // moving page-curl shading
  curl.className = "curl";
  front.appendChild(curl);

  const back = document.createElement("div");
  back.className = "face back";                             // blank reverse side (no content)
  const backCurl = document.createElement("div");           // sheen for the reverse side —
  backCurl.className = "curl";                              // the front curl is backface-hidden
  back.appendChild(backCurl);                               // past 90°, this shades the landing half

  leaf.appendChild(front);
  leaf.appendChild(back);
  flipbookEl.appendChild(leaf);
  leaves.push(leaf);
});

/* One shared, JS-driven shadow the TURNING sheet casts on the page beneath it —
   swept + faded per-frame from the live flip angle (see applyFlipFX). Hinged at
   the spine so scaleX(cos) mirrors it onto the landing side past 90°. Stacked
   above the resting pages (z250 in CSS), below the turning sheet (z300). */
const flipShadowEl = document.createElement("div");
flipShadowEl.className = "flip-shadow";
flipShadowEl.setAttribute("aria-hidden", "true");
flipbookEl.appendChild(flipShadowEl);

/* ---- State + element references ----------------------------------------- */
const bookStage  = document.getElementById("bookStage");
const book       = document.getElementById("book");
const bookPop    = document.getElementById("bookPop");
const bookFloat  = document.getElementById("bookFloat");
const cover      = document.getElementById("cover");
const hint       = document.getElementById("hint");
const cornerPrev  = document.getElementById("cornerPrev");
const cornerNext  = document.getElementById("cornerNext");
const replayBtn   = document.getElementById("replayBtn");   // lives on the THE END page (built above)

let opened = false;      // has the cover been opened?
let ready  = false;      // has the cover FINISHED opening? (flips allowed only then)
let flipped = 0;         // how many leaves are currently turned to the left
let animating = false;   // guard so a new turn can't start mid-flip
const FLIP_MS = 1150;    // keep in sync with --flip-ms in styles.css
const COVER_OPEN_MS = 3500;  // keep in sync with the coverOpen animation in styles.css
const CLOSE_SETTLE_MS = 560;  // keep in sync with the bookSettle animation in styles.css
const COVER_CLOSE_MS  = 2000; // Home/Replay: cover swings shut (reverse open); sync with coverClose in styles.css
let _openTimer = null;   // pending "cover finished opening" timer
let _mediaTimer = null;  // pending "start music + page-1 video" timer (fires just BEFORE the cover lands)
let _homeTimer = null;   // pending "cover finished closing → back to the cover" timer

/* ==========================================================================
   GSAP FLIP DRIVER  —  a physical, real-book page turn.
   When GSAP is available (gsap.min.js loads before this file) every turn is a
   multi-phase tween: the page LIFTS with effort (ease-in-out), FALLS under
   gravity (accelerating), touches down and gives a tiny landing BOUNCE. The
   curl shading is synced to the LIVE angle every frame, and a drag release
   falls from the exact angle you let go at, with a distance-scaled duration
   (the fixed-length CSS transition made short releases float unnaturally).
   If GSAP is missing, everything falls back to the original CSS flip.
   ========================================================================== */
// Reduced-motion users keep the CSS fallback: styles.css shortens those flips
// to 260ms, which the GSAP timelines would otherwise bypass.
const G = (window.gsap &&
           !(window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches))
          ? window.gsap : null;
const FLIP_S = FLIP_MS / 1000;                 // GSAP works in seconds

// Curl shading strength for a given turn angle (same curve the drag uses):
// ramps up to the edge-on point (90°), then back off as the page lies flat.
function curlFor(ang) {
  return (ang <= 90 ? ang / 90 : (180 - ang) / 90) * 0.9;
}

/* ---- Per-frame flip FX ------------------------------------------------------
   Everything that makes the turn read as a flexible SHEET OF PAPER instead of
   a rigid board, all derived from the live angle (0 = flat right, 180 = turned):
     • curl sheen on BOTH faces (front while lifting, back while landing)
     • the cast shadow sweeping across the page beneath the turning sheet
     • paper FLEX: the page media lags behind the board by an amount tied to
       the angular VELOCITY — so it bends on the lift, straightens edge-on and
       flutters on the landing bounce, like real paper
     • a gentle sag + lift of the whole sheet, strongest edge-on (returned to
       the caller: GSAP merges it into the tween; the drag composes it into
       its manual transform string)
   Shared by the GSAP turn, the drag-follow AND the ghost peek. */
let _fxBend = 0, _fxLastAng = null, _fxLastT = 0;
function applyFlipFX(leaf, ang) {
  const rad = ang * Math.PI / 180, s = Math.sin(rad);
  const co = curlFor(ang);
  leaf.querySelectorAll(".curl").forEach(function (c) { c.style.opacity = co; });
  // cast shadow: hinged at the spine; cos sweeps it right → left (mirroring
  // past 90°), sin fades it in and out around the edge-on point
  flipShadowEl.style.transform = "scaleX(" + Math.cos(rad).toFixed(4) + ")";
  flipShadowEl.style.opacity = (s * 0.45).toFixed(3);
  // paper flex: velocity-based lag, smoothed so it eases like real paper
  const now = performance.now();
  if (_fxLastAng != null) {
    const dt = now - _fxLastT;
    const vel = (dt > 0 && dt < 200) ? (ang - _fxLastAng) / dt * 1000 : 0;   // deg/s
    const target = Math.max(-4, Math.min(4, vel * 0.022));
    _fxBend += (target - _fxBend) * 0.28;
  }
  _fxLastAng = ang; _fxLastT = now;
  const media = leaf.querySelector(".page-media");
  if (media) {                                   // only while the front is visible (< 90°)
    media.style.transform = (ang < 95 && Math.abs(_fxBend) > 0.05)
      ? "perspective(1200px) rotateY(" + _fxBend.toFixed(2) + "deg)" +
        " scale(" + (1 + Math.abs(_fxBend) * 0.004).toFixed(4) + ")"
      : "";
  }
  return { sag: 2.2 * s, lift: 30 * s };
}
function clearFlipFX(leaf) {
  if (leaf) {
    leaf.querySelectorAll(".curl").forEach(function (c) { c.style.opacity = ""; });
    const media = leaf.querySelector(".page-media");
    if (media) media.style.transform = "";
  }
  flipShadowEl.style.opacity = "0";
  _fxBend = 0; _fxLastAng = null;
}

/* ==========================================================================
   PAGE-PEEL ENGINE  —  a real "corner peel" page turn (turn.js style).
   The sheet lifts from its bottom-right corner and peels across the page with
   a travelling fold:
     • the leaf's FRONT is clipped to the un-peeled region,
     • the folded-over part shows the sheet's blank tan BACK — the peeled
       region REFLECTED across the fold line — with a bright crease rolling
       into curved paper shading,
     • a shadow hugs the fold on the flat part and the lifted sheet casts a
       soft drop shadow past it.
   All geometry is exact 2D reflection math, computed per frame from P = where
   the page's bottom-right corner currently is (book coords). P rests at
   (PW,PH) and ends at (-PW,PH), fully folded over the left spine — which
   matches the .flipped pose (parked off-book left), so class semantics keep
   working. GSAP drives P; without GSAP the old CSS hinge flip runs instead.
   ========================================================================== */
const PW = 1280, PH = 720;                    // book-space page size
const PEEL_EMPTY = "inset(0 0 0 100%)";       // hide-the-whole-page clip (fully peeled)
let _peelTween = null;                        // the active corner tween (one at a time)
let peelFoldWrap = null, peelFold = null;     // shared folded-over sheet layers

function ensurePeelEls(leaf) {
  if (!peelFoldWrap) {
    peelFoldWrap = document.createElement("div");
    peelFoldWrap.className = "peel-foldwrap";
    peelFold = document.createElement("div");
    peelFold.className = "peel-fold";
    peelFoldWrap.appendChild(peelFold);
    flipbookEl.appendChild(peelFoldWrap);
  }
  if (!leaf._crease) {                        // fold-hugging shadow on the page front
    const c = document.createElement("div");
    c.className = "peel-crease";
    leaf.appendChild(c);
    leaf._crease = c;
  }
}

// Cut a convex polygon by the half-plane sideFn(p) >= 0 (Sutherland–Hodgman).
function clipHalf(poly, sideFn) {
  const out = [];
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i], b = poly[(i + 1) % poly.length];
    const sa = sideFn(a), sb = sideFn(b);
    if (sa >= 0) out.push(a);
    if ((sa >= 0) !== (sb >= 0)) {
      const u = sa / (sa - sb);
      out.push({ x: a.x + (b.x - a.x) * u, y: a.y + (b.y - a.y) * u });
    }
  }
  return out;
}
function polyCss(poly) {
  return "polygon(" + poly.map(function (p) {
    return p.x.toFixed(1) + "px " + p.y.toFixed(1) + "px";
  }).join(",") + ")";
}
function mixRGB(a, b, f) {                     // blend two [r,g,b] colours by f (0..1)
  return "rgb(" + Math.round(a[0] + (b[0] - a[0]) * f) + "," +
                  Math.round(a[1] + (b[1] - a[1]) * f) + "," +
                  Math.round(a[2] + (b[2] - a[2]) * f) + ")";
}

/* Render ONE frame of the peel for the given corner position P. */
function renderPeel(leaf, P) {
  ensurePeelEls(leaf);
  const crease = leaf._crease;
  const dx = PW - P.x, dy = PH - P.y;          // corner displacement (rest − current)
  const dl = Math.hypot(dx, dy);
  if (dl < 1.5) {                              // corner at rest → flat, unclipped page
    leaf.style.clipPath = "";
    crease.style.display = "none";
    peelFoldWrap.style.display = "none";
    return;
  }
  const nx = dx / dl, ny = dy / dl;            // fold normal (points to the peeled side)
  const mx = (PW + P.x) / 2, my = (PH + P.y) / 2;  // the fold passes through this midpoint
  function side(p) { return (p.x - mx) * nx + (p.y - my) * ny; }
  const rect = [{ x: 0, y: 0 }, { x: PW, y: 0 }, { x: PW, y: PH }, { x: 0, y: PH }];
  const front  = clipHalf(rect, function (p) { return -side(p); });   // still lying flat
  const peeled = clipHalf(rect, side);                                // lifted + folded over
  if (peeled.length < 3) {
    // Nothing (or a degenerate sliver) is lifted. A <3-point polygon() is
    // INVALID CSS — the fold layer would paint UNCLIPPED as a full-box tan
    // flash — so treat this as a flat page instead.
    leaf.style.clipPath = "";
    crease.style.display = "none";
    peelFoldWrap.style.display = "none";
    return;
  }
  leaf.style.clipPath = front.length > 2 ? polyCss(front) : PEEL_EMPTY;
  // Folded-over part = the peeled region reflected across the fold line.
  const back = peeled.map(function (p) {
    const s = side(p);
    return { x: p.x - 2 * s * nx, y: p.y - 2 * s * ny };
  });
  // SHADING STRENGTH: ramps in the moment the corner lifts, and MELTS AWAY over
  // the last stretch of the turn — so the landed sheet blends seamlessly into
  // the parked page on the left with no crease/shadow pop at the end.
  const p01 = Math.min(1, dl / (2 * PW));      // 0 = corner at rest … 1 = fully turned
  const kOut = p01 < 0.8 ? 1 : Math.max(0, (1 - p01) / 0.2);
  const k = Math.min(1, p01 * 10) * kOut;
  // The fold layer's box spans -PW..PW in book space (so the sheet stays
  // visible while it lands LEFT of the book): element x = book x + PW.
  peelFold.style.clipPath = "polygon(" + back.map(function (p) {
    return (p.x + PW).toFixed(1) + "px " + p.y.toFixed(1) + "px";
  }).join(",") + ")";
  // Both gradients run along -n (from the fold INTO the page). CSS measures
  // gradient stops from the gradient line's start (center − dir·L/2), so find
  // where the fold sits along that line (per element box) and hang stops off it.
  const gx = -nx, gy = -ny;
  const theta = Math.atan2(gx, -gy) * 180 / Math.PI;
  // shadow hugging the fold on the flat part (leaf box: PW × PH)
  const L1 = Math.abs(PW * gx) + Math.abs(PH * gy);
  const s1 = (mx - (PW / 2 - gx * L1 / 2)) * gx + (my - (PH / 2 - gy * L1 / 2)) * gy;
  crease.style.display = "block";
  crease.style.background = "linear-gradient(" + theta.toFixed(2) + "deg, rgba(13,24,50," +
    (0.34 * k).toFixed(3) + ") " + s1.toFixed(1) + "px, rgba(13,24,50," +
    (0.13 * k).toFixed(3) + ") " + (s1 + 46).toFixed(1) + "px, rgba(13,24,50,0) " +
    (s1 + 130).toFixed(1) + "px)";
  // the folded-over back (fold box: 2PW × PH): a bright crease rolling into warm
  // tan — every stop eased back to the resting paper tones as the sheet lands
  const FW = 2 * PW;
  const L2 = Math.abs(FW * gx) + Math.abs(PH * gy);
  const s2 = ((mx + PW) - (PW - gx * L2 / 2)) * gx + (my - (PH / 2 - gy * L2 / 2)) * gy;
  // MUST equal --page-back / --page-back-2 in styles.css (warm cream page back)
  const BASE = [244, 234, 211], DEEP = [221, 201, 160];
  peelFold.style.background = "linear-gradient(" + theta.toFixed(2) + "deg, " +
    mixRGB(BASE, [255, 253, 246], k) + " " + s2.toFixed(1) + "px, " +
    mixRGB(BASE, [252, 242, 210], k) + " " + (s2 + 26).toFixed(1) + "px, " +
    "rgb(244,234,211) " + (s2 + 70).toFixed(1) + "px, " +
    mixRGB(DEEP, [206, 184, 138], k) + " " + (s2 + 260).toFixed(1) + "px)";
  // soft shadow the lifted sheet casts past the fold — fades out as it lands
  peelFoldWrap.style.display = "block";
  peelFoldWrap.style.filter = "drop-shadow(" + (gx * 14).toFixed(1) + "px " +
    (gy * 14 + 5).toFixed(1) + "px 16px rgba(13,24,50," +
    (0.42 * (0.15 + 0.85 * kOut)).toFixed(3) + "))";
}

/* Canonical corner path for arrow/keyboard turns + the idle peek: a quadratic
   Bezier from the resting corner, LIFTING through mid-page, down to the
   fully-turned mirror corner past the spine. */
function peelPath(t) {
  const u = 1 - t;
  return {
    x: u * u * PW + 2 * u * t * (PW * 0.10) + t * t * (-PW),
    y: u * u * PH + 2 * u * t * (PH - 620) + t * t * PH
  };
}
/* Keep a dragged corner physical: paper can't stretch, so P stays within reach
   of the spine's two anchor points (bottom-left and top-left of the page). */
function clampPeelP(p) {
  let x = p.x, y = Math.min(p.y, PH);
  let vx = x, vy = y - PH, d = Math.hypot(vx, vy);       // anchor (0, PH), radius PW
  if (d > PW) { x = vx / d * PW; y = PH + vy / d * PW; }
  const R = Math.hypot(PW, PH);
  vx = x; vy = y; d = Math.hypot(vx, vy);                // anchor (0, 0), radius diagonal
  if (d > R) { x = vx / d * R; y = vy / d * R; }
  return { x: x, y: y };
}
/* Pointer event → book-space coordinates (the 1280×720 the geometry lives in). */
function bookPt(e) {
  const r = flipbookEl.getBoundingClientRect();
  return { x: (e.clientX - r.left) / r.width * PW, y: (e.clientY - r.top) / r.height * PH };
}

/* Finish a peel: clear the per-frame layers and hand the pose back to the
   .flipped class (transition suppressed so nothing re-animates). */
function peelEnd(leaf) {
  renderLeaves();                              // resting classes for the final state
  leaf.style.clipPath = "";
  if (leaf._crease) leaf._crease.style.display = "none";
  if (peelFoldWrap) peelFoldWrap.style.display = "none";
  leaf.style.transition = "none";
  leaf.style.transform = "";
  void leaf.offsetWidth;                       // commit with no transition
  leaf.style.transition = "";
  updateZ();
}

/* ---- CLOSE CASCADE — the "real book close" for Home / Replay ---------------
   Riffle every turned page back to the right, one after another: the top of
   the left pile (the most recently turned page) falls first, and each later
   sheet lands ON TOP of the one before, so the book visibly returns to page 1
   — then the caller swings the cover shut. Each fall gets a flip sound (a
   quick riffle). Without GSAP (or with no pages turned) it calls done()
   immediately and the old instant close runs. */
function cascadeClose(done) {
  const n = flipped;
  if (!G || n <= 0) { done(); return; }
  if (_peelTween) { _peelTween.kill(); _peelTween = null; }
  const falling = leaves.slice(0, n);
  // Riffle stagger / one sheet's fall. Paced like the finale it is (matching
  // rewindToStart), NOT like a mid-book jump: wide enough that the reader reads
  // the pages coming back ONE BY ONE. It was 0.085/0.38 while the sheets were
  // still being hidden by the windowing — nothing was visible to pace.
  const STAG = 0.12, FALL = 0.52;
  sfxRiffle(Math.min(n, 12), STAG);        // one swoosh per falling sheet (see cascadeTo)
  falling.forEach(function (l) { l.style.transition = "none"; });   // GSAP owns the motion
  const tl = G.timeline({
    onComplete: function () {
      flipped = 0;
      renderLeaves();                        // every leaf officially unflipped again
      falling.forEach(function (l) {
        G.set(l, { clearProps: "transform,transformOrigin" });
        l.style.zIndex = "";
        void l.offsetWidth;                  // commit while transitions are off
        l.style.transition = "";
      });
      updateZ();
      done();
    }
  });
  for (let k = 0; k < n; k++) {
    const leaf = leaves[n - 1 - k];          // most recently turned page falls first
    const at = k * STAG;                     // riffle stagger
    tl.set(leaf, { zIndex: 320 + k }, at);   // later sheets land ON TOP → page 1 ends up top
    tl.call(wakeLeaf, [leaf], at);           // …and it must be VISIBLE to be seen falling
    tl.fromTo(leaf, { rotationY: -180, transformOrigin: "left center" },
                    { rotationY: 0, duration: FALL, ease: "power2.in" }, at);
    // Back to sleep the moment the NEXT sheet has landed over it, so however
    // long the story is only a few layers are ever live at once. The last sheet
    // down (page 1) is left awake — nothing lands on top of it.
    if (k + 1 < n) tl.call(sleepLeaf, [leaf], (k + 1) * STAG + FALL);
  }
}

/* Full peel turn for the arrows / keyboard: drive the corner along peelPath. */
function peelTurn(leaf, forward, opts) {
  if (_peelTween) { _peelTween.kill(); _peelTween = null; }
  ensurePeelEls(leaf);
  const proxy = { t: forward ? 0 : 1 };
  leaf.style.transition = "none";
  leaf.style.transform = "none";               // flat — the travelling fold does the turning
  renderPeel(leaf, peelPath(proxy.t));
  renderLeaves();                              // final classes now (the inline flat overrides)
  leaf.style.zIndex = 300;                     // keep the peeling sheet on top
  _peelTween = G.to(proxy, {
    t: forward ? 1 : 0,
    duration: FLIP_S,
    ease: "power2.inOut",
    onUpdate: function () { renderPeel(leaf, peelPath(proxy.t)); },
    onComplete: function () {
      _peelTween = null;
      peelEnd(leaf);
      if (opts && opts.done) opts.done();
    }
  });
}

/* ---- Responsive: scale the FIXED 1280x720 book to fit the viewport --------
   ORIGINAL fit — 96% of width / 84% of height — so the book size and the arrows
   (which stay at the viewport's bottom corners, via CSS) look exactly as before.
   The ONLY addition is a safeguard on SHORT screens: never let the book grow so
   tall that it covers the bottom controls. That safeguard changes nothing on
   normal/large screens (there the 0.84 factor is the smaller of the two); it only
   shrinks the book a little on small screens so the arrows + progress stay visible.
   Only this CSS transform scale changes, so the paper curl is never distorted. */
function fitScale() {
  const CTRL = 64;                                   // min top/bottom room kept for the controls
  const availW = window.innerWidth * 0.88;           // leave breathing space on the left + right
  const availH = Math.min(window.innerHeight * 0.80, window.innerHeight - CTRL * 2);
  const s = Math.min(availW / 1280, availH / 720);
  flipScaleEl.style.setProperty("--book-scale", s.toFixed(4));
  // The nav arrows sit UNDER the book's bottom corners: BACK below the
  // bottom-LEFT corner, NEXT below the bottom-RIGHT — horizontally centred
  // on each corner, with the arrow art fully BELOW the book edge (never
  // touching it). The gold glyph fills the middle ~58% of the button box,
  // so the box is placed with that inset in mind; the button shrinks when
  // the strip under the book is tight.
  const bookW = 1280 * s, bookH = 720 * s, edge = 18 * s;
  const cornerL = (window.innerWidth  - bookW) / 2 - edge;
  const cornerR = (window.innerWidth  + bookW) / 2 + edge;
  const cornerY = (window.innerHeight + bookH) / 2 + edge;   // book bottom edge
  const room = window.innerHeight - cornerY - 6;             // strip below the box
  // The arrows are GOLD-RIMMED BUBBLES (the bubble fills the middle 84% of the
  // button box — see .corner-arrow::before, inset 8%). Two numbers matter here:
  //   GAP — clear air between the book's bottom edge and the TOP of the bubble,
  //         so the buttons never touch the page art. It has to survive the
  //         :hover scale(1.12) too, which lifts the bubble's top by ~5% of the
  //         box; GAP is comfortably larger than that.
  //   btn — the box size. Deliberately a touch smaller than the book-scaled
  //         124px it used to be, so the pair reads as buttons BESIDE the book
  //         rather than part of it.
  const GAP = Math.max(8, Math.round(14 * s));
  const btn = Math.max(50, Math.min(116, Math.round(106 * s),
                                    Math.floor((room - GAP) / 0.95)));
  const rs = document.documentElement.style;
  rs.setProperty("--arrow-size", btn + "px");
  // box top = bubble top - the 8% inset, so the bubble's own top lands at GAP
  // below the book edge no matter how big the button ends up.
  rs.setProperty("--arrow-y", Math.round(cornerY + GAP - 0.08 * btn) + "px");
  rs.setProperty("--back-x",  Math.round(cornerL - btn / 2) + "px");
  rs.setProperty("--fwd-x",   Math.round(cornerR - btn / 2) + "px");
  // keep the page-turn hint glued to the forward arrow when the viewport changes
  if (flipHint && flipHint.classList.contains("show")) positionFlipHint();
}

/* ---- Render / stacking for the CSS leaf flip ---------------------------- */
// A TURNED leaf sits to the left (rotateY -180deg, showing its blank back over
// the cover); an UN-turned leaf lies flat on top of the cover. z-index keeps the
// current (top un-turned) page in front, and stacks more-recently turned leaves
// above earlier ones on the left pile.
function updateZ() {
  leaves.forEach(function (leaf, i) {
    leaf.style.zIndex = (i < flipped) ? (200 + i) : (100 - i);
  });
}
function renderLeaves() {
  leaves.forEach(function (leaf, i) {
    if (i < flipped) leaf.classList.add("flipped");
    else             leaf.classList.remove("flipped");
  });
  updateZ();
  // Re-window the compositing layers on EVERY navigation — this is the only
  // thing standing between the book and GPU texture eviction (see windowLeaves).
  windowLeaves();
}

/* ---- Per-page media -----------------------------------------------------
   Play the CURRENT page's video (pause every other), and pop the current page's
   speech bubble in ONCE, only after the page has fully settled. Called after
   each flip completes and once the cover has finished opening. */
let mediaDelayTimer = null;   // pending "start this video after N ms" timer
let mediaDelayIdx = -1;       // which page that pending timer belongs to
let lastMediaIdx = -1;        // last page refreshMedia handled (to arm the blink once)
let armBlink = false;         // allow the video-end arrow blink ONCE per page arrival

/* HOLD UNTIL THE PAGE HAS LANDED. A page's clip must not start while its sheet
   is still in the air: the opening seconds play against folding paper and the
   voice-over talks over the page-turn swoosh. So an arrival that happens mid-turn
   parks the clip on frame 0, and the turn's own completion callback (which sets
   animating = false and re-calls refreshMedia) is what starts it.

   The poll below is only a BACKSTOP for the case where that callback never comes
   — a killed tween, a stuck animating flag, a path added later. A page whose
   video never starts also never unlocks the forward turn, so the reader would be
   trapped.

   It WAITS ON `animating`, it does not race a stopwatch. A fixed "FLIP_MS + a
   bit" timer looks equivalent and isn't: the peel is a GSAP tween driven by
   requestAnimationFrame, so on a throttled tab, a slow device or under heavy
   decode load the turn takes longer in wall-clock than FLIP_MS — and the timer
   then fires FIRST and starts the clip mid-flip, on exactly the machines where
   the problem is most visible. (Measured: a headless run with rAF throttled took
   >2.6s for a 1.15s turn, and a FLIP_MS+400 timer duly pre-empted it.) The hard
   cap only exists so a permanently stuck flag can't hold the clip forever. */
const HELD_MEDIA_POLL_MS = 120;
const HELD_MEDIA_CAP_MS  = FLIP_MS * 6;      // absolute give-up (~7s)
let heldMediaTimer = null;
function holdVideoForFlip(idx, v) {
  clearTimeout(heldMediaTimer);
  const startedAt = Date.now();
  (function poll() {
    heldMediaTimer = setTimeout(function () {
      heldMediaTimer = null;
      if (flipped !== idx) return;                   // reader moved on — drop it
      if (animating && Date.now() - startedAt < HELD_MEDIA_CAP_MS) return poll();
      if (!v.paused || v.ended || v._tapOpen) return;   // the turn already started it
      console.warn("[flipbook] page " + (idx + 1) + " — the turn never re-asserted " +
                   "its media; starting the clip from the backstop.");
      playVideoNow(v);
    }, HELD_MEDIA_POLL_MS);
  })();
}

/* ---- TAP-GATE — an interactive beat INSIDE a full-page video --------------
   story.js marks a video page with  tap: { time, x, y, w, h } :
     • when the clip reaches `time` (s) it PAUSES on that frame,
     • a pulsing ring + tapping hand point at (x, y) — the on-screen switch,
     • the gate swallows every tap except the hotspot (w × h around x,y),
     • tapping the hotspot hides the gate and the clip plays on.
   Re-arms on every (re)visit: refreshMedia clears _tapDone when it restarts
   the clip from 0. While the gate is open, _tapOpen stops every re-assert
   path from resuming the video behind the reader's back. */
function showTapGate(v, cfg) {
  const face = v.parentElement;
  if (!face) return;
  let gate = face.querySelector(".tap-gate");
  if (!gate) {
    gate = document.createElement("div");
    gate.className = "tap-gate";
    const ring = document.createElement("div");
    ring.className = "tap-ring";
    const hand = document.createElement("div");
    hand.className = "tap-hand";
    hand.textContent = "👆";
    const spot = document.createElement("button");
    spot.type = "button"; spot.className = "tap-spot";
    spot.setAttribute("aria-label", "Tap the switch");
    gate.appendChild(ring); gate.appendChild(hand); gate.appendChild(spot);
    // Stray taps stay on the gate — they must never reach the video (whose
    // own click handler would resume it). Only the hotspot resumes.
    gate.addEventListener("click", function (e) { e.stopPropagation(); });
    spot.addEventListener("click", function (e) {
      e.stopPropagation();
      hideTapGate(v);
      playVideoNow(v);                    // a real user gesture → resume WITH sound
    });
    face.appendChild(gate);
  }
  gate.querySelector(".tap-spot").style.cssText =
    "left:" + cfg.x + ";top:" + cfg.y +
    ";width:" + (cfg.w || "22%") + ";height:" + (cfg.h || "50%");
  gate.querySelector(".tap-ring").style.cssText = "left:" + cfg.x + ";top:" + cfg.y;
  gate.querySelector(".tap-hand").style.cssText = "left:" + cfg.x + ";top:" + cfg.y;
  v._tapOpen = true;
  gate.classList.add("show");
}
function hideTapGate(v) {
  v._tapOpen = false;
  const gate = v.parentElement && v.parentElement.querySelector(".tap-gate");
  if (gate) gate.classList.remove("show");
}

/* ---- INTERACTIVE PAGE (hub) — pick a hotspot, watch its clip ---------------
   The reader taps one of the hand-nudged places on the still; that hotspot's
   clip cross-dissolves in (it is already sitting in a layer BEHIND the still —
   see buildHub), plays with sound, then dissolves back to the still and hands
   the page over with the REMAINING nudges. A tapped nudge is spent.

   Per-visit state lives on the .hub element:
     hub._watched      Set of hotspot indexes already watched
     hub.dataset.playing   index of the clip on screen (absent = showing the still)
   Both are cleared by hubReset, which runs on every fresh arrival — so leaving
   the page and coming back restores all three nudges. */
const HUB_DISSOLVE_MS = 480;                 // keep in sync with .hub-vid / .hub-still in styles.css

function hubEl(leaf) { return leaf ? leaf.querySelector(".hub") : null; }

function hubOpen(hub, i) {
  const leaf = hub.closest(".leaf");
  const idx  = leaves.indexOf(leaf);
  if (idx !== flipped || animating || !ready) return;   // only the settled front page
  if (hub.dataset.playing) return;                      // one clip at a time
  const v = hub.querySelector('video.hub-vid[data-hub="' + i + '"]');
  if (!v) return;

  hub.dataset.playing = String(i);
  hub.classList.add("playing");               // still fades out; every nudge fades away
  const spot  = hub.querySelector('.hub-spot[data-hub="' + i + '"]');
  const nudge = hub.querySelector('.hub-nudge[data-hub="' + i + '"]');
  if (spot)  spot.disabled = true;            // spent: this spot is done for this visit
  if (nudge) nudge.classList.add("spent");    // …and its hand never comes back

  v.classList.add("on");
  try { v.currentTime = 0; } catch (_) {}
  playVideoNow(v);                            // a real user gesture → plays WITH sound
  if (!v._hubEnd) {                           // attach once; the clip is reused every visit
    v._hubEnd = function () { hubClose(hub, i); };
    v.addEventListener("ended", v._hubEnd);
    // A clip that cannot load must not strand the reader on a locked page.
    v.addEventListener("error", function () { if (hub.dataset.playing) hubClose(hub, i); });
  }
  // Third path, same reasoning as armDialogueWatchdog: this page keeps Next
  // LOCKED until all three clips have been watched, so a hotspot clip that
  // stalls without ever firing 'ended' or 'error' would lock the reader out of
  // the rest of the book. Close the hotspot ourselves if it overruns.
  if (v._hubWatchdog) clearTimeout(v._hubWatchdog);
  v._hubWatchdog = setTimeout(function () {
    v._hubWatchdog = null;
    if (hub.dataset.playing !== String(i)) return;      // finished normally
    console.warn("[flipbook] watchdog closed hotspot " + i + " — clip never ended.");
    hubClose(hub, i);
  }, (isFinite(v.duration) && v.duration > 0 ? v.duration * 1000 : 15000) + WATCHDOG_GRACE_MS);
}

function hubClose(hub, i) {
  if (hub.dataset.playing !== String(i)) return;        // stale end (already left/reset)
  const v = hub.querySelector('video.hub-vid[data-hub="' + i + '"]');
  delete hub.dataset.playing;
  hub.classList.remove("playing");            // the still fades back in with the nudges
  if (v) {
    v.classList.remove("on");
    try { v.pause(); } catch (_) {}
    // Rewind only AFTER the dissolve, so the last frame doesn't snap back to
    // frame 0 in full view of the reader.
    setTimeout(function () {
      if (hub.dataset.playing !== String(i)) { try { v.currentTime = 0; } catch (_) {} }
    }, HUB_DISSOLVE_MS + 60);
  }
  if (!hub._watched) hub._watched = new Set();
  hub._watched.add(i);

  // All hotspots watched → the page has "played out": unlock the forward turn
  // (the same contract a full-page video has when its clip ends).
  const leaf  = hub.closest(".leaf");
  const idx   = leaves.indexOf(leaf);
  const page  = pages[idx];
  const total = (page && page.hotspots) ? page.hotspots.length : 0;
  if (total && hub._watched.size >= total && idx === flipped) dialogueDone(idx);
}

/* Fresh visit: every nudge back, the still on top, every clip parked at frame 0. */
function hubReset(leaf) {
  const hub = hubEl(leaf);
  if (!hub) return;
  hub._watched = new Set();
  delete hub.dataset.playing;
  hub.classList.remove("playing");
  hub.querySelectorAll("video.hub-vid").forEach(function (v) {
    v.classList.remove("on");
    try { v.pause(); v.currentTime = 0; } catch (_) {}
    if (v._sfxStop) v._sfxStop(true);       // rewind this clip's ambient bed too
  });
  hub.querySelectorAll(".hub-nudge").forEach(function (n) { n.classList.remove("spent"); });
  hub.querySelectorAll(".hub-spot").forEach(function (b) { b.disabled = false; });
}

/* Silence a hub the reader has just left — its voice-over must not carry on
   behind another page (the full reset follows once the turn has finished). */
function hubStop(leaf) {
  const hub = hubEl(leaf);
  if (!hub) return;
  hub.querySelectorAll("video.hub-vid").forEach(function (v) {
    try { v.pause(); } catch (_) {}
    if (v._sfxStop) v._sfxStop(true);        // …and its ambient bed
  });
}

/* Has this hub been touched at all? (Used to decide whether leaving it needs a
   reset pass — an untouched hub is already in its resting state.) */
function hubTouched(leaf) {
  const hub = hubEl(leaf);
  if (!hub) return false;
  return !!hub.dataset.playing || !!(hub._watched && hub._watched.size);
}

/* Buffer every hotspot clip so the first tap starts instantly. They are short,
   and only ever the hub the reader is standing on gets warmed. */
function hubWarm(leaf) {
  const hub = hubEl(leaf);
  if (!hub) return;
  hub.querySelectorAll("video.hub-vid").forEach(function (v) {
    if (v.preload !== "auto") { v.preload = "auto"; try { v.load(); } catch (_) {} }
  });
}

function playVideoNow(v) {
  try {
    v.preload = "auto";                       // make sure it's buffering before we play
    if (v.ended) v.currentTime = 0;
    v.muted = false;                          // try WITH sound (primed in the Play gesture)
    const p = v.play();
    if (p && p.catch) p.catch(function () { v.muted = true; v.play().catch(function () {}); });
  } catch (_) {}
}

/* Buffer ONE page's video on demand (only the current + next page are ever
   warmed, so we never spin up all 25 decoders at once). */
function warmVideo(i) {
  const leaf = leaves[i];
  if (!leaf) return;
  // :not(.hub-vid) — an interactive page's hotspot clips are not the page's own
  // video; hubWarm buffers those (and only for the hub being read).
  const v = leaf.querySelector("video.page-media:not(.hub-vid)");
  if (v && v.preload !== "auto") { v.preload = "auto"; try { v.load(); } catch (_) {} }
}

/* Unlock ONE page's video for instant, sound-enabled playback: a muted
   play()→pause() done INSIDE a user gesture. We prime only the page being shown
   and the next one — priming all 25 at once was the opening lag. */
function primeVideo(i) {
  const leaf = leaves[i];
  if (!leaf) return;
  const v = leaf.querySelector("video.page-media:not(.hub-vid)");
  if (!v || v.dataset.primed) return;
  v.dataset.primed = "1";
  try {
    v.muted = true; v.preload = "auto";
    const p = v.play();                       // start within the gesture → element is "activated"
    if (p && p.catch) p.catch(function () {});
    v.pause();                                // pause synchronously
    v.currentTime = 0;
  } catch (_) {}
}

/* ==========================================================================
   DIALOGUE + SCENE PLAYER  —  the LXD presentation rules, in code:
     • bubble reveal  = Pop (On Enter)  → the existing bubblePop CSS animation
     • text reveal    = Typewriter (On Enter), speed adjustable per bubble
     • scenes on a page cross-DISSOLVE (1.1s), each popping its own bubble
   Bubbles replay every time the reader lands on the page ("On Enter"): when a
   page is LEFT, its dialogue resets (delayed until the turn finishes so
   nothing blanks mid-flip).
   ========================================================================== */
const TYPE_MS       = 45;     // default typewriter speed (ms per character)
const TYPE_LAG_MS   = 260;    // typing starts as the pop settles
const DISSOLVE_MS   = 1100;   // scene cross-dissolve (sync with .page-scene CSS)
const SCENE_HOLD_MS = 1600;   // default linger after typing ends, before dissolving

/* ---- Pausable dialogue timers -------------------------------------------
   Every dialogue timer (scene holds, typewriter ticks, bubble reveals) runs
   through dlgWait so the whole playback can FREEZE and RESUME in place —
   each record knows its deadline, so pause stores the remaining time and
   resume re-arms it. (Used by the TEMP test button; also useful later for
   audio sync.) A timer created WHILE paused stays parked until resume. */
let dlgPaused = false;
let dlgTimers = [];                          // live records: {fn, remaining, deadline, id}
function dlgDrop(rec) {
  const i = dlgTimers.indexOf(rec);
  if (i >= 0) dlgTimers.splice(i, 1);
}
function dlgWait(fn, ms) {
  const rec = { fn: fn, remaining: ms, deadline: 0, id: 0 };
  if (!dlgPaused) {
    rec.deadline = performance.now() + ms;
    rec.id = setTimeout(function () { dlgDrop(rec); fn(); }, ms);
  }
  dlgTimers.push(rec);
  return rec;
}
function dlgKill(rec) {                      // cancel one record (returns null)
  if (rec) { clearTimeout(rec.id); dlgDrop(rec); }
  return null;
}
function dlgPause() {
  if (dlgPaused) return;
  dlgPaused = true;
  const now = performance.now();
  dlgTimers.forEach(function (r) {
    clearTimeout(r.id); r.id = 0;
    r.remaining = Math.max(0, r.deadline - now);
  });
  // freeze any scene video mid-play (its 'ended' advance freezes with it)
  document.querySelectorAll(".page-scene video.page-media").forEach(function (v) {
    if (!v.paused && !v.ended) { v._dlgWasPlaying = true; try { v.pause(); } catch (_) {} }
  });
}
function dlgResume() {
  if (!dlgPaused) return;
  dlgPaused = false;
  dlgTimers.forEach(function (r) {
    r.deadline = performance.now() + r.remaining;
    r.id = setTimeout(function () { dlgDrop(r); r.fn(); }, r.remaining);
  });
  document.querySelectorAll(".page-scene video.page-media").forEach(function (v) {
    if (v._dlgWasPlaying) {
      v._dlgWasPlaying = false;
      const p = v.play(); if (p && p.catch) p.catch(function () {});
    }
  });
}

/* Lay the bubble's text out as INVISIBLE per-char spans: the final layout is
   built up-front (so the text never re-wraps mid-type) but no character shows
   until the typewriter reveals it. MUST run before the bubble pops in —
   otherwise the plain text flashes visible during the pop. */
function prepBubbleText(bub) {
  const t = bub.querySelector(".bubble-text");
  if (!t) return;
  const full = t.dataset.full != null ? t.dataset.full : t.textContent;
  t.dataset.full = full;
  t.textContent = "";
  Array.prototype.forEach.call(full, function (ch) {
    const s = document.createElement("span");
    s.textContent = ch;
    s.style.visibility = "hidden";
    t.appendChild(s);
  });
}

/* Typewriter: reveal the prepared invisible spans one by one. */
function typeBubbleText(bub) {
  const t = bub.querySelector(".bubble-text");
  if (!t) return;
  if (!t.querySelector("span")) prepBubbleText(bub);   // safety: not prepped yet
  const spans = t.querySelectorAll("span");
  const ms = +bub.dataset.typeSpeed || TYPE_MS;
  let i = 0;
  (function tick() {
    if (i >= spans.length) { bub._typeTimer = null; return; }
    spans[i++].style.visibility = "visible";
    bub._typeTimer = dlgWait(tick, ms);
  })();
}

/* Pop the bubble in NOW (empty — its text is hidden spans), then start
   typing as the pop settles. Runs once per page visit. */
function revealBubbleNow(bub) {
  if (!bub || bub.dataset.revealed) return;
  bub.dataset.revealed = "1";
  prepBubbleText(bub);                                         // hide text FIRST
  bub.classList.add("revealed");                               // Pop (On Enter)
  bub._typeStartTimer = dlgWait(function () {
    bub._typeStartTimer = null;                // cleared → "typing has begun"
    typeBubbleText(bub);
  }, TYPE_LAG_MS);
}

/* Put a bubble back to its hidden, un-typed state (for the next visit). */
function resetBubble(bub) {
  dlgKill(bub._revealTimer); dlgKill(bub._typeStartTimer); dlgKill(bub._typeTimer);
  bub._revealTimer = bub._typeStartTimer = bub._typeTimer = null;
  delete bub.dataset.revealed;
  delete bub.dataset.sched;
  bub.classList.remove("revealed");
  const t = bub.querySelector(".bubble-text");
  if (t && t.dataset.full != null) t.textContent = t.dataset.full;
}

/* ---- Scene player ---------------------------------------------------------
   Walks a page's `scenes`: reveal bubble → type → hold → 1.1s cross-dissolve
   to the next scene → its bubble pops as the dissolve lands → … The last
   scene simply stays. All timers are tracked so leaving the page stops them. */
let scenePlayPage = -1, sceneTimers = [], scenePlayRun = 0;
let sceneSeqDone = -1;                         // page whose scene sequence has PLAYED OUT
function sceneWait(fn, ms) { sceneTimers.push(dlgWait(fn, ms)); }
function stopScenes() {
  sceneTimers.forEach(dlgKill);
  sceneTimers = [];
  scenePlayPage = -1;
  sceneSeqDone = -1;
  scenePlayRun++;                              // invalidates pending video-ended advances
}
function resetScenes(leaf) {                   // back to scene 0, bubbles + videos fresh
  leaf.querySelectorAll(".page-scene").forEach(function (l, i) {
    l.classList.toggle("on", i === 0);
    const b = l.querySelector(".bubble");
    if (b) resetBubble(b);
    const v = l.querySelector("video.page-media");
    if (v) {
      if (v._sceneAdv) { v.removeEventListener("ended", v._sceneAdv); v._sceneAdv = null; }
      try { v.pause(); v.currentTime = 0; } catch (_) {}
    }
  });
}
function playScenes(idx, startDelay) {
  if (scenePlayPage === idx) return;           // already running on this page
  stopScenes();
  scenePlayPage = idx;
  const run = scenePlayRun;                    // this playback session's token
  const leaf = leaves[idx], scs = pages[idx].scenes;
  const layers = leaf.querySelectorAll(".page-scene");
  resetScenes(leaf);
  (function showScene(si, revealDelay) {
    const layer = layers[si];
    if (!layer) return;
    const sc  = scs[si];
    const bub = layer.querySelector(".bubble");
    const vid = layer.querySelector("video.page-media");
    let typedMs = 0;
    if (vid) sceneWait(function () { playVideoNow(vid); }, revealDelay);
    if (bub) {
      const t = bub.querySelector(".bubble-text");
      const full = (t && t.dataset.full) || "";
      typedMs = TYPE_LAG_MS + full.length * (+bub.dataset.typeSpeed || TYPE_MS);
      sceneWait(function () { revealBubbleNow(bub); }, revealDelay);
    }
    if (si + 1 < layers.length) {
      const goNextScene = function () {
        if (run !== scenePlayRun || scenePlayPage !== idx) return;   // stale
        layer.classList.remove("on");          // cross-dissolve: old fades out…
        layers[si + 1].classList.add("on");    // …new fades in (1.1s, CSS)
        showScene(si + 1, DISSOLVE_MS);        // next bubble pops as it lands
      };
      if (vid && (!sc || sc.hold == null)) {
        // video scene with no explicit hold → move on when the clip ends
        vid._sceneAdv = goNextScene;
        vid.addEventListener("ended", goNextScene, { once: true });
      } else {
        const hold = (sc && sc.hold != null) ? sc.hold : SCENE_HOLD_MS;
        sceneWait(goNextScene, revealDelay + typedMs + hold);
      }
    } else {
      // LAST scene of the page: signal once its dialogue has fully played out
      // (typing done / video ended / narrator hold over) → the page-turn nudge
      // may arm (it waits HINT_AFTER_DONE_MS more, see dialogueDone).
      const seqDone = function () {
        if (run !== scenePlayRun || scenePlayPage !== idx) return;   // stale
        sceneSeqDone = idx;                    // remember: this page has played out
        dialogueDone(idx);
      };
      if (vid && (!sc || sc.hold == null)) {
        vid._sceneAdv = seqDone;               // resetScenes cleans this up too
        vid.addEventListener("ended", seqDone, { once: true });
      } else if (bub) {
        sceneWait(seqDone, revealDelay + typedMs + 600);   // pop + typing settled
      } else {
        const hold = (sc && sc.hold != null) ? sc.hold : SCENE_HOLD_MS;
        sceneWait(seqDone, revealDelay + hold);
      }
    }
  })(0, startDelay || 0);
}

function refreshMedia() {
  const idx = flipped;                         // the front-most page right now
  const fresh = idx !== lastMediaIdx;          // just ARRIVED here (vs a re-assert call)
  if (fresh) {
    lastMediaIdx = idx; armBlink = true;       // arm the video-end blink once per page
    hintDoneFor = -1;                          // fresh page → nudge waits for its scenes again
    clearDialogueWatchdog();                   // drop the previous page's watchdog
  }
  // Left the page a delayed video was counting down on? Cancel that countdown.
  if (mediaDelayTimer && mediaDelayIdx !== idx) {
    clearTimeout(mediaDelayTimer); mediaDelayTimer = null; mediaDelayIdx = -1;
  }
  // Buffer + gesture-unlock ONLY this page and the next (so the upcoming flip is
  // instant and keeps sound) — never all 25 videos at once.
  warmVideo(idx); warmVideo(idx + 1); primeVideo(idx + 1);
  // Pause every video that is NOT the current page.
  leaves.forEach(function (leaf, i) {
    if (i === idx) return;
    const v = leaf.querySelector("video.page-media:not(.hub-vid)");
    if (v) { try { v.pause(); } catch (_) {} }
    hubStop(leaf);            // …including a hotspot clip left mid-play (no-op elsewhere)
  });
  // Start (or schedule) the current page's video. (A video INSIDE a .page-scene
  // belongs to the scene player — playScenes starts it when its scene lands.)
  const cur = leaves[idx];
  const v = cur && !(pages[idx] && pages[idx].scenes) &&
            cur.querySelector("video.page-media:not(.hub-vid)");
  if (v) {
    const delayMs = (pages[idx] && pages[idx].delay) ? pages[idx].delay : 0;
    if (delayMs > 0) {
      // Already playing this page, or already counting down for it → leave it alone
      // (so the flip-start + flip-end calls don't restart the 3s countdown).
      if (mediaDelayIdx === idx && (mediaDelayTimer || !v.paused)) { /* keep going */ }
      else if (fresh || !v.ended) {            // an ENDED clip only re-arms on a fresh arrival
        try { v.pause(); v.currentTime = 0; } catch (_) {}   // hold on the first frame
        mediaDelayIdx = idx;
        mediaDelayTimer = setTimeout(function () {
          mediaDelayTimer = null;
          if (flipped === idx) playVideoNow(v);               // only if still on this page
        }, delayMs);
      }
    } else if (fresh) {
      // Returning to (or arriving on) this page → always play from the START.
      try { v.pause(); v.currentTime = 0; } catch (_) {}
      v._tapDone = false; hideTapGate(v);       // re-arm the tap-the-switch beat
      if (animating) holdVideoForFlip(idx, v);  // mid-turn → wait for the sheet to land
      else playVideoNow(v);
    } else if (!v.ended && !v._tapOpen) {
      // This is ALSO the call that starts a clip held back by holdVideoForFlip:
      // the turn has landed, animating is false again, so the backstop is done.
      clearTimeout(heldMediaTimer); heldMediaTimer = null;
      playVideoNow(v);                          // re-assert mid-play (harmless resume)
    }
    // NOTE: an ENDED clip on a re-assert call is left alone — it stays paused
    // on its LAST FRAME until the reader taps Next (or leaves and returns).
  }
  // Reset dialogue on every page we've LEFT — delayed until the turn finishes
  // so nothing blanks mid-flip. Bubbles then replay on the next visit.
  leaves.forEach(function (leaf, i) {
    if (i === idx || leaf.dataset.resetPend) return;
    const touched = leaf.querySelector(".bubble[data-revealed], .bubble[data-sched]");
    if (!touched && scenePlayPage !== i && !hubTouched(leaf)) return;   // nothing to reset
    leaf.dataset.resetPend = "1";
    setTimeout(function () {
      delete leaf.dataset.resetPend;
      if (flipped === i) return;               // reader came straight back — keep it
      if (scenePlayPage === i) stopScenes();
      leaf.querySelectorAll(".bubble").forEach(resetBubble);
      if (pages[i] && pages[i].scenes) resetScenes(leaf);
      hubReset(leaf);                          // interactive page → all nudges back
    }, FLIP_MS + 80);
  });
  // Start this page's dialogue: the scene sequence, or the single bubble —
  // Pop + Typewriter, timed so it lands as the page finishes turning.
  // (Scenes only run while the book is OPEN — never behind a closing cover.)
  if (cur && pages[idx] && pages[idx].type === "interactive") {
    // INTERACTIVE page. A fresh arrival puts every nudge back (so flipping away
    // and returning starts the exploring over), then the clips are buffered so
    // the first tap is instant.
    if (fresh) hubReset(cur);
    hubWarm(cur);
    const hub    = hubEl(cur);
    const nspots = (pages[idx].hotspots || []).length;
    const seen   = (hub && hub._watched) ? hub._watched.size : 0;
    // requireAll (the default) keeps the forward turn LOCKED until every
    // hotspot has been watched — hubClose calls dialogueDone on the last one.
    // With requireAll:false the page is free to leave as soon as it lands.
    if (pages[idx].requireAll === false || (nspots && seen >= nspots) || !nspots) {
      dialogueDone(idx);
    }
  } else if (cur && pages[idx] && pages[idx].scenes) {
    if (opened) {
      playScenes(idx, animating ? 700 : 150);
      // Returned to a page whose sequence already played out before its
      // reset kicked in (quick back-and-forth): it's still "done".
      if (scenePlayPage === idx && sceneSeqDone === idx) dialogueDone(idx);
    }
  } else {
    const bub = cur && cur.querySelector(".bubble");
    if (bub && !bub.dataset.revealed && !bub.dataset.sched) {
      bub.dataset.sched = "1";
      bub._revealTimer = dlgWait(function () {
        delete bub.dataset.sched;
        if (flipped === idx) revealBubbleNow(bub);
      }, animating ? 700 : 150);
      // …and once the bubble has popped + typed out, the nudge may arm.
      const bt = bub.querySelector(".bubble-text");
      const btFull = (bt && (bt.dataset.full || bt.textContent)) || "";
      dlgWait(function () { dialogueDone(idx); },
              (animating ? 700 : 150) + TYPE_LAG_MS +
              btFull.length * (+bub.dataset.typeSpeed || TYPE_MS) + 600);
    } else if (bub && bub.dataset.revealed && !bub._typeTimer && !bub._typeStartTimer) {
      dialogueDone(idx);                       // already popped + typed (quick return)
    } else if (!bub && cur) {
      if (v && !v.ended && !v.error) {
        // Full-page video still to play: the Next arrow, drag-forward and the
        // nudge stay LOCKED until the clip finishes (the 'ended' listener in
        // makeMedia fires dialogueDone). If the clip can't load, unlock so the
        // reader is never trapped on a broken page.
        if (!v._dlgErrHook) {
          v._dlgErrHook = true;
          v.addEventListener("error", function () { if (flipped === idx) dialogueDone(idx); });
        }
        // …and path 3: a WATCHDOG. `ended` and `error` between them still miss the
        // nastiest case — a clip that neither finishes nor errors: it stalls on a
        // starved network, an autoplay block leaves it paused, or the decoder
        // quietly gives up. Then Next never appears and the reader is stuck with
        // no way forward. Re-armed per page arrival.
        armDialogueWatchdog(idx, v);
      } else {
        dialogueDone(idx);                     // no dialogue at all (e.g. THE END)
      }
    }
  }
  // Right-side paper stack shrinks toward the end: 6 sheets → … → 0 on the last page.
  if (pageStackEl) pageStackEl.dataset.count = String(Math.max(0, Math.min(6, totalPages - 1 - flipped)));
  // Restart the idle → page-turn-hint countdown for the page we've just landed on
  // (uses the NEW `flipped`, so the delay is right: 5s on page 1, 10s afterwards).
  if (typeof resetIdleHint === "function") resetIdleHint();
}

/* ---- WATCHDOG for media-gated UI -------------------------------------------
   Any control that waits on a media event needs THREE ways to appear, because
   each one alone has a hole:
     1. the event  ('ended')            — the happy path
     2. an 'error' handler              — the clip is broken/missing
     3. this watchdog                   — the clip neither ends NOR errors
   (3) is the one that actually saves people: a stalled download, a blocked
   autoplay, or a decoder that silently stops all leave the video sitting there
   forever with no event at all. The timer runs for the clip's own duration plus
   a grace margin, and is re-armed on every page arrival (and cancelled when the
   page is left, so it can never unlock a page the reader is no longer on).
   Duration is unknown until metadata lands, so fall back to a flat ceiling and
   tighten it once we know the real length. */
const WATCHDOG_GRACE_MS = 4000;
const WATCHDOG_FALLBACK_MS = 45000;      // used until the clip's duration is known
let _wdTimer = null, _wdPage = -1;

function clearDialogueWatchdog() {
  if (_wdTimer) { clearTimeout(_wdTimer); _wdTimer = null; }
  _wdPage = -1;
}
function armDialogueWatchdog(idx, v) {
  if (_wdPage === idx && _wdTimer) return;      // already watching this page
  clearDialogueWatchdog();
  _wdPage = idx;
  function fire() {
    _wdTimer = null;
    if (flipped !== idx) return;                // reader has moved on
    if (hintDoneFor === idx || pageDone.has(idx)) return;   // something else unlocked it
    console.warn("[flipbook] watchdog unlocked page " + (idx + 1) +
                 " — its clip never fired 'ended' or 'error'.");
    dialogueDone(idx);
  }
  function schedule() {
    if (_wdPage !== idx) return;
    const d = (v && isFinite(v.duration) && v.duration > 0)
      ? v.duration * 1000 + WATCHDOG_GRACE_MS
      : WATCHDOG_FALLBACK_MS;
    if (_wdTimer) clearTimeout(_wdTimer);
    _wdTimer = setTimeout(fire, d);
  }
  schedule();
  // tighten the deadline as soon as the real duration is known
  if (v && !isFinite(v.duration)) {
    v.addEventListener("loadedmetadata", schedule, { once: true });
  }
}

/* ---- Navigation (drives the CSS leaf flip) ------------------------------ */
function turnLeaf(leaf) {                 // shared flip visuals + timing
  // MOTION LINES — speed streaks in the direction the sheet is travelling, so a
  // turn reads as movement and not just a change of picture.
  motionLines(leaves.indexOf(leaf) < flipped, FLIP_MS * 0.72);
  sfxPageTurn();                         // the paper swoosh rides the same motion
  if (G) {
    // PEEL path — a real corner-peel turn (see the PAGE-PEEL ENGINE above):
    // the corner travels its canonical arc while the fold sweeps the page.
    const toFlipped = leaves.indexOf(leaf) < flipped;   // turning left, or back right?
    peelTurn(leaf, toFlipped, {
      done: function () {
        animating = false; updateProgress();
        refreshMedia();                  // re-assert once settled (idempotent safety net)
      }
    });
  } else {
    // Fallback — the original CSS-transition flip.
    leaf.style.zIndex = 300;             // lift the turning sheet above everything
    leaf.classList.add("flipping");      // enables the moving curl shading
    renderLeaves();
    setTimeout(function () {
      leaf.classList.remove("flipping");
      animating = false; updateZ(); updateProgress();
      refreshMedia();                    // re-assert once settled (idempotent safety net)
    }, FLIP_MS + 40);
  }
  // Hand the new page to the media layer NOW — it pauses the page we are leaving,
  // buffers what's ahead and schedules the dialogue — but the target page's CLIP
  // is held on frame 0 until this turn has finished (holdVideoForFlip); the
  // completion callbacks above are what actually start it.
  refreshMedia();
  updateProgress();
}
function goNext() {
  if (!opened || !ready || animating) return;   // wait until the cover has fully opened
  if (hintDoneFor !== flipped && !pageDone.has(flipped)) return;   // first visit: wait for the page to play out
  if (flipped >= totalPages - 1) return;         // already on the LAST page (THE END)
  animating = true;
  const leaf = leaves[flipped];                  // the page to turn
  flipped++;
  turnLeaf(leaf);
}
function goPrev() {
  if (!opened || !ready || animating) return;   // wait until the cover has fully opened
  if (flipped <= 0) return;               // already on the first page
  // (going BACK is allowed even while a scene is playing — only forward waits)
  animating = true;
  flipped--;
  turnLeaf(leaves[flipped]);
}

/* ---- Nav state (the "Page X / N" counter has been removed) --------------- */
function updateProgress() {
  // Corner arrows: BACK is hidden on page 1 only (visible + usable everywhere
  // else, even mid-scene). NEXT stays HIDDEN until the page's scenes/dialogue
  // have fully played out (dialogueDone() re-runs this), then fades in.
  const dlgDone = hintDoneFor === flipped || pageDone.has(flipped);
  const showPrev = opened && ready && flipped > 0;
  const showNext = opened && ready && dlgDone && flipped < totalPages - 1;
  if (cornerPrev) {
    cornerPrev.classList.toggle("hide", !showPrev);
    cornerPrev.disabled = !showPrev;
  }
  if (cornerNext) {
    cornerNext.classList.toggle("hide", !showNext);
    cornerNext.disabled = !showNext;
  }
}

/* ---- Fullscreen: go FULLSCREEN when the book opens (the Play tap is the user
   gesture the Fullscreen API requires) and LEAVE fullscreen when back at the
   cover (Home / Replay). Applies on every screen; silently no-ops where the
   browser blocks it (e.g. iPhone Safari can't fullscreen arbitrary elements). */
/* Entering/leaving fullscreen fires a burst of resize events while the browser
   morphs the window; each one re-runs fitScale() and would SNAP the book to its
   new scale (the jitter). .fs-zooming turns on a transform transition on
   .flip-scale for the duration of the morph, so every re-scale GLIDES into the
   next — one smooth zoom instead of stepped jumps. */
let _fsZoomTimer = null;
function smoothFsZoom() {
  document.body.classList.add("fs-zooming");
  clearTimeout(_fsZoomTimer);
  _fsZoomTimer = setTimeout(function () { document.body.classList.remove("fs-zooming"); }, 900);
}
function enterFullscreen() {
  try {
    if (document.fullscreenElement || document.webkitFullscreenElement) return;
    var el = document.documentElement;
    var req = el.requestFullscreen || el.webkitRequestFullscreen || el.webkitRequestFullScreen || el.msRequestFullscreen;
    if (req) { smoothFsZoom(); var p = req.call(el); if (p && p.catch) p.catch(function () {}); }
  } catch (_) {}
}
function exitFullscreen() {
  try {
    if (!(document.fullscreenElement || document.webkitFullscreenElement)) return;
    var ex = document.exitFullscreen || document.webkitExitFullscreen || document.webkitCancelFullScreen || document.msExitFullscreen;
    if (ex) { smoothFsZoom(); var p = ex.call(document); if (p && p.catch) p.catch(function () {}); }
  } catch (_) {}
}

/* ---- Open the 3D cover, then hand off to the page-turning book ----------
   Shared by the first open (openBook) AND Replay (replayBook), so the dramatic
   hinge-open + post-open setup are identical both times. */
function runOpenSequence() {
  ready = false;
  document.body.classList.remove("is-closing");
  document.body.classList.add("is-open");
  // The whole open motion IS the cover's own hinge — NO zoom / camera move.
  book.classList.remove("closing");
  book.classList.add("open");          // cover hinges open on the LEFT spine
  bookFloat.classList.add("rest");     // stop the idle bob
  coverScene.classList.remove("parked");
  flipbookEl.style.zIndex = "";        // cover ABOVE the pages while it swings open
  // Reveal the REAL page right away (it sits beneath the cover, masked by it).
  flipbookEl.classList.add("show");
  // A user gesture drives every open — so page 1 + 2's videos are gesture-primed
  // here (a muted play→pause) and are therefore ALLOWED to play WITH sound later.
  // Nothing actually PLAYS yet: the page-1 video starts only when the cover has
  // finished turning (in the timer below).
  primeVideo(0); primeVideo(1);
  // START the page-1 video at the HALFWAY point of the cover turn —
  // right as the board passes ~90° and the page beneath becomes visible — so
  // the reveal and the playback read as ONE motion: by the time the cover
  // lands flat the video has visibly been running the whole second half of
  // the swing. (Until then page 1 sits on its own first frame, painted from the
  // clip's metadata by primeVideo above — so there is no blank frame or flicker.)
  clearTimeout(_mediaTimer);
  _mediaTimer = setTimeout(function () {
    refreshMedia();
  }, Math.round(COVER_OPEN_MS * 0.5));
  // Once the cover has FULLY opened, park it, lift the pages above it, hand
  // over pointer events, and mark the book READY.
  clearTimeout(_openTimer);
  _openTimer = setTimeout(function () {
    coverScene.classList.add("parked");
    flipbookEl.style.zIndex = "5";        // pages now sit ABOVE the parked cover (z3)
    tapCatcher.style.pointerEvents = "none";
    flipbookEl.style.pointerEvents = "auto";
    ready = true;
    updateProgress();
    refreshMedia();                       // idempotent safety net (media already rolling)
    resetIdleHint();
  }, COVER_OPEN_MS + 50);
  updateProgress();
}
function openBook() {
  console.log("[flipbook] openBook() called — opened was:", opened);
  if (opened) return;
  // GATE: hold every entry point — the tap-catcher, the button, Enter/Space,
  // ArrowRight and any programmatic call — until the preloader has finished.
  // Guarding here rather than on the click handler means a keyboard or scripted
  // start cannot slip past the loading bar.
  if (!assetsReady) {
    console.log("[flipbook] Play ignored — still preloading.");
    return;
  }
  opened = true;
  // The Play tap is the one guaranteed user gesture, so this is where audio is
  // allowed to come to life. Everything after can make sound.
  sfxInit(); sfxOpen();
  enterFullscreen();          // Play tap is a user gesture → allowed to go fullscreen
  runOpenSequence();
}

/* ---- Reset the whole book to the START SCREEN: the CLOSED FRONT COVER + Play
   button, exactly like a fresh load (so tapping Play reads from the top). Shared
   by Replay and Home (called once the closing swing has finished). --------- */
function resetToStart() {
  exitFullscreen();           // back at the cover → leave fullscreen
  ready = false; opened = false; flipped = 0;
  animating = false;          // never carry a stuck flip-lock into the next read
  renderLeaves();
  clearFlipFX(null);                           // kill any lingering cast shadow / flex
  if (peelFoldWrap) peelFoldWrap.style.display = "none";   // hide a lingering fold-back
  leaves.forEach(function (leaf) {
    var vv = leaf.querySelector("video.page-media:not(.hub-vid)");
    if (vv) { try { vv.pause(); vv.currentTime = 0; } catch (_) {}
              vv._tapDone = false; hideTapGate(vv); }
    hubReset(leaf);            // interactive pages start the next read-through fresh
  });
  // Fresh dialogue for the next read-through: stop the scene player and put
  // every bubble / scene sequence back to its start.
  hintDoneFor = -1;                            // nudge re-gates on the next read
  pageDone.clear();                            // a fresh read-through earns its unlocks again
  stopScenes();
  leaves.forEach(function (leaf, i) {
    leaf.querySelectorAll(".bubble").forEach(resetBubble);
    if (pages[i] && pages[i].scenes) resetScenes(leaf);
  });
  lastMediaIdx = -1;
  document.body.classList.remove("is-open", "is-closing");
  book.classList.remove("open", "closing");
  coverScene.classList.remove("parked");
  cover.style.transform = "";                 // cover CLOSED → front cover + Play button showing
  flipbookEl.classList.remove("show");         // pages hidden behind the closed cover
  flipbookEl.style.zIndex = "";
  flipbookEl.style.pointerEvents = "none";
  bookFloat.classList.remove("rest");          // resume the idle bob
  tapCatcher.style.pointerEvents = "auto";     // Play is tappable again
  hideFlipHint(); clearTimeout(idleHintTimer); clearTimeout(nudgeHideTimer);
  updateProgress();                            // re-sync nav state (arrows greyed)
}

/* ---- CLOSE THE BOOK: the cover swings SHUT — the exact REVERSE of the opening
   hinge (cover −180 → 0) — and the book lands on the front cover. Used by
   REPLAY (from THE END page). `afterReset` runs once we're back on the cover. */
function closeBookToCover(afterReset) {
  ready = false;                               // block flips during the close
  clearTimeout(_openTimer);
  clearTimeout(_mediaTimer);                   // never start media after a close
  clearTimeout(_homeTimer);
  hideFlipHint(); cancelPeek(); clearTimeout(idleHintTimer); clearTimeout(nudgeHideTimer);
  if (cornerNext) cornerNext.classList.remove("blink", "blink1");
  var v = currentVideo(); if (v) { try { v.pause(); } catch (_) {} }
  flipbookEl.style.pointerEvents = "none";
  tapCatcher.style.pointerEvents = "none";
  // REAL-BOOK CLOSE, in two beats:
  //   1) every turned page riffles back to the right (cascadeClose) — the pages
  //      stay ABOVE the parked cover for this, so the riffle is fully visible;
  //   2) then the cover swings shut over page 1 (the original closing hinge).
  cascadeClose(function () {
    // pages back UNDER the cover, so the closing cover sweeps over them
    flipbookEl.style.zIndex = "";
    coverScene.classList.remove("parked");
    // CLOSE — reverse of the opening hinge (cover swings from -180 back to 0).
    // is-closing keeps the current page bright (hides the dark thickness block) and
    // hides any stray turned page, so the cover folds cleanly.
    document.body.classList.add("is-closing");
    book.classList.remove("open");
    book.classList.add("closing");
    _homeTimer = setTimeout(function () {
      resetToStart();
      if (typeof afterReset === "function") afterReset();
    }, COVER_CLOSE_MS + 60);
  });
}

/* ---- REPLAY (button on THE END page): close the book with the reverse-of-open
   swing and land on the front cover, ready for another read. */
function replayBook() {
  if (!opened || animating) return;
  closeBookToCover();
}

/* ==========================================================================
   INPUT  —  tap PLAY to OPEN the cover; once open, drag + corner arrows +
   keyboard drive the page flip.
   ========================================================================== */
const tapCatcher = document.getElementById("tapCatcher");

// The book opens ONLY from the play button. The tap-catcher still sits on top to
// block page gestures before opening, but it opens the book only when the tap
// lands inside the play button's (breathing) hit-circle — taps elsewhere on the
// cover do nothing.
function tapHitsPlay(e) {
  const r = hint.getBoundingClientRect();
  const cx = r.left + r.width / 2, cy = r.top + r.height / 2;
  const rad = Math.max(r.width, r.height) / 2;
  return Math.hypot(e.clientX - cx, e.clientY - cy) <= rad;
}
if (tapCatcher) tapCatcher.addEventListener("click", function (e) { if (!opened && tapHitsPlay(e)) openBook(); });
// Show the hand (pointer) cursor ONLY when hovering the play button — the sole CTA
// on the cover. Everywhere else on the tap surface stays a normal cursor.
if (tapCatcher) tapCatcher.addEventListener("mousemove", function (e) {
  tapCatcher.style.cursor = (!opened && tapHitsPlay(e)) ? "pointer" : "default";
});

// The play button itself (also covers keyboard: Enter/Space on the focused button).
hint.addEventListener("click", function (e) { e.stopPropagation(); if (!opened) openBook(); });


// Bottom-corner flip arrows (outside the book): back = left, forward = right.
cornerPrev.addEventListener("click", function (e) { e.stopPropagation(); goPrev(); this.blur(); });
cornerNext.addEventListener("click", function (e) { e.stopPropagation(); goNext(); this.blur(); });
// Press feedback: a gold ring rolls off the disc's rim (CSS .tapped).
[cornerPrev, cornerNext].forEach(function (b) {
  if (!b) return;
  b.addEventListener("pointerdown", function () {
    sfxTap();
    b.classList.remove("tapped");
    void b.offsetWidth;                          // restart the ripple cleanly
    b.classList.add("tapped");
    setTimeout(function () { b.classList.remove("tapped"); }, 580);
  });
});
// THE END → "Read again" runs the REVERSE PAGE-FLIP: every page riffles back to
// the right, one after another, until the book is open at page 1 again.
// THE END → "Read again" CLOSES THE BOOK and lands back on the FRONT COVER with
// the Play button, ready for another read from the top. (It used to riffle back
// and leave the book open on page 1, so the reader never saw the cover again.)
if (replayBtn) replayBtn.addEventListener("click", function (e) {
  e.stopPropagation(); sfxReplay(); closeToCoverFromEnd(); this.blur();
});

/* ---- Hamburger menu (top-right) — quick actions while reading ------------ */
const hamWrap = document.getElementById("hamWrap");
const hamBtn  = document.getElementById("hamBtn");
const menuSkip = document.getElementById("menuSkip");
function closeHamMenu() {
  if (!hamWrap) return;
  hamWrap.classList.remove("open");
  if (hamBtn) hamBtn.setAttribute("aria-expanded", "false");
}
if (hamBtn) {
  hamBtn.addEventListener("click", function (e) {
    e.stopPropagation();
    sfxTap();
    const open = hamWrap.classList.toggle("open");
    hamBtn.setAttribute("aria-expanded", open ? "true" : "false");
  });
  document.addEventListener("click", closeHamMenu);   // tap elsewhere → menu closes
}
if (menuSkip) menuSkip.addEventListener("click", function (e) {
  e.stopPropagation();
  sfxTap();
  closeHamMenu();
  skipPage();
});
/* SKIP — end the current page's beat right now: close an open tap-gate, stop
   the video, unlock the forward turn and flip to the next page. Uses the same
   dialogueDone → goNext machinery as normal reading, so nothing else changes
   (revisiting the page later still replays its video from the start). */
function skipPage() {
  if (!opened || !ready || animating) return;
  const idx = flipped;
  if (idx >= totalPages - 1) return;          // last page — nothing to skip to
  const leaf = leaves[idx];
  const v = leaf && !(pages[idx] && pages[idx].scenes) &&
            leaf.querySelector("video.page-media:not(.hub-vid)");
  if (v) {
    v._tapDone = true; hideTapGate(v);        // a skipped page never re-opens its gate
    try { v.pause(); } catch (_) {}
  }
  hubStop(leaf);                              // skipping an interactive page silences its clip
  dialogueDone(idx);                          // unlock the forward turn…
  goNext();                                   // …and turn the page
}

// Page interaction — DRAG TO TURN: grab the page and it follows your cursor,
// rotating about the spine, then SNAPS to the nearest state when you let go.
//   • drag LEFT  → turn the current page forward (it comes to rest on the cover)
//   • drag RIGHT → turn the previous page back
// A plain tap does nothing; the corner arrows + keyboard still work.
(function () {
  let startX = 0, startY = 0, pw = 1;
  let leaf = null, dir = 0, decided = false, dragging = false;
  let pC0 = null, pS = null, pP = null;               // peel drag: corner start, grab point, corner now
  let lastX = 0, lastT = 0, vx = 0;                   // for flick (velocity) detection
  const DECIDE = 6;                                   // px before we commit to a drag
  const FLICK = 0.45;                                 // px/ms — a quick flick completes the turn
  const FINISH_DEG = 45;                              // turned this far (deg) → completes on release

  // how many degrees the drag has turned the page (0..180)
  function degFromDx(dx) { return Math.max(0, Math.min(180, Math.abs(dx) / pw * 180)); }
  // the live angle for the active leaf, given the raw horizontal travel
  function liveAngle(dx) {
    return (dir === 1) ? degFromDx(Math.min(0, dx))          // forward: leftward turns 0→180
                       : 180 - degFromDx(Math.max(0, dx));   // back: starts at 180, rightward → 0
  }

  flipbookEl.addEventListener("pointerdown", function (e) {
    if (!opened || !ready || animating) return;
    startX = e.clientX; startY = e.clientY;
    lastX = e.clientX; lastT = e.timeStamp || performance.now(); vx = 0;
    decided = false; dragging = true; leaf = null; dir = 0;
    pC0 = pS = pP = null;
    pw = flipbookEl.getBoundingClientRect().width || 1;
  });

  flipbookEl.addEventListener("pointermove", function (e) {
    if (!dragging) return;
    const now = e.timeStamp || performance.now();
    const dt = now - lastT;
    if (dt > 0) vx = (e.clientX - lastX) / dt;         // running horizontal velocity
    lastX = e.clientX; lastT = now;
    const dx = e.clientX - startX, dy = e.clientY - startY;
    if (!decided) {
      if (Math.abs(dx) < DECIDE || Math.abs(dx) <= Math.abs(dy)) return;   // wait for a clear horizontal drag
      if (dx < 0 && flipped < totalPages - 1 &&
          (hintDoneFor === flipped || pageDone.has(flipped)))
                                              { dir = 1;  leaf = leaves[flipped]; }     // forward once the page has played out (this visit or an earlier one)
      else if (dx > 0 && flipped > 0)         { dir = -1; leaf = leaves[flipped - 1]; } // turn back (always allowed)
      else { dragging = false; return; }                  // nothing to turn that way
      decided = true;
      leaf.style.transition = "none";                     // follow the finger exactly
      leaf.style.zIndex = 300;
      if (G) {                                            // PEEL drag: the page corner follows
        pC0 = (dir === 1) ? { x: PW, y: PH } : { x: -PW, y: PH };   // where the corner rests now
        pS  = bookPt(e);                                  // grab point (keeps the grab offset)
        pP  = { x: pC0.x, y: pC0.y };
        leaf.style.transform = "none";                    // flat — the travelling fold turns it
        renderPeel(leaf, pP);
      }
      try { flipbookEl.setPointerCapture(e.pointerId); } catch (_) {}
    }
    if (G) {
      // Corner = its resting spot + how far the finger has travelled, kept
      // physical (paper can't stretch past the spine anchors).
      const bp = bookPt(e);
      pP = clampPeelP({ x: pC0.x + (bp.x - pS.x), y: pC0.y + (bp.y - pS.y) });
      renderPeel(leaf, pP);
      return;
    }
    const ang = Math.max(0, Math.min(180, liveAngle(dx)));
    // Fallback (no GSAP) rigid drag: curls, cast shadow, media flex — and the
    // sheet's sag + lift composed into the follow-the-finger transform.
    const fx = applyFlipFX(leaf, ang);
    leaf.style.transform = "rotateY(" + (-ang) + "deg) rotateX(" + fx.sag.toFixed(2) +
                           "deg) translateZ(" + fx.lift.toFixed(1) + "px)";
  });

  function endDrag(e) {
    if (!dragging) return;
    dragging = false;
    const L = leaf, D = dir;
    leaf = null;
    if (!decided || !L) return;                           // a plain tap → nothing

    const flick = (D === 1) ? (vx < -FLICK) : (vx > FLICK);

    if (G) {
      // PEEL release: the fold keeps going from wherever the finger let go —
      // completing over the spine or settling back down — with a duration
      // scaled to the remaining distance, like releasing a real page mid-peel.
      const P0 = pP || { x: (D === 1 ? PW : -PW), y: PH };
      const prog = (PW - P0.x) / (2 * PW);              // 0 = flat right … 1 = fully turned
      const complete = (D === 1) ? (prog > 0.15 || flick) : (prog < 0.85 || flick);
      const endFlipped = (D === 1) ? complete : !complete;
      animating = true;
      if (complete) { flipped += (D === 1) ? 1 : -1; }
      // motion lines only when the turn actually completes (a page that settles
      // back never travelled anywhere)
      if (complete) { motionLines(D === 1, FLIP_MS * 0.6); sfxPageTurn(); }
      renderLeaves();                                   // final classes now (inline overrides)
      refreshMedia();                                   // hand over the page; the clip waits
                                                        // for the release to finish (see below)
      L.style.zIndex = 300;                             // keep the peeling sheet on top
      const target = endFlipped ? { x: -PW, y: PH } : { x: PW, y: PH };
      const proxy = { x: P0.x, y: P0.y };
      const dist = Math.min(1, Math.hypot(target.x - P0.x, target.y - P0.y) / (2 * PW));
      if (_peelTween) _peelTween.kill();
      _peelTween = G.to(proxy, {
        x: target.x, y: target.y,
        duration: Math.max(0.3, FLIP_S * dist),
        ease: flick ? "power2.out" : "power2.inOut",
        onUpdate: function () { renderPeel(L, proxy); },
        onComplete: function () {
          _peelTween = null;
          peelEnd(L);
          animating = false; updateProgress();
          refreshMedia();                               // re-assert once settled
        }
      });
      updateProgress();
      return;
    }

    const ang = Math.max(0, Math.min(180, liveAngle(e.clientX - startX)));
    // Complete the turn if it's been dragged far enough OR flicked quickly in
    // the turn's direction — no need to drag all the way past halfway.
    const complete   = (D === 1) ? (ang > FINISH_DEG || flick)
                                 : (ang < 180 - FINISH_DEG || flick);
    const endFlipped = (D === 1) ? complete   : !complete;    // does this leaf end up turned?

    animating = true;
    if (complete) { flipped += (D === 1) ? 1 : -1; sfxPageTurn(); }

    clearFlipFX(L);         // drop the inline FX; the .flipping keyframe takes over
    // Lock in the resting classes + z-index NOW (so nothing pops in later), then
    // animate the inline transform from the dragged angle to the target. The
    // .flipped class already holds the same final angle underneath.
    L.style.transition = "";                              // restore the CSS flip transition
    void L.offsetWidth;                                   // reflow so it animates FROM the dragged angle
    L.classList.add("flipping");                          // curl shading during the snap
    renderLeaves();                                       // apply .flipped + z-index immediately
    refreshMedia();                                       // hand over the page; the clip waits
                                                          // for the snap to finish (see below)
    L.style.transform = endFlipped ? "rotateY(-180deg)" : "rotateY(0deg)";
    updateProgress();

    setTimeout(function () {
      L.classList.remove("flipping");
      // Drop the inline transform WITHOUT re-animating: the .flipped class already
      // holds the final angle, so disabling the transition for this swap prevents
      // the leaf from briefly swinging back (the "page reappears on the left" glitch).
      L.style.transition = "none";
      L.style.transform = "";
      void L.offsetWidth;                                 // commit with no transition
      L.style.transition = "";                            // restore for the next turn
      animating = false; updateProgress();
      refreshMedia();                                     // re-assert once settled (idempotent safety net)
    }, FLIP_MS + 40);
  }
  flipbookEl.addEventListener("pointerup", endDrag);
  flipbookEl.addEventListener("pointercancel", endDrag);
})();

window.addEventListener("keydown", function (e) {
  if (e.key === "ArrowRight") { e.preventDefault(); opened ? goNext() : openBook(); }
  else if (e.key === "ArrowLeft") { e.preventDefault(); goPrev(); }
  else if ((e.key === " " || e.key === "Enter") && !opened) { e.preventDefault(); openBook(); }
});

// Keep the canvas scaled to fit on resize / rotate.
let _resizeSettle = null;
function onViewportChange() {
  // Suppress the page-turn transitions while the viewport is actively changing, so
  // a rapid resize / resolution change can't make the book LOOK like it's auto-
  // flipping (the leaves re-render during the scale change). Restored once settled.
  // NOT during the fullscreen morph (.fs-zooming): there the scale change must
  // stay ANIMATED (the smooth zoom), and no leaf is mid-flip at that moment.
  if (!document.body.classList.contains("fs-zooming")) {
    document.body.classList.add("is-resizing");
    clearTimeout(_resizeSettle);
    _resizeSettle = setTimeout(function () { document.body.classList.remove("is-resizing"); }, 220);
  }
  fitScale();
}
window.addEventListener("resize", onViewportChange);
window.addEventListener("orientationchange", onViewportChange);

/* ---- Block ALL zoom (pinch, double-tap, ctrl+wheel, ctrl +/-) ------------
   The book is fixed-layout, so zoom would only break it. */
(function () {
  // Never let anything (esp. page images) start a native HTML5 drag — that was
  // showing a "ghost" of the image following the cursor during a page-flip drag.
  document.addEventListener("dragstart", function (e) { e.preventDefault(); });
  ["gesturestart", "gesturechange", "gestureend"].forEach(function (t) {   // iOS pinch
    document.addEventListener(t, function (e) { e.preventDefault(); }, { passive: false });
  });
  window.addEventListener("wheel", function (e) {                          // desktop ctrl+wheel
    if (e.ctrlKey) e.preventDefault();
  }, { passive: false });
  window.addEventListener("keydown", function (e) {                        // ctrl/⌘ +/-/0
    if ((e.ctrlKey || e.metaKey) && ["+", "-", "=", "0"].indexOf(e.key) !== -1) e.preventDefault();
    // Block "Save page" (Ctrl/⌘+S) — a casual way to grab the media.
    if ((e.ctrlKey || e.metaKey) && (e.key === "s" || e.key === "S")) e.preventDefault();
  });
  document.addEventListener("touchmove", function (e) {                    // 2-finger pinch
    if (e.touches && e.touches.length > 1) e.preventDefault();
  }, { passive: false });

  // NOTE: the right-click / context menu is intentionally LEFT ENABLED (so "Inspect"
  // and dev tools work). Casual image protection still stands via CSS — no drag,
  // no text-selection, no iOS long-press "Save Image" callout — plus Ctrl+S is blocked.
})();

/* ==========================================================================
   SOUND EFFECTS  —  the SYNTHESISED fallbacks.
   --------------------------------------------------------------------------
   Every cue below is built from oscillators + a noise buffer through the Web
   Audio API. These are the FALLBACKS: sfx/ ships real Ogg Opus recordings for
   the page turn and the Play button (see makeSample above), and those win when
   they load. The synth versions matter because they cost nothing to ship and
   they cannot 404 — so the book always has sound even if a file is missing, a
   folder was moved, or the browser cannot decode the container.
     • each cue is a few lines you can retune by ear (numbers are Hz / seconds)
   The page videos carry their own voice-over; these only ever layer short
   one-shots on top of it.

   AUTOPLAY: browsers refuse to start an AudioContext outside a user gesture, so
   the context is created lazily by sfxInit() — called from the Play tap, which
   is a real gesture. Every cue no-ops until then, and no-ops for good on any
   engine without Web Audio.
   ========================================================================== */
let _ac = null;                 // the shared AudioContext (created on first tap)
let _noiseBuf = null;           // 2s of white noise, reused by every paper cue
let sfxMuted = false;           // flip to true to silence the whole book

/* ==========================================================================
   ██  THE RECORDED SOUNDS IN  sfx/  ██
   --------------------------------------------------------------------------
   Two real clips ship with the book and are wired up below:

       sfx/page flip.ogg          → every page turn
       sfx/play button sound.ogg  → tapping the Play button on the cover

   Swap either file and the book picks the new one up on reload — no code
   change needed. If a file is missing or won't decode, that cue silently falls
   back to its synthesised version further down, so the book always has sound.

   FILENAMES: each sound gets a LIST of candidate paths, tried in order, first
   one that loads wins. That is why both "page flip.ogg" (a space — what is in
   sfx/ now) and "page-flip.ogg" (a hyphen) work. Add your own spelling to a
   list if you rename a file. `%20` is just how a space is written in a URL.

   Short dry clips work best for the flip (~0.3–1.5s, ONE sheet — not a long
   riffle), because the riffle for "Read again" is built by triggering the flip
   clip several times on a stagger.
   ========================================================================== */

/* Build a pooled one-shot player from a list of candidate URLs.
   `pool` = how many voices can overlap (the riffle retriggers the flip fast, so
   it needs several; a button tap only ever needs one or two). */
function makeSample(name, urls, vol, pool) {
  const S = { ready: false, url: null, vol: vol, _pool: null, _next: 0 };
  (function tryUrl(i) {
    if (i >= urls.length) {
      console.log("[flipbook] no " + name + " file in sfx/ — using the " +
                  "synthesised version instead. Tried: " + urls.join(", "));
      return;
    }
    const url = urls[i];
    try {
      const probe = new Audio();
      // Under the preloader these elements must NOT fetch for themselves — the
      // preloader hands them a blob, and self-loading too would be a second
      // download of the same file. On file:// there is no preloader, so they
      // self-load exactly as before.
      probe.preload = PRELOAD_ACTIVE ? "none" : "auto";
      function adopt(srcForPool, wonWith) {
        if (S.ready) return;
        S._pool = [probe];
        for (let k = 1; k < pool; k++) {
          const a = new Audio(srcForPool);
          a.preload = "auto"; a.volume = vol;
          S._pool.push(a);
        }
        probe.volume = vol;
        S.ready = true; S.url = wonWith;
        console.log("%c[flipbook] " + name + " loaded — " + wonWith,
                    "color:#a0682c;font-weight:bold");
      }
      // canplaythrough → the file exists AND decodes, so it is safe to use
      probe.addEventListener("canplaythrough", function () { adopt(url, url); });
      // this spelling isn't there → try the next candidate
      probe.addEventListener("error", function () { if (!S.ready) tryUrl(i + 1); });

      if (PRELOAD_ACTIVE) {
        // Register EVERY candidate, not just this one. Under the preloader the
        // `error` event never fires (nothing is fetched here), so the walk down
        // the candidate list would stop dead at the first name — and if the file
        // on disk happens to be the second spelling, the sound would never load.
        // Whichever candidate the preloader actually resolves wins; adopt()
        // ignores the rest.
        urls.forEach(function (u) {
          onAssetReady(u, function (blobUrl) {
            useBlob(probe, u, blobUrl);
            probe.preload = "auto";
            adopt(blobUrl, u);
          });
        });
      } else {
        probe.src = url;
      }
    } catch (_) { tryUrl(i + 1); }
  })(0);

  /* Returns false when there is no sample to play — the signal for the caller
     to synthesise one instead. */
  S.play = function (gain, rate) {
    if (!S.ready || sfxMuted || !S._pool) return false;
    try {
      const a = S._pool[S._next % S._pool.length];
      S._next++;
      a.pause();
      a.currentTime = 0;
      a.volume = Math.max(0, Math.min(1, S.vol * (gain == null ? 1 : gain / 0.5)));
      // slight random detune so repeats never sound copy-pasted
      a.playbackRate = (rate == null ? 1 : rate) * (0.94 + Math.random() * 0.12);
      const p = a.play();
      if (p && p.catch) p.catch(function () {});
      return true;
    } catch (_) { return false; }
  };
  return S;
}

/* The flip is deliberately the LOUDEST cue in the book — it is the feedback that
   tells the reader the page actually turned, so it has to cut through whatever
   the page video is saying. (The source file was also amplified +14dB: it peaked
   at -15.5dB, which no playback volume can rescue. See sfx/README.txt.) */
const FLIP_SFX = makeSample("page-flip sound",
  ["sfx/page%20flip.ogg", "sfx/page-flip.ogg"], 0.95, 4);
const PLAY_SFX = makeSample("play-button sound",
  ["sfx/play%20button%20sound.ogg", "sfx/play-button.ogg"], 0.85, 2);

function sfxInit() {
  if (_ac) { if (_ac.state === "suspended") _ac.resume().catch(function () {}); return _ac; }
  try {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return null;
    _ac = new AC();
    // one white-noise buffer serves every swoosh — cheap, and re-reading it from
    // a random offset each time keeps repeated page turns from sounding identical
    const n = Math.floor(_ac.sampleRate * 2);
    _noiseBuf = _ac.createBuffer(1, n, _ac.sampleRate);
    const d = _noiseBuf.getChannelData(0);
    for (let i = 0; i < n; i++) d[i] = Math.random() * 2 - 1;
  } catch (_) { _ac = null; }
  return _ac;
}
function sfxOn() {
  if (sfxMuted || !_ac) return null;
  if (_ac.state === "suspended") _ac.resume().catch(function () {});
  return _ac;
}

/* PAPER SWOOSH — the page turn. White noise through a bandpass that sweeps UP as
   the sheet lifts and back DOWN as it lands, which is what makes it read as
   paper moving through air rather than a hiss. `rate` shortens/brightens it for
   the fast riffle; `gain` ducks the repeats so a 20-page rewind isn't a wall of
   noise. */
function sfxPageTurn(gain, rate) {
  // The real recording in sfx/ always wins over the synth.
  if (FLIP_SFX.play(gain, rate)) return;
  const ac = sfxOn(); if (!ac) return;
  try {
    const g0 = gain == null ? 0.5 : gain;
    const r  = rate == null ? 1   : rate;
    const t  = ac.currentTime, dur = 0.42 / r;

    const src = ac.createBufferSource();
    src.buffer = _noiseBuf;
    src.loop = true;
    src.playbackRate.value = 0.8 + Math.random() * 0.5;   // vary each turn

    const bp = ac.createBiquadFilter();
    bp.type = "bandpass";
    bp.Q.value = 0.85;
    bp.frequency.setValueAtTime(520, t);
    bp.frequency.exponentialRampToValueAtTime(2700, t + dur * 0.42);   // the lift
    bp.frequency.exponentialRampToValueAtTime(620,  t + dur);          // the landing

    const hp = ac.createBiquadFilter();                   // keep it off the low end
    hp.type = "highpass"; hp.frequency.value = 320;

    const amp = ac.createGain();
    amp.gain.setValueAtTime(0, t);
    amp.gain.linearRampToValueAtTime(0.16 * g0, t + 0.03);
    amp.gain.linearRampToValueAtTime(0.11 * g0, t + dur * 0.55);
    amp.gain.exponentialRampToValueAtTime(0.0008, t + dur);

    src.connect(bp); bp.connect(hp); hp.connect(amp); amp.connect(ac.destination);
    src.start(t + Math.random() * 1.2);                   // random offset into the noise
    src.stop(t + dur + 0.02);
  } catch (_) {}
}

/* SOFT TAP — button presses. A tiny wooden click: one triangle blip, no tail. */
function sfxTap() {
  const ac = sfxOn(); if (!ac) return;
  try {
    const t = ac.currentTime;
    const o = ac.createOscillator(), g = ac.createGain();
    o.type = "triangle";
    o.frequency.setValueAtTime(880, t);
    o.frequency.exponentialRampToValueAtTime(430, t + 0.07);
    g.gain.setValueAtTime(0.14, t);
    g.gain.exponentialRampToValueAtTime(0.0008, t + 0.09);
    o.connect(g); g.connect(ac.destination);
    o.start(t); o.stop(t + 0.1);
  } catch (_) {}
}

/* MAGIC CHIME — a rising arpeggio of bell partials. Used for the cover opening
   and for Replay, so starting the story and restarting it rhyme. `base` shifts
   the whole figure: higher = brighter/happier. */
function sfxChime(base, notes) {
  const ac = sfxOn(); if (!ac) return;
  try {
    const t0 = ac.currentTime;
    (notes || [0, 4, 7, 12]).forEach(function (semi, i) {
      const f = (base || 523.25) * Math.pow(2, semi / 12);
      const at = t0 + i * 0.085;
      [1, 2.02].forEach(function (mult, k) {              // fundamental + a shimmer partial
        const o = ac.createOscillator(), g = ac.createGain();
        o.type = "sine";
        o.frequency.value = f * mult;
        const peak = (k === 0 ? 0.13 : 0.045) / (1 + i * 0.18);
        g.gain.setValueAtTime(0, at);
        g.gain.linearRampToValueAtTime(peak, at + 0.012);
        g.gain.exponentialRampToValueAtTime(0.0007, at + 0.85);
        o.connect(g); g.connect(ac.destination);
        o.start(at); o.stop(at + 0.9);
      });
    });
  } catch (_) {}
}

/* BOOK OPENING — a deep body whoosh (the board swinging) under the chime. */
function sfxOpen() {
  // The recorded play-button clip in sfx/ replaces the whole synthesised
  // whoosh+chime — it IS the start sound, so don't layer both on top.
  if (PLAY_SFX.play()) return;
  const ac = sfxOn(); if (!ac) return;
  try {
    const t = ac.currentTime;
    const src = ac.createBufferSource();
    src.buffer = _noiseBuf; src.loop = true;
    src.playbackRate.value = 0.55;
    const lp = ac.createBiquadFilter();
    lp.type = "lowpass";
    lp.frequency.setValueAtTime(240, t);
    lp.frequency.exponentialRampToValueAtTime(1300, t + 0.5);
    lp.frequency.exponentialRampToValueAtTime(300,  t + 1.0);
    const amp = ac.createGain();
    amp.gain.setValueAtTime(0, t);
    amp.gain.linearRampToValueAtTime(0.20, t + 0.16);
    amp.gain.exponentialRampToValueAtTime(0.0008, t + 1.05);
    src.connect(lp); lp.connect(amp); amp.connect(ac.destination);
    src.start(t); src.stop(t + 1.1);
    sfxChime(392.00, [0, 5, 9, 12]);                      // G-ish, warm and open
  } catch (_) {}
}

/* REPLAY — brighter and one step longer than the opening chime: "here we go
   again". Fired by the Read again button on THE END page. */
function sfxReplay() { sfxChime(587.33, [0, 4, 7, 11, 16]); }

/* RIFFLE — n paper swooshes on a stagger (seconds), for a multi-page jump.
   With a SAMPLE we fire fewer voices, faster and quieter than with the synth:
   the clip is longer (so voices overlap and just chop each other off in the
   4-voice pool), and now that it is amplified, a dozen of them at single-turn
   volume sums well past full scale and comes out as a harsh blast. */
function sfxRiffle(n, stagger) {
  if (sfxMuted || (!_ac && !FLIP_SFX.ready)) return;
  const sampled = FLIP_SFX.ready;
  const count = sampled ? Math.min(n, 4)   : n;
  const rate  = sampled ? 2.6              : 2.0;
  const gain  = sampled ? 0.20             : 0.30;
  for (let k = 0; k < count; k++) {
    setTimeout(function () { sfxPageTurn(gain, rate); }, Math.round(k * (stagger || 0.09) * 1000));
  }
}

/* ---- Pause the page video when the tab / window goes to the background ------
   The current page's video (its voice-over) must stop the moment the reader
   switches tab or app, and resume when they come back — it was continuing to
   play in the background. Covers visibilitychange (tab switch), blur (other
   window), and pagehide (mobile app switch / bfcache). */
function currentVideo() {
  const leaf = leaves[flipped];
  if (!leaf) return null;
  // On an interactive page the "current video" is whichever hotspot clip is on
  // screen — that's the voice-over a tab switch has to pause.
  const hv = leaf.querySelector("video.hub-vid.on");
  if (hv) return hv;
  return leaf.querySelector("video.page-media:not(.hub-vid)");
}
function pauseAllAudioFB() {
  const v = currentVideo();
  if (v && !v.paused) { v.dataset.wasPlaying = "1"; try { v.pause(); } catch (_) {} }
}
function resumeAllAudioFB() {
  if (document.hidden || !document.hasFocus()) return;   // only when truly back in front
  if (!opened) return;                                   // nothing plays before the book opens
  const v = currentVideo();
  if (v && v.dataset.wasPlaying && !v.ended) { delete v.dataset.wasPlaying; const p = v.play(); if (p && p.catch) p.catch(function () {}); }
}
document.addEventListener("visibilitychange", function () {
  if (document.hidden) pauseAllAudioFB(); else resumeAllAudioFB();
});
window.addEventListener("blur", pauseAllAudioFB);
window.addEventListener("focus", resumeAllAudioFB);
window.addEventListener("pagehide", pauseAllAudioFB);


/* ==========================================================================
   PAGE-TURN HINT  —  guidance for readers who don't know how to turn the page.
   When idle, two cues fire together: a hand taps the forward arrow AND the page
   itself does a "ghost" half-flip (lifts toward the next page, then falls back).
   Timing: PAGE 1 after 5s, every later page after 10s of no interaction; repeats
   while idle and is cancelled by any tap / key / flip. Never on the last page.
   ========================================================================== */
// The nudge is a HAND on the RIGHT side of the book — the same pages/handNudge.webp
// artwork the interactive page's hotspot cues use — with the gold motion streaks
// trailing off its right. CSS lays the two out side by side (.flip-hint--img).
let flipHint = document.createElement("div");
flipHint.className = "flip-hint flip-hint--img";
flipHint.setAttribute("aria-hidden", "true");
flipHint.appendChild(makeHandImg("fh-hand"));            // the hand
flipHint.insertAdjacentHTML("beforeend", FLIP_TRAIL_SVG); // …and its trail
document.body.appendChild(flipHint);

// Guidance timing: the nudge NEVER interrupts a scene — it appears only after
// the page's dialogue/scene sequence has fully finished (dialogueDone below),
// waits HINT_AFTER_DONE_MS more, then plays. It repeats every NUDGE_GAP_MS
// until the reader turns the page; any interaction resets it.
const HINT_AFTER_DONE_MS = 2000;  // breathing room after the scene completes
const NUDGE_SHOW_MS = 2000;    // how long one nudge stays on screen
const NUDGE_GAP_MS  = 9000;    // gap after it disappears before it plays again
let idleHintTimer = null;
let nudgeHideTimer = null;
let hintDoneFor = -1;          // page index whose dialogue has fully played out
const pageDone = new Set();    // pages COMPLETED at least once this read-through —
                               // revisiting one keeps the Next arrow available
                               // (its video still replays, but the reader has
                               // already earned the forward turn)
let peeking = false;
let peekTimers = [];

/* The current page's dialogue/scenes have finished — the nudge may now arm.
   Called by the scene player (last scene done) and the single-bubble path. */
function dialogueDone(idx) {
  if (idx !== flipped) return;               // stale — we've left that page
  hintDoneFor = idx;
  pageDone.add(idx);                         // completed once → stays unlocked on revisits
  updateProgress();                          // un-grey the corner arrows
  clearTimeout(idleHintTimer);
  clearTimeout(nudgeHideTimer);
  idleHintTimer = setTimeout(triggerHint, HINT_AFTER_DONE_MS);
}

function canShowHint() {
  return opened && ready && !animating &&
         hintDoneFor === flipped &&          // never before the scene completes
         flipped < totalPages - 1 && !document.hidden;
}
function positionFlipHint() {
  if (!flipScaleEl) return;
  const r = flipScaleEl.getBoundingClientRect();            // the book's on-screen rect
  // Size the hand relative to the BOOK (not the viewport) so it always suits
  // the page, and sit it ON the bottom-right page corner — the exact corner
  // the ghost peel lifts.
  const hw = Math.max(40, Math.round(r.width * 0.085));
  flipHint.style.width = hw + "px";              // img and SVG fallback both size by width
  const w = flipHint.offsetWidth || hw, h = flipHint.offsetHeight || hw;
  flipHint.style.left = Math.round(r.right - w - r.width * 0.035) + "px";
  flipHint.style.top  = Math.round(r.bottom - h - r.height * 0.07) + "px";
}
function showFlipHint() {
  if (!canShowHint()) return;
  positionFlipHint();
  flipHint.classList.add("show");
}
function hideFlipHint() {
  flipHint.classList.remove("show");
}

/* ---- GHOST PAGE-FLIP -------------------------------------------------------
   Lift the current page about halfway toward the next one, then let it fall back
   — a live demo that the page turns. Purely visual; cancelled the instant the
   reader interacts, so a real drag/flip takes over cleanly. */
function cancelPeek() {
  peekTimers.forEach(clearTimeout);
  peekTimers = [];
  if (!peeking) return;
  peeking = false;
  const leaf = leaves[flipped];
  if (leaf) {
    if (G) {
      if (leaf._peekTl) { leaf._peekTl.kill(); leaf._peekTl = null; }
      peelEnd(leaf);                         // clears the clip + fold-back layers
    }
    leaf.style.transition = ""; leaf.style.transform = ""; leaf.style.zIndex = "";
    clearFlipFX(leaf);                       // fallback FX (curls, cast shadow, flex)
  }
  updateZ();
}
function peekFlip() {
  if (peeking || !canShowHint()) return;
  const leaf = leaves[flipped];
  if (!leaf) return;
  peeking = true;
  const curl = leaf.querySelector(".curl");
  leaf.style.zIndex = 300;                               // lift above the rest while peeking
  if (G) {
    // PEEL peek: lift the bottom-right corner a little — a live "you can peel
    // me" invitation — hold for a beat, then lay it back down flat.
    ensurePeelEls(leaf);
    leaf.style.transition = "none";
    leaf.style.transform = "none";
    const proxy = { t: 0 };
    const tl = G.timeline({
      onUpdate: function () { renderPeel(leaf, peelPath(proxy.t)); },
      onComplete: function () {
        leaf._peekTl = null;
        peelEnd(leaf);
        leaf.style.zIndex = "";
        peeking = false; updateZ();
      }
    });
    leaf._peekTl = tl;
    tl.to(proxy, { t: 0.12, duration: 0.7, ease: "power2.inOut" })
      .to(proxy, { t: 0,    duration: 0.6, ease: "power2.inOut", delay: 0.15 });
    return;
  }
  leaf.style.transition = "transform 720ms cubic-bezier(0.33, 0, 0.2, 1)";
  void leaf.offsetWidth;                                 // commit so the lift animates from flat
  leaf.style.transform = "rotateY(-52deg)";              // turn toward the next page (~halfway)
  if (curl) curl.style.opacity = "0.85";                 // page-curl shading during the lift
  peekTimers.push(setTimeout(function () {               // ...then ease it back down
    leaf.style.transform = "rotateY(0deg)";
    if (curl) curl.style.opacity = "";
  }, 760));
  peekTimers.push(setTimeout(function () {               // clean up once settled
    leaf.style.transition = ""; leaf.style.transform = ""; leaf.style.zIndex = "";
    peeking = false; updateZ();
  }, 760 + 760));
}

// Play the nudge ONCE — hand swipe on the book's right + ghost page-flip + the
// right arrow blinks — hold ~2s, then hide and come back 9s later. Repeats while idle.
function triggerHint() {
  if (!canShowHint()) { idleHintTimer = setTimeout(triggerHint, NUDGE_GAP_MS); return; }
  showFlipHint();
  peekFlip();
  if (cornerNext) cornerNext.classList.add("blink");
  clearTimeout(nudgeHideTimer);
  nudgeHideTimer = setTimeout(function () {
    hideFlipHint();
    if (cornerNext) cornerNext.classList.remove("blink");
    idleHintTimer = setTimeout(triggerHint, NUDGE_GAP_MS);   // ...then again after 9s
  }, NUDGE_SHOW_MS);
}
function resetIdleHint() {
  hideFlipHint();
  cancelPeek();
  if (cornerNext) cornerNext.classList.remove("blink");
  clearTimeout(idleHintTimer);
  clearTimeout(nudgeHideTimer);
  // Re-arm ONLY if this page's dialogue has already finished — otherwise the
  // nudge stays quiet until dialogueDone() fires for the page.
  if (hintDoneFor === flipped) {
    idleHintTimer = setTimeout(triggerHint, HINT_AFTER_DONE_MS + 500);
  }
}
// Any interaction cancels the nudge + restarts the idle countdown.
["pointerdown", "keydown", "wheel", "touchstart"].forEach(function (evt) {
  document.addEventListener(evt, resetIdleHint, { passive: true, capture: true });
});

/* ==========================================================================
   MOTION LINES  —  WING-BEAT streaks during a page turn.
   A fan of curved, feathered strokes sweeps across the book in the direction
   the sheet is travelling (right→left forward, left→right back), so a turn
   reads as air moving — a wing beat rather than a row of straight speed bars.

   WHY SVG AND NOT DIVS: a CSS box can only ever be a straight bar with a
   gradient down it. Each streak here is ONE closed path made of two quadratic
   curves that share the same two endpoints — one bowing above the stroke's
   arc, one below. That gives a shape which is POINTED at both tips and
   thickest in the middle (the feathering) and CURVED along its length (the
   beat). The drawing lives in book space (1280x720), so it scales with the
   book exactly like the page art does.

   Decorative only: the layer never takes a tap, and it is skipped entirely for
   readers who prefer reduced motion.
   ========================================================================== */
const ML_RIGHT = 1200;         // book-space x that every stroke trails back from
/* Seven strokes, fanned: the top ones arc UP and the bottom ones arc DOWN, so
   together they splay away from the middle of the page the way air does around
   a turning sheet. `bow` is that curvature (negative = arcs up), `th` the mid
   thickness, `d` the stagger that makes them read as one rolling beat. Kept off
   the very top and bottom edges — that is where the art usually carries faces. */
const ML_BEATS = [
  { y: 110, len: 520, th: 5.5, bow: -80, d:  30 },
  { y: 194, len: 700, th: 8,   bow: -52, d:   0 },
  { y: 278, len: 430, th: 5,   bow: -24, d:  95 },
  { y: 360, len: 790, th: 9.5, bow:   0, d:  45 },
  { y: 444, len: 470, th: 5,   bow:  24, d: 120 },
  { y: 528, len: 690, th: 8,   bow:  52, d:  20 },
  { y: 610, len: 560, th: 6,   bow:  80, d:  70 }
];

/* One feathered, curved streak: out along the upper edge, back along the lower
   one. Both curves start and end at the same tips, so the outline closes to a
   point at each end with no cap to give the shape away. */
function mlBeatPath(b) {
  const x1 = ML_RIGHT, x0 = x1 - b.len;          // right tip → left tip
  const cx = (x0 + x1) / 2, cy = b.y + b.bow;    // control point for the bow
  return "M" + x0 + " " + b.y +
         " Q" + cx + " " + (cy - b.th) + " " + x1 + " " + b.y +
         " Q" + cx + " " + (cy + b.th) + " " + x0 + " " + b.y + " Z";
}

const motionLayer = document.createElement("div");
motionLayer.className = "motion-lines";
motionLayer.setAttribute("aria-hidden", "true");
motionLayer.innerHTML =
  '<svg class="ml-svg" viewBox="0 0 1280 720" preserveAspectRatio="none" aria-hidden="true">' +
    '<defs>' +
      /* Brightest a third of the way along, dying out toward both tips — the
         fade that stops a stroke reading as a hard-edged object. */
      '<linearGradient id="mlFeather" x1="0" y1="0" x2="1" y2="0">' +
        '<stop offset="0"    stop-color="#fffdf2" stop-opacity="0"/>' +
        '<stop offset="0.34" stop-color="#fff8e0" stop-opacity="0.95"/>' +
        '<stop offset="0.72" stop-color="#fff6d8" stop-opacity="0.55"/>' +
        '<stop offset="1"    stop-color="#fffdf2" stop-opacity="0"/>' +
      '</linearGradient>' +
    '</defs>' +
    ML_BEATS.map(function (b) {
      // the <g> carries the motion so the <path> keeps its own geometry
      return '<g class="ml-beat" style="--ml-d:' + b.d + 'ms">' +
               '<path d="' + mlBeatPath(b) + '" fill="url(#mlFeather)"/>' +
             '</g>';
    }).join("") +
  '</svg>';
if (flipbookEl) flipbookEl.appendChild(motionLayer);
let _mlTimer = null;
function motionLines(forward, ms) {
  if (!motionLayer) return;
  if (window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
  const dur = Math.max(260, Math.round(ms || 800));
  motionLayer.classList.remove("on");
  void motionLayer.offsetWidth;                       // restart the sweep cleanly
  motionLayer.style.setProperty("--ml-dur", dur + "ms");
  // A back turn travels the other way. Mirroring the whole drawing flips the
  // sweep AND the direction every stroke bows in, so one class covers it —
  // no per-stroke repositioning like the old straight bars needed.
  motionLayer.classList.toggle("rev", !forward);
  motionLayer.classList.add("on");
  clearTimeout(_mlTimer);
  _mlTimer = setTimeout(function () { motionLayer.classList.remove("on"); }, dur + 260);
}

/* ==========================================================================
   MULTI-PAGE RIFFLE  —  one shared move for "go straight to page N".
   Every page between here and there turns in a staggered cascade (the top of
   the pile first), so a jump still reads as pages moving, not a cut. Used by
   THE END → "Read again" (the REVERSE page-flip back to the beginning).
   ========================================================================== */
function cascadeTo(target, opts) {
  opts = opts || {};
  const from = flipped;
  const to = Math.max(0, Math.min(totalPages - 1, target | 0));
  if (to === from) { if (opts.done) opts.done(); return false; }
  const back = to < from;
  const order = [];                        // the leaves that move, in falling order
  if (back) { for (let i = from - 1; i >= to; i--) order.push(i); }   // top of the pile first
  else      { for (let i = from;     i <  to; i++) order.push(i); }   // this page first
  animating = true; ready = false;         // no other turn may start mid-riffle
  hideFlipHint(); cancelPeek();
  clearTimeout(idleHintTimer); clearTimeout(nudgeHideTimer);
  if (cornerNext) cornerNext.classList.remove("blink", "blink1");
  clearFlipFX(null);
  if (peelFoldWrap) peelFoldWrap.style.display = "none";
  const cv = currentVideo(); if (cv) { try { cv.pause(); } catch (_) {} }
  const dur  = opts.dur     || 0.44;       // seconds per page
  const stag = opts.stagger || 0.09;       // riffle stagger
  motionLines(!back, Math.round((dur + stag * (order.length - 1)) * 1000));
  // RIFFLE SFX — one paper swoosh per page on the tween's own stagger, each
  // ducked and sped up so a long rewind reads as a RIFFLE of pages rather than
  // a wall of noise. Capped at 12 voices: past that they stop being distinct
  // and just pile up (a 25-page rewind would otherwise queue 25 of them).
  sfxRiffle(Math.min(order.length, 12), stag);
  function settle() {
    flipped = to;
    renderLeaves();                        // the .flipped classes own the pose again
    order.forEach(function (i) {
      const l = leaves[i];
      if (G) G.set(l, { clearProps: "transform,transformOrigin" });
      l.style.zIndex = "";
      void l.offsetWidth;                  // commit while transitions are off
      l.style.transition = "";
    });
    updateZ();
    animating = false;
    if (opened) ready = true;
    refreshMedia();                        // the page we landed on starts from the top
    updateProgress();
    resetIdleHint();
    if (opts.done) opts.done();
  }
  if (!G) { settle(); return true; }       // no GSAP → an instant jump
  if (_peelTween) { _peelTween.kill(); _peelTween = null; }
  order.forEach(function (i) { leaves[i].style.transition = "none"; });   // GSAP owns the motion
  const tl = G.timeline({ onComplete: settle });
  order.forEach(function (i, k) {
    const leaf = leaves[i], at = k * stag;
    tl.set(leaf, { zIndex: 330 + k }, at);         // each sheet lands ON the one before
    tl.call(wakeLeaf, [leaf], at);                 // exempt from windowing while in the air
    tl.fromTo(leaf, { rotationY: back ? -180 : 0, transformOrigin: "left center" },
                    { rotationY: back ? 0 : -180, duration: dur, ease: "power2.inOut" }, at);
    // …and dormant again once the next sheet covers it (see wakeLeaf/sleepLeaf).
    if (k + 1 < order.length) tl.call(sleepLeaf, [leaf], (k + 1) * stag + dur);
  });
  return true;
}

/* THE END → "Read again": the REVERSE page-flip. The whole story riffles back
   to the right, page after page, and the book is left OPEN at page 1 with its
   video playing from the start — the reader is back at the beginning without
   ever leaving the book. */
function rewindToStart() {
  if (!opened || !ready || animating) return;
  if (flipped <= 0) { refreshMedia(); return; }
  if (replayBtn) replayBtn.classList.add("busy");
  cascadeTo(0, {
    dur: 0.52, stagger: 0.12,              // slower + wider than a jump: this is the finale
    done: function () { if (replayBtn) replayBtn.classList.remove("busy"); }
  });
}

/* THE END → "Read again": the whole story riffles back to the right AND THEN the
   cover swings shut over it, so the reader lands on the closed FRONT COVER with
   the Play button — a full circle back to where they started.
   closeBookToCover already does both beats (cascadeClose → the closing hinge →
   resetToStart); this only adds the button's pressed state for the duration, and
   holds it until we are actually back on the cover so it can't be double-tapped
   mid-close. */
function closeToCoverFromEnd() {
  if (!opened || animating) return;
  if (replayBtn) replayBtn.classList.add("busy");
  closeBookToCover(function () {
    if (replayBtn) replayBtn.classList.remove("busy");
  });
}

/* ==========================================================================
   LAYER WINDOWING  —  keep the GPU inside its texture budget.
   --------------------------------------------------------------------------
   Every leaf is a preserve-3d, 3D-rotated layer wrapping a 1280x720 video, so
   each one is its own compositing surface. Past a handful of them the GPU runs
   out of texture memory and the compositor starts EVICTING textures, which shows
   up on real machines as pages that intermittently paint BLANK or as ghost art
   bleeding through — and it looks perfectly fine in devtools, because devtools
   is not under the same memory pressure.

   So only a WINDOW around the current page stays live:
     • .near     — this page and its immediate neighbours: promoted (will-change)
     • (neither) — in the window but not promoted
     • .dormant  — guaranteed occluded: visibility:hidden + will-change:auto, so
                   the compositor is free to drop the layer entirely
   Called on every navigation (renderLeaves) and after every settle.
   ========================================================================== */
const LEAF_WINDOW = 2;                    // pages either side kept renderable
function windowLeaves() {
  const cur = flipped;
  leaves.forEach(function (leaf, i) {
    const d = Math.abs(i - cur);
    const dormant = d > LEAF_WINDOW;
    leaf.classList.toggle("dormant", dormant);
    leaf.classList.toggle("near", !dormant && d <= 1);
    // A riffle override never outlives the riffle: every navigation ends by
    // re-windowing, so a killed/interrupted cascade cannot strand a sheet awake.
    leaf.classList.remove("riffling");
  });
}

/* ---- RIFFLE VISIBILITY  —  the counterpart to windowLeaves() ---------------
   The window above keeps only the pages around the CURRENT one renderable;
   everything further out is .dormant (visibility:hidden) so the compositor can
   drop the layer. But a RIFFLE turns pages that are far outside that window —
   from THE END, every sheet except the last two is dormant — so the rewind
   animated INVISIBLY: the reader saw the final couple of sheets fall and then
   the book simply jumped to the cover.
   These wake a sheet for exactly as long as it is in the air. .riffling is an
   OVERRIDE (see styles.css), not a change to the window itself, so windowing
   still owns .dormant and an interrupted cascade can't leave it mis-marked. */
function wakeLeaf(leaf)  { if (leaf) leaf.classList.add("riffling"); }
function sleepLeaf(leaf) { if (leaf) leaf.classList.remove("riffling"); }

/* ==========================================================================
   PRELOADER  —  every asset is in the browser before Play appears.
   --------------------------------------------------------------------------
   • THE MANIFEST BUILDS ITSELF from story.js — every page src, every hotspot
     clip, every scene src, the cover, the sound beds and the two UI sounds.
     Add a page in story.js and it is preloaded; there is no list to maintain
     here, and no way for the manifest to drift out of step with the story.
   • Streaming reader → byte-accurate progress, not "n of m files".
   • SMALLEST FIRST: the cover art, stills and the little sfx land in the first
     moments instead of being starved behind a 3 MB video, so the page looks
     alive immediately. Sizes come from STORY.assetSizes when you supply it (see
     tools/asset-sizes.mjs) and otherwise from a per-extension estimate; either
     way the real total is picked up from Content-Length as soon as the response
     headers arrive, so the bar self-corrects within the first moments. An
     estimate only affects the ORDER and the early smoothness of the bar —
     never whether an asset loads.
   • Concurrency capped at 5.
   • Everything ends up as a blob: URL on its element, so "loaded" really does
     mean local — see useBlob(), which also reverts to the file if a blob ever
     fails to decode.
   • NOTHING BLOCKS. A 4xx, a stall, an abort, a decode failure or file:// (where
     fetch is forbidden) all count as "done" for the bar, and that element simply
     keeps its original src. The button cannot be held hostage by one bad asset.
   ========================================================================== */
// Rough byte estimates used only for ordering/weighting when a real size is not
// known yet. Deliberately generous for video so a big clip still sorts last.
const SIZE_GUESS = { webm: 1500000, mp4: 1500000, webp: 200000, png: 400000,
                     jpg: 300000, jpeg: 300000, ogg: 60000, mp3: 120000 };
function guessSize(url) {
  const m = /\.([a-z0-9]+)(?:[?#]|$)/i.exec(url);
  return (m && SIZE_GUESS[m[1].toLowerCase()]) || 200000;
}

/* Walk story.js and collect every file the book will need, de-duplicated and
   percent-encoded so the keys match what onAssetReady() registered. */
function buildPreloadManifest() {
  const seen = Object.create(null);
  const urls = [];
  function add(u) {
    if (!u) return;
    const k = normUrl(u);
    if (seen[k]) return;
    seen[k] = true;
    urls.push(k);
  }
  // UI chrome the engine always uses, wherever the story goes
  add(HAND_NUDGE_SRC);
  add("sfx/page flip.ogg");
  add("sfx/play button sound.ogg");
  const playImg = document.querySelector(".play-img");
  if (playImg) add(playImg.getAttribute("src"));
  add(STORY.cover);
  // the story itself
  pages.forEach(function (p) {
    if (!p) return;
    add(p.src);
    (p.hotspots || []).forEach(function (h) { add(h && h.src); });
    (p.scenes   || []).forEach(function (s) { add(s && s.src); });
  });
  // the ambient beds (already normalised into VIDEO_SFX above)
  Object.keys(VIDEO_SFX).forEach(function (clip) { add(VIDEO_SFX[clip].url); });

  // assetSizes may be keyed either way round ("a b.webm" or "a%20b.webm"), so
  // try both spellings. decodeURI throws on a stray "%", hence the guard.
  const sizes = STORY.assetSizes || {};
  function plain(u) { try { return decodeURI(u); } catch (_) { return u; } }
  return urls
    .map(function (u) { return [u, sizes[u] || sizes[plain(u)] || guessSize(u)]; })
    .sort(function (a, b) { return a[1] - b[1]; });          // SMALLEST FIRST
}
const PRELOAD_MANIFEST = buildPreloadManifest();
const PRELOAD_CONCURRENCY = 5;
const PRELOAD_TIMEOUT_MS  = 30000;   // per transfer; a stall must not hang the boot

let assetsReady = false;             // openBook() refuses to run until this is true
const loaderEl    = document.getElementById("loader");
const loaderFill  = document.getElementById("loaderFill");
const loaderPct   = document.getElementById("loaderPct");

function preloadFinish() {
  if (assetsReady) return;
  assetsReady = true;
  setLoaderPct(1);
  // SAFETY NET for anything the preloader could not deliver: those elements were
  // parked at preload="none" so they would not double-fetch, and they are still
  // pointing at their original file. Give them their normal preload back so the
  // browser loads them on demand — otherwise a single failed fetch would leave a
  // permanently blank page.
  document.querySelectorAll("video.page-media").forEach(function (v) {
    if (v.preload === "none" && !/^blob:/.test(v.src)) {
      v.preload = "metadata";
      try { v.load(); } catch (_) {}
    }
  });
  if (loaderEl) {
    loaderEl.classList.add("done");
    setTimeout(function () { loaderEl.style.display = "none"; }, 320);
  }
  if (hint) {
    hint.classList.remove("is-loading");
    hint.classList.add("is-ready");
  }
  console.log("%c[flipbook] all assets ready — Play enabled",
              "color:#1c7c3c;font-weight:bold");
}

let _shownPct = 0;
function setLoaderPct(p) {
  // MONOTONIC: a Content-Length correction can shrink the ratio; never go back.
  _shownPct = Math.max(_shownPct, Math.min(1, p));
  const n = Math.round(_shownPct * 100);
  if (loaderFill) loaderFill.style.width = n + "%";
  if (loaderPct)  loaderPct.textContent = n + "%";
  if (loaderEl)   loaderEl.setAttribute("aria-valuenow", String(n));
}

async function bootPreload() {
  if (!PRELOAD_ACTIVE) {
    // file:// — fetch() is blocked by CORS, so there is nothing to preload from.
    // Elements keep their own srcs and the browser loads them normally.
    console.log("[flipbook] file:// — skipping the preloader (fetch is blocked " +
                "on this protocol); media loads on demand instead.");
    preloadFinish();
    return;
  }
  const state = PRELOAD_MANIFEST.map(function (e) {
    return { url: e[0], loaded: 0, total: e[1], done: false };
  });
  function tick() {
    let l = 0, t = 0;
    state.forEach(function (s) {
      t += s.total;
      l += s.done ? s.total : Math.min(s.loaded, s.total);
    });
    setLoaderPct(t ? l / t : 1);
  }
  tick();

  async function one(s) {
    const ctrl = new AbortController();
    const killer = setTimeout(function () { ctrl.abort(); }, PRELOAD_TIMEOUT_MS);
    try {
      const res = await fetch(s.url, { signal: ctrl.signal, credentials: "same-origin" });
      if (!res.ok) throw new Error("HTTP " + res.status);
      const len = Number(res.headers.get("content-length")) || 0;
      if (len > 0) s.total = len;             // refine the weight with the real size
      let blob;
      if (res.body && typeof res.body.getReader === "function") {
        const reader = res.body.getReader();
        const chunks = [];
        for (;;) {
          const r = await reader.read();
          if (r.done) break;
          chunks.push(r.value);
          s.loaded += r.value.length;
          tick();
        }
        blob = new Blob(chunks, { type: res.headers.get("content-type") || "" });
      } else {
        blob = await res.blob();              // no streams: one lump of progress
        s.loaded = blob.size;
      }
      const blobUrl = URL.createObjectURL(blob);
      const targets = _assetTargets.get(normUrl(s.url)) || [];
      targets.forEach(function (fn) { try { fn(blobUrl); } catch (_) {} });
    } catch (err) {
      // Failure NEVER blocks: count it complete, leave the element on its own src.
      console.warn("[flipbook] preload skipped " + s.url + " — " +
                   (err && err.name === "AbortError" ? "timed out" : (err && err.message)));
    } finally {
      clearTimeout(killer);
      s.done = true;
      tick();
    }
  }

  // smallest-first queue drained by a fixed pool of workers
  let next = 0;
  const workers = [];
  for (let w = 0; w < Math.min(PRELOAD_CONCURRENCY, state.length); w++) {
    workers.push((async function () {
      for (;;) {
        const idx = next++;
        if (idx >= state.length) return;
        await one(state[idx]);
      }
    })());
  }
  await Promise.all(workers);
  preloadFinish();
}

/* ---- Boot ---------------------------------------------------------------- */
fitScale();                              // scale the fixed 1280x720 book to fit first
renderLeaves();                          // lay out the leaves (all on page 1 to start)
updateProgress();
bootPreload();                           // …and hold Play until everything is in
