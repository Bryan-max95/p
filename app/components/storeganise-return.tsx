'use client';

import { useEffect,useState } from 'react';

/** Mounted only after the server confirms the invoice payment (and occupancy for a booking). */
export function StoreganiseReturn({sessionId,url,language,invoice=false}:{sessionId:string;url:string;language:'es'|'en';invoice?:boolean}) {
  const [stay,setStay]=useState(false);
  useEffect(()=>{
    if(stay)return;
    const key=`pay-storeganise-returned:${sessionId}`;
    try{if(window.sessionStorage.getItem(key)){
      const hide=window.setTimeout(()=>setStay(true),0);
      return()=>window.clearTimeout(hide);
    }}catch{/* The return link remains usable. */}
    const timer=window.setTimeout(()=>{
      try{window.sessionStorage.setItem(key,'1');}catch{/* Storage is optional for navigation. */}
      window.location.assign(url);
    },5000);
    return()=>window.clearTimeout(timer);
  },[sessionId,url,stay]);
  if(stay)return null;
  return <div className="text-center text-xs text-slate-600 space-y-2" role="status">
    <p>{invoice
      ? (language==='es'?'Volverá a su factura en Storeganise en 5 segundos.':'Returning to your Storeganise invoice in 5 seconds.')
      : (language==='es'?'Volverá a su cuenta en Storeganise en 5 segundos.':'Returning to your Storeganise account in 5 seconds.')}</p>
    <button type="button" onClick={()=>setStay(true)} className="font-bold underline">
      {language==='es'?'Quedarme para guardar el comprobante':'Stay to save my receipt'}
    </button>
  </div>;
}
