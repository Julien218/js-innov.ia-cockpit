const PDFDocument = require('pdfkit');
const path = require('path');

const A4 = { width: 595.28, height: 841.89 };
const M = 26;
const W = A4.width - M * 2;
const ASSETS = path.join(__dirname, 'assets', 'billing');
const LOGO = path.join(ASSETS, 'logo-phoenix-officiel.png');
const SIGNATURE = path.join(ASSETS, 'signature-julien.png');

const C = {
  ink:'#071424', gold:'#D18400', gold2:'#E79A00', text:'#111820', muted:'#4D535B',
  line:'#E8BD6A', grid:'#E7E7E7', soft:'#FAFAF9', white:'#FFFFFF'
};

function money(v){return new Intl.NumberFormat('fr-BE',{style:'currency',currency:'EUR',minimumFractionDigits:2}).format(Number(v||0));}
function date(v){if(!v)return '—';const d=new Date(v);return Number.isNaN(d.valueOf())?String(v):d.toLocaleDateString('fr-BE',{day:'2-digit',month:'2-digit',year:'numeric',timeZone:'UTC'});}
const ONES=['','un','deux','trois','quatre','cinq','six','sept','huit','neuf','dix','onze','douze','treize','quatorze','quinze','seize','dix-sept','dix-huit','dix-neuf'];
function u100(n){if(n<20)return ONES[n];if(n<70){const t=['','','vingt','trente','quarante','cinquante','soixante'][Math.floor(n/10)],u=n%10;return t+(u===1?' et un':u?`-${ONES[u]}`:'');}if(n<80)return `soixante-${ONES[n-60]}`;const r=n-80;return `quatre-vingt${r?`-${ONES[r]}`:'s'}`;}
function u1000(n){if(n<100)return u100(n);const h=Math.floor(n/100),r=n%100,head=h===1?'cent':`${ONES[h]} cent${r?'':'s'}`;return r?`${head} ${u100(r)}`:head;}
function words(v){const n=Math.round(Number(v||0));if(!n)return 'ZÉRO EURO TTC';let s;if(n<1000)s=u1000(n);else{const k=Math.floor(n/1000),r=n%1000;s=`${k===1?'':`${u1000(k)} `}mille${r?` ${u1000(r)}`:''}`;}return `${s.toUpperCase()} EURO${n>1?'S':''} TTC`;}
function text(pdf,v,x,y,o={}){const {size=8,color=C.text,font='Helvetica',...rest}=o;pdf.font(font).fontSize(size).fillColor(color).text(String(v??''),x,y,{characterSpacing:0,...rest});}
function line(pdf,x1,y1,x2,y2,color=C.line,width=.6){pdf.save().strokeColor(color).lineWidth(width).moveTo(x1,y1).lineTo(x2,y2).stroke().restore();}
function box(pdf,x,y,w,h,r=3,color=C.line,width=.65){pdf.save().roundedRect(x,y,w,h,r).strokeColor(color).lineWidth(width).stroke().restore();}
function pin(pdf,x,y){pdf.save().strokeColor(C.gold2).lineWidth(1).circle(x,y,5).stroke().circle(x,y,1.4).stroke().moveTo(x-3.5,y+3.5).lineTo(x,y+8).lineTo(x+3.5,y+3.5).stroke().restore();}
function phone(pdf,x,y){pdf.save().strokeColor(C.gold2).lineWidth(1.1).moveTo(x-4,y-5).bezierCurveTo(x-7,y,x,y+8,x+5,y+4).stroke().rect(x-5,y-6,3,4).stroke().rect(x+3,y+2,3,4).stroke().restore();}
function mail(pdf,x,y){pdf.save().strokeColor(C.gold2).lineWidth(1).rect(x-6,y-4,12,8).stroke().moveTo(x-6,y-4).lineTo(x,y+1).lineTo(x+6,y-4).stroke().restore();}
function globe(pdf,x,y,r=6){pdf.save().strokeColor(C.gold2).lineWidth(.9).circle(x,y,r).stroke().ellipse(x,y,r*.42,r).stroke().moveTo(x-r,y).lineTo(x+r,y).stroke().restore();}
function docIcon(pdf,x,y){pdf.save().strokeColor(C.gold2).lineWidth(1).rect(x-5,y-7,10,14).stroke().moveTo(x-2,y-2).lineTo(x+2,y-2).moveTo(x-2,y+1).lineTo(x+2,y+1).stroke().restore();}
function bank(pdf,x,y){pdf.save().strokeColor(C.gold2).lineWidth(1).moveTo(x-8,y-4).lineTo(x,y-9).lineTo(x+8,y-4).closePath().stroke();[-5,0,5].forEach(dx=>pdf.moveTo(x+dx,y-3).lineTo(x+dx,y+5));pdf.stroke().moveTo(x-9,y+6).lineTo(x+9,y+6).stroke().restore();}
function clock(pdf,x,y){pdf.save().strokeColor(C.gold2).lineWidth(1).circle(x,y,8).stroke().moveTo(x,y).lineTo(x,y-5).moveTo(x,y).lineTo(x+4,y+3).stroke().restore();}
function shield(pdf,x,y){pdf.save().strokeColor(C.gold2).lineWidth(1.1).moveTo(x,y-11).lineTo(x+10,y-7).lineTo(x+8,y+7).quadraticCurveTo(x,y+14,x-8,y+7).lineTo(x-10,y-7).closePath().stroke();pdf.moveTo(x-3,y+4).quadraticCurveTo(x,y-5,x+3,y+4).stroke().restore();}

function drawHeader(pdf,doc,type){
  pdf.save().fillColor('#FBFBFA').rect(0,0,A4.width,209).fill();
  pdf.fillColor('#F5F5F4').polygon([0,0],[115,0],[0,102]).fill();
  pdf.fillColor('#F7F7F6').polygon([0,137],[81,29],[166,0],[0,0]).fill();
  pdf.fillColor('#F4F4F3').polygon([A4.width-93,0],[A4.width,0],[A4.width,152]).fill();
  pdf.fillColor('#F1F1F0').polygon([A4.width-30,151],[A4.width,111],[A4.width,209],[A4.width-96,209]).fill();
  pdf.fillColor('#F2B43A').polygon([A4.width-55,0],[A4.width,0],[A4.width,55]).fill().restore();
  pdf.image(LOGO,34,29,{fit:[84,84],align:'center',valign:'center'});
  text(pdf,'JS-Innov.',141,40,{size:29,font:'Times-Roman',color:C.ink,width:144});
  text(pdf,'IA',278,40,{size:29,font:'Times-Roman',color:C.gold2,width:40});
  text(pdf,'®',318,39,{size:7,font:'Helvetica-Bold',color:C.ink});
  text(pdf,'Julien Pagin',188,75,{size:12,font:'Helvetica-Oblique',color:C.gold2,width:106,align:'center'});
  text(pdf,"AUTOMATISATION INTELLIGENTE, AMPLIFIÉE PAR L’HUMAIN",136,103,{size:6.1,font:'Helvetica',color:C.text,width:198,align:'center'});
  line(pdf,198,120,270,120,C.gold2,.55); line(pdf,233,118,235,122,C.gold2,.8);
  line(pdf,373,27,373,183,C.gold2,.75);
  text(pdf,type==='facture'?'FACTURE':'DEVIS',396,39,{size:22.5,font:'Helvetica-Bold',color:C.ink,width:166});
  line(pdf,396,69,499,69,C.gold2,.6); line(pdf,446,67,448,71,C.gold2,.8);
  const rows=type==='facture' ? [
    ['N° DE FACTURE',String(doc.numero||'—').toUpperCase(),true],
    ['DATE DE FACTURATION',date(doc.date_emission||doc.created_at)],
    ["DATE D’ÉCHÉANCE",date(doc.date_echeance)],
    ['PÉRIODE',doc.periode||'—']
  ] : [
    ['N° DE DEVIS',String(doc.numero||'—').toUpperCase(),true],
    ['DATE DU DEVIS',date(doc.date_emission||doc.created_at)],
    ["VALABLE JUSQU’AU",date(doc.date_validite)],
    ['RÉFÉRENCE',doc.reference||'—']
  ];
  rows.forEach(([label,val,hi],i)=>{const y=85+i*24;text(pdf,label,396,y,{size:6.7,font:'Helvetica',width:105});text(pdf,val,476,y,{size:7.8,font:hi?'Helvetica-Bold':'Helvetica',color:hi?C.gold2:C.text,width:88,align:'right'});});
  const y=157;
  pin(pdf,40,y+2); text(pdf,'Pagin Julien\nGrand Rue 52\n7370 Dour, Belgique',54,y-4,{size:7.4,lineGap:2,width:112});
  line(pdf,134,153,134,184,'#E7E2DA',.45);
  phone(pdf,153,y+1); text(pdf,'0494/11.90.90',168,y-4,{size:7.1,width:86});
  mail(pdf,153,y+21); text(pdf,'info@jsinnovia.store',168,y+16,{size:6.8,width:90});
  line(pdf,246,153,246,184,'#E7E2DA',.45);
  globe(pdf,265,y+1,5.5); text(pdf,'www.jsinnovia.com',280,y-4,{size:6.8,width:90});
  docIcon(pdf,265,y+21); text(pdf,'TVA BE 0877.926.214',280,y+16,{size:6.3,width:92});
}

function drawClient(pdf,doc,type){
  const y=230;
  text(pdf,type==='facture'?'FACTURÉ À':'DEVIS ÉMIS POUR',29,y,{size:7.1,font:'Helvetica'});
  line(pdf,29,y+14,51,y+14,C.gold2,1.5);
  text(pdf,doc.client_nom||'—',29,y+29,{size:9.2,font:'Helvetica-Bold',width:300});
  text(pdf,doc.client_adresse||'',29,y+50,{size:8,width:280});
  text(pdf,doc.client_ville||'',29,y+69,{size:8,width:280});
  const legal = doc.client_tva ? `N° TVA : ${doc.client_tva}` : (doc.client_numero_entreprise ? `N° ENTREPRISE : ${doc.client_numero_entreprise}` : '');
  if(legal) text(pdf,legal,29,y+91,{size:7.8,width:290});
  const bx=389,by=222,bw=176,bh=124; box(pdf,bx,by,bw,bh,3,C.gold2,.65);
  const terms=[
    ['RÉFÉRENCE',doc.objet||doc.reference||'Prestations JS-Innov.IA','doc'],
    ['MODE DE PAIEMENT',doc.mode_paiement||'Virement bancaire','pay'],
    ['CONDITIONS DE PAIEMENT',doc.conditions_paiement||'Paiement à 30 jours','clock']
  ];
  terms.forEach(([lab,val,ico],i)=>{const ty=236+i*39;if(ico==='clock')clock(pdf,bx+22,ty+6);else docIcon(pdf,bx+22,ty+6);text(pdf,lab,bx+42,ty,{size:6.8,font:'Helvetica-Bold',width:126});text(pdf,val,bx+42,ty+15,{size:7.6,width:126,height:18,ellipsis:true});});
}

function normalizeItems(doc){
  const items=Array.isArray(doc.items)&&doc.items.length?doc.items:[{description:doc.objet||'Prestation JS-Innov.IA',periode:doc.periode||'',unit_price_ht:doc.montant_ht||0,tva:doc.tva||21,total_ttc:doc.montant_ttc||0}];
  if(items.length>2) throw new Error('Le modèle officiel de référence accepte 2 lignes visuelles maximum. Regroupez les prestations afin de conserver une mise en page identique.');
  return items;
}
function drawTable(pdf,doc){
  const items=normalizeItems(doc),x=M,y=357,widths=[269,80,80,48,66],xs=[x];widths.slice(0,-1).forEach(w=>xs.push(xs.at(-1)+w));
  const hh=23,rowH=76,tableH=hh+rowH*2;
  pdf.save().roundedRect(x,y,W,hh,5).fill(C.ink).restore();
  ['DESCRIPTION','PÉRIODE','PRIX UNIT. HT','TVA','TOTAL TTC'].forEach((h,i)=>text(pdf,h,xs[i]+4,y+8,{size:6.7,font:'Helvetica-Bold',color:'#E7A71B',width:widths[i]-8,align:i?'center':'left'}));
  for(let i=0;i<2;i++){
    const ry=y+hh+i*rowH,item=items[i];
    if(i===1) pdf.save().fillColor('#FEFEFD').rect(x,ry,W,rowH).fill().restore();
    xs.slice(1).forEach(cx=>line(pdf,cx,ry,cx,ry+rowH,C.grid,.45)); line(pdf,x,ry+rowH,x+W,ry+rowH,C.grid,.45);
    if(!item) continue;
    if(i===0) globe(pdf,x+20,ry+25,8); else shield(pdf,x+20,ry+27);
    text(pdf,item.description||'—',x+40,ry+10,{size:8,font:'Helvetica-Bold',width:widths[0]-49,height:18,ellipsis:true});
    if(item.url) text(pdf,item.url,x+40,ry+28,{size:7.2,font:'Helvetica-Bold',color:C.gold2,width:widths[0]-49,height:13,ellipsis:true});
    if(item.note) text(pdf,item.note,x+40,ry+45,{size:6.8,color:C.text,width:widths[0]-49,height:26,ellipsis:true,lineGap:1.4});
    const cy=ry+31;
    text(pdf,item.periode||item.period||doc.periode||'',xs[1]+7,cy-4,{size:7.1,width:widths[1]-14,align:'center',height:34});
    text(pdf,money(item.unit_price_ht??item.total_ht),xs[2]+5,cy+4,{size:7.2,width:widths[2]-10,align:'center'});
    text(pdf,`${item.tva??doc.tva??21}%`,xs[3]+4,cy+4,{size:7.2,width:widths[3]-8,align:'center'});
    text(pdf,money(item.total_ttc),xs[4]+3,cy+4,{size:8,font:'Helvetica-Bold',color:C.gold2,width:widths[4]-7,align:'right'});
  }
  box(pdf,x,y,W,tableH,5,C.line,.65); return y+tableH;
}

function drawTotals(pdf,doc,type){
  const y=542;
  text(pdf,type==='facture'?'ARRÊTÉ LA PRÉSENTE FACTURE À LA SOMME DE :':'ARRÊTÉ LE PRÉSENT DEVIS À LA SOMME DE :',M,y+32,{size:7,font:'Helvetica-Bold',width:300});
  text(pdf,words(doc.montant_ttc),M,y+49,{size:9.3,font:'Helvetica-Bold',color:C.gold,width:320});
  line(pdf,M,y+69,M+193,y+69,C.gold2,.7);
  const bx=349,bw=216; box(pdf,bx,y,bw,67,2,C.line,.5);
  text(pdf,'SOUS-TOTAL HT',bx+13,y+8,{size:7,font:'Helvetica',width:110});text(pdf,money(doc.montant_ht),bx+120,y+8,{size:8,font:'Helvetica-Bold',width:82,align:'right'});
  line(pdf,bx,y+22,bx+bw,y+22,C.grid,.4);text(pdf,`TVA (${doc.tva??21}%)`,bx+13,y+29,{size:7,font:'Helvetica',width:110});
  const vat=doc.montant_tva??(Number(doc.montant_ttc||0)-Number(doc.montant_ht||0));text(pdf,money(vat),bx+120,y+29,{size:8,font:'Helvetica-Bold',width:82,align:'right'});
  pdf.save().fillColor(C.gold).rect(bx,y+44,bw,23).fill().restore();text(pdf,'TOTAL TTC',bx+13,y+50,{size:8.5,font:'Helvetica',color:C.white,width:90});text(pdf,money(doc.montant_ttc),bx+110,y+47,{size:12.2,font:'Helvetica-Bold',color:C.white,width:92,align:'right'});
}

function drawBottom(pdf,doc){
  const y=632;
  box(pdf,M,y,196,64,2,C.line,.6);
  pdf.save().strokeColor(C.gold2).lineWidth(1).circle(M+15,y+16,8).stroke().restore();
  text(pdf,'i',M+12.5,y+10.5,{size:8,font:'Helvetica-Bold',color:C.gold2});
  text(pdf,'NOTE',M+28,y+10,{size:7,font:'Helvetica-Bold'});
  text(pdf,'Nous vous remercions pour votre confiance.\nPour toute question, n’hésitez pas à nous contacter.',M+28,y+25,{size:6.5,lineGap:2,width:155});

  const bankX=241;
  bank(pdf,bankX+9,y+14);
  text(pdf,'COORDONNÉES BANCAIRES',bankX+26,y+7,{size:6.8,font:'Helvetica-Bold',width:145});
  text(pdf,'Bénéficiaire : Pagin Julien (JS-Innov.IA®)\nIBAN BE52 6528 4346 5909\nIBAN BE20 6508 1271 7456\nBIC : JVBABE22',bankX+26,y+21,{size:6.2,font:'Helvetica-Bold',lineGap:1.5,width:150});
  text(pdf,`Communication : ${String(doc.numero||'—').toUpperCase()}`,bankX+26,y+58,{size:6.2,font:'Helvetica-Bold',width:150});

  line(pdf,421,y,421,y+64,C.line,.6);
  text(pdf,'Julien Pagin',435,y+2,{size:7.3,font:'Helvetica-Bold',width:128,align:'center'});
  pdf.image(SIGNATURE,451,y+18,{fit:[95,30],align:'center',valign:'center'});
  text(pdf,'Fondateur - JS-Innov.IA®',435,y+51,{size:6.5,font:'Helvetica-Bold',width:128,align:'center'});

  const legalY=712;
  line(pdf,M,legalY,A4.width-M,legalY,C.line,.5);
  text(pdf,"TVA calculée conformément au règlement 967/2012 du Conseil de l’Union européenne.",M,legalY+8,{size:6.1,width:W,align:'center'});
  text(pdf,'En cas de retard de paiement, des intérêts de 1% par mois seront appliqués sur le montant dû.',M,legalY+19,{size:6.1,width:W,align:'center'});

  // Footer volontairement épuré : aucune icône de service ni bloc noir.
  // Cette zone reste fixe pour garantir le même rendu à chaque génération.
  const footerY=770;
  line(pdf,105,footerY,165,footerY,C.gold2,.65);
  line(pdf,430,footerY,490,footerY,C.gold2,.65);
  text(pdf,"L’INTELLIGENCE AU SERVICE DE VOS AMBITIONS",170,footerY-5,{size:6.4,font:'Helvetica',color:C.ink,width:255,align:'center',characterSpacing:1.15});
  text(pdf,'www.jsinnovia.com  •  info@jsinnovia.store',M,footerY+24,{size:6.2,color:C.muted,width:W,align:'center'});
}

function drawCancelled(pdf,doc,type){if(type!=='facture'||String(doc.statut||'').toLowerCase()!=='annulee')return;pdf.save().opacity(.14).fillColor('#B42318').font('Helvetica-Bold').fontSize(52).rotate(-24,{origin:[A4.width/2,A4.height/2]}).text('ANNULÉE',80,390,{width:A4.width-160,align:'center'}).restore();}

function generateInvoicePDF(doc,type='facture'){
  return new Promise((resolve,reject)=>{const chunks=[],pdf=new PDFDocument({size:'A4',margin:0,autoFirstPage:true,bufferPages:true});pdf.on('data',c=>chunks.push(c));pdf.on('error',reject);pdf.on('end',()=>resolve(Buffer.concat(chunks)));try{drawHeader(pdf,doc,type);drawClient(pdf,doc,type);drawTable(pdf,doc);drawTotals(pdf,doc,type);drawBottom(pdf,doc);drawCancelled(pdf,doc,type);if(pdf.bufferedPageRange().count!==1)throw new Error('Le PDF officiel doit tenir sur une seule page A4.');pdf.end();}catch(e){reject(e);}});
}
module.exports={generateInvoicePDF,money,words};
