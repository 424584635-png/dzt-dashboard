
'use strict';
var http = require('http');
var fs = require('fs');
var path = require('path');
var scrape = require('./scrape-core');
var PUBLIC = path.join(__dirname,'public');
var PORT = process.env.PORT || 3000;
var MIME = { '.html':'text/html; charset=utf-8', '.css':'text/css; charset=utf-8', '.js':'text/javascript; charset=utf-8', '.json':'application/json; charset=utf-8', '.png':'image/png', '.svg':'image/svg+xml' };
function sendJSON(res, obj, code){ res.writeHead(code||200, {'Content-Type':'application/json; charset=utf-8'}); res.end(JSON.stringify(obj)); }
function serveStatic(req, res){
  var p = decodeURIComponent(req.url.split('?')[0]); if(p==='/') p='/index.html';
  var fp = path.join(PUBLIC, p);
  if(fp.indexOf(PUBLIC)!==0){ res.writeHead(403); res.end('forbidden'); return; }
  fs.readFile(fp, function(err, data){ if(err){ res.writeHead(404,{'Content-Type':'text/plain; charset=utf-8'}); res.end('not found'); return; } res.writeHead(200,{'Content-Type':MIME[path.extname(fp)]||'application/octet-stream'}); res.end(data); });
}
var serverInstance = http.createServer(function(req, res){
  if(req.url.indexOf('/api/data')===0){ try{ var d=JSON.parse(fs.readFileSync(path.join(__dirname,'data.json'),'utf8')); sendJSON(res,d); }catch(e){ sendJSON(res,{meta:{},riders:[]},500); } return; }
  if(req.url.indexOf('/api/history')===0){ try{ var h=JSON.parse(fs.readFileSync(path.join(__dirname,'history.json'),'utf8')||'{}'); sendJSON(res,h); }catch(e){ sendJSON(res,{}); } return; }
  serveStatic(req, res);
});
serverInstance.listen(PORT, function(){ console.log('看板已启动: http://localhost:'+PORT); });
function loadConfig(){ try{ return JSON.parse(fs.readFileSync(path.join(__dirname,'config.json'),'utf8')); }catch(e){ return null; } }
var cfg = loadConfig();
if(cfg && cfg.cookie){
  scrape.scrapeAndSave(cfg).then(function(r){ console.log('首次爬取成功，骑手数='+r.riders.length+', 时段='+r.meta.activePeriod); }).catch(function(e){ console.error('首次爬取失败: '+e.message); });
  var POLL = parseInt(cfg.pollMs||60000, 10); if(!(POLL>=10000)) POLL=60000;
  setInterval(function(){ scrape.scrapeAndSave(cfg).catch(function(e){ console.error('爬取失败: '+e.message); }); }, POLL);
} else {
  console.log('未检测到 config.json 的 cookie：将以 data.json 静态数据运行。配置 cookie 后自动实时爬取更新。');
}
