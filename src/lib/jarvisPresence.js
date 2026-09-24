const modes={idle:{color:'#FFD77A',title:'En veille',detail:'Je suis là. Prenez votre temps.'},listening:{color:'#22D3FF',title:'Je vous écoute',detail:'Les ondes convergent vers Elynea.'},thinking:{color:'#A46AFF',title:'Je réfléchis…',detail:'Je relie les informations pour vous répondre.'},speaking:{color:'#FFD77A',title:'Je vous réponds',detail:'Ma voix donne le rythme.'}};

export function createJarvisPresence(canvas,logo,getState){
const ctx=canvas.getContext('2d');if(!ctx)return ()=>{};const reduced=matchMedia('(prefers-reduced-motion: reduce)');let state=getState(),t=0,last=0,size=0,level=null,paused=false,changed=-1,rotation=0,frame=0;
const resize=()=>{size=canvas.clientWidth;const d=Math.min(devicePixelRatio||1,2);canvas.width=size*d;canvas.height=size*d;ctx.setTransform(d,0,0,d,0,0);};const observer=new ResizeObserver(()=>{resize();if(reduced.matches){cancelAnimationFrame(frame);frame=requestAnimationFrame(draw);}});observer.observe(canvas);resize();
function circle(r,color,alpha,width=1,start=0,end=Math.PI*2){ctx.beginPath();ctx.arc(0,0,r,start,end);ctx.strokeStyle=color;ctx.globalAlpha=alpha;ctx.lineWidth=width;ctx.stroke();}
function dot(x,y,r,c,a){ctx.beginPath();ctx.arc(x,y,r,0,Math.PI*2);ctx.fillStyle=c;ctx.globalAlpha=a;ctx.fill();}
function draw(now){const nextState=getState();if(nextState!==state){state=nextState;changed=t;}const dt=Math.min((now-last)/1000,.05);last=now;if(!paused){t+=dt;rotation+=dt*(state==='thinking'?90:8);}
const color=modes[state].color,breath=(Math.sin(t*1.25)+1)/2,voice=level===null?Math.max(.08,(Math.sin(t*8)+Math.sin(t*13)*.4+1.4)/2.8):level;
ctx.clearRect(0,0,size,size);ctx.save();ctx.translate(size/2,size/2);ctx.scale(size/600,size/600);ctx.globalCompositeOperation='lighter';
const g=ctx.createRadialGradient(0,0,75,0,0,280);g.addColorStop(0,color+'00');g.addColorStop(.25,color+(state==='idle'?'14':'30'));g.addColorStop(1,color+'00');ctx.fillStyle=g;ctx.fillRect(-300,-300,600,600);
circle(268,color,.12);for(let i=0;i<72;i++){const a=i*Math.PI/36;ctx.beginPath();ctx.moveTo(Math.cos(a)*263,Math.sin(a)*263);ctx.lineTo(Math.cos(a)*(i%6?267:274),Math.sin(a)*(i%6?267:274));ctx.strokeStyle=color;ctx.globalAlpha=state==='idle'?.08:.32;ctx.lineWidth=1;ctx.stroke();}
ctx.shadowColor=color;ctx.shadowBlur=12;
if(state==='idle'){
circle(133+breath*8,color,.15+breath*.2,1.5);circle(154+breath*4,color,.08+breath*.1);for(let i=0;i<9;i++){const a=i*2.4+t*.045;dot(Math.cos(a)*181,Math.sin(a)*181,1.3,color,.15+breath*.2);}logo.style.transform=`rotateX(${Math.sin(t*.4)*5}deg) rotateY(${Math.sin(t*.25)*12}deg) scale(${.92+breath*.035})`;
}else if(state==='listening'){
for(let i=0;i<4;i++){const p=(t*.38+i/4)%1;circle(258-p*123,color,Math.sin(p*Math.PI)*.5,1+p*1.5);}
for(let side of [-1,1]){for(let i=0;i<17;i++){const y=(i-8)*9,h=4+Math.pow(Math.cos((i-8)/18*Math.PI),2)*(10+voice*22);ctx.beginPath();ctx.moveTo(side*209-h/2,y);ctx.lineTo(side*209+h/2,y);ctx.strokeStyle=color;ctx.globalAlpha=.85;ctx.lineWidth=3;ctx.stroke();}}
for(let i=0;i<24;i++){const a=i*2.4,p=(t*.3+i/24)%1,r=256-p*120;dot(Math.cos(a)*r,Math.sin(a)*r,1.5,color,Math.sin(p*Math.PI)*.7);}circle(129,color,.7,2);logo.style.transform=`rotateX(${Math.sin(t*.8)*4}deg) rotateY(${Math.sin(t*.7)*10}deg) scale(${1+voice*.035})`;
}else if(state==='thinking'){
for(let j=0;j<4;j++){const r=146+j*27,offset=t*(j%2?-1.5:1.8)*(1+j*.13);for(let i=0;i<3;i++)circle(r,j%2?'#22D3FF':color,.75, j===0?3:1.7,offset+i*2.094,offset+i*2.094+1.2);}
const points=[];for(let i=0;i<12;i++){const a=i*Math.PI/6+t*.5,r=184+Math.sin(t*2+i)*27;points.push([Math.cos(a)*r,Math.sin(a)*r]);}ctx.shadowBlur=0;points.forEach((p,i)=>{const q=points[(i+4)%12];ctx.beginPath();ctx.moveTo(...p);ctx.lineTo(...q);ctx.strokeStyle=color;ctx.globalAlpha=.18;ctx.lineWidth=1;ctx.stroke();dot(...p,2.6,'#D6B8FF',.85);});logo.style.transform=`rotateX(12deg) rotateY(${rotation}deg) scale(.94)`;
}else{
for(let band=0;band<3;band++){ctx.beginPath();for(let i=0;i<=240;i++){const a=i*Math.PI/120,r=140+band*17+Math.sin(a*7-t*9+band)*voice*19+Math.sin(a*11+t*4)*voice*8;i?ctx.lineTo(Math.cos(a)*r,Math.sin(a)*r):ctx.moveTo(Math.cos(a)*r,Math.sin(a)*r);}ctx.closePath();ctx.strokeStyle=[color,'#22D3FF','#A46AFF'][band];ctx.globalAlpha=.8-band*.16;ctx.lineWidth=2.5-band*.5;ctx.stroke();}
for(let i=0;i<96;i++){const a=i*Math.PI/48,h=5+voice*(10+28*(Math.sin(i*.8+t*12)+1)/2);ctx.beginPath();ctx.moveTo(Math.cos(a)*202,Math.sin(a)*202);ctx.lineTo(Math.cos(a)*(202+h),Math.sin(a)*(202+h));ctx.strokeStyle=i%3===0?'#22D3FF':color;ctx.globalAlpha=.8;ctx.lineWidth=2.5;ctx.stroke();}
for(let i=0;i<3;i++){const p=(t*.55+i/3)%1;circle(168+p*91,color,(1-p)*.35,1);}logo.style.transform=`rotateX(${Math.sin(t*1.5)*7}deg) rotateY(${Math.sin(t)*17}deg) scale(${1+voice*.12})`;
}
const burst=Math.min(1,(t-changed)/.85);if(burst<1){circle(115+burst*145,color,(1-burst)*.75,2);}
ctx.restore();logo.style.filter=`drop-shadow(0 0 ${state==='idle'?8:state==='speaking'?18+voice*17:20}px ${color}66)`;if(!reduced.matches && !document.hidden) frame=requestAnimationFrame(draw);}

const restart=()=>{cancelAnimationFrame(frame);last=performance.now();frame=requestAnimationFrame(draw);};reduced.addEventListener('change',restart);document.addEventListener('visibilitychange',restart);restart();return ()=>{cancelAnimationFrame(frame);observer.disconnect();reduced.removeEventListener('change',restart);document.removeEventListener('visibilitychange',restart);};}
