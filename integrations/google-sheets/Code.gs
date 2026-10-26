/* Aogiri AI HQ: bound Apps Script. Business data never belongs in Git. */
const SCHEMA = {
  sales: {sheet:'営業案件', id:101, keys:['name','category','amount','stage','nextAction','dueDate']},
  finance: {sheet:'経理明細', id:102, keys:['date','type','amount','partner','description','dueDate','paymentStatus']},
  monthly: {sheet:'月次実績', id:103, keys:['month','revenue','expense']}
};
function owner_() {
  const active = Session.getActiveUser().getEmail();
  const effective = Session.getEffectiveUser().getEmail();
  if (!active || active !== effective) throw Error('所有者のGoogleアカウントで開いてください。');
  return active;
}
function book_() {
  const id = PropertiesService.getScriptProperties().getProperty('SPREADSHEET_ID');
  if (!id) throw Error('先にsetupを実行してください。');
  return SpreadsheetApp.openById(id);
}
function setup() {
  owner_();
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  if (!ss) throw Error('作成済みの台帳から拡張機能→Apps Scriptを開いてください。');
  Object.keys(SCHEMA).forEach(k => {
    const s = ss.getSheetByName(SCHEMA[k].sheet);
    if (!s || s.getSheetId() !== SCHEMA[k].id) throw Error('対象台帳の構成を確認してください。');
  });
  PropertiesService.getScriptProperties().setProperty('SPREADSHEET_ID', ss.getId());
  return '設定完了。アクセスできるユーザーを「自分のみ」にしてウェブアプリをデプロイしてください。';
}
function doGet() {
  owner_();
  return HtmlService.createHtmlOutputFromFile('Index').setTitle('アオギリフォレスト AI本部')
    .addMetaTag('viewport','width=device-width, initial-scale=1, viewport-fit=cover');
}
function text_(v, required) {
  if (v == null) v = '';
  if (typeof v !== 'string' || v.length > 2000 || (required && !v.trim())) throw Error('文字列の入力を確認してください。');
  return v.trim();
}
function money_(v) {
  if (typeof v !== 'number' || !Number.isSafeInteger(v) || v < 0) throw Error('金額は0以上の整数（円）で入力してください。');
  return v;
}
function date_(v, monthOnly, optional) {
  v = text_(v, !optional);
  if (!v && optional) return '';
  const re = monthOnly ? /^\d{4}-(0[1-9]|1[0-2])$/ : /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/;
  if (!re.test(v)) throw Error('日付はYYYY-MM-DD、月はYYYY-MMで入力してください。');
  const iso = monthOnly ? v+'-01' : v;
  const parsed = new Date(iso+'T00:00:00Z');
  if (!Number.isFinite(parsed.getTime()) || parsed.toISOString().slice(0,10) !== iso) throw Error('実在する日付を入力してください。');
  return v;
}
function choice_(v, choices) {
  if (!choices.includes(v)) throw Error('選択肢を確認してください: '+choices.join(' / '));
  return v;
}
function normalize_(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw Error('JSONの形式を確認してください。');
  const out = {source:text_(input.source, true),sales:[],finance:[],monthly:[]};
  Object.keys(SCHEMA).forEach(type => {
    const list = input[type] == null ? [] : input[type];
    if (!Array.isArray(list) || list.length > 100) throw Error('各部門100件までです。');
    out[type] = list.map(x => {
      if (!x || typeof x !== 'object' || Array.isArray(x)) throw Error('各行はオブジェクトにしてください。');
      let r;
      if (type === 'sales') r = {
        name:text_(x.name,true), category:text_(x.category,true), amount:money_(x.amount),
        stage:choice_(x.stage,['調査中','提案予定','商談中','見積提出','受注','失注']),
        nextAction:text_(x.nextAction,false), dueDate:date_(x.dueDate,false,true)
      };
      if (type === 'finance') r = {
        date:date_(x.date,false,false), type:choice_(x.type,['売上','経費','入金予定','支払予定']),
        amount:money_(x.amount), partner:text_(x.partner,false), description:text_(x.description,true),
        dueDate:date_(x.dueDate,false,true),paymentStatus:choice_(x.paymentStatus,['未決済','決済済','未確認'])
      };
      if (type === 'monthly') r = {month:date_(x.month,true,false),revenue:money_(x.revenue),expense:money_(x.expense)};
      r.sourceKey = text_(x.sourceKey,false);
      return r;
    });
  });
  if (!out.sales.length && !out.finance.length && !out.monthly.length) throw Error('保存するデータがありません。');
  return out;
}
function hash_(value) {
  return Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256,JSON.stringify(value),Utilities.Charset.UTF_8)
    .map(b => ('0'+((b+256)%256).toString(16)).slice(-2)).join('');
}
function key_(type, row) { return hash_([type,row.sourceKey || row]); }
function rows_(ss,name) {
  const sheet = ss.getSheetByName(name);
  if (!sheet) throw Error('必要なシートがありません: '+name);
  return sheet.getLastRow() < 2 ? [] : sheet.getRange(2,1,sheet.getLastRow()-1,sheet.getLastColumn()).getValues()
    .map(row=>row.map(v=>v instanceof Date ? Utilities.formatDate(v,'Asia/Tokyo','yyyy-MM-dd') : v));
}
function cell_(v) {
  // Explicit stringValue avoids interpreting user text as spreadsheet formulas.
  return {userEnteredValue: typeof v === 'number' ? {numberValue:v} : {stringValue:String(v)}};
}
function append_(sheetId, rows) {
  return {appendCells:{sheetId,rows:rows.map(r=>({values:r.map(cell_)})),fields:'userEnteredValue'}};
}
function approveAndSave(request) {
  const actor = owner_();
  if (!request || request.approved !== true || !/^[a-zA-Z0-9-]{16,80}$/.test(request.batchId || '')) throw Error('確認画面で承認してください。');
  const batch = normalize_(request.data), digest = hash_(batch);
  const lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    const ss = book_();
    const history = rows_(ss,'承認履歴');
    const previous = history.find(r=>r[0]===request.batchId);
    if (previous) {
      if (previous[7]!==digest) throw Error('同じ承認IDで内容が変わっています。確認画面を作り直してください。');
      return {saved:false,message:'この承認は保存済みです。再読込してください。'};
    }
    const stamp = Utilities.formatDate(new Date(),'Asia/Tokyo','yyyy-MM-dd HH:mm:ss');
    const requests = [], counts = [];
    Object.keys(SCHEMA).forEach(type=>{
      const spec = SCHEMA[type], existing = rows_(ss,spec.sheet);
      const known = new Set(existing.map(r=>String(r[spec.keys.length+4])));
      const unique = new Set(), newRows = [];
      batch[type].forEach(row=>{
        const key = key_(type,row);
        if (unique.has(key)) throw Error('同じ取込キーの行が複数あります。');
        unique.add(key);
        if (known.has(key)) throw Error('保存済みの行が含まれています。重複行を除いて再確認してください。');
        if (type==='monthly' && existing.some(r=>String(r[1])===row.month)) throw Error('この月の実績は登録済みです。台帳で確認してください。');
        newRows.push([Utilities.getUuid()].concat(spec.keys.map(k=>row[k]),[batch.source,stamp,actor,key]));
      });
      if (newRows.length) requests.push(append_(spec.id,newRows));
      counts.push(newRows.length);
    });
    if (new Set(batch.monthly.map(r=>r.month)).size !== batch.monthly.length) throw Error('同じ月が複数あります。');
    requests.push(append_(104,[[request.batchId,stamp,actor].concat(counts,[batch.source,digest])]));
    // One atomic Sheets request includes all records and approval history.
    Sheets.Spreadsheets.batchUpdate({requests},ss.getId());
    return {saved:true,message:'承認内容を保存しました。'};
  } finally { lock.releaseLock(); }
}
function getSnapshot() {
  owner_();
  const ss = book_(), result = {};
  Object.keys(SCHEMA).forEach(type=>{
    const spec=SCHEMA[type];
    result[type]=rows_(ss,spec.sheet).filter(r=>r[0] && r[spec.keys.length+2]).map(r=>{
      const o={id:String(r[0])};spec.keys.forEach((k,i)=>o[k]=r[i+1]);return o;
    });
  });
  result.reports=rows_(ss,'朝報履歴').slice(-7).reverse().map(r=>r.map(String));
  result.url=ss.getUrl();
  result.checkedAt=Utilities.formatDate(new Date(),'Asia/Tokyo','yyyy-MM-dd HH:mm:ss');
  return result;
}
