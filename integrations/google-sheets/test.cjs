// Local isolated tests. No network and no business records.
const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict'),crypto=require('node:crypto');
const tables={101:[],102:[],103:[],104:[],105:[]};let fail=false,actor='owner@example.invalid',calls=0;
const names={'営業案件':101,'経理明細':102,'月次実績':103,'承認履歴':104,'朝報履歴':105};
const ss={getId:()=> 'test-only',getUrl:()=> 'https://example.invalid',getSheetByName:name=>{
 const id=names[name];if(!id)return null;return {getSheetId:()=>id,getLastRow:()=>tables[id].length+1,getLastColumn:()=>12,getRange:()=>({getValues:()=>tables[id]})};
}};
const ctx={console,Set,Date,Error,Session:{getActiveUser:()=>({getEmail:()=>actor}),getEffectiveUser:()=>({getEmail:()=> 'owner@example.invalid'})},PropertiesService:{getScriptProperties:()=>({getProperty:()=> 'test-only'})},SpreadsheetApp:{openById:()=>ss},Utilities:{DigestAlgorithm:{SHA_256:1},Charset:{UTF_8:1},computeDigest:(_,s)=>Array.from(crypto.createHash('sha256').update(s).digest()),getUuid:()=>crypto.randomUUID(),formatDate:()=> '2026-10-26 17:00:00'},LockService:{getScriptLock:()=>({waitLock(){},releaseLock(){}})},Sheets:{Spreadsheets:{batchUpdate:body=>{
 calls++;if(fail)throw Error('simulated failure');const next=JSON.parse(JSON.stringify(tables));for(const req of body.requests){const a=req.appendCells;next[a.sheetId].push(...a.rows.map(r=>r.values.map(v=>v.userEnteredValue.stringValue??v.userEnteredValue.numberValue)));}Object.assign(tables,next);
}}}};vm.createContext(ctx);vm.runInContext(fs.readFileSync(__dirname+'/Code.gs','utf8'),ctx);
const data={source:'local test',sales:[{name:'fixture',category:'その他',amount:0,stage:'調査中',nextAction:'',dueDate:'',sourceKey:'s1'}],finance:[],monthly:[]};
const request=()=>({approved:true,batchId:crypto.randomUUID(),data:JSON.parse(JSON.stringify(data))});
assert.throws(()=>ctx.approveAndSave({...request(),approved:false}),/承認/);
actor='';assert.throws(()=>ctx.getSnapshot(),/所有者/);actor='owner@example.invalid';
assert.throws(()=>ctx.date_('2026-02-30',false,false),/実在/);
assert.equal(ctx.date_('2028-02-29',false,false),'2028-02-29');
for(const amount of ['',null,-1,1.5,Infinity])assert.throws(()=>ctx.money_(amount));
fail=true;assert.throws(()=>ctx.approveAndSave(request()),/simulated/);assert.equal(tables[101].length,0);assert.equal(tables[104].length,0);fail=false;
const r=request();assert.equal(ctx.approveAndSave(r).saved,true);assert.equal(tables[101].length,1);assert.equal(tables[104].length,1);
const before=calls;assert.equal(ctx.approveAndSave(r).saved,false);assert.equal(calls,before);
r.data.sales[0].amount=1;assert.throws(()=>ctx.approveAndSave(r),/内容が変わって/);
assert.throws(()=>ctx.approveAndSave(request()),/保存済み/);assert.equal(tables[101].length,1);
const mixed=request();mixed.data.sales[0].sourceKey='s2';mixed.data.finance=[{date:'2026-10-26',type:'経費',amount:-1,description:'fixture',paymentStatus:'未確認'}];assert.throws(()=>ctx.approveAndSave(mixed));assert.equal(tables[101].length,1);
const formula=ctx.cell_('=HYPERLINK("https://example.invalid")');assert.ok(formula.userEnteredValue.stringValue);assert.ok(!formula.userEnteredValue.formulaValue);
const m=request();m.data.sales=[];m.data.monthly=[{month:'2026-10',revenue:0,expense:0,sourceKey:'m1'}];ctx.approveAndSave(m);m.batchId=crypto.randomUUID();m.data.monthly[0].sourceKey='m2';assert.throws(()=>ctx.approveAndSave(m),/登録済み/);
const snap=ctx.getSnapshot();assert.equal(snap.sales.length,1);assert.equal(snap.monthly.length,1);
const script=fs.readFileSync(__dirname+'/Index.html','utf8').match(/<script>([\s\S]*?)<\/script>/)[1];new vm.Script(script);
console.log('PASS: approval, owner-only, date/money validation, atomic failure, idempotency, duplicate rejection, monthly conflict, literal strings, readback, browser-script syntax');
