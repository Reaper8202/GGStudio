import RAPIER from '@dimforge/rapier3d-compat';
await RAPIER.init();
const B='/Users/derek/Desktop/crazygames/zombie-motorworks/zombie-motorworks/src';
const {getPartDef}=await import(`${B}/core/parts.ts`);
const {deriveConnections}=await import(`${B}/core/structural.ts`);
const {RuntimeVehicle}=await import(`${B}/runtime/vehicle.ts`);
const p=(id,defId,pos,orient=0,config={})=>({id,defId,pos,orient,config});
const base=[p('core','chassis-core',{x:0,y:1,z:0}),
  p('f1','frame-box',{x:0,y:1,z:1}),p('f2','frame-box',{x:0,y:1,z:-1}),
  p('f3','frame-box',{x:1,y:1,z:0}),p('f4','frame-box',{x:-1,y:1,z:0}),
  p('eng','engine-small',{x:0,y:2,z:0}),p('fuel','fuel-tank',{x:0,y:2,z:1})];
const rigs={
 '2-tread tank':[...base,p('tL','tread-tank',{x:-2,y:1,z:0}),p('tR','tread-tank',{x:2,y:1,z:0})],
 '4-tread tank':[...base,p('tL1','tread-tank',{x:-2,y:1,z:3}),p('tR1','tread-tank',{x:2,y:1,z:3}),
                          p('tL2','tread-tank',{x:-2,y:1,z:-3}),p('tR2','tread-tank',{x:2,y:1,z:-3})],
 'mixed tread+wheel':[...base,p('tL','tread-tank',{x:-2,y:1,z:0}),p('tR','tread-tank',{x:2,y:1,z:0}),
                          p('wFL','wheel-standard',{x:-2,y:1,z:3}),p('wFR','wheel-standard',{x:2,y:1,z:3})],
 '4-wheel car':[...base,p('wFL','wheel-standard',{x:-2,y:1,z:2}),p('wFR','wheel-standard',{x:2,y:1,z:2}),
                          p('wRL','wheel-standard',{x:-2,y:1,z:-2}),p('wRR','wheel-standard',{x:2,y:1,z:-2})],
};
function run(label,parts,controls){
  const world=new RAPIER.World({x:0,y:-9.81,z:0});
  world.createCollider(RAPIER.ColliderDesc.cuboid(200,0.5,200).setTranslation(0,-0.5,0),
    world.createRigidBody(RAPIER.RigidBodyDesc.fixed()));
  const bp={schemaVersion:4,id:label,name:label,parts};
  const v=new RuntimeVehicle(world,bp,getPartDef,deriveConnections(bp,getPartDef),{translation:{x:0,y:1.4,z:0}});
  const dt=1/60,surfaceOf=()=>'asphalt';
  for(let i=0;i<90;i++){v.preStep(dt,{throttle:0,brake:1,steer:0,reverse:0},surfaceOf);world.step();v.postStepStability(dt);}
  let total=0,peak=0,maxOm=0;
  for(let i=0;i<300;i++){v.preStep(dt,controls,surfaceOf);world.step();v.postStepStability(dt);
    const y=v.body.angvel().y; total+=y*dt; peak=Math.max(peak,Math.abs(y));
    maxOm=Math.max(maxOm,...v.assembled.wheels.map(w=>Math.abs(w.omega)));}
  const lv=v.body.linvel();
  console.log(`${label.padEnd(20)} yaw=${(total*180/Math.PI).toFixed(0).padStart(6)}deg peak=${peak.toFixed(2).padStart(5)}rad/s maxBeltOmega=${maxOm.toFixed(0).padStart(4)} speed=${Math.hypot(lv.x,lv.z).toFixed(1)}`);
}
console.log('=== full steer + full throttle (5s) ===');
for(const [k,v] of Object.entries(rigs)) run(k,v,{throttle:1,brake:0,steer:1,reverse:0});
console.log('=== full steer, NO throttle (design says all-tread should pivot in place) ===');
for(const [k,v] of Object.entries(rigs)) run(k,v,{throttle:0,brake:0,steer:1,reverse:0});
