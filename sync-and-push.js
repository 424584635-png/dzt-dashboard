'use strict';
var fs = require('fs');
var path = require('path');
var OWNER = '424584635-png', REPO = 'dzt-dashboard';
var GH = 'https://api.github.com';
var token;
try{ token = fs.readFileSync(path.join(__dirname,'.push-token'),'utf8').trim(); }catch(e){}
if(!token){ console.error('缺少 .push-token'); process.exit(1); }
var H = { 'Authorization':'Bearer '+token, 'Accept':'application/vnd.github+json', 'User-Agent':'dzt-sync', 'X-GitHub-Api-Version':'2022-11-28' };
async function api(method, url, body){
  var r = await fetch(GH+url, { method:method, headers:H, body: body?JSON.stringify(body):undefined });
  var t = await r.text();
  var j; try{ j = JSON.parse(t); }catch(e){ j = {raw:t.slice(0,120)}; }
  return { status:r.status, body:j };
}
async function putFile(repoPath, localPath, message){
  var content = fs.readFileSync(localPath,'utf8');
  var cur = await api('GET', '/repos/'+OWNER+'/'+REPO+'/contents/'+repoPath);
  if(cur.status!==200 || !cur.body.sha){ console.error('GET失败', repoPath, cur.status, JSON.stringify(cur.body).slice(0,80)); return false; }
  var up = await api('PUT', '/repos/'+OWNER+'/'+REPO+'/contents/'+repoPath, {
    message: message,
    content: Buffer.from(content).toString('base64'),
    sha: cur.body.sha
  });
  if(up.status===409 || up.status===422){
    cur = await api('GET', '/repos/'+OWNER+'/'+REPO+'/contents/'+repoPath);
    if(cur.body && cur.body.sha){
      up = await api('PUT', '/repos/'+OWNER+'/'+REPO+'/contents/'+repoPath, {
        message: message, content: Buffer.from(content).toString('base64'), sha: cur.body.sha
      });
    }
  }
  console.log(repoPath, '->', up.status);
  return up.status===200 || up.status===201;
}
async function main(){
  try{ fs.writeFileSync(path.join(__dirname,'public','data.json'), fs.readFileSync(path.join(__dirname,'data.json'))); }catch(e){}
  try{ fs.writeFileSync(path.join(__dirname,'public','history.json'), fs.readFileSync(path.join(__dirname,'history.json'))); }catch(e){}
  var ok1 = await putFile('public/data.json', path.join(__dirname,'data.json'), 'auto: 数据更新');
  var ok2 = await putFile('public/history.json', path.join(__dirname,'history.json'), 'auto: 历史更新');
  if(ok1 && ok2){ console.log('推送成功'); } else { console.error('推送失败'); process.exit(1); }
}
main();
