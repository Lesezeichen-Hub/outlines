(function(root){
  "use strict";
  const DB="outlines-relief",STORE="projects";
  function open(){return new Promise((resolve,reject)=>{const request=indexedDB.open(DB,1);request.onupgradeneeded=()=>{if(!request.result.objectStoreNames.contains(STORE))request.result.createObjectStore(STORE,{keyPath:"id"});};request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(request.error);});}
  async function query(mode,operation){const db=await open();return new Promise((resolve,reject)=>{const tx=db.transaction(STORE,mode),store=tx.objectStore(STORE),request=operation(store);let result;request.onsuccess=()=>{result=request.result;};request.onerror=()=>reject(request.error);tx.oncomplete=()=>{db.close();resolve(result);};tx.onerror=()=>{db.close();reject(tx.error);};});}
  root.ReliefStorage={
    save(record){return query("readwrite",store=>store.put(record));},
    get(id){return query("readonly",store=>store.get(id));},
    list(){return query("readonly",store=>store.getAll());},
    remove(id){return query("readwrite",store=>store.delete(id));}
  };
})(typeof self!=="undefined"?self:globalThis);
