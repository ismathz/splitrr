/**
 * Personal balance card HTML for Telegram widgets.
 * Fixed at send time; state lives in chat_data. Keep compressed ≤4KB.
 */
export const BALANCE_WIDGET_HTML = `<style>
*{box-sizing:border-box;margin:0;padding:0}
body{font:13px/1.35 system-ui,-apple-system,sans-serif;color:var(--tg-theme-text-color,#111);padding:10px 12px 12px;background:transparent}
h1{font:600 15px/1.2 system-ui;margin:0 0 2px}
.sub{opacity:.65;font-size:12px;margin-bottom:8px}
.sec{margin-top:8px}
.lbl{font-size:11px;opacity:.6;letter-spacing:.03em;text-transform:uppercase;margin:0 0 2px}
.row{display:flex;gap:8px;align-items:center;padding:7px 0;border-top:1px solid color-mix(in srgb,currentColor 14%,transparent)}
.meta{flex:1;min-width:0}
.n{font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.s{font-size:11px;opacity:.65;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.a{font-variant-numeric:tabular-nums;font-weight:600;white-space:nowrap}
button{appearance:none;border:0;border-radius:8px;padding:6px 9px;background:var(--tg-theme-button-color,#2481cc);color:var(--tg-theme-button-text-color,#fff);font:600 12px system-ui}
.empty{opacity:.65;padding:10px 0}
.err{color:#c62828;font-size:12px;margin-top:6px}
.spin{opacity:.5}
</style>
<div id=r></div>
<script>
(function(){
var W=window.TelegramWidget,root=document.getElementById('r'),rev=0,busy=0;
function money(c,a){return c+' '+(a/100).toFixed(2)}
function esc(s){return String(s).replace(/[&<>"']/g,function(ch){return({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch])})}
function link(bot,app,g,b){
  var p=btoa(unescape(encodeURIComponent(JSON.stringify({cid:String(g),bid:String(b)})))).replace(/\\+/g,'-').replace(/\\//g,'_').replace(/=+$/,'');
  return 'https://t.me/'+bot+'/'+app+'?startapp='+p;
}
function rows(list,bot,app){
  if(!list||!list.length)return '<div class=empty>None right now.</div>';
  return list.map(function(x){
    return '<div class=row><div class=meta><div class=n>'+esc(x.n)+'</div><div class=s>'+esc(x.l||'')+'</div></div><div class=a>'+esc(money(x.c,x.a))+'</div><button type=button data-g="'+esc(x.g)+'" data-b="'+esc(x.b)+'" data-bot="'+esc(bot)+'" data-app="'+esc(app)+'">Open</button></div>';
  }).join('');
}
function draw(d){
  if(!d||typeof d!=='object'){root.innerHTML='<div class=empty>No balance yet.</div>';return}
  if(typeof d.r==='number'&&d.r<rev)return;
  if(typeof d.r==='number')rev=d.r;
  var bot=d.bot||'SplitrrBot',app=d.app||'app';
  root.innerHTML='<h1>Your balance</h1><div class=sub>Across open Splitrr bills</div><div class=sec><div class=lbl>You owe</div>'+rows(d.owe,bot,app)+'</div><div class=sec><div class=lbl>Owes you</div>'+rows(d.owed,bot,app)+'</div><div id=e class=err></div>';
}
function apply(raw){
  if(!raw)return;
  try{draw(typeof raw==='string'?JSON.parse(raw):raw)}catch(e){}
}
function showErr(m){var e=document.getElementById('e');if(e)e.textContent=m||''}
function refresh(){
  if(busy||!W||typeof W.request!=='function')return;
  busy=1;root.classList.add('spin');
  W.request('r').then(function(a){
    busy=0;root.classList.remove('spin');
    if(a&&a.result)apply(a.result);
    showErr('');
  },function(err){
    busy=0;root.classList.remove('spin');
    showErr((err&&err.code)||'Could not refresh');
  });
}
root.onclick=function(ev){
  var t=ev.target;
  if(!t||t.tagName!=='BUTTON')return;
  var bot=t.getAttribute('data-bot'),app=t.getAttribute('data-app'),g=t.getAttribute('data-g'),b=t.getAttribute('data-b');
  if(!bot||!app||!g||!b||!W||typeof W.openTelegramLink!=='function')return;
  try{W.openTelegramLink(link(bot,app,g,b))}catch(e){showErr('Link unavailable')}
};
if(W){
  apply(W.chatData);
  W.onEvent&&W.onEvent('chatDataChanged',function(e){apply(e&&e.data!=null?e.data:W.chatData)});
  refresh();
  typeof W.ready==='function'&&W.ready();
}else{root.innerHTML='<div class=empty>Open in Telegram</div>'}
})();
</script>`;
