import {DatabaseSync} from 'node:sqlite';
import {readFileSync,readdirSync} from 'node:fs';
export function database(path=':memory:'){
 const sqlite=new DatabaseSync(path);sqlite.exec('PRAGMA journal_mode=WAL;');
 sqlite.exec('CREATE TABLE IF NOT EXISTS schema_migrations(name TEXT PRIMARY KEY)');
 for(const name of readdirSync(new URL('../migrations/',import.meta.url)).filter(x=>x.endsWith('.sql')).sort()){
  if(sqlite.prepare('SELECT name FROM schema_migrations WHERE name=?').get(name))continue;
  sqlite.exec(readFileSync(new URL('../migrations/'+name,import.meta.url),'utf8'));
  sqlite.prepare('INSERT INTO schema_migrations VALUES(?)').run(name);
 }
 return {sqlite,async batch(statements){sqlite.exec('BEGIN');try{const results=await Promise.all(statements.map(s=>s.all()));sqlite.exec('COMMIT');return results;}catch(e){sqlite.exec('ROLLBACK');throw e;}},prepare(sql){return {bind(...args){return {
  first:async()=>sqlite.prepare(sql).get(...args)??null,
  all:async()=>({results:sqlite.prepare(sql).all(...args)}),
  run:async()=>{const before=sqlite.prepare('SELECT total_changes() n').get().n;sqlite.prepare(sql).run(...args);return {meta:{changes:sqlite.prepare('SELECT total_changes() n').get().n-before}};}
 };}};},close:()=>sqlite.close()};
}
