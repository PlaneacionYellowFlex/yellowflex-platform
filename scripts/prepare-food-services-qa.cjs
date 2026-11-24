const fs=require('node:fs');
const assert=require('node:assert/strict');
const {configureIsolatedConnection,assertIsolatedIdentity}=require('../tests/helpers/isolated-postgres.cjs');
async function main(){
 const url=configureIsolatedConnection();const {PrismaClient}=require('@prisma/client');const db=new PrismaClient({datasourceUrl:url});
 try{
  await assertIsolatedIdentity(db);
  assert.ok(!fs.existsSync('data/qa-food-reference.json'),'La referencia QA ya existe; no se duplica ni reemplaza');
  const m=JSON.parse(fs.readFileSync('data/qa-pilot-local-manifest.json','utf8'));
  const referenceDate='2099-06-05T18:00:00.000Z';const targetWeek='2099-06-08T00:00:00.000Z';
  const existing=await db.menuWeek.findUnique({where:{weekStart:new Date(targetWeek)},select:{id:true}});
  assert.equal(existing,null,'La semana QA ya existe; no se sobrescribe');
  const shift=await db.workShift.findUnique({where:{code:'T1'}});assert.ok(shift?.active && shift.startTime==='07:00' && shift.endTime==='19:00');
  const employees=await db.employee.findMany({where:{corporateUserId:{in:m.profiles.map(p=>p.userId)}},select:{id:true,fullName:true,status:true,employeeNumber:true}});
  assert.equal(employees.length,4);assert.ok(employees.every(e=>e.status==='ACTIVE'&&e.fullName.startsWith('QA Pilot ')&&e.employeeNumber.startsWith('QA-PILOT-')));
  await db.$transaction(async tx=>{for(const e of employees)await tx.employee.update({where:{id:e.id},data:{workShiftId:shift.id}});});
  fs.writeFileSync('data/qa-food-reference.json',JSON.stringify({database:'yellowflex_restore_test',referenceDate,targetWeek,marker:`QA-FOOD-${m.runId.slice(0,8)}`,employeeIds:employees.map(e=>e.id)},null,2),{flag:'wx'});
  console.log('Cuatro empleados ficticios QA vinculados al turno T1 del catálogo único RH. Referencia Food QA: 2099-06-05; semana objetivo: 2099-06-08.');
 }finally{await db.$disconnect();}
}
main().catch(()=>{console.error('DETENIDO: no se completó la preparación Food QA; revisar estado antes de continuar.');process.exitCode=1;});
