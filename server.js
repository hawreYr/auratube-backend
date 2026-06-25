const express = require('express');
const cors = require('cors');
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());

// Helper to sanitize a filename
function sanitize(title) {
  return title.replace(/[^a-z0-9]/gi, '_').toLowerCase();
}

app.get('/download', async (req, res) => {
  const videoUrl = req.query.url;
  if (!videoUrl || !videoUrl.includes('youtube.com/watch') && !videoUrl.includes('youtu.be/')) {
    return res.status(400).json({ error: 'Invalid YouTube URL' });
  }

  try {
    // First, get the video title (to use as filename)
    const titleProcess = spawn('yt-dlp', [
      '--get-title',
      '--no-playlist',
      videoUrl
    ]);
    let title = '';
    titleProcess.stdout.on('data', (data) => { title += data.toString(); });
    titleProcess.stderr.on('data', () => {}); // ignore errors, fallback later

    await new Promise((resolve, reject) => {
      titleProcess.on('close', (code) => {
        if (code !== 0) return reject(new Error('Failed to get title'));
        resolve();
      });
    });
    title = title.trim() || 'video';
    const filename = sanitize(title) + '.mp4';

    // Set response headers for file download
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.setHeader('Content-Type', 'video/mp4');

    // Now spawn yt-dlp to download and pipe directly to response
    const ytDlp = spawn('yt-dlp', [
      '-f', 'bestvideo[ext=mp4]+bestaudio[ext=m4a]/best[ext=mp4]/best',
      '--merge-output-format', 'mp4',
      '-o', '-',          // output to stdout
      '--no-playlist',
      videoUrl
    ]);

    ytDlp.stdout.pipe(res);

    ytDlp.stderr.on('data', (data) => {
      console.error(`yt-dlp stderr: ${data}`);
    });

    ytDlp.on('error', (err) => {
      console.error('Failed to start yt-dlp:', err);
      if (!res.headersSent) {
        res.status(500).json({ error: 'Download failed' });
      }
    });

    ytDlp.on('close', (code) => {
      if (code !== 0 && !res.headersSent) {
        res.status(500).json({ error: 'yt-dlp process exited with error' });
      }
    });

  } catch (err) {
    console.error(err);
    if (!res.headersSent) {
      res.status(500).json({ error: 'Something went wrong' });
    }
  }
});

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
