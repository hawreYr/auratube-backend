
const express = require('express');
const cors = require('cors');
const youtubedl = require('youtube-dl-exec');

const app = express();
const PORT = process.env.PORT || 3000;

// Allow your frontend to talk to this server securely
app.use(cors({ origin: '*' }));

app.get('/', (req, res) => {
    res.send('AuraTube yt-dlp Backend is awake and running!');
});

// Route 1: Get Video Metadata
app.get('/info', async (req, res) => {
    try {
        const videoURL = req.query.url;
        if (!videoURL) return res.status(400).json({ error: 'URL is required' });

        // yt-dlp fetches data flawlessly without IP bans
        const info = await youtubedl(videoURL, {
            dumpSingleJson: true,
            noWarnings: true,
            noCallHome: true,
            noCheckCertificates: true
        });

        res.json({
            title: info.title,
            channel: info.uploader,
            duration: info.duration,
            thumbnail: info.thumbnail
        });

    } catch (error) {
        console.error(error);
        res.status(500).json({ error: 'Failed to fetch video info. Backend might need a restart.' });
    }
});

// Route 2: Direct Stream Download
app.get('/download', (req, res) => {
    const videoURL = req.query.url;
    const isAudio = req.query.audio === 'true';
    const title = req.query.title || 'Media';

    if (!videoURL) return res.status(400).send('URL is required');

    const extension = isAudio ? 'mp3' : 'mp4';
    const safeTitle = title.replace(/[^a-zA-Z0-9 ]/g, ""); // clean the filename
    
    // This header tells your browser to DOWNLOAD the file, not navigate away!
    res.header('Content-Disposition', `attachment; filename="${safeTitle}.${extension}"`);

    // For video, we grab a pre-muxed mp4. For audio, best audio.
    const format = isAudio ? 'bestaudio' : 'best[ext=mp4]/best';

    // Pipe the stream from yt-dlp -> Render -> Your browser native downloader
    const subprocess = youtubedl.exec(videoURL, {
        o: '-', // output to stdout
        f: format,
        noWarnings: true,
        noCallHome: true,
        noCheckCertificates: true
    });

    subprocess.stdout.pipe(res);

    subprocess.on('error', (err) => {
        console.error('Stream error:', err);
        if (!res.headersSent) res.status(500).send('Download stream failed');
    });
});

app.listen(PORT, () => {
    console.log(`AuraTube yt-dlp proxy running on port ${PORT}`);
});

