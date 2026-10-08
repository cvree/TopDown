"""
The sound half of the tutorials: narration, effects and a music bed, mixed
onto the timeline the pictures were drawn on, and muxed into the final video.

    python3 tools/tutorials/mix.py <build-dir> <out-dir> [episode-id ...]

For every episode it reads <build-dir>/<id>/timeline.json (render.mjs) and
the beat WAVs (tts.py), and writes <out-dir>/<id>.mp4. Every effect is
synthesised here — nothing is sampled — so the whole soundtrack is as
reproducible as the picture.
"""
import json
import os
import subprocess
import sys

import numpy as np
import soundfile as sf

SR = 48000
RNG = np.random.default_rng(7)


def t_(dur):
    return np.arange(int(dur * SR)) / SR


def env(n, attack=0.005, release=None, curve=4.0):
    """An attack ramp and an exponential tail, n samples long."""
    e = np.ones(n)
    a = max(1, int(attack * SR))
    e[:a] = np.linspace(0, 1, a)
    tail = np.linspace(0, 1, n)
    e *= np.exp(-curve * tail) if release is None else 1
    return e


def sweep(f0, f1, dur, kind="sin"):
    t = t_(dur)
    f = np.geomspace(f0, f1, len(t))
    ph = 2 * np.pi * np.cumsum(f) / SR
    if kind == "sq":
        return np.sign(np.sin(ph)) * 0.6
    if kind == "saw":
        return 2 * ((ph / (2 * np.pi)) % 1) - 1
    return np.sin(ph)


def noise(dur):
    return RNG.uniform(-1, 1, int(dur * SR))


def lowpass(x, k=0.08):
    """A one-pole low-pass; k is the share of the new sample let through."""
    y = np.empty_like(x)
    acc = 0.0
    for i, v in enumerate(x):
        acc += k * (v - acc)
        y[i] = acc
    return y


def highpass(x, k=0.08):
    return x - lowpass(x, k)


def tone(freqs, dur, decay=4.0, attack=0.004):
    t = t_(dur)
    s = sum(np.sin(2 * np.pi * f * t) / (i + 1) for i, f in enumerate(freqs))
    return s * env(len(t), attack, curve=decay)


def make_sfx():
    fx = {}
    fx["sting"] = sum(tone([f, f * 2.01], 2.2, decay=2.2, attack=0.15) for f in (220, 261.6, 329.6, 493.9)) * 0.22 + highpass(noise(2.2), 0.3) * env(int(2.2 * SR), 0.6, curve=3) * 0.05
    c = t_(1.3)
    fx["charge"] = sweep(260, 820, 1.3) * (0.6 + 0.4 * np.sin(2 * np.pi * 14 * c)) * np.linspace(0.2, 0.7, len(c)) * 0.45
    fx["release"] = np.concatenate([sweep(500, 1600, 0.09) * env(int(0.09 * SR), 0.001, curve=2), np.zeros(10)]) * 0.5
    z = sweep(1600, 180, 0.32) * env(int(0.32 * SR), 0.001, curve=3)
    fx["zap"] = (z * 0.6 + highpass(noise(0.32), 0.25) * env(int(0.32 * SR), 0.001, curve=7) * 0.5) * 0.8
    b = sweep(110, 38, 0.7) * env(int(0.7 * SR), 0.002, curve=3.5)
    fx["boom"] = (b * 0.9 + lowpass(noise(0.7), 0.06) * env(int(0.7 * SR), 0.002, curve=6) * 1.2) * 0.8
    w = lowpass(noise(0.4), 0.12) * np.sin(np.linspace(0, np.pi, int(0.4 * SR))) ** 2
    fx["cast"] = w * 0.5
    fx["whoosh"] = lowpass(noise(0.55), 0.1) * np.sin(np.linspace(0, np.pi, int(0.55 * SR))) ** 2 * 0.7
    fx["dash"] = highpass(noise(0.25), 0.2) * np.sin(np.linspace(0, np.pi, int(0.25 * SR))) * 0.6
    fx["orb"] = (fx["whoosh"][: int(0.45 * SR)] + sweep(700, 520, 0.45) * env(int(0.45 * SR), 0.01, curve=2) * 0.3) * 0.8
    cr = np.zeros(int(0.5 * SR))
    for i in RNG.integers(0, len(cr) - 200, 60):
        cr[i : i + 120] += RNG.uniform(-1, 1, 120) * np.exp(-np.arange(120) / 25)
    fx["stun"] = (cr * 0.5 + sweep(2200, 1900, 0.5, "sq") * env(int(0.5 * SR), 0.005, curve=5) * 0.12) * 0.8
    fx["ding"] = (tone([880, 1760, 2640], 0.8, decay=5) + np.concatenate([np.zeros(int(0.09 * SR)), tone([1318.5, 2637], 0.71, decay=5)])) * 0.3
    fx["buzz"] = sweep(118, 104, 0.4, "sq") * env(int(0.4 * SR), 0.004, curve=2.5) * 0.28
    fx["thud"] = (sweep(90, 45, 0.3) * env(int(0.3 * SR), 0.001, curve=5) + lowpass(noise(0.3), 0.05) * env(int(0.3 * SR), 0.001, curve=9) * 2) * 0.9
    fx["fizzle"] = (sweep(700, 120, 0.7) * env(int(0.7 * SR), 0.005, curve=2) * 0.4 + np.pad(cr, (0, int(0.2 * SR)))[: int(0.7 * SR)] * 0.4) * 0.8
    fx["ping"] = np.concatenate([tone([740], 0.14, decay=3), tone([988], 0.3, decay=4)]) * 0.35
    fx["pop"] = tone([1046.5], 0.09, decay=6) * 0.3
    fx["rite"] = (sum(tone([f], 0.7, decay=2.5, attack=0.08) for f in (220, 277.2, 329.6)) * 0.25 + highpass(noise(0.7), 0.3) * env(int(0.7 * SR), 0.2, curve=4) * 0.08)
    return fx


def music(dur):
    """A soft bed: Am - F - C - G, a pad and a slow arpeggio, quiet."""
    bpm = 84
    beat = 60 / bpm
    bar = beat * 4
    chords = [(220.0, 261.6, 329.6), (174.6, 220.0, 261.6), (130.8, 196.0, 261.6), (196.0, 246.9, 293.7)]
    out = np.zeros(int(dur * SR) + SR)
    n_bars = int(dur / bar) + 2
    for b in range(n_bars):
        ch = chords[b % 4]
        start = int(b * bar * SR)
        if start >= len(out):
            break
        t = t_(bar)
        pad = sum(np.sin(2 * np.pi * f * t) + 0.3 * np.sin(2 * np.pi * f * 2.003 * t) for f in ch)
        shape = np.minimum(1, np.minimum(t / 0.4, (bar - t) / 0.4))
        seg = pad * shape * 0.05
        # the arpeggio: eighth notes up the chord
        for k in range(8):
            f = ch[k % 3] * (2 if k >= 3 else 1)
            s0 = int(k * beat / 2 * SR)
            note = tone([f, f * 3], beat / 2 * 1.6, decay=6) * 0.05
            end = min(len(seg), s0 + len(note))
            seg[s0:end] += note[: end - s0]
        end = min(len(out), start + len(seg))
        out[start:end] += seg[: end - start]
    return out[: int(dur * SR)]


def load_voice(path):
    data, rate = sf.read(path, dtype="float64")
    if data.ndim > 1:
        data = data.mean(axis=1)
    if rate != SR:
        x_old = np.linspace(0, 1, len(data))
        x_new = np.linspace(0, 1, int(len(data) * SR / rate))
        data = np.interp(x_new, x_old, data)
    peak = np.abs(data).max() or 1
    return data / peak * 0.9


def mix_episode(build, out, ep_id, fx):
    tl = json.load(open(os.path.join(build, ep_id, "timeline.json")))
    n = int((tl["duration"] + 0.5) * SR)
    voice = np.zeros(n)
    for i, start in enumerate(tl["starts"]):
        v = load_voice(os.path.join(build, ep_id, f"beat-{i:02d}.wav"))
        s0 = int((start + 0.12) * SR)
        e = min(n, s0 + len(v))
        voice[s0:e] += v[: e - s0]
    effects = np.zeros(n)
    for c in tl["cues"]:
        clip = fx.get(c["kind"])
        if clip is None:
            continue
        s0 = int(c["t"] * SR)
        e = min(n, s0 + len(clip))
        if s0 < n:
            effects[s0:e] += clip[: e - s0] * c.get("gain", 1)
    bed = music(n / SR)
    # Duck the music under the voice: a smoothed envelope of the narration.
    block = SR // 100
    blocks = np.abs(voice[: n - n % block]).reshape(-1, block).max(axis=1)
    blocks = lowpass(blocks, 0.12)
    talk = np.repeat(blocks, block)
    talk = np.pad(talk, (0, n - len(talk)), mode="edge")
    talk = talk / (talk.max() or 1)
    bed *= 1 - 0.6 * np.clip(talk * 3, 0, 1)
    mixed = voice * 1.0 + effects * 0.55 + bed * 0.9
    fade = int(0.8 * SR)
    mixed[-fade:] *= np.linspace(1, 0, fade)
    mixed /= max(1.0, np.abs(mixed).max() / 0.95)
    wav = os.path.join(build, ep_id, "audio.wav")
    sf.write(wav, mixed.astype(np.float32), SR)
    os.makedirs(out, exist_ok=True)
    dest = os.path.join(out, f"{ep_id}.mp4")
    subprocess.run(
        [
            "ffmpeg", "-y", "-loglevel", "error",
            "-i", os.path.join(build, ep_id, "video.mp4"), "-i", wav,
            "-c:v", "copy", "-c:a", "aac", "-b:a", "160k", "-shortest", "-movflags", "+faststart",
            dest,
        ],
        check=True,
    )
    print(f"{ep_id}: {dest} ({os.path.getsize(dest) / 1e6:.1f} MB, {len(tl['cues'])} effects)")


def main():
    build, out = os.path.abspath(sys.argv[1]), os.path.abspath(sys.argv[2])
    only = sys.argv[3:]
    fx = make_sfx()
    for ep in json.load(open(os.path.join(os.path.dirname(os.path.abspath(__file__)), "episodes.json")))["episodes"]:
        if only and ep["id"] not in only:
            continue
        mix_episode(build, out, ep["id"], fx)


if __name__ == "__main__":
    main()
