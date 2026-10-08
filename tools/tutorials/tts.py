"""
The narration: every line of episodes.json, spoken, one WAV per beat.

    python3 tools/tutorials/tts.py <out-dir>

Needs `pip install kokoro-onnx soundfile` and the two Kokoro model files —
kokoro-v1.0.int8.onnx and voices-v1.0.bin from the kokoro-onnx GitHub
releases — in $KOKORO_DIR (default: ./.kokoro). Writes <out-dir>/<episode>/
beat-NN.wav and <out-dir>/narration.json, which holds every beat's length so
the renderer can time the pictures to the voice rather than the other way
round.
"""
import json
import os
import sys

import soundfile as sf
from kokoro_onnx import Kokoro

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.abspath(sys.argv[1] if len(sys.argv) > 1 else "tutorial-build")
MODELS = os.environ.get("KOKORO_DIR", os.path.join(os.getcwd(), ".kokoro"))

# Spelled for the voice, not for the eye. The captions keep the real words.
SAY = {
    "Xerath": "Zerath",
    "APEX": "Apex",
    "Ezreal": "Ezreal",
    "Kurbo": "Kurbo",
}


def spoken(text: str) -> str:
    for k, v in SAY.items():
        text = text.replace(k, v)
    return text


def main() -> None:
    script = json.load(open(os.path.join(HERE, "episodes.json")))
    k = Kokoro(os.path.join(MODELS, "kokoro-v1.0.int8.onnx"), os.path.join(MODELS, "voices-v1.0.bin"))
    out = {}
    for ep in script["episodes"]:
        d = os.path.join(OUT, ep["id"])
        os.makedirs(d, exist_ok=True)
        lengths = []
        for i, beat in enumerate(ep["beats"]):
            who = script["cast"][beat["who"]]
            path = os.path.join(d, f"beat-{i:02d}.wav")
            samples, rate = k.create(spoken(beat["say"]), voice=who["voice"], speed=who["speed"], lang=who["lang"])
            sf.write(path, samples, rate)
            lengths.append(round(len(samples) / rate, 3))
            print(f"{ep['id']} {i:02d} {beat['who']:<6} {lengths[-1]:5.2f}s  {beat['say'][:60]}")
        out[ep["id"]] = lengths
    json.dump(out, open(os.path.join(OUT, "narration.json"), "w"), indent=2)


if __name__ == "__main__":
    main()
