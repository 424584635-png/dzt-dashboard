
'use strict';
var scrape = require('./scrape-core');
var fs = require('fs');
var path = require('path');
function loadConfig(){ try{ return JSON.parse(fs.readFileSync(path.join(__dirname,'config.json'),'utf8')); }catch(e){ return null; } }
var cfg = loadConfig();
if(!cfg || !cfg.cookie){ console.error('请先复制 config.example.json 为 config.json 并填入你的轩辕 Cookie。'); process.exit(1); }
scrape.scrapeAndSave(cfg).then(function(r){ console.log('爬取成功：骑手数='+r.riders.length+', 时段='+r.meta.activePeriod+', 数据已写入 data.json'); }).catch(function(e){ console.error('爬取失败: '+e.message); process.exit(1); });
