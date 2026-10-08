# Xerath School

Six short narrated video tutorials for the Xerath path, one lesson each:

| Episode | Lesson | Practise it on |
| --- | --- | --- |
| 1 · ARCANOPULSE | The charge is the range — let go the moment it reaches, and lead the half second | PRACTICE › XERATH › ARCANOPULSE |
| 2 · EYE OF DESTRUCTION | Three quarters of a second late: put the centre where they are walking | EYE OF DESTRUCTION |
| 3 · SHOCKING ORB | The stun grows with distance; minions block it | SHOCKING ORB, THE RETREAT |
| 4 · SPACING | Threat ranges, your 1450, and living in the band between them | THE BAND, BEHIND THE WAVE |
| 5 · THE COMBO | A stunned body cannot juke: orb, then Eye, then pulse | STUN, THEN EVERYTHING |
| 6 · RITE OF THE ARCANE | Four shots, four different guesses — and be safe before you root yourself | RITE OF THE ARCANE, THE ARTILLERY |

The rendered episodes live in `docs/xerath-tutorials/`. Everything below is
how to make them again.

## How they are made

Nothing is recorded and nothing is sampled. The script, the pictures and the
sound are all generated from the files in this folder:

- `episodes.json` — every line, who says it, and which scene plays under it.
- `tts.py` — speaks every line with [Kokoro](https://github.com/thewh1teagle/kokoro-onnx),
  a small text-to-speech model that runs locally, and records each line's length.
- `player.html` — one canvas painter per scene, in the trainer's own floor
  vocabulary. Every frame is a pure function of the time into the episode, and
  each scene *cues* its sound effects as its animation crosses them.
- `render.mjs` — draws every frame in headless Chromium and pipes it to ffmpeg,
  with each beat as long as its line.
- `mix.py` — lays the narration where the picture expects it, synthesises the
  cued effects and a quiet music bed that ducks under the voice, and muxes the
  final MP4.

## Rebuilding

Needs Python 3 with `pip install kokoro-onnx soundfile numpy`, Node with
Playwright (`npm i -g playwright`), Chromium, and ffmpeg. Put
`kokoro-v1.0.int8.onnx` and `voices-v1.0.bin` from the
[kokoro-onnx model release](https://github.com/thewh1teagle/kokoro-onnx/releases/tag/model-files-v1.0)
in a folder and point `KOKORO_DIR` at it, then:

```bash
KOKORO_DIR=~/kokoro tools/tutorials/build.sh            # all six
KOKORO_DIR=~/kokoro tools/tutorials/build.sh ep4-spacing # just one
```

The working files go to `tutorial-build/` (ignored by git) and the finished
videos to `docs/xerath-tutorials/`. Change a line in `episodes.json` and the
picture re-times itself to the new voice.
