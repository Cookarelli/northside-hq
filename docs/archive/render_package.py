#!/usr/bin/env python3
"""Render a Northside editing recipe with local originals and FFmpeg. No network calls."""
import argparse,csv,json,math,re,shutil,subprocess,sys
from pathlib import Path

def safe(value):
    return re.sub(r'[^a-zA-Z0-9_]+','_',str(value)).strip('_')[:90] or 'item'
def finite(value):
    return isinstance(value,(int,float)) and not isinstance(value,bool) and math.isfinite(value)
def run(args):
    subprocess.run(args,check=True)
def stamp(t):
    ms=round(max(0,t)*1000);h,ms=divmod(ms,3600000);m,ms=divmod(ms,60000);s,ms=divmod(ms,1000)
    return f'{h:02}:{m:02}:{s:02},{ms:03}'
def main():
    p=argparse.ArgumentParser(description=__doc__)
    p.add_argument('recipe',type=Path);p.add_argument('--source',type=Path,required=True);p.add_argument('--output',type=Path,default=Path('northside_exports'))
    p.add_argument('--photos',type=Path,help='Optional folder of edited JPG, PNG or WebP images')
    p.add_argument('--profiles',default='vertical,feed,square,landscape');p.add_argument('--durations',default='15,30,60');p.add_argument('--dry-run',action='store_true')
    a=p.parse_args()
    if not a.source.is_file():p.error('Source video does not exist.')
    for exe in ['ffmpeg','ffprobe']:
        if not shutil.which(exe):p.error(exe+' is required. Install FFmpeg on your Mac first.')
    spec=json.loads(a.recipe.read_text());profiles={r['id']:r for r in spec['profiles']}
    chosen=a.profiles.split(',')
    if any(x not in profiles for x in chosen):p.error('Unknown export profile.')
    for r in profiles.values():
        if not all(isinstance(r.get(k),int) and 16<=r[k]<=4096 and r[k]%2==0 for k in ['width','height']):p.error('Invalid profile dimensions.')
    try:durations=sorted(set(int(x) for x in a.durations.split(',')))
    except ValueError:p.error('Durations must be 15, 30 or 60.')
    if any(x not in [15,30,60] for x in durations):p.error('Durations must be 15, 30 or 60.')
    probe=json.loads(subprocess.check_output(['ffprobe','-v','error','-show_format','-show_streams','-of','json',str(a.source.resolve())]))
    actual=float(probe['format']['duration'])
    if not any(s.get('codec_type')=='video' for s in probe['streams']):p.error('Source needs a video stream.')
    approved=[c for c in spec['clips'] if c.get('approved')]
    if not approved:p.error('No approved clips.')
    for c in approved:
        if not finite(c.get('start')) or not finite(c.get('end')) or c['start']<0 or c['end']<=c['start'] or c['end']>actual+.05:p.error('Clip boundaries exceed the actual video duration.')
    segments=spec.get('transcript',[])
    if any(not finite(s.get('start')) or not finite(s.get('end')) or s['end']<=s['start'] or not isinstance(s.get('text'),str) for s in segments):p.error('Invalid transcript segments.')
    if not a.dry_run:
        if a.output.exists() and any(a.output.iterdir()):p.error('Output folder must be empty. Choose a new folder to keep earlier exports safe.')
        a.output.mkdir(parents=True,exist_ok=True)
    commands=[];outputs=[];skips=[]
    for i,c in enumerate(approved,1):
        for length in durations:
            if length>c['end']-c['start']+.01:skips.append(f'Clip {i}: {length}s skipped; outside approved interval.');continue
            anchor=c.get('triggerTime')
            start=c['start']
            if finite(anchor):start=max(c['start'],min(anchor-(5 if length==15 else 10),c['end']-length))
            for profile in chosen:
                r=profiles[profile];w,h=r['width'],r['height'];name=f'{safe(spec.get("campaign","northside"))}_clip{i:02}_{length}s_{profile}_v01'
                out=a.output/(name+'.mp4')
                vf=f'scale={w}:{h}:force_original_aspect_ratio=decrease:force_divisible_by=2,pad={w}:{h}:(ow-iw)/2:(oh-ih)/2:color=black,setsar=1'
                cmd=['ffmpeg','-hide_banner','-loglevel','error','-n','-ss',str(start),'-i',str(a.source.resolve()),'-t',str(length),'-map','0:v:0','-map','0:a:0?','-vf',vf,'-c:v','libx264','-preset','fast','-crf','20','-pix_fmt','yuv420p','-c:a','aac','-b:a','192k','-movflags','+faststart',str(out)]
                commands.append(cmd)
                if not a.dry_run:
                    run(cmd)
                    cues=[]
                    for seg in segments:
                        s=max(seg['start'],start);e=min(seg['end'],start+length)
                        if e>s:cues.append(f'{len(cues)+1}\n{stamp(s-start)} --> {stamp(e-start)}\n{seg["text"]}\n')
                    (a.output/(name+'.srt')).write_text('\n'.join(cues))
                    run(['ffmpeg','-hide_banner','-loglevel','error','-n','-ss','1','-i',str(out),'-frames:v','1','-q:v','2',str(a.output/(name+'.jpg'))])
                    (a.output/(name+'_caption.txt')).write_text(c.get('caption') or 'Caption requires editorial review. Verify the card, player, set and claim before publishing.')
                outputs.append({'file':out.name,'seconds':length,'profile':profile,'start':start,'clip':i,'platforms':r['platforms']})
    if a.photos:
        if not a.photos.is_dir():p.error('Photos folder does not exist.')
        for i,photo in enumerate(sorted(x for x in a.photos.iterdir() if x.suffix.lower() in ['.jpg','.jpeg','.png','.webp']),1):
            for profile in chosen:
                r=profiles[profile];w,h=r['width'],r['height'];out=a.output/f'photo{i:02}_{safe(photo.stem)}_{profile}.jpg'
                cmd=['ffmpeg','-hide_banner','-loglevel','error','-n','-i',str(photo.resolve()),'-vf',f'scale={w}:{h}:force_original_aspect_ratio=decrease,pad={w}:{h}:(ow-iw)/2:(oh-ih)/2:color=black','-frames:v','1','-q:v','2',str(out)]
                commands.append(cmd)
                if not a.dry_run:run(cmd)
                outputs.append({'file':out.name,'profile':profile,'kind':'photo','platforms':r['platforms']})
    if a.dry_run:
        print(json.dumps({'commands':commands,'skipped':skips,'outputs':outputs},indent=2));return
    if not outputs:p.error('No versions fit the approved windows. Widen reviewed intervals or use a suitable original.')
    (a.output/'manifest.json').write_text(json.dumps({'recipe':spec,'outputs':outputs,'skipped':skips,'status':'rendered_needs_review'},indent=2))
    with (a.output/'publishing_manifest.csv').open('w',newline='') as f:
        writer=csv.writer(f);writer.writerow(['file','platform','destination_url','caption_draft','status'])
        for out in outputs:
            for platform in out['platforms']:
                link=next((l for l in spec.get('links',[]) if l.get('platform')==platform),{})
                caption=approved[out['clip']-1].get('caption','') if out.get('clip') else ''
                url=link.get('url','')
                # Keep per-variant identity on links, including clip, duration and format.
                from urllib.parse import urlsplit,urlunsplit,parse_qsl,urlencode
                if url:
                    u=urlsplit(url);query=dict(parse_qsl(u.query));query['utm_content']=Path(out['file']).stem;url=urlunsplit((u.scheme,u.netloc,u.path,urlencode(query),u.fragment))
                row=[out['file'],platform,url,caption or link.get('captionDraft',''),'review']
                writer.writerow(["'"+v if isinstance(v,str) and v.startswith(('=','+','-','@')) else v for v in row])
    (a.output/'README.txt').write_text('Review every video, subtitle, thumbnail, caption and link before publishing. MP4 files are H.264/AAC where source audio exists. Full source framing is preserved with padding. Subtitles are sidecar SRT files, not burned in. Music, sound, graphic overlays, AI speech recognition, cropping and public posting are not added by this renderer. The publishing manifest assigns a unique utm_content per exported file.\n'+'\n'.join(skips))
    print(f'Rendered {len(outputs)} media files to {a.output.resolve()}. Review before publishing.')
    for s in skips:print(s)
if __name__=='__main__':
    try:main()
    except (ValueError,KeyError,subprocess.CalledProcessError) as e:print('Rendering stopped: '+str(e),file=sys.stderr);sys.exit(1)
