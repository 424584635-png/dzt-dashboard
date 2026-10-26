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
  for(var i=0;i<3;i++){
    try{
      var r = await scrape.scrapeAndSave(cfg);
      if(r && r.riders && r.riders.length>0){
        try{
          var src = path.join(__dirname,'data.json'); var dst = path.join(__dirname,'public','data.json');
          var hsrc = path.join(__dirname,'history.json'); var hdst = path.join(__dirname,'public','history.json');
          if(fs.existsSync(src)) fs.writeFileSync(dst, fs.readFileSync(src));
          if(fs.existsSync(hsrc)) fs.writeFileSync(hdst, fs.readFileSync(hsrc));
        }catch(e){}
        console.log('爬取成功：骑手数='+r.riders.length+', 时段='+r.meta.activePeriod+', 已写入 data.json 并同步到 public/');
        return;
      }
      console.error('第'+(i+1)+'次爬取为0骑手，15秒后重试...');
      await sleep(15000);
    }catch(e){ console.error('第'+(i+1)+'次爬取失败: '+e.message); await sleep(15000); }
  }
  console.error('连续3次爬取均失败，保留旧数据，不更新。');
  process.exit(1);
}
run();
