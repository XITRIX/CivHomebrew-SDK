/* Release versions identify builds; API and major versions define compatibility.
 * This local helper runs before module evaluation and never changes live globals. */
var compatibility=(function(){
 'use strict';
 function version(value){
  if(typeof value!=='string'||!/^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)$/.test(value))throw Error('Invalid SDK compatibility version; expected major.minor.patch');
  var parts=value.split('.').map(Number);
  if(parts.some(function(n){return !Number.isSafeInteger(n);}))throw Error('Invalid SDK compatibility version');
  return parts;
 }
 function validate(required){
  if(!required||typeof required!=='object'||Array.isArray(required)||required.api!==1)throw Error('This app needs an update for the native Launcher (unsupported SDK API).');
  if(required.library!==undefined&&required.library!=='civapps-native-ui'&&required.library!=='civhomebrew-sdk')throw Error('Unsupported SDK library requirement.');
  var built=required.version===undefined?null:version(required.version),minimum=required.minVersion===undefined?null:version(required.minVersion);
  if(built&&minimum&&built[0]!==minimum[0])throw Error('SDK minVersion must use the bundled release major version.');
  if(required.capabilities!==undefined&&(!Array.isArray(required.capabilities)||required.capabilities.some(function(name){return typeof name!=='string'||!/^[a-z][a-z0-9-]{0,63}$/.test(name);})))throw Error('Invalid SDK capability requirements.');
 }
 function assertCompatible(runtime,required){
  validate(required);
  if(!runtime||runtime.api!==required.api||required.library!==undefined&&runtime.name!==required.library)throw Error('Incompatible SDK API or library; update the Launcher and restart Civ VII.');
  var actual=version(runtime.version),built=required.version===undefined?null:version(required.version),minimum=required.minVersion===undefined?null:version(required.minVersion);
  if(built&&actual[0]!==built[0]||minimum&&actual[0]!==minimum[0])throw Error('Incompatible SDK major version; update the Launcher and app, then restart Civ VII.');
  if(minimum){
   for(var i=0;i<3;i++){
    if(actual[i]>minimum[i])break;
    if(actual[i]<minimum[i])throw Error('This app requires SDK '+required.minVersion+' or newer; update the Launcher and restart Civ VII.');
   }
  }
  (required.capabilities||[]).forEach(function(name){
   if(!Array.isArray(runtime.capabilities)||runtime.capabilities.indexOf(name)<0)throw Error('This app requires SDK capability "'+name+'"; update the Launcher and restart Civ VII.');
  });
  return runtime;
 }
 return Object.freeze({validate:validate,assert:assertCompatible});
})();
