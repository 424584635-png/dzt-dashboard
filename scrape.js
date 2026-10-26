'use strict';
var scrape = require('./scrape-core');
var fs = require('fs');
var path = require('path');
function loadConfig(){ try{ return JSON.parse(fs.readFileSync(path.join(__dirname,'config.json'),'utf8')); }catch(e){ return null; } }
var cfg = loadConfig();
if(!cfg || !cfg.cookie){ if(process.env.CONFIG_COOKIE){ cfg = { cookie: process.env.CONFIG_COOKIE, pollMs: 60000 }; } }
if(!cfg || !cfg.cookie){ console.error('请配置 cookie（config.json 或环境变量 CONFIG_COOKIE）。'); process.exit(1); }
function sleep(ms){ return new Promise(function(r){ setTimeout(r, ms); }); }
async function run(){
  var last = 0;
  for(var i=0;i<5;i++){
    try{
      var r = await scrape.scrapeAndSave(cfg);
      last = (r && r.riders) ? r.riders.length : 0;
      if(last >= 100){
        try{
          var src = path.join(__dirname,'data.json'); var dst = path.join(__dirname,'public','data.json');
          var hsrc = path.join(__dirname,'history.json'); var hdst = path.join(__dirname,'public','history.json');
          if(fs.existsSync(src)) fs.writeFileSync(dst, fs.readFileSync(src));
          if(fs.existsSync(hsrc)) fs.writeFileSync(hdst, fs.readFileSync(hsrc));
        }catch(e){}
        console.log('爬取成功：骑手数='+last+', 时段='+r.meta.activePeriod);
        return;
      }
      console.error('第'+(i+1)+'次结果不足（'+last+' 骑手），20秒后重试...');
      await sleep(20000);
    }catch(e){ console.error('第'+(i+1)+'次失败: '+e.message); await sleep(20000); }
  }
  console.error('连续5次失败（最后'+last+'骑手），保留旧数据不更新。');
  process.exit(1);
}
run();
