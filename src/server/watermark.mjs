import sharp from 'sharp';
// Vector letter outlines keep the watermark visible even on hosts without fonts.
const glyphs={F:'M0 28V0H18 M0 13H15',O:'M10 0Q0 0 0 10V18Q0 28 10 28Q20 28 20 18V10Q20 0 10 0Z',R:'M0 28V0H10Q20 0 20 8Q20 15 10 15H0 M10 15L21 28',M:'M0 28V0L11 17L22 0V28',A:'M0 28L11 0L22 28 M4 18H18',P:'M0 28V0H10Q20 0 20 8Q20 15 10 15H0',E:'M18 0H0V28H18 M0 14H15',V:'M0 0L11 28L22 0',I:'M0 0H14 M7 0V28 M0 28H14',W:'M0 0L6 28L14 10L22 28L28 0'};
function lettering(){let x=0;return [...'FORMA PREVIEW'].map(letter=>{if(letter===' '){x+=18;return '';}const path=`<path d="${glyphs[letter]}" transform="translate(${x} 0)"/>`;x+=29;return path;}).join('');}
export async function watermarkPreview(original){
 const resized=await sharp(original).rotate().resize({width:600,height:900,fit:'inside',withoutEnlargement:true}).toBuffer();
 const {width,height}=await sharp(resized).metadata();
 const scale=Math.min(width/600,height/900);
 const marks=lettering();
 const overlay=Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}"><defs><pattern id="mark" width="270" height="130" patternUnits="userSpaceOnUse" patternTransform="rotate(-25) scale(${scale})"><g transform="translate(8 48) scale(.7)" fill="none" stroke-linecap="round" stroke-linejoin="round"><g stroke="black" stroke-width="5" opacity=".24">${marks}</g><g stroke="white" stroke-width="2.5" opacity=".62">${marks}</g></g></pattern></defs><rect width="100%" height="100%" fill="url(#mark)"/></svg>`);
 return sharp(resized).composite([{input:overlay}]).jpeg({quality:75}).toBuffer();
}
