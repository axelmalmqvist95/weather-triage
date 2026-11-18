# Kartdata för "En dag på rutten": Södra Skåne som SVG-banor.
# Källor: land (OpenStreetMap via geo-maps countries-land-100m, ODbL), kommungränser (Lantmäteriet, CC0),
# större vägar (Natural Earth, public domain). Bara geometri, inga adresser.
import glob, json, math, pathlib, sys

KD = pathlib.Path(sys.argv[1] if len(sys.argv) > 1 else "kartdata")
UT = pathlib.Path(sys.argv[2] if len(sys.argv) > 2 else "karta.json")

BB = (12.52, 55.30, 13.75, 55.78)
LAT0 = (BB[1] + BB[3]) / 2
KX = math.cos(math.radians(LAT0))
W = 1600
SK = W / ((BB[2] - BB[0]) * KX)
H = round((BB[3] - BB[1]) * SK)

def P(lon, lat): return ((lon - BB[0]) * KX * SK, (BB[3] - lat) * SK)

def dp(pts, tol):
    if len(pts) < 3: return pts
    (x1, y1), (x2, y2) = pts[0], pts[-1]
    dx, dy = x2 - x1, y2 - y1; L = math.hypot(dx, dy) or 1e-9
    imax, dmax = 0, 0
    for i in range(1, len(pts) - 1):
        x, y = pts[i]
        d = abs(dy * x - dx * y + x2 * y1 - y2 * x1) / L if L > 1e-9 else math.hypot(x - x1, y - y1)
        if d > dmax: imax, dmax = i, d
    if dmax > tol:
        return dp(pts[:imax + 1], tol)[:-1] + dp(pts[imax:], tol)
    return [pts[0], pts[-1]]

def nara(lon, lat, m=0.25):
    return BB[0] - m <= lon <= BB[2] + m and BB[1] - m <= lat <= BB[3] + m

def ring_d(ring, tol, sluten=True):
    pts = [P(x, y) for x, y in ring]
    pts = dp(pts, tol)
    if len(pts) < 3 and sluten: return ""
    s = "M" + "L".join(f"{x:.1f},{y:.1f}" for x, y in pts)
    return s + ("Z" if sluten else "")

# Land: bara yttre ringar (hålen i källan är mest skarvar), ringar som når kartan.
land = json.load(open(KD / "land_skane.json"))
land_d = []
for f in land["features"]:
    for poly in f["geometry"]["coordinates"]:
        r = poly[0]
        if any(nara(x, y) for x, y in r):
            # skär bort det som ligger långt utanför, så att banan blir liten
            land_d.append(ring_d([(x, y) for x, y in r if nara(x, y, 1.0)], 0.35))

# Kommungränser i Skåne (yttre ringar), klipps mot land i sidan.
kom_d, kom_namn = [], []
for fil in sorted(glob.glob(str(KD / "sgj/Kommun/*/12*.geojson"))):
    g = json.load(open(fil))
    for ft in g["features"]:
        geo = ft["geometry"]; PP = geo["coordinates"] if geo["type"] == "MultiPolygon" else [geo["coordinates"]]
        for poly in PP:
            r = poly[0]
            if any(nara(x, y, 0.05) for x, y in r):
                kom_d.append(ring_d(r, 0.6))

# Vägar: E6, E20, E22, E65 (inte färjelinjer).
vag = []
for f in json.load(open(KD / "roads.geojson"))["features"]:
    p = f["properties"]
    if "Ferry" in (p.get("type") or ""): continue
    g = f["geometry"]; LL = g["coordinates"] if g["type"] == "MultiLineString" else [g["coordinates"]]
    for l in LL:
        if any(nara(x, y, 0.02) for x, y in l):
            vag.append(dict(d=ring_d(l, 0.5, sluten=False), n=p.get("label") or "", typ=p.get("type")))

# (namn, lon, lat, storlek, dx, dy, ankare) där dx/dy är skärmpixlar vid normal storlek
ORTER = [("Malmö", 13.000, 55.605, 3, 0, -16, "middle"), ("Lund", 13.191, 55.705, 3, -22, -6, "end"),
         ("Trelleborg", 13.157, 55.376, 2, 22, 20, "start"), ("Vellinge", 13.021, 55.471, 1, -22, 4, "end"),
         ("Höllviken", 12.956, 55.410, 1, 6, 30, "middle"), ("Skanör", 12.848, 55.416, 1, -4, -22, "middle"),
         ("Svedala", 13.236, 55.508, 1, -22, 4, "end"), ("Skurup", 13.500, 55.480, 1, 0, -24, "middle"),
         ("Staffanstorp", 13.206, 55.642, 1, 22, 4, "start"), ("Lomma", 13.070, 55.673, 1, -20, -10, "end"),
         ("Köpenhamn", 12.600, 55.676, 0, 0, 0, "middle")]
orter = [dict(n=n, x=round(P(a, b)[0], 1), y=round(P(a, b)[1], 1), s=s, dx=dx, dy=dy, a=an) for n, a, b, s, dx, dy, an in ORTER]
VATTEN = [("Öresund", 12.80, 55.56), ("Östersjön", 13.45, 55.335)]
vatten = [dict(n=n, x=round(P(a, b)[0], 1), y=round(P(a, b)[1], 1)) for n, a, b in VATTEN]

# Dagens stopp: påhittade punkter i rätt ort, ingen adress.
STOPP = {"s01": (13.212, 55.716), "s16": (13.212, 55.716), "s02": (13.082, 55.668), "s03": (12.935, 55.585), "s04": (13.015, 55.520),
         "s05": (13.035, 55.474), "s13": (12.968, 55.418), "s06": (12.862, 55.410), "s07": (13.140, 55.383),
         "s08": (13.232, 55.503), "s09": (13.262, 55.545), "s15": (13.262, 55.545), "s10": (13.492, 55.478), "s11": (13.214, 55.637),
         "s12": (13.214, 55.637)}  # samma kund som s11
stopp = {k: [round(P(a, b)[0], 1), round(P(a, b)[1], 1)] for k, (a, b) in STOPP.items()}

# Rutten som kurva i stoppens ordning. Mellanpunkter håller bilen på land (via Vellinge i stället för över viken).
ORDNING = ["s01", "s16", "s02", "s03", "s04", "s05", "s13", "s06", "s07", "s08", "s09", "s15", "s10", "s11", "s12"]
VIA = {"s06": [(12.93, 55.414), (12.985, 55.425), (13.05, 55.43), (13.10, 55.405)]}  # Skanör -> Trelleborg
kedja, hor = [], []
for i, k in enumerate(ORDNING):
    kedja.append(P(*STOPP[k])); hor.append(i)
    for v in VIA.get(k, []): kedja.append(P(*v)); hor.append(i)
segm = ["" for _ in ORDNING[:-1]]
for j in range(len(kedja) - 1):
    p0, p1, p2, p3 = kedja[max(0, j - 1)], kedja[j], kedja[j + 1], kedja[min(len(kedja) - 1, j + 2)]
    c1 = (p1[0] + (p2[0] - p0[0]) / 6, p1[1] + (p2[1] - p0[1]) / 6); c2 = (p2[0] - (p3[0] - p1[0]) / 6, p2[1] - (p3[1] - p1[1]) / 6)
    s_ = hor[j]
    if not segm[s_]: segm[s_] = f"M{p1[0]:.1f},{p1[1]:.1f}"
    segm[s_] += f"C{c1[0]:.1f},{c1[1]:.1f} {c2[0]:.1f},{c2[1]:.1f} {p2[0]:.1f},{p2[1]:.1f}"

# Kontroll: varje stopp ska ligga på land (punkt i polygon mot svenska ringar).
def inne(pt, ring):
    x, y = pt; c = False
    for (x1, y1), (x2, y2) in zip(ring, ring[1:] + ring[:1]):
        if (y1 > y) != (y2 > y) and x < (x2 - x1) * (y - y1) / (y2 - y1) + x1: c = not c
    return c
swe = [poly[0] for f in land["features"] if f["properties"]["A3"] == "SWE" for poly in f["geometry"]["coordinates"]]
for k, (a, b) in STOPP.items():
    assert any(inne((a, b), r) for r in swe), f"{k} ligger i vattnet"

ORT = {"s01": "Hemma", "s16": "Hemma", "s02": "Lomma", "s03": "Malmö", "s04": "E6 mot Vellinge", "s05": "Vellinge", "s13": "Höllviken",
       "s06": "Skanör", "s07": "Trelleborg", "s08": "Svedala", "s09": "Svedala", "s15": "Svedala", "s10": "Skurup", "s11": "Staffanstorp", "s12": "Staffanstorp"}
# Hemfärd: från sista kunden hem igen.
hk = [P(*STOPP["s11"]), P(*STOPP["s12"]), P(13.232, 55.672), P(*STOPP["s01"]), P(*STOPP["s01"])]
hem = f"M{hk[1][0]:.1f},{hk[1][1]:.1f}"
for j in range(1, 3):
    p0, p1, p2, p3 = hk[j - 1], hk[j], hk[j + 1], hk[j + 2]
    c1 = (p1[0] + (p2[0] - p0[0]) / 6, p1[1] + (p2[1] - p0[1]) / 6); c2 = (p2[0] - (p3[0] - p1[0]) / 6, p2[1] - (p3[1] - p1[1]) / 6)
    hem += f"C{c1[0]:.1f},{c1[1]:.1f} {c2[0]:.1f},{c2[1]:.1f} {p2[0]:.1f},{p2[1]:.1f}"
ut = dict(hem=hem, seg=segm, vb=[W, H], kmper=round(SK / 111.32, 3), ort=ORT, land="".join(land_d), kom="".join(kom_d), vag=vag, orter=orter, vatten=vatten, stopp=stopp,
          kalla="Karta: Lantmäteriet (CC0), OpenStreetMap-bidragsgivare (ODbL), Natural Earth")
UT.write_text(json.dumps(ut, ensure_ascii=False, separators=(",", ":")))
print(UT, W, H, "land", len(ut["land"]), "kom", len(ut["kom"]), "vag", len(vag), sum(len(v["d"]) for v in vag))
