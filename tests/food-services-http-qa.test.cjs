const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const {createHash}=require('node:crypto');
const {configureIsolatedConnection,assertIsolatedIdentity}=require('./helpers/isolated-postgres.cjs');
const {harness}=require('./helpers/isolated-auth.cjs');

test('Food Services HTTP: CHEF publishes and corporate employee without C-PANEL confirms own food order',{
 skip:process.env.RUN_FOOD_HTTP_QA_TESTS!=='1',
},async t=>{
 const url=configureIsolatedConnection();const {PrismaClient}=require('@prisma/client');const db=new PrismaClient({datasourceUrl:url});
 const manifest=JSON.parse(fs.readFileSync('data/qa-pilot-local-manifest.json','utf8'));
 const config=JSON.parse(fs.readFileSync('data/qa-food-reference.json','utf8'));
 const target=new Date(config.targetWeek);assert.equal(config.database,'yellowflex_restore_test');assert.equal(target.getUTCFullYear(),2099);
 const sessions=new Map(),hashes=[];
 let failures=0;
 const check=async(name,fn)=>{await t.test(name,async()=>{try{await fn();}catch(error){failures++;throw error;}});assert.equal(failures,0,'Se detiene el flujo HTTP antes de continuar con escrituras tras un fallo');};
 const profile=key=>manifest.profiles.find(p=>p.key===key);
 const request=async(key,route,method='GET',body)=>{
  const response=await fetch('http://127.0.0.1:3100'+route,{method,redirect:'manual',headers:{...(key?{Cookie:sessions.get(key)}:{}),...(body?{'Content-Type':'application/json'}:{})},...(body?{body:JSON.stringify(body)}:{})});
  const text=await response.text();let data;try{data=JSON.parse(text);}catch{data=null;}
  return {status:response.status,data,text};
 };
 const restoredHash=async()=>createHash('sha256').update(JSON.stringify(await db.menuWeek.findMany({where:{weekStart:{not:target}},orderBy:{id:'asc'},include:{days:{orderBy:{id:'asc'},include:{items:{orderBy:{id:'asc'}}}}}}))).digest('hex');
 const counts=async()=>[await db.menuWeek.count(),await db.menuDay.count(),await db.menuItem.count()];
 let restoredBefore,employee,otherEmployee,shiftId,itemIds;
 try{
  await assertIsolatedIdentity(db);
  assert.equal(await db.menuWeek.findUnique({where:{weekStart:target}}),null,'No sobrescribir una semana QA existente');
  restoredBefore=await restoredHash();
  for(const key of ['chef-externo','administrativo','produccion','warehouse']){
   const p=profile(key);const user=await db.user.findUniqueOrThrow({where:{id:p.userId},include:{employee:true}});
   assert.ok(user.active&&!user.passwordMustChange&&user.name.startsWith('QA Pilot '));
   const h=harness();let cookie;
   h.mocks['@/lib/db']={db};h.mocks['next/headers']={cookies:async()=>({set:(name,value)=>{cookie=`${name}=${value}`;hashes.push(createHash('sha256').update(value).digest('hex'));},get:()=>undefined,delete:()=>{}})};
   await h.load('lib/auth/corporate-auth.ts').createCorporateSession(user.id);sessions.set(key,cookie);
   if(key==='administrativo')employee=user.employee;
   if(key==='produccion')otherEmployee=user.employee;
   if(key==='warehouse')shiftId=user.employee.workShiftId;
  }
  assert.ok(employee&&otherEmployee&&shiftId);
  await check('GET editor returns a virtual week under the server-only QA clock and writes nothing',async()=>{
   const before=await counts();const r=await request('chef-externo','/api/food-services/chef/menu?referenceDate=2001-01-01');
   assert.equal(r.status,200);assert.equal(r.data.data.weekStart,config.targetWeek);assert.equal(r.data.data.days.length,7);assert.equal(r.data.data.id,'');
   assert.deepEqual(await counts(),before);
  });
  const days=Array.from({length:7},(_,i)=>{const date=new Date(target);date.setUTCDate(date.getUTCDate()+i);return {serviceDate:date.toISOString(),items:i===0?[{serviceType:'BREAKFAST',name:`${config.marker} desayuno`,description:'Solo QA ficticio'},{serviceType:'LUNCH',name:`${config.marker} comida`,description:'Solo QA ficticio'}]:[]};});
  await check('unauthorized collaborators cannot edit; client cannot choose another week',async()=>{
   assert.equal((await request('administrativo','/api/food-services/chef/menu')).status,403);
   assert.equal((await request('chef-externo','/api/food-services/chef/menu','PUT',{weekStart:'2099-07-06T00:00:00.000Z',days})).status,409);
   assert.equal(await db.menuWeek.findUnique({where:{weekStart:target}}),null);
  });
  await check('CHEF saves and publishes only the fictitious QA week',async()=>{
   const saved=await request('chef-externo','/api/food-services/chef/menu','PUT',{weekStart:config.targetWeek,days});assert.equal(saved.status,200);
   assert.equal(saved.data.data.status,'DRAFT');
   const published=await request('chef-externo','/api/food-services/chef/menu','POST');assert.equal(published.status,200);assert.equal(published.data.data.menuWeek.status,'PUBLISHED');
   assert.equal(published.data.data.menuWeek.weekStart,config.targetWeek);
   itemIds=published.data.data.menuWeek.days.flatMap(d=>d.items.map(i=>i.id));assert.equal(itemIds.length,2);
   const before=await counts();assert.equal((await request('chef-externo','/api/food-services/chef/menu')).status,200);assert.deepEqual(await counts(),before);
  });
  await check('corporate employee with zero Food C-PANEL grants sees the published menu and own requests without PIN',async()=>{
   assert.equal(await db.corporateModulePermission.count({where:{userId:profile('administrativo').userId,moduleKey:'food-services',granted:true}}),0);
   const menu=await request('administrativo','/api/food-services/menu');assert.equal(menu.status,200);
   const week=menu.data.data.find(w=>w.weekStart===config.targetWeek);assert.ok(week);assert.ok(week.days[0].items[0].name.startsWith(config.marker));
   const state=await request('administrativo','/api/food-services/reservations');assert.equal(state.status,200);assert.equal(state.data.data.canRequest,true);
   assert.equal(state.data.data.employee.employeeNumber,employee.employeeNumber);assert.equal(state.data.data.pinMustChange,false);
   assert.equal((await request('administrativo','/modules/food-services/employee')).status,200);
   assert.equal((await request(null,'/api/food-services/menu')).status,401);
   assert.equal((await request('chef-externo','/api/food-services/reservations')).status,403);
  });
  await check('employee without an RH shift still reads, receives a clear warning, and cannot request',async()=>{
   const p=profile('warehouse');await db.employee.update({where:{id:p.employeeId},data:{workShiftId:null}});
   try{
    assert.equal((await request('warehouse','/api/food-services/menu')).status,200);
    const r=await request('warehouse','/api/food-services/reservations');assert.equal(r.status,200);assert.equal(r.data.data.canRequest,false);assert.match(r.data.data.shiftMessage,/RH/);
    const save=await request('warehouse','/api/food-services/reservations','POST',{menuItemIds:[itemIds[0]]});assert.equal(save.status,409);
    assert.equal(await db.reservation.count({where:{employeeId:p.employeeId,menuItemId:{in:itemIds}}}),0);
   }finally{await db.employee.update({where:{id:p.employeeId},data:{workShiftId:shiftId}});}
  });
  await check('saved selection is provisional and invisible to CHEF until confirmation',async()=>{
   const saved=await request('administrativo','/api/food-services/reservations','POST',{menuItemIds:[itemIds[0]]});assert.equal(saved.status,200);
   assert.equal(await db.reservation.count({where:{employeeId:employee.id,menuItemId:{in:itemIds},foodOrderId:null}}),1);
   const chef=await request('chef-externo','/api/food-services/chef/menu?view=production');assert.equal(chef.status,200);assert.equal(chef.data.data.totals.confirmedServices,0);
  });
  await check('employee cannot impersonate another employee or set reference dates; GET remains scoped to own identity',async()=>{
   for(const route of ['/api/food-services/reservations','/api/food-services/reservations/confirm']){
    assert.equal((await request('administrativo',route,'POST',{menuItemIds:[itemIds[0]],employeeId:otherEmployee.id})).status,422);
    assert.equal((await request('administrativo',route,'POST',{menuItemIds:[itemIds[0]],referenceDate:'2099-01-01'})).status,422);
   }
   const read=await request('administrativo',`/api/food-services/reservations?employeeId=${otherEmployee.id}`);
   assert.equal(read.status,200);assert.equal(read.data.data.employee.employeeNumber,employee.employeeNumber);
   assert.equal(await db.reservation.count({where:{employeeId:otherEmployee.id,menuItemId:{in:itemIds}}}),0);
  });
  await check('confirmation creates one own order; CHEF sees it; duplicates and further changes are rejected',async()=>{
   const confirmed=await request('administrativo','/api/food-services/reservations/confirm','POST',{menuItemIds:[itemIds[0]]});assert.equal(confirmed.status,201);assert.equal(confirmed.data.data.totalAmount,'25.00');
   const own=await request('administrativo','/api/food-services/reservations');assert.equal(own.data.data.isConfirmed,true);assert.equal(own.data.data.order.itemCount,1);
   const other=await request('produccion','/api/food-services/reservations');assert.equal(other.data.data.order,null);assert.deepEqual(other.data.data.menuItemIds,[]);
   const chef=await request('chef-externo','/api/food-services/chef/menu?view=production');assert.equal(chef.status,200);assert.equal(chef.data.data.week.weekStart,config.targetWeek);assert.equal(chef.data.data.totals.confirmedServices,1);
   assert.equal((await request('administrativo','/api/food-services/reservations/confirm','POST',{menuItemIds:[itemIds[0]]})).status,409);
   assert.equal((await request('administrativo','/api/food-services/reservations','POST',{menuItemIds:[]})).status,409);
   assert.equal(await db.foodOrder.count({where:{employeeId:employee.id,menuWeek:{weekStart:target}}}),1);
  });
  await check('specialized administration and exports remain protected; logout revokes corporate self-service',async()=>{
   assert.equal((await request('administrativo','/api/food-services/hr/billing')).status,403);
   assert.equal((await request('chef-externo','/api/food-services/chef/billing/export?weekId=not-authorized')).status,403);
   assert.equal((await request('administrativo','/api/auth/logout','POST')).status,200);
   assert.equal((await request('administrativo','/api/food-services/reservations')).status,401);
  });
  await check('restored menus are unchanged and no consumption or duplicate catalogs were introduced',async()=>{
   assert.equal(await restoredHash(),restoredBefore);
   assert.equal(await db.consumption.count({where:{menuItemId:{in:itemIds}}}),0);
   assert.equal(await db.workShift.count({where:{code:{startsWith:'QA-'}}}),0);
   await assertIsolatedIdentity(db);
  });
  assert.equal(failures,0,'No se registra éxito si falló un caso HTTP');
  fs.writeFileSync('data/qa-food-e2e-result.json',JSON.stringify({database:'yellowflex_restore_test',referenceDate:config.referenceDate,targetWeek:config.targetWeek,marker:config.marker,published:true,employeeId:employee.id,confirmedServices:1,restoredMenusUnchanged:await restoredHash()===restoredBefore,consumptionImplemented:false},null,2));
 }finally{
  if(hashes.length) await db.corporateSession.deleteMany({where:{tokenHash:{in:hashes}}});await db.$disconnect();
 }
});
