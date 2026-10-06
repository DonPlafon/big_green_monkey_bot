import vm from 'node:vm';
import { readFile } from 'node:fs/promises';
import { DatabaseSync } from 'node:sqlite';
import { posix } from 'node:path';

// Integration harness: real SQLite, SDK-compatible builders, a stateful fake
// Telegram API and isolated production ESM modules. No network or bot secrets.
export async function createRuntime() {
  const sqlite = new DatabaseSync(':memory:');
  const tables = [];
  const column = (name, type) => ({ name, type, constraints:[],
    primaryKey(options) { this.constraints.push(`PRIMARY KEY${options?.autoIncrement ? ' AUTOINCREMENT' : ''}`); return this; },
    notNull() { this.constraints.push('NOT NULL'); return this; },
    unique() { this.constraints.push('UNIQUE'); return this; },
    default(value) { this.constraints.push(`DEFAULT ${typeof value === 'string' ? `'${value}'` : value}`); return this; },
  });
  const condition = (operator) => (col, value) => ({sql:`"${col.name}" ${operator} ?`,values:[value]});
  const ddl = {
    integer: name => column(name,'INTEGER'), text: name => column(name,'TEXT'),
    index: name => ({ on:() => ({name}) }),
    table(name, cols, indexes) {
      const result = { ...cols, _name:name, _columns:cols };
      tables.push(result); indexes?.(result); return result;
    },
    eq:condition('='), lt:condition('<'), and:(...items) => ({sql:items.map(x=>`(${x.sql})`).join(' AND '),values:items.flatMap(x=>x.values)}),
  };
  function builder(operation, table) {
    let data, filter, conflict, returning = false;
    return {
      values(v) { data=v; return this; }, set(v) { data=v; return this; }, where(v) { filter=v; return this; },
      onConflictDoNothing(v) { conflict={...v,nothing:true}; return this; },
      onConflictDoUpdate(v) { conflict=v; return this; }, returning() { returning=true; return this; },
      async run() {
        let sql, params=[];
        if (operation === 'insert') {
          const keys = Object.keys(data);
          sql=`INSERT INTO "${table._name}" (${keys.map(k=>`"${k}"`).join(',')}) VALUES (${keys.map(()=>'?').join(',')})`;
          params=Object.values(data);
          if (conflict) {
            sql+=` ON CONFLICT ("${conflict.target.name}") DO `;
            if (conflict.nothing) sql+='NOTHING';
            else { sql+='UPDATE SET '+Object.keys(conflict.set).map(k=>`"${k}" = ?`).join(','); params.push(...Object.values(conflict.set)); }
          }
        } else if (operation === 'update') {
          sql=`UPDATE "${table._name}" SET ${Object.keys(data).map(k=>`"${k}" = ?`).join(',')}`;
          params=Object.values(data);
        } else sql=`DELETE FROM "${table._name}"`;
        if (filter) { sql+=` WHERE ${filter.sql}`; params.push(...filter.values); }
        if (returning) sql+=' RETURNING *';
        const statement=sqlite.prepare(sql);
        if (returning) return statement.all(...params);
        statement.run(...params); return [];
      },
    };
  }
  const db = {
    insert:t=>builder('insert',t), update:t=>builder('update',t), delete:t=>builder('delete',t),
    async get(sql,params={}) { return sqlite.prepare(sql).get(params) || null; },
    async all(sql,params={}) { return sqlite.prepare(sql).all(params); },
    async run(sql,params={}) { sqlite.prepare(sql).run(params); return []; },
  };
  const calls=[], members=new Map(), chatInfo=new Map(), failures=new Map();
  const httpCalls = [], httpResponses = new Map();
  const fetch = async url => {
    httpCalls.push(url);
    const response = httpResponses.get(url);
    if (response instanceof Error) throw response;
    if (!response) throw new Error('unmocked HTTP request');
    return { ok: response.status === 200, status: response.status, text: async () => response.body };
  };
  let messageId=1;
  const api=new Proxy({}, {get:(_,method)=> async params => {
    calls.push({method,params});
    if (failures.has(method)) { const error=failures.get(method); failures.delete(method); throw error; }
    const key=`${params?.chat_id}:${params?.user_id}`;
    if (method==='getMe') return {id:999,username:'test_bot',is_bot:true};
    if (method==='getChatMember') return members.get(key) || {status:'left',user:{id:params.user_id}};
    if (method==='getChat') return chatInfo.get(params.chat_id) || {id:params.chat_id,title:'test',type:'supergroup',permissions:{can_send_messages:true}};
    if (method==='sendMessage') return {message_id:messageId++,chat:{id:params.chat_id}};
    if (method==='restrictChatMember') {
      members.set(key,{...members.get(key),status:'restricted',is_member:true,...params.permissions,until_date:params.until_date}); return true;
    }
    if (method==='unbanChatMember') { members.set(key,{status:'left',user:{id:params.user_id}}); return true; }
    if (method==='approveChatJoinRequest') { members.set(key,{status:'member',user:{id:params.user_id}}); return true; }
    if (method==='declineChatJoinRequest') { members.set(key,{status:'left',user:{id:params.user_id}}); return true; }
    if (method==='createChatInviteLink') return {invite_link:'https://t.me/+test'};
    if (method==='savePreparedKeyboardButton') return {id:'prepared-chat-picker'};
    return true;
  }});
  const context=vm.createContext({console,Date,Math,JSON,Number,String,Object,Array,Error,Set,Map,Promise});
  class EndpointError extends Error {
    constructor(message,parameters) { super(message);this.parameters=parameters; }
  }
  const cache=new Map();
  function load(name) {
    if (cache.has(name)) return cache.get(name);
    const pending = buildModule(name);
    cache.set(name,pending);
    return pending;
  }
  async function buildModule(name) {
    let mod;
    if (name==='sdk' || name==='sdk/db') {
      const exports=name==='sdk' ? {api,db,fetch,EndpointError} : ddl;
      mod=new vm.SyntheticModule(Object.keys(exports),function(){for(const [key,value] of Object.entries(exports))this.setExport(key,value);},{context});
    } else {
      const code=await readFile(new URL(`../tgcloud/${name}.js`,import.meta.url),'utf8');
      mod=new vm.SourceTextModule(code,{context,identifier:name});
    }
    await mod.link((specifier,ref) => load(specifier.startsWith('.') ? posix.normalize(posix.join(posix.dirname(ref.identifier),specifier)).replace(/\.js$/,'') : specifier));
    return mod;
  }
  const schema=await load('schema'); await schema.evaluate();
  for (const table of tables) sqlite.exec(`CREATE TABLE "${table._name}" (${Object.entries(table._columns).map(([key,col])=>`"${key}" ${col.type} ${col.constraints.join(' ')}`).join(',')})`);
  return { sqlite,api,calls,members,chatInfo,failures,httpCalls,httpResponses,
    async module(name) { const mod=await load(name); await mod.evaluate(); return mod.namespace; },
    async handle(name,payload,ctx={}) { const mod=await this.module(`handlers/${name}`); return mod.default(payload,ctx); },
    async connect(id=-1001,userId=1,kind='supergroup') {
      chatInfo.set(id,{id,title:`chat ${id}`,type:kind,permissions:{can_send_messages:true,can_send_photos:true}});
      members.set(`${id}:${userId}`,{status:'creator',user:{id:userId}});
      members.set(`${id}:999`,{status:'administrator',can_invite_users:true,can_restrict_members:true,user:{id:999}});
      const store=await this.module('lib/store'); await store.connectChat(chatInfo.get(id),userId);
      return store;
    },
  };
}
