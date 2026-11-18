/* ---------- Kapitel i 3D (three.js r128, inbäddad) ---------- */
const LOGOF = "__LOGOF__";
const HUSFILM = "__HUSFILM_DATA__";
const KAPFOTO = __KAPFOTO__;
const BILINFILM = "__BILINFILM__";
const T3 = window.THREE;

function d3(cls, css, foralder, html){ const e=document.createElement("div"); if(cls) e.className=cls; if(css) e.style.cssText=css; if(html!=null) e.innerHTML=html; foralder && foralder.appendChild(e); return e; }

/* Texturer ritade i canvas, inga externa filer. */
function duk(w, h, rita){ const c=document.createElement("canvas"); c.width=w; c.height=h; rita(c.getContext("2d"), w, h); const t=new T3.CanvasTexture(c); t.encoding=T3.sRGBEncoding; t.anisotropy=8; return t; }
function brus(x, w, h, n, f){ for(let i=0;i<n;i++){ f(x, Math.random()*w, Math.random()*h, i); } }
function falskQR(){
  const c=document.createElement("canvas"), N=25, s=8; c.width=c.height=N*s+16; const x=c.getContext("2d");
  x.fillStyle="#fff"; x.fillRect(0,0,c.width,c.height); x.fillStyle="#0f263a";
  let fro=7; const rnd=()=>{ fro=(fro*16807)%2147483647; return fro/2147483647; };
  for(let i=0;i<N;i++) for(let j=0;j<N;j++){ if(rnd()>.52) x.fillRect(8+i*s,8+j*s,s,s); }
  const horn=(a,b)=>{ x.fillStyle="#fff"; x.fillRect(8+a*s-s,8+b*s-s,9*s,9*s); x.fillStyle="#0f263a"; x.fillRect(8+a*s,8+b*s,7*s,7*s); x.fillStyle="#fff"; x.fillRect(8+a*s+s,8+b*s+s,5*s,5*s); x.fillStyle="#0f263a"; x.fillRect(8+a*s+2*s,8+b*s+2*s,3*s,3*s); };
  horn(0,0); horn(N-7,0); horn(0,N-7);
  return c;
}
const QRC = falskQR(); const QR = QRC.toDataURL();
const KAMIKON = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M4 8h3l2-3h6l2 3h3v11H4z"/><circle cx="12" cy="13" r="3.5"/></svg>`;
let LOGOBILD = null; { const im = new Image(); im.src = LOGOF; LOGOBILD = im; }

function mat(o){ return new T3.MeshStandardMaterial(o); }
function nat(g, m, x, y, z, skugga){ const me = new T3.Mesh(g, m); me.position.set(x||0, y||0, z||0); if(skugga!==false){ me.castShadow = true; me.receiveShadow = true; } return me; }

/* ---------- Scen: servicebilen ---------- */
function byggBil(c){
  const S = c.scene;
  // Mark: asfalt med parkeringslinjer
  const asfalt = duk(1024,1024,(x,w,h)=>{ x.fillStyle="#2b3540"; x.fillRect(0,0,w,h);
    brus(x,w,h,26000,(x,a,b)=>{ const v=30+Math.random()*40; x.fillStyle=`rgba(${v},${v+8},${v+16},.5)`; x.fillRect(a,b,2,2); });
    x.strokeStyle="rgba(235,240,243,.85)"; x.lineWidth=7; [[250,431,780,431],[250,593,780,593]].forEach(([a,b,c2,d])=>{ x.beginPath(); x.moveTo(a,b); x.lineTo(c2,d); x.stroke(); }); });
  const mark = nat(new T3.PlaneGeometry(2400,2400), mat({map:asfalt, roughness:.95}), 0,0,0); mark.rotation.x=-Math.PI/2; mark.castShadow=false; asfalt.repeat.set(1,1); S.add(mark);
  // Linjerna hamnar vid z = ±(1024-260)/1024*... skala om så att bilen står mellan dem
  

  const bil = new T3.Group(); S.add(bil);
  const lack = new T3.MeshPhysicalMaterial({color:0xf4f7f9, roughness:.32, metalness:.05, clearcoat:.8, clearcoatRoughness:.25});
  const glas = new T3.MeshPhysicalMaterial({color:0x0d1820, roughness:.08, metalness:.4, clearcoat:1});
  const svart = mat({color:0x1a2026, roughness:.7});
  // Profil från sidan (x längd, y höjd), extruderad i bredd
  const p = new T3.Shape();
  p.moveTo(-190,30); p.lineTo(-150,30); p.absarc(-110,34,40,Math.PI,0,true); p.lineTo(135,30); p.absarc(175,34,40,Math.PI,0,true);
  p.lineTo(266,30); p.quadraticCurveTo(279,30,279,44); p.lineTo(277,80); p.quadraticCurveTo(275,92,260,94); p.lineTo(222,100);
  p.lineTo(172,164); p.quadraticCurveTo(164,174,148,175); p.lineTo(-176,175); p.quadraticCurveTo(-190,175,-190,161); p.lineTo(-190,30);
  const kg = new T3.ExtrudeGeometry(p, {depth:136, bevelEnabled:true, bevelThickness:5, bevelSize:5, bevelSegments:4, curveSegments:24}); kg.translate(0,0,-68);
  const kaross = nat(kg, lack); bil.add(kaross);
  // Rutor
  const sr = new T3.Shape(); sr.moveTo(146,108); sr.lineTo(212,108); sr.lineTo(172,160); sr.quadraticCurveTo(166,166,152,166); sr.lineTo(146,166); sr.lineTo(146,108);
  const sg = new T3.ExtrudeGeometry(sr,{depth:148, bevelEnabled:false}); sg.translate(0,0,-74); bil.add(nat(sg, glas));
  const vr = new T3.Shape(); vr.moveTo(224,103); vr.lineTo(176,165); vr.lineTo(170,162); vr.lineTo(218,101); vr.lineTo(224,103);
  const vg = new T3.ExtrudeGeometry(vr,{depth:124, bevelEnabled:false}); vg.translate(0,0,-62); bil.add(nat(vg, glas));
  // Front: grill, lampor, stötfångare
  bil.add(nat(new T3.BoxGeometry(6,22,110), svart, 279,58,0));
  bil.add(nat(new T3.BoxGeometry(12,14,146), svart, 274,34,0));
  [-50,50].forEach(z=>{ const l = nat(new T3.BoxGeometry(5,12,26), mat({color:0xfff3c8, emissive:0xffe4a0, emissiveIntensity:.9}), 278,80,z); bil.add(l); });
  [-62,62].forEach(z=>{ bil.add(nat(new T3.BoxGeometry(4,34,9), mat({color:0xb3221a, emissive:0x8a1a12, emissiveIntensity:.6}), -193,118,z)); });
  bil.add(nat(new T3.BoxGeometry(10,12,148), svart, -192,34,0));
  // Speglar
  [-1,1].forEach(s=>{ bil.add(nat(new T3.BoxGeometry(10,22,14), svart, 214,128,s*82)); });
  // Dekor på sidorna
  const dekor = (spegel) => duk(1280,512,(x,w,h)=>{ x.clearRect(0,0,w,h);
    x.fillStyle="#e52f19"; x.fillRect(0,h-58,w,30); x.fillStyle="rgba(15,38,58,.9)"; x.fillRect(0,h-28,w,10);
    if(LOGOBILD && LOGOBILD.complete){ const lw=w*.62, lh=lw*LOGOBILD.height/LOGOBILD.width; x.drawImage(LOGOBILD,(w-lw)/2,h*.3-lh/2,lw,lh); }
    x.fillStyle="#0f263a"; x.font="600 46px OS, sans-serif"; x.textAlign="center"; x.fillText("nanostone.se", w/2, h*.62); });
  [1,-1].forEach(s=>{ const t = dekor(); const m = new T3.MeshBasicMaterial({map:t, transparent:true}); const pl = new T3.Mesh(new T3.PlaneGeometry(330,132), m);
    pl.position.set(-24,102,s*73.6); if(s<0) pl.rotation.y=Math.PI; bil.add(pl); c.textur.push(t); });
  // Hjul
  const hjulG = new T3.Group();
  [["vf",175,-58],["hf",175,58],["hb",-110,58],["vb",-110,-58]].forEach(([id,x,z])=>{
    const g = new T3.Group(); g.position.set(x,34,z);
    const dack = nat(new T3.CylinderGeometry(32,32,24,40), mat({color:0x15191d, roughness:.85})); dack.rotation.x=Math.PI/2; g.add(dack);
    const falg = nat(new T3.CylinderGeometry(19,19,25,32), mat({color:0xc4ccd3, metalness:.85, roughness:.3})); falg.rotation.x=Math.PI/2; g.add(falg);
    const nav = nat(new T3.CylinderGeometry(7,7,26.5,16), mat({color:0x5a6570, metalness:.6, roughness:.4})); nav.rotation.x=Math.PI/2; g.add(nav);
    const ring = new T3.Mesh(new T3.TorusGeometry(44,2.6,12,64), new T3.MeshBasicMaterial({color:0xe52f19, transparent:true, opacity:.95}));
    ring.position.z = z>0 ? 16 : -16; ring.visible=false; ring.userData.id=id; g.add(ring); g.userData.ring=ring;
    hjulG.add(g); });
  bil.add(hjulG);
  // Förardörr på -z med QR-kod. Gångjärn i framkant (x=214).
  const dorrPivot = new T3.Group(); dorrPivot.position.set(214,0,-74); bil.add(dorrPivot);
  const dorrForm = new T3.Shape(); dorrForm.moveTo(0,34); dorrForm.lineTo(0,100); dorrForm.lineTo(-48,164); dorrForm.lineTo(-74,164); dorrForm.lineTo(-74,34); dorrForm.lineTo(0,34);
  const dorr = nat(new T3.ExtrudeGeometry(dorrForm,{depth:4, bevelEnabled:true, bevelSize:1.5, bevelThickness:1.5, bevelSegments:2}), lack); dorr.position.z=-4.5; dorrPivot.add(dorr);
  const dorrGlas = new T3.Shape(); dorrGlas.moveTo(-4,108); dorrGlas.lineTo(-44,160); dorrGlas.lineTo(-70,160); dorrGlas.lineTo(-70,108); dorrGlas.lineTo(-4,108);
  const dg = nat(new T3.ExtrudeGeometry(dorrGlas,{depth:1, bevelEnabled:false}), glas); dg.position.z=-7.2; dorrPivot.add(dg);
  const qrMat = new T3.MeshBasicMaterial({map:new T3.CanvasTexture(QRC)}); const qr = new T3.Mesh(new T3.PlaneGeometry(18,18), qrMat); qr.position.set(-58,118,-7.6); qr.rotation.y=Math.PI; dorrPivot.add(qr);
  const inne = duk(576,1024,(x,w,h)=>{ // förarplatsen sedd genom dörren: fronten åt vänster
    const g=x.createLinearGradient(0,0,0,h); g.addColorStop(0,"#1b232b"); g.addColorStop(1,"#0c1116"); x.fillStyle=g; x.fillRect(0,0,w,h);
    x.fillStyle="#2a343e"; x.fillRect(0,h*.36,w*.5,h*.2); x.fillStyle="#333f4a"; x.fillRect(0,h*.36,w*.5,h*.03);         // instrumentbräda
    x.fillStyle="#05080b"; x.beginPath(); x.ellipse(w*.2,h*.42,w*.17,h*.05,0,0,7); x.fill();                              // mätarhus
    x.strokeStyle="#7fd0ff"; x.lineWidth=5; x.beginPath(); x.arc(w*.2,h*.435,w*.11,Math.PI*1.1,Math.PI*1.9); x.stroke();
    x.strokeStyle="#e52f19"; x.lineWidth=6; x.beginPath(); x.moveTo(w*.2,h*.435); x.lineTo(w*.27,h*.395); x.stroke();
    x.fillStyle="#eaf6ff"; x.font="700 30px OS, sans-serif"; x.textAlign="center"; x.fillText("148 230", w*.2, h*.462);
    x.strokeStyle="#0a0d10"; x.lineWidth=26; x.beginPath(); x.ellipse(w*.36,h*.53,w*.1,h*.105,-.25,0,7); x.stroke();     // ratt
    x.strokeStyle="#3b4753"; x.lineWidth=6; x.beginPath(); x.ellipse(w*.36,h*.53,w*.1,h*.105,-.25,0,7); x.stroke();
    x.fillStyle="#0a0d10"; x.fillRect(w*.32,h*.52,w*.09,h*.02);
    x.fillStyle="#3a4652"; x.beginPath(); x.roundRect(w*.56,h*.2,w*.36,h*.46,40); x.fill();                                  // ryggstöd
    x.fillStyle="#465563"; x.beginPath(); x.roundRect(w*.6,h*.11,w*.26,h*.1,26); x.fill();                                   // nackstöd
    x.fillStyle="#3a4652"; x.beginPath(); x.roundRect(w*.4,h*.64,w*.54,h*.11,30); x.fill();                                  // sits
    x.fillStyle="#e52f19"; x.fillRect(w*.56,h*.3,w*.36,h*.012);
    x.fillStyle="#11161b"; x.fillRect(0,h*.82,w,h*.18); x.fillStyle="#1d252d"; x.fillRect(0,h*.82,w,h*.012); });           // golv
  const hytt = nat(new T3.BoxGeometry(72,128,2), [svart,svart,svart,svart,svart,new T3.MeshBasicMaterial({map:inne})], 177,100,-73.3); bil.add(hytt); hytt.visible=false;
  // Bakdörrar på -x med lastutrymme bakom
  const bakInne = nat(new T3.BoxGeometry(1,140,134), mat({color:0x2a333d, roughness:.9}), -195.6,102,0); bil.add(bakInne); bakInne.visible=false;
  const hylla = mat({color:0x6c7a87, metalness:.5, roughness:.5});
  [70,110,150].forEach(y=>{ const h = nat(new T3.BoxGeometry(3,4,120), hylla, -196.4,y,0); h.visible=false; bil.add(h); h.userData.inne=true; });
  const bak = []; [[-1,-68],[1,68]].forEach(([s,z])=>{ const pv = new T3.Group(); pv.position.set(-198.5,0,z); bil.add(pv);
    const d = nat(new T3.BoxGeometry(3,140,68), lack, 0,102,-s*34); pv.add(d); pv.userData.s=s; bak.push(pv); });
  // Skugga under bilen (mjuk)
  const skugga = duk(256,256,(x,w,h)=>{ const g=x.createRadialGradient(w/2,h/2,10,w/2,h/2,w/2); g.addColorStop(0,"rgba(0,0,0,.55)"); g.addColorStop(1,"rgba(0,0,0,0)"); x.fillStyle=g; x.fillRect(0,0,w,h); });
  const sk = new T3.Mesh(new T3.PlaneGeometry(560,250), new T3.MeshBasicMaterial({map:skugga, transparent:true, depthWrite:false})); sk.rotation.x=-Math.PI/2; sk.position.set(40,.6,0); S.add(sk);

  // Fotopunkter och QR-markör
  const M = {}; [["fv",420,-300],["fh",420,300],["bh",-380,300],["bv",-380,-300]].forEach(([id,x,z])=>{ M[id]=c.nal(x,0,z, KAMIKON, id); });
  M.qr = c.nal(156,128,-82, "QR", "qr");
  const mal = { dorr:0, bak:0 }, nu = { dorr:0, bak:0 }; const in0 = performance.now();
  return {
    satt(t){ mal.dorr = t.dorr ? 1 : 0; mal.bak = t.bak ? 1 : 0;
      hjulG.children.forEach(g=>{ const r=g.userData.ring; const on = t.dack==="alla" || t.dack===r.userData.id || t.varn===r.userData.id; r.visible=!!on; r.material.color.set(t.varn===r.userData.id ? 0xf0b43c : 0xe52f19); });
      Object.entries(M).forEach(([id,m])=>{ m.classList.toggle("on", t.mark===id); m.style.display = (id==="qr" && !t.qr) ? "none" : ""; }); },
    uppdatera(ms){
      // Bilen rullar in på parkeringen när kapitlet öppnas.
      const q = RM ? 1 : Math.min(1, (performance.now()-in0)/2600), ut = 1500*Math.pow(1-q,3);
      bil.position.x = -ut; sk.position.x = 40 - ut; hjulG.children.forEach(g=>{ g.rotation.z = ut/32; });
      const k = RM ? 1 : .07; nu.dorr += (mal.dorr-nu.dorr)*k; nu.bak += (mal.bak-nu.bak)*k;
      dorrPivot.rotation.y = -nu.dorr * 1.5; dorrPivot.visible = nu.dorr < .55; hytt.visible = nu.dorr > .02;
      bak.forEach(pv=>{ pv.rotation.y = pv.userData.s * nu.bak * 1.9; }); bakInne.visible = nu.bak > .02; bil.children.forEach(o=>{ if(o.userData.inne) o.visible = nu.bak > .02; });
      hjulG.children.forEach(g=>{ const r=g.userData.ring; if(r.visible){ const s = 1 + .06*Math.sin(ms/220); r.scale.set(s,s,1); } });
    }
  };
}

/* ---------- Motor ---------- */
let kap = null, R3 = null;
function trea(){
  if(R3) return R3;
  const duk3 = $("kap-duk");
  const r = new T3.WebGLRenderer({canvas:duk3, antialias:true, alpha:true, powerPreference:"high-performance"});
  r.setPixelRatio(Math.min(2, window.devicePixelRatio||1)); r.shadowMap.enabled = true; r.shadowMap.type = T3.PCFSoftShadowMap;
  r.outputEncoding = T3.sRGBEncoding; r.toneMapping = T3.ACESFilmicToneMapping; r.toneMappingExposure = 1.05;
  const cam = new T3.PerspectiveCamera(32, 1, 5, 9000);
  R3 = { r, cam, mal:null, nu:null, t0:0 };
  const loop = ms => { requestAnimationFrame(loop); const kp = $("kapitel"); if(!kap || kap.k.film || !kp.classList.contains("on") || kp.classList.contains("intro") || !R3.mal) return; rendera(ms); };
  requestAnimationFrame(loop);
  return R3;
}
function nyScen(){
  const scene = new T3.Scene(); scene.fog = new T3.Fog(0x112c43, 1400, 3200);
  scene.add(new T3.HemisphereLight(0xdfeaf2, 0x24323c, .75));
  const sol = new T3.DirectionalLight(0xfff4e6, 1.35); sol.position.set(500,900,450); sol.castShadow = true;
  sol.shadow.mapSize.set(2048,2048); Object.assign(sol.shadow.camera, {left:-700,right:700,top:700,bottom:-700,near:100,far:2600}); sol.shadow.bias=-0.0004; sol.shadow.radius=4;
  scene.add(sol); const fyll = new T3.DirectionalLight(0x9fc2e0, .35); fyll.position.set(-600,300,-500); scene.add(fyll);
  return scene;
}
function storlek(){
  const { r, cam } = R3; const box = $("kap-scen").getBoundingClientRect(); const w = Math.max(1, box.width), h = Math.max(1, box.height);
  r.setSize(w, h, false); cam.aspect = w/h;
  const smal = $("kapitel").classList.contains("smal");
  if(smal) cam.setViewOffset(w, h, 0, h*.22, w, h); else cam.setViewOffset(w, h, w*.11, 0, w, h);
  cam.updateProjectionMatrix();
}
function kamMal(s){ const smal = $("kapitel").classList.contains("smal"); const c = s.cam;
  const t = new T3.Vector3(...c.t), p = new T3.Vector3(...c.p); if(smal){ p.sub(t).multiplyScalar(1.3).add(t); } return { p, t }; }
function kamTill(m, direkt){
  const n = R3.nu || { p:m.p.clone(), t:m.t.clone() };
  R3.fran = { p:n.p.clone(), t:n.t.clone() }; R3.mal = m; R3.t0 = performance.now(); R3.T = (direkt||RM) ? 1 : 1500;
  if(!R3.nu) R3.nu = { p:m.p.clone(), t:m.t.clone() };
}
const mjuk = x => x<.5 ? 4*x*x*x : 1-Math.pow(-2*x+2,3)/2;
function rendera(ms){
  const { r, cam } = R3; const f = Math.min(1, (performance.now()-R3.t0)/R3.T), e = mjuk(f);
  // båge: lyft och dra ut kameran lite mitt i förflyttningen så att den inte går genom bilen
  const p = R3.fran.p.clone().lerp(R3.mal.p, e), t = R3.fran.t.clone().lerp(R3.mal.t, e);
  const bage = Math.sin(Math.PI*e) * Math.min(260, R3.fran.p.distanceTo(R3.mal.p)*.25);
  const ut = p.clone().sub(t).setY(0); if(ut.lengthSq()>1){ ut.normalize().multiplyScalar(bage); p.add(ut); } p.y += bage*.5;
  R3.nu.p.copy(p); R3.nu.t.copy(t);
  const sv = RM ? 0 : Math.sin(ms/3800)*6;
  cam.position.set(p.x + sv, p.y + Math.sin(ms/5200)*3, p.z - sv*.6); cam.lookAt(t);
  kap.scen.uppdatera(ms); r.render(kap.scene, cam);
  const box = $("kap-scen").getBoundingClientRect(); const v = new T3.Vector3();
  kap.nalar.forEach(el=>{ v.set(+el.dataset.x, +el.dataset.y, +el.dataset.z).project(cam);
    el.style.transform = `translate(${((v.x+1)/2*box.width).toFixed(1)}px,${((1-v.y)/2*box.height).toFixed(1)}px)`; el.style.visibility = v.z < 1 ? "" : "hidden"; });
}
function kapitelSmal(){ return window.matchMedia("(max-width:760px)").matches || (typeof laget!=="undefined" && laget==="tel" && window.innerWidth < 900); }
function visaKapitel(id, klart){
  const k = KAPITEL[id];
  $("kap-pins").innerHTML = "";
  if(kap && kap.scene){ kap.scene.traverse(o=>{ if(o.geometry) o.geometry.dispose(); }); }
  kap = { id, k, i:0, klart, scene:null, nalar:[], svarat:{} };
  const film = !!k.film, foto = id==="bil"; $("kap-duk").classList.add("hidden"); $("kap-bilder").classList.toggle("hidden", !foto); $("kap-bilder").querySelectorAll("img").forEach(im=>{ im.className=""; im.removeAttribute("src"); }); $("kap-film").classList.toggle("hidden", !film); $("kap-filmtag").classList.toggle("hidden", !film);
  if(foto){ /* riktiga bilder, se kapSteg */ }
  else if(!film){
    trea(); const scene = nyScen();
    const c = { scene, textur:[], nal(x,y,z,inne,nid){ const m = d3("mark", "", $("kap-pins")); m.dataset.id=nid; m.innerHTML=`<div class="pin">${inne}</div>`; m.dataset.x=x; m.dataset.y=y; m.dataset.z=z; kap.nalar.push(m); return m; } };
    kap.scene = scene; kap.scen = k.bygg(c);
    if(LOGOBILD && !LOGOBILD.complete) LOGOBILD.onload = () => c.textur.forEach(t=>{ t.needsUpdate = true; });
  } else filmKlar();
  $("kap-kicker").textContent = k.kicker; $("kap-titel").textContent = k.titel;
  $("kap-prog").innerHTML = k.steg.map(()=>"<i></i>").join("");
  $("kapitel").classList.toggle("smal", kapitelSmal()); $("kapitel").classList.toggle("filmlage", film); $("kapitel").classList.toggle("fotolage", foto);
  $("mobil").classList.toggle("hidden", id!=="bil"); $("kap-remsa").innerHTML = ""; $("kap-foto").classList.remove("on"); $("kap-sokare").classList.remove("on","tagen"); $("kap-skick").classList.toggle("hidden", !film);
  visa("kapitel");
  if(!film && id==="bil") spelaIntro(); else ljud.motor && !film && ljud.motor(2400, .5);
  if(!film && !foto){ storlek(); R3.nu = null; const m0 = kamMal(k.steg[0]); const start = { p:m0.p.clone().sub(m0.t).multiplyScalar(1.6).add(m0.t), t:m0.t.clone() }; R3.nu = { p:start.p.clone(), t:start.t.clone() }; kamTill(m0); }
  kapSteg(0, true);
}
/* Husfilmen: spelas avsnitt för avsnitt och stannar på sista bilden. */
let filmUrl = null, filmStopp = 0;
function filmKlar(){
  const v = $("kap-film");
  koppla(v, "hus", HUSFILM);
}
function filmSeg(a, b){
  const v = $("kap-film"); filmStopp = b;
  const kor = () => { try{ v.currentTime = a; }catch(e){} if(b - a > .05){ const p = v.play(); p && p.catch(()=>{}); } else v.pause(); };
  if(v.readyState >= 1) kor(); else v.addEventListener("loadedmetadata", kor, { once:true });
}
$("kap-film").addEventListener("timeupdate", () => { const v = $("kap-film"); if(v.currentTime >= filmStopp - .04){ v.pause(); } });
/* Husets skick räknas upp medan filmen går, som i Fältet. */
const SKICK = [[0,0],[2.77,0],[19.7,30],[33.15,60],[50.1,90],[53.5,100],[60,100]];
(function skickLoop(){ requestAnimationFrame(skickLoop); if(!kap || !kap.k.film || !$("kapitel").classList.contains("on")) return;
  const t = $("kap-film").currentTime; let v = 100; for(let j=1;j<SKICK.length;j++){ if(t <= SKICK[j][0]){ const [a,va] = SKICK[j-1], [b,vb] = SKICK[j]; v = va + (vb-va)*(t-a)/(b-a); break; } }
  $("kap-skicktal").textContent = Math.round(v); $("kap-skickrad").style.width = v.toFixed(1)+"%"; })();
function kapSteg(i, forsta){
  const k = kap.k; i = Math.max(0, Math.min(k.steg.length-1, i)); kap.i = i; const s = k.steg[i];
  if(kap.k.film){ filmSeg(s.seg[0], s.seg[1]); const v = $("kap-film"); v.style.transformOrigin = s.zoom ? s.zoom[1] : "50% 50%"; v.style.transform = s.zoom ? `scale(${s.zoom[0]})` : ""; }
  else if(kap.id==="bil") visaBakgrund(s, i);
  else { kamTill(kamMal(s)); kap.scen.satt({ bak:s.bak, dorr:s.dorr, dack:s.dack, varn:s.varn, mark:s.mark, qr:s.qr || i<2 }); }
  { const feb = $("kap-fe"); feb.innerHTML = ""; if(s.fe) foreEfter(feb, s.fe); }
  $("kap-prog").querySelectorAll("i").forEach((e,j)=>{ e.className = j<i ? "klar" : j===i ? "on" : ""; });
  $("kap-steg").textContent = `${k.titel} · ${i+1} av ${k.steg.length}`;
  $("kap-rubrik").textContent = s.t;
  $("kap-text").innerHTML = (s.p||[]).map(t=>`<li>${t}</li>`).join("");
  $("kap-kort").innerHTML = (s.kort||[]).map(([a,b])=>`<div><small>${a}</small>${b}</div>`).join("");
  const fr = $("kap-fraga"); fr.innerHTML = "";
  if(s.fraga){ const sv = d3("kap-svar", "", null, s.fraga.svar);
    s.fraga.alt.forEach((t,j)=>{ const b = document.createElement("button"); b.type="button"; b.innerHTML = `<b>${"ABC"[j]}</b><span>${t}</span>`;
      b.onclick = () => { fr.querySelectorAll("button").forEach((x,n)=>{ x.classList.toggle("r", n===s.fraga.ratt); x.classList.toggle("f", n===j && j!==s.fraga.ratt); }); sv.classList.add("on"); kap.svarat[i]=true; j===s.fraga.ratt ? ljud.ratt() : ljud.fel(); };
      fr.appendChild(b); });
    fr.appendChild(sv); }
  $("inst-matare").classList.toggle("on", !!s.matare);
  $("inst-monster").classList.toggle("on", !!s.monster);
  if(s.monster){ $("mm-varde").textContent = s.monster; $("mm-grans").textContent = s.varn ? "Gräns vintertid: 3,0 mm" : "Gräns: 1,6 mm sommar, 3,0 mm vinter"; $("mm-varde").style.color = s.varn ? "var(--red2)" : "#fff"; }
  if(s.tel) ritaMobil(s.tel, i);
  $("kap-foto").classList.remove("on"); if(s.foto && !s.blixt && kap.id!=="bil"){ const jag2 = kap; setTimeout(()=>{ if(kap===jag2 && kap.i===i) visaFoto(s); }, 900); }
  const sok = $("kap-sokare"); sok.classList.remove("on","tagen"); sok.querySelector("b").textContent = "Ta bild";
  if(s.blixt && !kap.k.film){ const jag = kap; clearTimeout(kap.fotoT);
    setTimeout(()=>{ if(kap===jag && kap.i===i) sok.classList.add("on"); }, 700);
    kap.fotoT = setTimeout(()=>{ if(kap!==jag || kap.i!==i) return;
      const bild = s.foto ? KAPFOTO[[].concat(s.foto)[0]] : fota(); ljud.klick(); if(s.foto && kap.id!=="bil") visaFoto(s); const b=$("kap-blixt"); if(!RM){ b.classList.remove("go"); void b.offsetWidth; b.classList.add("go"); }
      sok.classList.add("tagen"); sok.querySelector("b").textContent = "Bild tagen";
      const vy = $("skarm").querySelector(".vy"); if(vy && bild){ vy.classList.add("tagen"); vy.innerHTML = `<img alt="" src="${bild}">`; }
      if(bild){ const rm = $("kap-remsa"); let fg = rm.querySelector(`[data-i="${i}"]`); if(!fg){ fg = document.createElement("figure"); fg.dataset.i = i; rm.appendChild(fg); }
        fg.innerHTML = `<img alt="" src="${bild}"><figcaption>${s.tel && s.tel.n ? s.tel.n : "✓"}</figcaption>`; }
      setTimeout(()=>{ if(kap===jag && kap.i===i) sok.classList.remove("on"); }, 900);
    }, forsta ? 3200 : 1900); }
  $("kap-bak").disabled = i===0; $("kap-bak").style.opacity = i===0 ? .4 : 1;
  $("kap-fram").textContent = i===k.steg.length-1 ? k.slut : "Nästa";
  $("kap-in").scrollTop = 0;
}
/* Tar en riktig bild av 3D-scenen från där kameran står. */
let introUrl = null;
koppla($("kap-intro"), "intro", BILINFILM); koppla($("kap-film"), "hus", HUSFILM);
function spelaIntro(){
  const v = $("kap-intro"); if(RM){ v.classList.add("hidden"); return; }
  $("kapitel").classList.add("intro"); v.classList.remove("hidden","ut");
  koppla(v, "intro", BILINFILM, () => { try{ v.currentTime = 0; }catch(e){} const p = v.play(); p && p.catch(()=>slutIntro()); }); ljud.motor(7600, .7);
}
function slutIntro(){ const v = $("kap-intro"); if(v.classList.contains("hidden")) return; v.classList.add("ut"); $("kapitel").classList.remove("intro"); setTimeout(()=>{ v.pause(); v.classList.add("hidden"); }, 900); }
$("kap-intro").addEventListener("ended", slutIntro);
$("kap-intro").addEventListener("click", slutIntro);
/* Ken Burns: mjuk zoom mot den del av bilden som steget handlar om. */
const FOKUS = { fv:"35% 55%", fh:"62% 55%", bh:"40% 55%", bv:"60% 55%", forar:"45% 50%", last:"50% 55%", qr:"45% 45%", matare:"52% 55%", dack:"52% 40%", dack28:"55% 40%", lampa:"48% 55%", skada:"45% 50%" };
function visaBakgrund(s, i){
  const box = $("kap-bilder"), [a, b] = box.querySelectorAll("img"), fs = [].concat(s.foto || (i===0 ? "fv" : "fh"));
  const ny = box.dataset.v === "a" ? b : a, gammal = ny === a ? b : a; box.dataset.v = ny === a ? "a" : "b";
  const satt = (el, key) => { el.src = KAPFOTO[key]; el.style.transformOrigin = FOKUS[key] || "50% 50%"; el.style.transition = "none"; el.style.transform = "scale(1.12)"; void el.offsetWidth; el.style.transition = ""; el.className = "on"; el.style.transform = "scale(1)"; };
  satt(ny, fs[0]); gammal.className = "";
  $("kap-bildtext").textContent = [].concat(s.fototext||"")[0] || ""; $("kap-bildtext").classList.toggle("on", !!s.fototext);
  clearInterval(kap.bgV); if(fs.length > 1){ let n = 0; const jag = kap; kap.bgV = setInterval(()=>{ if(kap!==jag || kap.i!==i){ clearInterval(jag.bgV); return; } n = (n+1) % fs.length; const [x, y] = box.querySelectorAll("img"), nn = box.dataset.v === "a" ? y : x, gg = nn === x ? y : x; box.dataset.v = nn === x ? "a" : "b"; satt(nn, fs[n]); gg.className = ""; $("kap-bildtext").textContent = [].concat(s.fototext||"")[n] || ""; }, 4200); }
}
function visaFoto(s){ const kf = $("kap-foto"), fs = [].concat(s.foto), ts = [].concat(s.fototext||""), jag = kap, i0 = kap.i; let n = 0;
  const visa1 = () => { kf.innerHTML = `<img alt="" src="${KAPFOTO[fs[n]]}"><span>${ts[n]||""}</span><em>Visualisering</em>`; kf.classList.add("on"); };
  visa1(); clearInterval(kap.fotoV); if(fs.length > 1) kap.fotoV = setInterval(()=>{ if(kap!==jag || kap.i!==i0){ clearInterval(jag.fotoV); return; } kf.classList.remove("on"); setTimeout(()=>{ n = (n+1) % fs.length; visa1(); }, 350); }, 3600); }
function fota(){
  try{ rendera(performance.now()); const src = R3.r.domElement, c = document.createElement("canvas"); c.width = 320; c.height = 240;
    const w = src.width, h = src.height, sw = w*.52, sh = sw*.75, sx = w*.09, sy = Math.max(0, h*.17 + (h*.62 - sh)/2);
    c.getContext("2d").drawImage(src, sx, sy, sw, Math.min(sh, h-sy), 0, 0, 320, 240); return c.toDataURL("image/jpeg", .8); }catch(e){ return null; }
}
function ritaMobil(t, i){
  const n = KAPITEL.bil.steg.length; const pr = Math.round(i/(n-1)*100);
  let vy = "";
  if(t.vy==="qr") vy = `<div class="vy"><img src="${QR}" alt=""><div class="linje"></div></div>`;
  else if(t.vy==="skanna") vy = `<div class="vy"><img src="${QR}" alt=""><div class="linje"></div></div><div class="fl">${t.f}</div>`;
  else if(t.vy==="bild") vy = `<h4>${t.ti||""}</h4><div class="tips">${t.tip||""}</div><div class="vy">Kameran</div>${t.f?`<div class="fl">${t.f}</div>`:""}<div class="kn">Ta bild</div>`;
  else if(t.vy==="lampa") vy = `<h4>Lyser någon varningslampa?</h4><div class="tg"><span class="${t.ja?"on":""}">Ja</span><span class="${t.ja?"":"on"}">Nej</span></div><div class="fl">${t.f}</div><div class="kn">Skicka</div>`;
  else if(t.vy==="klar") vy = `<div class="vy" style="background:#1f8a4c;color:#fff;font-size:13px">Skickad<br>11 bilder · 4 däck</div><div class="kn ok">Klar</div>`;
  $("skarm").innerHTML = `<div class="hd"><b>${t.h}</b><span>${t.s}</span></div><div class="pr"><i style="width:${pr}%"></i></div><div class="bd">${vy}</div>`;
}
function kapFram(){ if(!kap) return; if(kap.i >= kap.k.steg.length-1){ const k = kap.klart; kap.klart = null; k ? k() : visa("start"); return; } kapSteg(kap.i+1); }
function kapBak(){ if(kap) kapSteg(kap.i-1); }
$("kap-fram").onclick = () => { if($("kapitel").classList.contains("intro")){ slutIntro(); return; } kapFram(); }; $("kap-bak").onclick = kapBak;
$("kap-stang").onclick = () => { if(!kap) return; const k = kap.klart; kap.klart = null; k ? k() : visa("start"); };
window.addEventListener("resize", ()=>{ if(kap && !kap.k.film && R3 && $("kapitel").classList.contains("on")){ $("kapitel").classList.toggle("smal", kapitelSmal()); storlek(); kamTill(kamMal(kap.k.steg[kap.i]), true); } });
