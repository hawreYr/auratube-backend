
import os
import requests
from flask import Flask, request, jsonify, Response, stream_with_context
from flask_cors import CORS
import yt_dlp

app = Flask(__name__)

# Enable CORS for frontend accessibility
CORS(app, resources={r"/*": {"origins": "*"}})

@app.route('/')
def health_check():
    return jsonify({
        "status": "online",
        "engine": "yt-dlp (Python)",
        "message": "AuraTube Python Service is fully operational!"
    }), 200

@app.route('/info')
def get_info():
    url = request.args.get('url')
    if not url:
        return jsonify({"error": "Missing URL parameter"}), 400

    ydl_opts = {
        'quiet': True,
        'no_warnings': True,
        # Emulate normal user browsers to bypass security screens
        'http_headers': {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
            'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
            'Accept-Language': 'en-US,en;q=0.5',
        }
    }

    try:
        with yt_dlp.YoutubeDL(ydl_opts) as ydl:
            # Extract metadata without downloading the file
            info = ydl.extract_info(url, download=False)
            
            # Extract and filter streams
            formats = []
            for f in info.get('formats', []):
                # Skip streams without dynamic URLs
                stream_url = f.get('url')
                if not stream_url:
                    continue

                acodec = f.get('acodec')
                vcodec = f.get('vcodec')
                
                has_video = vcodec != 'none' and vcodec is not None
                has_audio = acodec != 'none' and acodec is not None

                # Categorize the formats
                if has_video and has_audio:
                    fmt_type = 'video_audio'  # Direct downloadable standard files (up to 720p)
                elif has_audio and not has_video:
                    fmt_type = 'audio_only'   # Audio-only streams
                elif has_video and not has_audio:
                    fmt_type = 'video_only'   # High-definition (1080p, 2K, 4K) video only
                else:
                    continue

                filesize = f.get('filesize') or f.get('filesize_approx') or 0

                formats.append({
                    "format_id": f.get('format_id'),
                    "ext": f.get('ext') or 'mp4',
                    "resolution": f.get('resolution') or f.get('format_note') or 'Standard',
                    "filesize": filesize,
                    "type": fmt_type,
                    "container": f.get('container') or f.get('ext') or 'mp4'
                })

            details = {
                "title": info.get('title', 'Unknown Title'),
                "author": info.get('uploader', 'Unknown Creator'),
                "thumbnail": info.get('thumbnail', ''),
                "duration": info.get('duration', 0),
                "view_count": f"{info.get('view_count', 0):,}"
            }

            return jsonify({
                "details": details,
                "formats": formats
            })

    except Exception as e:
        print(f"Error fetching info: {str(e)}")
        return jsonify({"error": f"Failed to retrieve video metadata. YouTube blocked or invalid URL. Details: {str(e)}"}), 500

@app.route('/download')
def download():
    url = request.args.get('url')
    format_id = request.args.get('format_id')

    if not url or not format_id:
        return "Missing url or format_id parameters", 400

    ydl_opts = {
        'quiet': True,
        'format': format_id,
    }

    try:
        with yt_dlp.YoutubeDL(ydl_opts) as ydl:
            info = ydl.extract_info(url, download=False)
            formats = info.get('formats', [])
            
            # Locate target format track
            selected_format = next((f for f in formats if f.get('format_id') == format_id), None)
            if not selected_format:
                return "Requested quality format ID was not found.", 404

            stream_url = selected_format.get('url')
            headers = selected_format.get('http_headers', {})

            # Stream direct binary in chunks to minimize Render memory load
            response = requests.get(stream_url, headers=headers, stream=True, timeout=30)
            
            # Clean title name for file generation
            raw_title = info.get('title', 'video')
            clean_title = "".join(c for c in raw_title if c.isalnum() or c in (' ', '_', '-')).strip().replace(' ', '_')
            ext = selected_format.get('ext', 'mp4')

            def generate_chunks():
                for chunk in response.iter_content(chunk_size=1024 * 1024):  # 1MB Chunks
                    if chunk:
                        yield chunk

            resp_headers = {
                'Content-Disposition': f'attachment; filename="{clean_title}.{ext}"',
                'Content-Type': response.headers.get('Content-Type', 'application/octet-stream')
            }

            if 'Content-Length' in response.headers:
                resp_headers['Content-Length'] = response.headers['Content-Length']

            return Response(stream_with_context(generate_chunks()), headers=resp_headers)

    except Exception as e:
        print(f"Streaming error occurred: {str(e)}")
        return f"Download streaming failed: {str(e)}", 500

if __name__ == '__main__':
    # Fallback to local development port if running outside Render
    port = int(os.environ.get('PORT', 10000))
    app.run(host='0.0.0.0', port=port)

