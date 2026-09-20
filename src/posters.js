import fs from "fs";
import path from "path";
import { spawn } from "child_process";
import ffmpegPath from "ffmpeg-static";

import {
  getMessage,
  streamMessage
} from "./telegram.js";

const posterDir = path.resolve("./data/posters");

if (!fs.existsSync(posterDir)) {
  fs.mkdirSync(posterDir, { recursive: true });
}

export async function generatePoster(messageId) {
  const outputPath = path.join(
    posterDir,
    `${messageId}.jpg`
  );

  // Already generated
  if (fs.existsSync(outputPath)) {
    return outputPath;
  }

  const message = await getMessage(messageId);

  if (!message) {
    throw new Error(
      `Telegram message ${messageId} not found`
    );
  }

  console.log(
    `Generating poster for ${messageId} at 00:02:30`
  );

  return new Promise(async (resolve, reject) => {
    let finished = false;

    const ffmpeg = spawn(ffmpegPath, [
      "-hide_banner",
      "-loglevel",
      "error",

      // Read video from stdin
      "-i",
      "pipe:0",

      // Exactly 2 minutes 30 seconds
      "-ss",
      "00:02:30",

      "-frames:v",
      "1",

      "-q:v",
      "2",

      "-vf",
      "scale=1280:-2",

      "-y",
      outputPath
    ]);

    ffmpeg.stderr.on(
      "data",
      data => {
        console.log(
          "FFmpeg:",
          data.toString()
        );
      }
    );

    ffmpeg.on(
      "error",
      error => {
        if (finished) return;

        finished = true;

        reject(error);
      }
    );

    ffmpeg.on(
      "close",
      code => {
        if (finished) return;

        finished = true;

        if (
          code === 0 &&
          fs.existsSync(outputPath)
        ) {
          console.log(
            `Poster generated: ${outputPath}`
          );

          resolve(outputPath);
        } else {
          reject(
            new Error(
              `FFmpeg poster generation failed. code=${code}`
            )
          );
        }
      }
    );

    try {
      // Stream Telegram video into FFmpeg.
      // No random seeking on the original MKV.
      const stream =
        await streamMessage(
          message,
          0,
          null
        );

      for await (
        const chunk of stream
      ) {
        if (
          finished ||
          ffmpeg.stdin.destroyed
        ) {
          break;
        }

        const canContinue =
          ffmpeg.stdin.write(chunk);

        if (!canContinue) {
          await new Promise(
            resolve =>
              ffmpeg.stdin.once(
                "drain",
                resolve
              )
          );
        }
      }

      if (
        !ffmpeg.stdin.destroyed
      ) {
        ffmpeg.stdin.end();
      }

    } catch (error) {
      if (!finished) {
        finished = true;

        try {
          ffmpeg.kill("SIGKILL");
        } catch {}

        reject(error);
      }
    }
  });
}
