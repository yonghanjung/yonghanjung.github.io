(() => {
  'use strict';
  const E = window.HaydenMath;
  const app = document.getElementById('app');
  const toolbar = document.getElementById('toolbar');
  const STORAGE = 'haydenMathLab.v1';
  const TOPICS = {mix:'Mix',arithmetic:'Arithmetic Challenge',measurement:'Measurement',geometry:'Geometry',narrative:'Narrative',brain:'Brain Teaser'};
  const defaults = {section:'mix',count:10,customCount:10};
  let prefs = {...defaults}, summaries = [], screen = 'home', round = null, notice = '', seedDraft = '', sessionRecentVisible = [];
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE));
    if (saved?.version === 1) {
      if (Object.hasOwn(TOPICS,saved.prefs?.section)) prefs.section = saved.prefs.section;
      if ([10,15,20,'custom','unlimited'].includes(saved.prefs?.count)) prefs.count = saved.prefs.count;
      if (Number.isInteger(saved.prefs?.customCount) && saved.prefs.customCount >= 1 && saved.prefs.customCount <= 999) prefs.customCount = saved.prefs.customCount;
      if (Array.isArray(saved.summaries)) summaries = saved.summaries.filter(s => s && Number.isInteger(s.answered) && s.answered >= 0 && Number.isInteger(s.correct) && s.correct >= 0 && s.correct <= s.answered).slice(-12);
    }
  } catch {}
  const el = (tag,cls,text) => { const n = document.createElement(tag); if(cls) n.className=cls; if(text !== undefined) n.textContent=String(text); return n; };
  function button(text,action,cls='',label) { const b=el('button',cls,text); b.type='button'; if(label) b.setAttribute('aria-label',label); b.addEventListener('click',action); return b; }
  function save() { try {localStorage.setItem(STORAGE,JSON.stringify({version:1,prefs,summaries:summaries.slice(-12)}));} catch {} }
  function valid(q) { try {return Boolean(E && E.verifyQuestion(q).ok);} catch {return false;} }
  function fetchQuestion() {
    if(round.queue) return round.queue[round.index];
    if(!round.cycle.length) {
      const count=round.total===null?10:Math.min(10,round.total-round.index);
      const baselineFingerprints=round.config.seed?[]:round.baselineVisible, recentFingerprints=round.config.seed?[]:round.recent;
      const questions=E.generateRound({section:round.config.section,count,seed:round.config.seed,offset:round.index,baselineFingerprints,recentFingerprints});
      if(!Array.isArray(questions)||questions.length!==count||!questions.every(valid))throw new Error('Questions unavailable');
      round.cycle=questions;
    }
    const q=round.cycle.shift();if(!valid(q))throw new Error('Invalid question');return q;
  }
  function resetQuestion(q) { round.current=q; round.first=null; round.response={}; round.grade=null; round.hintShown=false; round.answerShown=false; round.activeField=0; const fingerprint=E.questionFingerprint(q); round.recent.push(fingerprint); round.recent=round.recent.slice(-20); sessionRecentVisible.push(fingerprint); sessionRecentVisible=sessionRecentVisible.slice(-20); }
  function rememberQuestion() {
    round.visited[round.index]={current:round.current,response:{...round.response},first:round.first,grade:round.grade,hintShown:round.hintShown,answerShown:round.answerShown,activeField:round.activeField};
  }
  function restoreQuestion(index) {
    const saved=round.visited[index];round.index=index;
    Object.assign(round,saved,{response:{...saved.response}});
  }
  function start(config={...prefs,seed:seedDraft},retry=null) {
    notice='';
    const count=config.count==='custom'?config.customCount:config.count;
    if(count!=='unlimited' && (!Number.isInteger(count)||count<1||count>999)) {notice='Choose 1–999 questions.'; return render();}
    let seed;try {seed=E.normalizeSeed(config.seed??'');}catch {notice='Enter a valid date: YYYYMMDD.';return render();}
    const priorRound=round;
    try {
      const queue=retry || null;
      if(queue && (!Array.isArray(queue)||!queue.length||queue.some(q=>!valid(q)))) throw new Error('Invalid question set');
      round={config:{...config,seed},queue,total:queue?queue.length:count==='unlimited'?null:count,index:0,visited:[],cycle:[],baselineVisible:seed?[]:sessionRecentVisible.slice(),recent:[],answered:0,correct:0,mistakes:[],current:null,finished:false};
      resetQuestion(fetchQuestion()); rememberQuestion(); screen='play'; save(); render(); window.scrollTo(0,0);
    } catch {round=priorRound;notice='Questions are unavailable. Please try again.'; screen='home'; render();}
  }
  function home() {
    toolbar.replaceChildren();
    if(round && !round.finished) toolbar.append(button('Continue',()=>{screen='play';notice='';render();}));
    const card=el('section','card setup');
    const topicRow=el('div','setup-row'); topicRow.append(el('span','label','Topic'));
    const topics=el('div','topic-grid'); topics.setAttribute('role','group'); topics.setAttribute('aria-label','Topic');
    for(const [key,label] of Object.entries(TOPICS)) {const b=button(label,()=>{prefs.section=key;notice='';save();render();},prefs.section===key?'selected':''); b.setAttribute('aria-pressed',String(prefs.section===key)); topics.append(b);}
    topicRow.append(topics);card.append(topicRow);
    const countRow=el('div','setup-row');countRow.append(el('span','label','Questions'));
    const counts=el('div','count-grid');counts.setAttribute('role','group');counts.setAttribute('aria-label','Round length');
    for(const count of [10,15,20,'custom','unlimited']) {const label=count==='custom'?'Custom':count==='unlimited'?'∞':String(count);const b=button(label,()=>{prefs.count=count;notice='';save();render();},prefs.count===count?'selected':'',count==='unlimited'?'Unlimited':count==='custom'?'Custom question count':count+' questions');b.setAttribute('aria-pressed',String(prefs.count===count));counts.append(b);}
    countRow.append(counts);
    if(prefs.count==='custom') {const custom=el('div','custom-count');const input=el('input');input.type='text';input.inputMode='numeric';input.maxLength=3;input.value=String(prefs.customCount);input.setAttribute('aria-label','Number of questions');input.addEventListener('input',()=>{prefs.customCount=/^\d+$/.test(input.value)?Number(input.value):null;});custom.append(input,el('span','','1–999'));countRow.append(custom);}
    card.append(countRow);
    const seedRow=el('div','setup-row');seedRow.append(el('label','label','Date (optional)'));
    const seedControls=el('div','seed-controls'),seedInput=el('input');seedInput.id='seed-date';seedRow.firstChild.htmlFor='seed-date';seedInput.type='text';seedInput.inputMode='numeric';seedInput.maxLength=8;seedInput.placeholder='YYYYMMDD';seedInput.value=seedDraft;seedInput.setAttribute('aria-label','Date YYYYMMDD');seedInput.addEventListener('input',()=>{seedDraft=seedInput.value;notice='';card.querySelector('.notice')?.remove();});
    seedControls.append(seedInput,button('Random',()=>{seedDraft='';notice='';render();}));seedRow.append(seedControls);card.append(seedRow,button('Start',()=>start({...prefs,seed:seedDraft}),'primary start'));
    if(!E) {card.lastChild.disabled=true;card.append(el('p','notice','Questions are unavailable.'));}
    if(notice) {const n=el('p','notice',notice);n.setAttribute('role','alert');card.append(n);}
    app.append(card);
  }
  function visual(q,parent) {
    const v=q.visual;if(!v||!['perimeter','ruler','rectangle','clock','coins','angle','lines','symmetry','partition','composite'].includes(v.kind))return;
    const ns='http://www.w3.org/2000/svg',svg=document.createElementNS(ns,'svg');
    svg.setAttribute('class','math-visual'+(v.kind==='ruler'?' ruler-visual':''));svg.setAttribute('role','img');
    const node=(tag,attrs)=>{const n=document.createElementNS(ns,tag);for(const[key,value]of Object.entries(attrs))n.setAttribute(key,String(value));svg.append(n);return n;};
    const text=(content,x,y,anchor='middle')=>{if(content===undefined||content===null||content==='')return;const t=node('text',{x,y,'text-anchor':anchor,'font-size':15,fill:'#173e43'});t.textContent=String(content);return t;};
    if(v.kind==='clock') {
      svg.setAttribute('viewBox','0 0 230 230');svg.setAttribute('aria-label','Analog clock');
      node('circle',{cx:115,cy:115,r:94,fill:'#fffefa',stroke:'#267c74','stroke-width':3});
      const point=(degrees,r)=>({x:115+r*Math.sin(degrees*Math.PI/180),y:115-r*Math.cos(degrees*Math.PI/180)});
      for(let i=0;i<60;i++){const a=point(i*6,i%5===0?84:90),b=point(i*6,94);node('line',{x1:a.x,y1:a.y,x2:b.x,y2:b.y,stroke:'#173e43','stroke-width':i%5===0?2:1});}
      for(let n=1;n<=12;n++){const p=point(n*30,71);const t=text(n,p.x,p.y+5);t.setAttribute('font-size','17');}
      const hour=point((v.hour%12)*30+v.minute*0.5,54),minute=point(v.minute*6,79);
      node('line',{x1:115,y1:115,x2:hour.x,y2:hour.y,stroke:'#173e43','stroke-width':6,'stroke-linecap':'round'});
      node('line',{x1:115,y1:115,x2:minute.x,y2:minute.y,stroke:'#19776e','stroke-width':3.5,'stroke-linecap':'round'});
      node('circle',{cx:115,cy:115,r:5,fill:'#173e43'});parent.append(svg);return;
    }
    if(v.kind==='coins') {
      svg.setAttribute('aria-label','Coin groups with each coin denomination labeled');let y=25;
      for(const group of v.groups||[]) {
        text(group.name,15,y,'start');y+=30;
        const count=group.count===null?1:group.count;
        if(!Number.isInteger(count)||count<0||count>40)return;
        if(group.count===null)text('? ×',18,y+5,'start');
        if(count===0)text('0',30,y+5);
        for(let i=0;i<count;i++){const cx=(group.count===null?90:30)+(i%6)*44,cy=y+Math.floor(i/6)*44;node('circle',{cx,cy,r:18,fill:group.value===5?'#e0e7e5':'#e8f0ef',stroke:'#728b87','stroke-width':1.5});const t=text(group.value+'¢',cx,cy+5);t.setAttribute('font-size','14');}
        y+=Math.max(1,Math.ceil(count/6))*44+15;
      }
      svg.setAttribute('viewBox',`0 0 280 ${y}`);svg.setAttribute('class','math-visual coins-visual');parent.append(svg);return;
    }
    if(v.kind==='angle') {
      svg.setAttribute('viewBox','0 0 240 200');svg.setAttribute('aria-label','Angle formed by two rays');
      const theta=v.degrees*Math.PI/180,x=120+85*Math.cos(theta),y=155-85*Math.sin(theta);
      node('path',{d:`M 205 155 L 120 155 L ${x} ${y}`,fill:'none',stroke:'#267c74','stroke-width':4,'stroke-linecap':'round'});
      node('path',{d:`M 145 155 A 25 25 0 0 0 ${120+25*Math.cos(theta)} ${155-25*Math.sin(theta)}`,fill:'none',stroke:'#7eaaa0','stroke-width':2});parent.append(svg);return;
    }
    if(v.kind==='lines') {
      svg.setAttribute('viewBox','0 0 200 200');svg.setAttribute('aria-label','Two line segments');
      for(const segment of v.segments||[])node('line',{...segment,stroke:'#267c74','stroke-width':3.5,'stroke-linecap':'round'});parent.append(svg);return;
    }
    if(v.kind==='symmetry') {
      svg.setAttribute('viewBox','0 0 230 190');svg.setAttribute('aria-label',v.shape+' shape');
      const points={square:'55,25 175,25 175,145 55,145',rectangle:'40,40 190,40 190,130 40,130',equilateral:`35,155 195,155 115,${155-80*Math.sqrt(3)}`,isosceles:'40,155 190,155 115,40',scalene:'40,155 195,155 80,35'}[v.shape];
      if(!points)return;node('polygon',{points,fill:'#edf4ea',stroke:'#267c74','stroke-width':3});parent.append(svg);return;
    }
    if(v.kind==='partition') {
      svg.setAttribute('viewBox','0 0 230 140');svg.setAttribute('aria-label','Whole divided into equal parts with one part shaded');
      const width=180/v.cols,height=80/v.rows;
      for(let row=0;row<v.rows;row++)for(let col=0;col<v.cols;col++)node('rect',{x:25+col*width,y:25+row*height,width,height,fill:row*v.cols+col<v.shaded?'#8ebbad':'#fffefa',stroke:'#267c74','stroke-width':2});parent.append(svg);return;
    }
    if(v.kind==='composite') {
      const rects=v.rectangles||[];if(rects.length!==2)return;
      const minX=Math.min(...rects.map(r=>r.x)),minY=Math.min(...rects.map(r=>r.y));
      const width=Math.max(...rects.map(r=>r.x+r.width))-minX,height=Math.max(...rects.map(r=>r.y+r.height))-minY,scale=Math.min(190/width,110/height);
      svg.setAttribute('viewBox','0 0 260 220');svg.setAttribute('class','math-visual composite-visual');svg.setAttribute('aria-label','Two adjoining rectangles with labeled dimensions');
      rects.forEach((r,i)=>{const x=30+(r.x-minX)*scale,y=25+(r.y-minY)*scale,w=r.width*scale,h=r.height*scale;node('rect',{x,y,width:w,height:h,fill:i?'#deece6':'#eff4e9',stroke:'#267c74','stroke-width':2});text(i+1,x+w/2,y+h/2+5);text((i+1)+': '+r.widthLabel+' × '+r.heightLabel,130,165+i*25);});parent.append(svg);return;
    }
    if(v.kind==='ruler') {
      if(!Number.isInteger(v.max)||v.max<1||v.max>50||!Number.isInteger(v.start)||!Number.isInteger(v.end)||v.start<0||v.end<=v.start||v.end>v.max)return;
      svg.setAttribute('viewBox','0 0 330 175');svg.setAttribute('aria-label',`Ruler in ${v.unit}. Object starts at ${v.start} and ends at ${v.end}.`);
      const x=value=>20+290*value/v.max;
      node('line',{x1:20,y1:105,x2:310,y2:105,stroke:'#173e43','stroke-width':2});
      for(let i=0;i<=v.max;i++) {
        node('line',{x1:x(i),y1:105,x2:x(i),y2:i%5===0?123:116,stroke:'#173e43','stroke-width':1.5});
        if(v.max<=15||i%2===0||i===v.max)text(i,x(i),143);
      }
      node('line',{x1:x(v.start),y1:72,x2:x(v.end),y2:72,stroke:'#19776e','stroke-width':10,'stroke-linecap':'butt'});
      for(const value of [v.start,v.end])node('line',{x1:x(value),y1:64,x2:x(value),y2:105,stroke:'#19776e','stroke-width':2});
      text('Start: '+v.start,x(v.start),32,v.start<v.max/4?'start':'middle');
      text('End: '+v.end,x(v.end),53,v.end>v.max*3/4?'end':'middle');
      text(v.unit,165,169);parent.append(svg);return;
    }
    svg.setAttribute('viewBox','0 0 230 220');
    if(v.kind==='rectangle') {
      svg.setAttribute('aria-label',`Rectangle. Width ${v.widthLabel}. Height ${v.heightLabel}. Not to scale.`);
      node('rect',{x:25,y:25,width:165,height:100,fill:'#edf4ea',stroke:'#267c74','stroke-width':3});
      text(v.widthLabel,107,151);const heightLabel=text(v.heightLabel,210,75);if(heightLabel)heightLabel.setAttribute('transform','rotate(90 210 75)');
    } else {
      if(!['square','triangle'].includes(v.shape))return;
      svg.setAttribute('aria-label',v.shape+' perimeter diagram');
      node('polygon',{points:v.shape==='square'?'55,20 175,20 175,140 55,140':'115,15 40,140 190,140',fill:'#edf4ea',stroke:'#267c74','stroke-width':3});
      text(v.sideLabel,115,166);text(v.totalLabel,115,190);
    }
    parent.append(svg);if(v.notToScale)parent.append(el('p','diagram-note','Not to scale'));
  }
  function prompt(q,parent) {const box=el('div','prompt');const paragraphs=Array.isArray(q.prompt)?q.prompt:String(q.prompt).split('\n').filter(Boolean);for(const text of paragraphs)box.append(el('p','',text));parent.append(box);visual(q,parent);}
  function renderFields(q,parent) {
    const fields=el('div','response-fields'+(q.response.kind==='pair'?' pair-fields':''));
    q.response.fields.forEach((field,index)=>{
      const wrapper=el('div',q.response.kind==='matching'?'matching-field':'numeric-field');
      const label=el('label','',field.label);label.htmlFor='answer-'+index;wrapper.append(label);
      if(q.response.kind==='choice') {
        label.removeAttribute('for');const choices=el('div','choice-options');choices.setAttribute('role','group');choices.setAttribute('aria-label',field.label);
        for(const option of field.options||[]) {const b=button(option,()=>{round.response[field.key]=option;notice='';render();},round.response[field.key]===option?'selected':'');b.setAttribute('aria-pressed',String(round.response[field.key]===option));b.disabled=Boolean(round.grade?.correct);choices.append(b);}wrapper.append(choices);
      } else if(q.response.kind==='matching') {const select=el('select');select.id='answer-'+index;select.setAttribute('aria-label',field.label);select.append(new Option('Choose…',''));for(const option of field.options||[]) {const value=typeof option==='object'?option.value:option;const title=typeof option==='object'?option.label:option;select.append(new Option(String(title),String(value)));}select.value=round.response[field.key]||'';select.disabled=Boolean(round.grade?.correct);select.addEventListener('change',()=>{round.response[field.key]=select.value;notice='';});wrapper.append(select);}
      else {const value=round.response[field.key]??'';const b=button('',()=>{round.activeField=index;notice='';render();},'field-value'+(round.activeField===index?' active-field':''),field.label+' answer');b.id='answer-'+index;b.setAttribute('aria-pressed',String(round.activeField===index));b.append(el('span','',value===''?'?':value));if(field.unit)b.append(el('small','',field.unit));b.disabled=Boolean(round.grade?.correct);wrapper.append(b);}
      fields.append(wrapper);
    }); parent.append(fields);
  }
  function digit(key) {
    if(screen!=='play'||round.grade?.correct)return;
    const field=round.current.response.fields[round.activeField],current=String(round.response[field.key]??'');
    round.response[field.key]=key==='delete'?current.slice(0,-1):current.length<3?current+key:current;notice='';render();
  }
  function check() {
    if(screen!=='play'||round.grade?.correct)return;
    const q=round.current,response={};
    for(let i=0;i<q.response.fields.length;i++) {const f=q.response.fields[i],raw=String(round.response[f.key]??'').trim();if(!raw) {round.activeField=i;notice='Complete each answer.';return render();}if(['matching','choice'].includes(q.response.kind)) response[f.key]=raw;else if(/^\d+$/.test(raw))response[f.key]=Number(raw);else {notice='Enter a whole number.';return render();}}
    let result;try {result=E.gradeAnswer(q,response);} catch {notice='Please check your answers.';return render();}
    if(!result.valid) {notice='Please check your answers.';return render();}
    round.response={...response};round.grade=result;notice='';
    if(!round.first) {round.first={response:{...response},correct:Boolean(result.correct)};round.answered++;if(result.correct)round.correct++;else round.mistakes.push({question:q,response:{...response}});}
    render();
  }
  function previous() {
    if(!round||round.index===0)return;
    rememberQuestion();restoreQuestion(round.index-1);notice='';render();window.scrollTo(0,0);
  }
  function next() {
    if(!round)return;
    const prior=round.index;
    if(round.visited[prior+1]) {rememberQuestion();restoreQuestion(prior+1);notice='';render();window.scrollTo(0,0);return;}
    if(!round.first)return;
    if(round.total!==null&&prior+1>=round.total)return finish();
    rememberQuestion();round.index=prior+1;
    try {resetQuestion(fetchQuestion());rememberQuestion();notice='';render();window.scrollTo(0,0);}
    catch {restoreQuestion(prior);notice='Could not load the next question.';render();}
  }
  function finish() {if(!round||round.finished)return;round.finished=true;summaries.push({section:round.config.section,answered:round.answered,correct:round.correct,date:new Date().toISOString()});summaries=summaries.slice(-12);save();screen='summary';notice='';render();window.scrollTo(0,0);}
  function play() {
    toolbar.replaceChildren(button('Home',()=>{screen='home';notice='';render();}),button('Finish',finish));
    const box=el('section','card problem');const bar=el('div','round-bar');bar.append(el('span','counter',(round.index+1)+' / '+(round.total===null?'∞':round.total)),el('span','',TOPICS[round.current.section]||TOPICS[round.config.section]));if(round.config.seed)bar.append(el('span','seed-badge',round.config.seed));box.append(bar);
    prompt(round.current,box);renderFields(round.current,box);
    if(['matching','choice'].includes(round.current.response.kind)) {const b=button('Check',check,'primary match-check');b.disabled=Boolean(round.grade?.correct);box.append(b);}
    else {const pad=el('div','pad');pad.setAttribute('role','group');pad.setAttribute('aria-label','Answer keypad');for(const n of [1,2,3,4,5,6,7,8,9]) {const b=button(String(n),()=>digit(String(n)),'',String(n));b.disabled=Boolean(round.grade?.correct);pad.append(b);}pad.append(button('⌫',()=>digit('delete'),'','Delete'),button('0',()=>digit('0'),'','0'),button('Clear',()=>{const f=round.current.response.fields[round.activeField];if(round.grade?.correct)return;round.response[f.key]='';notice='';render();},'','Clear answer'));const b=button('Check',check,'primary check');b.disabled=Boolean(round.grade?.correct);pad.append(b);box.append(pad);}
    if(notice) {const n=el('p','notice',notice);n.setAttribute('role','alert');box.append(n);}
    if(round.grade) {
      const result=el('div','result '+(round.grade.correct?'correct':'wrong'),round.grade.correct?'Correct!':'Try again.');result.setAttribute('role','status');box.append(result);
      const follow=el('div','followup');follow.append(button('Hint',()=>{round.hintShown=!round.hintShown;render();}),button('Answer',()=>{round.answerShown=!round.answerShown;render();}));box.append(follow);
      if(round.hintShown)box.append(el('div','help',round.current.hint));
      if(round.answerShown)box.append(el('div','help',E.formatAnswer(round.current)+'\n'+round.current.explanation));
    }
    const navigation=el('div','question-navigation');const back=button('Previous',previous);back.disabled=round.index===0;const forward=button('Next',next,'primary');forward.disabled=!round.first&&!round.visited[round.index+1];navigation.append(back,forward);box.append(navigation);
    app.append(box);
  }
  function summary() {
    toolbar.replaceChildren(button('Home',()=>{screen='home';notice='';render();}));
    const box=el('section','card summary'),top=el('div','summary-top');
    if(round.answered>0&&round.correct===round.answered)top.append(el('div','master','Master!'));
    const score=el('div','score',round.correct);score.append(el('small','',' / '+round.answered));top.append(score,el('p','summary-subtitle',round.answered?'First answers':'No answers yet.'));
    const actions=el('div','summary-actions');
    if(round.mistakes.length)actions.append(button('Practice mistakes',()=>{const qs=round.mistakes.map(m=>m.question).filter(valid);if(qs.length)start({...round.config},qs);else {notice='Those questions are unavailable.';render();}},'primary'));
    actions.append(button(round.config.seed?'Replay set':'New round',()=>start({...round.config}),round.mistakes.length?'':'primary'));top.append(actions);box.append(top);
    if(round.mistakes.length) {const notebook=el('section','notebook');notebook.append(el('span','label','Mistakes · '+round.mistakes.length));for(const m of round.mistakes) {const row=el('article','mistake');const p=Array.isArray(m.question.prompt)?m.question.prompt.join(' '):m.question.prompt;row.append(el('p','',p));const answers=el('div','answers');answers.append(el('span','given','Your answer: '+E.formatAnswer(m.question,m.response)),el('span','expected','Answer: '+E.formatAnswer(m.question)));row.append(answers);notebook.append(row);}box.append(notebook);}
    if(notice)box.append(el('p','notice',notice));app.append(box);
  }
  function render() {app.replaceChildren();if(screen==='home')home();else if(screen==='summary')summary();else play();}
  document.addEventListener('keydown',event=>{if(screen!=='play'||['matching','choice'].includes(round.current.response.kind)||event.target.closest('select,input'))return;if(/^\d$/.test(event.key)){event.preventDefault();digit(event.key);}else if(event.key==='Backspace'){event.preventDefault();digit('delete');}else if(event.key==='Enter'){event.preventDefault();check();}});
  render();
})();
