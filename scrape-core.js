
'use strict';
var fs = require('fs');
var path = require('path');
var DATA = path.join(__dirname,'data.json');
var HISTORY = path.join(__dirname,'history.json');
var API_KNIGHT = 'https://httpizza.ele.me/xtop/xtop.xy.special.realTimeAttendance.listKnightAttendance/1.0';
var API_OPT = 'https://httpizza.ele.me/xtop/xtop.xy.special.realTimeAttendance.optionalObjectVO/1.0';
var TIME_CODE = 150;
var PERIODS_BG = [["凌晨1",0,120],["凌晨2",120,240],["凌晨3",240,360],["早餐1",360,480],["早餐2",480,630],["午高峰",630,810],["下午茶1",810,930],["下午茶2",930,1050],["晚高峰",1050,1200],["夜宵1",1200,1320],["夜宵2",1320,1440]];
var KNOWN_TEAMS = [
  { objectType:2, objectId:5562020, name:'思茅优选一队' },
  { objectType:2, objectId:5684588, name:'思茅优选二队' },
  { objectType:2, objectId:11533332, name:'思茅优选三队' },
  { objectType:7, objectId:7054204, name:'思茅蜂跑一队' },
  { objectType:7, objectId:6903644, name:'思茅蜂跑三队' },
  { objectType:7, objectId:6953876, name:'思茅蜂跑四队' },
  { objectType:7, objectId:7007564, name:'思茅蜂跑五队' },
  { objectType:7, objectId:7504404, name:'思茅蜂跑六队' },
  { objectType:7, objectId:7590028, name:'思茅蜂跑七队' },
  { objectType:7, objectId:7761340, name:'思茅蜂跑十队' },
  { objectType:7, objectId:7760876, name:'思茅蜂跑十一队' },
  { objectType:7, objectId:7761116, name:'思茅蜂跑十三队' },
  { objectType:8, objectId:6266348, name:'思茅优远一队' },
  { objectType:8, objectId:6266380, name:'思茅优远二队' },
  { objectType:8, objectId:7055780, name:'思茅优远四队' },
  { objectType:8, objectId:7632876, name:'思茅优远五队' }
];
var curCfg = {};
function nowMin(){ var d=new Date(); return ((d.getUTCHours()*60 + d.getUTCMinutes()) + 480) % 1440; }
function activeForBg(m){ for(var i=0;i<PERIODS_BG.length;i++){ if(m>=PERIODS_BG[i][1]&&m<PERIODS_BG[i][2]) return PERIODS_BG[i][0]; } return PERIODS_BG[PERIODS_BG.length-1][0]; }
function fmtNow(){ var d=new Date(); var cn=new Date(d.getTime()+8*3600*1000); function p(n){return n<10?'0'+n:''+n;} return cn.getUTCFullYear()+'-'+p(cn.getUTCMonth()+1)+'-'+p(cn.getUTCDate())+' '+p(cn.getUTCHours())+':'+p(cn.getUTCMinutes()); }
function num(v){ var n=Number(v); return isFinite(n)?n:0; }
function pick(o, names){ for(var i=0;i<names.length;i++){ if(o && o[names[i]]!=null) return o[names[i]]; } return undefined; }
function toPeriodNames(v){
  if(typeof v==='string'){ return v.split(/[、,，\s]+/).map(function(s){return s.trim();}).filter(Boolean); }
  if(Array.isArray(v)){ return v.map(function(x){ return (x&&(x.name||x.periodName||x.period))||''; }).filter(Boolean); }
  return [];
}
function post(url, body){
  var headers = { 'Content-Type':'application/json', 'Accept':'application/json' };
  if(curCfg && curCfg.cookie) headers['Cookie'] = curCfg.cookie;
  return fetch(url, { method:'POST', headers:headers, body:JSON.stringify(body) }).then(function(r){ if(!r.ok) throw new Error('HTTP '+r.status); return r.json(); });
}
function refreshTeamList(){
  return post(API_OPT, { params:{ request:{} } }).then(function(j){
    var res=j && j.result; if(!res || String(res.code)!=='200') return KNOWN_TEAMS;
    var d=res.data; var arr=Array.isArray(d)?d:[];
    var found=[];
    function walk(x){ if(Array.isArray(x)){ x.forEach(walk); return; } if(x && typeof x==='object'){ if(x.objectId!=null && x.objectType!=null) found.push(x); Object.keys(x).forEach(function(k){ if(typeof x[k]==='object'&&x[k]!==null) walk(x[k]); }); } }
    walk(arr);
    var map={}; KNOWN_TEAMS.forEach(function(t){ map[t.objectType+'_'+t.objectId]=t; });
    found.forEach(function(t){ var k=t.objectType+'_'+t.objectId; if(!map[k]) map[k]={ objectType:t.objectType, objectId:t.objectId, name:t.objectName||'' }; });
    return Object.keys(map).map(function(k){ return map[k]; });
  }).catch(function(){ return KNOWN_TEAMS; });
}
function pullGroup(teams){
  var jobs = teams.map(function(t){
    return post(API_KNIGHT, { params:{ request:{ objectIds:[{objectType:t.objectType, objectId:t.objectId}], objectType:t.objectType, isCurrentTime:true, timeCode:TIME_CODE } } })
      .then(function(j){ var res=j&&j.result; if(!res||String(res.code)!=='200') return []; var d=res.data; var nodes=Array.isArray(d)?d:[d]; var out=[]; nodes.forEach(function(n){ (n.knightDetailVos||[]).forEach(function(o){ out.push(o); }); }); return out; })
      .catch(function(){ return []; });
  });
  return Promise.all(jobs).then(function(arrs){ var all=[]; arrs.forEach(function(a){ all=all.concat(a); }); return all; });
}
var TC2NAME = {'100':'凌晨1','102':'凌晨2','103':'凌晨3','111':'早餐1','112':'早餐2','120':'午高峰','130':'下午茶1','131':'下午茶2','140':'晚高峰','151':'夜宵1','150':'夜宵2','9999':'全天'};
var NAME2TC = {}; Object.keys(TC2NAME).forEach(function(k){ if(k!=='9999') NAME2TC[TC2NAME[k]]=k; });
function mapRider(o, activePeriod){
  var isSched = (o.scheduled===true) || (o.scheduled==null && o.todayScheduled===true);
  var nm = o.objectName||'';
  var ydl = o.uplusTypeDesc;
  if(ydl==='U+'||ydl==='U＋'||ydl==='u+') ydl='优选';
  if(!ydl){ if(nm.indexOf('优选')>=0) ydl='优选'; else if(nm.indexOf('蜂跑')>=0) ydl='蜂跑'; else if(nm.indexOf('优远')>=0) ydl='优远'; else ydl='未知'; }
  var curTC = NAME2TC[activePeriod] || '150';
  var tcList = Array.isArray(o.scheduledTimeCode) ? o.scheduledTimeCode : (isSched ? [curTC] : []);
  var schedule = tcList.map(function(tc){ return TC2NAME[String(tc)]; }).filter(Boolean);
  if(!schedule.length && isSched) schedule=[activePeriod];
  var om = (o.timeCodeOnlineTimeMap && typeof o.timeCodeOnlineTimeMap==='object') ? o.timeCodeOnlineTimeMap : {};
  var dm = (o.timeCodeUnDeliveryTimeMap && typeof o.timeCodeUnDeliveryTimeMap==='object') ? o.timeCodeUnDeliveryTimeMap : {};
  var periods = [];
  tcList.forEach(function(tc){
    var pname = TC2NAME[String(tc)]; if(!pname) return;
    var isCur = (String(tc)===String(curTC));
    periods.push({
      name: pname,
      onlineMin: Math.round((Number(om[String(tc)]||0)/60)),
      orders: isCur ? num(o.timeFinishOrder) : null,
      maxOrders: num(o.maxOrder),
      delivery: isCur ? num(o.deliveryOrder) : (num(dm[String(tc)])||0),
      ended: (Number(tc) < Number(curTC))
    });
  });
  if(!periods.length){
    periods = schedule.map(function(p){ return { name:p, onlineMin: Math.round((Number(o.timeOnlineTime)||0)/60), orders: num(o.timeFinishOrder), maxOrders: num(o.maxOrder), delivery: num(o.deliveryOrder), ended:(p!==activePeriod) }; });
    if(!periods.length && isSched) periods=[{ name:activePeriod, onlineMin: Math.round((Number(o.timeOnlineTime)||0)/60), orders: num(o.timeFinishOrder), maxOrders: num(o.maxOrder), delivery: num(o.deliveryOrder), ended:false }];
  }
  return {
    ydl:ydl, xiaodui:nm, name:o.knightName||'', id:String(o.knightId||o.subId||''), phone:'',
    isCaptain:(o.captain==='是'||o.isCaptain===true)?'是':'否',
    isNew:o.newKnightLabel?'是':'否',
    schedule:schedule, periods:periods,
    onlineStatus:o.onlineStatus===true?'在线':'离线',
    dayOnlineMin: Math.round((o.fullDayOnlineTime||0)/60),
    onlineH: Math.round((o.fullDayOnlineTime||0)/360)/10,
    orders: num(o.fullDayFinishOrder!=null?o.fullDayFinishOrder:0),
    periodOrders: num(o.timeFinishOrder),
    orderTarget: num(o.todayTargetOrder||20),
    sprintTarget: 0,
    deliveryOrders: num(o.deliveryOrder||o.delivery)
  };
}
function readJSON(p, def){ try{ return JSON.parse(fs.readFileSync(p,'utf8')); }catch(e){ return def; } }
function scrapeAndSave(cfg){
  curCfg = cfg||{};
  return refreshTeamList().then(function(teams){
    return pullGroup(teams).then(function(raw){
      var cur = activeForBg(nowMin());
      var riders = raw.map(function(o){ return mapRider(o, cur); });
      var meta = { date: fmtNow().slice(0,10), now: fmtNow(), activePeriod: cur, source:'scrape', generatedAt: fmtNow() };
      var hist = readJSON(HISTORY, {});
      hist[meta.date] = { meta:meta, riders:riders };
      var keys = Object.keys(hist).sort(); while(keys.length>30) delete hist[keys.shift()];
      fs.writeFileSync(DATA, JSON.stringify({ meta:meta, riders:riders, history:hist }, null, 2));
      fs.writeFileSync(HISTORY, JSON.stringify(hist, null, 2));
      return { meta:meta, riders:riders, history:hist };
    });
  });
}
module.exports = { scrapeAndSave: scrapeAndSave, mapRider: mapRider };
