'use strict';
var fs = require('fs');
var path = require('path');
var crypto = require('crypto');
var execSync = require('child_process').execSync;
var WEBHOOK = process.env.DINGTALK_WEBHOOK;
var SECRET = process.env.DINGTALK_SECRET;
if(!WEBHOOK || !SECRET){ console.error('缺少 DINGTALK_WEBHOOK / DINGTALK_SECRET'); process.exit(1); }
var PERIODS = [["凌晨1",0,120],["凌晨2",120,240],["凌晨3",240,360],["早餐1",360,480],["早餐2",480,630],["午高峰",630,810],["下午茶1",810,930],["下午茶2",930,1050],["晚高峰",1050,1200],["夜宵1",1200,1320],["夜宵2",1320,1440]];
var STANDARDS = {
  "凌晨1":{优选:[90,2],蜂跑:[90,2],优远:[90,1]},"凌晨2":{优选:[90,2],蜂跑:[90,2],优远:[90,1]},
  "凌晨3":{优选:[90,2],蜂跑:[90,2],优远:[90,1]},"早餐1":{优选:[90,2],蜂跑:[90,2],优远:[90,1]},
  "早餐2":{优选:[120,2],蜂跑:[120,3],优远:[120,1]},"午高峰":{优选:[150,5],蜂跑:[150,8],优远:[150,3]},
  "下午茶1":{优选:[90,2],蜂跑:[90,3],优远:[90,1]},"下午茶2":{优选:[90,2],蜂跑:[90,3],优远:[90,1]},
  "晚高峰":{优选:[120,4],蜂跑:[120,6],优远:[120,2]},"夜宵1":{优选:[90,3],蜂跑:[90,3],优远:[90,1]},
  "夜宵2":{优选:[90,2],蜂跑:[90,2],优远:[90,1]}
};
function nowMin(){ var d=new Date(); return ((d.getUTCHours()*60+d.getUTCMinutes())+480)%1440; }
function activeFor(now){ for(var i=0;i<PERIODS.length;i++) if(now>=PERIODS[i][1]&&now<PERIODS[i][2]) return PERIODS[i][0]; return PERIODS[PERIODS.length-1][0]; }
function pEnd(n){ for(var i=0;i<PERIODS.length;i++) if(PERIODS[i][0]===n) return PERIODS[i][2]; return 1440; }
function stdFor(p,ydl){ var s=STANDARDS[p]; if(!s) return [0,0]; return s[ydl]||s["优选"]||[0,0]; }
function findPeriod(r,p){ var e=null; (r.periods||[]).forEach(function(x){ if(x.name===p) e=x; }); return e; }
function curState(r,now){
  var name=activeFor(now); var ent=findPeriod(r,name); if(!ent) return null;
  var std=stdFor(name,r.ydl); var remain=Math.max(0,pEnd(name)-now);
  var om=ent.onlineMin, o=ent.orders, d=ent.delivery||0;
  if(om+remain<std[0]) return 0;
  if(om>=std[0]&&o>=std[1]) return 3;
  if(r.onlineStatus!=="在线"||(o+d)<std[1]) return 1;
  return 2;
}
function fmtNow(){ var d=new Date(); var cn=new Date(d.getTime()+8*3600*1000); function p(n){return n<10?'0'+n:''+n;} return cn.getUTCHours()+':'+p(cn.getUTCMinutes()); }
function minToHM(m){ m=Math.max(0,Math.floor(m)); return Math.floor(m/60)+':'+(m%60<10?'0'+m%60:''+m%60); }
async function main(){
  var j = JSON.parse(fs.readFileSync(path.join(__dirname,'data.json'),'utf8'));
  var riders = j.riders||[];
  if(!riders.length){ console.error('0骑手，跳过'); process.exit(1); }
  var now = nowMin(), ap = activeFor(now);
  var c = { sched:0, on:0, off:0, st0:0, st1:0, st2:0, st3:0, del:0 };
  var lines = { '优选':{sched:0,ok:0}, '蜂跑':{sched:0,ok:0}, '优远':{sched:0,ok:0} };
  riders.forEach(function(x){
    var st = curState(x, now); if(st===null) return;
    c.sched++;
    if(x.onlineStatus==='在线') c.on++; else c.off++;
    if(st===0)c.st0++; else if(st===1)c.st1++; else if(st===2)c.st2++; else if(st===3)c.st3++;
    c.del += Number(x.deliveryOrders)||0;
    var L = lines[x.ydl]; if(L){ L.sched++; if(st===2||st===3) L.ok++; }
  });
  var sha='';
  try{ sha = execSync('git rev-parse --short HEAD',{encoding:'utf8'}).trim(); }catch(e){}
  var link = 'https://424584635-png.github.io/dzt-dashboard/' + (sha ? ('?t='+sha) : '');
  var text = '## 🏍️ 骑手实时出勤\n\n'+
    '**时段**：'+ap+' · 剩余 '+minToHM(pEnd(ap)-now)+' · 截至 '+fmtNow()+'\n\n'+
    '**当前排班**：'+c.sched+' 人\n\n'+
    '- ✅ 在线：'+c.on+'\n- 📵 未在线：'+c.off+'\n'+
    '- 🏆 已达标：'+c.st3+'\n- 🔵 预计达标：'+c.st2+'\n'+
    '- ⚠️ 有风险：'+c.st1+'\n- ❌ 确定不达标：'+c.st0+'\n'+
    '- 🛵 配送中单量：'+c.del+'\n\n'+
    '**分线（排班/达标）**\n'+
    Object.keys(lines).map(function(k){ return '- '+k+'：'+lines[k].sched+' / '+lines[k].ok; }).join('\n')+'\n\n'+
    '**看板链接**：[打开实时看板]('+link+')';
  var ts = Date.now();
  var hmac = crypto.createHmac('sha256', SECRET).update(ts+'\n'+SECRET).digest('base64');
  var url = WEBHOOK + '&timestamp=' + ts + '&sign=' + encodeURIComponent(hmac);
  var r = await fetch(url, { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ msgtype:'markdown', markdown:{ title:'骑手实时出勤', text:text } }) });
  console.log('钉钉:', await r.text());
}
main().catch(function(e){ console.error('异常:', e.message); process.exit(1); });
