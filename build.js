'use strict';
var fs = require('fs');
var path = require('path');

var TPL = path.join(__dirname, 'template');
var OUT = path.join(__dirname, 'public');
var PERIODS = [["凌晨1",0,120],["凌晨2",120,240],["凌晨3",240,360],["早餐1",360,480],["早餐2",480,630],["午高峰",630,810],["下午茶1",810,930],["下午茶2",930,1050],["晚高峰",1050,1200],["夜宵1",1200,1320],["夜宵2",1320,1440]];
var STANDARDS = {
  "凌晨1":{优选:[90,2],蜂跑:[90,2],优远:[90,1]},"凌晨2":{优选:[90,2],蜂跑:[90,2],优远:[90,1]},
  "凌晨3":{优选:[90,2],蜂跑:[90,2],优远:[90,1]},"早餐1":{优选:[90,2],蜂跑:[90,2],优远:[90,1]},
  "早餐2":{优选:[120,2],蜂跑:[120,3],优远:[120,1]},"午高峰":{优选:[150,5],蜂跑:[150,8],优远:[150,3]},
  "下午茶1":{优选:[90,2],蜂跑:[90,3],优远:[90,1]},"下午茶2":{优选:[90,2],蜂跑:[90,3],优远:[90,1]},
  "晚高峰":{优选:[120,4],蜂跑:[120,6],优远:[120,2]},"夜宵1":{优选:[90,3],蜂跑:[90,3],优远:[90,1]},
  "夜宵2":{优选:[90,2],蜂跑:[90,2],优远:[90,1]}
};
function pIdx(n){ for(var i=0;i<PERIODS.length;i++) if(PERIODS[i][0]===n) return i; return -1; }
function pStart(n){ var i=pIdx(n); return i<0?0:PERIODS[i][1]; }
function pEnd(n){ var i=pIdx(n); return i<0?1440:PERIODS[i][2]; }
function stdFor(p,ydl){ var s=STANDARDS[p]; if(!s) return [0,0]; return s[ydl]||s["优选"]||[0,0]; }
function hms(min){ min=Math.max(0,Math.floor(min||0)); var h=Math.floor(min/60), m=min%60; return h+':'+(m<10?'0'+m:m)+':00'; }
function nowMinFromMeta(meta){ if(!meta||!meta.now) return 0; var p=meta.now.split(' '); if(p.length<2) return 0; var t=p[1].split(':'); return parseInt(t[0],10)*60+parseInt(t[1],10); }
function findPeriod(r,name){ var e=null; (r.periods||[]).forEach(function(x){ if(x.name===name) e=x; }); return e; }
function esc(s){ return String(s==null?'':s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }

// 当前时段状态
function curState(r, ap, now){
  var ent=findPeriod(r,ap); if(!ent) return null;
  var std=stdFor(ap,r.ydl), remain=Math.max(0,pEnd(ap)-now);
  var om=ent.onlineMin||0, o=ent.orders, d=ent.delivery||0;
  if(om+remain<std[0]) return 0;
  if(om>=std[0] && o!=null && o>=std[1]) return 3;
  if(r.onlineStatus!=='在线' || ((o||0)+d)<std[1]) return 1;
  return 2;
}
// 全天信息（历史时段用冻结记录优先）
function dayInfo(r, ap, records, date){
  var cur=pIdx(ap), met=0, fail=0, future=0, marks=[], reasons=[];
  var sched=(r.schedule||[]).slice().sort(function(a,b){ return pIdx(a)-pIdx(b); });
  sched.forEach(function(p){
    var i=pIdx(p); if(i<0) return;
    var std=stdFor(p,r.ydl);
    var rec = records && records[date] && records[date][p] && records[date][p][r.id];
    var om=null, od=null;
    if(rec){ om=rec.on; od=rec.ord; }
    else { var ent=findPeriod(r,p); if(ent){ om=ent.onlineMin; od=ent.orders; } }
    if(i===cur){ marks.push('<span style="color:#1677ff">'+p+'⏳</span>'); }
    else if(i>cur){ future++; marks.push('<span style="color:#bbb">'+p+'⬜</span>'); }
    else {
      var okTime = om!=null && om>=std[0];
      var okOrd = od==null ? null : od>=std[1];
      if(okTime && (okOrd===null || okOrd)) { met++; marks.push('<span style="color:#389e0d">'+p+'✅</span>'); }
      else { fail++; marks.push('<span style="color:#cf1322">'+p+'❌</span>');
        var why=p+'：时长'+(om==null?'-':hms(om))+'/'+hms(std[0])+(okOrd===null?'':'，单'+(od)+'/'+std[1]);
        reasons.push(why); }
    }
  });
  var total=sched.length;
  var state = fail>0 ? 'fail' : (future>0 ? 'will' : 'done');
  var maxo=0; (r.periods||[]).forEach(function(x){ if((x.maxOrders||0)>maxo) maxo=x.maxOrders; });
  return { met:met, fail:fail, future:future, total:total, marks:marks.join(' '), reasons:reasons.join('；')||'-', state:state, maxo:maxo };
}
var TG={ '3':'<span class="tg tg-ok">🏆 已达标</span>', '0':'<span class="tg tg-no">❌ 确定不达标</span>',
         '1':'<span class="tg tg-rk">⚠️ 有风险</span>', '2':'<span class="tg tg-wl">🔵 预计达标</span>' };
var TGD={ done:'<span class="tg tg-ok">🌟 全天达成</span>', will:'<span class="tg tg-wl">🔵 预计达标</span>', fail:'<span class="tg tg-no">❌ 未达标</span>' };
function noteFor(st,r,ap,now){
  var ent=findPeriod(r,ap), std=stdFor(ap,r.ydl);
  var om=ent?ent.onlineMin||0:0, o=ent?(ent.orders||0):0, d=ent?(ent.delivery||0):0;
  var remain=Math.max(0,pEnd(ap)-now);
  if(st===3) return '在线 '+hms(om)+'/'+hms(std[0])+' · 完单 '+o+'/'+std[1]+' 已达标';
  if(st===0) return '剩余'+hms(remain)+' 已无法补齐 '+hms(std[0]);
  if(st===1) return r.onlineStatus!=='在线' ? ('未在线 · 剩余'+hms(remain)) : ('完单+配送 '+(o+d)+'/'+std[1]+' 不足 · 剩余'+hms(remain));
  return '在线 '+hms(om)+'/'+hms(std[0])+' · 剩余'+hms(remain)+'可达标';
}
function curRow(r, ap, now, st){
  var ent=findPeriod(r,ap), std=stdFor(ap,r.ydl);
  var om=ent?ent.onlineMin||0:0, o=ent?ent.orders:null, d=ent?ent.delivery||0:0, mx=ent?ent.maxOrders||0:0;
  var per=(r.schedule||[]).join('、');
  var on=r.onlineStatus==='在线';
  return '<tr data-name="'+esc(r.name)+'" data-team="'+esc(r.xiaodui)+'" data-line="'+esc(r.ydl)+'" data-inst="'+(on?1:0)+'" data-online="'+om+'" data-orders="'+(o==null?0:o)+'" data-maxo="'+mx+'" data-delivery="'+d+'" data-state="'+st+'" data-period="'+esc(per)+'">'+
    '<td class="ta-l"><span class="rn rider-link" onclick="openPhone(this)" data-name="'+esc(r.name)+'" data-id="'+esc(r.id)+'" data-team="'+esc(r.xiaodui)+'" data-line="'+esc(r.ydl)+'" data-phone="'+esc(r.phone||'')+'">'+esc(r.name)+'</span><span class="rid">'+esc(r.id)+'</span></td>'+
    '<td>'+esc(r.xiaodui)+'</td><td>'+esc(r.ydl)+'</td><td class="ta-l" style="font-size:11px">'+esc(per)+'</td>'+
    '<td class="'+(on?'on':'off')+'">'+(on?'在线':'离线')+'</td>'+
    '<td>'+hms(om)+' / '+hms(std[0])+'</td><td>'+(o==null?'-':o)+' / '+std[1]+'</td><td>'+mx+'</td><td>'+d+'</td>'+
    '<td>'+TG[String(st)]+'<span class="nt">'+esc(noteFor(st,r,ap,now))+'</span></td></tr>';
}
function dayRow(r, ap, records, date){
  var di=dayInfo(r, ap, records, date);
  var stNum = di.state==='done'?2:(di.state==='will'?1:0);
  return '<tr data-name="'+esc(r.name)+'" data-team="'+esc(r.xiaodui)+'" data-line="'+esc(r.ydl)+'" data-state="'+stNum+'" data-done="'+di.met+'" data-maxo="'+di.maxo+'" data-fail="'+di.fail+'" data-future="'+di.future+'">'+
    '<td class="ta-l"><span class="rn rider-link" onclick="openPhone(this)" data-name="'+esc(r.name)+'" data-id="'+esc(r.id)+'" data-team="'+esc(r.xiaodui)+'" data-line="'+esc(r.ydl)+'" data-phone="'+esc(r.phone||'')+'">'+esc(r.name)+'</span><span class="rid">'+esc(r.id)+'</span></td>'+
    '<td>'+esc(r.xiaodui)+'</td><td>'+esc(r.ydl)+'</td><td>'+TGD[di.state]+'</td>'+
    '<td>'+di.met+'/'+di.total+'</td><td>'+di.maxo+'</td><td class="ta-l pst">'+di.marks+'</td>'+
    '<td style="color:#cf1322;font-size:11px">'+esc(di.reasons)+'</td><td>'+di.future+'</td></tr>';
}
// 替换 tbody 内部
function setTbody(html, marker, inner){
  var i = html.indexOf(marker); if(i<0) throw new Error('找不到 '+marker);
  var open = html.indexOf('<tbody', i); if(open<0) throw new Error('tbody '+marker);
  var tagEnd = html.indexOf('>', open);
  var close = html.indexOf('</tbody>', tagEnd);
  return html.slice(0, tagEnd+1) + inner + html.slice(close);
}
function setTbodySelf(html, idMarker, inner){
  var i = html.indexOf(idMarker); if(i<0) throw new Error('找不到 '+idMarker);
  var open = html.lastIndexOf('<tbody', i); if(open<0) throw new Error('tbody '+idMarker);
  var tagEnd = html.indexOf('>', open);
  var close = html.indexOf('</tbody>', tagEnd);
  return html.slice(0, tagEnd+1) + inner + html.slice(close);
}
function hhmm(min){ min=Math.max(0,Math.floor(min||0)); var h=Math.floor(min/60), m=min%60; return (h<10?'0'+h:h)+':'+(m<10?'0'+m:m); }
function setBetween(html, start, end, inner){
  var i = html.indexOf(start); if(i<0) throw new Error('找不到起始 '+start.slice(0,40));
  var j = html.indexOf(end, i+start.length); if(j<0) throw new Error('找不到结束 '+end.slice(0,40));
  return html.slice(0, i) + inner + html.slice(j);
}


// ===== 美化 + 左侧任务栏（注入到三个页面） =====
var SIDE_CSS='';
var SIDE_HTML='';

function clean(html){
  // 1) 去掉重复注入的 RF 组件（内含第二个导航栏 + 刷新按钮）
  html = html.replace(/<!--RF-WIDGET-START-->[\s\S]*?<!--RF-WIDGET-END-->/g, '');
  var i = html.indexOf('<!--RF-WIDGET-START-->');
  if(i>=0){ var j = html.indexOf('</body>', i); if(j>0) html = html.slice(0,i) + html.slice(j); }
  // 2) 去掉重复的导航块（只保留第一个）
  var first = html.indexOf('<div class="rnav"');
  if(first>=0){
    var second = html.indexOf('<div class="rnav"', first+10);
    if(second>=0){
      // 找到第二个 nav 的结束 </div>（rnav 内只有 a 标签，无嵌套 div）
      var end = html.indexOf('</div>', second);
      if(end>0) html = html.slice(0, second) + html.slice(end+6);
    }
  }
  // 导航追加“骑手历史”
  html = html.replace(/<a class="rnav-i" data-nav="home"[^>]*>[^<]*<\/a>/, function(m){ return m + '<a class="rnav-i" data-nav="hist" href="history.html">📈 骑手历史</a>'; });
  // 3) 取消自动重载（屏闪根因）
  html = html.split('location.reload()').join('void 0');
  // 4) 兜底隐藏刷新按钮/toast
  html = html.replace('</head>','<style>.rf-btn,.rf-wrap,#rf-toast,.rf-toast{display:none!important}</style></head>');
  return html;
}

function skin(html){
  try{
    var css = require('fs').readFileSync(require('path').join(__dirname,'skin.css'));
    var js  = require('fs').readFileSync(require('path').join(__dirname,'skin.js'));
    require('fs').writeFileSync(require('path').join(OUT,'skin.css'), css);
    require('fs').writeFileSync(require('path').join(OUT,'skin.js'), js);
  }catch(e){}
  html = clean(html);
  html = html.replace('</head>','<link rel="stylesheet" href="skin.css"></head>');
  html = html.replace('</body>','<script src="skin.js" defer></script></body>');
  return html;
}

function build(){
  var data = JSON.parse(fs.readFileSync(path.join(__dirname,'data.json'),'utf8'));
  var meta = data.meta||{}, riders = data.riders||[];
  var ap = meta.activePeriod || PERIODS[0][0];
  var now = nowMinFromMeta(meta);
  var date = meta.date || '';
  var records = {};
  try{ records = JSON.parse(fs.readFileSync(path.join(__dirname,'records.json'),'utf8')); }catch(e){}

  // 当前时段骑手
  var cur = [];
  riders.forEach(function(r){ var st=curState(r,ap,now); if(st!==null) cur.push({r:r,st:st}); });
  var cnt = {all:cur.length, online:0, offline:0, unreach:0, risky:0, will:0, attained:0};
  cur.forEach(function(x){ if(x.r.onlineStatus==='在线') cnt.online++; else cnt.offline++;
    if(x.st===0)cnt.unreach++; else if(x.st===1)cnt.risky++; else if(x.st===2)cnt.will++; else if(x.st===3)cnt.attained++; });

  // 全天
  var day = riders.filter(function(r){ return (r.schedule||[]).length>0; });
  var dayCnt={all:day.length,done:0,will:0,fail:0};
  day.forEach(function(r){ var di=dayInfo(r,ap,records,date); if(di.state==='done')dayCnt.done++; else if(di.state==='will')dayCnt.will++; else dayCnt.fail++; });
  var rate = day.length ? ((dayCnt.done+dayCnt.will)/day.length*100) : 0;

  // 维度汇总
  function group(key){ var m={}; day.forEach(function(r){ var k=r[key]||'未知'; if(!m[k])m[k]={all:0,done:0,will:0,fail:0}; m[k].all++; var di=dayInfo(r,ap,records,date); if(di.state==='done')m[k].done++; else if(di.state==='will')m[k].will++; else m[k].fail++; }); return m; }
  var byLine=group('ydl'), byTeam=group('xiaodui');

  var teams=[...new Set(riders.map(function(r){return r.xiaodui;}).filter(Boolean))].sort();
  var lines=['优选','蜂跑','优远'];

  var h1 = fs.readFileSync(path.join(TPL,'id1.html'),'utf8');
  // 标题/头部
  h1 = h1.replace(/<title>[^<]*<\/title>/, '<title>众包实时骑手监控 '+esc(date)+'</title>');
  h1 = h1.replace(/<p>\d{4}-\d{2}-\d{2} \d{2}:\d{2} · <span class="data-ref">⏰ 数据截至 \d{2}:\d{2}<\/span><\/p>/,
    '<p>'+esc(meta.now)+' · <span class="data-ref">⏰ 数据截至 '+esc((meta.now||'').split(' ')[1]||'')+'</span></p>');
  h1 = h1.replace(/<div class="pi">[^<]*<\/div>/, '<div class="pi">'+esc(ap+'（'+hhmm(pStart(ap))+'~'+hhmm(pEnd(ap))+'）· 剩余 '+hms(pEnd(ap)-now))+'</div>');
  // 当前时段卡片
  var cardsCur = '<div class="cards cards-cur">'+
    card('all','📋',cnt.all,'排班总数')+card('online','✅',cnt.online,'在线')+card('offline','📵',cnt.offline,'未在线')+
    card('unreach','❌',cnt.unreach,'确定不达标')+card('risky','⚠️',cnt.risky,'有风险')+card('will','🔵',cnt.will,'预计达标')+card('attained','🏆',cnt.attained,'已达标')+'</div>';
  function card(k,ic,n,l){ return '<div class="cd" data-card="'+k+'" onclick="showDetail(this)"><div class="ic">'+ic+'</div><div class="n">'+n+'</div><div class="l">'+l+'</div></div>'; }
  h1 = setBetween(h1, '<div class="cards cards-cur">', '<div class="ft">', cardsCur);
  // 筛选
  var ft = '<div class="ft"><select id="fl" onchange="updateTable()"><option value="">全部运力线</option>'+lines.map(function(l){return '<option value="'+l+'">'+l+'</option>';}).join('')+'</select>'+
    '<select id="ft" onchange="updateTable()"><option value="">全部小队</option>'+teams.map(function(t){return '<option value="'+esc(t)+'">'+esc(t)+'</option>';}).join('')+'</select></div>';
  h1 = setBetween(h1, '<div class="ft">', '<div class="tw">', ft);
  // 当前时段表体
  h1 = setTbodySelf(h1, 'id="curBody"', cur.map(function(x){ return curRow(x.r, ap, now, x.st); }).join(''));
  // 全天卡片
  var cardsDay='<div class="cards cards-day">'+
    card('dayAll','📊',dayCnt.all,'今日排班')+card('dayDone','🌟',dayCnt.done,'全天达成')+
    card('dayWill','🔮',dayCnt.will,'预计达标')+card('dayFail','🔴',dayCnt.fail,'未达标')+
    card('dayPerfect','🏅',rate.toFixed(1)+'%','达成率')+'</div>';
  h1 = setBetween(h1, '<div class="cards cards-day">', '<div class="pd-box">', cardsDay);
  // 汇总区
  var sum = '<div class="pd-box"><div class="sm">📊 今日排班 <b>'+dayCnt.all+'</b> 人 · ✅ 全天达成 <b>'+dayCnt.done+'</b> · 🔵 预计达标 <b>'+dayCnt.will+'</b> · ❌ 未达标 <b>'+dayCnt.fail+'</b></div>'+
    '<div class="sub-tbl"><div class="sm" style="font-weight:600">🚚 运力线维度</div>'+dimTable(byLine,true)+'</div>'+
    '<div class="sub-tbl"><div class="sm" style="font-weight:600">🏫 小队维度</div>'+dimTable(byTeam,false)+'</div></div>';
  function dimTable(m, isLine){
    var rows=Object.keys(m).sort(function(a,b){ return m[b].all-m[a].all; }).map(function(k){
      var color = isLine ? (k==='优选'?'#1677ff':k==='蜂跑'?'#faad14':'#52c41a') : '';
      var cell = isLine ? '<td><b style="color:'+color+'">'+esc(k)+'</b></td>' : '<td class="ta-l"><b>'+esc(k)+'</b></td>';
      var total=m[k].all, ok=m[k].done+m[k].will, rt=total?(ok/total*100).toFixed(1):'0.0';
      return '<tr>'+cell+'<td>'+total+'</td><td style="color:#389e0d">'+m[k].done+'</td><td style="color:#1677ff">'+m[k].will+'</td><td style="color:#cf1322">'+m[k].fail+'</td><td><b>'+rt+'%</b></td></tr>';
    }).join('');
    return '<table><thead><tr><th>'+(isLine?'运力线':'小队')+'</th><th>排班</th><th>✅ 全天达成</th><th>🔵 预计达标</th><th>❌ 未达标</th><th>达成率</th></tr></thead><tbody>'+rows+'</tbody></table>';
  }
  h1 = setBetween(h1, '<div class="pd-box">', '<div class="sm" style="margin-top:14px;font-weight:600">👥 骑手明细', sum);
  // 全天明细表体（用第一个 tbody after 骑手明细）
  var dayRows = day.slice().sort(function(a,b){ var A=dayInfo(a,ap,records,date),B=dayInfo(b,ap,records,date); return B.fail-A.fail; }).map(function(r){ return dayRow(r,ap,records,date); }).join('');
  h1 = setTbody(h1, '👥 骑手明细', dayRows);
  // 明细弹窗
  function paneRows(list, mode){ return list.map(function(x){ return mode==='cur'?curRow(x.r,ap,now,x.st):dayRow(x,ap,records,date); }).join(''); }
  var curAll=cur, curOn=cur.filter(function(x){return x.r.onlineStatus==='在线';}), curOff=cur.filter(function(x){return x.r.onlineStatus!=='在线';});
  var curUn=cur.filter(function(x){return x.st===0;}), curRk=cur.filter(function(x){return x.st===1;}), curWl=cur.filter(function(x){return x.st===2;}), curAt=cur.filter(function(x){return x.st===3;});
  var dayAll=day, dayDone=day.filter(function(r){return dayInfo(r,ap,records,date).state==='done';}), dayWill=day.filter(function(r){return dayInfo(r,ap,records,date).state==='will';}), dayFail=day.filter(function(r){return dayInfo(r,ap,records,date).state==='fail';});
  var paneMap = {};
  [['dp-all',paneRows(curAll,'cur'),'当前时段 · 排班总数'],['dp-online',paneRows(curOn,'cur'),'当前时段 · 在线'],['dp-offline',paneRows(curOff,'cur'),'当前时段 · 未在线'],
   ['dp-unreach',paneRows(curUn,'cur'),'当前时段 · 确定不达标'],['dp-risky',paneRows(curRk,'cur'),'当前时段 · 有风险'],['dp-will',paneRows(curWl,'cur'),'当前时段 · 预计达标'],
   ['dp-attained',paneRows(curAt,'cur'),'当前时段 · 已达标'],['dp-dayAll',paneRows(dayAll,'day'),'全天 · 今日排班'],['dp-dayDone',paneRows(dayDone,'day'),'全天 · 全天达成'],
   ['dp-dayWill',paneRows(dayWill,'day'),'全天 · 预计达标'],['dp-dayFail',paneRows(dayFail,'day'),'全天 · 未达标'],['dp-dayPerfect',paneRows(dayAll,'day'),'全天 · 达成率']
  ].forEach(function(t){
    var id='id="'+t[0]+'"';
    if(h1.indexOf(id)<0) return;
    // 标题人数
    var i=h1.indexOf(id); var tp=h1.indexOf('<div class="dp-title">', i); var tpe=h1.indexOf('</div>', tp);
    var title=h1.slice(tp+22, tpe).replace(/（\d+ 人）/, '');
    var n = t[1] ? (t[1].match(/<tr /g)||[]).length : 0;
    h1 = h1.slice(0,tp) + '<div class="dp-title">'+title+'（'+n+' 人）</div>' + h1.slice(tpe+6);
    h1 = setTbody(h1, id, t[1]);
  });
  // 规则表
  var rulesRows = PERIODS.map(function(p){ var st=STANDARDS[p[0]]; var t=p[0]; return '<tr><td><b>'+t+'</b></td><td>'+hms(p[1]).slice(0,5).replace(/:/,'~')+':'+String(p[2]%60).padStart(2,'0')+'</td><td>'+st.优选.join(' / ')+'</td><td>'+st.蜂跑.join(' / ')+'</td><td>'+st.优远.join(' / ')+'</td></tr>'; }).join('');
  var ri = h1.indexOf('各运力线 · 各时段标准');
  if(ri>=0) h1 = setTbody(h1, '各运力线 · 各时段标准', rulesRows);

  // 时段副标题同步
  h1 = h1.replace('<div class="sec-sub">凌晨2 · 剩余 1:21:00 · 到岗与达标实时监控</div>', '<div class="sec-sub">'+esc(ap)+' · 剩余 '+hms(pEnd(ap)-now)+' · 到岗与达标实时监控</div>');
  h1 = h1.replace(/<div class="sec-sub">\d{4}-\d{2}-\d{2} · 各时段完成情况复盘<\/div>/, '<div class="sec-sub">'+esc(date)+' · 各时段完成情况复盘</div>');

  // ================= id2 有效出勤监控 =================
  var i2 = fs.readFileSync(path.join(TPL,'id2.html'),'utf8');
  i2 = i2.replace(/<title>[^<]*<\/title>/, '<title>有效出勤监控 '+esc(date)+'</title>');
  i2 = i2.replace(/<div class="sub">[^<]*<\/div>/, '<div class="sub">数据日期：'+esc(date)+' | 截至北京时间 '+esc((meta.now||'').split(' ')[1]||'')+' | 剩余 '+(1440-now)+' 分钟至今日24:00</div>');
  var eff = riders.map(function(r){
    var target = r.orderTarget||20, hours=(r.dayOnlineMin||0)/60;
    var ok = (r.dayOnlineMin||0)>=480 && (r.orders||0)>=target;
    var shortMin = Math.max(0,480-(r.dayOnlineMin||0));
    return { r:r, target:target, hours:hours, ok:ok, shortMin:shortMin, sched:(r.schedule||[]).length>0 };
  });
  var effSched = eff.filter(function(x){ return x.sched; });
  var effOk = eff.filter(function(x){ return x.ok; });
  var effRate = riders.length ? (effOk.length/riders.length*100) : 0;
  var delSum = riders.reduce(function(a,r){ return a+(Number(r.deliveryOrders)||0); },0);
  var onNow = riders.filter(function(r){ return r.onlineStatus==='在线'; }).length;
  var cardsI2 = '<div class="cards"><div class="card"><div class="icon">👥</div><div class="num">'+riders.length+'</div><div class="label">总人数</div></div>'+
    '<div class="card"><div class="icon">📋</div><div class="num">'+effSched.length+'</div><div class="label">排班人数</div></div>'+
    '<div class="card"><div class="icon">🟢</div><div class="num">'+onNow+'</div><div class="label">当前在线</div></div>'+
    '<div class="card"><div class="icon">🛵</div><div class="num o">'+delSum+'</div><div class="label">配送中单量</div></div>'+
    '<div class="card"><div class="icon">✅</div><div class="num g">'+effOk.length+'</div><div class="label">达标人数</div></div>'+
    '<div class="card"><div class="icon">📊</div><div class="num">'+effRate.toFixed(1)+'%</div><div class="label">达标率</div></div></div>';
  i2 = setBetween(i2, '<div class="cards">', '<div class="panel">', cardsI2);
  i2 = i2.replace(/<div class="cnt" id="cntInfo">[^<]*<\/div>/, '<div class="cnt" id="cntInfo">共 '+riders.length+' 条记录</div>');
  var lnOrder={'优选':0,'蜂跑':1,'优远':2};
  eff.sort(function(a,b){ var la=lnOrder[a.r.ydl]||9, lb=lnOrder[b.r.ydl]||9; if(la!==lb) return la-lb; if(a.r.xiaodui!==b.r.xiaodui) return a.r.xiaodui<b.r.xiaodui?-1:1; return a.r.name<b.r.name?-1:1; });
  var remainDay = Math.max(0, 1440-now);
  var rowsI2 = eff.map(function(x){
    var r=x.r;
    var onBadge = r.onlineStatus==='在线' ? '<span class="tag tag-on">● 在线</span>' : '<span class="tag tag-off">○ 离线</span>';
    var schedBadge = x.sched ? '<span class="tag tag-yes">排班</span>' : '<span class="tag tag-no">未排班</span>';
    return '<tr data-ydl="'+esc(r.ydl)+'" data-team="'+esc(r.xiaodui)+'" data-name="'+esc(r.name)+'" data-met="'+(x.ok?1:0)+'" data-online="'+esc(r.onlineStatus)+'" data-sched="'+(x.sched?'是':'否')+'" data-periods="'+esc((r.schedule||[]).join('、'))+'" data-cap="'+esc(r.isCaptain||'否')+'" data-new="'+esc(r.isNew||'否')+'" data-hours="'+x.hours.toFixed(1)+'" data-orders="'+(r.orders||0)+'" data-sprint="'+((r.ydl==='蜂跑'&&(r.orders||0)>=40)?1:0)+'" data-delivery="'+(r.deliveryOrders||0)+'" data-gap="'+Math.max(0,(r.orderTarget||20)-(r.orders||0))+'">'+
      '<td>'+esc(r.ydl)+'</td><td>'+esc(r.xiaodui)+'</td><td>'+esc(r.name)+'</td><td>'+onBadge+'</td><td>'+schedBadge+'</td>'+
      '<td>'+esc((r.schedule||[]).join('、'))+'</td><td>'+x.hours.toFixed(1)+'h</td><td>'+(r.orders||0)+'/'+x.target+'</td><td>-</td><td>0</td>'+
      '<td class="r">'+(x.ok?'达标':'未达标')+'</td><td><span class="tag tag-o">'+x.target+'单</span></td>'+
      '<td><span class="r">'+(x.ok?'已完成':(remainDay+(((r.dayOnlineMin||0)+remainDay)<480?'分钟(不足)':'分钟')))+'</span></td></tr>';
  }).join('');
  i2 = setTbodySelf(i2, 'id="tb"', rowsI2);
  function dimI2(list, withTeam){
    return list.map(function(g){
      var total=g.length, sched=g.filter(function(x){return x.sched;}).length, ok=g.filter(function(x){return x.ok;}).length;
      var sprint=g.filter(function(x){ return x.r.ydl==='蜂跑' && (x.r.orders||0)>=40; }).length;
      var rt=(sched||total)?(ok/(sched||total)*100).toFixed(1):'0.0';
      var head = withTeam ? '<td>'+esc(g[0].r.ydl)+'</td><td>'+esc(g[0].r.xiaodui)+'</td>' : '<td>'+esc(g[0].r.ydl)+'</td>';
      return '<tr>'+head+'<td>'+total+'</td><td>'+sched+'</td><td>'+ok+'</td><td>'+sprint+'</td><td>'+rt+'%</td></tr>';
    }).join('');
  }
  function groupBy(list, keyFn){ var m={}; list.forEach(function(x){ var k=keyFn(x); (m[k]=m[k]||[]).push(x); }); return m; }
  var byTeamI2 = groupBy(eff, function(x){ return x.r.ydl+'|'+x.r.xiaodui; });
  var byTeamList = Object.keys(byTeamI2).sort(function(a,b){ return byTeamI2[b].length-byTeamI2[a].length; }).map(function(k){ return byTeamI2[k]; });
  var byLineI2 = groupBy(eff, function(x){ return x.r.ydl; });
  var byLineList = ['优选','蜂跑','优远'].map(function(l){ return byLineI2[l]||[]; }).filter(function(g){ return g.length; });
  i2 = i2.replace(/共 \d+ 个小队/, '共 '+byTeamList.length+' 个小队');
  i2 = setTbody(i2, '共 '+byTeamList.length+' 个小队', dimI2(byTeamList, true));
  i2 = setTbody(i2, 'id="sec2"', dimI2(byLineList, false));
  i2 = skin(i2);
  if(!i2.includes('dztSortT')){
    i2 = i2.replace('</body>','<script>(function(){'+
      'var KEYS=["data-ydl","data-team","data-name","data-online","data-sched","data-periods","data-hours","data-orders","data-sprint","data-delivery","data-met","data-gap","data-delivery"];'+
      'var cur={col:-1,dir:"asc"};'+
      'function rows(){var tb=document.getElementById("tb");return tb?[].slice.call(tb.rows):[];}'+
      'function cmp(a,b,k){var av=a.getAttribute(k)||"",bv=b.getAttribute(k)||"";var na=parseFloat(av),nb=parseFloat(bv);if(!isNaN(na)&&!isNaN(nb))return na-nb;return av.localeCompare(bv,"zh");}'+
      'window.sortT=function(ci){'+
        'var tb=document.getElementById("tb");if(!tb)return;'+
        'var k=KEYS[ci]||"data-name";'+
        'var dir=(cur.col===ci&&cur.dir==="asc")?"desc":"asc";cur={col:ci,dir:dir};'+
        'var arr=rows().slice().sort(function(a,b){var c=cmp(a,b,k);return dir==="asc"?c:-c;});'+
        'arr.forEach(function(r){tb.appendChild(r);});'+
        'var ths=document.querySelectorAll("#rt thead th .arr");for(var i=0;i<ths.length;i++)ths[i].textContent="";'+
        'var th=document.querySelectorAll("#rt thead th")[ci];if(th){var a=th.querySelector(".arr");if(a)a.textContent=dir==="asc"?" ▲":" ▼";}'+
      '};'+
      'window.applyFilter=function(){'+
        'var g=function(id){var e=document.getElementById(id);return e?e.value:"";};'+
        'var yd=g("fy"),tm=g("ft"),st=g("fs"),nm=(g("fn")||"").toLowerCase(),ol=g("fol"),pb=g("fpb"),pd=g("fpd"),cap=g("fcap"),nw=g("fnew");'+
        'var rs=rows(),shown=0;'+
        'for(var i=0;i<rs.length;i++){var r=rs[i];var ok=true;'+
          'if(yd&&r.getAttribute("data-ydl")!==yd)ok=false;'+
          'if(tm&&r.getAttribute("data-team")!==tm)ok=false;'+
          'if(st==="met"&&r.getAttribute("data-met")!=="1")ok=false;'+
          'if(st==="not"&&r.getAttribute("data-met")==="1")ok=false;'+
          'if(nm&&(r.getAttribute("data-name")||"").toLowerCase().indexOf(nm)<0)ok=false;'+
          'if(ol&&r.getAttribute("data-online")!==ol)ok=false;'+
          'if(pb&&r.getAttribute("data-sched")!==pb)ok=false;'+
          'if(pd&&(r.getAttribute("data-periods")||"").indexOf(pd)<0)ok=false;'+
          'if(cap&&r.getAttribute("data-cap")!==cap)ok=false;'+
          'if(nw&&r.getAttribute("data-new")!==nw)ok=false;'+
          'r.style.display=ok?"":"none";if(ok)shown++;}'+
        'var c=document.getElementById("cntInfo");if(c)c.textContent="共 "+shown+" 条记录";'+
      '};'+
      '})();<\/script></body>');
  }
  fs.writeFileSync(path.join(OUT,'id2.html'), i2);

  // ================= index 播报首页 =================
  var ix = fs.readFileSync(path.join(TPL,'index.html'),'utf8');
  ix = ix.replace('数据截至 --', '数据截至 '+esc((meta.now||'').split(' ')[1]||''));
  while(ix.indexOf('数据截至 --')>=0) ix = ix.replace('数据截至 --', '数据截至 '+esc((meta.now||'').split(' ')[1]||''));
  ix = skin(ix);
  ix = ix.replace('</head>', '<style>'+
    'body{display:block!important;padding:0!important;background:#eef2f8!important;min-height:100vh}'+
    '.wrap{max-width:920px!important;margin:0 auto!important;padding:36px 16px 60px!important}'+
    '.grid{display:grid!important;grid-template-columns:repeat(auto-fit,minmax(300px,1fr))!important;gap:16px!important}'+
    'h1{font-size:22px!important;margin-bottom:6px!important;color:#14213a}'+
    '.sub{color:#60718a!important;font-size:13px!important;margin-bottom:24px!important}'+
    '.card{border:1px solid #e4eaf3!important;border-radius:14px!important;padding:22px!important;background:#fff!important;color:#14213a!important;text-decoration:none};'+
    '.foot{color:#8b9bb2!important}'+
    '</style></head>');
  fs.writeFileSync(path.join(OUT,'index.html'), ix);

  // ===== Excel 导出 =====
  var XLSX = require('./xlsx.js');
  var curRowsX = [['骑手','ID','小队','运力线','排班时段','在线状态','当前在线(分)','时长要求(分)','当前完单','单量要求','最大单量','配送中','达标状态']];
  cur.forEach(function(x){
    var ent=findPeriod(x.r,ap), std=stdFor(ap,x.r.ydl), on=x.r.onlineStatus==='在线';
    curRowsX.push([x.r.name, x.r.id, x.r.xiaodui, x.r.ydl, (x.r.schedule||[]).join('、'), on?'在线':'离线',
      ent?ent.onlineMin:0, std[0], ent&&ent.orders!=null?ent.orders:0, std[1], ent?ent.maxOrders:0, ent?ent.delivery:0,
      ({3:'已达标',0:'确定不达标',1:'有风险',2:'预计达标'})[x.st]||'']);
  });
  day.forEach(function(r){
    var di=dayInfo(r,ap,records,date);
    curRowsX.push([r.name, r.id, r.xiaodui, r.ydl, (r.schedule||[]).join('、'), r.onlineStatus,
      r.dayOnlineMin||0, 480, r.orders||0, r.orderTarget||20, di.maxo, r.deliveryOrders||0,
      di.state==='done'?'全天达成':di.state==='will'?'预计达标':'未达标']);
  });
  fs.writeFileSync(path.join(OUT,'monitor_latest.xlsx'), XLSX.buildXlsx('实时出勤', curRowsX));

  // 30天历史 + 骑手维度（完美出勤 / 有效出勤）
  var hist = {};
  try{ hist = JSON.parse(fs.readFileSync(path.join(__dirname,'history.json'),'utf8'))||{}; }catch(e){}
  var daysAll = Object.keys(hist).sort().filter(function(d){ return d < date; });
  var days = daysAll.slice(-30);
  var rowsH = [['日期','骑手','ID','小队','运力线','排班时段数','已达标时段','未达标时段','完美出勤','在线时长(分)','完单','目标单量','有效出勤']];
  var riderStat = {};
  days.forEach(function(d){
    var dayRiders = (hist[d].riders)||[];
    dayRiders.forEach(function(r){
      var sched=(r.schedule||[]).slice().sort(function(a,b){ return pIdx(a)-pIdx(b); });
      var curIdx = d===date ? pIdx(ap) : 99;
      var met=0, fail=0, endedCount=0;
      sched.forEach(function(pp){
        var i=pIdx(pp); if(i<0) return;
        if(i>=curIdx) return;
        endedCount++;
        var std=stdFor(pp,r.ydl), ent=findPeriod(r,pp);
        var om=ent?ent.onlineMin:0, od=ent?ent.orders:null;
        if(om>=std[0] && (od==null || od>=std[1])) met++; else fail++;
      });
      var perfect = endedCount>0 && fail===0 && sched.length===endedCount;
      var target=r.orderTarget||20;
      var effective = (r.dayOnlineMin||0)>=480 && (r.orders||0)>=target;
      rowsH.push([d, r.name, r.id, r.xiaodui, r.ydl, sched.length, met, fail, perfect?'是':'否', r.dayOnlineMin||0, r.orders||0, target, effective?'是':'否']);
      var k=r.id||r.name;
      if(!riderStat[k]) riderStat[k]={name:r.name, team:r.xiaodui, line:r.ydl, days:0, perfect:0, effective:0};
      riderStat[k].days++; if(perfect) riderStat[k].perfect++; if(effective) riderStat[k].effective++;
    });
  });
  rowsH.push([]);
  rowsH.push(['骑手维度汇总（近'+days.length+'天）']);
  rowsH.push(['骑手','小队','运力线','出勤天数','完美出勤天数','有效出勤天数','完美出勤率','有效出勤率']);
  Object.keys(riderStat).sort(function(a,b){ return riderStat[b].perfect-riderStat[a].perfect; }).forEach(function(k){
    var x=riderStat[k];
    rowsH.push([x.name, x.team, x.line, x.days, x.perfect, x.effective,
      (x.days?(x.perfect/x.days*100).toFixed(1):'0.0')+'%', (x.days?(x.effective/x.days*100).toFixed(1):'0.0')+'%']);
  });
  fs.writeFileSync(path.join(OUT,'history_30d_live.xlsx'), XLSX.buildXlsx('近30天历史', rowsH));
  console.log('Excel: 明细', curRowsX.length-1, '行 / 历史', rowsH.length, '行 / 天数', days.length);

  // ===== 骑手历史页 =====
  var baseCss = (fs.readFileSync(path.join(TPL,'id1.html'),'utf8').match(/<style>[\s\S]*?<\/style>/)||[''])[0];
  var statArr = Object.keys(riderStat).map(function(k){ return riderStat[k]; });
  statArr.sort(function(a,b){ return (b.perfect/Math.max(b.days,1))-(a.perfect/Math.max(a.days,1)); });
  var totDays = days.length;
  var sumPerfect = statArr.reduce(function(a,x){ return a+x.perfect; },0);
  var sumEffective = statArr.reduce(function(a,x){ return a+x.effective; },0);
  var sumSched = statArr.reduce(function(a,x){ return a+x.days; },0);
  var cardsH = '<div class="hist-cards">'+
    hc('统计天数', totDays)+hc('排班人次', sumSched)+hc('完美出勤人次', sumPerfect)+
    hc('完美出勤率', (sumSched?(sumPerfect/sumSched*100).toFixed(1):'0.0')+'%')+
    hc('有效出勤人次', sumEffective)+hc('有效出勤率', (sumSched?(sumEffective/sumSched*100).toFixed(1):'0.0')+'%')+'</div>';
  function hc(l,n){ return '<div class="hist-card"><div class="n">'+n+'</div><div class="l">'+l+'</div></div>'; }
  var rowsH2 = statArr.map(function(x){
    var pr = x.days?(x.perfect/x.days*100):0, er = x.days?(x.effective/x.days*100):0;
    return '<tr data-name="'+esc(x.name)+'" data-team="'+esc(x.team)+'" data-line="'+esc(x.line)+'" data-days="'+x.days+'" data-perfect="'+x.perfect+'" data-prate="'+pr.toFixed(1)+'" data-eff="'+x.effective+'" data-erate="'+er.toFixed(1)+'">'+
      '<td class="ta-l"><span class="rn">'+esc(x.name)+'</span></td><td>'+esc(x.team)+'</td><td>'+esc(x.line)+'</td>'+
      '<td>'+x.days+'</td><td>'+x.perfect+'</td><td>'+pr.toFixed(1)+'%</td><td>'+x.effective+'</td><td>'+er.toFixed(1)+'%</td></tr>';
  }).join('');
  var histHtml = '<!DOCTYPE html><html lang="zh-CN"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">'+
    '<title>骑手历史达成 '+esc(date)+'</title>'+baseCss+'<link rel="stylesheet" href="skin.css"></head><body>'+
    '<div class="rnav"><a class="rnav-i" href="id1.html">📊 实时骑手监控</a><a class="rnav-i" href="id2.html">✅ 有效出勤监控</a><a class="rnav-i" href="index.html">🏠 播报首页</a><a class="rnav-i active" href="history.html">📈 骑手历史</a></div>'+
    '<div class="hd"><h1>📈 骑手历史达成</h1><p>近 '+days.length+' 天 · 完美出勤 / 有效出勤</p>'+
    '<div class="dl-bar"><a class="dl-btn" href="rider_history.xlsx" download>⬇️ 下载骑手历史表格（Excel）</a></div></div>'+
    cardsH+
    '<div class="tw" style="margin:12px 16px"><table id="histTable"><thead><tr>'+
    '<th data-key="name" onclick="sortH(this)">骑手</th><th data-key="team" onclick="sortH(this)">小队</th><th data-key="line" onclick="sortH(this)">运力线</th>'+
    '<th data-key="days" onclick="sortH(this)">排班天数</th><th data-key="perfect" onclick="sortH(this)">完美出勤天数</th><th data-key="prate" onclick="sortH(this)">完美出勤率</th>'+
    '<th data-key="eff" onclick="sortH(this)">有效出勤天数</th><th data-key="erate" onclick="sortH(this)">有效出勤率</th></tr></thead><tbody>'+
    (rowsH2||'<tr><td colspan="8" style="text-align:center;padding:30px;color:#9aa8bd">暂无历史数据（需累积）</td></tr>')+'</tbody></table></div>'+
    '<div class="foot" style="text-align:center;padding:16px;color:#8b9bb2;font-size:12px">完美出勤 = 当天所有排班时段均达标 · 有效出勤 = 在线≥8小时且完单达标</div>'+
    '<script>var hs=null,hd=false;function sortH(th){var tb=document.querySelector("#histTable tbody");var k=th.getAttribute("data-key");var rows=[].slice.call(tb.rows);var desc=(hs===k)?!hd:false;rows.sort(function(a,b){var av=a.getAttribute("data-"+k)||"",bv=b.getAttribute("data-"+k)||"";var na=parseFloat(av),nb=parseFloat(bv);var c=(!isNaN(na)&&!isNaN(nb))?(na-nb):(av<bv?-1:av>bv?1:0);return desc?-c:c;});rows.forEach(function(r){tb.appendChild(r);});var ths=document.querySelectorAll("#histTable th[data-key]");ths.forEach(function(t){t.removeAttribute("data-dir");});th.setAttribute("data-dir",desc?"desc":"asc");hs=k;hd=desc;}<\/script>'+
    '</body></html>';
  fs.writeFileSync(path.join(OUT,'history.html'), histHtml);
  // Excel：骑手历史
  var rowsRH=[['骑手','小队','运力线','排班天数','完美出勤天数','完美出勤率','有效出勤天数','有效出勤率']];
  statArr.forEach(function(x){ rowsRH.push([x.name,x.team,x.line,x.days,x.perfect,(x.days?(x.perfect/x.days*100).toFixed(1):'0.0')+'%',x.effective,(x.days?(x.effective/x.days*100).toFixed(1):'0.0')+'%']); });
  fs.writeFileSync(path.join(OUT,'rider_history.xlsx'), XLSX.buildXlsx('骑手历史', rowsRH));
  console.log('history 页: 骑手', statArr.length, '| 天数', days.length);
  console.log('id2/index 生成: 达标', effOk.length, '/', riders.length, '('+effRate.toFixed(1)+'%)');
  h1 = skin(h1);
  fs.writeFileSync(path.join(OUT,'id1.html'), h1);

  fs.writeFileSync(path.join(OUT,'stamp.json'), JSON.stringify({ id1: meta.now||'', id2: meta.now||'' }));
  console.log('id1.html 生成: 当前时段', cur.length, '人 / 全天', day.length, '人 / 达成率', rate.toFixed(1)+'%');
}
build();
