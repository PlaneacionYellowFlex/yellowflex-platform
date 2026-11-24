const test=require('node:test');
const assert=require('node:assert/strict');
const {harness}=require('./helpers/isolated-auth.cjs');

test('active RH collaborator self-service does not require C-PANEL and derives identity from session',async()=>{
 const h=harness({roles:['EMPLEADO'],granted:false});let query;
 h.db.employee.findUnique=async args=>{query=args;return {id:'rh-employee',status:'ACTIVE',department:{},workShift:null};};
 const self=h.load('lib/food-services/self-service.ts');
 const ctx=await self.requireFoodEmployee();assert.equal(ctx.employee.id,'rh-employee');assert.deepEqual(query.where,{corporateUserId:'actor'});
 assert.equal(await self.canEnterFoodServices({id:'actor',roles:['EMPLEADO']}),true);
 assert.equal(await h.load('lib/cpanel/module-access.ts').hasModulePageAccess({id:'actor',roles:['EMPLEADO']},'food-services','view','employee'),true);
 assert.equal(h.calls.permissionReads,0);
});
test('inactive RH employee and temporary or anonymous corporate session cannot request food',async()=>{
 const h=harness({roles:['EMPLEADO']});h.db.employee.findUnique=async()=>({id:'employee',status:'INACTIVE'});
 const self=h.load('lib/food-services/self-service.ts');await assert.rejects(self.requireFoodEmployee());
 h.user.passwordMustChange=true;await assert.rejects(self.requireFoodEmployee());h.store.get=()=>undefined;await assert.rejects(self.requireFoodEmployee());
 assert.deepEqual(h.calls.writes,[]);
});
test('external CHEF needs specialized view and cannot become an employee',async()=>{
 const h=harness({roles:['CHEF'],granted:true});h.db.employee.findUnique=async()=>null;
 const self=h.load('lib/food-services/self-service.ts');assert.equal(await self.canEnterFoodServices({id:'actor',roles:['CHEF']}),true);
 await assert.rejects(self.requireFoodEmployee());
});
test('QA reference rejects production, missing isolation and either nonlocal Prisma URL',()=>{
 const keys=['NODE_ENV','FOOD_QA_REFERENCE_DATE','FOOD_QA_ISOLATED','YELLOWFLEX_TEST_DATABASE_URL','DATABASE_URL','DIRECT_URL'];
 const before=Object.fromEntries(keys.map(k=>[k,process.env[k]]));
 try {
  const date='2099-06-05T18:00:00.000Z',url='postgresql://qa:fictional@127.0.0.1:55432/yellowflex_restore_test';
  process.env.NODE_ENV='development';process.env.FOOD_QA_REFERENCE_DATE=date;process.env.FOOD_QA_ISOLATED='1';
  process.env.YELLOWFLEX_TEST_DATABASE_URL=url;process.env.DATABASE_URL=url;process.env.DIRECT_URL=url;
  const clock=harness().load('lib/food-services/reference-date.ts');assert.equal(clock.getFoodReferenceDate().toISOString(),date);
  process.env.NODE_ENV='production';assert.throws(()=>clock.getFoodReferenceDate());process.env.NODE_ENV='development';
  process.env.DIRECT_URL='postgresql://u:p@prod.invalid:5432/postgres';assert.throws(()=>clock.getFoodReferenceDate());process.env.DIRECT_URL=url;
  delete process.env.FOOD_QA_ISOLATED;assert.throws(()=>clock.getFoodReferenceDate());
  delete process.env.FOOD_QA_REFERENCE_DATE;assert.ok(Math.abs(clock.getFoodReferenceDate().getTime()-Date.now())<1000);
 }finally{for(const k of keys){if(before[k]===undefined)delete process.env[k];else process.env[k]=before[k];}}
});
test('weekly request schema rejects cross-employee identity and client-supplied dates',()=>{
 const h=harness({realFoodServices:true});delete h.mocks['@/lib/food-services/validation'];
 const {weeklyReservationSchema}=h.load('lib/food-services/validation.ts');
 assert.throws(()=>weeklyReservationSchema.parse({menuItemIds:[],employeeId:'other'}));
 assert.throws(()=>weeklyReservationSchema.parse({menuItemIds:[],referenceDate:'2099-01-01'}));
 assert.deepEqual(weeklyReservationSchema.parse({menuItemIds:[]}),{menuItemIds:[]});
});

test('expired corporate session reads do not delete records during GET',async()=>{
 const h=harness();h.db.corporateSession.findUnique=async()=>({id:'expired',expiresAt:new Date(0),user:h.user});
 assert.equal(await h.load('lib/auth/corporate-auth.ts').getCurrentCorporateUser(),null);
 assert.deepEqual(h.calls.writes,[]);
});

test('CHEF demand queries the employee target week instead of the last published week',async()=>{
 const h=harness({realFoodServices:true});let query;
 h.db.menuWeek={findFirst:async value=>{query=value;return null;}};
 const result=await h.load('lib/food-services/chef-production-service.ts').getChefProductionSummary();
 const target=h.load('lib/food-services/calendar.ts').getNextFoodWeekStart();
 assert.equal(query.where.OR[0].status,'PUBLISHED');assert.equal(query.where.weekStart.toISOString(),target.toISOString());
 assert.equal(result.week,null);assert.deepEqual(h.calls.writes,[]);
});
