# Press kit

Cover art for the CrazyGames submission, at the three sizes the form asks for.

| File | Size | Slot |
|---|---|---|
| `cover-landscape-1920x1080.png` | 1920 × 1080 | Landscape 16:9 |
| `cover-portrait-800x1200.png`   | 800 × 1200  | Portrait 2:3 |
| `cover-square-800x800.png`      | 800 × 800   | Square 1:1 |

## Regenerating them

`cover.html` draws all three from one template — it takes the pixel size and
a composition mode on the query string, and it is pure SVG and CSS with no
WebGL, which is why it renders in milliseconds rather than timing out the way
a headless capture of the live game does.

```
CH="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
"$CH" --headless=new --disable-gpu --hide-scrollbars --force-device-scale-factor=1 \
  --window-size=1920,1080 --virtual-time-budget=3000 \
  --screenshot=press/cover-landscape-1920x1080.png \
  "file://$PWD/press/cover.html?w=1920&h=1080&mode=land"
```

`mode` is `land`, `port` or `sq`. Each mode composes the frame differently
rather than scaling one layout: a 16:9 wants the title beside the hole, a 2:3
wants it above with the hole filling the depth below, and in both the shot
has to fly through the empty part of the frame or the tracer crosses the
words.

The ridgelines come from a seeded RNG, so a re-render is identical.

## Why it is drawn rather than captured

A screenshot of the real game would be more honest and is what these should
eventually be. Headless Chrome cannot render 224,000 triangles through
software GL in any reasonable time, and a capture from a normal browser
window comes out at the window's size rather than at 1920×1080.

The art deliberately uses the game's own palette, its low-poly ridgelines and
its shot tracer, so it is a drawing OF this game rather than generic golf
clip art. If you want real gameplay instead, take three screenshots at these
sizes on your own machine and drop them in over the top.

## Trailer

An ace on a par 3, then the camera climbs to the stars and the title
resolves in 3D.

| File | Size | Use |
|---|---|---|
| `trailer-landscape.gif` | 960 × 540, 6 s | landscape video slot |
| `trailer-portrait.gif`  | 540 × 960, 6 s | portrait video slot |
| `trailer.html`          | any            | the source, for a clean recording |

### Getting a real MP4

The GIFs are ready to use but they are GIFs: 7 MB, 15 fps, 200 colours.
There is no ffmpeg on this machine, so a proper H.264 file has to come from
your side. It takes a minute:

1. Open `press/trailer.html?w=1920&h=1080` in Chrome (or `?w=1080&h=1920`
   for the portrait cut). It loops on its own.
2. Screen-record it — on macOS, Shift-Cmd-5, "Record Selected Portion",
   drag to the animation, Record. Stop after two loops.
3. Trim to one loop in QuickTime (Cmd-T) and export.

That gives 1920×1080 at 60 fps, which is what the store wants, and it is the
same animation frame for frame.

### How the GIFs were made

`trailer.html` renders from ONE number — the time in seconds — so any frame
can be drawn on demand. `?strip=start,count,fps` draws a run of frames as a
vertical column, which is what makes capture practical: 90 frames in 12
headless screenshots instead of 90, because launching Chrome costs far more
than drawing a frame. Pillow slices the columns and writes the GIF against a
shared palette, so the colours do not shimmer between frames.

```
/tmp/mkvid.sh land 960 540 15 6     # name w h fps seconds
```
