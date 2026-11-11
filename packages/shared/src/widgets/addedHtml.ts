/**
 * "You've been added" bill card HTML for Telegram widgets.
 * Mark paid via request; open Mini App / copy payment details on tap.
 */
export const ADDED_WIDGET_HTML = `<style>
*{box-sizing:border-box;margin:0;padding:0}
body{font:13px/1.35 system-ui,-apple-system,sans-serif;color:var(--tg-theme-text-color,#111);padding:10px 12px 12px;background:transparent}
h1{font:600 15px/1.2 system-ui;margin:0 0 2px}
.sub{opacity:.65;font-size:12px;margin-bottom:8px}
.share{font:600 20px/1.2 system-ui;font-variant-numeric:tabular-nums;margin:4px 0 8px}
.paid{color:#2e7d32}
ul{list-style:none;margin:0 0 10px}
li{display:flex;justify-content:space-between;gap:8px;padding:5px 0;border-top:1px solid color-mix(in srgb,currentColor 14%,transparent)}
li span:last-child{font-variant-numeric:tabular-nums;white-space:nowrap}
.acts{display:flex;flex-wrap:wrap;gap:8px;margin-top:4px}
button{appearance:none;border:0;border-radius:8px;padding:8px 12px;background:var(--tg-theme-button-color,#2481cc);color:var(--tg-theme-button-text-color,#fff);font:600 12px system-ui}
button.sec{background:color-mix(in srgb,var(--tg-theme-button-color,#2481cc) 18%,transparent);color:var(--tg-theme-text-color,#111)}
button:disabled{opacity:.5}
.err{color:#c62828;font-size:12px;margin-top:6px}
</style>
<div id=r></div>
<script>
(function(){
var W=window.TelegramWidget,root=document.getElementById('r'),rev=0,busy=0,state=null;
function money(c,a){return c+' '+(a/100).toFixed(2)}
function esc(s){return String(s).replace(/[&<>"']/g,function(ch){return({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch])})}
function link(d){
  var p=btoa(unescape(encodeURIComponent(JSON.stringify({cid:String(d.cid),bid:String(d.bid)})))).replace(/\\+/g,'-').replace(/\\//g,'_').replace(/=+$/,'');
  return 'https://t.me/'+(d.bot||'SplitrrBot')+'/'+(d.app||'app')+'?startapp='+p;
}
function draw(d){
  if(!d||typeof d!=='object'){root.innerHTML='<div class=sub>Bill update unavailable.</div>';return}
  if(typeof d.r==='number'&&d.r<rev)return;
  if(typeof d.r==='number')rev=d.r;
  state=d;
  var items=(d.items||[]).map(function(it){return '<li><span>'+esc(it.n)+'</span><span>'+esc(money(d.c,it.a))+'</span></li>'}).join('');
  var paid=d.paid===1;
  var btns='<div class=acts>';
  if(!paid)btns+='<button type=button id=pay>Mark as paid</button>';
  if(d.pay)btns+='<button type=button class=sec id=copy>Copy payment details</button>';
  btns+='<button type=button class=sec id=open>Open bill</button></div>';
  root.innerHTML='<h1>You\\'ve been added</h1><div class=sub>'+esc(d.t||'Bill')+'</div><div class="share'+(paid?' paid':'')+'">'+(paid?'Paid · ':'')+esc(money(d.c,d.s||0))+'</div><ul>'+(items||'<li><span>No assigned items</span><span></span></li>')+'</ul>'+btns+'<div id=e class=err></div>';
}
function apply(raw){
  if(!raw)return;
  try{draw(typeof raw==='string'?JSON.parse(raw):raw)}catch(e){}
}
function showErr(m){var e=document.getElementById('e');if(e)e.textContent=m||''}
root.onclick=function(ev){
  var t=ev.target;if(!t||t.tagName!=='BUTTON'||!state)return;
  if(t.id==='open'){
    if(W&&typeof W.openTelegramLink==='function'){try{W.openTelegramLink(link(state))}catch(e){showErr('Link unavailable')}}
    return;
  }
  if(t.id==='copy'){
    if(state.pay&&W&&typeof W.copyText==='function'){try{W.copyText(String(state.pay).slice(0,256))}catch(e){showErr('Copy failed')}}
    return;
  }
  if(t.id==='pay'){
    if(busy||!W||typeof W.request!=='function')return;
    busy=1;t.disabled=true;
    W.request('p:'+String(state.bid||'')).then(function(a){
      busy=0;
      if(a&&a.result){
        try{
          var res=typeof a.result==='string'?JSON.parse(a.result):a.result;
          if(res&&res.ok){state.paid=1;state.r=(state.r||0)+1;draw(state);showErr('');return}
          showErr((res&&res.e)||'Could not mark paid');
        }catch(e){showErr('Could not mark paid')}
      }else showErr('Could not mark paid');
      t.disabled=false;
    },function(err){busy=0;t.disabled=false;showErr((err&&err.code)||'Could not mark paid')});
  }
};
if(W){
  apply(W.chatData);
  W.onEvent&&W.onEvent('chatDataChanged',function(e){apply(e&&e.data!=null?e.data:W.chatData)});
  typeof W.ready==='function'&&W.ready();
}else{root.innerHTML='<div class=sub>Open in Telegram</div>'}
})();
</script>`;
