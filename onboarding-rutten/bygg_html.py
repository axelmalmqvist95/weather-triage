# Bygger en fristående HTML-fil: "En dag på rutten". Allt inbäddat, inga nätanrop.
import base64, io, json, pathlib
from PIL import Image

HAR = pathlib.Path(__file__).resolve().parent
RUT = HAR
SRC = RUT / "bilder"
FONT = pathlib.Path("/home/user/weather-triage/onboarding-film/assets/typsnitt")
LOGO = pathlib.Path("/home/user/weather-triage/linkedin-studio/assets/logo/logo_vit.png")

# Beskärning (x0, y0, x1, y1 i andelar). Tar bort hus, fönster med inredning och annat som inte behövs.
BESKAR = {
    "uppfart-fore": (0, 0, 1, 1), "uppfart-efter": (0, 0, 1, 1),
    "vatten": (0, 0, 1, 1), "fasad": (0, 0, 1, 1), "kant": (0, 0, 1, 1),
    "zebra": (0, .2, 1, 1), "provtvatt": (0, .2, 1, 1),
    "smagatsten": (0, .36, 1, 1), "altan-pool": (0, .3, 1, 1),
    "villa": (0, 0, 1, .62), "bil": (0, .28, 1, .95), "sen": (0, 0, 1, 1), "matning": (.2, 0, .95, 1), "ranna-flow": (.25, 0, 1, 1), "kvall": (.2, 0, 1, 1), "ranna": (.08, .18, .9, .9), "tak-pavaxt": (0, 0, 1, 1), "fasad-skum": (0, 0, 1, .8), "gang-fore": (0, .2, 1, 1), "gang-efter": (0, .2, 1, 1),
}

def jpeg(namn, maxb=900, q=74):
    im = Image.open(SRC / f"{namn}.png").convert("RGB")
    x0, y0, x1, y1 = BESKAR.get(namn, (0, 0, 1, 1))
    w, h = im.size
    im = im.crop((int(x0 * w), int(y0 * h), int(x1 * w), int(y1 * h)))
    if im.width > maxb:
        im = im.resize((maxb, round(im.height * maxb / im.width)), Image.LANCZOS)
    b = io.BytesIO(); im.save(b, "JPEG", quality=q, optimize=True, progressive=True)  # ingen EXIF följer med
    return "data:image/jpeg;base64," + base64.b64encode(b.getvalue()).decode()

def b64(p): return base64.b64encode(pathlib.Path(p).read_bytes()).decode()

data = json.loads((RUT / "situationer-v2.json").read_text())
S = data["situationer"]

# Sprid rätt svar jämnt över A, B och C. Texterna flyttas, inget innehåll ändras.
MAL = "BCCABCABCACBBAB"
for s, mal in zip(S, MAL):
    ordning = [k for k in "ABC" if k != s["ratt"]]
    ordning.insert("ABC".index(mal), s["ratt"])
    s["alt"] = {ny: s["alt"][gl] for ny, gl in zip("ABC", ordning)}
    s["kons"] = {ny: s["kons"][gl] for ny, gl in zip("ABC", ordning)}
    s["ratt"] = mal
print("Rätt svar:", "".join(s["ratt"] for s in S))

bild_namn = sorted({s["bild"] for s in S if s.get("bild")})
BILDER = {n: jpeg(n) for n in bild_namn}

html = (HAR / "mall.html").read_text()
html = html.replace("__DATA__", json.dumps(data, ensure_ascii=False))
html = html.replace("__BILDER__", json.dumps(BILDER))
FE = {
    "uppfart": dict(f=jpeg("uppfart-fore", 900, 74), e=jpeg("uppfart-efter", 900, 74), svep=False, t="Stentvätt av uppfart"),
    "gang": dict(f=jpeg("gang-fore", 900, 74), e=jpeg("gang-efter", 900, 74), svep=False, t="Stentvätt med ogräsrensning"),
    "vitlav": dict(f=jpeg("vitlav-fore", 900, 74), e=jpeg("vitlav-efter", 900, 74), svep=True, t="Stentvätt, vitlav borta"),
    "trall": dict(f=jpeg("trall-fore", 900, 74), e=jpeg("trall-efter", 900, 74), svep=True, t="Altantvätt"),
    "fasad": dict(f=jpeg("fasad-fore", 900, 74), e=jpeg("fasad-efter", 900, 74), svep=True, t="Fasad före och efter"),
}
html = html.replace("__FE__", json.dumps(FE))
html = html.replace("__KAPITEL_CSS__", (HAR / "kapitel.css").read_text())
html = html.replace("__KAPITEL_JS__", "\n".join((HAR / f).read_text() for f in ("kapitel_3d.js", "kapitel_innehall.js", "kapitel_fe.js")))
html = html.replace("__KAPFOTO__", json.dumps({k: jpeg({"forar":"kf-forar-qr","utr":"kf-last"}.get(k,"kf-"+k), 820, 72) for k in ("dack","matare","skada","fv","fh","bh","bv","forar","last","qr","dack28","lampa","utr")}))
html = html.replace("__LOGOF__", "data:image/png;base64," + b64(LOGO.with_name("logo_farg.png")))
html = html.replace("__KARTA__", (RUT / "karta.json").read_text())
html = html.replace("__LOGO__", "data:image/png;base64," + b64(LOGO))
html = html.replace("__BSD800__", b64(FONT / "big-shoulders-display-latin-800-normal.woff2"))
html = html.replace("__BSD800X__", b64(FONT / "big-shoulders-display-latin-ext-800-normal.woff2"))
html = html.replace("__OS400__", b64(FONT / "OpenSans-Regular.ttf"))
html = html.replace("__OS700__", b64(FONT / "OpenSans-Bold.ttf"))
import re as _re
assert not _re.search(r"__(?!THREE__|HUSFILM_DATA__|BILINFILM__|KORFILM__|VILLAFILM__)[A-Z_]+__", html), _re.findall(r"__[A-Z_]+__", html)[:3]
html = html.replace("__HUSFILM_DATA__", base64.b64encode((HAR / "husfilm.mp4").read_bytes()).decode())
html = html.replace("__VILLAFILM__", base64.b64encode((HAR / "villafilm.mp4").read_bytes()).decode())
html = html.replace("__KORFILM__", base64.b64encode((HAR / "korfilm.mp4").read_bytes()).decode())
html = html.replace("__BILINFILM__", base64.b64encode((HAR / "bilinfilm.mp4").read_bytes()).decode())
for tecken in ("—", "–"):
    assert tecken not in json.dumps(data, ensure_ascii=False), "tankstreck i texten"
ut = RUT / "en-dag-pa-rutten.html"
ut.write_text(html)
print(ut, round(len(html) / 1e6, 2), "MB")
