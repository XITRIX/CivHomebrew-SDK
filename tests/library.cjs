const fs=require('node:fs');
const path=require('node:path');
const bundle=fs.readFileSync(path.resolve(__dirname,'../dist/'+require('../package.json').version+'/civapps-native-ui.js'),'utf8');
function readModule(name){
 const start='/* CIVAPPS_MODULE '+name+' */\n',end='\n;/* CIVAPPS_MODULE_END '+name+' */';
 const a=bundle.indexOf(start),b=bundle.indexOf(end,a+start.length);
 if(a<0||b<0)throw Error('Missing released module: '+name);
 return bundle.slice(a+start.length,b);
}
module.exports={readModule,bundle};
