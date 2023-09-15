import express from "express";
import cors from "cors";
import ytdlp from "./ytdlp";

const app = express();
app.use(express.json());

const ALLOWED_ORIGINS = (process.env.CORS ?? "http://localhost:3000").split(", ");
app.use(cors({
  origin: (origin, callback) => {
    if (origin === undefined || ALLOWED_ORIGINS.includes(origin)) {
      callback(null, true);
    } else {
      callback(new Error("Not allowed by CORS"));
    }
  }
}))

// Get request
// videoUrl: string
// Returns: string
app.get("/download", async (req, res) => {
  const videoId = req.query.videoId as string;
  const videoUrl = videoId === undefined ? req.query.videoUrl as string : `https://youtube.com/watch?v=${videoId}`;

  if (videoUrl === undefined) {
    throw new Error("Invalid video url");
  }

  const video = await ytdlp(videoUrl);

  res.send(video);
});

const PORT = process.env.PORT ?? 3000;

app.listen(PORT, () => {
  console.log(`Server is listening on port ${PORT}`);
});
