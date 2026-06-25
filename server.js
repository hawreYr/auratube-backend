
const express = require('express');
const cors = require('cors');

const app = express();
const PORT = process.env.PORT || 3000;

// Allow your frontend to communicate with this server
app.use(cors({ origin: '*' }));
app.use(express.json());

app.get('/', (req, res) => res.send('AuraTube Proxy Bridge is Awake!'));

// Route 1: Get Metadata via Official unblocked YouTube API
app.get('/info', async (req, res) => {
    try {
        const videoURL = req.query.url;
        if (!videoURL) return res.status(400).json({ error: 'URL is required' });

        let videoId = '';
        const regex = /(?:youtube\.com\/(?:[^\/]+\/.+\/|(?:v|e(?:mbed)?)\/|.*[?&]v=)|youtu\.be\/|youtube\.com\/shorts\/)([^"&?\/\s]{11})/i;
        const match = videoURL.match(regex);
        if (match) videoId = match[1];

        // This official endpoint NEVER blocks datacenter IPs
        const oembedUrl = `https://www.youtube.com/oembed?url=${encodeURIComponent(videoURL)}&format=json`;
        const oembedRes = await fetch(oembedUrl);
        
        if (!oembedRes.ok) throw new Error("Video not found or is private.");
        
        const data = await oembedRes.json();

        res.json({
            title: data.title,
            channel: data.author_name,
            thumbnail: `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`
        });

    } catch (error) {
        console.error(error);
        res.status(500).json({ error: 'Failed to fetch video info.' });
    }
});

// Route 2: Securely proxy download request to avoid browser CORS/Sandbox limits
app.post('/download', async (req, res) => {
    try {
        const { url, quality, isAudio } = req.body;

        const payload = {
            url: url,
            filenameStyle: 'pretty'
        };

        if (isAudio) {
            payload.isAudioOnly = true;
            payload.audioFormat = 'mp3';
        } else {
            payload.videoQuality = quality || '1080';
        }

        const cobaltNodes = [
            "https://api.cobalt.tools",
            "https://cobalt.api.ryb.sh",
            "https://co.wukko.me"
        ];

        let downloadUrl = null;

        // Auto-failover loop handled by the server!
        for (const node of cobaltNodes) {
            try {
                const response = await fetch(node, {
                    method: 'POST',
                    headers: {
                        'Accept': 'application/json',
                        'Content-Type': 'application/json',
                        'User-Agent': 'AuraTube-Server/1.0'
                    },
                    body: JSON.stringify(payload)
                });

                if (response.ok) {
                    const data = await response.json();
                    if (data && data.url) {
                        downloadUrl = data.url;
                        break;
                    }
                }
            } catch(e) {
                console.log(`Node ${node} failed, trying next...`);
            }
        }

        if (downloadUrl) {
            res.json({ url: downloadUrl });
        } else {
            res.status(500).json({ error: "All backend proxy nodes failed." });
        }

    } catch (error) {
        console.error(error);
        res.status(500).json({ error: 'Internal Server Error' });
    }
});

app.listen(PORT, () => console.log(`AuraTube Proxy running on port ${PORT}`));

