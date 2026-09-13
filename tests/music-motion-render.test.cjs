const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');

test('Actual FFmpeg render preserves the source soundtrack, timings, logo and subtitles', { timeout:120000 }, async () => {
  const { Workspace, run, renderMovie, probe } = await import('../local-agent/music-motion-engine.mjs');
  const root = await fs.mkdtemp(path.join(os.tmpdir(),'mm-render-'));
  try {
    const w=await new Workspace(path.join(root,'store')).init();
    const audio=path.join(root,'tone.wav'), clip=path.join(root,'clip.mp4'), logo=path.join(root,'logo.png');
    await run('ffmpeg',['-v','error','-f','lavfi','-i','sine=frequency=440:duration=3','-c:a','pcm_s16le',audio]);
    await run('ffmpeg',['-v','error','-f','lavfi','-i','testsrc2=size=320x180:rate=25:duration=2','-f','lavfi','-i','sine=frequency=880:duration=2','-shortest','-c:v','libx264','-preset','ultrafast','-pix_fmt','yuv420p','-c:a','aac',clip]);
    await run('ffmpeg',['-v','error','-f','lavfi','-i','color=c=white:s=32x32','-frames:v','1','-threads','1',logo]);
    const a=await w.putAsset(await fs.readFile(audio),'source.wav'),v=await w.putAsset(await fs.readFile(clip),'input.mp4'),l=await w.putAsset(await fs.readFile(logo),'logo.png');
    const result=await renderMovie(w,{audio_id:a.id,duration_seconds:3,fps:25,height:720,format:'16:9',shots:[{asset_id:v.id,start:0,end:1.5,source_in:0,transition:'cut'},{asset_id:v.id,start:1.5,end:3,source_in:.5,transition:'fade'}],subtitles:true,lyrics_validated:true,segments:[{start:0,end:1.4,text:'Test de synchronisation'},{start:1.5,end:2.9,text:'Source originale conservée'}],logo_id:l.id});
    assert.equal(result.kind,'assembled-video');assert.equal(result.audio_sha256,a.sha256);assert.ok(result.has_audio&&result.has_video);assert.ok(Math.abs(result.duration_seconds-3)<.1);assert.equal(result.width,1280);
    // Distinguish original 440 Hz audio from generated video's 880 Hz soundtrack.
    const out=await run('ffmpeg',['-v','error','-i',(await w.asset(result.id)).path,'-vn','-ac','1','-ar','8000','-f','f32le','pipe:1']);
    const samples=new Float32Array(out.stdout.buffer,out.stdout.byteOffset,Math.floor(out.stdout.byteLength/4));let crossings=0;
    for(let i=1;i<samples.length;i++)if(samples[i-1]<0&&samples[i]>=0)crossings++;
    assert.ok(crossings/3>420&&crossings/3<460,`Wrong soundtrack: ${crossings/3} Hz`);
    await assert.rejects(()=>renderMovie(w,{audio_id:a.id,duration_seconds:3,fps:25,shots:[{asset_id:l.id,start:0,end:3}]}),/animatique/);
    if(process.env.MUSIC_MOTION_TEST_ARTIFACT_DIR){await fs.mkdir(process.env.MUSIC_MOTION_TEST_ARTIFACT_DIR,{recursive:true});await fs.copyFile((await w.asset(result.id)).path,path.join(process.env.MUSIC_MOTION_TEST_ARTIFACT_DIR,'synthetic-render.mp4'));await fs.writeFile(path.join(process.env.MUSIC_MOTION_TEST_ARTIFACT_DIR,'render-proof.json'),JSON.stringify({duration:result.duration_seconds,width:result.width,height:result.height,source_audio_frequency:440,measured_zero_crossing_frequency:crossings/3,kind:result.kind},null,2));}
  } finally { await fs.rm(root,{recursive:true,force:true}); }
});
