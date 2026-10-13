'use client';

import { useEffect,useState } from 'react';

/** Only mounted after the server confirms both payment application and occupancy. */
export function StoreganiseReturn({sessionId,url,language}:{sessionId:string;url:string;language:'es'|'en'}) {
  const [stay,setStay]=useState(false);
  useEffect(()=>{
    if(stay)return;
    const key=`pay-storeganise-returned:${sessionId}`;
    try{if(window.sessionStorage.getItem(key)){setStay(true);return;}}catch{/* The return link remains usable. */}
    const timer=window.setTimeout(()=>{
      try{window.sessionStorage.setItem(key,'1');}catch{/* Storage is optional for navigation. */}
      window.location.assign(url);
    },5000);
    return()=>window.clearTimeout(timer);
  },[sessionId,url,stay]);
  if(stay)return null;
  return <div className="text-center text-xs text-slate-600 space-y-2" role="status">
    <p>{language==='es'?'Volverá a su reserva en Storeganise en 5 segundos.':'Returning to your Storeganise booking in 5 seconds.'}</p>
    <button type="button" onClick={()=>setStay(true)} className="font-bold underline">
      {language==='es'?'Quedarme para guardar el comprobante':'Stay to save my receipt'}
    </button>
  </div>;
}
