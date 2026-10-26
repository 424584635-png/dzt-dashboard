'use strict';
// 本地一体化：抓取 → 生成 → 提交推送 → 钉钉（带本次版本链接）
var fs = require('fs');
var path = require('path');
var cp = require('child_process');
var scrape = require('./scrape-core');

var OWNER = '424584635-png', REPO = 'dzt-dashboard';
var TOKEN = '';
try { TOKEN = fs.readFileSync(path.join(__dirname,'.push-token'),'utf8').trim(); } catch(e){}
var SITE = 'https://' + OWNER + '.github.io/' + REPO + '/';

function loadCfg(){ try{ return JSON.parse(fs.readFileSync(path.join(__dirname,'config.json'),'utf8')); }catch(e){ return null; } }
function git(args, opts){
  var r = cp.spawnSync('git', ['-C', __dirname].concat(args), Object.assign({ encoding:'utf8', env: Object.assign({}, process.env, { GIT_TERMINAL_PROMPT:'0' }) }, opts||{}));
  return { code: r.status, out: ((r.stdout||'')+(r.stderr||'')).replaceAll(TOKEN,'***') };
}
function version(){
  var d = new Date(Date.now()+8*3600*1000);
  function p(n){ return n<10?'0'+n:''+n; }
  return d.getUTCFullYear()+p(d.getUTCMonth()+1)+p(d.getUTCDate())+p(d.getUTCHours())+p(d.getUTCMinutes());
}

(async function(){
  var cfg = loadCfg();
  if(!cfg || !cfg.cookie){ console.error('缺少 config.json 的 cookie'); process.exit(1); }
  console.log('① 抓取轩辕数据…');
  var r;
  try { r = await scrape.scrapeAndSave(cfg); } catch(e){ console.error('抓取异常:', e.message); process.exit(1); }
  var n = (r && r.riders) ? r.riders.length : 0;
  console.log('   骑手数:', n, '时段:', r && r.meta && r.meta.activePeriod);
  if(n < 100){ console.error('   数据不足，终止（不推送）'); process.exit(1); }

  console.log('② 生成页面…');
  var b = cp.spawnSync(process.execPath, ['build.js'], { cwd: __dirname, encoding:'utf8' });
  if(b.status !== 0){ console.error('   生成失败:', (b.stderr||'').slice(0,300)); process.exit(1); }
  console.log('   ' + ((b.stdout||'').trim().split('\n').pop()||''));

  console.log('③ 提交并推送…');
  var v = version();
  fs.writeFileSync(path.join(__dirname,'public','version.json'), JSON.stringify({ v: v, at: r.meta.now, riders: n }));
  git(['add','-A']);
  var c = git(['commit','-m','data: '+v+' ('+n+' 骑手)']);
  console.log('   commit:', c.code===0 ? 'OK' : (c.out.split('\n')[0]||'').slice(0,80));
  // 先同步远端最新，避免 non-fast-forward
  git(['fetch','https://'+OWNER+':'+TOKEN+'@github.com/'+OWNER+'/'+REPO+'.git','main']);
  git(['reset','--soft','FETCH_HEAD']);
  git(['add','-A']);
  var c2 = git(['commit','-m','data: '+v+' ('+n+' 骑手)']);
  console.log('   commit(同步后):', c2.code===0 ? 'OK' : 'no-change');
  var push = git(['push','https://'+OWNER+':'+TOKEN+'@github.com/'+OWNER+'/'+REPO+'.git','main']);
  if(push.code !== 0){ console.error('   push 失败:', push.out.slice(0,200)); process.exit(1); }
  console.log('   push: OK');

  console.log('④ 推送钉钉…');
  var dtz = {};
  try { dtz = JSON.parse(fs.readFileSync(path.join(__dirname,'.dingtalk.json'),'utf8')); } catch(e){}
  if(dtz.webhook){ process.env.DINGTALK_WEBHOOK = dtz.webhook; process.env.DINGTALK_SECRET = dtz.secret; }
  var env = Object.assign({}, process.env, { DZT_VERSION: v });
  var d = cp.spawnSync(process.execPath, ['dingtalk-notify.js'], { cwd: __dirname, encoding:'utf8', env: env });
  console.log('   ' + ((d.stdout||'').trim()||(d.stderr||'').trim()||'').slice(0,200));
  console.log('✅ 完成，链接:', SITE + '?v=' + v);
})().catch(function(e){ console.error('异常:', e.message); process.exit(1); });
