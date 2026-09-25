/** Bound in-flight work; preserve input order and drain already-started work on stop. */
export async function mapConcurrent<T,R>(items:readonly T[],limit:number,work:(item:T,index:number)=>Promise<R>,shouldStop:()=>boolean=()=>false):Promise<Array<R|undefined>> {
  if(!Number.isSafeInteger(limit)||limit<1||limit>32)throw new Error('Concurrency must be an integer from 1 to 32.');
  const results:Array<R|undefined>=Array(items.length).fill(undefined);
  let cursor=0;
  const workers=Array.from({length:Math.min(limit,items.length)},async()=>{
    while(!shouldStop()&&cursor<items.length){const index=cursor++;results[index]=await work(items[index]!,index);}
  });
  // Drain all workers even when one has an unexpected I/O failure.
  const settled=await Promise.allSettled(workers);
  const failed=settled.find(r=>r.status==='rejected');
  if(failed?.status==='rejected')throw failed.reason;
  return results;
}

/** Serialize only journal writes, not model inference. A write failure remains fatal. */
export function serialWriter(write:(value:string)=>Promise<unknown>) {
  let tail:Promise<unknown>=Promise.resolve();
  return (value:string)=>{tail=tail.then(()=>write(value));return tail;};
}

/** Only ready jobs occupy slots. Earlier-index dependencies form an acyclic graph. */
export async function mapDependent<T>(items:readonly T[],dependencies:readonly number[][],limit:number,work:(item:T,index:number)=>Promise<void>,shouldStop:()=>boolean=()=>false):Promise<void>{
 if(!Number.isSafeInteger(limit)||limit<1||limit>32)throw new Error('Concurrency must be an integer from 1 to 32.');
 if(dependencies.length!==items.length||dependencies.some((deps,i)=>deps.some(d=>!Number.isSafeInteger(d)||d<0||d>=i)))throw new Error('Dependencies must refer to earlier jobs.');
 const pending=new Set(items.map((_,i)=>i)),done=new Set<number>();
 const running=new Map<number,Promise<{index:number;error?:unknown;failed:boolean}>>();
 let failure:unknown,hasFailure=false;
 while(pending.size||running.size){
  if(!hasFailure&&!shouldStop())for(const i of pending){
   if(running.size>=limit)break;
   if(!dependencies[i]!.every(d=>done.has(d)))continue;
   pending.delete(i);
   running.set(i,Promise.resolve().then(()=>work(items[i]!,i)).then(()=>({index:i,failed:false}),error=>({index:i,error,failed:true})));
  }
  if(!running.size)break;
  const result=await Promise.race(running.values());running.delete(result.index);done.add(result.index);
  if(result.failed&&!hasFailure){failure=result.error;hasFailure=true;}
 }
 if(hasFailure)throw failure;
}
