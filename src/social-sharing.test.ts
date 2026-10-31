import {describe,it,expect,vi,afterEach} from 'vitest';
import {canSharePhoto,sharePhoto,socialDestinations,shareCaption} from './social-sharing';
afterEach(()=>vi.unstubAllGlobals());
const file=()=>new File(['jpeg'],'portrait.jpg',{type:'image/jpeg'});
describe('file sharing capabilities',()=>{
 it('passes the original photo file to the native share menu',async()=>{const share=vi.fn().mockResolvedValue(undefined),canShare=vi.fn().mockReturnValue(true);vi.stubGlobal('navigator',{share,canShare});const image=file();await sharePhoto(image);expect(canShare).toHaveBeenCalledWith({files:[image]});expect(share).toHaveBeenCalledWith({files:[image],title:'My professional portrait',text:shareCaption});expect(share.mock.calls[0][0]).not.toHaveProperty('url');});
 it('rejects unsupported file sharing without opening a text/link-only sheet',async()=>{const share=vi.fn();vi.stubGlobal('navigator',{share,canShare:()=>false});expect(canSharePhoto(file())).toBe(false);await expect(sharePhoto(file())).rejects.toThrow('Download');expect(share).not.toHaveBeenCalled();});
 it('handles browsers where the capability check throws',()=>{vi.stubGlobal('navigator',{share:vi.fn(),canShare:()=>{throw new Error('blocked');}});expect(canSharePhoto(file())).toBe(false);});
 it('does not put private image URLs or IDs into platform destinations',()=>{for(const destination of socialDestinations){if(!destination.url)continue;const url=new URL(destination.url);expect(url.protocol).toBe('https:');expect(url.href).not.toContain('portrait=');expect(url.href).not.toContain('/api/');expect(url.href).not.toContain('localhost');expect(url.href).not.toContain('supabase');}expect(new URL(socialDestinations[0].url!).searchParams.get('text')).toBe(shareCaption);});
});
