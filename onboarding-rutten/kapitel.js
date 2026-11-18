/* ---------- Kapitel i 3D (CSS 3D, inga bibliotek) ---------- */
const LOGOF = "__LOGOF__";

function d3(cls, css, foralder, html){ const e=document.createElement("div"); if(cls) e.className=cls; if(css) e.style.cssText=css; if(html!=null) e.innerHTML=html; foralder && foralder.appendChild(e); return e; }
function plats(x,y,z,extra){ return `transform:translate3d(${x}px,${y}px,${z}px) ${extra||""}`; }
/* Låda med sex sidor. x längs bilen/huset, y nedåt, z mot betraktaren. */
function lada(foralder, x,y,z, w,h,d, sidor, extra){
  const g = d3("g3", plats(x,y,z,extra), foralder);
  const F = (namn, fw, fh, tf) => { const s = sidor[namn]; if(s===false) return null;
    return d3("f", `width:${fw}px;height:${fh}px;left:${-fw/2}px;top:${-fh/2}px;transform:${tf};${s||sidor.alla||""}`, g); };
  g.sidor = {
    fram: F("fram", w,h,`translateZ(${d/2}px)`), bak: F("bak", w,h,`rotateY(180deg) translateZ(${d/2}px)`),
    hoger: F("hoger", d,h,`rotateY(90deg) translateZ(${w/2}px)`), vanster: F("vanster", d,h,`rotateY(-90deg) translateZ(${w/2}px)`),
    topp: F("topp", w,d,`rotateX(90deg) translateZ(${h/2}px)`), botten: F("botten", w,d,`rotateX(-90deg) translateZ(${h/2}px)`)
  };
  return g;
}
function platta(foralder, x,y,z, w,d, css, extra){ return d3("f2", `width:${w}px;height:${d}px;left:${-w/2}px;top:${-d/2}px;${plats(x,y,z,"rotateX(90deg) "+(extra||""))};${css}`, foralder); }
function hjul(foralder, x,y,z, r){
  const g = d3("g3", plats(x,y,z), foralder);
  for(let i=-3;i<=3;i++){ const ytter = Math.abs(i)===3;
    d3("f2", `width:${2*r}px;height:${2*r}px;left:${-r}px;top:${-r}px;border-radius:50%;transform:translateZ(${i*4}px);background:${ytter?"radial-gradient(circle,#c9d1d8 0 34%,#5d6873 35% 44%,#15191d 45%)":"#0d1013"}`, g); }
  return g;
}
function falskQR(n){
  const c=document.createElement("canvas"), N=25, s=8; c.width=c.height=N*s+16; const x=c.getContext("2d");
  x.fillStyle="#fff"; x.fillRect(0,0,c.width,c.height); x.fillStyle="#0f263a";
  let fro=7; const rnd=()=>{ fro=(fro*16807)%2147483647; return fro/2147483647; };
  for(let i=0;i<N;i++) for(let j=0;j<N;j++){ if(rnd()>.52) x.fillRect(8+i*s,8+j*s,s,s); }
  const hörn=(a,b)=>{ x.fillStyle="#fff"; x.fillRect(8+a*s-s,8+b*s-s,9*s,9*s); x.fillStyle="#0f263a"; x.fillRect(8+a*s,8+b*s,7*s,7*s); x.fillStyle="#fff"; x.fillRect(8+a*s+s,8+b*s+s,5*s,5*s); x.fillStyle="#0f263a"; x.fillRect(8+a*s+2*s,8+b*s+2*s,3*s,3*s); };
  hörn(0,0); hörn(N-7,0); hörn(0,N-7);
  return c.toDataURL();
}
const QR = falskQR();
const KAMIKON = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M4 8h3l2-3h6l2 3h3v11H4z"/><circle cx="12" cy="13" r="3.5"/></svg>`;
function nal(foralder, x,y,z, inne, id){ const m = d3("mark", plats(x,y,z), foralder); m.dataset.id=id; m.innerHTML=`<div class="pin">${inne}</div>`; m.dataset.x=x; m.dataset.y=y; m.dataset.z=z; return m; }

/* ---------- Scen: servicebilen ---------- */
function byggBil(rot){
  const vit="background:linear-gradient(180deg,#ffffff,#e3e9ee)", vitM="background:linear-gradient(180deg,#e9eef2,#c9d3db)", glas="background:linear-gradient(160deg,#4d6b80,#16222c 60%,#2c4252)";
  platta(rot, 0,0,0, 1500,1100, "background:radial-gradient(closest-side,#2a4256,#16293a 60%,#0b1824 100%)");
  platta(rot, 0,-0.5,0, 1500,1100, "background:repeating-linear-gradient(90deg,transparent 0 118px,rgba(255,255,255,.05) 118px 120px),repeating-linear-gradient(0deg,transparent 0 118px,rgba(255,255,255,.05) 118px 120px)");
  platta(rot, -30,-1,175, 520,6, "background:#e8edf0;opacity:.7"); platta(rot, -30,-1,-175, 520,6, "background:#e8edf0;opacity:.7");
  platta(rot, 40,-1.5,0, 560,230, "background:radial-gradient(closest-side,rgba(0,0,0,.55),transparent)");
  const bil = d3("g3","",rot);
  // Skåp
  const sid = `background:#f4f7f9 url(${LOGOF}) no-repeat 50% 38%/58% auto;box-shadow:inset 0 -26px 0 -14px #e52f19,inset 0 -30px 0 -14px #f4f7f9`;
  lada(bil, -40,-97,0, 300,150,140, {fram:sid, bak:sid, topp:"background:#fbfdfe", botten:"background:#2a3540", vanster:false, hoger:vit});
  // Hytt
  lada(bil, 165,-85,0, 110,126,140, {fram:`background:linear-gradient(180deg,transparent 0 4%,#16222c 4% 46%,transparent 46%),linear-gradient(180deg,#ffffff,#e6ecf0)`,
    bak:false, topp:"background:#f8fbfd", botten:"background:#2a3540", vanster:false, hoger:glas});
  // Motorhuv och front
  lada(bil, 245,-52,0, 50,64,136, {alla:vit, hoger:"background:linear-gradient(180deg,#e8edf1 0 40%,#11171c 40% 62%,#e8edf1 62%)", topp:"background:#f6f9fb", vanster:false, botten:"background:#2a3540"});
  // Lampor
  d3("f2","width:10px;height:14px;left:-5px;top:-7px;background:#fff6d1;box-shadow:0 0 16px #ffe9a8;"+plats(271,-60,52,"rotateY(90deg)"),bil);
  d3("f2","width:10px;height:14px;left:-5px;top:-7px;background:#fff6d1;box-shadow:0 0 16px #ffe9a8;"+plats(271,-60,-52,"rotateY(90deg)"),bil);
  d3("f2","width:8px;height:30px;left:-4px;top:-15px;background:#c2261a;"+plats(-191,-80,62,"rotateY(-90deg)"),bil);
  d3("f2","width:8px;height:30px;left:-4px;top:-15px;background:#c2261a;"+plats(-191,-80,-62,"rotateY(-90deg)"),bil);
  // Bakdörrar (på -x). Lokal x = världens +z.
  const bd = d3("g3", plats(-191,-97,0,"rotateY(-90deg)"), bil);
  const bakL = d3("f2 bakd", "width:70px;height:150px;left:-70px;top:-75px;transform-origin:0 50%;background:linear-gradient(90deg,#e7edf1,#f6f9fb);box-shadow:inset -2px 0 0 #b9c4cc", bd);
  const bakR = d3("f2 bakd", "width:70px;height:150px;left:0;top:-75px;transform-origin:100% 50%;background:linear-gradient(90deg,#f6f9fb,#e7edf1);box-shadow:inset 2px 0 0 #b9c4cc", bd);
  // Lastutrymme innanför dörrarna
  d3("f2","width:136px;height:146px;left:-68px;top:-73px;background:linear-gradient(180deg,#3a4652,#1d252d);"+plats(-188,-97,0,"rotateY(-90deg)"),bil);
  [-40,0,40].forEach(z=>d3("f2","width:120px;height:18px;left:-60px;top:-9px;background:#566573;"+plats(-150,-60+z*0.4,z,"rotateY(-90deg)"),bil));
  // Förardörr (på -z, framkant mot +x). Lokal x = världens -x.
  const fd = d3("g3", plats(165,-85,-71,"rotateY(180deg)"), bil);
  const dorr = d3("f2 dorr", `width:110px;height:126px;left:-55px;top:-63px;transform-origin:0 50%;background:linear-gradient(180deg,transparent 0 5%,#1b2a35 5% 46%,transparent 46%),linear-gradient(180deg,#ffffff,#e6ecf0);box-shadow:inset 0 0 0 1px #c7d1d8`, fd);
  d3("f2", `width:26px;height:26px;left:62px;top:14px;background:#fff url(${QR}) center/cover;box-shadow:0 0 0 2px #fff`, dorr);
  // Inredning hytt (syns när dörren öppnas)
  d3("f2","width:104px;height:120px;left:-52px;top:-60px;background:linear-gradient(180deg,#2c3742,#141b21);"+plats(165,-85,-66,""),bil);
  d3("f2","width:40px;height:40px;left:-20px;top:-20px;border-radius:50%;border:6px solid #0b0f13;"+plats(190,-100,-40,"rotateY(90deg)"),bil);
  d3("f2","width:60px;height:24px;left:-30px;top:-12px;background:#0b141c;box-shadow:inset 0 0 0 2px #2c3e4f;"+plats(205,-108,-30,"rotateY(90deg)"),bil);
  // Hjul
  const H = {}; [["vf",175,-72],["hf",175,72],["hb",-110,72],["vb",-110,-72]].forEach(([id,x,z])=>{ H[id]=hjul(bil, x,-32,z,32);
    const r = d3("ring", `width:92px;height:92px;left:-46px;top:-46px;`+plats(x,-32,z+(z>0?16:-16)), bil); r.dataset.id=id; });
  // Fotopunkter
  const M = {}; [["fv",340,-250],["fh",340,250],["bh",-320,250],["bv",-320,-250]].forEach(([id,x,z])=>{ M[id]=nal(rot, x,0,z, KAMIKON, id); });
  M.qr = nal(rot, 170,-140,-75, "QR", "qr");
  return { bakL, bakR, dorr, ringar:[...bil.querySelectorAll(".ring")], M,
    satt(t){ bakL.style.transform = t.bak ? "rotateY(-115deg)" : ""; bakR.style.transform = t.bak ? "rotateY(115deg)" : "";
      dorr.style.transform = t.dorr ? "rotateY(-70deg)" : "";
      this.ringar.forEach(r=>{ const on = t.dack==="alla" || t.dack===r.dataset.id || (t.varn===r.dataset.id); r.classList.toggle("on", !!on); r.classList.toggle("varn", t.varn===r.dataset.id); });
      Object.entries(M).forEach(([id,m])=>{ m.classList.toggle("on", t.mark===id); m.style.display = (id==="qr" && !t.qr) ? "none" : ""; }); }
  };
}

/* ---------- Scen: kundens hus ---------- */
function byggHus(rot){
  const puts = "background:linear-gradient(180deg,#e9e4da,#d8d1c4)", putsSida="background:linear-gradient(180deg,#d9d2c4,#c3baa9)";
  const alg = ",radial-gradient(60% 40% at 30% 100%,rgba(70,110,60,.55),transparent 70%),radial-gradient(40% 30% at 80% 100%,rgba(40,60,40,.45),transparent 70%)";
  platta(rot, 0,0,0, 1800,1400, "background:radial-gradient(closest-side,#3b5a3a,#24402c 55%,#0e1d17 100%)");
  platta(rot, 0,-0.5,0, 1800,1400, "background:radial-gradient(circle at 20% 70%,rgba(140,150,80,.25) 0 60px,transparent 61px),radial-gradient(circle at 35% 80%,rgba(140,150,80,.2) 0 40px,transparent 41px),repeating-linear-gradient(35deg,transparent 0 6px,rgba(255,255,255,.025) 6px 7px)");
  // Uppfart, nytvättad
  platta(rot, 60,-1,215, 280,190, "background:repeating-linear-gradient(90deg,#8d8f8f 0 22px,#6f7273 22px 24px),#8d8f8f;background-blend-mode:multiply;box-shadow:inset 0 0 0 4px #5b5e60");
  platta(rot, 60,-1.4,215, 280,190, "background:repeating-linear-gradient(0deg,transparent 0 11px,rgba(40,40,40,.35) 11px 12px)");
  // Grannens uppfart med påväxt
  platta(rot, 420,-1,230, 230,170, "background:radial-gradient(40% 30% at 30% 40%,rgba(70,110,50,.8),transparent),radial-gradient(30% 30% at 70% 70%,rgba(220,220,200,.6),transparent),repeating-linear-gradient(90deg,#5d6560 0 22px,#454d48 22px 24px)");
  platta(rot, 420,-1.4,230, 230,170, "background:repeating-linear-gradient(0deg,transparent 0 11px,rgba(30,30,30,.4) 11px 12px)");
  // Altan
  lada(rot, -262,-8,0, 150,16,210, {topp:"background:repeating-linear-gradient(90deg,#8a7c6b 0 13px,#5e5447 13px 15px)", alla:"background:#4d443a", botten:false});
  platta(rot, -262,-16.5,-30, 150,120, "background:radial-gradient(50% 50% at 40% 50%,rgba(80,110,70,.55),transparent)");
  // Huskropp
  lada(rot, 0,-75,0, 300,150,200, {fram:"background:linear-gradient(180deg,rgba(255,255,255,0),rgba(255,255,255,0)),linear-gradient(180deg,#e9e4da,#d8d1c4)", bak:puts, hoger:putsSida, vanster:putsSida, topp:false, botten:false});
  // Alger nertill på fasaden
  d3("f2","width:300px;height:70px;left:-150px;top:-35px;background:radial-gradient(40% 70% at 25% 100%,rgba(60,100,55,.6),transparent 75%),radial-gradient(30% 60% at 70% 100%,rgba(40,70,45,.55),transparent 75%);"+plats(0,-35,100.5),rot);
  // Fönster och dörr
  [[-95,-90],[ -15,-90],[95,-90]].forEach(([x,y])=>{ d3("f2","width:48px;height:56px;left:-24px;top:-28px;background:linear-gradient(160deg,#5b7a8f,#1d2b36);box-shadow:inset 0 0 0 4px #f4f1ea,0 0 0 1px #b9b2a4;"+plats(x,y,101),rot); });
  d3("f2","width:40px;height:84px;left:-20px;top:-42px;background:#3a2c22;box-shadow:inset 0 0 0 4px #f4f1ea;"+plats(50,-42,101),rot);
  [[-60,-90],[60,-90]].forEach(([z])=>{ d3("f2","width:52px;height:56px;left:-26px;top:-28px;background:linear-gradient(160deg,#5b7a8f,#1d2b36);box-shadow:inset 0 0 0 4px #f4f1ea;"+plats(-151,-90,z,"rotateY(-90deg)"),rot); });
  // Tak
  const tak = "background:repeating-linear-gradient(0deg,#5a2f26 0 10px,#3c1f19 10px 12px),#5a2f26;";
  const mossa = "background-image:radial-gradient(30% 22% at 30% 40%,rgba(110,140,60,.85),transparent),radial-gradient(25% 20% at 70% 65%,rgba(110,140,60,.75),transparent),radial-gradient(20% 18% at 50% 85%,rgba(130,150,70,.7),transparent),repeating-linear-gradient(0deg,#5a2f26 0 10px,#3c1f19 10px 12px);";
  d3("f2", `width:340px;height:140px;left:-170px;top:-70px;${mossa};`+plats(0,-190,57,"rotateX(54deg)"), rot);
  d3("f2", `width:340px;height:140px;left:-170px;top:-70px;${tak};`+plats(0,-190,-57,"rotateX(126deg)"), rot);
  d3("f2","width:200px;height:80px;left:-100px;top:-40px;clip-path:polygon(50% 0,100% 100%,0 100%);"+putsSida+";"+plats(150.5,-190,0,"rotateY(90deg)"),rot);
  d3("f2","width:200px;height:80px;left:-100px;top:-40px;clip-path:polygon(50% 0,100% 100%,0 100%);"+putsSida+";"+plats(-150.5,-190,0,"rotateY(-90deg)"),rot);
  // Hängrännor med löv
  lada(rot, 0,-150,112, 340,10,12, {alla:"background:#9aa5ad", topp:"background:linear-gradient(90deg,#6b5a2e,#4f6a2e 40%,#6b5a2e 70%,#5c4a26)", botten:"background:#7d878f"});
  lada(rot, 0,-150,-112, 340,10,12, {alla:"background:#9aa5ad", topp:"background:#5d6a37", botten:"background:#7d878f"});
  lada(rot, 160,-75,112, 8,150,8, {alla:"background:#a7b1b8"});
  // Grannhuset
  lada(rot, 470,-65,-40, 200,130,180, {alla:"background:linear-gradient(180deg,#bfc6c9,#a3abaf)", topp:"background:#3c3f44", botten:false});
  // Kundens bil och buske för skala
  lada(rot, -40,-14,330, 60,28,60, {alla:"background:radial-gradient(circle at 40% 30%,#4f7a45,#2c4a2a)"});
  const P = {
    tak: nal(rot, 0,-250,40, "1", "tak"), ranna: nal(rot, 110,-165,118, "2", "ranna"), fasad: nal(rot, -60,-70,106, "3", "fasad"),
    sten: nal(rot, 60,-6,215, "4", "sten"), altan: nal(rot, -262,-22,0, "5", "altan"), gras: nal(rot, -120,-2,360, "6", "gras"), granne: nal(rot, 420,-6,230, "7", "granne")
  };
  return { satt(t){ Object.entries(P).forEach(([id,m])=>m.classList.toggle("on", t.mark===id)); } };
}

/* ---------- Innehåll ---------- */
const KAPITEL = {
  bil: { kicker:"Veckans sista arbetsdag", titel:"Bilkontrollen", bygg: byggBil, slut:"Klar, kör hem",
    steg: [
      { t:"Varje vecka, sista arbetsdagen", kam:[-16,-32,.95,30,-60,0], tel:{h:"Bilkontroll", s:"Skanna QR-koden i bilen", vy:"qr"},
        p:["Sista arbetsdagen i veckan gör du bilkontrollen innan du kör hem.", "Det finns en <b>QR-kod i alla bilar</b>. Skanna den med mobilen, så öppnas kontrollen för just den bilen.", "Kontrollen tar ungefär <b>tre minuter</b>: elva bilder, mätarställning och mönsterdjup på alla fyra däck."] },
      { t:"Skanna QR-koden", kam:[-8,168,1.9,150,-110,-70], qr:true, mark:"qr", tel:{h:"Bilkontroll · ABC 123", s:"Vecka 47", vy:"skanna", f:"Ditt namn"},
        p:["Öppna kameran och rikta den mot QR-koden. Kontrollen öppnas med bilens registreringsnummer ifyllt.", "Skriv ditt namn. Ser du att kontrollen redan är gjord den här veckan har en kollega hunnit före."] },
      { t:"1. Snett framifrån, vänster", kam:[-12,-135,1,30,-70,0], mark:"fv", blixt:true, tel:{h:"Utsida", s:"Bild 1 av 11", vy:"bild", n:1},
        p:["Ställ dig ungefär tre meter från bilens vänstra framhörn.", "Fronten och hela vänstra sidan ska synas i bilden."] },
      { t:"2. Snett framifrån, höger", kam:[-12,-45,1,30,-70,0], mark:"fh", blixt:true, tel:{h:"Utsida", s:"Bild 2 av 11", vy:"bild", n:2},
        p:["Gå till högra framhörnet.", "Fronten och hela högra sidan ska synas."] },
      { t:"3. Snett bakifrån, höger", kam:[-12,45,1,30,-70,0], mark:"bh", blixt:true, tel:{h:"Utsida", s:"Bild 3 av 11", vy:"bild", n:3},
        p:["Högra bakhörnet.", "Bakdelen och hela högra sidan ska synas."] },
      { t:"4. Snett bakifrån, vänster", kam:[-12,135,1,30,-70,0], mark:"bv", blixt:true, tel:{h:"Utsida", s:"Bild 4 av 11", vy:"bild", n:4},
        p:["Vänstra bakhörnet.", "Bakdelen och hela vänstra sidan ska synas."] },
      { t:"5. Förarplatsen", kam:[-12,-150,1.5,140,-80,-80], dorr:true, blixt:true, tel:{h:"Insida", s:"Bild 5 av 11", vy:"bild", n:5},
        p:["Öppna förardörren och fota in mot förarplatsen, ratten och golvet.", "Ligger det skräp eller utrustning löst: plocka undan först."] },
      { t:"6. Lastutrymmet", kam:[-10,90,1.45,-190,-95,0], bak:true, blixt:true, tel:{h:"Insida", s:"Bild 6 av 11", vy:"bild", n:6},
        p:["Öppna bakdörrarna och fota lastutrymmet.", "Utrustningen ska stå fastsatt och på sin plats."] },
      { t:"7. Mätarställningen", kam:[-6,160,2.3,190,-100,-50], dorr:true, matare:true, blixt:true, tel:{h:"Mätare", s:"Bild 7 av 11", vy:"bild", n:7, f:"Mätarställning: 84 512"},
        p:["Slå på tändningen och fota instrumentpanelen så att siffrorna syns skarpt.", "Skriv sedan in mätarställningen. Avviker siffran mycket från förra veckan flaggas det automatiskt."] },
      { t:"8 till 11. Däcken", kam:[-26,-120,1.2,30,-30,0], dack:"alla", monster:"4,2", tel:{h:"Däck", s:"Bild 8 till 11 av 11", vy:"bild", n:8, f:"Mönsterdjup: 4,2 mm"},
        p:["Fota nära och rakt mot slitbanan på varje däck, så att mönstret syns tydligt.", "Mät med mönsterdjupsmätaren och skriv in värdet för varje däck.", "Lagkrav: <b>1,6 mm</b> sommartid och <b>3,0 mm</b> vintertid (1 december till 31 mars). Är mönstret nära gränsen flaggas det som snart slitet."] },
      { t:"Ett däck mäter för lite", kam:[-14,-150,2,175,-32,-72], varn:"vf", monster:"2,8", tel:{h:"Däck", s:"Vänster fram", vy:"bild", n:8, f:"Mönsterdjup: 2,8 mm"},
        p:["Det är den 12 december. Vänster framdäck visar 2,8 mm. Vad gör du?"],
        fraga:{ alt:["Skriver 3,0 mm. Det är nästan samma sak.", "Skriver in 2,8 mm som det är och säger till närmast ansvarig direkt.", "Skriver 2,8 mm men säger inget, kontrollen sköter resten."], ratt:1,
          svar:"Skriv alltid in exakt värde. 2,8 mm är under lagkravet vintertid, så kontrollen flaggas och ansvarig får ett mejl. Säg ändå till närmast ansvarig direkt, så att bilen kan åtgärdas innan nästa körning." } },
      { t:"Varningslampa och anmärkning", kam:[-16,-32,.95,30,-60,0], tel:{h:"Sista steget", s:"Varningslampa", vy:"lampa", f:"Anmärkning: inget"},
        p:["Svara om någon varningslampa lyser.", "Skriv en anmärkning om något behöver åtgärdas, till exempel en skada, en lampa som inte fungerar eller utrustning som saknas."] },
      { t:"Skicka", kam:[-20,-28,.85,30,-60,0], tel:{h:"Bilkontroll · ABC 123", s:"Vecka 47", vy:"klar"},
        p:["Tryck på Skicka. Bilderna sparas på bilen och veckan.", "Är något utanför gränserna, till exempel slitna däck eller en varningslampa, går det direkt till ansvarig.", "Saknas en kontroll går det ut en påminnelse. Gör den sista arbetsdagen, så slipper du den."] }
    ] },
  hus: { kicker:"14:10 · Svedala · Merförsäljning", titel:"Se hela huset", bygg: byggHus, slut:"Tillbaka till dagen",
    steg: [
      { t:"Gå runt huset innan du åker", kam:[-22,-32,.82,40,-80,60],
        p:["Kunden är som mest positiv när jobbet just är klart.", "Gå runt huset och titta efter det kunden kan behöva härnäst. Du säljer inte, du berättar vad du ser.", "Det du säljer ger provision."] },
      { t:"1. Taket", kam:[-30,-22,1.45,0,-200,40], mark:"tak", kort:[["Det här ser du","Grön påväxt eller mossa på pannorna."],["Så säger du","Takbehandling tar bort påväxten över tid. Resultatet syns efter två till tre månader. Vill ni ha det snabbare gör vi taktvätt, och då kan vi också måla och impregnera."]] },
      { t:"2. Hängrännorna", kam:[-10,-24,2.1,90,-150,110], mark:"ranna", kort:[["Det här ser du","Löv, mossa eller gräs i rännan."],["Så säger du","Vi rensar rännorna från marken, och ni får bilder på resultatet."]] },
      { t:"3. Fasaden", kam:[-6,16,1.6,-40,-70,100], mark:"fasad", kort:[["Det här ser du","Gröna eller mörka stråk på fasaden."],["Så säger du","Vi behandlar fasaden mot påväxt. Det verkar över tid, och resultatet börjar synas efter två till tre månader."]] },
      { t:"4. Stenläggningen du tvättat", kam:[-38,-16,1.45,60,0,210], mark:"sten", kort:[["Det här ser du","Ytan du just gjort klar."],["Så säger du","Med årligt underhåll håller ytan sig fin, och då ger vi upp till 15 års garanti mot stenpest."],["Tänk på","Har kunden redan årligt underhåll säljer du inte in det igen."]] },
      { t:"5. Altanen", kam:[-28,72,1.6,-262,-20,0], mark:"altan", kort:[["Det här ser du","Grå eller grön trall, hala partier."],["Så säger du","Altantvätt med impregnering tar bort de hala algerna och ger träet färgen tillbaka."],["Tänk på","Lova ingen garanti. Altaner har ingen."]] },
      { t:"6. Gräsmattan", kam:[-34,-40,1.15,-80,0,300], mark:"gras", kort:[["Det här ser du","Mossa och glesa partier."],["Så säger du","Fråga om kunden vill ha hjälp med gräsmattan. Vi erbjuder gräsvård."]] },
      { t:"7. Grannen", kam:[-24,-48,1.2,330,-40,170], mark:"granne", kort:[["Det här ser du","Grannens uppfart har samma påväxt som kundens hade."],["Så gör du","Tvätta aldrig in på grannens yta. Hälsa, berätta vad du gör om grannen frågar, och lämna reklam hos de närmaste grannarna."]] },
      { t:"Så gör du merförsäljning", kam:[-22,-30,.82,40,-80,60],
        p:["<b>Flyern</b> visar priserna och rabatten vid merförsäljning. Hitta inte på egna priser.", "Lova inget du inte är säker på, varken pris, datum eller garanti.", "Notera intresset i Diroto och ring närmast ansvarig. Kontoret skickar offerten.", "Det du säljer ger provision."] }
    ] }
};

/* ---------- Motor ---------- */
let kap = null;
function kapitelSmal(){ return window.matchMedia("(max-width:760px)").matches || laget==="tel" && $("app").getBoundingClientRect().width < 900; }
function visaKapitel(id, klart){
  const k = KAPITEL[id]; const rot = $("kap-varld"); rot.innerHTML = "";
  kap = { id, k, i:0, klart, scen: k.bygg(rot), rot, svarat:{} };
  $("kap-kicker").textContent = k.kicker; $("kap-titel").textContent = k.titel;
  $("kap-prog").innerHTML = k.steg.map(()=>"<i></i>").join("");
  $("kapitel").classList.toggle("smal", kapitelSmal());
  $("mobil").classList.toggle("hidden", id!=="bil");
  visa("kapitel"); kapSteg(0, true);
}
function kamera(c, s){ const [rx,ry,sk,fx,fy,fz] = c; const f = $("kapitel").classList.contains("smal") ? .62 : 1;
  $("kap-kam").style.transform = `scale(${(sk*f).toFixed(3)}) rotateX(${rx}deg) rotateY(${ry}deg) translate3d(${-fx}px,${-fy}px,${-fz}px)`;
  kap.rot.querySelectorAll(".mark").forEach(m=>{ m.style.transform = `translate3d(${m.dataset.x}px,${m.dataset.y}px,${m.dataset.z}px) rotateY(${-ry}deg) rotateX(${-rx}deg) scale(${(1/Math.max(.7,sk*f)).toFixed(3)})`; });
}
function kapSteg(i, forsta){
  const k = kap.k; i = Math.max(0, Math.min(k.steg.length-1, i)); kap.i = i; const s = k.steg[i];
  kamera(s.kam);
  kap.scen.satt({ bak:s.bak, dorr:s.dorr, dack:s.dack, varn:s.varn, mark:s.mark, qr:s.qr || i<2 });
  $("kap-prog").querySelectorAll("i").forEach((e,j)=>{ e.className = j<i ? "klar" : j===i ? "on" : ""; });
  $("kap-steg").textContent = `${k.titel} · ${i+1} av ${k.steg.length}`;
  $("kap-rubrik").textContent = s.t;
  const ul = $("kap-text"); ul.innerHTML = (s.p||[]).map(t=>`<li>${t}</li>`).join("");
  $("kap-kort").innerHTML = (s.kort||[]).map(([a,b])=>`<div><small>${a}</small>${b}</div>`).join("");
  const fr = $("kap-fraga"); fr.innerHTML = "";
  if(s.fraga){ const sv = d3("kap-svar", "", null, s.fraga.svar);
    s.fraga.alt.forEach((t,j)=>{ const b = document.createElement("button"); b.type="button"; b.innerHTML = `<b>${"ABC"[j]}</b><span>${t}</span>`;
      b.onclick = () => { fr.querySelectorAll("button").forEach((x,n)=>{ x.classList.toggle("r", n===s.fraga.ratt); x.classList.toggle("f", n===j && j!==s.fraga.ratt); }); sv.classList.add("on"); kap.svarat[i]=true; };
      fr.appendChild(b); });
    fr.appendChild(sv); }
  // Instrument
  $("inst-matare").classList.toggle("on", !!s.matare);
  const mo = $("inst-monster"); mo.classList.toggle("on", !!s.monster);
  if(s.monster){ $("mm-varde").textContent = s.monster; const lag = s.varn ? "Gräns vintertid: 3,0 mm" : "Gräns: 1,6 mm sommar, 3,0 mm vinter"; $("mm-grans").textContent = lag; $("mm-varde").style.color = s.varn ? "var(--red2)" : "#fff"; }
  // Telefonen
  if(s.tel) ritaMobil(s.tel, i);
  if(s.blixt && !forsta && !RM){ const b=$("kap-blixt"); setTimeout(()=>{ b.classList.remove("go"); void b.offsetWidth; b.classList.add("go"); }, 1300); }
  $("kap-bak").disabled = i===0; $("kap-bak").style.opacity = i===0 ? .4 : 1;
  $("kap-fram").textContent = i===k.steg.length-1 ? k.slut : "Nästa";
  $("kap-in").scrollTop = 0;
}
function ritaMobil(t, i){
  const n = KAPITEL.bil.steg.length; const pr = Math.round(i/(n-1)*100);
  let vy = "";
  if(t.vy==="qr") vy = `<div class="vy"><img src="${QR}" alt=""><div class="linje"></div></div>`;
  else if(t.vy==="skanna") vy = `<div class="vy"><img src="${QR}" alt=""><div class="linje"></div></div><div class="fl">${t.f}</div>`;
  else if(t.vy==="bild") vy = `<div class="vy">Kameran<br>${t.n ? "bild "+t.n : ""}</div>${t.f?`<div class="fl">${t.f}</div>`:""}<div class="kn">Ta bild</div>`;
  else if(t.vy==="lampa") vy = `<h4>Lyser någon varningslampa?</h4><div class="tg"><span>Ja</span><span class="on">Nej</span></div><div class="fl">${t.f}</div><div class="kn">Skicka</div>`;
  else if(t.vy==="klar") vy = `<div class="vy" style="background:#1f8a4c;color:#fff;font-size:13px">Skickad<br>11 bilder · 4 däck</div><div class="kn ok">Klar</div>`;
  $("skarm").innerHTML = `<div class="hd"><b>${t.h}</b><span>${t.s}</span></div><div class="pr"><i style="width:${pr}%"></i></div><div class="bd">${vy}</div>`;
}
function kapFram(){ if(!kap) return; if(kap.i >= kap.k.steg.length-1){ const k = kap.klart; kap = null; k ? k() : visa("start"); return; } kapSteg(kap.i+1); }
function kapBak(){ if(kap) kapSteg(kap.i-1); }
$("kap-fram").onclick = kapFram; $("kap-bak").onclick = kapBak;
$("kap-stang").onclick = () => { if(!kap) return; const k = kap.klart; kap = null; k ? k() : visa("start"); };
window.addEventListener("resize", ()=>{ if(kap && $("kapitel").classList.contains("on")){ $("kapitel").classList.toggle("smal", kapitelSmal()); kamera(kap.k.steg[kap.i].kam); } });

/* ---------- Före och efter ---------- */
function foreEfter(box, id){
  const p = FE[id]; if(!p) return;
  box.innerHTML = `<div class="fe-rubrik"><span>${p.t}</span><span>${p.svep ? "Dra i bilden" : "Tryck för att växla"}</span></div>
    <div class="fe${p.svep?"":" vaxla"}"><img class="f0" alt="Före" src="${p.f}"><img class="e" alt="Efter" src="${p.e}">
    <div class="delare"></div><div class="grepp">⇆</div><span class="etk fo">Före</span><span class="etk ef">Efter</span></div>`;
  const fe = box.querySelector(".fe");
  if(p.svep){
    let drar = false, auto = true, t0 = performance.now();
    const satt = x => fe.style.setProperty("--x", (Math.max(0,Math.min(1,x))*100).toFixed(1)+"%");
    const pos = e => { const r = fe.getBoundingClientRect(); return (e.clientX - r.left)/r.width; };
    fe.addEventListener("pointerdown", e => { drar = true; auto = false; fe.setPointerCapture(e.pointerId); satt(pos(e)); });
    fe.addEventListener("pointermove", e => { if(drar) satt(pos(e)); else if(e.pointerType==="mouse"){ auto=false; satt(pos(e)); } });
    fe.addEventListener("pointerup", () => drar = false);
    const loop = t => { if(!fe.isConnected) return; if(auto && !RM){ satt(.5 + .38*Math.sin((t-t0)/1300)); } requestAnimationFrame(loop); };
    satt(.5); requestAnimationFrame(loop);
  } else {
    let tid = setInterval(()=>{ if(!fe.isConnected){ clearInterval(tid); return; } fe.classList.toggle("visa-e"); }, 2200);
    fe.addEventListener("click", () => { clearInterval(tid); fe.classList.toggle("visa-e"); });
    setTimeout(()=>fe.classList.add("visa-e"), 500);
  }
}
function galleri(){ galleriIn("gal-stor","gal-val"); }
function galleriIn(a, b){
  const ids = Object.keys(FE); const stor = $(a), val = $(b); val.innerHTML = "";
  const valj = id => { foreEfter(stor, id); val.querySelectorAll("button").forEach(b=>b.classList.toggle("on", b.dataset.id===id)); };
  ids.forEach(id => { const b = document.createElement("button"); b.type="button"; b.dataset.id=id; b.innerHTML = `<img alt="" src="${FE[id].e}"><span>${FE[id].t}</span>`; b.onclick = () => valj(id); val.appendChild(b); });
  valj(ids.find(i=>FE[i].svep) || ids[0]);
}
