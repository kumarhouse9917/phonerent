/***** CONFIG *****/
const DATA_URL = "data/phones.csv";          // normal path when hosted
const MIN_TERM = 6, MAX_TERM = 24;
let COMPARE_LIMIT = 3;                        // adjust 2..5 if you want

/***** STATE *****/
const state = {
  rows: [],
  filtered: [],
  compare: [],
  query: "",
  term: 12,
  settings: { currency:"฿", marginOverride:null, depositOverride:null, taxPct:0 },
  currentDetailKey: null
};
const $ = s => document.querySelector(s);
const $$ = s => Array.from(document.querySelectorAll(s));

/***** UTIL *****/
function money(n){ n = Number(n)||0; return state.settings.currency + String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g, ","); }
function num(x){ const n = Number(String(x).replace(/[^0-9.\-]/g, "")); return isFinite(n) ? n : 0; }
function encodeKey(r){ return `${r.Brand}||${r.Model}||${r.Memory}||${r.Color}||${r.BatteryPct}||${r.BuyingPrice}`; }
function findByKey(k){
  const [Brand,Model,Memory,Color,BatteryPct,BuyingPrice] = k.split("||");
  return state.rows.find(r => r.Brand===Brand && r.Model===Model && String(r.Memory)===String(Memory) && r.Color===Color && String(r.BatteryPct)===String(BatteryPct) && String(r.BuyingPrice)===String(BuyingPrice));
}
function debounce(fn,ms=120){ let t; return (...a)=>{ clearTimeout(t); t=setTimeout(()=>fn(...a),ms); }; }

/***** PARSING *****/
function normalizeRow(row){
  const norm={}; Object.keys(row).forEach(k=>norm[k.toLowerCase().replace(/[^a-z0-9]/g,"")]=row[k]);
  return {
    Brand: row["Brand"] ?? norm["brand"] ?? "",
    Model: row["Model"] ?? norm["model"] ?? "",
    Memory: num(row["Memory"] ?? norm["memory"]),
    Color: row["Color"] ?? norm["color"] ?? "",
    BatteryPct: num(row["Battery %"] ?? row["Battery%"] ?? norm["battery"] ?? norm["batterypct"] ?? 0),
    BuyingPrice: num(row["Buying Price"] ?? row["BuyingPrice"] ?? norm["buyingprice"]),
    RentDuration: num(row["Rent Duration"] ?? norm["rentduration"] ?? 12),
    MarginPct: num(row["Margin"] ?? norm["margin"]),
    DepositPct: num(row["Deposit"] ?? norm["deposit"]),
    image: row["image"] || "data:image/svg+xml;utf8,"+encodeURIComponent(`<svg xmlns='http://www.w3.org/2000/svg' width='640' height='360'><rect width='100%' height='100%' fill='#0b1220'/><text x='40' y='70' font-size='40' fill='#9fb4ff' font-family='system-ui, -apple-system, Segoe UI, Roboto'>iPhone</text></svg>`)
  };
}
function parseCSV(text){
  const lines = text.trim().split(/\r?\n/);
  const headers = lines.shift().split(",").map(h=>h.trim());
  return lines.map(line=>{
    const cells = line.split(",").map(c=>c.trim());
    const obj = {};
    headers.forEach((h,i)=>obj[h]=cells[i]??"");
    return normalizeRow(obj);
  });
}

/***** LOADING (robust for file://) *****/
async function loadCSV(url){
  try {
    const res = await fetch(url, { cache:"no-store" });
    if(!res.ok) throw new Error(`HTTP ${res.status}`);
    const text = await res.text();
    state.rows = parseCSV(text);
  } catch (err) {
    // Fallback: embedded CSV in HTML (works when opened locally)
    const seed = document.getElementById("seedCSV");
    if (seed && seed.textContent.trim().length > 0) {
      state.rows = parseCSV(seed.textContent);
    } else {
      throw new Error("Could not load CSV and no fallback data present.");
    }
  }
}

/***** PRICING *****/
function computeDeal(item,term){
  const P = Number(item.BuyingPrice)||0;
  const m = (state.settings.marginOverride!=null?state.settings.marginOverride:(Number(item.MarginPct)||0))/100;
  const d = (state.settings.depositOverride!=null?state.settings.depositOverride:(Number(item.DepositPct)||0))/100;
  let inflow = P*(1+m);
  let depositSum = inflow*d;
  let remaining = inflow - depositSum;
  let monthly = remaining/term;
  if(state.settings.taxPct>0){
    const t=state.settings.taxPct/100;
    depositSum*=(1+t); monthly*=(1+t); remaining=inflow-depositSum;
  }
  return { inflow, depositSum, remaining, monthly };
}

/***** ROUTER *****/
function showTopbar(show){ $("#topbar").classList.toggle("hidden", !show); }
function route(hash){
  const [path, query] = (hash||"#/home").split("?");
  $("#pageHome").classList.add("hidden");
  $("#pageResults").classList.add("hidden");
  $("#pageDetail").classList.add("hidden");
  $("#pageCompare").classList.add("hidden");

  if(path==="#/home"){
    showTopbar(false);
    $("#pageHome").classList.remove("hidden");
    $("#searchInput").focus();
  } else if(path==="#/results"){
    showTopbar(true);
    $("#pageResults").classList.remove("hidden");
    const params=new URLSearchParams(query||"");
    state.query=(params.get("q")||"").trim();
    const termQ=Number(params.get("term"));
    if(termQ>=MIN_TERM && termQ<=MAX_TERM) state.term=termQ;
    $("#termRange").value=state.term; $("#termVal").textContent=String(state.term);
    populateAndRenderResults();
  } else if(path==="#/detail"){
    showTopbar(true);
    $("#pageDetail").classList.remove("hidden");
    const params=new URLSearchParams(query||"");
    state.currentDetailKey=params.get("id");
    renderDetail();
  } else if(path==="#/compare"){
    showTopbar(true);
    $("#pageCompare").classList.remove("hidden");
    renderCompare();
  } else {
    location.hash="#/home";
  }
}

/***** SUGGESTIONS (from Brand, Model, Memory, Color) *****/
function buildSuggestions(){
  const fields=[];
  state.rows.forEach(r=>{
    if(r.Brand) fields.push(r.Brand);
    if(r.Model) fields.push(r.Model);
    if(r.Memory) fields.push(r.Memory+" GB");
    if(r.Color) fields.push(r.Color);
  });
  state.__sugs = Array.from(new Set(fields)).sort();
}
function updateSuggestionsBox(term){
  const list=$("#suggestList");
  if(!term){ list.classList.add("hidden"); list.innerHTML=""; return; }
  const q=term.toLowerCase();
  const hits=(state.__sugs||[]).filter(s=>s.toLowerCase().includes(q)).slice(0,8);
  if(hits.length===0){ list.classList.add("hidden"); list.innerHTML=""; return; }
  list.innerHTML = hits.map(s=>`<li data-sug="${s}">${s}</li>`).join("");
  list.classList.remove("hidden");
}
function matchQuery(r,q){
  if(!q) return true;
  const hay = `${r.Brand} ${r.Model} ${r.Memory}GB ${r.Color}`.toLowerCase();
  return q.toLowerCase().split(/\s+/).filter(Boolean).every(t=>hay.includes(t));
}

/***** RESULTS *****/
function populateAndRenderResults(){
  $("#batteryRange").value = $("#batteryRange").value || 80;
  $("#battVal").textContent = $("#batteryRange").value;
  applyFilters();
  renderResults();
}
function applyFilters(){
  const mem=$("#memoryFilter").value;
  const color=$("#colorFilter").value;
  const battMin=Number($("#batteryRange").value);
  let rows=state.rows.filter(r=>matchQuery(r,state.query));
  if(mem) rows=rows.filter(r=>String(r.Memory)===mem);
  if(color) rows=rows.filter(r=>r.Color===color);
  rows=rows.filter(r=>(Number(r.BatteryPct)||0)>=battMin);

  const mems=Array.from(new Set(rows.map(r=>r.Memory).filter(Boolean))).sort((a,b)=>a-b);
  $("#memoryFilter").innerHTML=`<option value="">Memory</option>`+mems.map(m=>`<option value="${m}">${m} GB</option>`).join("");
  const colors=Array.from(new Set(rows.map(r=>r.Color).filter(Boolean))).sort();
  $("#colorFilter").innerHTML=`<option value="">Color</option>`+colors.map(c=>`<option value="${c}">${c}</option>`).join("");

  state.filtered=rows;
}
function renderResults(){
  const list=$("#resultsList");
  list.innerHTML="";
  const term=state.term;

  const rows=state.filtered.map(r=>({r,deal:computeDeal(r,term)})).sort((a,b)=>a.deal.monthly-b.deal.monthly);
  rows.forEach(({r,deal})=>{
    const key=encodeKey(r);
    const added=state.compare.includes(key);
    const item=document.createElement("div");
    item.className="card-h";
    item.innerHTML=`
      <button class="card-plus ${added?'added':''}" data-cmp="${key}" title="Add to compare">+</button>
      <div class="card-img">📱</div>
      <div class="card-body">
        <div class="row"><strong>${r.Model}</strong> <span class="badge">${r.Memory} GB • ${r.Color} • ${r.BatteryPct}%</span></div>
        <div class="row"><span>Brand:</span><strong>${r.Brand}</strong></div>
        <div class="row"><span>Buying:</span><strong>${money(r.BuyingPrice)}</strong></div>
        <div class="row"><span>Margin:</span><strong>${(state.settings.marginOverride??r.MarginPct).toFixed(1)}%</strong> <span>• Deposit:</span><strong>${(state.settings.depositOverride??r.DepositPct).toFixed(1)}%</strong></div>
        <div class="row"><span>Term:</span><strong>${term} months</strong></div>
        <div class="row"><span>Inflow:</span><strong>${money(deal.inflow)}</strong> <span>• Deposit sum:</span><strong>${money(deal.depositSum)}</strong></div>
        <div class="row"><span>Remaining:</span><strong>${money(deal.remaining)}</strong> <span>• Monthly:</span><strong class="price ok">${money(deal.monthly)}</strong></div>
      </div>
      <div class="card-actions">
        <a class="btn btn-primary" href="#/detail?id=${encodeURIComponent(key)}">View</a>
      </div>
    `;
    list.appendChild(item);
  });
  updateCompareFab();
}

/***** DETAIL *****/
function renderDetail(){
  const wrap=$("#detailWrap");
  const r=findByKey(state.currentDetailKey);
  if(!r){ wrap.innerHTML="<p class='muted'>Item not found.</p>"; return; }
  const deal=computeDeal(r,state.term);
  wrap.innerHTML=`
    <div class="detail-hero">
      <div class="detail-img">📱</div>
      <div class="detail-info">
        <h2 style="margin:.2rem 0">${r.Model}</h2>
        <div class="row"><span>${r.Brand}</span> <span class="badge">${r.Memory} GB • ${r.Color} • ${r.BatteryPct}%</span></div>
        <div class="row"><span>Buying:</span><strong>${money(r.BuyingPrice)}</strong></div>
        <div class="row"><span>Margin:</span><strong>${(state.settings.marginOverride??r.MarginPct).toFixed(1)}%</strong> • <span>Deposit:</span><strong>${(state.settings.depositOverride??r.DepositPct).toFixed(1)}%</strong></div>
        <div class="row"><span>Term:</span><strong>${state.term} months</strong></div>
        <div class="row"><span>Inflow:</span><strong>${money(deal.inflow)}</strong> • <span>Deposit sum:</span><strong>${money(deal.depositSum)}</strong></div>
        <div class="row"><span>Remaining:</span><strong>${money(deal.remaining)}</strong> • <span>Monthly:</span><strong class="price ok">${money(deal.monthly)}</strong></div>
      </div>
    </div>
    <div style="display:flex;gap:.6rem">
      <button class="btn btn-primary" data-cmp="${encodeKey(r)}">Add to Compare</button>
    </div>
  `;
}

/***** COMPARE *****/
function updateCompareFab(){
  const cnt=state.compare.length;
  $("#cmpCount").textContent=String(cnt);
  $("#compareFAB").classList.toggle("hidden", cnt===0);
}
function renderCompare(){
  const wrap=$("#compareTableWrap");
  if(state.compare.length===0){ wrap.innerHTML="<p class='muted'>No items selected. Go to results and tap +.</p>"; return; }
  const term=state.term;
  const rows=state.compare.slice(0,COMPARE_LIMIT).map(k=>findByKey(k)).filter(Boolean);
  const labels=[
    ["Brand","Brand"],["Model","Model"],["Color","Color"],["Memory","Memory"],["BatteryPct","Battery %"],
    ["BuyingPrice","Buying price"],["MarginPct","Margin %"],["DepositPct","Deposit %"],
    ["Inflow","Inflow"],["DepositSum","Deposit sum"],["Remaining","Remaining"],["Monthly","Monthly"]
  ];
  const deals=rows.map(r=>computeDeal(r,term));
  let html=`<table><thead><tr><th>Field</th>${rows.map(r=>`<th>${r.Model} • ${r.Memory}GB</th>`).join("")}</tr></thead><tbody>`;
  for(const [key,label] of labels){
    html+=`<tr><th>${label}</th>`;
    rows.forEach((r,i)=>{
      let val="";
      if(key==="BuyingPrice") val=money(r.BuyingPrice);
      else if(key==="MarginPct") val=((state.settings.marginOverride??r.MarginPct).toFixed(1))+"%";
      else if(key==="DepositPct") val=((state.settings.depositOverride??r.DepositPct).toFixed(1))+"%";
      else if(key==="Memory") val=r.Memory+" GB";
      else if(key==="BatteryPct") val=r.BatteryPct+"%";
      else if(key==="Inflow") val=money(deals[i].inflow);
      else if(key==="DepositSum") val=money(deals[i].depositSum);
      else if(key==="Remaining") val=money(deals[i].remaining);
      else if(key==="Monthly") val=money(deals[i].monthly);
      else val=r[key];
      html+=`<td>${val}</td>`;
    });
    html+=`</tr>`;
  }
  html+=`</tbody></table>`;
  wrap.innerHTML=html;
}

/***** EVENTS *****/
$("#backBtn").addEventListener("click", ()=>history.back());

// Home
$("#termRange").addEventListener("input", e=>{ state.term=Number(e.target.value); $("#termVal").textContent=String(state.term); });
$("#searchInput").addEventListener("input", debounce(e=>updateSuggestionsBox(e.target.value),80));
$("#suggestList").addEventListener("click", e=>{
  const li=e.target.closest("li[data-sug]"); if(!li) return;
  $("#searchInput").value=li.dataset.sug; $("#suggestList").classList.add("hidden");
});
document.addEventListener("click", e=>{ if(!e.target.closest(".searchbox")) $("#suggestList").classList.add("hidden"); });
$("#searchBtn").addEventListener("click", ()=>{
  const q=($("#searchInput").value||"").trim();
  location.hash = `#/results?q=${encodeURIComponent(q)}&term=${state.term}`;
});

// Results filters
$("#batteryRange").addEventListener("input", e=>{ $("#battVal").textContent=String(e.target.value); applyFilters(); renderResults(); });
$("#memoryFilter").addEventListener("change", ()=>{ applyFilters(); renderResults(); });
$("#colorFilter").addEventListener("change", ()=>{ applyFilters(); renderResults(); });

// Add to compare (+ button or detail)
document.addEventListener("click", e=>{
  const btn=e.target.closest("[data-cmp]"); if(!btn) return;
  const key=btn.dataset.cmp;
  if(!state.compare.includes(key)){
    if(state.compare.length>=COMPARE_LIMIT){ alert(`You can compare at most ${COMPARE_LIMIT} items.`); return; }
    state.compare.push(key);
    btn.classList.add("added");
  }
  updateCompareFab();
});

// FAB → compare page
$("#compareFAB").addEventListener("click", ()=>{ location.hash="#/compare"; });

// Router
window.addEventListener("hashchange", ()=>route(location.hash));

/***** INIT *****/
(async function init(){
  await loadCSV(DATA_URL);     // will fallback to embedded CSV if fetch fails
  buildSuggestions();          // from Brand/Model/Memory/Color
  route(location.hash || "#/home");
})();
