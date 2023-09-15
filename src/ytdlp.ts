import { UploadedObjectInfo, Client } from 'minio'
import { spawn } from 'child_process'
import { path as ffmpegPath } from "@ffmpeg-installer/ffmpeg";
import fs from "fs/promises";
import { ReadStream } from 'fs';

const MINIO_CLIENT = new Client({
  endPoint: process.env.MINIO_ADDRESS ?? 'localhost',
  port: parseInt(process.env.MINIO_PORT ?? '9000', 10),
  useSSL: false,
  accessKey: process.env.MINIO_ACCESS_KEY ?? "",    // Replace with your actual access key
  secretKey: process.env.MINIO_SECRET_KEY ?? "",    // Replace with your actual secret key
});

const MINIO_BUCKET = process.env.MINIO_BUCKET ?? "ytvideos";

// Creating bucket if it doesn't exist
(async () => {
  try {
    await MINIO_CLIENT.makeBucket(MINIO_BUCKET)
  } catch (err) {
    // Ignore
  }

  try {
    // Make bucket public and accessible by anyone
    await MINIO_CLIENT.setBucketPolicy(MINIO_BUCKET, JSON.stringify({
      Version: '2012-10-17',
      Statement: [
        {
          "Effect": "Allow",
          "Principal": "*",
          "Action": "s3:GetObject",
          "Resource": `arn:aws:s3:::${MINIO_BUCKET}/*`
        },
      ],
    }));
  } catch (err) {
    throw new Error(`Failed to set bucket policy: ${err}`);
  }
})();

// @ignore
/* async function fileExists(fileName: string): Promise<boolean> {
  try {
    fs.access(fileName);
    return true;
  } catch (err) {
    return false;
  }
} */

async function fileExistsOnS3(fileName: string): Promise<boolean> {
  try {
    const obj = await MINIO_CLIENT.statObject(MINIO_BUCKET, fileName);
    return obj !== null && obj !== undefined;
  } catch (err) {
    return false;
  }
}

/**
 * @returns The url path to the video file.
 */
async function uploadVideo(fileName: string, stream: ReadStream): Promise<UploadedObjectInfo> {
  return MINIO_CLIENT.putObject(MINIO_BUCKET, fileName, stream, {
    id: fileName,
    "Content-Type": "video/webm",
  });
}

function getObjectUrl(fileName: string): string {
    /// return MINIO_CLIENT.presignedGetObject(MINIO_BUCKET, fileName)
    return `http://${process.env.MINIO_ADDRESS}:${process.env.MINIO_PORT}/${MINIO_BUCKET}/${fileName}`
}

async function downloadVideo(videoUrl: string): Promise<string> {
  return new Promise((resolve, reject) => {
    let executable = "bin/yt-dlp_linux"
    if (process.platform === "win32") {
      executable = "bin/yt-dlp.exe"
    }

    const ytdlpProcess = spawn(executable, [
      "--ffmpeg-location", `${ffmpegPath}`,
      "-f", "bestvideo*+bestaudio/best", // Best video and audio
      "--output", "temp/%(id)s", // Output to temp folder
      "--merge-output-format", "webm", // Merge video and audio into webm
      "--print-json", // Output json
      videoUrl,
    ])

    let ytdlpOutput = "";
    ytdlpProcess.stdout.on('data', (data) => {
      ytdlpOutput += data;
    });

    ytdlpProcess.stderr.on('data', (data) => {
      console.error(`ytdlp error: ${data}`);
    });

    // Handle process exit
    ytdlpProcess.on('close', (code) => {
      if (code === 0) {
        // Download completed successfully
        resolve(ytdlpOutput);
      } else {
        // Download failed
        reject(new Error(`ytdlp exited with code ${code}`));
      }
    });
  });
}

const ALREADY_DOWNLOADING: {
  [videoId: string]: Promise<string>
} = {}

export default async function processYTDLPRequest(videoUrl: string): Promise<string> {
  // Parse url to get the video id
  const videoId = videoUrl.split("v=")[1].split("&")[0];
  if (videoId === undefined) {
    throw new Error("Invalid video url");
  }
  
  const videoAlreadyDownloaded = await fileExistsOnS3(videoId);

  if (videoAlreadyDownloaded) {
    return getObjectUrl(videoId);
  }

  // Check if video is already downloaded locally
  ALREADY_DOWNLOADING[videoId] = ALREADY_DOWNLOADING[videoId] ?? new Promise((resolve, reject) => {
    console.log("Starting download of video " + videoId)
    downloadVideo(videoUrl).then((ytdlpOutput) => {
      const ytdlpData = JSON.parse(ytdlpOutput);
      if (ytdlpData === undefined) {
        throw new Error("ytdlp returned invalid json");
      }

      // Get the name file name of the video
      fs.open(`temp/${videoId}.webm`, "r").then(async file => {
        return uploadVideo(videoId, file.createReadStream());
      }).then(() => {
        return getObjectUrl(videoId);
      }).then((url) => {
        resolve(url);
      }).catch((err) => {
        console.error(`Failed to upload video ${videoId}: ${err}`);
        reject(err);
      });
    });
  });

  return ALREADY_DOWNLOADING[videoId];
}
