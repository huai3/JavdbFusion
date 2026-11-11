const { chromium } = require('playwright');
const { launchOptions } = require('./browser');
const fs=require('fs'),path=require('path');
const SCRIPT=fs.readFileSync(path.join(__dirname,'..','..','JavdbFusion.user.js'),'utf8');
const SHIM=fs.readFileSync(path.join(__dirname,'gm-shim-live.js'),'utf8');
const UA='Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/151.0.0.0 Safari/537.36';
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const CODES=process.argv.slice(2);
(async()=>{
 const b=await chromium.launch(launchOptions());
 for(const [code,id] of CODES.map(x=>x.split('='))){
  const c=await b.newContext({viewport:{width:1440,height:900},locale:'zh-CN',userAgent:UA});
  const p=await c.newPage(); const errs=[]; const net=[];
  p.on('pageerror',e=>errs.push(String(e.message).slice(0,200)));
  await c.addInitScript('window.openAuthModal=function(){};');
  await c.exposeBinding('__gmFetch',async(s,r)=>{const t0=Date.now();try{const x=await fetch(r.url,{method:r.method||'GET',headers:r.headers||{},body:r.data??undefined});const t=await x.text();net.push({url:r.url,status:x.status,ms:Date.now()-t0});return{status:x.status,statusText:x.statusText,text:t,url:x.url};}catch(e){net.push({url:r.url,status:0,ms:Date.now()-t0,err:e.message});throw e;}});
  await c.addInitScript(SHIM); await c.addInitScript(SCRIPT);
  await p.goto('https://javdb.com/v/'+id,{waitUntil:'domcontentloaded',timeout:60000}).catch(()=>{});
  await sleep(7000);
  const openInfo=async()=>{
    const t0=Date.now();
    await p.click('.jf-poster-play').catch(e=>{});
    let first=null;
    for(let i=0;i<60;i++){const n=await p.evaluate(()=>document.querySelectorAll('.jf-route').length).catch(()=>0);if(n>0){first=Date.now()-t0;break;}await sleep(250);}
    await sleep(12000);
    const st=await p.evaluate(()=>{
      const v=document.getElementById('jfTrailerVideo');
      return {
        routes:[...document.querySelectorAll('.jf-route')].map(b=>b.innerText.replace(/\s+/g,' ').trim()),
        src:v&&(v.currentSrc||v.src)||'',paused:v&&v.paused,readyState:v&&v.readyState,
        loading:(document.getElementById('jfTrailerLoading')||{}).innerText?.replace(/\s+/g,' ').slice(0,220)||'',
        loadingDisplay:document.getElementById('jfTrailerLoading')?getComputedStyle(document.getElementById('jfTrailerLoading')).display:null,
        hint:(document.getElementById('jfTrailerHint')||{}).textContent||''
      };
    });
    return {ms:Date.now()-t0,first,st};
  };
  const first=await openInfo();
  await p.evaluate(()=>document.getElementById('jfTrailerClose')?.click()).catch(()=>{});
  await sleep(600);
  const second=await openInfo();
  await p.evaluate(()=>document.getElementById('jfTrailerClose')?.click()).catch(()=>{});
  const dmm=net.filter(n=>/dmm|javspyl/.test(n.url)).map(n=>({u:n.url.replace(/^https?:\/\//,'').slice(0,110),s:n.status,ms:n.ms}));
  console.log('===',code,JSON.stringify({first,second,dmm,errs:errs.slice(0,3)},null,1));
  await c.close();
 }
 await b.close();
})();
