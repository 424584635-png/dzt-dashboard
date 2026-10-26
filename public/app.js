/* ============================================================
   大众包 · 骑手实时出勤看板 — 逻辑与渲染
   逻辑口径严格对齐原站看板（见「看板逻辑」弹窗）
   ============================================================ */
(function () {
  "use strict";

  // ---------- 时段与标准常量（对齐原站 STANDARDS / PERIOD_TIME） ----------
  var PERIODS = [
    ["凌晨1",0,120],["凌晨2",120,240],["凌晨3",240,360],
    ["早餐1",360,480],["早餐2",480,630],["午高峰",630,810],
    ["下午茶1",810,930],["下午茶2",930,1050],["晚高峰",1050,1200],
    ["夜宵1",1200,1320],["夜宵2",1320,1440]
  ];
  var STANDARDS = {
    "凌晨1":{优选:[90,2],蜂跑:[90,2],优远:[90,1]},"凌晨2":{优选:[90,2],蜂跑:[90,2],优远:[90,1]},
    "凌晨3":{优选:[90,2],蜂跑:[90,2],优远:[90,1]},"早餐1":{优选:[90,2],蜂跑:[90,2],优远:[90,1]},
    "早餐2":{优选:[120,2],蜂跑:[120,3],优远:[120,1]},"午高峰":{优选:[150,5],蜂跑:[150,8],优远:[150,3]},
    "下午茶1":{优选:[90,2],蜂跑:[90,3],优远:[90,1]},"下午茶2":{优选:[90,2],蜂跑:[90,3],优远:[90,1]},
    "晚高峰":{优选:[120,4],蜂跑:[120,6],优远:[120,2]},"夜宵1":{优选:[90,3],蜂跑:[90,3],优远:[90,1]},
    "夜宵2":{优选:[90,2],蜂跑:[90,2],优远:[90,1]}
  };

  var STATE = {
    view: "home", id1tab: "cur",
    id1f: { ydl: "", team: "" }, id1card: "", id1sort: { key: "", dir: 1 },
    id2tab: 0, id2f: { ydl:"", team:"", status:"", name:"", online:"", sched:"", period:"", cap:"", nw:"" },
    id2sort: { col: -1, dir: 1, key: "" }, id2card: "",
    histSel: "", histF: { ydl:"", team:"", name:"" }
  };
  var DATA = null, META = null, RIDERS = [], SOURCE = "";

  // ---------- 数据源配置（智联/本地可切换） ----------
  // 纯前端直连智联时，把 DATA_SOURCE 设为智联接口地址即可；
  // 若接口有跨域/登录限制，请用同域部署或反向代理（见 README）。
  // 可选：AUTH_HEADER 携带鉴权（如 {"Authorization":"Bearer <token>"}）。
  var DATA_SOURCE = window.DASHBOARD_CONFIG && window.DASHBOARD_CONFIG.dataSource
                    ? window.DASHBOARD_CONFIG.dataSource : "data.json";
  var AUTH_HEADER = (window.DASHBOARD_CONFIG && window.DASHBOARD_CONFIG.authHeader) || null;
  var HISTORY_DAYS = 30;
  var HIST_KEY = "dzt_history_v1"; // localStorage 键：{ "YYYY-MM-DD": {meta, riders} }

  function loadHistoryStore(){
    try { return JSON.parse(localStorage.getItem(HIST_KEY) || "{}"); } catch(e){ return {}; }
  }
  function saveHistoryStore(obj){
    try { localStorage.setItem(HIST_KEY, JSON.stringify(obj)); } catch(e){}
  }
  // 扩展模式下历史快照由 background 写入 chrome.storage.local(HIST_KEY)
  function loadHistoryStoreExt(){ return Promise.resolve(__histCache); }
  function snapshotToday(){
    if(!META || !META.date) return;
    var store = loadHistoryStore();
    store[META.date] = { meta: META, riders: RIDERS };
    var keys = Object.keys(store).sort();
    while(keys.length > HISTORY_DAYS){ delete store[keys.shift()]; }
    saveHistoryStore(store);
    // 扩展模式下，优先让 background 负责累积；此处仅在本地模式生效
  }
  var __histCache = null;
  function historyDates(){
    var s = __histCache || loadHistoryStore();
    return Object.keys(s).sort().reverse().slice(0, HISTORY_DAYS);
  }
  function getDay(date){
    var s = __histCache || loadHistoryStore();
    return s[date] || null;
  }
  // 扩展启动：异步拉取后台历史快照
  if(typeof chrome!=="undefined" && chrome.storage && chrome.storage.local){
    loadHistoryStoreExt().then(function(s){ if(s) __histCache = s; });
  }
  var NOW = 17*60, ACTIVE = "下午茶2", ACTIVE_START = 930, ACTIVE_END = 1050, REMAIN = 30, TOMID = 420;

  // ---------- 工具 ----------
  function esc(s){return String(s==null?"":s).replace(/[&<>"']/g,function(c){return {"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c];});}
  function fmtDur(min){min=Math.max(0,Math.round(min));var h=Math.floor(min/60),m=min%60;return h+":"+(m<10?"0":"")+m+":00";}
  function pad(n){return n<10?("0"+n):(""+n);}
  function parseNow(str){if(!str)return 17*60;var p=String(str).split(" ");var t=(p[1]||p[0]).split(":");return (parseInt(t[0],10)||0)*60+(parseInt(t[1],10)||0);}
  function pEnd(n){for(var i=0;i<PERIODS.length;i++)if(PERIODS[i][0]===n)return PERIODS[i][2];return 1440;}
  function pStart(n){for(var i=0;i<PERIODS.length;i++)if(PERIODS[i][0]===n)return PERIODS[i][1];return 0;}
  function activeFor(now){for(var i=0;i<PERIODS.length;i++)if(now>=PERIODS[i][1]&&now<PERIODS[i][2])return PERIODS[i][0];return PERIODS[PERIODS.length-1][0];}
  function stdFor(p,ydl){var s=STANDARDS[p];if(!s)return [0,0];return s[ydl]||s["优选"]||[0,0];}
  function findPeriod(r,p){var e=null;(r.periods||[]).forEach(function(x){if(x.name===p)e=x;});return e;}

  // ---------- 核心判定逻辑（对齐原站） ----------
  // 当前时段 state: 0 确定不达标, 1 有风险, 2 预计达标, 3 已达标, null 未排班当前时段
  function curState(r,now){
    var name=activeFor(now); var ent=findPeriod(r,name); if(!ent) return null;
    var std=stdFor(name,r.ydl); var remain=Math.max(0,pEnd(name)-now);
    var om=ent.onlineMin, o=ent.orders, d=ent.delivery||0;
    if(om+remain<std[0]) return 0;                 // 时间上已无法补齐最低时长
    if(om>=std[0]&&o>=std[1]) return 3;             // 在线时长与单量均达标
    if(r.onlineStatus!=="在线"||(o+d)<std[1]) return 1; // 未在线 或 完单+配送不足
    return 2;                                       // 剩余时间可补齐且有单
  }
  function dayTag(r,now){
    var scheds=r.schedule||[]; if(!scheds.length) return "";
    var anyNotMet=false, allMet=true, hasEnded=false;
    scheds.forEach(function(p){
      var end=pEnd(p), std=stdFor(p,r.ydl);
      if(end<=now){ hasEnded=true; var ent=findPeriod(r,p);
        var met=ent&&ent.onlineMin>=std[0] && (ent.orders==null || ent.orders>=std[1]);
        if(!met){anyNotMet=true;allMet=false;}
      }
    });
    if(anyNotMet) return "fail";
    if(curState(r,now)===0&&allMet&&hasEnded) return "new";
    return "";
  }
  function dayStatus(r,now){
    var scheds=r.schedule||[]; if(!scheds.length) return "none";
    var anyNotMet=false, hasUnstarted=false;
    scheds.forEach(function(p){
      var end=pEnd(p), start=pStart(p), std=stdFor(p,r.ydl);
      if(end<=now){ var ent=findPeriod(r,p); if(!(ent&&ent.onlineMin>=std[0] && (ent.orders==null || ent.orders>=std[1]))) anyNotMet=true; }
      else if(start>now){ hasUnstarted=true; }
    });
    if(anyNotMet) return "fail";
    if(hasUnstarted) return "will";
    return "done";
  }
  function effAtt(r,now){
    var totalMin=(r.onlineH||0)*60;
    var isMet=totalMin>=480&&r.orders>=r.orderTarget;
    var gap=r.orders>=r.orderTarget?0:(r.orderTarget-r.orders);
    var remNeed=Math.max(0,480-totalMin), toMid=1440-now, remTxt;
    if(remNeed===0) remTxt="已满足";
    else remTxt=(toMid>=remNeed?remNeed+"分钟(可满足)":remNeed+"分钟(不足)");
    var sprint="-";
    if(r.sprintTarget>0){
      if(r.orders>=r.sprintTarget) sprint="⚡ 已达成";
      else if(totalMin>=480) sprint="⏳ 时长差"+Math.ceil(480-totalMin)+"分";
      else sprint="差"+(r.sprintTarget-r.orders)+"单";
    }
    return {isMet:isMet,gap:gap,remTxt:remTxt,sprint:sprint};
  }

  // ---------- 数据加载 ----------
  function applyData(j){
    META=j.meta||{}; RIDERS=j.riders||[];
    __histCache = (j && j.history) || __histCache || {};
    var now=parseNow(META.now); NOW=now; ACTIVE=activeFor(now); ACTIVE_START=pStart(ACTIVE); ACTIVE_END=pEnd(ACTIVE); REMAIN=ACTIVE_END-now; TOMID=1440-now;
    snapshotToday();
    return j;
  }
  function loadData(){
    return fetch('/api/data', {cache:'no-store'}).then(function(r){ if(!r.ok) throw 0; return r.json(); })
      .then(function(j){ SOURCE='服务端实时数据'; return applyData(j); })
      .catch(function(){
        return fetch('data.json', {cache:'no-store'}).then(function(r){ if(!r.ok) throw 0; return r.json(); })
          .then(function(j){ SOURCE='本地 data.json'; return applyData(j); })
          .catch(function(){ SOURCE='内置示例数据'; return applyData(window.SAMPLE_DATA||{meta:{},riders:[]}); });
      });
  }

  // ---------- 顶部导航 ----------
  function navHTML(){
    var v=STATE.view, items=[["home","🏠 看板首页"],["id1","📊 实时骑手监控"],["id2","✅ 有效出勤监控"],["history","📈 历史30天"]];
    return '<div class="topnav" id="topnav">'+
      items.map(function(it){return '<div class="nav-i'+(v===it[0]?" on":"")+'" data-act="nav" data-view="'+it[0]+'">'+it[1]+'</div>';}).join("")+
      '</div>';
  }
  function refreshBarHTML(){
    var EXT = (typeof chrome!=='undefined' && chrome.runtime);
    var extBtns = EXT ? '<button data-act="openWindow">🖥️ 窗口打开</button><button data-act="copyRaw">📋 复制原始样本</button>' : '';
    return '<div class="refresh-bar"><span>数据来源：<b>'+(SOURCE||"加载中…")+'</b> · 数据截至 '+(META&&META.now||"-")+
      '</span><span class="ctrl"><label><input type="checkbox" data-act="auto" checked> 自动刷新(10s)</label>'+
      extBtns+
      '<button data-act="refresh">🔄 立即刷新</button></span></div>';
  }

  // ---------- 首页 ----------
  function renderHome(){
    var riders=RIDERS;
    var cur=riders.filter(function(r){return curState(r,NOW)!==null;});
    var curSched=cur.length;
    var curOn=cur.filter(function(r){return r.onlineStatus==="在线";}).length;
    var curAtt=cur.filter(function(r){return curState(r,NOW)===3;}).length;
    var curRate=curSched?(curAtt/curSched*100).toFixed(1)+"%":"0%";
    var onRate=curSched?(curOn/curSched*100).toFixed(1)+"%":"0%";
    var schedToday=riders.filter(function(r){return (r.schedule||[]).length>0;}).length;
    var dayDone=0,dayWill=0,dayFail=0; riders.forEach(function(r){var d=dayStatus(r,NOW);if(d==="done")dayDone++;else if(d==="will")dayWill++;else if(d==="fail")dayFail++;});
    var dayRate=schedToday?((dayDone+dayWill)/schedToday*100).toFixed(1)+"%":"0%";
    var total=riders.length;
    var id2sched=riders.filter(function(r){return (r.schedule||[]).length>0;}).length;
    var id2on=riders.filter(function(r){return r.onlineStatus==="在线";}).length;
    var id2deliv=riders.reduce(function(s,r){return s+(r.deliveryOrders||0);},0);
    var id2met=riders.filter(function(r){return effAtt(r,NOW).isMet;}).length;
    var id2rate=id2sched?(id2met/id2sched*100).toFixed(1)+"%":"0%";

    var html='<div class="hd"><h1>🏍️ 大众包 · 骑手实时出勤看板</h1>'+
      '<p>'+(META&&META.date||"")+' · 数据截至 '+(META&&META.now||"")+'</p>'+
      '<div class="pi">'+ACTIVE+'（'+fmtRange(ACTIVE)+'）· 剩余 '+fmtH(REMAIN)+'</div></div>'+
      '<div class="home-stat">'+
        stat(curSched,"当前时段排班")+stat(curOn,"当前在线")+stat(onRate,"当前在线率")+
        stat(curRate,"当前时段达标率")+stat(dayRate,"全天预计达成率")+stat(id2rate,"有效出勤达标率")+
        stat(id2deliv,"配送中单量")+
      '</div>'+
      '<div class="home">'+
        '<div class="home-card" data-act="nav" data-view="id1"><div class="ic">📊</div><div class="name">众包实时骑手监控</div>'+
          '<div class="desc">当前时段到岗与达标实时监控：各时段排班/在线/达标状态、全天达成情况，支持筛选排序。</div>'+
          '<div class="mini">'+mini("当前时段",ACTIVE)+mini("排班",curSched)+mini("在线",curOn)+mini("已达标",curAtt)+'</div><div class="arrow">›</div></div>'+
        '<div class="home-card" data-act="nav" data-view="id2"><div class="ic">✅</div><div class="name">有效出勤监控</div>'+
          '<div class="desc">有效出勤达标看板：在线 8 小时且完单达标，小队/运力线达成率汇总。</div>'+
          '<div class="mini">'+mini("总人数",total)+mini("达标",id2met)+mini("达标率",id2rate)+mini("配送中",id2deliv)+'</div><div class="arrow">›</div></div>'+
      '</div>';
    setApp(html);
  }
  function stat(n,l){return '<div class="s"><div class="n">'+n+'</div><div class="l">'+l+'</div></div>';}
  function mini(l,v){return '<div>'+l+'<b>'+v+'</b></div>';}
  function fmtRange(p){return pad(Math.floor(pStart(p)/60))+":"+pad(pStart(p)%60)+"~"+pad(Math.floor(pEnd(p)/60))+":"+pad(pEnd(p)%60);}
  function fmtH(min){var h=Math.floor(min/60),m=min%60;return (h?h+"时":"")+(m?m+"分":(h?"":"0分"));}

  // ---------- ID1 实时骑手监控 ----------
  function renderID1(){
    var header='<div class="hd"><div class="logic" data-act="rules">📖 看板逻辑</div>'+
      '<div class="reset" data-act="id1reset">重置筛选</div>'+
      '<h1>📊 众包实时骑手监控</h1>'+
      '<p>'+(META&&META.date||"")+' · <span class="data-ref">⏰ 数据截至 '+(META&&META.now||"")+'</span></p>'+
      '<div class="pi">'+ACTIVE+'（'+fmtRange(ACTIVE)+'）· 剩余 '+fmtH(REMAIN)+'</div></div>'+
      '<div class="dl-bar"><div class="dl-btn" data-act="export" data-which="id1">⬇️ 导出当前看板数据(CSV)</div>'+
      '<div class="dl-btn hist" data-act="export" data-which="id2">📈 导出有效出勤数据(CSV)</div></div>'+
      '<div class="tabs"><div class="tab'+(STATE.id1tab==="cur"?" active":"")+'" data-act="id1tab" data-tab="cur">🕐 当前时段达成</div>'+
      '<div class="tab'+(STATE.id1tab==="day"?" active day":"")+'" data-act="id1tab" data-tab="day">📅 全天时段达成</div></div>';

    var body = STATE.id1tab==="cur" ? secCur() : secDay();
    setApp(header+body);
    // 同步导航高亮
    syncNav("id1");
  }

  function secCur(){
    var rows=id1CurRows();
    var c=[0,0,0,0]; rows.forEach(function(x){c[x.state]++;});
    var sched=rows.length;
    var cards='<div class="cards">'+
      card("📋","排班总数",sched,"all")+card("✅","在线",rows.filter(function(x){return x.r.onlineStatus==="在线";}).length,"online")+
      card("📵","未在线",sched-rows.filter(function(x){return x.r.onlineStatus==="在线";}).length,"offline")+
      card("❌","确定不达标",c[0],"unreach")+card("⚠️","有风险",c[1],"risky")+
      card("🔵","预计达标",c[2],"will")+card("🏆","已达标",c[3],"attained")+'</div>';

    var ydlOpts='<option value="">全部运力线</option>'+["优选","蜂跑","优远"].map(function(y){return '<option value="'+y+'"'+(STATE.id1f.ydl===y?" selected":"")+'>'+y+'</option>';}).join("");
    var teams=teamsOf(STATE.id1f.ydl);
    var teamOpts='<option value="">全部小队</option>'+teams.map(function(t){return '<option value="'+esc(t)+'"'+(STATE.id1f.team===t?" selected":"")+'>'+esc(t)+'</option>';}).join("");
    var filters='<div class="ft"><select data-act="id1filter" data-f="ydl">'+ydlOpts+'</select>'+
      '<select data-act="id1filter" data-f="team">'+teamOpts+'</select></div>';

    var cols=[["name","骑手"],["team","小队"],["line","运力线"],["period","排班时段"],["inst","在线状态"],
      ["online","当前在线/要求"],["orders","当前完单/要求"],["maxo","最大单量"],["delivery","配送中"],["state","达标状态"]];
    var thead='<thead><tr>'+cols.map(function(c){return '<th data-key="'+c[0]+'"'+(STATE.id1sort.key===c[0]?' data-dir="'+(STATE.id1sort.dir===1?"asc":"desc")+'"':"")+'>'+c[1]+'</th>';}).join("")+'</tr></thead>';
    var tbody='<tbody>'+rows.map(function(x){return curRow(x);}).join("")+'</tbody>';
    var table='<div class="tw"><table>'+thead+formHeadNote()+tbody+'</table></div>';
    var cnt='<div class="cnt">筛选结果：'+rows.length+' 条记录（当前时段排班 '+sched+' 条）</div>';
    return '<div class="section" id="sec-cur"><div class="sec-head"><div class="sec-ic sec-ic-cur">🕐</div>'+
      '<div><div class="sec-tit">当前时段达成</div><div class="sec-sub">'+ACTIVE+' · 剩余 '+fmtH(REMAIN)+' · 到岗与达标实时监控</div></div></div>'+
      cards+filters+cnt+table+'</div>';
  }
  function formHeadNote(){return '';}
  function card(ic,l,n,key){return '<div class="cd" data-act="id1card" data-card="'+key+'"><div class="ic">'+ic+'</div><div class="n">'+n+'</div><div class="l">'+l+'</div></div>';}
  function hcard(ic,l,n){return '<div class="cd"><div class="ic">'+ic+'</div><div class="n">'+n+'</div><div class="l">'+l+'</div></div>';}
  function teamsOf(ydl){
    var set={}; RIDERS.forEach(function(r){ if(!ydl||r.ydl===ydl) set[r.xiaodui]=1; });
    return Object.keys(set).sort();
  }
  function id1CurRows(){
    var rows=RIDERS.map(function(r){
      var ent=findPeriod(r,ACTIVE); if(!ent) return null;
      var st=curState(r,NOW); if(st===null) return null;
      return {r:r,ent:ent,state:st};
    }).filter(Boolean);
    rows=rows.filter(function(x){return (!STATE.id1f.ydl||x.r.ydl===STATE.id1f.ydl)&&(!STATE.id1f.team||x.r.xiaodui===STATE.id1f.team);});
    if(STATE.id1card&&STATE.id1card!=="all"){
      rows=rows.filter(function(x){
        if(STATE.id1card==="online")return x.r.onlineStatus==="在线";
        if(STATE.id1card==="offline")return x.r.onlineStatus!=="在线";
        return x.state==={"unreach":0,"risky":1,"will":2,"attained":3}[STATE.id1card];
      });
    }
    if(STATE.id1sort.key){
      var k=STATE.id1sort.key,dir=STATE.id1sort.dir;
      rows.sort(function(a,b){var va=curVal(a,k),vb=curVal(b,k);
        if(typeof va==="number"&&typeof vb==="number")return dir*(va-vb);
        return dir*String(va).localeCompare(String(vb),"zh");});
    }
    return rows;
  }
  function curVal(x,k){
    var r=x.r,ent=x.ent;
    return k==="name"?r.name:k==="team"?r.xiaodui:k==="line"?r.ydl:k==="period"?r.schedule.join("、"):
      k==="inst"?r.onlineStatus:k==="online"?ent.onlineMin:k==="orders"?ent.orders:
      k==="maxo"?ent.maxOrders:k==="delivery"?(ent.delivery||0):k==="state"?x.state:0;
  }
  function curRow(x){
    var r=x.r,ent=x.ent,st=x.state,std=stdFor(ACTIVE,r.ydl);
    var stateBadge, note;
    if(st===3){stateBadge='<span class="tg tg-ok">🏆 已达标</span>';note="";}
    else if(st===2){stateBadge='<span class="tg tg-wl">🔵 预计达标</span>';note="在线 "+fmtDur(ent.onlineMin)+"/"+fmtDur(std[0])+" · 剩余 "+fmtH(REMAIN)+"可达标";}
    else if(st===1){stateBadge='<span class="tg tg-rk">⚠️ 有风险</span>';note=r.onlineStatus!=="在线"?"未在线":("完单+配送 "+(ent.orders+(ent.delivery||0))+"/"+std[1]+" 不足");}
    else {stateBadge='<span class="tg tg-no">❌ 确定不达标</span>';note="在线 "+fmtDur(ent.onlineMin)+"/"+fmtDur(std[0])+" · 剩余 "+fmtH(REMAIN)+"也不够最低时长";}
    var dt=dayTag(r,NOW);
    var tag = dt==="fail"?'<span class="nft-day">全天不达标</span>':dt==="new"?'<span class="nft-new">新增全天不达标</span>':"";
    var olTag=r.onlineStatus==="在线"?'<span class="tag tag-on">● 在线</span>':'<span class="tag tag-off">○ 离线</span>';
    var nameCell='<td class="ta-l"><span class="rn rider-link" data-act="phone" data-name="'+esc(r.name)+'" data-id="'+esc(r.id)+'" data-team="'+esc(r.xiaodui)+'" data-line="'+esc(r.ydl)+'" data-phone="'+esc(r.phone||"")+'">'+esc(r.name)+'</span>'+
      '<span class="rid">'+esc(r.id)+'</span>'+tag+'</td>';
    return '<tr>'+nameCell+
      '<td>'+esc(r.xiaodui)+'</td><td>'+esc(r.ydl)+'</td>'+
      '<td class="ta-l" style="font-size:11px">'+esc(r.schedule.join("、"))+'</td>'+
      '<td>'+olTag+'</td>'+
      '<td>'+fmtDur(ent.onlineMin)+' / '+fmtDur(std[0])+'</td>'+
      '<td>'+ent.orders+' / '+std[1]+'</td>'+
      '<td>'+(ent.maxOrders||"-")+'</td>'+
      '<td>'+(ent.delivery||0)+'</td>'+
      '<td>'+stateBadge+(note?'<span class="nt">'+esc(note)+'</span>':"")+'</td></tr>';
  }

  function secDay(){
    var riders=RIDERS.filter(function(r){return (r.schedule||[]).length>0;});
    var done=0,will=0,fail=0; riders.forEach(function(r){var d=dayStatus(r,NOW);if(d==="done")done++;else if(d==="will")will++;else if(d==="fail")fail++;});
    var rate=riders.length?((done+will)/riders.length*100).toFixed(1)+"%":"0%";
    var cards='<div class="cards">'+
      card("📊","今日排班",riders.length,"")+card("🌟","全天达成",done,"")+card("🔮","预计达标",will,"")+
      card("🔴","未达标",fail,"")+card("🏅","达成率",rate,"")+'</div>';
    // 运力线维度
    var byLine=groupDay("ydl");
    var byTeam=groupDay("xiaodui");
    var lineT=dimTable(byLine,"运力线维度",true);
    var teamT=dimTable(byTeam,"小队维度",false);
    return '<div class="section" id="sec-day"><div class="sec-head"><div class="sec-ic sec-ic-day">📅</div>'+
      '<div><div class="sec-tit">全天时段达成</div><div class="sec-sub">'+(META&&META.date||"")+' · 各时段完成情况复盘</div></div></div>'+
      cards+lineT+teamT+'</div>';
  }
  function groupDay(key){
    var map={};
    RIDERS.forEach(function(r){
      if(!(r.schedule||[]).length) return;
      var g=r[key]; if(!map[g]) map[g]={sched:0,done:0,will:0,fail:0};
      map[g].sched++;
      var d=dayStatus(r,NOW); if(d==="done")map[g].done++;else if(d==="will")map[g].will++;else if(d==="fail")map[g].fail++;
    });
    return map;
  }
  function dimTable(map,title,isLine){
    var keys=Object.keys(map).sort();
    var rows=keys.map(function(k){
      var m=map[k]; var rate=m.sched?((m.done+m.will)/m.sched*100):0;
      var cls=isLine?'<span class="tag tag-b">'+esc(k)+'</span>':esc(k);
      return '<tr><td>'+(isLine?cls:'<b>'+esc(k)+'</b>')+'</td>'+
        (isLine?'':'<td>'+esc(k)+'</td>')+
        '<td>'+m.sched+'</td><td class="g">'+m.done+'</td><td class="b">'+m.will+'</td><td class="r">'+m.fail+'</td>'+
        '<td><div class="rate-bar"><div class="rate-fill" style="width:'+Math.min(100,Math.round(rate))+'%"></div></div><span class="rate-txt">'+rate.toFixed(1)+'%</span></td></tr>';
    }).join("");
    var head=isLine?'<th>运力线</th>':'<th>小队</th>';
    return '<div class="pd-box"><div class="sm" style="font-weight:600">🚚 '+title+'</div><div class="tw"><table><thead><tr>'+head+
      '<th>排班</th><th>✅ 全天达成</th><th>🔵 预计达标</th><th>❌ 未达标</th><th>达成率</th></tr></thead><tbody>'+rows+'</tbody></table></div></div>';
  }

  // ---------- ID2 有效出勤监控 ----------
  function renderID2(){
    var header='<div class="hd"><h1>🏍️ 有效出勤监控</h1>'+
      '<div class="sub">数据日期：'+(META&&META.date||"")+' | 截至北京时间 '+(META&&META.now||"")+' | 剩余 '+fmtH(TOMID)+' 至今日24:00</div>'+
      '<div class="dl-bar"><div class="dl-btn" data-act="export" data-which="id2">⬇️ 导出有效出勤数据(CSV)</div></div></div>';
    var riders=RIDERS;
    var total=riders.length;
    var sched=riders.filter(function(r){return (r.schedule||[]).length>0;}).length;
    var on=riders.filter(function(r){return r.onlineStatus==="在线";}).length;
    var deliv=riders.reduce(function(s,r){return s+(r.deliveryOrders||0);},0);
    var met=riders.filter(function(r){return effAtt(r,NOW).isMet;}).length;
    var rate=sched?(met/sched*100).toFixed(1)+"%":"0%";
    var cards='<div class="cards c6">'+
      card("👥","总人数",total,"")+card("📋","排班人数",sched,"")+card("🟢","当前在线",on,"")+
      card("🛵","配送中单量",deliv,"")+card("✅","达标人数",met,"")+card("📊","达标率",rate,"")+'</div>';
    var tabs='<div class="tabs"><div class="tab'+(STATE.id2tab===0?" active":"")+'" data-act="id2tab" data-tab="0">📋 骑手达成明细</div>'+
      '<div class="tab'+(STATE.id2tab===1?" active":"")+'" data-act="id2tab" data-tab="1">👥 小队维度汇总</div>'+
      '<div class="tab'+(STATE.id2tab===2?" active":"")+'" data-act="id2tab" data-tab="2">📊 运力线维度汇总</div></div>';
    var body;
    if(STATE.id2tab===0) body=id2RiderPane();
    else if(STATE.id2tab===1) body=id2TeamPane();
    else body=id2LinePane();
    setApp(header+cards+tabs+body);
    syncNav("id2");
  }
  // ---------- 历史30天 · 骑手累计明细看板 ----------
  function renderHistory(){
    var dates = historyDates();
    var sel = STATE.histSel || dates[0] || "";
    var day = sel ? getDay(sel) : null;
    var riders = day ? (day.riders||[]) : [];
    // 累计明细：每个骑手近30天一行（以最新一天的小队/运力线为准，聚合各天在线时长、完单、达标天数）
    var byId = {};
    dates.forEach(function(d){
      var dd = getDay(d); if(!dd) return;
      (dd.riders||[]).forEach(function(r){
        var k = r.id || (r.name+"_"+r.xiaodui);
        if(!byId[k]) byId[k] = {id:r.id, name:r.name, xiaodui:r.xiaodui, ydl:r.ydl,
          days:0, onlineSum:0, orderSum:0, metDays:0, schedDays:0};
        var o = byId[k];
        o.days++; if((r.schedule||[]).length>0) o.schedDays++;
        o.onlineSum += parseFloat(r.onlineH||0);
        o.orderSum  += parseInt(r.orders||0,10);
        if(effAtt(r, parseNow((dd.meta||{}).now)).isMet) o.metDays++;
      });
    });
    var rows = Object.keys(byId).map(function(k){return byId[k];});
    // 筛选
    var f = STATE.histF || {};
    rows = rows.filter(function(o){
      if(f.ydl && o.ydl!==f.ydl) return false;
      if(f.team && o.xiaodui!==f.team) return false;
      if(f.name && (o.name||"").toLowerCase().indexOf((f.name||"").toLowerCase())<0) return false;
      return true;
    });
    var totalDays = dates.length || 1;
    var cards = '<div class="cards c6">'+
      hcard("📅","历史天数",dates.length)+hcard("👥","累计骑手",rows.length)+hcard("🛵","累计完单",rows.reduce(function(s,o){return s+o.orderSum;},0))+
      hcard("⏱️","累计在线(h)",Math.round(rows.reduce(function(s,o){return s+o.onlineSum;},0)*10)/10)+hcard("✅","累计达标人次",rows.reduce(function(s,o){return s+o.metDays;},0))+
      hcard("📊","平均达标率",(rows.length?(rows.reduce(function(s,o){return s+o.metDays;},0)/(rows.length*totalDays)*100):0).toFixed(1)+"%")+
      '</div>';

    var ydlOpts='<option value="">全部运力线</option>'+["优选","蜂跑","优远"].map(function(y){return '<option value="'+y+'"'+(f.ydl===y?" selected":"")+'>'+y+'</option>';}).join("");
    var teams=teamsOf(f.ydl);
    var teamOpts='<option value="">全部小队</option>'+teams.map(function(t){return '<option value="'+esc(t)+'"'+(f.team===t?" selected":"")+'>'+esc(t)+'</option>';}).join("");
    var filters='<div class="fbox"><div class="fbox-title">筛选条件</div><div class="frow">'+
      '<select data-act="histFilter" data-f="ydl">'+ydlOpts+'</select>'+
      '<select data-act="histFilter" data-f="team">'+teamOpts+'</select>'+
      '<input type="text" placeholder="🔍 搜索骑手姓名" data-act="histFilter" data-f="name" value="'+esc(f.name||"")+'">'+
      '<button class="btn-reset" data-act="histreset">↻ 重置</button></div></div>';

    var thead='<thead><tr><th>运力线</th><th>小队</th><th>骑手</th><th>参与天数</th><th>排班天数</th>'+
      '<th>累计在线(h)</th><th>累计完单</th><th>达标天数</th><th>达标率</th></tr></thead>';
    var tbody='<tbody>'+rows.map(function(o){
      var rate=(o.days?o.metDays/o.days*100:0).toFixed(1)+"%";
      return '<tr><td><span class="tag tag-b">'+esc(o.ydl)+'</span></td><td>'+esc(o.xiaodui)+'</td>'+
        '<td>'+esc(o.name)+'</td><td>'+o.days+'</td><td>'+o.schedDays+'</td>'+
        '<td>'+Math.round(o.onlineSum*10)/10+'</td><td>'+o.orderSum+'</td><td>'+o.metDays+'</td>'+
        '<td><div class="rate-bar"><div class="rate-fill" style="width:'+Math.min(100,Math.round(o.days?o.metDays/o.days*100:0))+'%"></div></div><span class="rate-txt">'+rate+'</span></td></tr>';
    }).join("")+'</tbody>';

    var dateBar = '<div class="dl-bar"><div class="dl-btn" data-act="exportHistory">⬇️ 导出累计明细(CSV)</div>'+
      '<div class="dl-btn" data-act="nav" data-view="id1">📊 看今日实时</div></div>';

    var html = '<div class="hd"><h1>📈 历史30天 · 骑手累计明细</h1>'+
      '<p>近 '+dates.length+' 天本地累积数据（每日首次加载自动快照）· 当前选中：'+(sel||"无")+'</p></div>'+
      dateBar + cards + filters +
      '<div class="tw"><table>'+thead+tbody+'</table></div>'+
      '<div class="cnt">累计明细：'+rows.length+' 名骑手</div>';
    setApp(html);
    syncNav("history");
  }

  function exportHistory(){
    var dates = historyDates();
    var byId = {};
    dates.forEach(function(d){
      var dd = getDay(d); if(!dd) return;
      (dd.riders||[]).forEach(function(r){
        var k = r.id || (r.name+"_"+r.xiaodui);
        if(!byId[k]) byId[k] = {id:r.id, name:r.name, xiaodui:r.xiaodui, ydl:r.ydl, days:0, onlineSum:0, orderSum:0, metDays:0, schedDays:0};
        var o = byId[k];
        o.days++; if((r.schedule||[]).length>0) o.schedDays++;
        o.onlineSum += parseFloat(r.onlineH||0);
        o.orderSum  += parseInt(r.orders||0,10);
        if(effAtt(r, parseNow((dd.meta||{}).now)).isMet) o.metDays++;
      });
    });
    var f = STATE.histF || {};
    var rows = Object.keys(byId).map(function(k){return byId[k];}).filter(function(o){
      if(f.ydl && o.ydl!==f.ydl) return false;
      if(f.team && o.xiaodui!==f.team) return false;
      if(f.name && (o.name||"").toLowerCase().indexOf((f.name||"").toLowerCase())<0) return false;
      return true;
    });
    var cols=[{k:"ydl",label:"运力线"},{k:"xiaodui",label:"小队"},{k:"name",label:"骑手"},{k:"days",label:"参与天数"},
      {k:"schedDays",label:"排班天数"},{k:"onlineSum",label:"累计在线(h)"},{k:"orderSum",label:"累计完单"},
      {k:"metDays",label:"达标天数"},{k:"rate",label:"达标率"}];
    var lines=[cols.map(function(c){return c.label;}).join(",")];
    rows.forEach(function(o){var rate=(o.days?o.metDays/o.days*100:0).toFixed(1)+"%";
      lines.push(cols.map(function(c){var v=c.k==="onlineSum"?Math.round(o.onlineSum*10)/10:(c.k==="rate"?rate:o[c.k]);
        return '"'+String(v==null?"":v).replace(/"/g,'""')+'"';}).join(","));});
    var blob=new Blob(["\uFEFF"+lines.join("\n")],{type:"text/csv;charset=utf-8"});
    var a=document.createElement("a"); a.href=URL.createObjectURL(blob); a.download="历史30天_骑手累计明细.csv"; document.body.appendChild(a); a.click(); if(a.remove)a.remove();
  }

  function id2Filters(){
    var ydlOpts='<option value="">全部运力线</option>'+["优选","蜂跑","优远"].map(function(y){return '<option value="'+y+'"'+(STATE.id2f.ydl===y?" selected":"")+'>'+y+'</option>';}).join("");
    var teams=teamsOf(STATE.id2f.ydl);
    var teamOpts='<option value="">全部小队</option>'+teams.map(function(t){return '<option value="'+esc(t)+'"'+(STATE.id2f.team===t?" selected":"")+'>'+esc(t)+'</option>';}).join("");
    var periodOpts='<option value="">排班时段</option>'+PERIODS.map(function(p){return '<option value="'+p[0]+'"'+(STATE.id2f.period===p[0]?" selected":"")+'>'+p[0]+'</option>';}).join("");
    return '<div class="fbox"><div class="fbox-title">筛选条件</div><div class="frow">'+
      '<select data-act="id2filter" data-f="ydl">'+ydlOpts+'</select>'+
      '<select data-act="id2filter" data-f="team">'+teamOpts+'</select>'+
      '<select data-act="id2filter" data-f="status"><option value="">达标状态</option><option value="met">✅ 已达标</option><option value="not">❌ 未达标</option></select>'+
      '<input type="text" placeholder="🔍 搜索骑手姓名" data-act="id2filter" data-f="name" value="'+esc(STATE.id2f.name||"")+'">'+
      '</div><div class="frow">'+
      '<select data-act="id2filter" data-f="online"><option value="">在线状态</option><option value="在线">🟢 在线</option><option value="离线">⚫ 离线</option></select>'+
      '<select data-act="id2filter" data-f="sched"><option value="">是否排班</option><option value="是">📋 排班</option><option value="否">🚫 未排班</option></select>'+
      '<select data-act="id2filter" data-f="period">'+periodOpts+'</select>'+
      '<select data-act="id2filter" data-f="cap"><option value="">是否队长</option><option value="是">👑 队长</option><option value="否">队员</option></select>'+
      '<select data-act="id2filter" data-f="nw"><option value="">新/老骑手</option><option value="是">🆕 新骑手</option><option value="否">老骑手</option></select>'+
      '<button class="btn-reset" data-act="id2reset">↻ 重置筛选</button>'+
      '</div></div>';
  }
  function id2Filtered(){
    var f=STATE.id2f;
    return RIDERS.filter(function(r){
      if(f.ydl&&r.ydl!==f.ydl)return false;
      if(f.team&&r.xiaodui!==f.team)return false;
      if(f.status==="met"&&!effAtt(r,NOW).isMet)return false;
      if(f.status==="not"&&effAtt(r,NOW).isMet)return false;
      if(f.name&&r.name.toLowerCase().indexOf(f.name.toLowerCase())<0)return false;
      if(f.online&&r.onlineStatus!==f.online)return false;
      var sched=(r.schedule||[]).length>0;
      if(f.sched==="是"&&!sched)return false;
      if(f.sched==="否"&&sched)return false;
      if(f.period&&(r.schedule||[]).indexOf(f.period)<0)return false;
      if(f.cap&&r.isCaptain!==f.cap)return false;
      if(f.nw&&r.isNew!==f.nw)return false;
      return true;
    });
  }
  function id2RiderPane(){
    var rows=id2Filtered();
    var cols=[["ydl","运力线"],["xiaodui","小队"],["name","骑手姓名"],["onlineStatus","在线状态"],["sched","是否排班"],
      ["period","当天时段"],["onlineH","在线时长"],["orders","完成单量"],["sprint","40单冲刺"],["deliveryOrders","配送单量"],["isMet","是否达标"],["gap","差多少单"],["rem","剩余时间"]];
    var thead='<thead><tr>'+cols.map(function(c,i){return '<th data-col="'+i+'"'+(STATE.id2sort.col===i?' data-dir="'+(STATE.id2sort.dir===1?"asc":"desc")+'"':"")+'>'+c[1]+'</th>';}).join("")+'</tr></thead>';
    // sort
    if(STATE.id2sort.col>=0){
      var k=cols[STATE.id2sort.col][0],dir=STATE.id2sort.dir;
      rows=rows.slice().sort(function(a,b){var va=id2Val(a,k),vb=id2Val(b,k);
        if(typeof va==="number"&&typeof vb==="number")return dir*(va-vb);
        return dir*String(va).localeCompare(String(vb),"zh");});
    }
    var tbody='<tbody>'+rows.map(function(r){return id2Row(r);}).join("")+'</tbody>';
    var cnt='<div class="cnt">筛选结果：'+rows.length+' 条记录（共 '+RIDERS.length+' 条）</div>';
    return id2Filters()+cnt+'<div class="tw"><table>'+thead+tbody+'</table></div>';
  }
  function id2Val(r,k){
    var e=effAtt(r,NOW);
    return k==="ydl"?r.ydl:k==="xiaodui"?r.xiaodui:k==="name"?r.name:k==="onlineStatus"?r.onlineStatus:
      k==="sched"?((r.schedule||[]).length>0?"是":"否"):k==="period"?r.schedule.join("、"):
      k==="onlineH"?r.onlineH:k==="orders"?r.orders:k==="sprint"?r.sprintTarget:
      k==="deliveryOrders"?r.deliveryOrders:k==="isMet"?(e.isMet?1:0):k==="gap"?e.gap:
      k==="rem"?remMin(e.remTxt):0;
  }
  function remMin(t){var m=t.match(/(\d+)分钟/);return m?parseInt(m[1],10):999;}
  function id2Row(r){
    var e=effAtt(r,NOW);
    var olTag=r.onlineStatus==="在线"?'<span class="tag tag-on">● 在线</span>':'<span class="tag tag-off">○ 离线</span>';
    var pbTag=((r.schedule||[]).length>0)?'<span class="tag tag-yes">排班</span>':'<span class="tag tag-no">未排班</span>';
    var metTag=e.isMet?'<span class="g">已达标</span>':'<span class="r">未达标</span>';
    var gapTag=!((r.schedule||[]).length>0)?'<span class="tag tag-g">-</span>':(e.isMet?'<span class="tag tag-g">已达标</span>':'<span class="tag tag-o">'+e.gap+'单</span>');
    var remTag=!((r.schedule||[]).length>0)?'-':(e.remTxt.indexOf("已满足")>=0?'<span class="g">已满足</span>':(e.remTxt.indexOf("可满足")>=0?'<span class="o">'+esc(e.remTxt)+'</span>':'<span class="r">'+esc(e.remTxt)+'</span>'));
    var sprintTag=e.sprint==="-"?'-':(e.sprint.indexOf("已达成")>=0?'<span class="g">'+esc(e.sprint)+'</span>':(e.sprint.indexOf("差")>=0?'<span class="o">'+esc(e.sprint)+'</span>':'<span class="o">'+esc(e.sprint)+'</span>'));
    var nameCell='<td class="ta-l"><span class="rn rider-link" data-act="phone" data-name="'+esc(r.name)+'" data-id="'+esc(r.id)+'" data-team="'+esc(r.xiaodui)+'" data-line="'+esc(r.ydl)+'" data-phone="'+esc(r.phone||"")+'">'+esc(r.name)+'</span>'+
      '<span class="rid">'+esc(r.id)+'</span></td>';
    return '<tr>'+'<td>'+esc(r.ydl)+'</td><td>'+esc(r.xiaodui)+'</td>'+nameCell.replace('<td','<td')+
      '<td>'+olTag+'</td><td>'+pbTag+'</td><td class="ta-l" style="font-size:11px">'+esc(r.schedule.join("、"))+'</td>'+
      '<td>'+r.onlineH+'h</td><td>'+r.orders+'/'+r.orderTarget+'</td><td>'+sprintTag+'</td><td>'+(r.deliveryOrders||0)+'</td>'+
      '<td class="'+(e.isMet?"g":"r")+'">'+metTag+'</td><td>'+gapTag+'</td><td>'+remTag+'</td></tr>';
  }
  function id2TeamPane(){
    var groups={};
    RIDERS.forEach(function(r){var g=r.xiaodui;if(!groups[g])groups[g]={ydl:r.ydl,total:0,sched:0,met:0,sprint:0};
      groups[g].total++; if((r.schedule||[]).length>0)groups[g].sched++;
      if(effAtt(r,NOW).isMet)groups[g].met++;
      if(r.sprintTarget>0&&r.orders>=r.sprintTarget)groups[g].sprint++;});
    var keys=Object.keys(groups).sort();
    var rows=keys.map(function(k){var m=groups[k];var rate=m.sched?m.met/m.sched*100:0;
      return '<tr><td><span class="tag tag-b">'+esc(m.ydl)+'</span></td><td><b>'+esc(k)+'</b></td><td>'+m.total+'</td><td>'+m.sched+
        '</td><td class="g">'+m.met+'</td><td class="'+(m.sprint?'g':'r')+'">'+m.sprint+'</td>'+
        '<td><div class="rate-bar"><div class="rate-fill" style="width:'+Math.min(100,Math.round(rate))+'%"></div></div><span class="rate-txt">'+rate.toFixed(1)+'%</span></td></tr>';}).join("");
    var sumT='<div class="tw"><table><thead><tr><th>运力线</th><th>小队</th><th>总人数</th><th>排班人数</th><th>达标人数</th><th>40单冲刺达成</th><th>达标率</th></tr></thead><tbody>'+rows+'</tbody></table></div>';
    return '<div class="section"><div class="sec-head"><div class="sec-ic sec-ic-cur">👥</div><div><div class="sec-tit">小队维度汇总</div><div class="sec-sub">共 '+keys.length+' 个小队</div></div></div>'+sumT+'</div>';
  }
  function id2LinePane(){
    var groups={};
    RIDERS.forEach(function(r){var g=r.ydl;if(!groups[g])groups[g]={total:0,sched:0,met:0,sprint:0};
      groups[g].total++; if((r.schedule||[]).length>0)groups[g].sched++;
      if(effAtt(r,NOW).isMet)groups[g].met++;
      if(r.sprintTarget>0&&r.orders>=r.sprintTarget)groups[g].sprint++;});
    var keys=Object.keys(groups).sort();
    var rows=keys.map(function(k){var m=groups[k];var rate=m.sched?m.met/m.sched*100:0;
      return '<tr><td><span class="tag tag-b">'+esc(k)+'</span></td><td>'+m.total+'</td><td>'+m.sched+
        '</td><td class="g">'+m.met+'</td><td class="'+(m.sprint?'g':'r')+'">'+m.sprint+'</td>'+
        '<td><div class="rate-bar"><div class="rate-fill" style="width:'+Math.min(100,Math.round(rate))+'%"></div></div><span class="rate-txt">'+rate.toFixed(1)+'%</span></td></tr>';}).join("");
    var sumT='<div class="tw"><table><thead><tr><th>运力线</th><th>总人数</th><th>排班人数</th><th>达标人数</th><th>40单冲刺达成</th><th>达标率</th></tr></thead><tbody>'+rows+'</tbody></table></div>';
    return '<div class="section"><div class="sec-head"><div class="sec-ic sec-ic-day">📊</div><div><div class="sec-tit">运力线维度汇总</div></div></div>'+sumT+'</div>';
  }

  // ---------- 弹窗 ----------
  function rulesHTML(){
    var rows=PERIODS.map(function(p){var s=STANDARDS[p[0]];
      return '<tr><td><b>'+p[0]+'</b></td><td>'+fmtRange(p[0])+'</td><td>≥'+s.优选[0]+'分<br>≥'+s.优选[1]+'单</td><td>≥'+s.蜂跑[0]+'分<br>≥'+s.蜂跑[1]+'单</td><td>≥'+s.优远[0]+'分<br>≥'+s.优远[1]+'单</td></tr>';}).join("");
    return '<div class="rules-box"><h3>🎯 达标判定口径（当前时段）</h3>'+
      '<div class="rli">✅ <b>已达标</b>：在线时长 ≥ 该时段最低时长，且 完成单量 ≥ 最低单量。</div>'+
      '<div class="rli">❌ <b>确定不达标</b>：当前在线时长 + 本时段剩余时间 &lt; 最低时长（时间上已无法补齐）。</div>'+
      '<div class="rli">⚠️ <b>有风险</b>：未在线 / 完单+配送 &lt; 最低单量。</div>'+
      '<div class="rli">🔵 <b>预计达标</b>：剩余时间可补齐最低时长，且当前在线有单。</div>'+
      '<div class="rli">🚫 <b>全天不达标</b>：骑手今日已结束的排班时段中存在未达标时段。</div>'+
      '<div class="rli">🆕 <b>新增全天不达标</b>：当前时段已确定不达标，且本时段之前已结束的排班时段均达标（即本时段是今天首个把该骑手拖入全天不达标的时段）。</div>'+
      '<h3>📅 全天状态口径</h3>'+
      '<div class="rli">历史时段达标：该时段在线时长 ≥ 最低时长 且 时段完单量 ≥ 最低单量。</div>'+
      '<div class="rli">❌ <b>未达标</b>：已结束的排班时段中，存在任一时段未达标。</div>'+
      '<div class="rli">✅ <b>全天达成</b>：所有已结束时段均达标，且无未开始时段。</div>'+
      '<div class="rli">🔵 <b>预计达标</b>：已结束时段全部达标，仍有未开始时段。</div>'+
      '<div class="rli">🏅 <b>达成率</b> =（全天达成 + 预计达标）÷ 今日排班人数。</div>'+
      '<h3>⏱️ 各运力线 · 各时段标准</h3>'+
      '<table><thead><tr><th>时段</th><th>时间区间</th><th>优选</th><th>蜂跑</th><th>优远</th></tr></thead><tbody>'+rows+'</tbody></table>'+
      '<div class="rtip">优选的在线时长标准与蜂跑/优远保持一致，单量要求各线独立。有效出勤口径：在线 ≥ 8 小时（480 分钟）且 完单 ≥ 当日目标单量（默认 20 单，部分蜂跑 30 单）；「40 单冲刺」仅蜂跑适用。</div>'+'+'+
      '<div class="rtip" style="color:var(--warn)">⚠️ 实时数据说明：接口按「当前时段」返回，当前时段「在线时长」以全天在线时长近似（接口仅提供全天在线），「当前完单」取时段完单 timeFinishOrder；时段达标判定以订单口径为主。若需逐时段精确时长，请提供一次 listKnightAttendance 返回的完整骑手对象。</div>'
      '</div>';
  }

  // ---------- 渲染调度 ----------
  function setApp(html){document.getElementById("app").innerHTML=html;}
  function syncNav(v){
    var nav=document.getElementById("topnav");
    if(!nav) return;
    var items=nav.querySelectorAll(".nav-i");
    for(var i=0;i<items.length;i++){items[i].className="nav-i"+(items[i].getAttribute("data-view")===v?" on":"");}
  }
  function render(){
    if(STATE.view==="home") renderHome();
    else if(STATE.view==="id1") renderID1();
    else if(STATE.view==="id2") renderID2();
    else if(STATE.view==="history") renderHistory();
    document.getElementById("refreshBar").innerHTML=refreshBarHTML();
  }
  function boot(){
    document.getElementById("topnav").outerHTML=navHTML();
    render();
  }

  // ---------- 导出 CSV ----------
  function exportCSV(which){
    var rows, cols, name;
    if(which==="id1"){
      rows=id1CurRows().map(function(x){var r=x.r,ent=x.ent,std=stdFor(ACTIVE,r.ydl),e=effAtt(r,NOW);
        return {a:r.ydl,b:r.xiaodui,c:r.name,d:r.schedule.join("、"),e:r.onlineStatus,
          f:ent.onlineMin,g:std[0],h:ent.orders,i:std[1],j:ent.maxOrders,k:ent.delivery||0,l:["确定不达标","有风险","预计达标","已达标"][x.state],m:r.onlineH,n:r.orders,o:r.orderTarget,p:e.isMet?"是":"否",q:e.gap};});
      cols=[{k:"a",label:"运力线"},{k:"b",label:"小队"},{k:"c",label:"骑手"},{k:"d",label:"排班时段"},{k:"e",label:"在线状态"},
        {k:"f",label:"当前时段在线(分)"},{k:"g",label:"要求时长(分)"},{k:"h",label:"当前完单"},{k:"i",label:"要求单量"},{k:"j",label:"最大单量"},{k:"k",label:"配送中"},{k:"l",label:"达标状态"},{k:"m",label:"全天在线(h)"},{k:"n",label:"全天完单"},{k:"o",label:"目标单量"},{k:"p",label:"有效出勤达标"},{k:"q",label:"差多少单"}];
      name="实时骑手监控_"+ACTIVE+".csv";
    } else {
      rows=id2Filtered().map(function(r){var e=effAtt(r,NOW);
        return {a:r.ydl,b:r.xiaodui,c:r.name,d:r.onlineStatus,e:(r.schedule||[]).length>0?"是":"否",f:r.schedule.join("、"),
          g:r.onlineH,h:r.orders+"/"+r.orderTarget,i:r.sprintTarget,j:r.deliveryOrders,k:e.isMet?"已达标":"未达标",l:e.gap,m:e.remTxt,n:e.sprint};});
      cols=[{k:"a",label:"运力线"},{k:"b",label:"小队"},{k:"c",label:"骑手姓名"},{k:"d",label:"在线状态"},{k:"e",label:"是否排班"},{k:"f",label:"当天时段"},
        {k:"g",label:"在线时长(h)"},{k:"h",label:"完成单量/目标"},{k:"i",label:"40单冲刺目标"},{k:"j",label:"配送单量"},{k:"k",label:"是否达标"},{k:"l",label:"差多少单"},{k:"m",label:"剩余时间"},{k:"n",label:"40单冲刺"}];
      name="有效出勤监控.csv";
    }
    var lines=[cols.map(function(c){return c.label;}).join(",")];
    rows.forEach(function(row){lines.push(cols.map(function(c){return '"'+String(row[c.k]==null?"":row[c.k]).replace(/"/g,'""')+'"';}).join(","));});
    var blob=new Blob(["\uFEFF"+lines.join("\n")],{type:"text/csv;charset=utf-8"});
    var a=document.createElement("a"); a.href=URL.createObjectURL(blob); a.download=name; document.body.appendChild(a); a.click(); if(a.remove)a.remove();
  }

  // ---------- 事件 ----------
  function onClick(e){
    var t=e.target.closest("[data-act]"); if(!t) return;
    var act=t.getAttribute("data-act");
    if(act==="nav"){STATE.view=t.getAttribute("data-view");render();window.scrollTo(0,0);}
    else if(act==="id1tab"){STATE.id1tab=t.getAttribute("data-tab");render();}
    else if(act==="id2tab"){STATE.id2tab=parseInt(t.getAttribute("data-tab"),10);render();}
    else if(act==="id1card"){STATE.id1card=t.getAttribute("data-card");render();}
    else if(act==="id1reset"){STATE.id1f={ydl:"",team:""};STATE.id1card="";STATE.id1sort={key:"",dir:1};render();}
    else if(act==="id2reset"){STATE.id2f={ydl:"",team:"",status:"",name:"",online:"",sched:"",period:"",cap:"",nw:""};STATE.id2sort={col:-1,dir:1};render();}
    else if(act==="id1sort"){var k=t.getAttribute("data-key");STATE.id1sort={key:k,dir:STATE.id1sort.key===k?(STATE.id1sort.dir*-1):1};render();}
    else if(act==="id2sort"){var c=parseInt(t.getAttribute("data-col"),10);STATE.id2sort={col:c,dir:STATE.id2sort.col===c?(STATE.id2sort.dir*-1):1};render();}
    else if(act==="phone"){openPhone(t);}
    else if(act==="rules"){openRules();}
    else if(act==="close"){var id=t.getAttribute("data-target");document.getElementById(id).style.display="none";document.getElementById("mask").style.display="none";}
    else if(act==="export"){exportCSV(t.getAttribute("data-which"));}
    else if(act==="exportHistory"){exportHistory();}
    else if(act==="histDate"){STATE.histSel=t.getAttribute("data-date");render();}
    else if(act==="histreset"){STATE.histF={ydl:"",team:"",name:""};render();}
    else if(act==="refresh"){refresh();}
    else if(act==="openWindow"){openWindow();}
    else if(act==="copyRaw"){copyRaw();}
  }
  function onChange(e){
    var t=e.target.closest("[data-act]"); if(!t||t.getAttribute("data-act")!=="id1filter"&&t.getAttribute("data-act")!=="id2filter"&&t.getAttribute("data-act")!=="auto") return;
    var act=t.getAttribute("data-act");
    if(act==="id1filter"){STATE.id1f[t.getAttribute("data-f")]=t.value;render();}
    else if(act==="id2filter"){STATE.id2f[t.getAttribute("data-f")]=t.value;render();}
    else if(act==="histFilter"){STATE.histF[t.getAttribute("data-f")]=t.value;render();}
    else if(act==="auto"){
      if(t.checked){startAuto();} else {stopAuto();}
    }
  }
  function onInput(e){
    var t=e.target.closest("[data-act]"); if(!t||t.getAttribute("data-act")!=="id2filter"||t.getAttribute("data-f")!=="name") return;
    clearTimeout(onInput._t); onInput._t=setTimeout(function(){STATE.id2f.name=t.value;render();},200);
  }
  function openPhone(t){
    var nm=t.getAttribute("data-name"), id=t.getAttribute("data-id"), tm=t.getAttribute("data-team"), ln=t.getAttribute("data-line"), ph=t.getAttribute("data-phone")||"";
    document.getElementById("pm-name").textContent=nm;
    document.getElementById("pm-info").textContent="ID: "+id+" · "+tm+" · "+ln;
    var wrap=document.getElementById("pm-wrap"), noph=document.getElementById("pm-nophone");
    if(ph){wrap.style.display="";noph.style.display="none";var pe=document.getElementById("pm-phone");pe.href="tel:"+ph;pe.textContent=ph;document.getElementById("pm-copy").textContent="复制手机号";}
    else{wrap.style.display="none";noph.style.display="";}
    document.getElementById("pm-modal").style.display="block";document.getElementById("mask").style.display="block";
  }
  function openRules(){document.getElementById("rulesModal").style.display="block";document.getElementById("mask").style.display="block";}
  function closeModals(){document.getElementById("mask").style.display="none";document.getElementById("rulesModal").style.display="none";document.getElementById("pm-modal").style.display="none";}

  var autoTimer=null;
  function startAuto(){if(autoTimer)return;autoTimer=setInterval(function(){refresh();},10000);}
  function stopAuto(){if(autoTimer){clearInterval(autoTimer);autoTimer=null;}}
  function refresh(){
    loadData().then(function(){ render(); });
  }
  function openWindow(){
    var url = (typeof chrome!=='undefined' && chrome.runtime) ? chrome.runtime.getURL('index.html') : 'index.html';
    if(typeof chrome!=='undefined' && chrome.tabs && chrome.tabs.create){ chrome.tabs.create({ url:url, active:true }); }
    else { window.open(url,'_blank'); }
  }
  function toast(msg){ var t=document.createElement('div'); t.textContent=msg; t.style.cssText='position:fixed;left:50%;top:18px;transform:translateX(-50%);background:#2f6fed;color:#fff;padding:8px 16px;border-radius:8px;z-index:999;font-size:13px;box-shadow:0 4px 14px rgba(0,0,0,.18)'; document.body.appendChild(t); setTimeout(function(){ if(t.parentNode) t.parentNode.removeChild(t); },1900); }
  function copyRaw(){
    if(typeof chrome==='undefined'||!chrome.storage){ toast('当前环境不支持'); return; }
    chrome.storage.local.get(['dzt_raw_sample'], function(o){
      var s=o&&o.dzt_raw_sample;
      if(!s){ toast('暂无样本：请先在浏览器打开轩辕「实时骑手监控」页面，等待自动抓取'); return; }
      var txt=JSON.stringify(s,null,2);
      if(navigator.clipboard&&navigator.clipboard.writeText){ navigator.clipboard.writeText(txt).then(function(){ toast('已复制一条骑手原始数据，请粘贴给我'); }, function(){ toast('复制失败'); }); }
      else { toast('请手动复制'); }
    });
  }

  // ---------- 启动 ----------
  function init(){
    var modalRoot=document.getElementById("modalRoot");
    modalRoot.innerHTML=
      '<div class="mask" id="mask" data-act="close" data-target="mask"></div>'+
      '<div class="modal" id="rulesModal"><div class="modal-hd"><span class="modal-title">📖 看板逻辑说明</span><span class="modal-close" data-act="close" data-target="rulesModal">✕</span></div><div class="modal-bd">'+rulesHTML()+'</div></div>'+
      '<div class="pmodal" id="pm-modal"><div class="pm-name" id="pm-name"></div><div class="pm-info" id="pm-info"></div>'+
        '<div id="pm-wrap"><a class="pm-phone" id="pm-phone" href="#"></a></div><div class="pm-nophone" id="pm-nophone">暂无手机号</div>'+
        '<div class="pm-copy" data-act="copy">复制手机号</div></div>';
    document.addEventListener("click",onClick);
    document.getElementById("refreshBar").addEventListener("click",function(e){if(e.target.id==="refreshBar")return;});
    document.addEventListener("change",onChange);
    document.addEventListener("input",onInput);
    var cb=document.querySelector('[data-act="copy"]');
    // copy handled below via delegation
    document.addEventListener("click",function(e){
      var t=e.target.closest('[data-act="copy"]'); if(!t) return;
      var v=document.getElementById("pm-phone").textContent; if(!v)return;
      var c=document.getElementById("pm-copy");
      if(navigator.clipboard&&navigator.clipboard.writeText){navigator.clipboard.writeText(v).then(function(){c.textContent="已复制";setTimeout(function(){c.textContent="复制手机号";},1500);},function(){});}
      else {c.textContent="已复制";setTimeout(function(){c.textContent="复制手机号";},1500);}
    });
    // mask click closes
    document.addEventListener("click",function(e){ if(e.target&&e.target.id==="mask") closeModals(); });
    if(typeof chrome!=='undefined' && chrome.runtime && chrome.runtime.sendMessage){ try{ chrome.runtime.sendMessage({type:'refresh'}); }catch(e){} }
    var __qv = (window.__VIEW || (location.search.match(/[?&]view=(\w+)/)||[])[1]);
    if(__qv && ['home','id1','id2','history'].indexOf(__qv)>=0) STATE.view=__qv;
    if(typeof chrome!=='undefined' && chrome.storage && chrome.storage.onChanged){
      chrome.storage.onChanged.addListener(function(changes, area){
        if(area==='local' && changes['dzt_today_v1']){ loadData().then(function(){ render(); }); }
      });
    }
    loadData().then(function(j){
      META=j.meta||{}; RIDERS=j.riders||[];
      var now=parseNow(META.now); NOW=now; ACTIVE=activeFor(now); ACTIVE_START=pStart(ACTIVE); ACTIVE_END=pEnd(ACTIVE); REMAIN=ACTIVE_END-now; TOMID=1440-now;
      boot();
      startAuto();
    });
  }
  if(document.readyState==="loading") document.addEventListener("DOMContentLoaded",init); else init();
})();
