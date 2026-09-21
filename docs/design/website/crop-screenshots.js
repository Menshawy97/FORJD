// One-off script used to crop the design screenshots to their phone frames for design-v1.html.
// Run from the repo root: node docs/design/website/crop-screenshots.js <out-dir>  (needs pngjs resolvable).
const {PNG}=require("pngjs");
const fs=require("fs");
const dir="FORJD mobile app design/screenshots/";
const out=process.argv[2];
const files={home:"home1.png",live:"live workout.png",body:"progress body 1.png",rank:"leaderboard.png",nutrition:"nutrition dashboard.png",run:"live run 1.png",inbody:"inbody update and history.png",health:"progress health 1.png",train:"train1.png",strength:"progress strength.png",sources:"connected sources.png",welcome:"welcome page.png"};
const res={};
for (const [k,f] of Object.entries(files)){
  const p=PNG.sync.read(fs.readFileSync(dir+f)); const {width:w,height:h,data:d}=p;
  const lum=(x,y)=>{const i=(y*w+x)*4;return Math.max(d[i],d[i+1],d[i+2]);};
  const bg=lum(2,2);
  const bright=(x,y)=>lum(x,y)>bg+14;
  // rows: first bright row, then continue until 6 consecutive dark rows
  let top=-1,bot=-1,dark=0;
  for(let y=0;y<h;y++){let any=false;for(let x=0;x<w;x+=2)if(bright(x,y)){any=true;break;}
    if(top<0){if(any){top=y;}continue;}
    if(any){bot=y;dark=0;}else if(++dark>=6)break;}
  let left=w,right=0;
  for(let y=top;y<=bot;y++)for(let x=0;x<w;x++)if(bright(x,y)){if(x<left)left=x;if(x>right)right=x;}
  const cw=right-left+1,ch=bot-top+1; const o=new PNG({width:cw,height:ch});
  PNG.bitblt(p,o,left,top,cw,ch,0,0);
  const buf=PNG.sync.write(o);
  res[k]={w:cw,h:ch,src:"data:image/png;base64,"+buf.toString("base64")};
  fs.writeFileSync(out+"/"+k+".png",buf);
  console.log(k,w,h,"->",left,top,cw,ch,Math.round(buf.length/1024)+"KB");
}
fs.writeFileSync(out+"/shots.json",JSON.stringify(res));
