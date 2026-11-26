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
