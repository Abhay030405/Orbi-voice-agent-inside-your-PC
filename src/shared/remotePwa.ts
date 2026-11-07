// The phone remote (PWA): one page, served both by the laptop's own bridge (main/phoneBridge.ts) and by
// the always-on relay (relay/server.ts), so the two can't drift apart. Only plain strings here.
//
// The page talks to whichever server served it, with relative URLs: /events (SSE, laptop -> phone),
// POST /command, /confirm-reply, /contacts, /stop, /upload (phone -> laptop) and /dl/<id> (a file the
// laptop sent). The pairing token comes from the QR code (#t=<token>) or is pasted once, and is kept in
// localStorage. Behind the relay, a "laptop" event says whether the laptop is connected right now.

export const PWA_HTML = /* html */ `<!doctype html><html lang="en"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<meta name="theme-color" content="#0E1013">
<link rel="manifest" href="/manifest.json">
<link rel="icon" href="/icon.svg"><link rel="apple-touch-icon" href="/icon.svg">
<meta name="apple-mobile-web-app-capable" content="yes">
<meta name="apple-mobile-web-app-status-bar-style" content="black-translucent">
<title>Orbi Remote</title>
<style>
:root{color-scheme:dark;--bg:#0E1013;--panel:#121519;--line:#1f242c;--ink:#E6E8EB;--dim:#8a93a3;--acc:#7FD3E6;--att:#F2B54A;--err:#F0705A}
*{box-sizing:border-box}[hidden]{display:none!important}html,body{height:100%;overflow-x:hidden}
body{margin:0;width:100%;max-width:100vw;font:15px/1.45 system-ui,-apple-system,Segoe UI,sans-serif;background:var(--bg);color:var(--ink);display:flex;flex-direction:column;height:100dvh;padding-top:env(safe-area-inset-top)}
header{padding:10px 16px;border-bottom:1px solid var(--line);display:flex;align-items:center;gap:10px}
header b{flex:1}
.dot{width:9px;height:9px;border-radius:50%;background:#4b5260;flex:none}
.dot.on{background:#34d399;box-shadow:0 0 8px #34d399}
#lap{font-size:12px;color:var(--dim)}
.icon{background:none;border:1px solid var(--line);color:var(--ink);border-radius:9px;padding:6px 9px;font-size:15px}
#log{flex:1;overflow:auto;padding:10px 16px 16px;font-size:14px}
.row{margin:8px 0;white-space:pre-wrap;word-break:break-word}
.me{text-align:right}.me span{display:inline-block;background:#1d3b47;padding:8px 12px;border-radius:14px 14px 4px 14px;max-width:85%;text-align:left}
.orbi span{display:inline-block;background:var(--panel);border:1px solid var(--line);padding:8px 12px;border-radius:14px 14px 14px 4px;max-width:90%}
.ev{color:var(--dim);font-size:12px}
.file a{display:inline-block;background:#0f2a33;border:1px solid #1f4d5c;color:var(--acc);font-weight:600;padding:10px 14px;border-radius:12px;text-decoration:none}
.ask{background:#211a0d;border:1px solid #5a4417;border-radius:12px;padding:10px 12px}
.ask .btns{display:flex;gap:8px;margin-top:8px}
button{font:inherit;border:0;border-radius:10px;padding:11px 15px;font-weight:600;color:#06222a;background:var(--acc)}
button.grey{background:#2a3039;color:var(--ink)}button.red{background:var(--err);color:#fff}
#chips{display:flex;gap:8px;overflow-x:auto;scrollbar-width:none;padding:8px 16px;border-top:1px solid var(--line)}
#chips button{flex:none;background:#1a1f26;color:var(--ink);border:1px solid var(--line);font-weight:500;font-size:13px;padding:7px 12px;border-radius:999px}
form{display:flex;gap:8px;padding:8px 16px calc(10px + env(safe-area-inset-bottom));border-top:1px solid var(--line)}
input{flex:1;min-width:0;font:inherit;background:#161a20;border:1px solid #2a313b;color:var(--ink);border-radius:10px;padding:11px}
#mic.on{background:var(--err);color:#fff}
.gate{padding:28px 18px;display:flex;flex-direction:column;gap:12px}small{color:var(--dim)}
#orbiwrap{display:flex;align-items:center;gap:14px;padding:10px 16px;border-bottom:1px solid var(--line)}
#label{color:var(--dim);font-size:13px;flex:1}
#stop{display:none}#stop.show{display:inline-block}
</style></head><body>
<header><span id="dot" class="dot" title="connection"></span><b>Orbi Remote</b><span id="lap"></span><button class="icon" id="snd" title="voice on/off">🔊</button></header>
<div id="gate" class="gate">
  <div>Scan the QR code on your laptop (Orbi → Phone), or paste the pairing code:</div>
  <input id="tok" placeholder="pairing code" autocomplete="off">
  <button id="pair">Connect</button>
  <small>Orbi must be running on the laptop. Commands go only to your own laptop, and risky actions still ask you first, here.</small>
</div>
<div id="orbiwrap" hidden><canvas id="orbi" width="120" height="120" style="width:64px;height:64px"></canvas><div id="label">connecting…</div><button class="red" id="stop" type="button">Stop</button></div>
<div id="log" hidden></div>
<div id="chips" hidden></div>
<form id="f" hidden><button type="button" class="icon" id="att" title="send a file to the laptop">📎</button><input id="cmd" placeholder="Tell Orbi…" autocomplete="off" enterkeyhint="send"><button type="button" class="grey" id="mic" title="speak">🎤</button><button>Send</button></form>
<input type="file" id="pick" hidden>
<script>
var $=function(id){return document.getElementById(id)},log=$("log"),dot=$("dot")
var esc=function(s){return String(s).replace(/[&<>"]/g,function(c){return {"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"}[c]})}
function row(cls,html){var d=document.createElement("div");d.className="row "+cls;d.innerHTML=html;log.appendChild(d);log.scrollTop=log.scrollHeight;return d}
var store={get:function(k){try{return localStorage.getItem(k)}catch(e){return null}},set:function(k,v){try{localStorage.setItem(k,v)}catch(e){}}}
var token=store.get("dw.token")||""
var m=/[#&]t=([A-Za-z0-9_-]{16,})/.exec(location.hash)
if(m){token=m[1];store.set("dw.token",token);history.replaceState(null,"",location.pathname)}
var voice=store.get("dw.voice")!=="off"
function setVoice(on){voice=on;store.set("dw.voice",on?"on":"off");$("snd").textContent=on?"🔊":"🔇";if(!on)stopAudio()}
$("snd").onclick=function(){ensureAudio();setVoice(!voice)}
var q=function(p){return p+(p.indexOf("?")<0?"?":"&")+"token="+encodeURIComponent(token)}
function post(path,body,type){return fetch(q(path),{method:"POST",headers:{"content-type":type||"application/json"},body:type?body:JSON.stringify(body)}).then(function(r){return r.json().catch(function(){return {ok:r.ok}}).then(function(j){if(!r.ok||j.ok===false)throw new Error(j.error||("HTTP "+r.status));return j})})}
var reply=null,es=null
function setLaptop(on){$("lap").textContent=on?"laptop online":"laptop offline";$("lap").style.color=on?"#34d399":"#F0705A"}
function connect(){if(es)es.close();es=new EventSource(q("/events"))
  es.onopen=function(){dot.classList.add("on")}
  es.onerror=function(){dot.classList.remove("on")}
  es.onmessage=function(e){var m;try{m=JSON.parse(e.data)}catch(x){return}
    if(m.type==="presence"){applyPresence(m.presence);return}
    if(m.type==="laptop"){setLaptop(m.online);return}
    if(m.type==="audio"){if(voice){ensureAudio();playChunk(m.b64)}return}
    if(m.type==="audio-stop"){stopAudio();return}
    if(m.type==="reply"){if(!reply)reply=row("orbi","<span></span>").firstChild;reply.textContent+=m.text;log.scrollTop=log.scrollHeight;return}
    if(m.type==="turn-end"){reply=null;return}
    if(m.type==="file-ready"){reply=null;row("file",'<a href="'+esc(q(m.url))+'" download="'+esc(m.name)+'">📎 '+esc(m.name)+(m.size?" ("+fmt(m.size)+")":"")+"</a>");return}
    if(m.type==="confirm"){askConfirm(m);return}
    if(m.type==="confirm-close"){var el=$("c_"+m.id);if(el&&!el.dataset.answered){el.dataset.answered="1";el.textContent=(m.by==="laptop"?"✓ answered on the laptop: ":"⌛ no answer, so Orbi didn't do it: ")+m.summary}return}
    if(m.msg)row("ev",esc(m.msg))}}
function fmt(n){return n>1048576?(n/1048576).toFixed(1)+" MB":Math.max(1,Math.round(n/1024))+" KB"}
function askConfirm(m){reply=null
  var d=row("ask","");d.id="c_"+m.id
  d.innerHTML="⚠️ <b>Orbi wants to:</b> "+esc(m.summary)+' <small>('+esc(m.risk||"")+')</small><div class="btns"><button>Allow</button><button class="grey">Deny</button></div>'
  var b=d.querySelectorAll("button")
  var answer=function(a){if(d.dataset.answered)return;d.dataset.answered="1";d.textContent=(a?"✓ allowed: ":"✕ denied: ")+m.summary
    post("/confirm-reply",{id:m.id,approve:a}).catch(function(){d.textContent+=" (couldn't reach the laptop)"})}
  b[0].onclick=function(){answer(true)};b[1].onclick=function(){answer(false)}
  if(navigator.vibrate)navigator.vibrate([80,60,80])}
var started=false
function start(){$("gate").hidden=true;$("orbiwrap").hidden=false;log.hidden=false;$("f").hidden=false;$("chips").hidden=false;setVoice(voice);connect();if(!started)startOrbi();started=true;chips();checkCode()}
// A wrong or old pairing code only shows as a dead connection: ask once, and if it's refused, go back to pairing.
function checkCode(){fetch(q("/ping")).then(function(r){if(r.ok)return r.json().then(function(j){if(j.unknown)row("ev","No laptop has used this pairing code lately. If Orbi is running, scan the QR code on the laptop again.")});if(r.status===401){if(es)es.close();store.set("dw.token","");token="";
  $("gate").hidden=false;$("orbiwrap").hidden=true;log.hidden=true;$("f").hidden=true;$("chips").hidden=true
  $("tok").value="";$("tok").placeholder="that code was wrong: scan the QR code again"}}).catch(function(){})}
$("pair").onclick=function(){var t=$("tok").value.trim();var mm=/t=([A-Za-z0-9_-]+)/.exec(t);if(mm)t=mm[1];if(!t)return;token=t;store.set("dw.token",t);start()}
var QUICK=["Open Docker Desktop","Send me the newest file in my Downloads","What's open on my laptop?","Take a screenshot and send it to me","Lock my laptop"]
function chips(){var c=$("chips");c.innerHTML="";QUICK.forEach(function(t){var b=document.createElement("button");b.type="button";b.textContent=t;b.onclick=function(){sendCmd(t)};c.appendChild(b)})}
function sendCmd(t){t=t.trim();if(!t)return;ensureAudio();stopAudio();reply=null;row("me","<span>"+esc(t)+"</span>")
  post("/command",{text:t}).catch(function(e){row("ev","✕ "+esc(e.message))})}
$("f").onsubmit=function(e){e.preventDefault();sendCmd($("cmd").value);$("cmd").value=""}
$("stop").onclick=function(){stopAudio();post("/stop",{}).catch(function(){})}
$("att").onclick=function(){$("pick").click()}
$("pick").onchange=function(){var f=$("pick").files[0];$("pick").value="";if(!f)return
  if(f.size>25*1048576){row("ev","✕ "+esc(f.name)+" is over 25 MB");return}
  var r=row("ev","⬆ sending "+esc(f.name)+" to the laptop…")
  fetch(q("/upload?name="+encodeURIComponent(f.name)),{method:"POST",headers:{"content-type":"application/octet-stream"},body:f})
    .then(function(x){return x.json().then(function(j){if(!x.ok||j.ok===false)throw new Error(j.error||("HTTP "+x.status));r.textContent="✓ "+f.name+" is on the laptop, in Downloads"})})
    .catch(function(e){r.textContent="✕ couldn't send "+f.name+": "+e.message})}
// Portable Orbi: the companion's colours, driven by the presence the laptop forwards.
var PAL={graphite:{acc:"#7FD3E6",att:"#F2B54A",err:"#F0705A",ink:"#E6E8EB",bg:"#0E1013",body:"#121519",dim:"#3a4049"},
         ember:{acc:"#74D9B2",att:"#F4B860",err:"#F0715A",ink:"#EFEAE2",bg:"#15130F",body:"#1B1814",dim:"#3a352c"}}
var orbi={face:"idle",caution:false,theme:"graphite"}
function applyPresence(p){orbi.face=p.face;orbi.caution=p.caution;orbi.theme=PAL[p.theme]?p.theme:"graphite"
  $("label").textContent=p.label||"";document.body.style.background=PAL[orbi.theme].bg
  var busy=p.face==="speaking"||p.face==="thinking"||p.face==="acting";$("stop").className=busy?"red show":"red"}
var rgba=function(hex,a){var n=parseInt(hex.slice(1),16);return"rgba("+((n>>16)&255)+","+((n>>8)&255)+","+(n&255)+","+a+")"}
function startOrbi(){var cv=$("orbi"),x=cv.getContext("2d"),w=cv.width,h=cv.height
  var dim=function(s){return s==="offline"||s==="reconnecting"||s==="paused"}
  function frame(t){var P=PAL[orbi.theme],s=orbi.face
    var col=s==="confirm"?P.att:s==="danger"?P.err:dim(s)?P.dim:P.acc
    var active=s==="listening"||s==="thinking"||s==="speaking"||s==="acting"
    x.clearRect(0,0,w,h);var cx=w/2,cy=h/2,r=34*(1+0.03*Math.sin(t/700))*(active?1.05:1)
    var g=x.createRadialGradient(cx,cy,r*0.2,cx,cy,r*1.75);g.addColorStop(0,rgba(col,0.38));g.addColorStop(1,rgba(col,0))
    x.fillStyle=g;x.beginPath();x.arc(cx,cy,r*1.75,0,7);x.fill()
    x.fillStyle=P.body;x.strokeStyle=rgba(col,0.95);x.lineWidth=2.5;x.beginPath();x.arc(cx,cy,r,0,7);x.fill();x.stroke()
    if(s==="thinking"||s==="acting"){var a=(t/380)%(Math.PI*2);x.strokeStyle=rgba(col,0.85);x.lineWidth=3;x.beginPath();x.arc(cx,cy,r+7,a,a+1.6);x.stroke()}
    var eh=9*(Math.sin(t/1500)>0.98?0.12:1)
    x.fillStyle=P.ink;x.beginPath();x.ellipse(cx-11,cy-4,5,eh,0,0,7);x.fill();x.beginPath();x.ellipse(cx+11,cy-4,5,eh,0,0,7);x.fill()
    if(s==="speaking"){var mo=0.5+0.5*Math.abs(Math.sin(t/110));x.strokeStyle=P.ink;x.lineWidth=2.5;x.beginPath();x.moveTo(cx-9,cy+12);x.quadraticCurveTo(cx,cy+12+8*mo,cx+9,cy+12);x.stroke()}
    if(orbi.caution){x.strokeStyle=P.att;x.setLineDash([5,4]);x.lineWidth=2;x.beginPath();x.arc(cx,cy,r+12,0,7);x.stroke();x.setLineDash([])}
    requestAnimationFrame(frame)}
  requestAnimationFrame(frame)}
// Orbi's voice: 24 kHz Int16 PCM chunks, scheduled back to back on the Web Audio clock (as renderer/audio/mouth.ts).
var actx=null,phead=0,live=[]
function ensureAudio(){try{if(!actx)actx=new (window.AudioContext||window.webkitAudioContext)({sampleRate:24000});if(actx.state==="suspended")actx.resume()}catch(e){actx=null}}
function playChunk(b64){if(!actx)return
  var bin=atob(b64),n=bin.length-(bin.length%2);if(n<2)return
  var buf=actx.createBuffer(1,n/2,24000),ch=buf.getChannelData(0)
  for(var i=0,j=0;i<n;i+=2,j++){var v=bin.charCodeAt(i)|(bin.charCodeAt(i+1)<<8);ch[j]=(v>32767?v-65536:v)/32768}
  var src=actx.createBufferSource();src.buffer=buf;src.connect(actx.destination)
  var now=actx.currentTime;if(phead<now)phead=now+0.08;src.start(phead);phead+=buf.duration
  live.push(src);src.onended=function(){var k=live.indexOf(src);if(k>=0)live.splice(k,1)}}
function stopAudio(){live.forEach(function(s){try{s.onended=null;s.stop()}catch(e){}});live=[];phead=0}
// Voice input with the browser's speech recognition (Chrome on Android, Safari 16.4+).
var SR=window.SpeechRecognition||window.webkitSpeechRecognition
if(SR){var mic=$("mic"),rec=null,listening=false
  mic.onclick=function(){ensureAudio();if(listening){rec&&rec.stop();return}
    rec=new SR();rec.lang="en-IN";rec.interimResults=true
    rec.onstart=function(){listening=true;mic.classList.add("on")}
    rec.onend=function(){listening=false;mic.classList.remove("on")}
    rec.onerror=function(){listening=false;mic.classList.remove("on")}
    rec.onresult=function(e){var s="";for(var i=0;i<e.results.length;i++)s+=e.results[i][0].transcript;$("cmd").value=s
      if(e.results[e.results.length-1].isFinal){rec.stop();sendCmd(s);$("cmd").value=""}}
    rec.start()}
}else{$("mic").hidden=true}
// Share contacts (Contact Picker, Chrome on Android): only the ones you pick, and only to your laptop.
if(navigator.contacts&&navigator.contacts.select){QUICK.push("Share contacts")
  var oldChips=chips;chips=function(){oldChips();var c=$("chips"),b=c.lastChild;b.onclick=function(){navigator.contacts.select(["name","tel"],{multiple:true}).then(function(cs){if(cs.length)return post("/contacts",{contacts:cs})}).catch(function(){row("ev","(couldn't read contacts)")})}}}
if(token)start()
if("serviceWorker" in navigator)navigator.serviceWorker.register("/sw.js").catch(function(){})
</script></body></html>`

export const PWA_MANIFEST = JSON.stringify({
  name: 'Orbi Remote',
  short_name: 'Orbi',
  start_url: '/',
  display: 'standalone',
  background_color: '#0E1013',
  theme_color: '#0E1013',
  icons: [{ src: '/icon.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'any maskable' }]
})

// Makes the app installable and shows the shell when offline. Never touches the live endpoints.
export const PWA_SERVICE_WORKER = /* js */ `const C='dw-v2'
self.addEventListener('install',e=>{e.waitUntil(caches.open(C).then(c=>c.add('/')));self.skipWaiting()})
self.addEventListener('activate',e=>e.waitUntil(caches.keys().then(ks=>Promise.all(ks.filter(k=>k!==C).map(k=>caches.delete(k)))).then(()=>self.clients.claim())))
self.addEventListener('fetch',e=>{if(e.request.mode==='navigate')e.respondWith(fetch(e.request).catch(()=>caches.match('/')))})`

export const PWA_ICON = /* svg */ `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512">
<rect width="512" height="512" rx="112" fill="#0E1013"/>
<circle cx="256" cy="256" r="150" fill="#121519" stroke="#7FD3E6" stroke-width="14"/>
<ellipse cx="216" cy="236" rx="20" ry="38" fill="#E6E8EB"/><ellipse cx="296" cy="236" rx="20" ry="38" fill="#E6E8EB"/>
<circle cx="256" cy="256" r="196" fill="none" stroke="#7FD3E6" stroke-width="8" opacity="0.4"/>
</svg>`

// Pairing codes are long random strings; anything else is refused before it reaches a room.
export const TOKEN_RE = /^[A-Za-z0-9_-]{32,128}$/
