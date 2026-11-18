#!/usr/bin/env python3
"""Bygger assets/ för välkomstfilmen från källorna i config.json.

Körs en gång (och igen när bilder, karta eller logga byts):
    python3 forbered.py

Skapar:
  assets/typsnitt/   Big Shoulders Display 700/800 + Open Sans
  assets/ordbild.png ordbilden ur den officiella vita logotypen (utan bomärke)
  assets/karta.json  Sverige + grannländer + länsgränser + årets besök, projicerat i km
  assets/bilder/     före/efter-par, inriktade mot varandra och beskurna till 9:16
Kräver: Pillow, numpy, opencv-python-headless.
"""
import json, math, re, shutil, subprocess, sys, tempfile
from pathlib import Path

import numpy as np
from PIL import Image, ImageFilter, ImageOps

HAR = Path(__file__).resolve().parent
ASSETS = HAR / 'assets'
CFG = json.loads((HAR / 'config.json').read_text(encoding='utf-8'))
K = CFG['kallor']


def info(*a):
    print('  ', *a, flush=True)


# ---------------------------------------------------------------- typsnitt
def typsnitt():
    ut = ASSETS / 'typsnitt'; ut.mkdir(parents=True, exist_ok=True)
    bs = Path(K['bigshoulders_mapp'])
    if not (bs / 'big-shoulders-display-latin-800-normal.woff2').exists():
        info('Big Shoulders saknas lokalt, hämtar @fontsource/big-shoulders-display från npm ...')
        tmp = Path(tempfile.mkdtemp())
        subprocess.run(['npm', 'pack', '@fontsource/big-shoulders-display', '--silent'], cwd=tmp, check=True)
        tgz = next(tmp.glob('*.tgz'))
        subprocess.run(['tar', 'xzf', str(tgz)], cwd=tmp, check=True)
        bs = tmp / 'package' / 'files'
    for w in (700, 800):
        for sub in ('latin', 'latin-ext'):
            f = bs / f'big-shoulders-display-{sub}-{w}-normal.woff2'
            if f.exists():
                shutil.copy(f, ut / f.name)
    for n in ('OpenSans-Regular.ttf', 'OpenSans-SemiBold.ttf', 'OpenSans-Bold.ttf'):
        shutil.copy(Path(K['opensans_mapp']) / n, ut / n)
    info('typsnitt klara')


# ---------------------------------------------------------------- logga
def ordbild():
    im = Image.open(K['logo_vit']).convert('RGBA')
    a = np.array(im)[:, :, 3]
    cols = np.where(a.max(0) > 0)[0]
    # bomärket är fyrkanten längst till vänster; ordbilden börjar efter första stora luckan
    gap = next(i for i in range(1, len(cols)) if cols[i] - cols[i - 1] > 30)
    x0 = int(cols[gap])
    h = im.height
    im.crop((x0, 0, im.width, h)).save(ASSETS / 'ordbild.png')
    meta = {'x0': x0, 'w': im.width - x0, 'h': h, 'mark': int(cols[gap - 1]) + 1}
    info('ordbild', meta)
    return meta


# ---------------------------------------------------------------- karta
R = 6371.0
L0 = math.radians(15.0)


def tm(lon, lat):
    """Sfärisk transversal Mercator kring 15°E (som SWEREF 99 TM). km, y nedåt."""
    l = math.radians(lon) - L0; p = math.radians(lat)
    B = math.cos(p) * math.sin(l)
    B = max(-0.999999, min(0.999999, B))
    x = 0.5 * R * math.log((1 + B) / (1 - B))
    y = R * math.atan2(math.tan(p), math.cos(l))
    return x, -y


def rdp(pts, eps):
    """Douglas-Peucker, iterativ."""
    if len(pts) < 4:
        return pts
    P = np.asarray(pts); keep = np.zeros(len(P), bool); keep[0] = keep[-1] = True
    stack = [(0, len(P) - 1)]
    while stack:
        i, j = stack.pop()
        if j <= i + 1:
            continue
        a, b = P[i], P[j]; d = b - a; n = math.hypot(*d)
        seg = P[i + 1:j] - a
        dist = np.abs(seg[:, 0] * d[1] - seg[:, 1] * d[0]) / n if n > 0 else np.hypot(seg[:, 0], seg[:, 1])
        k = int(np.argmax(dist))
        if dist[k] > eps:
            m = i + 1 + k; keep[m] = True; stack += [(i, m), (m, j)]
    return P[keep].tolist()


def ring_area(r):
    a = 0.0
    for (x1, y1), (x2, y2) in zip(r, r[1:] + r[:1]):
        a += x1 * y2 - x2 * y1
    return abs(a) / 2


def topo_lander(path, ids):
    topo = json.loads(Path(path).read_text())
    sc, tr = topo['transform']['scale'], topo['transform']['translate']
    arcs = []
    for arc in topo['arcs']:
        x = y = 0; out = []
        for dx, dy in arc:
            x += dx; y += dy; out.append((x * sc[0] + tr[0], y * sc[1] + tr[1]))
        arcs.append(out)

    def ring(idx):
        pts = []
        for i in idx:
            a = arcs[i] if i >= 0 else arcs[~i][::-1]
            pts += a if not pts else a[1:]
        return pts
    res = {}
    for g in topo['objects']['countries']['geometries']:
        if g.get('id') not in ids:
            continue
        polys = [g['arcs']] if g['type'] == 'Polygon' else g['arcs']
        res[g['id']] = [[ring(r) for r in poly] for poly in polys]
    return res


def karta():
    # Sverige och grannar ur Natural Earth 1:10m
    ids = {'752': 'SE', '578': 'NO', '246': 'FI', '208': 'DK', '276': 'DE', '616': 'PL',
           '233': 'EE', '428': 'LV', '440': 'LT'}
    land = topo_lander(K['world_atlas'], ids)
    out = {'land': {}, 'lan': [], 'punkter': [], 'regioner': {}}
    for cid, polys in land.items():
        rings = []
        for poly in polys:
            for r in poly[:1]:  # yttre ringar räcker (sjöhål i NE-länder är försumbara)
                if not any(3 < lon < 33 and 53 < lat < 71.5 for lon, lat in r):
                    continue
                pr = [tm(lon, lat) for lon, lat in r]
                if ring_area(pr) < (0.4 if cid == '752' else 4):
                    continue
                pr = rdp(pr, 0.06 if cid == '752' else 0.25)
                rings.append([round(v, 2) for p in pr for v in p])
        out['land'][ids[cid]] = rings
        info(ids[cid], len(rings), 'ringar', sum(len(r) // 2 for r in rings), 'punkter')

    # Länsgränser ur Driftcentralens LAN (grova, används bara som svaga linjer)
    html = Path(K['lan_html']).read_text(encoding='utf-8')
    i = html.index('const LAN=') + len('const LAN=')
    lan, _ = json.JSONDecoder().raw_decode(html[i:])
    for f in lan['features']:
        g = f['geometry']
        polys = [g['coordinates']] if g['type'] == 'Polygon' else g['coordinates']
        for p in polys:
            out['lan'].append([round(v, 2) for lon, lat in p[0] for v in tm(lon, lat)])

    # Årets utförda besök (D.karta.gjort -> D.P/D.PR), summerat per koordinat. Inga namn eller adresser.
    mapp = Path(K['kartdata_mapp'])
    meta = json.loads((mapp / 'meta.json').read_text())
    txt = ''.join(json.loads((mapp / f'del{i}.json').read_text())['s'] for i in range(meta['delar']))
    D = json.loads(txt)
    regnamn = list(CFG['regioner'].keys())
    agg = {}
    for g in D['karta']['gjort']:
        idx, n = g[0], g[1]
        p = D['P'][idx]; r = (D.get('PR') or [None] * len(D['P']))[idx]
        key = (p[0], p[1])
        a = agg.setdefault(key, [0, r])
        a[0] += n
    for (lat, lon), (n, r) in agg.items():
        x, y = tm(lon, lat)
        out['punkter'].append([round(x, 2), round(y, 2), n, regnamn.index(r) if r in regnamn else -1])
    for namn, r in CFG['regioner'].items():
        (a, b), (c, d) = r['bb']
        xs, ys = zip(*[tm(a, b), tm(c, b), tm(a, d), tm(c, d)])
        out['regioner'][namn] = {'bb': [min(xs), min(ys), max(xs), max(ys)]}
    out['genererad'] = D.get('genererad')
    (ASSETS / 'karta.json').write_text(json.dumps(out, separators=(',', ':')))
    info('besökspunkter', len(out['punkter']), 'koordinater,', sum(p[2] for p in out['punkter']), 'besök')


# ---------------------------------------------------------------- bilder
def las(p):
    import cv2
    im = ImageOps.exif_transpose(Image.open(p)).convert('RGB')
    return cv2.cvtColor(np.array(im), cv2.COLOR_RGB2BGR)


def gradient(g):
    import cv2
    g = cv2.GaussianBlur(g, (0, 0), 2)
    m = cv2.magnitude(cv2.Sobel(g, cv2.CV_32F, 1, 0), cv2.Sobel(g, cv2.CV_32F, 0, 1))
    return m / (m.max() + 1e-6)


def sift_init(a, b):
    import cv2
    s = 1600 / max(a.shape[:2]); s2 = 1600 / max(b.shape[:2])
    ga = cv2.cvtColor(cv2.resize(a, None, fx=s, fy=s), cv2.COLOR_BGR2GRAY)
    gb = cv2.cvtColor(cv2.resize(b, None, fx=s2, fy=s2), cv2.COLOR_BGR2GRAY)
    sift = cv2.SIFT_create(6000)
    ka, da = sift.detectAndCompute(ga, None); kb, db = sift.detectAndCompute(gb, None)
    m = cv2.FlannBasedMatcher({'algorithm': 1, 'trees': 5}, {'checks': 64}).knnMatch(db, da, k=2)
    good = [x for x, y in m if x.distance < 0.72 * y.distance]
    pb = np.float32([kb[g.queryIdx].pt for g in good]) / s2
    pa = np.float32([ka[g.trainIdx].pt for g in good]) / s
    H, mask = cv2.findHomography(pb, pa, cv2.RANSAC, 4.0 / s)
    return H  # efter -> före


def justera(a, b, metod, maskpoly):
    """Returnerar efter-bilden varpad in i före-bildens koordinater + giltighetsmask."""
    import cv2
    h, w = a.shape[:2]
    if metod.startswith('sift'):
        H = sift_init(a, b)  # efter->före
        W = np.linalg.inv(H)  # ECC-konvention: före-koord -> efter-koord
    else:
        b = cv2.resize(b, (w, h), interpolation=cv2.INTER_AREA) if b.shape[:2] != (h, w) else b
        W = np.eye(3)
    W = W.astype(np.float32)
    cc = 0
    for bredd in (400, 800, 1400):
        s = bredd / w
        ga = gradient(cv2.cvtColor(cv2.resize(a, None, fx=s, fy=s, interpolation=cv2.INTER_AREA), cv2.COLOR_BGR2GRAY).astype(np.float32))
        sb = bredd / b.shape[1]
        gb = gradient(cv2.cvtColor(cv2.resize(b, None, fx=sb, fy=sb, interpolation=cv2.INTER_AREA), cv2.COLOR_BGR2GRAY).astype(np.float32))
        mk = None
        if maskpoly:
            mk = np.zeros(ga.shape, np.uint8)
            cv2.fillPoly(mk, [np.int32([[x * ga.shape[1], y * ga.shape[0]] for x, y in maskpoly])], 255)
        S = np.diag([s, s, 1]).astype(np.float32); Sb = np.diag([sb, sb, 1]).astype(np.float32)
        Wi = (Sb @ W @ np.linalg.inv(S)).astype(np.float32)
        try:
            cc, Wi = cv2.findTransformECC(ga, gb, Wi, cv2.MOTION_HOMOGRAPHY,
                                          (cv2.TERM_CRITERIA_EPS | cv2.TERM_CRITERIA_COUNT, 300, 1e-6), mk, 5)
        except cv2.error:
            pass
        W = (np.linalg.inv(Sb) @ Wi @ S).astype(np.float32)
    wb = cv2.warpPerspective(b, W, (w, h), flags=cv2.INTER_LANCZOS4 | cv2.WARP_INVERSE_MAP)
    valid = cv2.warpPerspective(np.full(b.shape[:2], 255, np.uint8), W, (w, h),
                                flags=cv2.INTER_NEAREST | cv2.WARP_INVERSE_MAP)
    return wb, valid, float(cc)


def vit_kant(a):
    """Mask för vita fält runt en sammanfogad bild (t.ex. panorama), räknat från kanterna."""
    import cv2
    white = (a.min(axis=2) >= 248).astype(np.uint8)
    n, lab, stats, _ = cv2.connectedComponentsWithStats(white, 4)
    bad = np.zeros_like(white)
    h, w = white.shape
    for i in range(1, n):
        x, y, bw, bh, area = stats[i]
        if (x == 0 or y == 0 or x + bw == w or y + bh == h) and area > 0.002 * h * w:
            bad[lab == i] = 1
    return bad


NAVY = np.array([15, 38, 58], np.float32) / 255


def gradera_par(f, e):
    """Färgmatchning av paret + gemensam gradering för alla foton.
    1) Vitbalans: efter-bildens kanalbalans dras halvvägs mot före-bildens (gråvärld), ljusheten
       lämnas orörd så att skillnaden i ytan (det rena) syns, men inte en skillnad i ljus/kamera.
    2) Svärtan lyfts mot varumärkets marinblå, mjuk S-kurva, lätt sänkt mättnad i högdagrar."""
    f = f.astype(np.float32) / 255; e = e.astype(np.float32) / 255
    rf = f.reshape(-1, 3).mean(0); re_ = e.reshape(-1, 3).mean(0)
    bf = rf / rf.mean(); be = re_ / re_.mean()
    e = np.clip(e * (bf / be) ** 0.5, 0, 1)
    def grade(x):
        lum = x @ np.array([0.2126, 0.7152, 0.0722], np.float32)
        s = x * x * (3 - 2 * x)                       # smoothstep
        x = x + (s - x) * 0.22                        # mjuk kontrast
        lift = (1 - lum)[..., None] ** 3 * 0.11       # lyft svärtan mot marin
        x = x * (1 - lift) + NAVY * lift * 1.25
        g = (x @ np.array([0.2126, 0.7152, 0.0722], np.float32))[..., None]
        x = g + (x - g) * 0.94                        # lite lugnare färger
        return np.clip(x, 0, 1)
    return [(grade(x) * 255 + np.random.default_rng(5).uniform(-0.5, 0.5, x.shape)).round().clip(0, 255).astype(np.uint8)
            for x in (f, e)]


def tvatta_digitalt(smutsig, ref, yta):
    """Gör en "tvättad" version av den smutsiga bilden. I LAB-färgrymd delas bilden i en grov nivå
    (fläckar, algbeläggning, ojämn ton; gaussisk oskärpa) och en fin nivå (stenens ballast, fogar, kanter).
    Den grova nivån flyttas mot referensens (rena bildens) medelvärde med kraftigt minskad variation,
    så fläckar och grönton försvinner; den fina nivån behålls nästan helt, så fogarna står kvar som mörka
    linjer exakt där de var. Färg- och ljushetsstatistik hämtas från ett stenområde i båda bilderna."""
    import cv2
    h, w = smutsig.shape[:2]
    x0, y0, x1, y1 = int(yta[0] * w), int(yta[1] * h), int(yta[2] * w), int(yta[3] * h)
    S = cv2.cvtColor(smutsig, cv2.COLOR_RGB2LAB).astype(np.float32)
    Rf = cv2.cvtColor(ref, cv2.COLOR_RGB2LAB).astype(np.float32)
    out = np.empty_like(S)
    for c, (behall_grov, fin, skift) in enumerate([(0.25, 0.92, -9.0), (0.12, 0.6, 0.0), (0.12, 0.6, 0.0)]):
        ch = S[..., c]
        grov = cv2.GaussianBlur(ch, (0, 0), 18)
        detalj = ch - grov
        ms = grov[y0:y1, x0:x1].mean()
        mr = Rf[y0:y1, x0:x1, c].mean()
        ny_grov = mr + skift + (grov - ms) * behall_grov
        out[..., c] = ny_grov + detalj * fin
    # fogar: behåll dem tydligt mörkare än stenen (förstärk den fina nivåns mörka del lite)
    L = out[..., 0]; d = S[..., 0] - cv2.GaussianBlur(S[..., 0], (0, 0), 6)
    out[..., 0] = L + np.minimum(d, 0) * 0.35
    out = np.clip(out, 0, 255).astype(np.uint8)
    return cv2.cvtColor(out, cv2.COLOR_LAB2RGB)


def bilder():
    import cv2
    ut = ASSETS / 'bilder'; ut.mkdir(parents=True, exist_ok=True)
    W_UT, H_UT = 1296, 2304
    lista = []
    for nr, b in enumerate(CFG['bilder'], 1):
        a = las(b['fore']); e = las(b['efter'])
        wb, valid, cc = justera(a, e, b.get('justering', 'ecc'), b.get('mask'))
        ok = (valid > 0) & (vit_kant(a) == 0)
        h, w = a.shape[:2]; u = b.get('utsnitt', {})
        ch = u.get('h', 1.0) * h
        for _ in range(60):
            cw = ch * 9 / 16
            if cw > w:
                ch = w * 16 / 9; continue
            cx = min(max(u.get('cx', 0.5) * w, cw / 2), w - cw / 2)
            cy = min(max(u.get('cy', 0.5) * h, ch / 2), h - ch / 2)
            x0, y0 = int(round(cx - cw / 2)), int(round(cy - ch / 2))
            x1, y1 = x0 + int(cw), y0 + int(ch)
            if ok[y0:y1, x0:x1].mean() > 0.9995:
                break
            ch *= 0.97
        else:
            sys.exit(f'Bildpar {b["id"]}: hittar inget giltigt 9:16-utsnitt efter inriktning.')
        if x1 - x0 < W_UT:
            info(f'VARNING: {b["id"]} utsnitt {x1 - x0}px brett, skalas upp till {W_UT}px')
        cf, ce = (cv2.cvtColor(cv2.resize(img[y0:y1, x0:x1], (W_UT, H_UT), interpolation=cv2.INTER_AREA), cv2.COLOR_BGR2RGB)
                  for img in (a, wb))
        if b.get('ren_fran_fore'):
            # Ren version byggd av SAMMA foto som den smutsiga: geometrin (fogar, ballast) blir identisk.
            # Den riktiga efterbilden används bara som färg- och ljushetsreferens.
            ce = tvatta_digitalt(cf, ce, b.get('referensyta', [0.0, 0.45, 1.0, 1.0]))
        cf, ce = gradera_par(cf, ce)
        for namn, c in (('fore', cf), ('efter', ce)):
            im = Image.fromarray(c).filter(ImageFilter.UnsharpMask(radius=1.1, percent=45, threshold=2))  # skärpa efter skalning
            im.save(ut / f'{nr}-{namn}.jpg', quality=95, subsampling=0)
        info(f'{b["id"]}: ECC {cc:.2f}, utsnitt {x1 - x0}x{y1 - y0} px')
        lista.append({'nr': nr, 'id': b['id'], 'tjanst': b['tjanst'], 'fokus': b.get('fokus', [0.5, 0.5]),
                      'fore': f'assets/bilder/{nr}-fore.jpg', 'efter': f'assets/bilder/{nr}-efter.jpg'})
    return lista


def reservbilder():
    """Enstaka foton för montagets reservsekvens (när inga filmklipp är inlagda). Samma gradering."""
    import cv2
    ut = ASSETS / 'bilder'; ut.mkdir(parents=True, exist_ok=True)
    W_UT, H_UT = 1296, 2304
    lista = []
    for nr, b in enumerate(CFG.get('reservbilder', []), 1):
        a = las(b['fil']); h, w = a.shape[:2]; u = b.get('utsnitt', {})
        ch = min(u.get('h', 1.0) * h, w * 16 / 9); cw = ch * 9 / 16
        cx = min(max(u.get('cx', 0.5) * w, cw / 2), w - cw / 2); cy = min(max(u.get('cy', 0.5) * h, ch / 2), h - ch / 2)
        x0, y0 = int(cx - cw / 2), int(cy - ch / 2)
        c = cv2.cvtColor(cv2.resize(a[y0:y0 + int(ch), x0:x0 + int(cw)], (W_UT, H_UT), interpolation=cv2.INTER_AREA), cv2.COLOR_BGR2RGB)
        c, _ = gradera_par(c, c)
        Image.fromarray(c).filter(ImageFilter.UnsharpMask(radius=1.1, percent=45, threshold=2)).save(ut / f'reserv-{nr}.jpg', quality=95, subsampling=0)
        info(f'reservbild {b["id"]}: utsnitt {int(cw)}x{int(ch)} px')
        lista.append({'id': b['id'], 'fil': f'assets/bilder/reserv-{nr}.jpg', 'fokus': b.get('fokus', [0.5, 0.5])})
    return lista


def main():
    ASSETS.mkdir(exist_ok=True)
    steg = sys.argv[1:] or ['typsnitt', 'logga', 'karta', 'bilder', 'reserv']
    meta_p = ASSETS / 'meta.json'
    meta = json.loads(meta_p.read_text()) if meta_p.exists() else {}
    if 'typsnitt' in steg:
        print('Typsnitt'); typsnitt()
    if 'logga' in steg:
        print('Logga'); meta['ordbild'] = ordbild()
    if 'karta' in steg:
        print('Karta'); karta()
    if 'bilder' in steg:
        print('Bilder'); meta['bilder'] = bilder()
    if 'reserv' in steg or 'bilder' in steg:
        print('Reservbilder'); meta['reservbilder'] = reservbilder()
    meta['regioner'] = list(CFG['regioner'].keys())
    meta_p.write_text(json.dumps(meta, ensure_ascii=False, indent=1))
    print('Klart:', ASSETS)


if __name__ == '__main__':
    main()
