/* Small, private byte-buffer adapter for the imported decoder/display plans.
 * No Node APIs are installed globally. All device memory remains native-owned. */
(function(g){
 "use strict";
 class Bytes extends Uint8Array {
  static alloc(size,fill=0){if(!Number.isSafeInteger(size)||size<0||size>0x2000000)throw Error("Invalid native buffer size");var bytes=new Bytes(size);if(fill)bytes.fill(fill);return bytes;}
  static from(value,encoding){
   if(typeof value!=="string")return new Bytes(value);
   if(encoding==="hex"){
    if(value.length%2||!/^[0-9a-f]*$/i.test(value))throw Error("Invalid hexadecimal bytes");
    var out=Bytes.alloc(value.length/2);for(var i=0;i<out.length;i++)out[i]=parseInt(value.slice(i*2,i*2+2),16);return out;
   }
   // Imported strings are ASCII: symbols, MIME types, and shader entry names.
   if(/[^\x00-\x7f]/.test(value))throw Error("Native strings must be ASCII");
   return new Bytes(Array.from(value,function(c){return c.charCodeAt(0);}));
  }
  static concat(list){var n=list.reduce(function(n,b){return n+b.length;},0),out=Bytes.alloc(n),at=0;for(var b of list){out.set(b,at);at+=b.length;}return out;}
  static byteLength(value){return Bytes.from(value).length;}
  static isBuffer(value){return value instanceof Uint8Array;}
  view(){return new DataView(this.buffer,this.byteOffset,this.byteLength);}
  readUInt8(at=0){return this.view().getUint8(at);}
  readUInt16LE(at=0){return this.view().getUint16(at,true);}
  readUInt32LE(at=0){return this.view().getUint32(at,true);}
  readInt32LE(at=0){return this.view().getInt32(at,true);}
  readBigUInt64LE(at=0){return this.view().getBigUint64(at,true);}
  readBigInt64LE(at=0){return this.view().getBigInt64(at,true);}
  writeUInt8(value,at=0){this.view().setUint8(at,value);return at+1;}
  writeUInt16LE(value,at=0){this.view().setUint16(at,value,true);return at+2;}
  writeUInt32LE(value,at=0){this.view().setUint32(at,value,true);return at+4;}
  writeInt32LE(value,at=0){this.view().setInt32(at,value,true);return at+4;}
  writeBigUInt64LE(value,at=0){this.view().setBigUint64(at,BigInt(value),true);return at+8;}
  writeBigInt64LE(value,at=0){this.view().setBigInt64(at,BigInt(value),true);return at+8;}
  writeFloatLE(value,at=0){this.view().setFloat32(at,value,true);return at+4;}
  copy(target,to=0,start=0,end=this.length){var b=this.subarray(start,end);target.set(b,to);return b.length;}
  equals(other){return this.length===other.length&&this.every(function(v,i){return v===other[i];});}
  toString(encoding){
   if(encoding==="hex")return Array.from(this,function(v){return ("0"+v.toString(16)).slice(-2);}).join("");
   var out="";for(var b of this)out+=String.fromCharCode(b);return out;
  }
 }
 g.CivNanoVGBuffer=g.CivSDKBytes=Bytes;
})(typeof window!=="undefined"?window:globalThis);
