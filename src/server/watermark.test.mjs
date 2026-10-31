import {describe,it,expect} from 'vitest';
import sharp from 'sharp';
import {watermarkPreview} from './watermark.mjs';
describe('server-rendered watermark',()=>{
 it('renders visible marks into lower-resolution JPEG pixels while preserving original bytes',async()=>{
  const original=await sharp({create:{width:1024,height:1536,channels:3,background:'#78817b'}}).jpeg().toBuffer();const before=Buffer.from(original);
  const preview=await watermarkPreview(original);const metadata=await sharp(preview).metadata();expect(metadata.width).toBe(600);expect(metadata.height).toBe(900);expect(metadata.format).toBe('jpeg');expect(original.equals(before)).toBe(true);
  const {channels}=await sharp(preview).metadata();const pixels=await sharp(preview).raw().toBuffer();let light=0,dark=0;for(let i=0;i<pixels.length;i+=channels){if(pixels[i]>145)light++;if(pixels[i]<115)dark++;}expect(light).toBeGreaterThan(1000);expect(dark).toBeGreaterThan(1000);
 });
});
