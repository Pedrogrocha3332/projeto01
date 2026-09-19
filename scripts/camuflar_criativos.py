#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Script de Camuflagem Perceptual Suprema (Anti-Duplicação Meta/Instagram)
======================================================================
Transforma vídeos brutos em arquivos com assinaturas e matrizes de pixels
matematicamente únicas para a Meta Graph API, anulando o algoritmo PDQ Hash,
TMK e Content ID.

Aplica:
1. Micro-trim de 0.2s a 0.4s no início (destrói I-Frames e fingerprint temporal).
2. Micro-rotação angular de -0.25° a +0.25° com zoom 1.025x (anula PDQ Hash de pixels).
3. Micro-equalização de contraste, saturação e ruído temporal imperceptível.
4. Trend Hijacking: Injeção de áudio em alta a 1% de volume (indexação ACRCloud).
5. Limpeza profunda de metadados (-map_metadata -1).
6. Injeção de assinatura binária única (SHA-256 / MD5 único por arquivo).

Uso:
  python camuflar_criativos.py --input ./videos_brutos --output ./videos_camuflados
"""

import os
import sys
import glob
import math
import random
import shutil
import argparse
import subprocess

def find_ffmpeg():
    """Tenta localizar o binário do FFmpeg no sistema ou via imageio_ffmpeg."""
    try:
        import imageio_ffmpeg
        return imageio_ffmpeg.get_ffmpeg_exe()
    except ImportError:
        pass
    
    # Procura no PATH
    exe = shutil.which("ffmpeg")
    if exe:
        return exe
        
    print("❌ ERRO: FFmpeg não encontrado!")
    print("👉 Instale via: pip install imageio_ffmpeg")
    print("   Ou garanta que o 'ffmpeg' esteja acessível no PATH do sistema.")
    sys.exit(1)

def transform_video(ffmpeg_exe, input_path, output_path, trend_dir=None):
    """Aplica a camuflagem perceptual completa no arquivo de vídeo."""
    try:
        # 1. Micro-Trim Dinâmico (Corta 0.2s a 0.4s do início para destruir I-frames)
        trim_start = round(random.uniform(0.2, 0.4), 2)
        
        # 2. Micro-Rotação Angular de Matriz (-0.25° a +0.25°) + Zoom Proporcional 1.025x
        angle_deg = random.choice([-0.25, -0.15, 0.15, 0.25])
        angle_rad = angle_deg * math.pi / 180.0
        
        # 3. Micro-Equalização e Ruído Temporal
        contrast = round(1.0 + random.uniform(0.006, 0.014), 4)
        brightness = round(random.uniform(0.001, 0.003), 4)
        saturation = round(1.0 + random.uniform(0.004, 0.010), 4)
        noise_val = random.randint(2, 4)
        
        vf_filter = (
            f"scale=iw*1.025:ih*1.025,"
            f"rotate={angle_rad}:fillcolor=black:ow='iw':oh='ih',"
            f"crop=iw/1.025:ih/1.025,"
            f"eq=contrast={contrast}:brightness={brightness}:saturation={saturation},"
            f"noise=alls={noise_val}:allf=t+u,"
            f"setpts=PTS-STARTPTS"
        )
        
        # 4. Checagem de Áudio Trend (Volume a 1% para indexação ACRCloud)
        trend_audio_file = None
        if trend_dir and os.path.exists(trend_dir):
            candidates = [
                os.path.join(trend_dir, f) for f in os.listdir(trend_dir)
                if f.lower().endswith(('.mp3', '.m4a', '.wav', '.aac'))
            ]
            if candidates:
                trend_audio_file = random.choice(candidates)
        
        cmd = [ffmpeg_exe, "-y", "-ss", str(trim_start), "-i", input_path]
        
        if trend_audio_file and os.path.exists(trend_audio_file):
            cmd.extend(["-i", trend_audio_file])
            filter_complex = (
                f"[0:v]{vf_filter}[vout];"
                f"[1:a]volume=0.01[trend];"
                f"[0:a][trend]amix=inputs=2:duration=first:dropout_transition=2,"
                f"pan=stereo|c0=c0+0.001*c1|c1=c1-0.001*c0,asetrate=44100*1.001,aresample=44100[aout]"
            )
            cmd.extend([
                "-filter_complex", filter_complex,
                "-map", "[vout]",
                "-map", "[aout]"
            ])
        else:
            af_filter = "pan=stereo|c0=c0+0.001*c1|c1=c1-0.001*c0,asetrate=44100*1.001,aresample=44100"
            cmd.extend([
                "-vf", vf_filter,
                "-af", af_filter
            ])
            
        cmd.extend([
            "-map_metadata", "-1",
            "-c:v", "libx264",
            "-preset", "fast",
            "-crf", "18",
            "-c:a", "aac",
            "-b:a", "192k",
            "-pix_fmt", "yuv420p",
            "-movflags", "+faststart",
            "-aspect", "9:16",
            output_path
        ])
        
        res = subprocess.run(cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True, timeout=180)
        if res.returncode == 0 and os.path.exists(output_path) and os.path.getsize(output_path) > 1000:
            # 5. Injeção de Assinatura Binária Aleatória no final do arquivo (MD5/SHA único)
            with open(output_path, "ab") as f:
                f.write(os.urandom(random.randint(16, 64)))
            return True
        else:
            if res.stderr:
                print(f"⚠️ Aviso FFmpeg: {res.stderr[-300:]}")
            return False
    except Exception as e:
        print(f"❌ Erro ao processar vídeo {input_path}: {e}")
        return False

def main():
    parser = argparse.ArgumentParser(description="Camuflagem Perceptual de Vídeos para Reels")
    parser.add_argument("--input", "-i", default="videos_brutos", help="Pasta com vídeos originais .mp4")
    parser.add_argument("--output", "-o", default="videos_camuflados", help="Pasta para salvar vídeos camuflados")
    parser.add_argument("--trend", "-t", default="audios_trend", help="Pasta opcional com músicas trends (.mp3)")
    args = parser.parse_args()

    ffmpeg_exe = find_ffmpeg()
    print(f"🔧 Usando FFmpeg: {ffmpeg_exe}")

    if not os.path.exists(args.input):
        os.makedirs(args.input, exist_ok=True)
        print(f"📁 Pasta de entrada '{args.input}' criada. Coloque seus vídeos lá dentro e execute novamente.")
        return

    os.makedirs(args.output, exist_ok=True)

    videos = glob.glob(os.path.join(args.input, "*.mp4")) + glob.glob(os.path.join(args.input, "*.mov"))
    if not videos:
        print(f"⚠️ Nenhum vídeo encontrado em '{args.input}'.")
        return

    print(f"🚀 Iniciando camuflagem de {len(videos)} vídeos...")
    success_count = 0

    for idx, vid in enumerate(videos, 1):
        filename = os.path.basename(vid)
        name, ext = os.path.splitext(filename)
        out_name = f"{name}_camuflado_{random.randint(1000, 9999)}.mp4"
        out_path = os.path.join(args.output, out_name)

        print(f"[{idx}/{len(videos)}] Processando {filename} -> {out_name}...")
        ok = transform_video(ffmpeg_exe, vid, out_path, trend_dir=args.trend)
        if ok:
            success_count += 1
            print(f"  ✅ Concluído com sucesso! (Tamanho: {os.path.getsize(out_path) / (1024*1024):.2f} MB)")
        else:
            print(f"  ❌ Falha ao camuflar {filename}")

    print(f"\n🎉 Processamento concluído! {success_count}/{len(videos)} vídeos camuflados prontos em '{args.output}'.")

if __name__ == "__main__":
    main()
