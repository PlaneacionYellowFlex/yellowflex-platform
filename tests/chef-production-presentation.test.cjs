const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const ts=require('typescript');
const {harness}=require('./helpers/isolated-auth.cjs');
function fixture(){
 const employee=(id,name,number,shift=true)=>({id,fullName:name,employeeNumber:number,department:{id:'department-id',code:'QA',name:'Equipo QA'},workShift:shift?{id:'shift-id',code:'T1',name:'Diurno',startTime:'07:00',endTime:'19:00'}:null});
 const admin=employee('employee-a','QA Administrativo','QA-ADM');const prod=employee('employee-b','QA Producción','QA-PROD');
 const reservation=(id,person,order)=>({id,employee:person,foodOrder:{id:order,status:'CONFIRMED'},consumption:null});
 return {id:'week-technical-id',weekStart:new Date('2099-06-08'),publishedAt:new Date('2026-11-06'),days:[{id:'day-technical-id',serviceDate:new Date('2099-06-08'),items:[
  {id:'breakfast-technical-id',serviceType:'BREAKFAST',name:'Desayuno QA',price:'25.00',reservations:[reservation('reservation-a',admin,'order-technical-a'),reservation('reservation-b',prod,'order-technical-b')]},
  {id:'lunch-technical-id',serviceType:'LUNCH',name:'Comida QA',price:'25.00',reservations:[reservation('reservation-c',prod,'order-technical-b')]},
 ]}]};
}
async function summary(week,extras=[]){
 const h=harness({realFoodServices:true});let query;
 h.db.menuWeek={findFirst:async q=>{query=q;return week;}};
 h.db.foodOrder={findMany:async()=>{
  const orders=new Map();
  for(const day of week?.days??[])for(const item of day.items)for(const r of item.reservations){
   let order=orders.get(r.foodOrder.id);
   if(!order){order={id:r.foodOrder.id,employee:r.employee,menuWeek:{id:week.id,weekStart:week.weekStart},itemCount:0,unitPrice:'25.00',totalAmount:'0.00',confirmedAt:new Date(),reservations:[]};orders.set(order.id,order);}
   order.itemCount++;order.totalAmount=(order.itemCount*25).toFixed(2);
   order.reservations.push({id:r.id,consumption:r.consumption,menuItem:{...item,menuDay:{id:day.id,serviceDate:day.serviceDate}}});
  }
  return [...orders.values()];
 }};
 h.db.foodExtraordinaryService={findMany:async()=>extras};
 const result=await h.load('lib/food-services/chef-production-service.ts').getChefProductionSummary();
 return {result,query,calls:h.calls};
}
function render(data){
 const source=fs.readFileSync('components/food-services/chef-production-dashboard.tsx','utf8');
 const code=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2020,jsx:ts.JsxEmit.ReactJSX,esModuleInterop:true}}).outputText;
 const mod={exports:{}};let states=0;
 const mocks={react:{useState:initial=>[states++===0?data:initial,()=>{}],useCallback:fn=>fn,useEffect:()=>{}},'react/jsx-runtime':require('react/jsx-runtime'),'lucide-react':new Proxy({}, {get:()=>()=>null})};
 new Function('require','module','exports',code)(id=>{assert.ok(id in mocks);return mocks[id];},mod,mod.exports);
 return require('react-dom/server').renderToStaticMarkup(mod.exports.default({canExport:false}));
}
test('3 services represent 2 unique collaborators and 2 confirmed orders, with unchanged preparation totals',async()=>{
 const {result,query,calls}=await summary(fixture());
 assert.deepEqual(result.totals,{uniqueCollaborators:2,confirmedOrders:2,confirmedServices:3,consumedServices:0,pendingServices:3,extraordinaryServices:0,ordinaryServices:3,ordinaryAmount:"75.00"});
 assert.deepEqual(result.days[0].services.map(s=>s.confirmed),[2,1]);assert.equal(result.days[0].confirmedServices,3);
 assert.equal(query.select.days.select.items.where,undefined);
 assert.deepEqual(result.days[0].services[0].collaborators.map(c=>[c.name,c.employeeNumber,c.quantity,c.orderStatus]),[['QA Administrativo','QA-ADM',1,'CONFIRMED'],['QA Producción','QA-PROD',1,'CONFIRMED']]);
 assert.ok(!JSON.stringify(result.days[0].services[0].collaborators).includes('order-'));
 assert.deepEqual(calls.writes,[]);
});
test('extraordinary quantities remain in preparation totals without inventing employees or orders',async()=>{
 const {result}=await summary(fixture(),[{menuItemId:'breakfast-technical-id',quantity:4}]);
 assert.equal(result.totals.confirmedServices,7);assert.equal(result.totals.extraordinaryServices,4);
 assert.equal(result.totals.uniqueCollaborators,2);assert.equal(result.totals.confirmedOrders,2);
 assert.equal(result.days[0].services[0].confirmed,6);assert.equal(result.days[0].services[0].collaborators.length,2);
});
test('missing RH shift is represented truthfully without a fake catalog entry',async()=>{
 const week=fixture();week.days[0].items[0].reservations[0].employee.workShift=null;
 const {result}=await summary(week);assert.equal(result.days[0].services[0].collaborators[0].shift,'Sin turno asignado');
});
test('empty week has zero executive counts',async()=>{
 const {result}=await summary(null);assert.equal(result.week,null);assert.equal(result.totals.uniqueCollaborators,0);assert.equal(result.totals.confirmedOrders,0);
});
test('CHEF presentation shows readable people, states and totals without technical identifiers',async()=>{
 const {result}=await summary(fixture());
 const html=render({...result,isQaReference:true});
 for(const label of ['Servicios confirmados','Colaboradores únicos','Pedidos confirmados','Desglose por colaborador','QA Administrativo','QA Producción','QA-PROD','Pedido confirmado','Cantidad: 1','Semana ficticia QA'])assert.ok(html.includes(label),label);
 for(const id of ['week-technical-id','day-technical-id','breakfast-technical-id','order-technical-a','reservation-a'])assert.ok(!html.includes(id),id);
 assert.ok(html.includes('sm:grid-cols-3'));assert.ok(html.includes('sm:grid-cols-[minmax(0,1fr)_auto]'));
 const real=render({...result,isQaReference:false,week:{...result.week,weekStart:'2026-11-09'}});
 assert.ok(!real.includes('Semana ficticia QA'));assert.ok(real.includes('2026'));
});
