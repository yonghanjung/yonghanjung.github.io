/* Hayden Math browser rule adapter.
 * Source: personal/family/education/hayden_math_generator/hwangso_problem_types.json v4;
 * hayden_math_generator.py sample_daily_equation_binding, sample_daily_story_binding,
 * sample_daily_multiplication_game_bindings, _sample_saved_problem_type_instance.
 * Interactive mode: no packet/date/history policy, PDF, API, or legacy CLI.
 */
(function(root){
'use strict';
const BRAINS=['multiplication_inequality_intersection','mistaken_multiplier_correction','dad_mom_total_difference','square_or_equilateral_triangle_perimeter','equilateral_triangle_perimeter_inverse','five_person_surname_logic'];
const SHAPES=['addition_result_blank','addition_missing_addend','subtraction_result_blank','subtraction_missing_minuend','subtraction_missing_subtrahend','single_digit_multiplication_fact_family_product_blank','two_digit_by_one_digit_product_blank','two_digit_by_one_digit_missing_two_digit_factor','two_digit_by_one_digit_missing_one_digit_factor','mixed_multiply_add_subtract_result_blank','mixed_multiply_add_subtract_missing_factor','mixed_multiply_add_subtract_missing_addend','mixed_multiply_add_subtract_missing_subtrahend'];
const FIRST=['Avery','Blake','Casey','Drew','Emery','Finley','Harper','Jamie','Jordan','Quinn','Riley','Rowan','Sage','Taylor'];
const LAST=['Brooks','Carter','Clark','Ellis','Foster','Grant','Hayes','Lane','Parker','Reed','Scott','Turner','Walker','Young'];
// 0 = person -> surname; 1 = surname -> person; roles preserve canonical patterns.
const PATTERNS=[[[0,1,2],[0,1,4],[0,3,2],[1,0,3],[1,3,0],[1,4,1]],[[0,1,3],[0,3,1],[1,2,0],[1,2,4],[1,3,0],[1,4,2]],[[0,0,1],[0,1,0],[0,3,4],[0,4,3],[1,1,2],[1,3,2]],[[0,1,2],[0,2,0],[0,2,1],[0,3,4],[0,4,3],[1,3,0]],[[0,1,2],[0,4,3],[1,0,1],[1,1,0],[1,3,2],[1,3,4]],[[0,2,0],[0,2,4],[0,4,2],[1,1,0],[1,1,3],[1,3,1]],[[0,3,2],[1,0,4],[1,1,3],[1,3,1],[1,4,0],[1,4,2]],[[0,1,3],[0,2,4],[1,0,2],[1,2,0],[1,3,1],[1,3,4]],[[0,4,0],[0,4,2],[1,0,4],[1,1,3],[1,3,1],[1,3,2]],[[0,2,1],[0,3,0],[1,1,0],[1,1,2],[1,3,4],[1,4,3]],[[0,3,4],[0,4,3],[1,1,2],[1,2,0],[1,2,1],[1,4,0]],[[0,1,0],[0,1,2],[0,3,2],[1,0,1],[1,3,4],[1,4,3]]];
let rngContext=null;
function questionId(){return rngContext?'seed-pending':'q-'+Array.from(root.crypto.getRandomValues(new Uint32Array(2)),n=>n.toString(36)).join('-');}
const range=(a,b)=>Array.from({length:b-a+1},(_,i)=>a+i);
const int=(n,a,b)=>Number.isInteger(n)&&n>=a&&n<=b;
function rand(a,b){if(!int(a,0,1000000)||!int(b,a,1000000))throw Error('Invalid random range');const n=b-a+1,limit=Math.floor(4294967296/n)*n,buf=new Uint32Array(1);for(let i=0;i<128;i++){if(rngContext)buf[0]=rngContext();else root.crypto.getRandomValues(buf);if(buf[0]<limit)return a+buf[0]%n;}throw Error('Random source exhausted');}
function shuffle(xs){const a=[...xs];for(let i=a.length-1;i>0;i--){const j=rand(0,i);[a[i],a[j]]=[a[j],a[i]];}return a;}
const pick=xs=>xs[rand(0,xs.length-1)];
function bounded(factory,predicate,max=5000){for(let i=0;i<max;i++){const p=factory();if(predicate(p))return p;}throw Error('Valid problem capacity exhausted');}
function carry(a,b){let c=0,any=false;for(let i=0;i<3;i++){const t=a%10+b%10+c;c=t>=10?1:0;any=any||!!c;a=Math.floor(a/10);b=Math.floor(b/10);}return any;}
function borrow(a,b){let c=0,any=false;for(let i=0;i<3;i++){const t=a%10-c-b%10;c=t<0?1:0;any=any||!!c;a=Math.floor(a/10);b=Math.floor(b/10);}return any;}
function permutations(a){if(!a.length)return [[]];return a.flatMap((v,i)=>permutations(a.filter((_,j)=>j!==i)).map(t=>[v,...t]));}
function matchingHolds(assignment,p,clue){return clue.orientation===0?clue.options.includes(assignment[p.first.indexOf(clue.subject)]):clue.options.includes(p.first[assignment.indexOf(clue.subject)]);}
function survivors(p,removed=-1){return permutations(p.last).filter(a=>p.clues.every((c,i)=>i===removed||matchingHolds(a,p,c)));}
function eliminate(p){const domains=Object.fromEntries(p.first.map(f=>[f,new Set(p.last)]));for(const c of p.clues){if(c.orientation===0)domains[c.subject]=new Set([...domains[c.subject]].filter(s=>c.options.includes(s)));else for(const f of p.first)if(!c.options.includes(f))domains[f].delete(c.subject);}for(let step=0;step<30;step++){let changed=false;const fixed=p.first.filter(f=>domains[f].size===1).map(f=>[...domains[f]][0]);if(new Set(fixed).size!==fixed.length)throw Error('Inconsistent matching');for(const f of p.first)if(domains[f].size>1)for(const s of fixed)if(domains[f].delete(s))changed=true;for(const s of p.last){const owners=p.first.filter(f=>domains[f].has(s));if(owners.length===1&&domains[owners[0]].size!==1){domains[owners[0]]=new Set([s]);changed=true;}}if(p.first.some(f=>!domains[f].size))throw Error('Empty matching domain');if(!changed)break;}if(p.first.some(f=>domains[f].size!==1))throw Error('Matching not solved');return Object.fromEntries(p.first.map(f=>[f,[...domains[f]][0]]));}
function equationParams(shape,width){
 if(shape.startsWith('addition_')||shape.startsWith('subtraction_')){const w=width??pick([2,3]);if(![2,3].includes(w))throw Error('Width must be 2 or 3');const lo=10**(w-1),hi=10**w-1;const p=bounded(()=>({a:rand(lo,hi),b:rand(lo,hi)}),p=>p.a!==p.b&&p.a+p.b<=hi&&carry(p.a,p.b),1000);const add=shape.startsWith('addition_');const terms=add?[p.a,p.b,p.a+p.b]:pick([[p.a+p.b,p.a,p.b],[p.a+p.b,p.b,p.a]]);const blank=shape.endsWith('result_blank')?2:add?pick([0,1]):shape.endsWith('missing_minuend')?0:1;return {kind:'addsub',width:w,op:add?'+':'−',terms,blank};}
 if(shape.startsWith('mixed_')){const p=bounded(()=>{const [a,b]=shuffle(range(2,9)).slice(0,2),c=rand(10,899),after=a*b+c,d=rand(10,after-1);return {a,b,c,d,z:after-d};},p=>carry(p.a*p.b,p.c)&&borrow(p.a*p.b+p.c,p.d)&&Math.max(p.c,p.d,p.a*p.b+p.c,p.z)>=100);const role=shape.endsWith('result_blank')?'z':shape.endsWith('missing_factor')?'a':shape.endsWith('missing_addend')?'c':'d';return {kind:'mixed',...p,role};}
 const fact=shape==='single_digit_multiplication_fact_family_product_blank';const p=fact?(()=>{const [a,b]=shuffle(range(2,9)).slice(0,2);return {a,b};})():bounded(()=>({a:rand(10,99),b:rand(2,9)}),p=>(p.a%10)*p.b>=10||Math.floor(p.a/10)*p.b+Math.floor((p.a%10)*p.b/10)>=10,1000);const blank=shape.endsWith('missing_two_digit_factor')?0:shape.endsWith('missing_one_digit_factor')?1:2;return {kind:'multiply',fact,distinct:fact,terms:[p.a,p.b,p.a*p.b],blank};
}
function brainParams(type){
 if(type===BRAINS[0]){const x=rand(3,8),[a,b,c]=shuffle(range(3,9)).slice(0,3),floor=rand(2,x-1);return {clues:shuffle([{factor:a,op:'>',bound:rand(a*(x-1),a*x-1)},{factor:b,op:'<',bound:rand(b*x+1,b*(x+1))},{factor:c,op:'>',bound:rand(c*(floor-1),c*floor-1)}])};}
 if(type===BRAINS[1]){const n=rand(2,9),[intended,mistaken]=shuffle(range(2,9)).slice(0,2);return {intended,mistaken,observed:n*mistaken,context:pick(['a practice card','a score sheet','a number puzzle'])};}
 if(type===BRAINS[2])return bounded(()=>({total:rand(180,500),difference:rand(20,160),context:pick(['a family movie night','a neighborhood picnic','a birthday party'])}),p=>p.total>p.difference&&(p.total+p.difference)%2===0,200);
 if(type===BRAINS[3])return {shape:pick(['square','triangle']),side:rand(3,20),unit:pick(['cm','in'])};
 if(type===BRAINS[4])return {perimeter:3*rand(2,9),unit:pick(['cm','in']),context:pick(['a ribbon border','a garden sign','an art frame'])};
 const roles=shuffle(FIRST).slice(0,5),surnameRoles=shuffle(LAST).slice(0,5),pattern=pick(PATTERNS),dual=rand(0,1);return {first:shuffle(roles),last:shuffle(surnameRoles),clues:shuffle(pattern.map(([o,t,d])=>{const orientation=o^dual;return {orientation,subject:orientation===0?roles[t]:surnameRoles[t],options:shuffle(orientation===0?[surnameRoles[t],surnameRoles[d]]:[roles[t],roles[d]])};}))};
}
function equationText(p,blank=true){if(p.kind==='mixed'){const value=k=>blank&&p.role===k?'□':p[k];return `(${value('a')} × ${p.b}) + ${value('c')} − ${value('d')} = ${value('z')}`;}const t=p.terms.map((v,i)=>blank&&i===p.blank?'□':v);return `${t[0]} ${p.kind==='addsub'?p.op:'×'} ${t[1]} = ${t[2]}`;}
function equationDomain(p){return p.kind==='mixed'?p.role==='a'?range(2,9):p.role==='z'?range(1,999):range(10,999):p.kind==='addsub'?range(0,10**p.width-1):p.blank===0?(p.fact?range(2,9):range(10,99)):p.blank===1?range(2,9):range(1,p.fact?81:999);}
function equationHolds(p,x){if(p.kind==='mixed')return (p.role==='a'?x:p.a)*p.b+(p.role==='c'?x:p.c)-(p.role==='d'?x:p.d)===(p.role==='z'?x:p.z);const t=p.terms.map((v,i)=>i===p.blank?x:v);return p.kind==='addsub'?(p.op==='+'?t[0]+t[1]:t[0]-t[1])===t[2]:t[0]*t[1]===t[2];}
function expected(section,type,p){
 if(section!=='brain'){const values=equationDomain(p).filter(x=>equationHolds(p,x));if(values.length!==1)throw Error('Equation not unique');return {value:values[0]};}
 if(type===BRAINS[0]){const xs=range(1,9).filter(x=>p.clues.every(c=>c.op==='>'?x*c.factor>c.bound:x*c.factor<c.bound));if(xs.length!==1)throw Error('Inequality not unique');return {value:xs[0]};}
 if(type===BRAINS[1]){const xs=range(1,9).filter(x=>x*p.mistaken===p.observed);if(xs.length!==1)throw Error('Number not unique');return {value:xs[0]*p.intended};}
 if(type===BRAINS[2]){const xs=range(1,p.total-1).filter(x=>x-(p.total-x)===p.difference);if(xs.length!==1)throw Error('Pair not unique');return {Dad:xs[0],Mom:p.total-xs[0]};}
 if(type===BRAINS[3])return {value:Array(p.shape==='square'?4:3).fill(p.side).reduce((a,b)=>a+b,0)};
 if(type===BRAINS[4]){const xs=range(2,9).filter(x=>x+x+x===p.perimeter);if(xs.length!==1)throw Error('Side not unique');return {value:xs[0]};}
 const xs=survivors(p);if(xs.length!==1)throw Error('Matching not unique');return Object.fromEntries(p.first.map((f,i)=>[f,xs[0][i]]));
}
function storyText(p){const who=p.actor;
 if(p.kind==='mixed'){const pack=p.role==='a'?`${who} filled some trays with ${p.b} cards each.`:`${who} filled ${p.a} trays with ${p.b} cards each.`;const add=p.role==='c'?'A helper added some more cards.':`A helper added ${p.c} more cards.`;const take=p.role==='d'?'Students used some cards.':`Students used ${p.d} cards.`;const end=p.role==='z'?'':`There were ${p.z} cards left.`;const ask={a:'How many trays were filled?',c:'How many cards did the helper add?',d:'How many cards did students use?',z:'How many cards were left?'}[p.role];return `${pack} ${add} ${take} ${end} No other cards were added or removed. ${ask}`.replace(/  /g,' ');}
 const [a,b,z]=p.terms;
 if(p.kind==='multiply')return p.blank===2?`${who} filled ${a} boxes with ${b} cards each. There were no loose cards. How many cards were in all the boxes?`:p.blank===0?`${who} filled some boxes with ${b} cards each. There were ${z} cards in all, with no loose cards. How many boxes were filled?`:`${who} filled ${a} boxes equally. There were ${z} cards in all, with no loose cards. How many cards were in each box?`;
 if(p.op==='+')return p.blank===2?`${who} had ${a} stickers and got ${b} more. No stickers were removed. How many stickers did ${who} have then?`:p.blank===0?`${who} had some stickers and got ${b} more. There were ${z} stickers then. No stickers were removed. How many stickers did ${who} have at first?`:`${who} had ${a} stickers and got some more. There were ${z} stickers then. No stickers were removed. How many stickers did ${who} get?`;
 return p.blank===2?`${who} had ${a} cards and gave away ${b}. No cards were added or lost. How many cards were left?`:p.blank===0?`${who} gave away ${b} cards and had ${z} left. No cards were added or lost. How many cards did ${who} have at first?`:`${who} had ${a} cards and gave some away. There were ${z} left. No cards were added or lost. How many cards were given away?`;
}
function presentation(section,type,p){
 const numeric={kind:'integer',fields:[{key:'value',label:'Answer'}]};
 if(section!=='brain')return {prompt:section==='story'?storyText(p):equationText(p),response:numeric,visual:null,hint:p.kind==='mixed'?'Follow the multiply, add, and subtract steps. If a step is missing, work backward.':p.kind==='multiply'?'Use equal groups. A missing factor can be found by sharing the total.':'Use the known amounts. Addition and subtraction can undo each other.',explanation:equationText(p,false)};
 if(type===BRAINS[0])return {prompt:'Choose a number from 1 to 9. All three clues must be true.\n'+p.clues.map(c=>`□ × ${c.factor} ${c.op} ${c.bound}`).join('\n'),response:numeric,visual:null,hint:'Try each number from 1 to 9. Keep only numbers that fit every clue.',explanation:'Check all three products for the same number.'};
 if(type===BRAINS[1])return {prompt:`On ${p.context}, Hayden should have multiplied a number by ${p.intended}. He used ${p.mistaken} instead and got ${p.observed}. What answer should he have gotten?`,response:numeric,visual:null,hint:'First find the original number. Then use the intended multiplier.',explanation:`${p.observed} ÷ ${p.mistaken} = ${p.observed/p.mistaken}; then multiply by ${p.intended}.`};
 if(type===BRAINS[2])return {prompt:`For ${p.context}, Dad and Mom have ${p.total} candies together. Dad has ${p.difference} more than Mom. How many does each have?`,response:{kind:'pair',fields:[{key:'Dad',label:'Dad'},{key:'Mom',label:'Mom'}]},visual:null,hint:'Set aside the extra candies first. Split the remaining candies equally.',explanation:`Remove the extra ${p.difference}, then split the remaining ${p.total-p.difference} equally. Dad gets the extra candies.`};
 if(type===BRAINS[3])return {prompt:`All ${p.shape==='square'?'four':'three'} sides are ${p.side} ${p.unit} long. What is the distance around the ${p.shape==='square'?'square':'triangle'}?`,response:{kind:'integer',fields:[{key:'value',label:'Distance',unit:p.unit}]},visual:{kind:'perimeter',shape:p.shape,sideLabel:`${p.side} ${p.unit}`},hint:'Add the length of every side.',explanation:Array(p.shape==='square'?4:3).fill(p.side).join(' + ')};
 if(type===BRAINS[4])return {prompt:`All three sides of this triangle have the same length. Its distance around is ${p.perimeter} ${p.unit}. How long is one side?`,response:{kind:'integer',fields:[{key:'value',label:'Side',unit:p.unit}]},visual:{kind:'perimeter',shape:'triangle',totalLabel:`Around: ${p.perimeter} ${p.unit}`},hint:'Share the distance around equally among the three sides.',explanation:`${p.perimeter} ÷ 3`};
 return {prompt:'Five friends have five different last names. Use each last name exactly once.\n'+p.clues.map(c=>c.orientation===0?`${c.subject}’s last name is ${c.options[0]} or ${c.options[1]}.`:`${c.subject} is the last name of ${c.options[0]} or ${c.options[1]}.`).join('\n'),response:{kind:'matching',fields:p.first.map(f=>({key:f,label:f,options:[...p.last]}))},visual:null,hint:'Combine clues about the same friend or last name. Once a last name is used, remove it from the other choices.',explanation:'Only one complete matching fits every clue. Each last name is used once.'};
}
function same(a,b){return JSON.stringify(a)===JSON.stringify(b);}
function bounds(section,type,p){
 if(section!=='brain'){
  if(p.kind==='addsub'){const [a,b,z]=p.terms,lo=10**(p.width-1),hi=10**p.width-1;if(![2,3].includes(p.width)||!p.terms.every(n=>int(n,lo,hi))||![0,1,2].includes(p.blank)||!['+','−'].includes(p.op))return false;return p.op==='+'?a!==b&&a+b===z&&carry(a,b):b!==z&&a-b===z&&borrow(a,b);}
  if(p.kind==='mixed')return int(p.a,2,9)&&int(p.b,2,9)&&p.a!==p.b&&int(p.c,10,899)&&int(p.d,10,999)&&int(p.z,1,999)&&p.a*p.b+p.c<=999&&p.a*p.b+p.c-p.d===p.z&&carry(p.a*p.b,p.c)&&borrow(p.a*p.b+p.c,p.d)&&Math.max(p.c,p.d,p.a*p.b+p.c,p.z)>=100&&['a','c','d','z'].includes(p.role);
  if(p.kind==='multiply'){const[a,b,z]=p.terms;return int(a,p.fact?2:10,p.fact?9:99)&&int(b,2,9)&&int(z,1,999)&&a*b===z&&[0,1,2].includes(p.blank)&&(p.fact?(!p.distinct||a!==b):(a%10)*b>=10||Math.floor(a/10)*b+Math.floor((a%10)*b/10)>=10);}
  return false;
 }
 if(type===BRAINS[0])return p.clues.length===3&&new Set(p.clues.map(c=>c.factor)).size===3&&p.clues.every(c=>int(c.factor,3,9)&&int(c.bound,1,90)&&['>','<'].includes(c.op))&&p.clues.filter(c=>c.op==='<').length===1;
 if(type===BRAINS[1])return int(p.intended,2,9)&&int(p.mistaken,2,9)&&p.intended!==p.mistaken&&int(p.observed/p.mistaken,2,9);
 if(type===BRAINS[2])return int(p.total,180,500)&&int(p.difference,20,160)&&p.total>p.difference&&(p.total+p.difference)%2===0;
 if(type===BRAINS[3])return ['square','triangle'].includes(p.shape)&&int(p.side,3,20)&&['cm','in'].includes(p.unit);
 if(type===BRAINS[4])return int(p.perimeter/3,2,9)&&['cm','in'].includes(p.unit);
 return p.first.length===5&&p.last.length===5&&new Set(p.first).size===5&&new Set(p.last).size===5&&p.first.every(f=>FIRST.includes(f))&&p.last.every(f=>LAST.includes(f))&&p.clues.length===6&&new Set(p.clues.map(c=>c.orientation)).size===2&&p.clues.every(c=>[0,1].includes(c.orientation)&&(c.orientation===0?p.first:p.last).includes(c.subject)&&c.options.length===2&&new Set(c.options).size===2&&c.options.every(v=>(c.orientation===0?p.last:p.first).includes(v)));
}
function shapeMatches(q){const p=q.params,s=q.shapeId;
 if(q.section==='brain')return s===q.typeId;
 if(q.typeId!==s)return false;
 if(q.section==='multiplication')return p.kind==='multiply'&&p.fact===true&&p.distinct===false&&(s==='multiplication_result_blank'?p.blank===2:s==='multiplication_missing_factor'&&[0,1].includes(p.blank));
 if(s.startsWith('addition_'))return p.kind==='addsub'&&p.op==='+'&&(s.endsWith('result_blank')?p.blank===2:[0,1].includes(p.blank));
 if(s.startsWith('subtraction_'))return p.kind==='addsub'&&p.op==='−'&&p.blank===(s.endsWith('result_blank')?2:s.endsWith('missing_minuend')?0:1);
 if(s.startsWith('mixed_'))return p.kind==='mixed'&&p.role===(s.endsWith('result_blank')?'z':s.endsWith('missing_factor')?'a':s.endsWith('missing_addend')?'c':'d');
 if(s.startsWith('two_digit_'))return p.kind==='multiply'&&p.fact===false&&p.blank===(s.endsWith('missing_two_digit_factor')?0:s.endsWith('missing_one_digit_factor')?1:2);
 return s==='single_digit_multiplication_fact_family_product_blank'&&p.kind==='multiply'&&p.fact===true&&p.distinct===true&&p.blank===2;
}
function verifyLegacy(q){const errors=[];try{
 if(!q||!['equation','multiplication','story','brain'].includes(q.section))throw Error('Unknown section');
 if(q.section==='brain'&&!BRAINS.includes(q.typeId))throw Error('Unknown family');
 if(q.section!=='brain'&&!SHAPES.includes(q.shapeId)&&q.shapeId!=='multiplication_result_blank'&&q.shapeId!=='multiplication_missing_factor')throw Error('Unknown shape');
 if(!shapeMatches(q))throw Error('Shape does not match rule');
 if(!bounds(q.section,q.typeId,q.params))throw Error('Bounds or arithmetic failed');
 const want=expected(q.section,q.typeId,q.params);if(!same(q.answer,want))throw Error('Answer differs from independent solution');
 const view=presentation(q.section,q.typeId,q.params);if(!same(q.response,view.response)||q.prompt!==view.prompt||!same(q.visual,view.visual)||q.hint!==view.hint||q.explanation!==view.explanation)throw Error('Displayed givens differ from rule');
 if(q.section==='brain'&&q.typeId===BRAINS[0]&&!int(want.value,3,8))throw Error('Inequality solution outside canonical range');
 if(q.section==='brain'&&q.typeId===BRAINS[5]){for(let i=0;i<6;i++)if(survivors(q.params,i).length<2)throw Error('Redundant matching clue');if(!same(eliminate(q.params),want))throw Error('Elimination disagrees with enumeration');}
 }catch(e){errors.push(e.message);}return {ok:errors.length===0,errors};}
function generateLegacy(section,options={}){
 if(section==='mix')return generateQuestion(pick(['equation','multiplication','story','brain']),options);
 if(!['equation','multiplication','story','brain'].includes(section))throw Error('Unknown section');let typeId,shapeId,params;
 if(section==='brain'){typeId=options.typeId??pick(BRAINS);if(!BRAINS.includes(typeId))throw Error('Unknown family');params=brainParams(typeId);shapeId=typeId;}
 else if(section==='multiplication'){const a=rand(2,9),b=rand(2,9);const blank=rand(0,3)===0?pick([0,1]):2;shapeId=blank===2?'multiplication_result_blank':'multiplication_missing_factor';typeId=shapeId;params={kind:'multiply',fact:true,distinct:false,terms:[a,b,a*b],blank};}
 else {shapeId=options.shapeId??pick(SHAPES);if(!SHAPES.includes(shapeId))throw Error('Unknown shape');typeId=shapeId;params=equationParams(shapeId,options.width);if(section==='story')params.actor=pick(['Maya','Noah','Eli','Sofia','Hayden']);}
 const q={id:questionId(),section,typeId,shapeId,params,...presentation(section,typeId,params),answer:expected(section,typeId,params),signature:JSON.stringify([section,typeId,params])};
 const result=verifyQuestion(q);if(!result.ok)throw Error(result.errors.join('; '));return q;
}
function generateLegacyRound({section='mix',count=10,recentSignatures=[]}={}){
 if(!['mix','equation','multiplication','story','brain'].includes(section)||!int(count,1,20))throw Error('Round count must be 1–20');
 const recent=new Set(recentSignatures.slice(-20)),used=new Set(),out=[];let requests=[];
 if(section==='mix'){const brain=shuffle(BRAINS).slice(0,5).sort((a,b)=>BRAINS.indexOf(a)-BRAINS.indexOf(b));requests=[['equation',{shapeId:'addition_result_blank',width:2}],['equation',{shapeId:'subtraction_missing_subtrahend',width:2}],['multiplication',{}],['brain',{typeId:BRAINS[3]}],['story',{shapeId:pick(SHAPES.slice(0,5)),width:2}],['story',{shapeId:pick(SHAPES.slice(5))}],...brain.filter(t=>t!==BRAINS[3]).map(t=>['brain',{typeId:t}])];if(!brain.includes(BRAINS[3]))requests.splice(3,1);while(requests.length<count)requests.push(['brain',{typeId:pick(BRAINS)}]);requests=requests.slice(0,count);}
 else if(section==='brain'){let pool=[];for(let i=0;i<count;i++){if(!pool.length)pool=shuffle(BRAINS);requests.push(['brain',{typeId:pool.pop()}]);}}
 else requests=Array.from({length:count},()=>[section,{}]);
 for(const[s,opt]of requests){let made=false;for(let attempt=0;attempt<128;attempt++){const q=generateQuestion(s,opt);if(!used.has(q.signature)&&!recent.has(q.signature)){out.push(q);used.add(q.signature);made=true;break;}}if(!made)throw Error('Fresh question capacity exhausted. Please start another round.');}return out;
}
function gradeAnswer(q,response){if(!verifyQuestion(q).ok)return {valid:false,correct:false};if(!response||typeof response!=='object'||Array.isArray(response))return {valid:false,correct:false};const parsed={};for(const f of q.response.fields){const raw=response[f.key];if(['matching','choice'].includes(q.response.kind)){if(typeof raw!=='string'||!f.options.includes(raw))return {valid:false,correct:false};parsed[f.key]=raw;}else{const text=String(raw??'').trim();if(!/^\d{1,3}$/.test(text))return {valid:false,correct:false};parsed[f.key]=Number(text);}}return {valid:true,correct:q.response.fields.every(f=>parsed[f.key]===q.answer[f.key])};}
function formatAnswer(q,answer=q.answer){return q.response.fields.map(f=>`${q.response.fields.length>1?f.label+': ':''}${answer[f.key]??'—'}${f.unit?' '+f.unit:''}`).join(' · ');}
// Four-domain interactive extension. Narrative mechanisms also follow Standard-10
// parameter profiles (unknown_start/change, mixed_groups/inverse_groups), not its packet contract.
const DOMAINS=['arithmetic','measurement','geometry','narrative'];
const MEASURES=['ruler_length','ruler_compare','unit_compare','elapsed_minutes'];
const GEOMETRY=['equal_side_perimeter','inverse_perimeter','rectangle_side','perimeter_compare'];
const NARRATIVES=['changes_final','changes_start','changes_added','inverse_groups'];
const SCENES=['a class visit to a science museum','a school art display for families','a nature club exhibition','a classroom game at a family evening'];
const arithmeticShapes=[...SHAPES.slice(0,5),...SHAPES.slice(9)];
const timeText=m=>{const h=Math.floor(m/60);return `${h%12||12}:${String(m%60).padStart(2,'0')} ${h>=12?'pm':'am'}`;};
function domainParams(section,type){
 if(section==='measurement'){
  if(type==='ruler_length'||type==='ruler_compare'){const start=rand(1,8),end=start+rand(3,12);return {start,end,max:20,unit:'cm',other:type==='ruler_compare'?rand(1,end-start-1):null};}
  if(type==='unit_compare')return bounded(()=>({meters:rand(1,4),centimeters:rand(1,99),other:rand(100,399),unit:'cm'}),p=>p.meters*100+p.centimeters>p.other);
  const start=rand(7,11)*60+pick([0,5,10,15,20,25,30,35,40,45,50,55]),elapsed=pick([15,20,25,30,35,40,45,50,55,65,70,75,80,85,90]);return {start,end:start+elapsed,unit:'minutes'};
 }
 if(section==='geometry'){
  if(type==='equal_side_perimeter'||type==='inverse_perimeter')return {shape:pick(['square','triangle']),side:rand(type==='inverse_perimeter'?2:3,type==='inverse_perimeter'?9:20),unit:pick(['cm','in'])};
  if(type==='rectangle_side')return {width:rand(5,19),length:rand(20,39),unit:'cm'};
  return bounded(()=>({squareSide:rand(8,20),triangleSide:rand(3,20),unit:'cm'}),p=>4*p.squareSide>3*p.triangleSide);
 }
 const actor=pick(['Hayden','Maya','Sofia','Eli']),scene=pick(SCENES);
 if(type==='inverse_groups')return bounded(()=>({actor,scene,groups:rand(3,9),size:rand(3,9),added:rand(120,300),used:rand(60,190)}),p=>p.groups*p.size+p.added-p.used>0);
 return {actor,scene,start:rand(320,650),added:rand(120,290),used:rand(100,280)};
}
function domainAnswer(section,type,p){
 if(section==='measurement')return {value:type==='ruler_length'?p.end-p.start:type==='ruler_compare'?p.end-p.start-p.other:type==='unit_compare'?p.meters*100+p.centimeters-p.other:p.end-p.start};
 if(section==='geometry')return {value:type==='equal_side_perimeter'?(p.shape==='square'?4:3)*p.side:type==='inverse_perimeter'?p.side:type==='rectangle_side'?p.length:4*p.squareSide-3*p.triangleSide};
 return {value:type==='changes_start'?p.start:type==='changes_added'?p.added:type==='inverse_groups'?p.groups:p.start+p.added-p.used};
}
function domainView(section,type,p){
 const field=(label,unit)=>({kind:'integer',fields:[{key:'value',label,unit}]});let prompt,visual=null,hint,explanation,response;
 if(section==='measurement'){
  if(type==='ruler_length'||type==='ruler_compare'){visual={kind:'ruler',start:p.start,end:p.end,max:p.max,unit:p.unit};prompt=type==='ruler_length'?`A ribbon starts at the ${p.start} cm mark and ends at the ${p.end} cm mark on this ruler. How long is the ribbon?`:`A ribbon starts at the ${p.start} cm mark and ends at the ${p.end} cm mark. Another ribbon is ${p.other} cm long. How much longer is the ribbon on the ruler?`;hint='Find the distance between the two marks. The end mark alone is not the length.';explanation=type==='ruler_length'?`${p.end} − ${p.start} = ${p.end-p.start} cm`:`First ribbon: ${p.end} − ${p.start} = ${p.end-p.start} cm. Difference: ${p.end-p.start} − ${p.other} = ${p.end-p.start-p.other} cm.`;response=field(type==='ruler_length'?'Length':'Difference','cm');}
  else if(type==='unit_compare'){prompt=`Ribbon A is ${p.meters} m ${p.centimeters} cm long. Ribbon B is ${p.other} cm long. Use 1 m = 100 cm. How much longer is Ribbon A?`;hint='Put both lengths in centimeters before comparing them.';explanation=`Ribbon A: ${p.meters} × 100 + ${p.centimeters} = ${p.meters*100+p.centimeters} cm. Subtract ${p.other} cm.`;response=field('Difference','cm');}
  else {prompt=`A class activity starts at ${timeText(p.start)} and ends at ${timeText(p.end)} on the same day. Use 1 hour = 60 minutes. How many minutes does the activity last?`;hint='Count the minutes to the next hour, then the minutes after it.';explanation=`From ${timeText(p.start)} to ${timeText(p.end)}: ${p.end-p.start} minutes.`;response=field('Elapsed time','minutes');}
 }
 if(section==='geometry'){
  const n=p.shape==='square'?4:3;
  if(type==='equal_side_perimeter'){prompt=`All ${n===4?'four':'three'} sides are ${p.side} ${p.unit} long. What is the distance around the ${p.shape}?`;visual={kind:'perimeter',shape:p.shape,sideLabel:`${p.side} ${p.unit}`,notToScale:true};hint='Add each outside side once.';explanation=`${n} × ${p.side} = ${n*p.side} ${p.unit}`;response=field('Perimeter',p.unit);}
  else if(type==='inverse_perimeter'){prompt=`A ${p.shape} has ${n} equal sides. Its distance around is ${n*p.side} ${p.unit}. How long is one side?`;visual={kind:'perimeter',shape:p.shape,totalLabel:`Around: ${n*p.side} ${p.unit}`,notToScale:true};hint='Share the entire perimeter equally among all the sides.';explanation=`${n*p.side} ÷ ${n} = ${p.side} ${p.unit}`;response=field('Side',p.unit);}
  else if(type==='rectangle_side'){const around=2*(p.width+p.length);prompt=`A rectangle has two equal short sides and two equal long sides. Each short side is ${p.width} cm. The distance around is ${around} cm. How long is one long side?`;visual={kind:'rectangle',widthLabel:'□ cm',heightLabel:`${p.width} cm`,notToScale:true};hint='Remove both short sides from the perimeter. Share the rest between the two long sides.';explanation=`(${around} − 2 × ${p.width}) ÷ 2 = ${p.length} cm`;response=field('Long side','cm');}
  else {prompt=`A square has four sides of ${p.squareSide} cm each. A triangle has three sides of ${p.triangleSide} cm each. How much longer is the distance around the square than around the triangle?`;hint='Find both perimeters, then compare them.';explanation=`Square: 4 × ${p.squareSide} = ${4*p.squareSide} cm. Triangle: 3 × ${p.triangleSide} = ${3*p.triangleSide} cm. Difference: ${4*p.squareSide-3*p.triangleSide} cm.`;response=field('Difference','cm');}
 }
 if(section==='narrative'){
  let sentences;
  if(type==='inverse_groups'){const final=p.groups*p.size+p.added-p.used;sentences=[`${p.actor} is preparing card kits for ${p.scene}.`,`Each full kit holds ${p.size} cards, but the number of kits is not recorded.`,`A teacher adds ${p.added} loose cards to the same supply.`,`${p.actor} uses ${p.used} cards for the activity, leaving ${final} cards altogether.`,`Every original kit was full, and no other cards were added, used, or returned.`,`How many kits did ${p.actor} prepare?`];hint='Undo the cards used and the cards added. Then find how many full kits made the original supply.';explanation=`Original supply: ${final} + ${p.used} − ${p.added} = ${p.groups*p.size}. Kits: ${p.groups*p.size} ÷ ${p.size} = ${p.groups}.`;}
  else {const final=p.start+p.added-p.used;sentences=[`${p.actor} is preparing cards for ${p.scene}.`,type==='changes_start'?`The number of cards in the starting supply was not recorded.`:`The starting supply contains ${p.start} cards before the preparations begin.`,type==='changes_added'?`A teacher brings some more cards, and they are put into the same supply.`:`A teacher brings ${p.added} more cards, and they are put into the same supply.`,`${p.actor} then uses ${p.used} cards to prepare displays for the activity.`,type==='changes_final'?`Only those cards were added or used, and the used cards were not returned.`:`After the displays are prepared, ${final} cards remain, with no other cards added or removed.`,type==='changes_start'?`How many cards were in the starting supply?`:type==='changes_added'?`How many cards did the teacher bring?`:`How many cards remain in the supply?`];hint=type==='changes_final'?'Follow the two changes in order.':type==='changes_start'?'Start with the remaining cards and undo the changes in reverse order.':'Restore the cards used, then compare that amount with the starting supply.';explanation=type==='changes_final'?`${p.start} + ${p.added} − ${p.used} = ${final}`:type==='changes_start'?`${final} + ${p.used} − ${p.added} = ${p.start}`:`${final} + ${p.used} − ${p.start} = ${p.added}`;}
  prompt=sentences.map((s,i)=>s+(i===1||i===3?'\n':'')).join(' ').replace(/\n /g,'\n');response=field(type==='inverse_groups'?'Kits':'Cards',type==='inverse_groups'?'kits':'cards');
 }
 return {prompt,visual,response,hint,explanation};
}
function domainBounds(section,type,p){
 if(section==='measurement'){
  if(type==='ruler_length'||type==='ruler_compare')return int(p.start,1,8)&&int(p.end-p.start,3,12)&&p.max===20&&p.end<=p.max&&p.unit==='cm'&&(type==='ruler_length'?p.other===null:int(p.other,1,p.end-p.start-1));
  if(type==='unit_compare')return int(p.meters,1,4)&&int(p.centimeters,1,99)&&int(p.other,100,399)&&p.meters*100+p.centimeters>p.other&&p.unit==='cm';
  return int(p.start,420,715)&&p.start%5===0&&int(p.end-p.start,15,90)&&p.end<=805&&p.end%5===0&&p.unit==='minutes';
 }
 if(section==='geometry'){
  if(type==='equal_side_perimeter'||type==='inverse_perimeter')return ['square','triangle'].includes(p.shape)&&int(p.side,type==='inverse_perimeter'?2:3,type==='inverse_perimeter'?9:20)&&['cm','in'].includes(p.unit);
  if(type==='rectangle_side')return int(p.width,5,19)&&int(p.length,20,39)&&p.unit==='cm';
  return int(p.squareSide,8,20)&&int(p.triangleSide,3,20)&&4*p.squareSide>3*p.triangleSide&&p.unit==='cm';
 }
 if(!['Hayden','Maya','Sofia','Eli'].includes(p.actor)||!SCENES.includes(p.scene))return false;
 if(type==='inverse_groups')return int(p.groups,3,9)&&int(p.size,3,9)&&int(p.added,120,300)&&int(p.used,60,190)&&p.groups*p.size+p.added-p.used>0;
 return int(p.start,320,650)&&int(p.added,120,290)&&int(p.used,100,280);
}
function verifyDomains(q){
 if(!q||!DOMAINS.includes(q.section))return verifyLegacy(q);
 if(q.section==='arithmetic'){const copy={...q,section:'equation'};if(!arithmeticShapes.includes(q.shapeId))return {ok:false,errors:['Arithmetic shape not supported']};return verifyLegacy(copy);}
 const errors=[];try{
  const types=q.section==='measurement'?MEASURES:q.section==='geometry'?GEOMETRY:NARRATIVES;if(!types.includes(q.typeId)||q.shapeId!==q.typeId)throw Error('Unknown domain family');
  if(!domainBounds(q.section,q.typeId,q.params))throw Error('Invalid bounds or units');
  const computed=domainAnswer(q.section,q.typeId,q.params);if(!int(computed.value,1,999)||!same(computed,q.answer))throw Error('Incorrect or noninteger answer');
  const view=domainView(q.section,q.typeId,q.params);if(q.prompt!==view.prompt||!same(q.visual,view.visual)||!same(q.response,view.response)||q.hint!==view.hint||q.explanation!==view.explanation)throw Error('Displayed givens or units differ');
  if(q.section==='narrative'){const count=q.prompt.trim().split(/\s+/).length,sentences=q.prompt.match(/[.!?](?=\s|$)/g)||[];if(count<50||count>100||sentences.length<4||sentences.length>6)throw Error('Narrative length outside contract');}
 }catch(e){errors.push(e.message);}return {ok:errors.length===0,errors};
}
function generateDomain(section,options={}){
 if(section==='mix')section=pick(DOMAINS);
 if(!DOMAINS.includes(section))return generateLegacy(section,options);
 if(section==='arithmetic'){const shapeId=options.shapeId??pick(arithmeticShapes);if(!arithmeticShapes.includes(shapeId))throw Error('Invalid arithmetic shape');const q=generateLegacy('equation',{shapeId,width:options.width});q.section=section;q.signature=JSON.stringify([section,q.typeId,q.params]);return q;}
 const types=section==='measurement'?MEASURES:section==='geometry'?GEOMETRY:NARRATIVES,typeId=options.typeId??pick(types);if(!types.includes(typeId))throw Error('Unknown domain family');const params=domainParams(section,typeId),q={id:questionId(),section,typeId,shapeId:typeId,params,...domainView(section,typeId,params),answer:domainAnswer(section,typeId,params),signature:JSON.stringify([section,typeId,params])};const result=verifyQuestion(q);if(!result.ok)throw Error(result.errors.join('; '));return q;
}
function generateDomainRound({section='mix',count=10,recentSignatures=[]}={}){
 if(section!=='mix'&&!DOMAINS.includes(section))return generateLegacyRound({section,count,recentSignatures});
 if(!int(count,1,20))throw Error('Round count must be 1–20');let requests=[];
 const two=['arithmetic',{shapeId:pick(SHAPES.slice(0,5)),width:2}],three=['arithmetic',{shapeId:pick(SHAPES.slice(0,5)),width:3}];
 if(section==='mix'){
  requests=[two,three,['measurement',{}],['geometry',{}],['narrative',{}],['measurement',{}],['geometry',{}],['narrative',{}],['arithmetic',{shapeId:pick(SHAPES.slice(9))}],['measurement',{}]];
  while(requests.length<count)requests.push([DOMAINS[(requests.length-10)%4],{}]);requests=count<10?shuffle(requests).slice(0,count):shuffle(requests.slice(0,count));
 }else if(section==='arithmetic'){
  requests=[['arithmetic',{shapeId:'addition_result_blank',width:2}],['arithmetic',{shapeId:'subtraction_missing_subtrahend',width:3}],['arithmetic',{shapeId:'subtraction_result_blank',width:2}],['arithmetic',{shapeId:'addition_missing_addend',width:3}]];while(requests.length<count)requests.push(['arithmetic',{}]);requests=shuffle(requests.slice(0,count));
 }else {const types=section==='measurement'?MEASURES:section==='geometry'?GEOMETRY:NARRATIVES;let pool=[];for(let i=0;i<count;i++){if(!pool.length)pool=shuffle(types);requests.push([section,{typeId:pool.pop()}]);}}
 const used=new Set(),recent=new Set(recentSignatures.slice(-20)),out=[];for(const[s,opt]of requests){let made=false;for(let attempt=0;attempt<128;attempt++){const q=generateQuestion(s,opt);if(!used.has(q.signature)&&!recent.has(q.signature)){out.push(q);used.add(q.signature);made=true;break;}}if(!made)throw Error('Fresh question capacity exhausted');}return out;
}


// HM6-v1 extends original rule families; seeded replay is versioned, not eternal.
const VERSION='HM6-v2',TOPICS=[...DOMAINS,'brain'];
const EXTRA_MEASURES=['clock_read','coin_total','coin_missing'];
const EXTRA_GEOMETRY=['rectangle_area','inverse_area','equal_partition','line_relation','angle_type','symmetry'];
const EXTRA_BRAINS=['alternating_moves','two_marker_path'];
MEASURES.push(...EXTRA_MEASURES);GEOMETRY.push(...EXTRA_GEOMETRY);
function normalizeSeed(value){const s=String(value??'').trim();if(!s)return null;if(!/^\d{8}$/.test(s))throw Error('Use a valid YYYYMMDD date');const y=+s.slice(0,4),m=+s.slice(4,6),d=+s.slice(6),date=new Date(Date.UTC(y,m-1,d));if(y<1000||date.getUTCFullYear()!==y||date.getUTCMonth()!==m-1||date.getUTCDate()!==d)throw Error('Use a valid YYYYMMDD date');return s;}
function seededWords(key){let h=2166136261;for(let i=0;i<key.length;i++){h^=key.charCodeAt(i);h=Math.imul(h,16777619);}const hash=()=>{h+=0x9e3779b9;let z=h;z=Math.imul(z^(z>>>16),0x21f0aaad);z=Math.imul(z^(z>>>15),0x735a2d97);return (z^(z>>>15))>>>0;};let a=hash(),b=hash(),c=hash(),d=hash();return()=>{a>>>=0;b>>>=0;c>>>=0;d>>>=0;let t=(a+b)|0;a=b^(b>>>9);b=(c+(c<<3))|0;c=(c<<21)|(c>>>11);d=(d+1)|0;t=(t+d)|0;c=(c+t)|0;return t>>>0;};}
function withSeed(key,fn){const previous=rngContext;rngContext=seededWords(key);try{return fn();}finally{rngContext=previous;}}
function rotateSegments(segs,turn){return segs.map(s=>{const point=(x,y)=>{x-=100;y-=100;for(let i=0;i<turn;i++)[x,y]=[-y,x];return[x+100,y+100];};const[a,b]=point(s.x1,s.y1),[c,d]=point(s.x2,s.y2);return{x1:a,y1:b,x2:c,y2:d};});}
function extraParams(section,type){
 if(type==='clock_read')return {hour:rand(1,12),minute:rand(0,59)};
 if(type==='coin_total'||type==='coin_missing')return {nickels:rand(1,8),dimes:rand(1,8)};
 if(type==='rectangle_area')return rand(0,1)?{mode:'rectangle',width:rand(2,20),height:rand(2,20)}:{mode:'composite',w1:rand(3,9),h1:rand(3,9),w2:rand(3,9),h2:rand(3,9)};
 if(type==='inverse_area')return {width:rand(2,20),height:rand(2,20)};
 if(type==='equal_partition')return {rows:rand(1,2),cols:rand(2,4)};
 if(type==='line_relation')return {relation:pick(['parallel','perpendicular','neither']),rotation:rand(0,3)};
 if(type==='angle_type')return {degrees:pick([20,30,40,50,60,70,80,90,100,110,120,130,140,150,160])};
 if(type==='symmetry')return {shape:pick(['square','rectangle','equilateral','isosceles','scalene'])};
 if(type==='alternating_moves')return {start:rand(5,25),first:rand(2,7),second:rand(3,9),moves:rand(6,16)};
 return bounded(()=>({blue:rand(2,5),right:rand(2,4),back:rand(1,2),gold:rand(6,8),left:rand(2,4),forward:rand(1,2)}),p=>p.blue+p.right<=10&&p.gold-p.left>=1&&p.blue+p.right-p.back>=1&&p.gold-p.left+p.forward<=10);
}
function extraAnswer(type,p){
 if(type==='clock_read')return {Hour:p.hour,Minute:p.minute};
 if(type==='coin_total')return {value:p.nickels*5+p.dimes*10};
 if(type==='coin_missing')return {value:p.nickels};
 if(type==='rectangle_area')return {value:p.mode==='rectangle'?p.width*p.height:p.w1*p.h1+p.w2*p.h2};
 if(type==='inverse_area')return {value:p.height};
 if(type==='equal_partition')return {value:p.rows*p.cols};
 if(type==='line_relation')return {value:p.relation==='parallel'?'Parallel':p.relation==='perpendicular'?'Perpendicular':'Neither'};
 if(type==='angle_type')return {value:p.degrees<90?'Acute':p.degrees===90?'Right':'Obtuse'};
 if(type==='symmetry')return {value:{square:4,rectangle:2,equilateral:3,isosceles:1,scalene:0}[p.shape]};
 if(type==='alternating_moves')return {value:p.start+Math.floor(p.moves/2)*(p.first+p.second)+(p.moves%2?p.first:0)};
 const firstBlue=range(p.blue,p.blue+p.right),firstGold=range(p.gold-p.left,p.gold);return {Overlap:firstBlue.filter(n=>firstGold.includes(n)).length,Gap:Math.abs(p.blue+p.right-p.back-(p.gold-p.left+p.forward))};
}
function extraView(type,p){const scalar=(label,unit)=>({kind:'integer',fields:[{key:'value',label,...(unit?{unit}:{})}]});let prompt,visual=null,response,hint,explanation;
 if(type==='clock_read'){prompt='What time does this clock show? Enter the hour and minute. The clock alone does not tell am or pm.';visual={kind:'clock',hour:p.hour,minute:p.minute,hourAngle:(p.hour%12)*30+p.minute*.5,minuteAngle:p.minute*6};response={kind:'pair',fields:[{key:'Hour',label:'Hour'},{key:'Minute',label:'Minute'}]};hint='The short hand shows the hour. The long hand shows the minutes after the hour.';explanation=`The short hand is ${p.minute?'past':'on'} ${p.hour}. The minute hand shows ${p.minute} minutes. Time: ${p.hour}:${String(p.minute).padStart(2,'0')}.`;}
 else if(type==='coin_total'||type==='coin_missing'){const total=p.nickels*5+p.dimes*10;prompt=type==='coin_total'?'Each nickel is worth 5¢ and each dime is worth 10¢. What is the total value of these coins?':`The coins in a jar are worth ${total}¢ altogether. The jar contains ${p.dimes} dimes and the rest are nickels. Each dime is worth 10¢ and each nickel is worth 5¢. How many nickels are in the jar?`;visual={kind:'coins',groups:[{name:'Nickel',value:5,count:type==='coin_total'?p.nickels:null},{name:'Dime',value:10,count:p.dimes}],unit:'¢'};response=scalar(type==='coin_total'?'Value':'Nickels',type==='coin_total'?'¢':null);hint=type==='coin_total'?'Find the value of each kind of coin, then add.':'Remove the value of the dimes first. Share the remaining cents into groups of five.';explanation=type==='coin_total'?`${p.nickels} × 5 + ${p.dimes} × 10 = ${total}¢`:`(${total} − ${p.dimes} × 10) ÷ 5 = ${p.nickels}`;}
 else if(type==='rectangle_area'){response=scalar('Area','cm²');hint='Area counts square units covering the inside. Multiply length by width for each rectangle.';if(p.mode==='rectangle'){prompt=`A rectangle is ${p.width} cm wide and ${p.height} cm tall. What is its area in square centimeters?`;visual={kind:'rectangle',widthLabel:`${p.width} cm`,heightLabel:`${p.height} cm`,notToScale:true};explanation=`${p.width} × ${p.height} = ${p.width*p.height} cm²`;}else{prompt=`This shape is made from two rectangles joined without overlap. The left rectangle is ${p.w1} cm wide and ${p.h1} cm tall. The right rectangle is ${p.w2} cm wide and ${p.h2} cm tall. What is the area of the whole shape?`;visual={kind:'composite',rectangles:[{x:0,y:0,width:p.w1,height:p.h1,widthLabel:`${p.w1} cm`,heightLabel:`${p.h1} cm`},{x:p.w1,y:0,width:p.w2,height:p.h2,widthLabel:`${p.w2} cm`,heightLabel:`${p.h2} cm`}]};explanation=`${p.w1} × ${p.h1} + ${p.w2} × ${p.h2} = ${p.w1*p.h1+p.w2*p.h2} cm²`;}}
 else if(type==='inverse_area'){const area=p.width*p.height;prompt=`A rectangle has area ${area} cm² and width ${p.width} cm. How tall is the rectangle?`;visual={kind:'rectangle',widthLabel:`${p.width} cm`,heightLabel:'□ cm',notToScale:true};response=scalar('Height','cm');hint='Find how many rows of the known width cover the total area.';explanation=`${area} ÷ ${p.width} = ${p.height} cm`;}
 else if(type==='equal_partition'){prompt='This rectangle is divided into parts with equal areas. One part is shaded. The shaded part is 1/□ of the whole. What number belongs in the box?';visual={kind:'partition',rows:p.rows,cols:p.cols,shaded:1};response=scalar('Number');hint='Count all the equal parts, including the shaded part.';explanation=`There are ${p.rows*p.cols} equal parts. One part is 1/${p.rows*p.cols} of the whole.`;}
 else if(type==='line_relation'){let segs=p.relation==='parallel'?[{x1:30,y1:50,x2:170,y2:50},{x1:30,y1:130,x2:170,y2:130}]:p.relation==='perpendicular'?[{x1:100,y1:20,x2:100,y2:180},{x1:20,y1:100,x2:180,y2:100}]:[{x1:25,y1:50,x2:175,y2:150},{x1:25,y1:150,x2:175,y2:50}];visual={kind:'lines',relation:p.relation,rotation:p.rotation*90,segments:rotateSegments(segs,p.rotation)};prompt='How are the two lines related? Parallel lines never meet. Perpendicular lines meet at a right angle.';response={kind:'choice',fields:[{key:'value',label:'Lines',options:['Parallel','Perpendicular','Neither']}]};hint='Check whether the directions are the same or whether the lines form a square corner.';explanation=p.relation==='parallel'?'The lines have the same direction and do not meet.':p.relation==='perpendicular'?'The lines meet at a right angle.':'The lines meet, but their angle is not a right angle.';}
 else if(type==='angle_type'){prompt='What kind of angle is shown? A right angle is a square corner. An acute angle is smaller; an obtuse angle is larger.';visual={kind:'angle',degrees:p.degrees,showMeasure:false};response={kind:'choice',fields:[{key:'value',label:'Angle',options:['Acute','Right','Obtuse']}]};hint='Compare the opening between the rays with a square corner.';explanation=`This angle is ${p.degrees}°, so it is ${p.degrees<90?'acute':p.degrees===90?'right':'obtuse'}.`;}
 else if(type==='symmetry'){const points={square:[[40,40],[160,40],[160,160],[40,160]],rectangle:[[20,55],[180,55],[180,145],[20,145]],equilateral:[[100,30],[25,159.903810568],[175,159.903810568]],isosceles:[[100,20],[35,160],[165,160]],scalene:[[35,20],[160,80],[60,160]]};visual={kind:'symmetry',shape:p.shape,points:points[p.shape]};const name=p.shape==='rectangle'?'rectangle with unequal adjacent sides':p.shape==='square'?'square':`${p.shape} triangle`;prompt=`The shape shown is a ${name}. How many lines of symmetry does it have? A line of symmetry folds the whole shape into matching halves.`;response=scalar('Lines');hint='Look for folds that make the two halves match exactly.';explanation=`This ${name} has ${extraAnswer(type,p).value} lines of symmetry.`;}
 else if(type==='alternating_moves'){prompt=`A marker starts at ${p.start} on a number path. On its first move it goes right ${p.first} spaces; on its second move it goes right ${p.second} spaces. Those two moves repeat in the same order. Which number is the marker on after ${p.moves} moves?`;response=scalar('Number');hint='Group the moves in pairs. Check whether one first move is left over.';explanation=`There are ${Math.floor(p.moves/2)} full pairs${p.moves%2?' and one first move':''}. Start at ${p.start} and add ${Math.floor(p.moves/2)} × (${p.first} + ${p.second})${p.moves%2?' + '+p.first:''} = ${extraAnswer(type,p).value}.`;}
 else {prompt=`A path has cells numbered 1 through 10 from left to right. Blue starts on ${p.blue}, moves right ${p.right} cells, then moves left ${p.back} ${p.back===1?'cell':'cells'}. Gold starts on ${p.gold}, moves left ${p.left} cells, then moves right ${p.forward} ${p.forward===1?'cell':'cells'}. Count every cell visited on each first move, including its starting and ending cells. How many cells did both first moves visit, and how many one-cell moves separate the final positions?`;response={kind:'pair',fields:[{key:'Overlap',label:'Shared cells'},{key:'Gap',label:'Final gap'}]};hint='List each first path, then find the shared cells. Track the second moves separately.';const a=extraAnswer(type,p);explanation=`Blue first visits ${range(p.blue,p.blue+p.right).join(', ')}. Gold first visits ${range(p.gold-p.left,p.gold).join(', ')}. Shared cells: ${a.Overlap}. Final positions: ${p.blue+p.right-p.back} and ${p.gold-p.left+p.forward}; gap ${a.Gap}.`;}
 return {prompt,visual,response,hint,explanation};
}
function extraBounds(type,p){
 if(type==='clock_read')return int(p.hour,1,12)&&int(p.minute,0,59);
 if(type==='coin_total'||type==='coin_missing')return int(p.nickels,1,8)&&int(p.dimes,1,8);
 if(type==='rectangle_area')return p.mode==='rectangle'?int(p.width,2,20)&&int(p.height,2,20):p.mode==='composite'&&['w1','h1','w2','h2'].every(k=>int(p[k],3,9));
 if(type==='inverse_area')return int(p.width,2,20)&&int(p.height,2,20);
 if(type==='equal_partition')return int(p.rows,1,2)&&int(p.cols,2,4);
 if(type==='line_relation')return ['parallel','perpendicular','neither'].includes(p.relation)&&int(p.rotation,0,3);
 if(type==='angle_type')return int(p.degrees,15,165);
 if(type==='symmetry')return ['square','rectangle','equilateral','isosceles','scalene'].includes(p.shape);
 if(type==='alternating_moves')return int(p.start,5,25)&&int(p.first,2,7)&&int(p.second,3,9)&&int(p.moves,6,16);
 return int(p.blue,2,5)&&int(p.right,2,4)&&int(p.back,1,2)&&int(p.gold,6,8)&&int(p.left,2,4)&&int(p.forward,1,2)&&p.blue+p.right<=10&&p.gold-p.left>=1&&p.blue+p.right-p.back>=1&&p.gold-p.left+p.forward<=10;
}
function verifyQuestion(q){
 const extras=q?.section==='measurement'?EXTRA_MEASURES:q?.section==='geometry'?EXTRA_GEOMETRY:q?.section==='brain'?EXTRA_BRAINS:[];
 if(!extras.includes(q?.typeId))return q?.section==='brain'?verifyLegacy(q):verifyDomains(q);
 const errors=[];try{if(q.shapeId!==q.typeId||!extraBounds(q.typeId,q.params))throw Error('Invalid extended family bounds');const want=extraAnswer(q.typeId,q.params),view=extraView(q.typeId,q.params);if(!same(want,q.answer))throw Error('Answer differs from solution');for(const f of view.response.fields){const v=want[f.key];if(view.response.kind==='choice'?!f.options.includes(v):!int(v,0,999))throw Error('Response outside bounds');}if(q.prompt!==view.prompt||q.hint!==view.hint||q.explanation!==view.explanation||!same(q.response,view.response)||!same(q.visual,view.visual))throw Error('Displayed facts or solution differ');}catch(e){errors.push(e.message);}return {ok:!errors.length,errors};
}
function makeQuestion(section,options={}){const extras=section==='measurement'?EXTRA_MEASURES:section==='geometry'?EXTRA_GEOMETRY:section==='brain'?EXTRA_BRAINS:[],all=section==='measurement'?MEASURES:section==='geometry'?GEOMETRY:section==='brain'?[...BRAINS,...EXTRA_BRAINS]:[];
 const typeId=options.typeId??(all.length?pick(all):null);if(!extras.includes(typeId))return section==='brain'?generateLegacy('brain',{...options,typeId}):generateDomain(section,{...options,...(typeId?{typeId}:{})});
 const params=extraParams(section,typeId),q={id:questionId(),section,typeId,shapeId:typeId,params,...extraView(typeId,params),answer:extraAnswer(typeId,params),signature:JSON.stringify([section,typeId,params])};const r=verifyQuestion(q);if(!r.ok)throw Error(r.errors.join('; '));return q;
}
function schedule(section){
 if(section==='mix')return shuffle([['arithmetic',{shapeId:pick(SHAPES.slice(0,5)),width:2}],['arithmetic',{shapeId:pick(SHAPES.slice(0,5)),width:3}],...['measurement','geometry','narrative','brain'].flatMap(s=>[[s,{}],[s,{}]])]);
 if(section==='arithmetic'){const a=[['arithmetic',{shapeId:'addition_result_blank',width:2}],['arithmetic',{shapeId:'subtraction_result_blank',width:2}],['arithmetic',{shapeId:'addition_missing_addend',width:3}],['arithmetic',{shapeId:'subtraction_missing_subtrahend',width:3}]];while(a.length<10)a.push(['arithmetic',{}]);return shuffle(a);}
 const types=section==='measurement'?MEASURES:section==='geometry'?GEOMETRY:section==='narrative'?NARRATIVES:[...BRAINS,...EXTRA_BRAINS];const a=shuffle(types).map(t=>[section,{typeId:t}]);while(a.length<10)a.push([section,{typeId:pick(types)}]);return shuffle(a);
}
// Identity follows child-visible givens, not factory provenance or hidden answers.
function questionFingerprint(q){
 const text=Array.isArray(q.prompt)?q.prompt.join(' '):String(q.prompt),v=q.visual;let diagram=null;
 if(v){
  if(v.kind==='symmetry')diagram={kind:v.kind,shape:v.shape};
  else if(v.kind==='lines'){const segments=v.segments.map(s=>[[s.x1,s.y1],[s.x2,s.y2]].sort((a,b)=>a[0]-b[0]||a[1]-b[1])).sort((a,b)=>{const x=JSON.stringify(a),y=JSON.stringify(b);return x<y?-1:x>y?1:0;});diagram={kind:v.kind,segments};}
  else if(v.kind==='clock')diagram={kind:v.kind,hourAngle:(v.hour%12)*30+v.minute*.5,minuteAngle:v.minute*6};
  else if(v.kind==='coins')diagram={kind:v.kind,groups:v.groups.map(g=>({name:g.name,value:g.value,count:g.count})),unit:v.unit};
  else if(v.kind==='angle')diagram={kind:v.kind,degrees:v.degrees};
  else if(v.kind==='partition')diagram={kind:v.kind,rows:v.rows,cols:v.cols,shaded:v.shaded};
  else if(v.kind==='composite')diagram={kind:v.kind,rectangles:v.rectangles.map(r=>({x:r.x,y:r.y,width:r.width,height:r.height,widthLabel:r.widthLabel,heightLabel:r.heightLabel}))};
  else if(v.kind==='ruler')diagram={kind:v.kind,start:v.start,end:v.end,max:v.max,unit:v.unit};
  else if(v.kind==='rectangle')diagram={kind:v.kind,widthLabel:v.widthLabel,heightLabel:v.heightLabel,notToScale:Boolean(v.notToScale)};
  else if(v.kind==='perimeter')diagram={kind:v.kind,shape:v.shape,sideLabel:v.sideLabel,totalLabel:v.totalLabel};
 }
 const fields=q.response.fields.map(f=>({label:f.label,unit:f.unit,options:f.options?.map(o=>typeof o==='object'?o.label:String(o))}));
 return JSON.stringify([text.replace(/\s+/g,' ').trim(),diagram,q.response.kind,fields]);
}
function alternateRequests(section,opt){
 if(section==='arithmetic'){const types=opt.width?[...SHAPES.slice(0,5)]:arithmeticShapes;return shuffle(types.filter(t=>t!==opt.shapeId)).map(shapeId=>({...opt,shapeId}));}
 const types=section==='measurement'?MEASURES:section==='geometry'?GEOMETRY:section==='narrative'?NARRATIVES:[...BRAINS,...EXTRA_BRAINS];return shuffle(types.filter(t=>t!==opt.typeId)).map(typeId=>({...opt,typeId}));
}
function generateRound({section='mix',count=10,recentSignatures=[],baselineFingerprints=[],recentFingerprints=[],seed=null,offset=0}={}){
 if(section!=='mix'&&!TOPICS.includes(section))return generateLegacyRound({section,count,recentSignatures});
 if(!int(count,1,20)||!Number.isSafeInteger(offset)||offset<0||!Number.isSafeInteger(offset+count))throw Error('Invalid round count or offset');
 const date=normalizeSeed(seed),out=[],baseline=new Set(date?[]:baselineFingerprints.slice(-20)),rolling=date?[]:recentFingerprints.slice(-20),rawRecent=new Set(date?[]:recentSignatures.slice(-20));let block=-1,plan=null;
 // Reconstruct Date's accepted prefix so offsets/chunks cannot alter exclusions.
 for(let i=date?0:offset;i<offset+count;i++){
  const nextBlock=Math.floor(i/10);if(nextBlock!==block){block=nextBlock;plan=date?withSeed(`${VERSION}|${date}|${section}|block|${block}`,()=>schedule(section)):schedule(section);}
  const[s,opt]=plan[i%10],excluded=new Set([...baseline,...rolling]);let accepted=null;
  const attempt=(options,family,budget)=>{for(let n=0;n<budget;n++){const q=date?withSeed(`${VERSION}|${date}|${section}|question|${i}|${family}|${n}`,()=>makeQuestion(s,options)):makeQuestion(s,options);const key=questionFingerprint(q);if(!excluded.has(key)&&!rawRecent.has(q.signature)){accepted={q,key};return true;}}return false;};
  if(!attempt(opt,'primary',128)){
   const alternatives=date?withSeed(`${VERSION}|${date}|${section}|alternates|${i}`,()=>alternateRequests(s,opt)):alternateRequests(s,opt);
   for(let family=0;family<alternatives.length&&!accepted;family++)attempt(alternatives[family],'alternate-'+family,64);
  }
  if(!accepted)throw Error('Fresh visible question capacity exhausted');
  const {q,key}=accepted;if(date)q.id=`${VERSION}-${date}-${section}-${i}`;
  rolling.push(key);if(rolling.length>20)rolling.shift();if(i>=offset)out.push(q);
 }
 return out;
}
function generateQuestion(section,options={}){if(options.seed!==undefined&&normalizeSeed(options.seed))return generateRound({section,seed:options.seed,offset:options.index??0,count:1})[0];return section==='mix'?makeQuestion(pick(TOPICS),options):makeQuestion(section,options);}

const api={VERSION,normalizeSeed,questionFingerprint,DOMAINS:TOPICS,EXTRA_BRAINS,MEASURES,GEOMETRY,NARRATIVES,BRAINS,SHAPES,generateQuestion,generateRound,verifyQuestion,gradeAnswer,formatAnswer};root.HaydenMath=api;if(typeof module!=='undefined')module.exports=api;
})(typeof window!=='undefined'?window:globalThis);
