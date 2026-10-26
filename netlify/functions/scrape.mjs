import { getStore } from '@netlify/blobs';

const API_KNIGHT = 'https://httpizza.ele.me/xtop/xtop.xy.special.realTimeAttendance.listKnightAttendance/1.0';
const API_OPT = 'https://httpizza.ele.me/xtop/xtop.xy.special.realTimeAttendance.optionalObjectVO/1.0';
const TIME_CODE = 150;
const PERIODS_BG = [["凌晨1",0,120],["凌晨2",120,240],["凌晨3",240,360],["早餐1",360,480],["早餐2",480,630],["午高峰",630,810],["下午茶1",810,930],["下午茶2",930,1050],["晚高峰",1050,1200],["夜宵1",1200,1320],["夜宵2",1320,1440]];
const TC2NAME = {'100':'凌晨1','102':'凌晨2','103':'凌晨3','111':'早餐1','112':'早餐2','120':'午高峰','130':'下午茶1','131':'下午茶2','140':'晚高峰','151':'夜宵1','150':'夜宵2','9999':'全天'};
const NAME2TC = {}; Object.keys(TC2NAME).forEach(function(k){ if(k!=='9999') NAME2TC[TC2NAME[k]]=k; });
const KNOWN_TEAMS = [
  { objectType:2, objectId:5562020 },{ objectType:2, objectId:5684588 },{ objectType:2, objectId:11533332 },
  { objectType:7, objectId:7054204 },{ objectType:7, objectId:6903644 },{ objectType:7, objectId:6953876 },
  { objectType:7, objectId:7007564 },{ objectType:7, objectId:7504404 },{ objectType:7, objectId:7590028 },
  { objectType:7, objectId:7761340 },{ objectType:7, objectId:7760876 },{ objectType:7, objectId:7761116 },
  { objectType:8, objectId:6266348 },{ objectType:8, objectId:6266380 },{ objectType:8, objectId:7055780 },{ objectType:8, objectId:7632876 }
];

function nowMin(){ var d=new Date(); return ((d.getUTCHours()*60 + d.getUTCMinutes()) + 480) % 1440; }
function activeForBg(m){ for(var i=0;i<PERIODS_BG.length;i++){ if(m>=PERIODS_BG[i][1] && m<PERIODS_BG[i][2]) return PERIODS_BG[i][0]; } return PERIODS_BG[PERIODS_BG.length-1][0]; }
function fmtNow(){ var d=new Date(); var cn=new Date(d.getTime()+8*3600*1000); function p(n){return n<10?'0'+n:''+n;} return cn.getUTCFullYear()+'-'+p(cn.getUTCMonth()+1)+'-'+p(cn.getUTCDate())+' '+p(cn.getUTCHours())+':'+p(cn.getUTCMinutes()); }
function num(v){ var n=Number(v); return isFinite(n)?n:0; }

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
    periods.push({ name:pname, onlineMin: Math.round((Number(om[String(tc)]||0)/60), orders: isCur ? num(o.timeFinishOrder) : null, maxOrders: num(o.maxOrder), delivery: isCur ? num(o.deliveryOrder) : (num(dm[String(tc)])||0), ended: (Number(tc) < Number(curTC)) });
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
    deliveryOrders: num(o.deliveryOrder||o.delivery),
    raw:o
  };
}

function post(url, body, cfg){
  return fetch(url, { method:'POST', headers:{ 'Content-Type':'application/json', 'Accept':'application/json', 'Cookie': cfg.cookie }, body: JSON.stringify(body) }).then(function(r){ if(!r.ok) throw new Error('HTTP '+r.status); return r.json(); });
}

async function refreshTeamList(cfg){
  try{
    var j = await post(API_OPT, { params:{ request:{} } }, cfg);
    var res=j && j.result; if(!res || String(res.code)!=='200') return KNOWN_TEAMS;
    var d=res.data; var arr=Array.isArray(d)?d:[]; var found=[];
    function walk(x){ if(Array.isArray(x)){ x.forEach(walk); return; } if(x && typeof x==='object'){ if(x.objectId!=null && x.objectType!=null) found.push(x); Object.keys(x).forEach(function(k){ if(typeof x[k]==='object'&&x[k]!==null) walk(x[k]); }); } }
    walk(arr);
    var map={}; KNOWN_TEAMS.forEach(function(t){ map[t.objectType+'_'+t.objectId]=t; });
    found.forEach(function(t){ var k=t.objectType+'_'+t.objectId; if(!map[k]) map[k]={ objectType:t.objectType, objectId:t.objectId, name:t.objectName||'' }; });
    return Object.keys(map).map(function(k){ return map[k]; });
  }catch(e){ return KNOWN_TEAMS; }
}

async function pullGroup(teams, cfg){
  var jobs = teams.map(function(t){
    return post(API_KNIGHT, { params:{ request:{ objectIds:[{objectType:t.objectType, objectId:t.objectId}], objectType:t.objectType, isCurrentTime:true, timeCode:TIME_CODE } } }, cfg)
      .then(function(j){ var res=j&&j.result; if(!res||String(res.code)!=='200') return []; var d=res.data; var nodes=Array.isArray(d)?d:[d]; var out=[]; nodes.forEach(function(n){ (n.knightDetailVos||[]).forEach(function(o){ out.push(o); }); }); return out; })
      .catch(function(){ return []; });
  });
  var arrs = await Promise.all(jobs); var all=[]; arrs.forEach(function(a){ all=all.concat(a); }); return all;
}

export const handler = async (event, context) => {
  var cookie = process.env.COOKIE;
  if(!cookie) return { statusCode: 500, body: 'missing COOKIE env' };
  var cfg = { cookie: cookie };
  try{
    var teams = await refreshTeamList(cfg);
    var raw = await pullGroup(teams, cfg);
    var cur = activeForBg(nowMin());
    var riders = raw.map(function(o){ return mapRider(o, cur); });
    var meta = { date: fmtNow().slice(0,10), now: fmtNow(), activePeriod: cur, source:'scrape', generatedAt: fmtNow() };
    var store = getStore('dzt');
    var hist = {}; try{ hist = (await store.get('history', { type:'json' })) || {}; }catch(e){}
    hist[meta.date] = { meta: meta, riders: riders };
    var keys = Object.keys(hist).sort(); while(keys.length>30) delete hist[keys.shift()];
    await store.set('data', { meta: meta, riders: riders, history: hist });
    await store.set('history', hist);
    return { statusCode: 200, body: JSON.stringify({ ok:true, count: riders.length, period: cur }) };
  }catch(e){ return { statusCode: 500, body: 'scrape error: '+e.message }; }
};
