import test from 'node:test';
import assert from 'node:assert/strict';
import {mapConcurrent,mapDependent,serialWriter} from '../dist/concurrency.js';
const delay=ms=>new Promise(resolve=>setTimeout(resolve,ms));
test('dependent jobs leave slots for unrelated work and preserve dependency order',async()=>{
 const log=[];let release;const gate=new Promise(resolve=>release=resolve);
 await mapDependent([0,1,2],[[],[0],[]],2,async i=>{
  log.push(`start${i}`);
  if(i===0)await gate;
  if(i===2)release();
  log.push(`end${i}`);
 });
 assert.ok(log.indexOf('start2')<log.indexOf('end0'));
 assert.ok(log.indexOf('end0')<log.indexOf('start1'));
 await assert.rejects(mapDependent([0],[[0]],1,async()=>{}),/earlier jobs/);
});
test('dependency pool drains errors and never starts waiting children after stop',async()=>{
 let stop=false;const started=[];
 await mapDependent([0,1,2],[[],[0],[]],2,async i=>{started.push(i);await delay(1);stop=true;},()=>stop);
 assert.deepEqual(started,[0,2]);
 let drained=false;
 await assert.rejects(mapDependent([0,1,2],[[],[0],[]],2,async i=>{
  if(i===0)throw new Error('observer failed');
  await delay(5);drained=true;
 }),/observer failed/);
 assert.equal(drained,true);
});
test('worker pool overlaps requests, enforces limit and returns in original order',async()=>{
  let active=0,peak=0;const seen=[];
  const result=await mapConcurrent([0,1,2,3,4,5],3,async(value)=>{
    active++;peak=Math.max(peak,active);seen.push(value);await delay(value===0?25:2);active--;return value*10;
  });
  assert.equal(peak,3);assert.equal(active,0);assert.equal(new Set(seen).size,6);
  assert.deepEqual(result,[0,10,20,30,40,50]);
  await assert.rejects(()=>mapConcurrent([],0,async()=>0),/Concurrency/);
});
test('circuit stop prevents new starts and drains all in-flight responses',async()=>{
  let stop=false,active=0;const started=[];
  const result=await mapConcurrent([0,1,2,3,4,5],3,async(value)=>{
    started.push(value);active++;await delay(value===0?1:15);if(value===0)stop=true;active--;return value;
  },()=>stop);
  assert.deepEqual(started,[0,1,2]);assert.equal(active,0);
  assert.deepEqual(result,[0,1,2,undefined,undefined,undefined]);
});
test('journal records stay ordered and do not overlap while inference may overlap',async()=>{
  let writing=false;const log=[];
  const write=serialWriter(async value=>{assert.equal(writing,false);writing=true;await delay(2);log.push(JSON.parse(value));writing=false;});
  await Promise.all(Array.from({length:16},(_,id)=>write(JSON.stringify({id}))));
  assert.deepEqual(log.map(r=>r.id),Array.from({length:16},(_,id)=>id));
});
