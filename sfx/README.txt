sfx/  —  SOUND
==============

All audio is Ogg Opus (Chrome / Edge / Firefox / Safari 14.1+).


THIS FOLDER SHIPS EMPTY — nothing but this file
-----------------------------------------------
No sound files come with the template. The book still makes all of its noise:
every cue falls back to a SYNTHESISED version built with the Web Audio API (a
filtered-noise paper swoosh, and a whoosh + bell chime).


THE BOOK'S TWO UI SOUNDS (drop them in with EXACTLY these names)
---------------------------------------------------------------
    page flip.ogg           every page turn
    play button sound.ogg   tapping Play on the cover

That is the whole wiring — the engine looks for these two names by itself, so
there is nothing to register anywhere. To change a sound later, overwrite the
file and keep the name. If a file is absent or will not decode, NOTHING BREAKS:
the synth version is used instead. The console tells you which is live:

    [flipbook] page-flip sound loaded — sfx/page%20flip.ogg
    [flipbook] no <name> file in sfx/ — using the synthesised version instead.

The flip is deliberately the LOUDEST cue in the book — it is what tells the
reader the page actually turned, so it has to cut through the page's voice-over.
Use a SHORT dry clip (~0.3-1.5s, ONE sheet, not a long riffle): the multi-page
riffle heard when the book closes is built by retriggering this one clip on a
stagger.


WHAT YOU CAN ADD: AMBIENT BEDS
------------------------------
A track that rides UNDER one clip's own audio for as long as that clip plays —
music under a dance shot, drums under a band, and so on. Drop the file in here
and name it in `videoSfx` in ../story.js:

    videoSfx: {
      "pages/2.webm": { url: "sfx/crowd.ogg", vol: 0.55 }
    }

  * The key is the clip's src EXACTLY as written in `pages`.
  * `vol` (0..1) sits the bed under the voice-over. 0.5-0.6 works well; a bed
    at full volume buries the dialogue.
  * The bed follows the video by itself — it starts, pauses, resumes and stops
    with the clip, including on a tab switch or ☰ Skip.
  * A bed LONGER than its clip is fine: it is cut off when the video ends
    rather than left playing over the next page.


CONVERTING A SOUND TO OGG OPUS
------------------------------
    ffmpeg -i "your file.mp3" -c:a libopus -b:a 96k -vbr on -application audio \
           -f ogg "your file.ogg"

Use -b:a 64k for a mono source, 96k for stereo. Check the result is SMALLER
than the source before shipping it.


LOUDNESS
--------
A quiet recording cannot be rescued by playback volume — it just sits under the
page videos, inaudible. Check any file with:

    ffmpeg -i "your file.ogg" -af volumedetect -f null NUL   (NUL → /dev/null on mac/linux)

Aim for a peak around -1 to -3 dB. Below about -10 dB it will be too quiet to
hear over the page videos. To lift one:  -af "volume=14dB"  before the encode.


ALSO SYNTHESISED, NO FILE NEEDED
--------------------------------
  * button taps (nav arrows, ☰ menu)  — short wooden click
  * "Read again" chime                — rising bell arpeggio

Audio can only start after the Play tap — browsers refuse sound before a real
user gesture.


NOTE: you do NOT need to register sounds in a preload list. The engine builds
its manifest from story.js on every load.
