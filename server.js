```javascript
const express = require('express');
const cors = require('cors');
const ytdl = require('@distube/ytdl-core');

const app = express();
// Render assigns a dynamic port automatically
const PORT = process.env.PORT || 3000;

// Enable CORS so your Netlify frontend can securely talk to this Render backend
app.use(cors({
    origin: '*' // In the future, you can change '*' to your exact Netlify URL for extra security
}));

// Basic health check route to see if the server is awake
app.get('/', (req, res) => {
    res.send('AuraTube Backend is awake and running on Render!');
});

// Route 1: Get video metadata (Title, duration, thumbnail, formats)
app.get('/info', async (req, res) => {
    try {
        const videoURL = req.query.url;
        if (!ytdl.validateURL(videoURL)) {
            return res.status(400).json({ error: 'Invalid YouTube URL' });
        }

        const info = await ytdl.getInfo(videoURL);
        
        res.json({
            title: info.videoDetails.title,
            channel: info.videoDetails.author.name,
            duration: info.videoDetails.lengthSeconds,
            thumbnail: info.videoDetails.thumbnails[info.videoDetails.thumbnails.length - 1].url,
            formats: info.formats
        });
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: 'Failed to fetch video info. YouTube might be blocking the request.' });
    }
});

// Route 2: Stream and download the actual file
app.get('/download', (req, res) => {
    try {
        const videoURL = req.query.url;
        const itag = req.query.itag; // The specific quality ID
        const title = req.query.title || 'Video';
        const isAudio = req.query.audio === 'true';

        if (!ytdl.validateURL(videoURL)) {
            return res.status(400).send('Invalid YouTube URL');
        }

        // Force the browser to trigger a download file dialog
        const extension = isAudio ? 'mp3' : 'mp4';
        const safeTitle = title.replace(/[^a-zA-Z0-9 ]/g, ""); // Remove weird characters from filename
        res.header('Content-Disposition', `attachment; filename="${safeTitle}.${extension}"`);
        
        const options = { quality: itag };
        
        // If audio only, tell the library to filter out video streams
        if (isAudio && !itag) {
            options.quality = 'highestaudio';
            options.filter = 'audioonly';
        }

        // Pipe the video stream directly from YouTube -> Render -> Your Browser
        ytdl(videoURL, options).pipe(res);

    } catch (error) {
        console.error(error);
        res.status(500).send('Error downloading file');
    }
});

// Start the server
app.listen(PORT, () => {
    console.log(`AuraTube Backend is running on port ${PORT}`);
});

```
