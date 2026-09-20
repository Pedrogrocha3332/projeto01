const WebSocket = require('ws');
global.WebSocket = WebSocket;

const { createClient } = require('@supabase/supabase-js');
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const crypto = require('crypto');


const SUPABASE_URL = 'https://nrokcurppdvhbadpigql.supabase.co';
const SUPABASE_SERVICE_ROLE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im5yb2tjdXJwcGR2aGJhZHBpZ3FsIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc4OTgxOTMyMSwiZXhwIjoyMTA1Mzk1MzIxfQ.olGCely3gaYgQ4uQY5rjQn2keH4TX1Ta4OS3zdGDteI';

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
  realtime: { createWebSocket: () => null }
});


const DIR_TREND = '/opt/camuflador/audios_trend';

function log(msg) {
  const ts = new Date().toISOString().replace('T', ' ').slice(0, 19);
  console.log(`[${ts}] ${msg}`);
}

function runFFmpeg(cmdArgs) {
  return new Promise((resolve, reject) => {
    const ff = spawn('ffmpeg', cmdArgs);
    let stderr = '';
    ff.stderr.on('data', d => { stderr += d.toString(); });
    ff.on('close', code => {
      if (code === 0) resolve();
      else reject(new Error(`FFmpeg falhou com código ${code}: ${stderr.slice(-300)}`));
    });
  });
}

function getRandomTrendAudio() {
  try {
    if (!fs.existsSync(DIR_TREND)) return null;
    const files = fs.readdirSync(DIR_TREND).filter(f => /\.(mp3|m4a|wav|aac|ogg)$/i.test(f));
    if (files.length === 0) return null;
    const picked = files[Math.floor(Math.random() * files.length)];
    return path.join(DIR_TREND, picked);
  } catch (e) {
    return null;
  }
}

async function processVideo(asset) {
  const startTime = Date.now();
  log(`🎬 Detectado vídeo pendente: "${asset.file_name}" (ID: ${asset.id})`);

  // Marca como processando
  await supabase
    .from('media_assets')
    .update({ tags: ['processando_camuflagem'] })
    .eq('id', asset.id);

  const tmpInput = `/tmp/in_${asset.id}.mp4`;
  const tmpOutput = `/tmp/out_${asset.id}.mp4`;

  try {
    // 1. Download do Supabase Storage
    log(`📥 Baixando do Storage: ${asset.storage_path}...`);
    const { data: fileBlob, error: dlErr } = await supabase.storage
      .from('media')
      .download(asset.storage_path);

    if (dlErr || !fileBlob) throw new Error(`Falha ao baixar do Storage: ${dlErr?.message}`);
    const buffer = Buffer.from(await fileBlob.arrayBuffer());
    fs.writeFileSync(tmpInput, buffer);

    // 2. Parâmetros aleatórios de camuflagem
    const trimStart = (0.20 + Math.random() * 0.15).toFixed(2); // 0.20s a 0.35s
    const angles = [-0.22, -0.15, 0.15, 0.22];
    const angleDeg = angles[Math.floor(Math.random() * angles.length)];
    const angleRad = (angleDeg * Math.PI / 180.0).toFixed(5);
    const contrast = (1.0 + 0.006 + Math.random() * 0.008).toFixed(4);
    const brightness = (0.001 + Math.random() * 0.002).toFixed(4);
    const saturation = (1.0 + 0.004 + Math.random() * 0.006).toFixed(4);

    const vfFilter = [
      'scale=iw*1.025:ih*1.025',
      `rotate=${angleRad}:fillcolor=black:ow='iw':oh='ih'`,
      'crop=iw/1.025:ih/1.025',
      `eq=contrast=${contrast}:brightness=${brightness}:saturation=${saturation}`,
      'noise=alls=3:allf=t+u',
      'setpts=PTS-STARTPTS'
    ].join(',');

    const trendAudio = getRandomTrendAudio();

    const cmdArgs = ['-y', '-ss', String(trimStart), '-i', tmpInput];

    if (trendAudio) {
      log(`🎵 Injetando Trend Hijacking (1%): ${path.basename(trendAudio)}`);
      cmdArgs.push('-i', trendAudio);
      const filterComplex = [
        `[0:v]${vfFilter}[vout]`,
        `[1:a]volume=0.01[trend]`,
        `[0:a][trend]amix=inputs=2:duration=first:dropout_transition=2,pan=stereo|c0=c0+0.001*c1|c1=c1-0.001*c0,asetrate=44100*1.001,aresample=44100[aout]`
      ].join(';');
      cmdArgs.push('-filter_complex', filterComplex, '-map', '[vout]', '-map', '[aout]');
    } else {
      const afFilter = 'pan=stereo|c0=c0+0.001*c1|c1=c1-0.001*c0,asetrate=44100*1.001,aresample=44100';
      cmdArgs.push('-vf', vfFilter, '-af', afFilter);
    }

    cmdArgs.push(
      '-map_metadata', '-1',
      '-c:v', 'libx264',
      '-preset', 'veryfast',
      '-threads', '4',
      '-crf', '19',
      '-c:a', 'aac',
      '-b:a', '192k',
      '-pix_fmt', 'yuv420p',
      '-movflags', '+faststart',
      '-aspect', '9:16',
      tmpOutput
    );

    log(`⚡ Renderizando no FFmpeg com 4 vCPUs (Trim: ${trimStart}s | Ângulo: ${angleDeg}°)...`);
    await runFFmpeg(cmdArgs);

    // 3. Injeção de assinatura binária única aleatória no EOF
    const padding = crypto.randomBytes(32 + Math.floor(Math.random() * 64));
    fs.appendFileSync(tmpOutput, padding);

    const newSize = fs.statSync(tmpOutput).size;
    const newBuffer = fs.readFileSync(tmpOutput);

    // 4. Upload de volta para o Supabase Storage (substituindo o arquivo bruto)
    log(`📤 Enviando versão camuflada de volta para o Storage (${(newSize / (1024*1024)).toFixed(2)} MB)...`);
    const { error: upErr } = await supabase.storage
      .from('media')
      .upload(asset.storage_path, newBuffer, {
        upsert: true,
        contentType: 'video/mp4'
      });

    if (upErr) throw new Error(`Falha no upload pro Storage: ${upErr.message}`);

    // 5. Atualiza tags e tamanho no banco
    await supabase
      .from('media_assets')
      .update({
        tags: ['pronto', 'camuflado'],
        size_bytes: newSize
      })
      .eq('id', asset.id);

    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
    log(`✅ SUCESSO! Vídeo "${asset.file_name}" camuflado e pronto em ${elapsed}s! Selo verde ativado no painel.`);

  } catch (err) {
    log(`❌ Erro ao camuflar vídeo: ${err.message}`);
    await supabase
      .from('media_assets')
      .update({ tags: ['erro_camuflagem'] })
      .eq('id', asset.id);
  } finally {
    try { if (fs.existsSync(tmpInput)) fs.unlinkSync(tmpInput); } catch (e) {}
    try { if (fs.existsSync(tmpOutput)) fs.unlinkSync(tmpOutput); } catch (e) {}
  }
}

async function loop() {
  log('🚀 Worker de Camuflagem Autônoma VPS ativo e monitorando o Supabase 24/7...');
  while (true) {
    try {
      // Busca vídeos que estão marcados como pendente
      const { data: pending, error } = await supabase
        .from('media_assets')
        .select('id, file_name, storage_path, tags')
        .eq('media_kind', 'video')
        .contains('tags', ['pendente_camuflagem'])
        .limit(1);

      if (error) {
        log(`Erro ao consultar Supabase: ${error.message}`);
      } else if (pending && pending.length > 0) {
        await processVideo(pending[0]);
      }
    } catch (e) {
      log(`Exceção no loop: ${e.message}`);
    }

    await new Promise(r => setTimeout(r, 4000)); // Checa a cada 4 segundos
  }
}

loop();
