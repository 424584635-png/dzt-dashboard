
(function(){
  function ready(fn){ if(document.readyState!=='loading') fn(); else document.addEventListener('DOMContentLoaded',fn); }
  ready(function(){
    var ft=document.querySelector('.ft'); if(!ft) return;
    var fl=document.getElementById('fl'), fteam=document.getElementById('ft');
    if(!fl||!fteam||!document.getElementById('curBody')) return;
    var input=document.createElement('input');
    input.type='text'; input.id='dztSearch'; input.placeholder='搜索骑手 / 工号（按 / 聚焦）';
    input.setAttribute('aria-label','搜索骑手或工号');
    var chip=document.createElement('span'); chip.className='dzt-chip'; chip.id='dztChip'; chip.style.display='none';
    var reset=document.createElement('button'); reset.type='button'; reset.className='dzt-reset'; reset.textContent='清空筛选';
    var count=document.createElement('span'); count.className='dzt-count'; count.id='dztCount';
    ft.appendChild(input); ft.appendChild(chip); ft.appendChild(reset); ft.appendChild(count);

    function apply(){
      var ln=fl.value, tm=fteam.value, q=(input.value||'').trim().toLowerCase();
      var rows=document.querySelectorAll('#curBody tr'); var shown=0;
      for(var i=0;i<rows.length;i++){
        var r=rows[i];
        var ok=(!ln||r.getAttribute('data-line')===ln)&&(!tm||r.getAttribute('data-team')===tm);
        if(ok&&q){ var id=r.querySelector('.rid'); var t=((r.getAttribute('data-name')||'')+' '+(id?id.textContent:'')).toLowerCase(); if(t.indexOf(q)<0) ok=false; }
        r.style.display=ok?'':'none'; if(ok) shown++;
      }
      count.textContent='显示 '+shown+' / '+rows.length+' 条';
      var act=[]; if(ln)act.push('运力线：'+ln); if(tm)act.push('小队：'+tm); if(q)act.push('搜索：'+input.value.trim());
      if(act.length){ chip.style.display=''; chip.textContent=act.join(' · '); } else { chip.style.display='none'; }
    }
    window.updateTable=apply;
    fl.addEventListener('change',apply); fteam.addEventListener('change',apply);
    input.addEventListener('input',apply);
    reset.addEventListener('click',function(){ fl.value=''; fteam.value=''; input.value=''; apply(); });
    document.addEventListener('keydown',function(e){ if(e.key==='/'&&document.activeElement!==input){ e.preventDefault(); input.focus(); } });
    apply();
  });
})();
