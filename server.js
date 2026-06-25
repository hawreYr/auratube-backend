
const express = require('express');
const cors = require('cors');
const ytdl = require('@distube/ytdl-core');

const app = express();
const PORT = process.env.PORT || 10000;

// Enable CORS for frontend accessibility
app.use(cors({
    origin: '*',
    methods: ['GET', 'POST', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization']
}));

app.use(express.json());

// 1. Root / Health Check Endpoint
app.get('/', (req, res) => {
    res.status(200).json({
        status: 'active',
        message: 'AuraTube Backend is online and running successfully!',
        endpoints: {
            info: '/info?url=<youtube_url>',
            download: '/download?url=<youtube_url>&itag=<itag_number>'
        }
    });
});

app.get('/health', (req, res) => {
    res.status(200).send('OK');
});

// 2. Fetch Video Metadata & Available Formats
app.get('/info', async (req, res) => {
    try {
        const videoUrl = req.query.url;
        if (!videoUrl) {
            return res.status(400).json({ error: 'Missing "url" query parameter' });
        }

        if (!ytdl.validateURL(videoUrl)) {
            return res.status(400).json({ error: 'Invalid YouTube URL format' });
        }

        // Fetch deep details with deciphered streaming signatures
        const info = await ytdl.getInfo(videoUrl);

        // Sanitize & structure basic video details
        const details = {
            title: info.videoDetails.title,
            description: info.videoDetails.description ? info.videoDetails.description.slice(0, 150) + '...' : '',
            thumbnail: info.videoDetails.thumbnails[info.videoDetails.thumbnails.length - 1]?.url || '',
            duration: parseInt(info.videoDetails.lengthSeconds),
            author: info.videoDetails.author.name,
            viewCount: parseInt(info.videoDetails.viewCount).toLocaleString(),
            publishDate: info.videoDetails.publishDate
        };

        // Extract and map all download formats
        const formats = info.formats.map(f => {
            let type = 'unknown';
            if (f.hasVideo && f.hasAudio) {
                type = 'video_audio'; // Pre-merged stream (Standard definitions up to 720p)
            } else if (f.hasVideo) {
                type = 'video_only';  // High-def streams (1080p, 2K, 4K)
            } else if (f.hasAudio) {
                type = 'audio_only';  // Quality audio tracks (MP3/M4A)
            }

            return {
                itag: f.itag,
                quality: f.qualityLabel || (f.audioBitrate ? `${f.audioBitrate}kbps` : 'audio'),
                container: f.container,
                hasVideo: f.hasVideo,
                hasAudio: f.hasAudio,
                type: type,
                mimeType: f.mimeType ? f.mimeType.split(';')[0] : '',
                sizeBytes: f.contentLength ? parseInt(f.contentLength) : null
            };
        });

        res.json({ details, formats });
    } catch (error) {
        console.error('Error fetching video metadata:', error.message);
        res.status(500).json({ error: 'Failed to retrieve video details. Make sure the URL is public.' });
    }
});

// 3. Dynamic Stream & Download Router
app.get('/download', async (req, res) => {
    try {
        const videoUrl = req.query.url;
        const itag = req.query.itag;
        const formatType = req.query.format || 'mp4'; // default to mp4

        if (!videoUrl) {
            return res.status(400).send('Missing "url" query parameter');
        }

        if (!ytdl.validateURL(videoUrl)) {
            return res.status(400).send('Invalid YouTube URL');
        }

        const info = await ytdl.getInfo(videoUrl);
        
        // Clean characters to prevent filename breaking headers
        const rawTitle = info.videoDetails.title || 'AuraTube_Video';
        const cleanTitle = rawTitle.replace(/[^a-zA-Z0-9\s-_]/g, '').replace(/\s+/g, '_');

        let selectedFormat = null;
        if (itag) {
            selectedFormat = info.formats.find(f => f.itag == itag);
        }

        let downloadOptions = {
            requestOptions: {
                headers: {
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
                }
            }
        };

        if (selectedFormat) {
            downloadOptions.format = selectedFormat;
        } else {
            if (formatType === 'mp3') {
                downloadOptions.quality = 'highestaudio';
                downloadOptions.filter = 'audioonly';
            } else {
                downloadOptions.quality = 'highest';
                downloadOptions.filter = 'audioandvideo';
            }
        }

        const finalFormat = selectedFormat || ytdl.chooseFormat(info.formats, downloadOptions);
        const ext = formatType === 'mp3' ? 'mp3' : (finalFormat ? finalFormat.container : 'mp4');
        const filename = `${cleanTitle}.${ext}`;

        // Set response headers for client download
        res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
        res.setHeader('Content-Type', formatType === 'mp3' ? 'audio/mpeg' : 'video/mp4');

        if (finalFormat && finalFormat.contentLength) {
            res.setHeader('Content-Length', finalFormat.contentLength);
        }

        // Stream binary straight to response
        const stream = ytdl.downloadFromInfo(info, downloadOptions);

        stream.on('error', (err) => {
            console.error('Playback Stream error:', err.message);
            if (!res.headersSent) {
                res.status(500).send('An unexpected stream failure occurred.');
            }
        });

        stream.pipe(res);

    } catch (error) {
        console.error('Download processor error:', error.message);
        if (!res.headersSent) {
            res.status(500).send('Failed to prepare stream download: ' + error.message);
        }
    }
});

// Run server
app.listen(PORT, () => {
    console.log(`AuraTube Service deployed seamlessly on port ${PORT}`);
});
