#!/usr/bin/env python3
"""LinkedIn Studio: gör råa bilder och filmer till färdigt LinkedIn-material
i Nanostones designspråk.

Kommandon:
  granska  <mapp>             Översikt av allt i <mapp>/In (kontaktkartor + oversikt.json)
  bygg     <mapp> <plan.json> Bygger veckans inlägg till <mapp>/Klart/<vecka>/
  kontroll <textfil>          Kontrollerar en inläggstext mot regelboken

Kräver Python 3.10+, Pillow och ffmpeg/ffprobe i PATH.
"""
from __future__ import annotations

import argparse
import csv
import json
import math
import re
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path

from PIL import Image, ImageDraw, ImageEnhance, ImageFont, ImageOps

HERE = Path(__file__).resolve().parent
FONTS = HERE / "assets" / "fonts"
LOGOS = HERE / "assets" / "logo"

# Nanostones färger (brandguide O&O 2022)
RED = (229, 47, 25)
DARK = (15, 38, 58)
VINTAGE = (84, 140, 145)
GREY = (200, 201, 201)
LIGHT = (232, 231, 235)
WHITE = (255, 255, 255)
TEXT_GREY = (77, 90, 102)

# Bomärkets geometri, rutnät 208 x 208 (vänstra lilla triangeln används inte)
MARK_MID = [(0, 0), (90, 0), (208, 204.5), (208, 208), (120, 208)]
MARK_RIGHT = [(115, 0), (208, 0), (208, 161)]

FORMATS = {"4:5": (1080, 1350), "1:1": (1080, 1080), "9:16": (1080, 1920), "16:9": (1920, 1080)}
IMAGE_EXT = {".jpg", ".jpeg", ".png", ".webp", ".heic", ".heif", ".tif", ".tiff"}
VIDEO_EXT = {".mp4", ".mov", ".m4v", ".avi", ".mkv", ".webm"}
DAYS = {"mandag": 1, "måndag": 1, "tisdag": 2, "onsdag": 3, "torsdag": 4, "fredag": 5,
        "lordag": 6, "lördag": 6, "sondag": 7, "söndag": 7}

warnings: list[str] = []


def warn(msg: str) -> None:
    if msg not in warnings:
        warnings.append(msg)


# ---------------------------------------------------------------- grunddelar

def font(weight: str, size: int) -> ImageFont.FreeTypeFont:
    return ImageFont.truetype(str(FONTS / f"OpenSans-{weight}.ttf"), size)


def logo(kind: str) -> Image.Image | None:
    """kind: 'vit' (mörk bakgrund) eller 'farg' (ljus bakgrund). Endast officiella filer."""
    names = {
        "vit": ["logo_vit.png", "logo_hvid.png", "Nonostone-logo-Horizontal-White-RGB.png"],
        "farg": ["logo_farg.png", "logo_farve.png", "Nonostone-logo-Horizontal-Original-RGB.png"],
    }[kind]
    for n in names:
        p = LOGOS / n
        if p.exists():
            return Image.open(p).convert("RGBA")
    warn(f"Logofil saknas ({names[0]}) i {LOGOS}. Materialet byggdes utan logotyp.")
    return None


def paste_logo(img: Image.Image, kind: str, x: int, y: int, height: int) -> int:
    """Klistrar in logon med höjden `height`. Returnerar bredden (0 om logon saknas)."""
    lg = logo(kind)
    if lg is None:
        return 0
    w = round(lg.width * height / lg.height)
    lg = lg.resize((w, height), Image.LANCZOS)
    img.paste(lg, (x, y), lg)
    return w


def draw_mark(img: Image.Image, box: tuple[int, int, int, int], side: int) -> None:
    """Ritar det beskurna bomärket med övre högra hörnet i boxens övre högra hörn."""
    x0, y0, x1, y1 = box
    layer = Image.new("RGBA", (x1 - x0, y1 - y0), (0, 0, 0, 0))
    d = ImageDraw.Draw(layer)
    u = side / 208.0
    ox = (x1 - x0) - side
    for poly in (MARK_MID, MARK_RIGHT):
        d.polygon([(ox + x * u, y * u) for x, y in poly], fill=RED + (255,))
    img.paste(layer, (x0, y0), layer)


def cut_box(d: ImageDraw.ImageDraw, box, fill, cut: int = 28) -> None:
    """Ruta med snett avskuret övre högra hörn, samma lutning (\\) som bomärket."""
    x0, y0, x1, y1 = box
    k = round(cut * math.tan(math.radians(30)))
    d.polygon([(x0, y0), (x1 - k, y0), (x1, y0 + cut), (x1, y1), (x0, y1)], fill=fill)


def wrap(text: str, fnt: ImageFont.FreeTypeFont, width: int) -> list[str]:
    lines: list[str] = []
    for para in text.split("\n"):
        words, cur = para.split(), ""
        if not words:
            lines.append("")
            continue
        for w in words:
            test = f"{cur} {w}".strip()
            if fnt.getlength(test) <= width or not cur:
                cur = test
            else:
                lines.append(cur)
                cur = w
        lines.append(cur)
    return lines


def fit_text(text: str, weight: str, width: int, height: int, start: int, minimum: int = 26,
             spacing: float = 1.22):
    """Största teckenstorlek där texten ryms i rutan. Returnerar (font, rader, radhöjd)."""
    size = start
    while True:
        fnt = font(weight, size)
        lines = wrap(text, fnt, width)
        lh = round(size * spacing)
        if lh * len(lines) <= height or size <= minimum:
            if lh * len(lines) > height:
                warn(f"Texten ryms inte helt: \"{text[:50]}\". Korta ner den.")
            return fnt, lines, lh
        size -= 2


def draw_lines(d, xy, lines, fnt, lh, fill) -> int:
    x, y = xy
    for ln in lines:
        d.text((x, y), ln, font=fnt, fill=fill)
        y += lh
    return y


def tag(img: Image.Image, xy, label: str, fill=RED, size: int = 30) -> tuple[int, int]:
    """Liten etikett med snett hörn, t.ex. FÖRE / EFTER / FÖRVALTARENS FRÅGA."""
    d = ImageDraw.Draw(img)
    fnt = font("Bold", size)
    w = round(fnt.getlength(label))
    pad_x, pad_y = round(size * 0.7), round(size * 0.42)
    x, y = xy
    h = size + 2 * pad_y
    cut_box(d, (x, y, x + w + 2 * pad_x + 10, y + h), fill, cut=round(h * 0.45))
    d.text((x + pad_x, y + pad_y - round(size * 0.14)), label, font=fnt, fill=WHITE)
    return w + 2 * pad_x + 10, h


def load_image(path: Path) -> Image.Image:
    try:
        img = Image.open(path)
    except Exception as e:  # t.ex. HEIC utan stöd
        raise SystemExit(f"Kan inte läsa bilden {path.name}: {e}. Spara om den som JPG.")
    return ImageOps.exif_transpose(img).convert("RGB")


def cover(img: Image.Image, size: tuple[int, int], focus=(0.5, 0.5)) -> Image.Image:
    """Skalar och beskär så att bilden fyller `size`. focus = (x, y) 0..1 som hålls kvar."""
    return ImageOps.fit(img, size, Image.LANCZOS, centering=tuple(focus))


def enhance(img: Image.Image) -> Image.Image:
    """Försiktig förbättring. Används aldrig på före/efter-bilder: jämförelsen ska vara ärlig."""
    auto = ImageOps.autocontrast(img, cutoff=0.5)
    img = Image.blend(img, auto, 0.5)
    img = ImageEnhance.Color(img).enhance(1.06)
    return ImageEnhance.Sharpness(img).enhance(1.15)


def save_jpg(img: Image.Image, path: Path) -> Path:
    path.parent.mkdir(parents=True, exist_ok=True)
    img.convert("RGB").save(path, "JPEG", quality=92, optimize=True)
    return path


# ---------------------------------------------------------------- bildkort

def footer(img: Image.Image, h: int = 96) -> None:
    """Mörkblå fot med vit logo och en bit av bomärket."""
    W, H = img.size
    d = ImageDraw.Draw(img)
    d.rectangle((0, H - h, W, H), fill=DARK)
    draw_mark(img, (0, H - h, W, H), side=round(h * 2.6))
    paste_logo(img, "vit", 54, H - h + round(h * 0.29), round(h * 0.42))


def card_photo(src: Path, size, rubrik: str | None, etikett: str | None, focus, forbattra=True):
    """Foto. Utan rubrik: bild + fot. Med rubrik: bild överst, mörkblått fält med text under."""
    W, H = size
    img = Image.new("RGB", size, DARK)
    photo = load_image(src)
    if not rubrik:
        ph = cover(photo, (W, H - 96), focus)
        img.paste(enhance(ph) if forbattra else ph, (0, 0))
        footer(img)
        if etikett:
            tag(img, (54, 54), etikett.upper())
        return img
    band = round(H * 0.31)
    ph = cover(photo, (W, H - band), focus)
    img.paste(enhance(ph) if forbattra else ph, (0, 0))
    draw_mark(img, (0, H - band, W, H), side=round(band * 0.8))
    d = ImageDraw.Draw(img)
    y = H - band + 50
    if etikett:
        _, th = tag(img, (54, y), etikett.upper(), size=26)
        y += th + 26
    logo_h = 40
    text_h = H - 54 - logo_h - 30 - y
    fnt, lines, lh = fit_text(rubrik, "Bold", W - 54 - 380, text_h, start=60)
    draw_lines(d, (54, y), lines, fnt, lh, WHITE)
    paste_logo(img, "vit", 54, H - 54 - logo_h, logo_h)
    return img


def card_before_after(fore: Path, efter: Path, size, rubrik: str | None):
    """Före/efter. Liggande bilder staplas, stående läggs sida vid sida. Ingen bildförbättring."""
    W, H = size
    a, b = load_image(fore), load_image(efter)
    foot = 150 if rubrik else 96
    img = Image.new("RGB", size, WHITE)
    gap = 8
    area_h = H - foot
    if a.width >= a.height:  # stapla
        ph = (area_h - gap) // 2
        img.paste(cover(a, (W, ph)), (0, 0))
        img.paste(cover(b, (W, area_h - gap - ph)), (0, ph + gap))
        pos = [(40, 40), (40, ph + gap + 40)]
    else:  # sida vid sida
        pw = (W - gap) // 2
        img.paste(cover(a, (pw, area_h)), (0, 0))
        img.paste(cover(b, (W - gap - pw, area_h)), (pw + gap, 0))
        pos = [(40, 40), (pw + gap + 40, 40)]
    tag(img, pos[0], "FÖRE", fill=DARK)
    tag(img, pos[1], "EFTER", fill=RED)
    d = ImageDraw.Draw(img)
    d.rectangle((0, H - foot, W, H), fill=DARK)
    draw_mark(img, (0, H - foot, W, H), side=round(foot * 2.4))
    if rubrik:
        fnt, lines, lh = fit_text(rubrik, "Bold", W - 54 - 420, 60, start=40, minimum=24)
        draw_lines(d, (54, H - foot + 24), lines[:1], fnt, lh, WHITE)
        paste_logo(img, "vit", 54, H - 58, 32)
    else:
        paste_logo(img, "vit", 54, H - foot + 28, 40)
    return img


def card_cover(size, titel: str, undertitel: str | None, etikett: str | None, nummer=None):
    """Helt mörkblått kort: omslag till karusell eller seriekort (Förvaltarens fråga)."""
    W, H = size
    img = Image.new("RGB", size, DARK)
    side = round(W * 0.5)
    draw_mark(img, (0, 0, W, H), side=side)
    d = ImageDraw.Draw(img)
    paste_logo(img, "vit", 72, 72, 46)
    y = side + 56
    if etikett:
        label = etikett.upper() + (f"  #{nummer}" if nummer else "")
        _, th = tag(img, (72, y), label, size=30)
        y += th + 44
    bottom = H - 150 - (90 if undertitel else 0)
    fnt, lines, lh = fit_text(titel, "Bold", W - 144, bottom - y, start=88, minimum=40, spacing=1.16)
    y = draw_lines(d, (72, y), lines, fnt, lh, WHITE)
    if undertitel:
        f2, l2, lh2 = fit_text(undertitel, "Regular", W - 72 - 150, 130, start=36)
        draw_lines(d, (72, y + 30), l2, f2, lh2, LIGHT)
    return img


def card_qa(size, fraga: str, svar: str, sist: str | None, nummer=None,
            etikett: str = "Förvaltarens fråga"):
    """Förvaltarens fråga: fråga, kort svar i två stycken och en mening att ta med sig."""
    W, H = size
    img = Image.new("RGB", size, DARK)
    side = round(W * 0.36)
    draw_mark(img, (0, 0, W, H), side=side)
    d = ImageDraw.Draw(img)
    paste_logo(img, "vit", 72, 72, 46)
    y = side + 40
    label = etikett.upper() + (f"  #{nummer}" if nummer else "")
    _, th = tag(img, (72, y), label, size=30)
    y += th + 40
    fq, lq, lhq = fit_text(fraga, "Bold", W - 144, 300, start=68, minimum=44, spacing=1.16)
    y = draw_lines(d, (72, y), lq, fq, lhq, WHITE) + 44
    sist_h = 0
    if sist:
        fs, ls, lhs = fit_text(sist, "Bold", W - 144 - 40, 130, start=40, minimum=30, spacing=1.25)
        sist_h = lhs * len(ls) + 40
    fa, la, lha = fit_text(svar, "Regular", W - 144, H - 84 - sist_h - 40 - y, start=42, minimum=30,
                           spacing=1.42)
    draw_lines(d, (72, y), la, fa, lha, LIGHT)
    if sist:
        top = H - 84 - sist_h + 20
        d.rectangle((72, top, 82, top + lhs * len(ls) + 8), fill=RED)
        draw_lines(d, (72 + 40, top), ls, fs, lhs, WHITE)
    for name, value, limit in (("Frågan", fraga, 12), ("Svaret", svar, 45), ("Slutraden", sist or "", 10)):
        n = len(value.split())
        if n > limit:
            warn(f"{name} på frågekortet är {n} ord. Regeln är högst {limit}.")
    return img


def card_slide(size, nr: int, total: int, rubrik: str, text: str, bild: Path | None, fot: str):
    """Innehållssida i karusell: nummer i röd ruta, rubrik, brödtext, ev. bild överst."""
    W, H = size
    img = Image.new("RGB", size, WHITE)
    d = ImageDraw.Draw(img)
    y = 84
    if bild:
        ih = round(H * 0.42)
        img.paste(enhance(cover(load_image(bild), (W, ih))), (0, 0))
        y = ih + 60
    box = 96
    cut_box(d, (72, y, 72 + box, y + box), RED, cut=30)
    num = str(nr)
    fn = font("Bold", 52)
    d.text((72 + (box - fn.getlength(num)) / 2, y + 12), num, font=fn, fill=WHITE)
    fr, lr, lhr = fit_text(rubrik, "Bold", W - 72 - 72 - box - 30, 150, start=54, minimum=34, spacing=1.15)
    yr = draw_lines(d, (72 + box + 30, y + (4 if len(lr) > 1 else 18)), lr, fr, lhr, DARK)
    y = max(y + box, yr) + 44
    fb, lb, lhb = fit_text(text, "Regular", W - 144, H - 130 - y, start=50, minimum=30, spacing=1.42)
    draw_lines(d, (72, y), lb, fb, lhb, DARK)
    d.line((72, H - 108, W - 72, H - 108), fill=LIGHT, width=3)
    ff = font("Regular", 24)
    d.text((72, H - 84), f"{fot}  ·  {nr}/{total}", font=ff, fill=TEXT_GREY)
    lg = logo("farg")
    if lg is not None:
        lw = round(lg.width * 34 / lg.height)
        paste_logo(img, "farg", W - 72 - lw, H - 90, 34)
    return img


def card_end(size, text: str, undertext: str | None):
    W, H = size
    img = Image.new("RGB", size, DARK)
    side = round(W * 0.5)
    draw_mark(img, (0, 0, W, H), side=side)
    d = ImageDraw.Draw(img)
    y = side + 80
    fnt, lines, lh = fit_text(text, "Bold", W - 72 - 150, 420, start=72, minimum=40, spacing=1.18)
    y = draw_lines(d, (72, y), lines, fnt, lh, WHITE)
    if undertext:
        f2, l2, lh2 = fit_text(undertext, "Regular", W - 72 - 150, 160, start=36)
        draw_lines(d, (72, y + 30), l2, f2, lh2, LIGHT)
    paste_logo(img, "vit", 72, H - 72 - 56, 56)
    return img


def build_carousel(item: dict, src: Path, out: Path, size) -> Path:
    """LinkedIn-dokument (PDF): omslag, innehållssidor och avslutning."""
    sidor = item.get("sidor", [])
    total = len(sidor) + 1 + (1 if item.get("avslut") else 0)
    pages = [card_cover(size, item["titel"], item.get("undertitel"), item.get("etikett"), item.get("nummer"))]
    for i, s in enumerate(sidor, start=1):
        bild = src / s["bild"] if s.get("bild") else None
        pages.append(card_slide(size, i, len(sidor), s["rubrik"], s.get("text", ""), bild,
                                item.get("fot", "Nanostone AB")))
    if item.get("avslut"):
        pages.append(card_end(size, item["avslut"], item.get("avslut_undertext")))
    if not 3 <= total <= 12:
        warn(f"Karusellen \"{item['titel'][:40]}\" har {total} sidor. 6 till 10 brukar hålla läsaren kvar.")
    out.parent.mkdir(parents=True, exist_ok=True)
    pages[0].save(out, "PDF", save_all=True, append_images=pages[1:], resolution=144.0,
                  title=item["titel"], author="Nanostone AB")
    return out


# ---------------------------------------------------------------- film

def run(cmd: list[str]) -> None:
    p = subprocess.run(cmd, capture_output=True, text=True)
    if p.returncode != 0:
        raise SystemExit("ffmpeg misslyckades:\n" + " ".join(cmd[:6]) + " ...\n" + p.stderr[-1500:])


def probe(path: Path) -> dict:
    p = subprocess.run(["ffprobe", "-v", "error", "-print_format", "json", "-show_format",
                        "-show_streams", str(path)], capture_output=True, text=True)
    if p.returncode != 0:
        raise SystemExit(f"Kan inte läsa filmen {path.name}: {p.stderr.strip()[-300:]}")
    data = json.loads(p.stdout)
    v = next((s for s in data["streams"] if s["codec_type"] == "video"), None)
    if v is None:
        raise SystemExit(f"{path.name} innehåller ingen bild.")
    w, h = int(v["width"]), int(v["height"])
    rot = 0
    for sd in v.get("side_data_list", []):
        rot = int(sd.get("rotation", rot) or 0)
    rot = int(v.get("tags", {}).get("rotate", rot) or rot)
    if abs(rot) in (90, 270):
        w, h = h, w
    return {
        "duration": float(data["format"].get("duration", 0) or 0),
        "width": w, "height": h,
        "audio": any(s["codec_type"] == "audio" for s in data["streams"]),
        "created": data["format"].get("tags", {}).get("creation_time"),
    }


def caption_png(size, text: str, path: Path, big: bool = False) -> Path:
    """Genomskinlig textskylt i nedre tredjedelen: mörkblå ruta, röd vänsterkant, snett hörn."""
    W, H = size
    img = Image.new("RGBA", size, (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    pad, margin = 34, 54
    maxw = W - 2 * margin - 2 * pad - 14
    fnt, lines, lh = fit_text(text, "Bold" if big else "SemiBold", maxw, 400,
                              start=64 if big else 46, minimum=32, spacing=1.2)
    tw = max(round(fnt.getlength(ln)) for ln in lines)
    bh = lh * len(lines) + 2 * pad
    y1 = H - round(H * 0.11)
    box = (margin, y1 - bh, margin + tw + 2 * pad + 14 + 30, y1)
    cut_box(d, box, DARK + (235,), cut=40)
    d.rectangle((box[0], box[1], box[0] + 12, box[3]), fill=RED + (255,))
    draw_lines(d, (box[0] + 14 + pad, box[1] + pad - 6), lines, fnt, lh, WHITE)
    img.save(path)
    return path


def watermark_png(size, path: Path) -> Path | None:
    lg = logo("vit")
    if lg is None:
        return None
    img = Image.new("RGBA", size, (0, 0, 0, 0))
    h = 38
    w = round(lg.width * h / lg.height)
    plate = Image.new("RGBA", (w + 44, h + 32), DARK + (215,))
    img.paste(plate, (40, 40), plate)
    lg = lg.resize((w, h), Image.LANCZOS)
    img.paste(lg, (62, 56), lg)
    img.save(path)
    return path


def build_film(item: dict, src: Path, out: Path) -> Path:
    """Klipper ihop filmklipp och stillbilder till en film med rubrik, textskyltar och slutkort."""
    clips = item["klipp"]
    first = src / clips[0]["in"]
    fmt = item.get("format")
    if not fmt:
        if first.suffix.lower() in VIDEO_EXT:
            meta = probe(first)
            fmt = "4:5" if meta["height"] >= meta["width"] else "1:1"
        else:
            fmt = "4:5"
    size = FORMATS[fmt]
    W, H = size
    enc = ["-c:v", "libx264", "-preset", "medium", "-crf", "18", "-pix_fmt", "yuv420p", "-r", "30",
           "-c:a", "aac", "-b:a", "160k", "-ar", "48000", "-ac", "2"]
    any_audio = False
    with tempfile.TemporaryDirectory() as td:
        tmp = Path(td)
        wm = watermark_png(size, tmp / "wm.png")
        segs: list[Path] = []
        for i, c in enumerate(clips):
            p = src / c["in"]
            if not p.exists():
                raise SystemExit(f"Filen finns inte: {p}")
            is_img = p.suffix.lower() in IMAGE_EXT
            overlays: list[tuple[Path, str]] = []
            if is_img:
                dur = float(c.get("langd", 3))
                big = cover(load_image(p), (W * 2, H * 2), c.get("fokus", (0.5, 0.5)))
                still = tmp / f"still{i}.jpg"
                big.save(still, quality=95)
                frames = round(dur * 30)
                inputs = ["-loop", "1", "-framerate", "30", "-t", f"{dur}", "-i", str(still),
                          "-f", "lavfi", "-t", f"{dur}", "-i", "anullsrc=r=48000:cl=stereo"]
                base = (f"[0:v]zoompan=z='1+0.10*on/{frames}':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)'"
                        f":d=1:s={W}x{H}:fps=30,setsar=1[b0]")
                amap, n_in = "1:a", 2
            else:
                meta = probe(p)
                dur = min(float(c.get("langd", 4)), meta["duration"] or 4)
                start = float(c["start"]) if "start" in c else max(0.0, (meta["duration"] - dur) / 2)
                if start + dur > meta["duration"] + 0.05:
                    warn(f"{p.name}: klippet {start}+{dur} s går utanför filmen ({meta['duration']:.1f} s).")
                use_audio = meta["audio"] and not c.get("tyst") and not item.get("tyst")
                any_audio = any_audio or use_audio
                inputs = ["-ss", f"{start}", "-t", f"{dur}", "-i", str(p)]
                n_in = 1
                if use_audio:
                    amap = "0:a"
                else:
                    inputs += ["-f", "lavfi", "-t", f"{dur}", "-i", "anullsrc=r=48000:cl=stereo"]
                    amap, n_in = "1:a", 2
                base = (f"[0:v]scale={W}:{H}:force_original_aspect_ratio=increase,crop={W}:{H},"
                        f"fps=30,setsar=1[b0]")
            hook = item.get("rubrik") if i == 0 else None
            hook_t = min(3.0, dur)
            if hook:
                overlays.append((caption_png(size, hook, tmp / f"hook{i}.png", big=True),
                                 f"lt(t,{hook_t})"))
            if c.get("text"):
                cond = f"gte(t,{hook_t})" if hook else "1"
                if not hook or dur - hook_t >= 1.0:
                    overlays.append((caption_png(size, c["text"], tmp / f"cap{i}.png"), cond))
                else:
                    warn(f"Klipp 1 är för kort för både rubrik och textskylt. Textskylten hoppades över.")
            if wm:
                overlays.append((wm, "1"))
            fc, last = [base], "b0"
            for k, (png, cond) in enumerate(overlays):
                inputs += ["-loop", "1", "-t", f"{dur}", "-i", str(png)]
                fc.append(f"[{last}][{n_in + k}:v]overlay=0:0:enable='{cond}'[b{k + 1}]")
                last = f"b{k + 1}"
            seg = tmp / f"seg{i}.mp4"
            run(["ffmpeg", "-y", "-v", "error", *inputs, "-filter_complex", ";".join(fc),
                 "-map", f"[{last}]", "-map", amap, "-t", f"{dur}", "-map_metadata", "-1", *enc, str(seg)])
            segs.append(seg)
        if item.get("slutkort", True):
            end = tmp / "end.png"
            card_end(size, item.get("slut_text", "Nanostone AB"), item.get("slut_undertext")).save(end)
            seg = tmp / "segend.mp4"
            run(["ffmpeg", "-y", "-v", "error", "-loop", "1", "-framerate", "30", "-t", "1.8", "-i", str(end),
                 "-f", "lavfi", "-t", "1.8", "-i", "anullsrc=r=48000:cl=stereo",
                 "-vf", "fade=t=in:st=0:d=0.3,setsar=1", "-map", "0:v", "-map", "1:a", "-t", "1.8", *enc, str(seg)])
            segs.append(seg)
        lst = tmp / "list.txt"
        lst.write_text("".join(f"file '{s}'\n" for s in segs))
        out.parent.mkdir(parents=True, exist_ok=True)
        af = ["-af", "loudnorm=I=-16:TP=-1.5:LRA=11"] if any_audio else []
        run(["ffmpeg", "-y", "-v", "error", "-f", "concat", "-safe", "0", "-i", str(lst), *af,
             "-c:v", "libx264", "-preset", "medium", "-crf", "20", "-pix_fmt", "yuv420p", "-r", "30",
             "-c:a", "aac", "-b:a", "160k", "-ar", "48000", "-map_metadata", "-1", "-movflags", "+faststart", str(out)])
    total = probe(out)["duration"]
    if total > 90:
        warn(f"Filmen {out.name} är {total:.0f} s. Under 60 s brukar fler se klart.")
    return out


# ---------------------------------------------------------------- textkontroll

BANNED = [
    "i dagens", "i en värld", "i en tid där", "det är ingen hemlighet", "låt oss dyka", "dyka ner i",
    "glada att meddela", "stolta över att", "stolt över att", "game changer", "nästa nivå",
    "sammanfattningsvis", "tveka inte", "häng med", "vi brinner för", "i framkant",
    "skräddarsydda lösningar", "helhetslösning", "vad tycker ni?", "vad tycker du?", "håller du med?",
    "det handlar om", "banbrytande", "kort sagt", "det är där", "här är grejen", "här är saken",
    "på riktigt", "det låter enkelt", "i grunden",
]
BANNED_WORDS = ["resa", "resan", "passion", "bokstavligen", "sömlös", "sömlöst", "avgörande", "nyckeln"]
PATTERNS = [
    (r"handlar (det )?inte (bara )?om[^.\n]{2,80}(utan|det handlar) om", "\"handlar inte om X utan om Y\""),
    (r"inte bara[^.\n]{2,60}utan", "\"inte bara X utan Y\""),
    (r"inte för att[^.\n]{2,80}utan för att", "\"inte för att X utan för att Y\""),
    (r"räcker inte (om|när)", "\"X räcker inte om Y\""),
    (r"^därför\b", "stycke som börjar med \"Därför\""),
    (r"^(här är|här kommer) \d+ ", "listlöfte i första raden"),
]
# Ordantal per dag (Axels rutin). Torsdagens text hänvisar till bilden och är därför kort.
WORDS = {"måndag": (50, 90), "mandag": (50, 90), "tisdag": (80, 110), "torsdag": (35, 70)}


MONEY = re.compile(r"\d[\d\s.,]*\s*(kr\b|kronor|sek\b|:-|tkr\b|mkr\b|miljon)", re.I)
MONEY_WORDS = ["omsättning", "timpris", "marginal", "fakturer", "offertbelopp", "kvadratmeterpris"]
ADDRESS = re.compile(r"\b[A-ZÅÄÖ][a-zåäöé]+(gatan|vägen|gränd|stigen|allén|torget|backen|plan)\s+\d+")


def check_sensitive(text: str) -> list[str]:
    """Det som aldrig får synas, varken i text eller på bild: adresser, belopp, ekonomi."""
    out = []
    if ADDRESS.search(text):
        out.append("Gatuadress i texten. Adresser får aldrig synas.")
    if MONEY.search(text):
        out.append("Belopp i texten. Priser, kostnader och omsättning får aldrig synas.")
    for w in MONEY_WORDS:
        if w in text.lower():
            out.append(f"Ekonomiuppgift: \"{w}\". Skriv om tjänsten och metoden, inte om pengar.")
    return out


def media_texts(m: dict) -> str:
    """All text som hamnar på bild eller film för en mediapost."""
    parts = [m.get(k, "") for k in ("rubrik", "etikett", "titel", "undertitel", "fraga", "svar", "sist",
                                    "avslut", "avslut_undertext", "slut_text", "slut_undertext")]
    parts += [s_.get("rubrik", "") + " " + s_.get("text", "") for s_ in m.get("sidor", [])]
    parts += [c.get("text", "") for c in m.get("klipp", [])]
    return "\n".join(x for x in parts if x)


def check_text(text: str, dag: str | None = None) -> tuple[list[str], list[str]]:
    """Returnerar (fel, varningar). Fel ska rättas innan publicering."""
    errors, notes = [], []
    low = text.lower()
    if "—" in text or " – " in text:
        errors.append("Tankstreck används. Byt mot punkt eller komma.")
    if "!" in text:
        errors.append("Utropstecken används.")
    if re.search(r"#\w", text.replace("fråga #", "fråga ")):
        errors.append("Hashtagg används. Tagga @Nanostone sist i stället.")
    if re.search(r"[\U0001F300-\U0001FAFF☀-➿]", text):
        errors.append("Emoji används.")
    if re.search(r"https?://|www\.", low):
        errors.append("Länk i texten. Länkar hör inte hemma i inlägget.")
    errors += check_sensitive(text)
    for b in BANNED:
        if b in low:
            errors.append(f"AI-fras: \"{b}\". Skriv en konkret detalj i stället.")
    for w in BANNED_WORDS:
        if re.search(rf"\b{w}\b", low):
            errors.append(f"AI-ord: \"{w}\".")
    for pat, name in PATTERNS:
        if re.search(pat, low, flags=re.M):
            errors.append(f"Schablonmönster: {name}.")
    if "[fyll i" in low or "[kontrollera" in low:
        errors.append("Det finns [FYLL I: ...] eller [KONTROLLERA: ...] kvar i texten.")
    if len(text) > 3000:
        errors.append(f"Texten är {len(text)} tecken. LinkedIn tillåter 3 000.")
    first = text.strip().split("\n", 1)[0]
    if len(first) > 140:
        notes.append(f"Första raden är {len(first)} tecken. Över ca 140 klipps den före \"visa mer\" i mobilen.")
    if dag in ("tisdag",) and len(first.split()) > 12:
        notes.append(f"Tisdagens första rad är {len(first.split())} ord. Regeln är en ståndpunkt på högst 12.")
    n = len(text.split())
    if dag in WORDS and not WORDS[dag][0] <= n <= WORDS[dag][1]:
        notes.append(f"Texten är {n} ord. Riktmärket för {dag} är {WORDS[dag][0]} till {WORDS[dag][1]}.")
    if dag == "torsdag" and not low.lstrip().startswith(("förvaltarens fråga", "ny serie: förvaltarens fråga")):
        notes.append("Torsdagens text ska börja med \"Förvaltarens fråga #N.\"")
    if "@nanostone" not in low:
        notes.append("@Nanostone är inte taggat sist i inlägget.")
    return errors, notes


# ---------------------------------------------------------------- granska

def contact_sheet(path: Path, out: Path, n: int = 8) -> dict:
    meta = probe(path)
    dur = meta["duration"]
    times = [dur * (i + 0.5) / n for i in range(n)]
    tw, th = 480, round(480 * meta["height"] / max(meta["width"], 1))
    th = min(th, 640)
    cols = 4
    sheet = Image.new("RGB", (cols * tw, math.ceil(n / cols) * (th + 44) + 50), WHITE)
    d = ImageDraw.Draw(sheet)
    d.text((12, 8), f"{path.name}  ·  {dur:.1f} s  ·  {meta['width']}x{meta['height']}"
           f"  ·  {'ljud' if meta['audio'] else 'inget ljud'}", font=font("Bold", 26), fill=DARK)
    with tempfile.TemporaryDirectory() as td:
        for i, t in enumerate(times):
            fr = Path(td) / f"f{i}.jpg"
            subprocess.run(["ffmpeg", "-y", "-v", "error", "-ss", f"{t}", "-i", str(path), "-frames:v", "1",
                            "-vf", f"scale={tw}:{th}:force_original_aspect_ratio=decrease", str(fr)],
                           capture_output=True)
            x, y = (i % cols) * tw, 50 + (i // cols) * (th + 44)
            if fr.exists():
                sheet.paste(Image.open(fr), (x, y))
            d.text((x + 10, y + th + 6), f"{t:.1f} s", font=font("SemiBold", 24), fill=DARK)
    save_jpg(sheet, out)
    return meta


def cmd_granska(args) -> None:
    root = Path(args.mapp).expanduser()
    src = root / "In"
    if not src.is_dir():
        for sub in ("In", "Klart", "Arkiv"):
            (root / sub).mkdir(parents=True, exist_ok=True)
        print(f"Skapade mapparna In, Klart och Arkiv i {root}. Lägg bilder och filmer i In.")
        return
    out = root / "_granskning"
    if out.exists():
        shutil.rmtree(out)
    out.mkdir()
    files = sorted(p for p in src.iterdir() if p.is_file() and not p.name.startswith("."))
    info, thumbs = [], []
    for p in files:
        ext = p.suffix.lower()
        if ext in VIDEO_EXT:
            meta = contact_sheet(p, out / f"{p.stem}_film.jpg")
            info.append({"fil": p.name, "typ": "film", **meta, "kontaktkarta": f"{p.stem}_film.jpg"})
        elif ext in IMAGE_EXT:
            im = load_image(p)
            info.append({"fil": p.name, "typ": "bild", "width": im.width, "height": im.height})
            im.thumbnail((480, 480))
            thumbs.append((p.name, im))
        elif ext in {".txt", ".md"}:
            info.append({"fil": p.name, "typ": "anteckning", "text": p.read_text(errors="replace")[:4000]})
        else:
            info.append({"fil": p.name, "typ": "okänd"})
    for s in range(0, len(thumbs), 12):
        chunk = thumbs[s:s + 12]
        sheet = Image.new("RGB", (4 * 500, math.ceil(len(chunk) / 4) * 540), WHITE)
        d = ImageDraw.Draw(sheet)
        for i, (name, im) in enumerate(chunk):
            x, y = (i % 4) * 500 + 10, (i // 4) * 540 + 10
            sheet.paste(im, (x, y))
            d.text((x, y + 488), name[:34], font=font("SemiBold", 22), fill=DARK)
        save_jpg(sheet, out / f"bilder_{s // 12 + 1}.jpg")
    for i in info:
        if ADDRESS.search(i["fil"].replace("_", " ").replace("-", " ")):
            i["varning"] = "Filnamnet ser ut att innehålla en adress. Byt namn på filen."
    (out / "oversikt.json").write_text(json.dumps(info, ensure_ascii=False, indent=2))
    print(f"{len(files)} filer i In. Översikt: {out}")
    for i in info:
        extra = f"{i['duration']:.1f} s" if i["typ"] == "film" else ""
        print(f"  {i['typ']:<10} {i['fil']} {extra}")
        if i.get("varning"):
            print(f"             VARNING  {i['varning']}")


# ---------------------------------------------------------------- bygg

def cmd_bygg(args) -> None:
    root = Path(args.mapp).expanduser()
    src = root / "In"
    plan = json.loads(Path(args.plan).expanduser().read_text())
    vecka = plan["vecka"]
    base = root / "Klart" / vecka
    rows, used = [], set()
    failed = False
    for post in plan["inlagg"]:
        dag = post["dag"].lower()
        d = base / f"{DAYS.get(dag, 9)}-{dag.replace('å', 'a').replace('ö', 'o')}"
        if d.exists():
            shutil.rmtree(d)
        d.mkdir(parents=True)
        text = post["text"].strip() + "\n"
        (d / "inlagg.txt").write_text(text)
        if post.get("kommentar"):
            (d / "forsta-kommentar.txt").write_text(post["kommentar"].strip() + "\n")
        errors, notes = check_text(text, dag)
        for m in post.get("media", []):
            errors += [f"På bild/film: {e}" for e in check_sensitive(media_texts(m))]
        print(f"\n{dag.capitalize()} {post.get('datum', '')}".rstrip())
        for e in errors:
            print(f"  FEL      {e}")
        for n in notes:
            print(f"  Notera   {n}")
        failed = failed or bool(errors)
        kinds = []
        for n, m in enumerate(post.get("media", []), start=1):
            typ = m["typ"]
            size = FORMATS[m.get("format", "4:5")]
            kinds.append(typ)
            if typ == "bild":
                img = card_photo(src / m["in"], size, m.get("rubrik"), m.get("etikett"),
                                 m.get("fokus", (0.5, 0.5)), m.get("forbattra", True))
                o = save_jpg(img, d / f"{n}-bild.jpg")
                used.add(m["in"])
            elif typ == "fore-efter":
                o = save_jpg(card_before_after(src / m["fore"], src / m["efter"], size, m.get("rubrik")),
                             d / f"{n}-fore-efter.jpg")
                used.update([m["fore"], m["efter"]])
            elif typ == "fraga":
                if m.get("svar"):
                    card = card_qa(size, m["fraga"], m["svar"], m.get("sist"), m.get("nummer"),
                                   m.get("etikett", "Förvaltarens fråga"))
                else:
                    card = card_cover(size, m["fraga"], m.get("undertitel"),
                                      m.get("etikett", "Förvaltarens fråga"), m.get("nummer"))
                o = save_jpg(card, d / f"{n}-fraga.jpg")
            elif typ == "karusell":
                o = build_carousel(m, src, d / f"{n}-karusell.pdf", size)
                used.update(s["bild"] for s in m.get("sidor", []) if s.get("bild"))
            elif typ == "film":
                o = build_film(m, src, d / f"{n}-film.mp4")
                used.update(c["in"] for c in m["klipp"])
            else:
                raise SystemExit(f"Okänd mediatyp: {typ}")
            print(f"  Klart    {o.relative_to(root)}")
        rows.append([post.get("datum", ""), vecka, dag, "+".join(kinds) or "text",
                     text.split("\n", 1)[0][:80]])
    log = root / "resultat.csv"
    new = not log.exists()
    seen = set()
    if not new:
        with log.open(newline="", encoding="utf-8-sig") as f:
            seen = {(r[1], r[2]) for r in csv.reader(f, delimiter=";") if len(r) > 2}
    rows = [r for r in rows if (r[1], r[2]) not in seen]
    with log.open("a", newline="", encoding="utf-8" if not new else "utf-8-sig") as f:
        w = csv.writer(f, delimiter=";")
        if new:
            w.writerow(["datum", "vecka", "dag", "format", "första raden", "visningar", "reaktioner",
                        "kommentarer", "delningar", "förfrågningar"])
        w.writerows(rows)
    if args.arkivera:
        arch = root / "Arkiv" / vecka
        arch.mkdir(parents=True, exist_ok=True)
        for name in sorted(used):
            if (src / name).exists():
                shutil.move(str(src / name), str(arch / name))
        print(f"\nFlyttade {len(used)} använda filer till {arch.relative_to(root)}")
    for w_ in warnings:
        print(f"\nVARNING  {w_}")
    print(f"\nVeckan ligger i {base}")
    if failed:
        sys.exit(2)


def cmd_kontroll(args) -> None:
    errors, notes = check_text(Path(args.fil).expanduser().read_text())
    for e in errors:
        print(f"FEL      {e}")
    for n in notes:
        print(f"Notera   {n}")
    if not errors and not notes:
        print("Inga anmärkningar.")
    sys.exit(2 if errors else 0)


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = ap.add_subparsers(dest="cmd", required=True)
    g = sub.add_parser("granska")
    g.add_argument("mapp")
    g.set_defaults(fn=cmd_granska)
    b = sub.add_parser("bygg")
    b.add_argument("mapp")
    b.add_argument("plan")
    b.add_argument("--arkivera", action="store_true", help="flytta använda filer från In till Arkiv")
    b.set_defaults(fn=cmd_bygg)
    k = sub.add_parser("kontroll")
    k.add_argument("fil")
    k.set_defaults(fn=cmd_kontroll)
    args = ap.parse_args()
    args.fn(args)


if __name__ == "__main__":
    main()
