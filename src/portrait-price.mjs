// One-time price per watermark-free portrait, in the currency's minor unit.
export const portraitPrice={amount:399,currency:'cad',label:'CA$3.99'};
export const packagePrice={amount:549,currency:'cad',label:'CA$5.49',generations:5,unlocks:2};

export const starterPackagePrice={amount:449,currency:'cad',label:'CA$4.49',generations:3,unlocks:1};
/** @type {Array<{id:'starter'|'plus',name:string,amount:number,currency:string,label:string,generations:number,unlocks:number}>} */
export const creditPackages=[{id:'starter',name:'Starter',...starterPackagePrice},{id:'plus',name:'Plus',...packagePrice}];
