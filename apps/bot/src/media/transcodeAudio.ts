import { spawn } from "child_process";
import { logger } from "../logger";

/**
 * Ubah audio APAPUN formatnya (webm/mp3/m4a/wav/dst - tergantung apa yang diunggah petugas
 * lewat dashboard) jadi OGG/Opus - format yang WhatsApp harapkan supaya pesan suara tampil
 * sebagai bubble "pesan suara" beneran (gelombang + tombol putar besar), bukan lampiran audio
 * biasa. Dijalankan lewat ffmpeg yang sudah terpasang di server (bukan library Node - lebih
 * ringan daripada nambah dependency npm besar cuma untuk ini).
 */
export function transcodeToOggOpus(input: Buffer): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const ffmpeg = spawn("ffmpeg", [
      "-i", "pipe:0",
      "-vn",
      "-c:a", "libopus",
      "-b:a", "32k",
      "-ar", "48000",
      "-f", "ogg",
      "pipe:1",
    ]);

    const chunks: Buffer[] = [];
    const errChunks: Buffer[] = [];
    ffmpeg.stdout.on("data", (d: Buffer) => chunks.push(d));
    ffmpeg.stderr.on("data", (d: Buffer) => errChunks.push(d));
    ffmpeg.on("error", (err) => reject(err));
    ffmpeg.on("close", (code) => {
      if (code === 0 && chunks.length > 0) {
        resolve(Buffer.concat(chunks));
      } else {
        const stderr = Buffer.concat(errChunks).toString("utf8").slice(-500);
        logger.warn({ code, stderr }, "ffmpeg gagal mengubah audio ke OGG/Opus");
        reject(new Error(`ffmpeg exit code ${code}`));
      }
    });

    ffmpeg.stdin.write(input);
    ffmpeg.stdin.end();
  });
}
