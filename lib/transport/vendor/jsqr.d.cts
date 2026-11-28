/** Browser-only, Apache-2.0, npm jsqr 1.4.0; see jsqr.LICENSE. */
export default function jsQR(data:Uint8ClampedArray,width:number,height:number,options?:{
  inversionAttempts:"dontInvert"|"attemptBoth";
}):{data:string}|null;
