
(function(){
'use strict';
var app=document.getElementById('app');
var LS='kocokan-badminton-v1';
var DEF={mode:'double',drawBy:'games',courts:2,kok:2,courtFee:0,kokPrice:0,example:false,nextSeq:1,players:[],matches:[]};
var S=clone(DEF);
var RO=false, dbDoc=null, loaded=false;
var UI={tab:'main',arm:null,copyText:null,manualMode:null};

function clone(o){return JSON.parse(JSON.stringify(o));}
function normalize(d){var raw=clone(d||{}),o=Object.assign(clone(DEF),raw),players=Array.isArray(raw.players)?raw.players:[];if(typeof raw.kokPrice!=='number'){o.kokPrice=raw.tubeSize>0?(+raw.tubePrice||0)/raw.tubeSize:0;if(players.length)o.courtFee=(+raw.courtFee||0)/players.length;}delete o.tubePrice;delete o.tubeSize;delete o.split;if(!Array.isArray(o.players))o.players=[];if(!Array.isArray(o.matches))o.matches=[];if(['first','level','games'].indexOf(o.drawBy)<0)o.drawBy='games';o.players.forEach(function(p){if(['A','B','C','D','E'].indexOf(p.level)<0)p.level='C';p.kokUsed=Math.max(0,Math.floor(+p.kokUsed||0));});return o;}
var esc=function(s){return String(s).replace(/[&<>"']/g,function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c];});};
var uid=function(){return Math.random().toString(36).slice(2,8)+Date.now().toString(36).slice(-3);};
var rp=function(n){return 'Rp'+Math.round(n).toLocaleString('id-ID');};
var num=function(v){return +String(v).replace(/[^\d]/g,'')||0;};
var clamp=function(v,a,b){return Math.max(a,Math.min(b,v));};

/* ---------- persistence ---------- */
var saveTimer=null,saving=false,dirty=false,lastJson='';
function persist(){dirty=true;clearTimeout(saveTimer);saveTimer=setTimeout(flush,350);}
async function flush(){
  if(saving){saveTimer=setTimeout(flush,200);return;}
  if(!dirty)return;
  dirty=false;saving=true;
  var json=JSON.stringify(S);
  try{
    if(dbDoc){await dbDoc.set(JSON.parse(json));}
    else{try{localStorage.setItem(LS,json);}catch(e){}}
    lastJson=json;
  }catch(e){
    if(e&&(e.code==='invalid_argument'||e.code==='revoked'||e.code==='not_granted')){RO=true;toast('Perubahan tidak tersimpan: kamu hanya bisa melihat.');render();}
    else{toast('Gagal menyimpan, coba lagi.');dirty=true;}
  }finally{saving=false;if(dirty&&!RO)saveTimer=setTimeout(flush,1500);}
}
function toast(msg){
  var old=document.querySelector('.toast');if(old)old.remove();
  var t=document.createElement('div');t.className='toast';t.setAttribute('role','status');t.textContent=msg;document.body.appendChild(t);
  setTimeout(function(){t.remove();},2600);
}
var pendingRemote=false;
function softRender(){
  var a=document.activeElement;
  if(a&&app.contains(a)&&(a.tagName==='INPUT'||a.tagName==='SELECT')){pendingRemote=true;return;}
  render();
}
app.addEventListener('focusout',function(){if(pendingRemote){pendingRemote=false;setTimeout(render,50);}});

async function boot(){
  render();
  var db=null,user=null;
  try{db=(await (window.claude&&window.claude.use?window.claude.use('db'):null))||null;}catch(e){}
  try{user=(await (window.claude&&window.claude.use?window.claude.use('user'):null))||null;}catch(e){}
  if(user){try{if(user.canEdit&&user.canEdit()===false)RO=true;}catch(e){}}
  if(db){
    dbDoc=db.doc('app/state');
    dbDoc.onSnapshot(function(snap){
      loaded=true;
      if(!snap.exists){render();return;}
      var d=snap.data();var json=JSON.stringify(d);
      if(json===lastJson||dirty||saving){return;}
      S=normalize(d);lastJson=json;softRender();
    },function(){loaded=true;render();});
  }else{
    try{var raw=localStorage.getItem(LS);if(raw){S=normalize(JSON.parse(raw));lastJson=raw;}}catch(e){}
    loaded=true;render();
  }
}

/* ---------- derived data ---------- */
function stats(){
  var games=new Map(),last=new Map(),busy=new Set();
  S.matches.forEach(function(m){
    m.a.concat(m.b).forEach(function(id){
      games.set(id,(games.get(id)||0)+1);
      last.set(id,Math.max(last.has(id)?last.get(id):-1,m.seq));
      if(m.status==='playing')busy.add(id);
    });
  });
  return {games:games,last:last,busy:busy};
}
var eff=function(p,st){return (p.base||0)+(st.games.get(p.id)||0);};
function queue(st){
  var q=S.players.filter(function(p){return p.active&&!st.busy.has(p.id);});
  if(S.drawBy==='first')return q;
  return q.sort(function(x,y){
    return eff(x,st)-eff(y,st)||((st.last.has(x.id)?st.last.get(x.id):-1)-(st.last.has(y.id)?st.last.get(y.id):-1))||x.name.localeCompare(y.name);
  });
}
function money(st){
  var kokTotal=S.players.reduce(function(s,p){return s+(+p.kokUsed||0);},0);
  var kokCost=kokTotal*S.kokPrice;
  var bills={};
  S.players.forEach(function(p){
    bills[p.id]=S.courtFee+(+p.kokUsed||0)*S.kokPrice;
  });
  return {kokTotal:kokTotal,kokCost:kokCost,total:Object.keys(bills).reduce(function(sum,id){return sum+bills[id];},0),bills:bills};
}
function setMatchKok(m,value){
  var previous=+m.kok||0,next=clamp(value,0,20),delta=next-previous;
  m.kok=next;
  if(m.status==='done'&&delta){
    m.a.concat(m.b).forEach(function(playerId){
      var participant=S.players.find(function(x){return x.id===playerId;});
      if(participant)participant.kokUsed=Math.max(0,(+participant.kokUsed||0)+delta);
    });
  }
}

/* ---------- the draw ---------- */
function pairKey(x,y){return x<y?x+'|'+y:y+'|'+x;}
function shuffle(a){a=a.slice();for(var i=a.length-1;i>0;i--){var j=Math.floor(Math.random()*(i+1));var t=a[i];a[i]=a[j];a[j]=t;}return a;}
function generate(){
  var dbl=S.mode==='double',k=dbl?4:2;
  var st=stats();
  var used={};S.matches.forEach(function(m){if(m.status==='playing')used[m.court]=1;});
  var free=[];for(var c=1;c<=S.courts;c++)if(!used[c])free.push(c);
  if(!free.length)return 'Semua lapangan sedang dipakai. Selesaikan satu pertandingan dulu.';
  var pool=S.players.filter(function(p){return p.active&&!st.busy.has(p.id);});
  var m=Math.min(free.length,Math.floor(pool.length/k));
  if(m<1)return 'Butuh minimal '+k+' pemain aktif yang sedang menunggu ('+(dbl?'double':'single')+').';
  var info=pool.map(function(p,i){return {id:p.id,g:eff(p,st),l:st.last.has(p.id)?st.last.get(p.id):-1,i:i,r:Math.random()};});
  if(S.drawBy==='first')info.sort(function(x,y){return x.i-y.i;});
  else info.sort(function(x,y){return x.g-y.g||x.l-y.l||x.r-y.r;});
  var chosen=info.slice(0,m*k).map(function(x){return x.id;});
  var pc={},oc={};
  S.matches.forEach(function(mt){
    if(mt.a.length===2){pc[pairKey(mt.a[0],mt.a[1])]=(pc[pairKey(mt.a[0],mt.a[1])]||0)+1;pc[pairKey(mt.b[0],mt.b[1])]=(pc[pairKey(mt.b[0],mt.b[1])]||0)+1;}
    mt.a.forEach(function(x){mt.b.forEach(function(y){oc[pairKey(x,y)]=(oc[pairKey(x,y)]||0)+1;});});
  });
  var cnt=function(o,x,y){return o[pairKey(x,y)]||0;};
  var playerLevel=function(id){var p=PM.get(id);return 5-(['A','B','C','D','E'].indexOf(p&&p.level)>=0?['A','B','C','D','E'].indexOf(p.level):2);};
  function split(g){
    if(!dbl){return {a:[g[0]],b:[g[1]],c:(S.drawBy==='level'?1000*Math.abs(playerLevel(g[0])-playerLevel(g[1])):0)+3*cnt(oc,g[0],g[1])};}
    var opts=[[[g[0],g[1]],[g[2],g[3]]],[[g[0],g[2]],[g[1],g[3]]],[[g[0],g[3]],[g[1],g[2]]]],best=null;
    opts.forEach(function(o){
      var a=o[0],b=o[1],c=5*(cnt(pc,a[0],a[1])+cnt(pc,b[0],b[1]));
      a.forEach(function(x){b.forEach(function(y){c+=cnt(oc,x,y);});});
      if(S.drawBy==='level')c+=1000*Math.abs(playerLevel(a[0])+playerLevel(a[1])-playerLevel(b[0])-playerLevel(b[1]));
      c+=Math.random()*.5;
      if(!best||c<best.c)best={a:a,b:b,c:c};
    });
    return best;
  }
  var bestPlan=null;
  for(var it=0;it<400;it++){
    var perm=shuffle(chosen),plan=[],tot=0;
    for(var i=0;i<m;i++){var s=split(perm.slice(i*k,(i+1)*k));plan.push(s);tot+=s.c;}
    if(!bestPlan||tot<bestPlan.tot)bestPlan={plan:plan,tot:tot};
  }
  bestPlan.plan.forEach(function(s,i){
    S.matches.push({id:uid(),seq:S.nextSeq++,court:free[i],a:s.a,b:s.b,kok:S.kok,status:'playing'});
  });
  persist();
  return m+' pertandingan dikocok.';
}

/* ---------- views ---------- */
function icon(){return '<svg width="44" height="44" viewBox="0 0 44 44" fill="none" stroke="currentColor" stroke-width="2.5" aria-hidden="true"><rect x="3" y="9" width="38" height="26" rx="2"/><path d="M22 9v26M3 22h38M12 9v26M32 9v26" stroke-width="1.5"/></svg>';}
function header(st){
  var act=S.players.filter(function(p){return p.active;}).length;
  var pl=S.matches.filter(function(m){return m.status==='playing';}).length;
  var kt=S.players.reduce(function(s,p){return s+(+p.kokUsed||0);},0);
  var d=new Date().toLocaleDateString('id-ID',{weekday:'long',day:'numeric',month:'long',year:'numeric'});
  return '<header class="top"><div class="brand">'+icon()+'<div><h1>Kocokan Badminton</h1><p>'+esc(d)+'</p></div></div>'+
    '<div class="stats"><div class="stat"><b>'+act+'</b><span>Pemain aktif</span></div><div class="stat"><b>'+pl+'</b><span>Sedang main</span></div><div class="stat"><b>'+kt+'</b><span>Kok terpakai</span></div></div></header>'+
    '<div class="tabs" role="tablist">'+tabBtn('main','Kocok')+tabBtn('pay','Peserta &amp; bayar')+tabBtn('hist','Riwayat')+'</div>';
}
function tabBtn(id,label){return '<button class="tab" role="tab" data-act="tab" data-id="'+id+'" aria-selected="'+(UI.tab===id)+'">'+label+'</button>';}
function stepper(act,id,val,aria){
  return '<span class="step" role="group" aria-label="'+aria+'"><button type="button" data-act="'+act+'" data-id="'+id+'" data-d="-1" aria-label="Kurangi">−</button><output>'+val+'</output><button type="button" data-act="'+act+'" data-id="'+id+'" data-d="1" aria-label="Tambah">+</button></span>';
}
function addForm(){
  return '<form data-form="add" class="card"><div class="sec-h"><h2>Tambah peserta</h2><span class="muted small">Boleh banyak sekaligus, pisahkan dengan koma</span></div>'+
    '<div class="row"><input type="text" id="newName" name="names" placeholder="Contoh: Budi, Sari, Andi" autocomplete="off" aria-label="Nama peserta"><button class="btn primary" type="submit">Tambah</button></div>'+
    '<div class="ctl" style="margin-top:.7rem"><label style="text-transform:none;letter-spacing:0;font-size:.88rem;display:flex;gap:.5rem;align-items:center"><input type="radio" name="join" value="catch" checked> Datang telat: prioritas main sampai setara</label>'+
    '<label style="text-transform:none;letter-spacing:0;font-size:.88rem;display:flex;gap:.5rem;align-items:center"><input type="radio" name="join" value="equal"> Mulai dari rata-rata main</label></div></form>';
}
function exampleNote(){
  if(!S.example)return '';
  return '<div class="note"><p>Ini data contoh supaya kamu bisa lihat cara kerjanya. Hapus untuk mulai dari kosong.</p>'+(RO?'':'<button class="btn sm" data-act="clearall" data-id="x">Hapus data contoh</button>')+'</div>';
}
function courtCard(c,m){
  if(!m)return '<article class="slot empty"><div class="slot-h"><h3>Lapangan '+c+'</h3><span>Kosong</span></div><p style="margin:0">Tekan Kocok untuk mengisi lapangan ini.</p></article>';
  var side=function(ids){return ids.map(function(id){return '<span class="pl">'+esc(nm(id))+'</span>';}).join('');};
  return '<article class="slot"><div class="slot-h"><h3>Lapangan '+c+'</h3><span>Main ke-'+m.seq+'</span></div>'+
    '<div class="court'+(m.a.length===1?' single':'')+'"><span class="sl" style="left:30%"></span><span class="sl" style="left:70%"></span><span class="tm a">A</span><span class="tm b">B</span><div class="half">'+side(m.a)+'</div><div class="half">'+side(m.b)+'</div></div>'+
    '<div class="slot-f"><div class="kok"><span class="lbl">Kok pertandingan</span>'+(RO?'<b class="num">'+m.kok+'</b>':stepper('kok',m.id,m.kok,'Jumlah kok pertandingan'))+'</div>'+
    (RO?'':'<div class="acts"><button class="btn sm warn'+(UI.arm==='cancel:'+m.id?' armed':'')+'" data-act="cancel" data-id="'+m.id+'">'+(UI.arm==='cancel:'+m.id?'Yakin batal?':'Batalkan')+'</button><button class="btn sm primary" data-act="done" data-id="'+m.id+'">Selesai</button></div>')+'</div></article>';
}
var PM=new Map();
function nm(id){var p=PM.get(id);return p?p.name:'(dihapus)';}
function viewMain(st){
  var out='';
  if(RO)out+='<div class="note"><p>Kamu melihat halaman ini tanpa hak ubah. Data diperbarui otomatis saat penyelenggara mengocok.</p></div>';
  out+=exampleNote();
  if(!S.players.length){
    out+='<div class="card empty-state"><h2>Belum ada peserta</h2><p>Masukkan nama pemain yang sudah datang. Setelah peserta ditambahkan, admin bisa memilih kocokan berdasarkan urutan datang, level, atau jumlah main.</p>'+(RO?'':'<button class="btn" data-act="seed">Isi 8 peserta contoh</button>')+'</div>';
    if(!RO)out+=addForm();
    return out;
  }
  var k=S.mode==='double'?4:2;
  var q=queue(st);
  var usedC={};S.matches.forEach(function(m){if(m.status==='playing')usedC[m.court]=m;});
  var freeN=0;for(var c=1;c<=S.courts;c++)if(!usedC[c])freeN++;
  var nextN=Math.min(freeN,Math.floor(q.length/k))*k;
  if(!RO){
    out+='<section class="card"><div class="ctl"><div class="f"><span class="lbl">Jenis pertandingan</span><div class="seg" role="group" aria-label="Jenis pertandingan"><button type="button" data-act="mode" data-id="single" aria-pressed="'+(S.mode==='single')+'">Single</button><button type="button" data-act="mode" data-id="double" aria-pressed="'+(S.mode==='double')+'">Double</button></div></div>'+
      '<div class="f"><span class="lbl">Jumlah lapangan</span>'+stepper('courts','c',S.courts,'Jumlah lapangan')+'</div>'+
      '<div class="f"><span class="lbl">Kok setiap main</span>'+stepper('kokdef','k',S.kok,'Kok setiap main')+'</div>'+
      '<div class="f"><label class="lbl" for="drawBy">Prioritas kocokan</label><select id="drawBy" data-f="drawBy"><option value="first"'+(S.drawBy==='first'?' selected':'')+'>Urutan datang</option><option value="level"'+(S.drawBy==='level'?' selected':'')+'>Level seimbang</option><option value="games"'+(S.drawBy==='games'?' selected':'')+'>Jumlah main merata</option></select></div></div>'+
      '<div class="go"><button class="btn primary big" data-act="gen">Kocok pertandingan</button><span class="muted small">'+(S.drawBy==='first'?'Peserta diturunkan sesuai urutan ditambahkan.':S.drawBy==='level'?'Level A tertinggi, E terendah. Level serupa dipasangkan (single) atau diseimbangkan antartim (double); giliran tetap diprioritaskan untuk yang mainnya sedikit.':'Pemain yang jumlah mainnya paling sedikit dan paling lama istirahat diprioritaskan.')+'</span></div></section>';
  }
  out+='<section><div class="sec-h"><h2>Lapangan</h2><span class="muted small">'+(S.mode==='double'?'Double: 2 lawan 2':'Single: 1 lawan 1')+'</span></div><div class="courts">';
  for(var i=1;i<=S.courts;i++)out+=courtCard(i,usedC[i]);
  out+='</div></section>';
  var act=S.players.filter(function(p){return p.active;});
  var vals=act.map(function(p){return eff(p,st);});
  var spread=vals.length?Math.max.apply(null,vals)-Math.min.apply(null,vals):0;
  out+='<section class="card"><div class="sec-h"><h2>Menunggu giliran</h2><span class="fair"><i class="dot'+(spread>1?' mid':'')+'"></i>'+(spread<=1?'Jumlah main merata':'Selisih main '+spread+', yang sedikit diprioritaskan')+'</span></div>';
  if(!q.length)out+='<p class="muted" style="margin:0">Semua pemain aktif sedang di lapangan.</p>';
  else{
    var matrixMatches=S.matches.slice().sort(function(a,b){return a.seq-b.seq;});
    var predictedGames=Math.ceil(nextN/k),lastSeq=matrixMatches.reduce(function(max,match){return Math.max(max,+match.seq||0);},0);
    var nextSeq=Math.max(+S.nextSeq||1,lastSeq+1),columns=matrixMatches.length+predictedGames;
    out+='<div class="queue-scroll"><table class="queue-table"><thead><tr><th class="queue-name-head" rowspan="2">Peserta</th><th class="queue-games-head" rowspan="2">Jumlah Main</th><th colspan="'+columns+'">Main Ke (Kok)</th></tr><tr>'+
      matrixMatches.map(function(match){return '<th scope="col">'+match.seq+'</th>';}).join('')+
      Array.from({length:predictedGames},function(_,i){return '<th scope="col">'+(nextSeq+i)+'</th>';}).join('')+
      '</tr></thead><tbody>'+act.map(function(p){
        var cells=matrixMatches.map(function(match){
          var played=match.a.concat(match.b).indexOf(p.id)>=0;
          return '<td>'+ (played?esc(match.kok):'')+'</td>';
        }).join('');
        var forecast=Array.from({length:predictedGames},function(_,i){
          var willPlay=q.slice(i*k,(i+1)*k).some(function(waiting){return waiting.id===p.id;});
          return '<td class="'+(willPlay?'queue-next':'')+'"'+(willPlay?' aria-label="Diprioritaskan pada partai '+(nextSeq+i)+'"':'')+'></td>';
        }).join('');
        return '<tr><th scope="row" class="queue-player">'+esc(p.name)+'</th><td class="queue-games">'+(st.games.get(p.id)||0)+'</td>'+cells+forecast+'</tr>';
      }).join('')+'</tbody></table></div>'+
      '<p class="muted small" style="margin:.7rem 0 0">'+(predictedGames?'Sel berwarna toska menandai perkiraan giliran berikutnya. ':'')+'Angka di setiap kolom menunjukkan jumlah kok yang dipakai pemain pada partai tersebut.</p>';
  }
  out+='</section>';
  return out;
}
function payState(p,bill){
  if(!bill)return ['none','Belum ada tagihan'];
  var paid=p.paid||0;
  if(paid>=bill)return ['ok','Lunas'];
  if(paid>0)return ['mid','Kurang '+rp(bill-paid)];
  return ['bad','Belum bayar'];
}
function viewPay(st){
  var mo=money(st),out='';
  if(RO)out+='<div class="note"><p>Mode lihat saja.</p></div>';
  out+=exampleNote();
  if(!RO)out+=addForm();
  var collected=S.players.reduce(function(s,p){return s+(p.paid||0);},0);
  var owed=S.players.reduce(function(s,p){return s+Math.max(0,(mo.bills[p.id]||0)-(p.paid||0));},0);
  out+='<section class="card"><div class="sec-h"><h2>Biaya</h2><span class="muted small">Setiap peserta membayar lapangan + kok yang dipakainya</span></div><div class="fees">'+
    feeField('courtFee','Biaya lapangan per peserta',S.courtFee,'rp')+feeField('kokPrice','Harga kok per biji',S.kokPrice,'rp')+'</div>'+
    '<p class="calc"><span>Kok peserta: <b>'+mo.kokTotal+'</b> biji ('+rp(mo.kokCost)+')</span><span>Lapangan: <b>'+rp(S.courtFee)+'</b> per peserta</span><span>Total seluruh tagihan: <b>'+rp(mo.total)+'</b></span></p></section>';
  out+='<div class="tiles"><div class="tile"><b>'+rp(mo.total)+'</b><span>Total biaya</span></div><div class="tile"><b>'+rp(collected)+'</b><span>Sudah terkumpul</span></div><div class="tile"><b>'+rp(owed)+'</b><span>Belum masuk</span></div><div class="tile"><b>'+S.players.length+'</b><span>Peserta</span></div></div>';
  var maxG=Math.max(1,Math.max.apply(null,S.players.map(function(p){return st.games.get(p.id)||0;}).concat([1])));
  out+='<section class="card"><div class="sec-h"><h2>Daftar peserta</h2><span class="muted small">Atur level (A tertinggi) dan jumlah kok tiap pemain</span>'+(S.players.length?'<button class="btn sm" data-act="copy">Salin rekap untuk WhatsApp</button>':'')+'</div><p class="muted small" style="margin:0 0 .6rem">Isi kolom Kok (biji) untuk menghitung biaya kok masing-masing pemain. Kok pertandingan di lapangan hanya catatan pertandingan.</p>';
  if(UI.copyText!==null)out+='<p class="muted small" style="margin:0 0 .4rem">Salin otomatis tidak didukung di sini. Blok teks di bawah lalu salin.</p><textarea class="copybox" id="copyBox" readonly>'+esc(UI.copyText)+'</textarea>';
  if(!S.players.length)out+='<p class="muted" style="margin:0">Belum ada peserta.</p>';
  else{
    out+='<div class="plist"><div class="phead"><span>Nama</span><span>Main</span><span>Level</span><span>Kok (biji)</span><span>Tagihan</span><span>Dibayar</span><span></span></div>';
    S.players.forEach(function(p){
      var g=st.games.get(p.id)||0,bill=mo.bills[p.id]||0,ps=payState(p,bill);
      var delOk=g===0,armed=UI.arm==='remove:'+p.id;
      out+='<div class="prow"><div class="pname"><strong>'+esc(p.name)+'</strong><span class="st '+ps[0]+'">'+esc(ps[1])+'</span>'+(p.active?'':'<span class="muted small">Istirahat / pulang</span>')+'</div>'+
        '<div class="bar"><span>'+g+'</span><i style="width:'+Math.round(g/maxG*44)+'px"></i></div>'+
        '<div><select data-f="level" data-id="'+p.id+'" aria-label="Level '+esc(p.name)+'"'+(RO?' disabled':'')+'>'+['A','B','C','D','E'].map(function(level){return '<option value="'+level+'"'+((p.level||'C')===level?' selected':'')+'>'+level+'</option>';}).join('')+'</select></div>'+
        '<div class="paidin kok-used"><input type="text" inputmode="numeric" data-f="kokUsed" data-id="'+p.id+'" value="'+(p.kokUsed||0)+'" aria-label="Jumlah kok yang dipakai '+esc(p.name)+'"'+(RO?' disabled':'')+'><span>biji</span></div>'+
        '<div class="num">'+rp(bill)+'</div>'+
        '<div class="paidin"><span>Rp</span><input type="text" inputmode="numeric" data-f="paid" data-id="'+p.id+'" value="'+(p.paid||0)+'" aria-label="Dibayar oleh '+esc(p.name)+'"'+(RO?' disabled':'')+'></div>'+
        (RO?'<div></div>':'<div class="pacts"><button class="btn sm primary" data-act="paidfull" data-id="'+p.id+'"'+(bill?'':' disabled')+'>Lunas</button><button class="btn sm" data-act="toggle" data-id="'+p.id+'">'+(p.active?'Istirahat':'Aktifkan')+'</button>'+(delOk?'<button class="btn sm warn'+(armed?' armed':'')+'" data-act="remove" data-id="'+p.id+'">'+(armed?'Yakin?':'Hapus')+'</button>':'')+'</div>')+'</div>';
    });
    out+='</div>';
  }
  out+='</section>';
  return out;
}
function feeField(f,label,val,pre){
  return '<div class="f"><label class="lbl" for="fee_'+f+'">'+label+'</label><div class="paidin">'+(pre?'<span>Rp</span>':'')+'<input type="text" inputmode="numeric" id="fee_'+f+'" data-f="'+f+'" value="'+val+'"'+(RO?' disabled':'')+'></div></div>';
}
function manualMatchForm(){
  var mode=UI.manualMode||S.mode,k=mode==='double'?4:2;
  var out='<section class="card"><div class="sec-h"><h2>Catat pertandingan manual</h2><span class="muted small">Untuk pertandingan yang sudah dimainkan sebelum admin mencatatnya</span></div>';
  var options='<option value="">Pilih peserta</option>'+S.players.map(function(p){return '<option value="'+esc(p.id)+'">'+esc(p.name)+'</option>';}).join('');
  out+='<form data-form="manual"><div class="ctl"><div class="f"><label class="lbl" for="manualMode">Jenis pertandingan</label><select id="manualMode" name="mode" data-f="manualMode"><option value="single"'+(mode==='single'?' selected':'')+'>Single</option><option value="double"'+(mode==='double'?' selected':'')+'>Double</option></select></div>'+
    '<div class="f"><label class="lbl" for="manualCourt">Lapangan</label><input type="number" id="manualCourt" name="court" min="1" max="8" value="1" required></div>'+
    '<div class="f"><label class="lbl" for="manualKok">Kok pertandingan</label><input type="number" id="manualKok" name="kok" min="0" max="20" value="'+S.kok+'" required></div></div>';
  if(S.players.length<k)return out+'<p class="muted" style="margin:.7rem 0 0">Mode '+(mode==='double'?'double membutuhkan 4':'single membutuhkan 2')+' peserta. Tambahkan peserta atau pilih mode lain.</p></form></section>';
  out+='<div class="manual-sides">'+
    '<div class="manual-team"><span class="lbl">Tim A</span><select name="a1" aria-label="Pemain pertama tim A" required>'+options+'</select>'+(mode==='double'?'<select name="a2" aria-label="Pemain kedua tim A" required>'+options+'</select>':'')+'</div>'+
    '<div class="manual-team"><span class="lbl">Tim B</span><select name="b1" aria-label="Pemain pertama tim B" required>'+options+'</select>'+(mode==='double'?'<select name="b2" aria-label="Pemain kedua tim B" required>'+options+'</select>':'')+'</div></div>'+
    '<div class="go"><button class="btn primary" type="submit">Simpan pertandingan selesai</button><span class="muted small">Jumlah kok akan otomatis masuk ke peserta dan tagihan.</span></div></form></section>';
  return out;
}
function viewHist(){
  var out='';
  if(RO)out+='<div class="note"><p>Mode lihat saja.</p></div>';
  out+=exampleNote();
  var ms=S.matches.slice().sort(function(a,b){return b.seq-a.seq;});
  if(!RO)out+=manualMatchForm();
  out+='<section class="card"><div class="sec-h"><h2>Riwayat main</h2><span class="muted small">'+ms.length+' pertandingan</span></div>';
  if(!ms.length)out+='<p class="muted" style="margin:0">Belum ada pertandingan yang tercatat.</p>';
  else ms.forEach(function(m){
    var A=m.a.map(function(i){return esc(nm(i));}).join(' &amp; '),B=m.b.map(function(i){return esc(nm(i));}).join(' &amp; ');
    out+='<div class="hrow"><span class="hno">#'+m.seq+'</span><span class="st '+(m.status==='playing'?'mid':'ok')+'">'+(m.status==='playing'?'Main · Lap '+m.court:'Selesai · Lap '+m.court)+'</span>'+
      '<span class="vs"><strong>'+A+'</strong><em>lawan</em><strong>'+B+'</strong></span>'+
      '<span class="kok"><span class="lbl">Kok pertandingan</span>'+(RO?'<b class="num">'+m.kok+'</b>':stepper('kok',m.id,m.kok,'Jumlah kok pertandingan'))+'</span></div>';
  });
  out+='</section>';
  if(!RO)out+='<section class="card"><div class="sec-h"><h2>Mulai ulang</h2></div><div class="acts"><button class="btn warn'+(UI.arm==='newsession:x'?' armed':'')+'" data-act="newsession" data-id="x">'+(UI.arm==='newsession:x'?'Yakin? Riwayat &amp; pembayaran dihapus':'Sesi baru (peserta tetap)')+'</button><button class="btn warn'+(UI.arm==='newattendees:x'?' armed':'')+'" data-act="newattendees" data-id="x">'+(UI.arm==='newattendees:x'?'Yakin? Peserta &amp; riwayat dihapus':'Sesi baru (ganti peserta)')+'</button><button class="btn warn'+(UI.arm==='clearall:x'?' armed':'')+'" data-act="clearall" data-id="x">'+(UI.arm==='clearall:x'?'Yakin? Semua dihapus':'Reset semua pengaturan')+'</button></div><p class="muted small" style="margin:.7rem 0 0">Sesi baru menghapus riwayat dan pembayaran. Pilih “ganti peserta” jika daftar pemain yang datang berubah; pengaturan lapangan dan biaya tetap. Reset semua pengaturan mengembalikan semuanya ke setelan awal.</p></section>';
  return out;
}
function render(){
  PM=new Map(S.players.map(function(p){return [p.id,p];}));
  var st=stats();
  app.innerHTML=header(st)+'<main role="tabpanel">'+(UI.tab==='pay'?viewPay(st):UI.tab==='hist'?viewHist():viewMain(st))+'</main>';
}

/* ---------- actions ---------- */
function addPlayers(raw,catchUp){
  var names=raw.split(/[,\n]+/).map(function(s){return s.trim();}).filter(Boolean);
  if(!names.length){toast('Tulis nama dulu.');return;}
  var st=stats(),act=S.players.filter(function(p){return p.active;});
  var avg=act.length?Math.round(act.reduce(function(s,p){return s+eff(p,st);},0)/act.length):0;
  names.forEach(function(n){S.players.push({id:uid(),name:n,active:true,paid:0,base:catchUp?0:avg,level:'C',kokUsed:0});});
  persist();render();
  var inp=document.getElementById('newName');if(inp)inp.focus();
  toast(names.length+' peserta ditambahkan.'+(catchUp&&S.matches.length?' Mereka diprioritaskan sampai jumlah mainnya setara.':''));
}
function recap(st){
  var mo=money(st);
  var d=new Date().toLocaleDateString('id-ID',{weekday:'long',day:'numeric',month:'long',year:'numeric'});
  var l=['Rekap badminton, '+d,'Lapangan per peserta: '+rp(S.courtFee),'Harga kok per biji: '+rp(S.kokPrice),'Total tagihan: '+rp(mo.total),'','Tagihan per orang:'];
  S.players.forEach(function(p,i){var b=mo.bills[p.id]||0,s=payState(p,b),kokCost=(+p.kokUsed||0)*S.kokPrice;l.push((i+1)+'. '+p.name+': Lapangan '+rp(S.courtFee)+' + '+(p.kokUsed||0)+' kok ('+rp(kokCost)+') = '+rp(b)+' ('+(s[0]==='none'?'-':s[1])+')');});
  return l.join('\n');
}
var MUT={tab:0,copy:0};
app.addEventListener('click',function(e){
  var b=e.target.closest('[data-act]');if(!b)return;
  var act=b.dataset.act,id=b.dataset.id,d=+b.dataset.d||0;
  if(RO&&!(act in MUT))return;
  var key=act+':'+id,armedActs={cancel:1,remove:1,newsession:1,newattendees:1,clearall:1};
  if(armedActs[act]){
    if(UI.arm!==key){UI.arm=key;render();setTimeout(function(){if(UI.arm===key){UI.arm=null;render();}},4000);return;}
    UI.arm=null;
  }else UI.arm=null;
  var m;
  switch(act){
    case 'tab':UI.tab=id;UI.copyText=null;render();window.scrollTo(0,0);return;
    case 'mode':S.mode=id;break;
    case 'courts':S.courts=clamp(S.courts+d,1,8);break;
    case 'kokdef':S.kok=clamp(S.kok+d,0,10);break;
    case 'gen':{var msg=generate();render();toast(msg);return;}
    case 'kok':m=S.matches.find(function(x){return x.id===id;});if(m)setMatchKok(m,(+m.kok||0)+d);break;
    case 'done':
      m=S.matches.find(function(x){return x.id===id;});
      if(m&&m.status!=='done'){
        m.a.concat(m.b).forEach(function(playerId){
          var participant=S.players.find(function(x){return x.id===playerId;});
          if(participant)participant.kokUsed=(+participant.kokUsed||0)+(+m.kok||0);
        });
        m.status='done';
        toast('Pertandingan selesai. '+m.kok+' kok ditambahkan ke setiap pemain.');
      }
      break;
    case 'cancel':S.matches=S.matches.filter(function(x){return x.id!==id;});toast('Pertandingan dibatalkan. Pemainnya kembali ke antrean.');break;
    case 'toggle':var p=S.players.find(function(x){return x.id===id;});if(p)p.active=!p.active;break;
    case 'remove':S.players=S.players.filter(function(x){return x.id!==id;});break;
    case 'paidfull':{var pp=S.players.find(function(x){return x.id===id;});var bill=money(stats()).bills[id]||0;if(pp)pp.paid=bill;break;}
    case 'seed':seed();break;
    case 'newsession':S.matches=[];S.nextSeq=1;S.example=false;S.players.forEach(function(x){x.paid=0;x.base=0;x.kokUsed=0;});break;
    case 'newattendees':S.matches=[];S.nextSeq=1;S.example=false;S.players=[];UI.tab='main';UI.copyText=null;toast('Sesi baru dimulai. Tambahkan peserta yang datang.');break;
    case 'clearall':S=clone(DEF);break;
    case 'copy':{
      var text=recap(stats());
      try{
        navigator.clipboard.writeText(text).then(function(){toast('Rekap disalin.');},function(){UI.copyText=text;render();});
      }catch(err){UI.copyText=text;render();}
      return;
    }
  }
  persist();render();
});
app.addEventListener('change',function(e){
  var t=e.target,f=t.dataset.f;if(!f||RO)return;
  if(f==='paid'){var p=S.players.find(function(x){return x.id===t.dataset.id;});if(p)p.paid=num(t.value);}
  else if(f==='manualMode'){UI.manualMode=t.value==='single'?'single':'double';render();return;}
  else if(f==='drawBy'){S.drawBy=['first','level','games'].indexOf(t.value)>=0?t.value:'games';}
  else if(f==='level'){var player=S.players.find(function(x){return x.id===t.dataset.id;});if(player&&['A','B','C','D','E'].indexOf(t.value)>=0)player.level=t.value;}
  else if(f==='kokUsed'){var participant=S.players.find(function(x){return x.id===t.dataset.id;});if(participant)participant.kokUsed=num(t.value);}
  else{S[f]=num(t.value);}
  persist();render();
});
app.addEventListener('submit',function(e){
  e.preventDefault();if(RO)return;
  if(e.target.dataset.form==='manual'){
    var manualData=new FormData(e.target),mode=manualData.get('mode')==='single'?'single':'double';
    var a=[String(manualData.get('a1')||'')],b=[String(manualData.get('b1')||'')];
    if(mode==='double'){a.push(String(manualData.get('a2')||''));b.push(String(manualData.get('b2')||''));}
    var playerIds=a.concat(b),kok=Number(manualData.get('kok')),court=Number(manualData.get('court'));
    if(playerIds.some(function(id){return !id||!S.players.some(function(p){return p.id===id;});})||new Set(playerIds).size!==playerIds.length){toast('Pilih peserta yang berbeda untuk setiap posisi.');return;}
    if(!Number.isInteger(kok)||kok<0||kok>20||!Number.isInteger(court)||court<1||court>8){toast('Periksa kembali jumlah kok dan nomor lapangan.');return;}
    var maxSeq=S.matches.reduce(function(max,match){return Math.max(max,+match.seq||0);},0);
    S.nextSeq=Math.max(+S.nextSeq||1,maxSeq+1);
    var match={id:uid(),seq:S.nextSeq++,court:court,a:a,b:b,kok:kok,status:'done'};
    S.matches.push(match);
    playerIds.forEach(function(playerId){
      var participant=S.players.find(function(p){return p.id===playerId;});
      participant.kokUsed=(+participant.kokUsed||0)+kok;
    });
    persist();render();toast('Pertandingan selesai dicatat. '+kok+' kok ditambahkan ke setiap pemain.');return;
  }
  var fd=new FormData(e.target);
  addPlayers(String(fd.get('names')||''),fd.get('join')!=='equal');
});
function seed(){
  var names=['Budi','Sari','Andi','Dewi','Rizky','Putri','Hendra','Maya'];
  S=clone(DEF);S.example=true;S.courtFee=20000;S.kokPrice=3500;
  S.players=names.map(function(n,i){return {id:uid(),name:n,active:true,paid:0,base:0,level:['A','B','C','D','E','A','B','C'][i],kokUsed:0};});
  var I=function(n){return S.players[names.indexOf(n)].id;};
  var rounds=[[['Budi','Sari'],['Andi','Dewi']],[['Rizky','Putri'],['Hendra','Maya']],[['Budi','Rizky'],['Dewi','Maya']],[['Andi','Hendra'],['Sari','Putri']]];
  rounds.forEach(function(r,i){S.matches.push({id:uid(),seq:i+1,court:(i%2)+1,a:r[0].map(I),b:r[1].map(I),kok:2,status:i<2?'done':'playing'});});
  S.nextSeq=5;
}
boot();
})();
