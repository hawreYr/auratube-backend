
import os
import uuid
import tempfile
import requests
from flask import Flask, request, jsonify, Response, stream_with_context
from flask_cors import CORS
import yt_dlp

app = Flask(__name__)
CORS(app, resources={r"/*": {"origins": "*"}})

# Global in-memory cache to temporarily store resolved stream download URLs
# Key: secure uuid, Value: dict containing stream_url, headers, title, extension
STREAM_CACHE = {}

def clean_filename(title):
    """Sanitize the title to be a safe, clean filename."""
    return "".join(c for c in title if c.isalnum() or c in (' ', '_', '-')).strip().replace(' ', '_')

@app.route('/')
def health():
    return jsonify({
        "status": "online",
        "engine": "yt-dlp (Bypass Ready)",
        "cached_streams": len(STREAM_CACHE)
    }), 200

@app.route('/info', methods=['POST'])
def get_info():
    data = request.get_json() or {}
    url = data.get('url')
    user_cookies = data.get('cookies', '').strip()

    if not url:
        return jsonify({"error": "Please provide a valid YouTube URL."}), 400

    temp_cookie_file = None
    ydl_opts = {
        'quiet': True,
        'no_warnings': True,
        # Force mobile app client players, which bypass 95% of server IP blocks
        'extractor_args': {
            'youtube': {
                'player_client': ['android', 'ios'],
                'skip': ['webpage', 'hls']
            }
        },
        'http_headers': {
            'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 16_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.0 Mobile/15E148 Safari/604.1',
            'Accept': '*/*',
            'Accept-Language': 'en-US,en;q=0.9',
        }
    }

    # If the user provided bypass cookies, write them to a temp file for yt-dlp to read
    if user_cookies:
        try:
            temp_cookie_file = tempfile.NamedTemporaryFile(mode='w+', delete=False, suffix='.txt')
            temp_cookie_file.write(user_cookies)
            temp_cookie_file.close()
            ydl_opts['cookiefile'] = temp_cookie_file.name
        except Exception as e:
            return jsonify({"error": f"Failed to initialize security cookies: {str(e)}"}), 500

    try:
        with yt_dlp.YoutubeDL(ydl_opts) as ydl:
            # Extract video metadata safely
            info = ydl.extract_info(url, download=False)
            
            formats_list = []
            for f in info.get('formats', []):
                stream_url = f.get('url')
                if not stream_url:
                    continue

                acodec = f.get('acodec', 'none')
                vcodec = f.get('vcodec', 'none')
                has_video = vcodec != 'none' and vcodec is not None
                has_audio = acodec != 'none' and acodec is not None

                if has_video and has_audio:
                    fmt_type = 'video_audio'  # Integrated video + sound
                elif has_audio and not has_video:
                    fmt_type = 'audio_only'   # Audio/MP3 tracks
                elif has_video and not has_audio:
                    fmt_type = 'video_only'   # High-Definition silent video tracks
                else:
                    continue

                # Generate a temporary download ticket ID
                download_ticket = str(uuid.uuid4())
                filesize = f.get('filesize') or f.get('filesize_approx') or 0

                # Cache the stream URL and headers safely in server memory
                STREAM_CACHE[download_ticket] = {
                    "stream_url": stream_url,
                    "headers": f.get('http_headers', {}),
                    "title": info.get('title', 'AuraTube_Media'),
                    "ext": f.get('ext', 'mp4'),
                    "mime": f.get('mime_type')
                }

                formats_list.append({
                    "ticket": download_ticket,
                    "ext": f.get('ext', 'mp4'),
                    "resolution": f.get('resolution') or f.get('format_note') or 'Standard',
                    "filesize": filesize,
                    "type": fmt_type,
                    "container": f.get('container') or f.get('ext') or 'mp4'
                })

            details = {
                "title": info.get('title', 'Unknown YouTube Video'),
                "author": info.get('uploader', 'Creator'),
                "thumbnail": info.get('thumbnail', ''),
                "duration": info.get('duration', 0),
                "view_count": f"{info.get('view_count', 0):,}"
            }

            return jsonify({
                "details": details,
                "formats": formats_list
            })

    except Exception as e:
        error_msg = str(e)
        clean_error = "YouTube blocked this download request. Please enable the 'Advanced Cookie Bypass' tool below."
        if "sign in" in error_msg.lower() or "confirm you are not a bot" in error_msg.lower():
            clean_error = "YouTube requested a bot challenge. Paste your cookies into the 'Advanced Cookie Bypass' box below to instantly download."
        
        print(f"Extraction Error: {error_msg}")
        return jsonify({"error": clean_error, "raw_details": error_msg}), 500

    finally:
        # Clean up temporary cookie file if created
        if temp_cookie_file and os.path.exists(temp_cookie_file.name):
            try:
                os.remove(temp_cookie_file.name)
            except Exception:
                pass

@app.route('/download')
def download():
    ticket = request.args.get('ticket')
    if not ticket or ticket not in STREAM_CACHE:
        return "Your download link expired or is invalid. Please fetch the link again.", 410

    cached_item = STREAM_CACHE[ticket]
    stream_url = cached_item["stream_url"]
    headers = cached_item["headers"]
    title = clean_filename(cached_item["title"])
    ext = cached_item["ext"]
    mime_type = cached_item.get("mime") or 'application/octet-stream'

    try:
        # Stream chunks directly from YouTube to user to save memory and bypass blocks
        req = requests.get(stream_url, headers=headers, stream=True, timeout=60)
        
        def generate():
            for chunk in req.iter_content(chunk_size=1024 * 1024): # 1MB chunks
                if chunk:
                    yield chunk

        resp_headers = {
            'Content-Disposition': f'attachment; filename="{title}.{ext}"',
            'Content-Type': mime_type
        }
        
        if 'Content-Length' in req.headers:
            resp_headers['Content-Length'] = req.headers['Content-Length']

        return Response(stream_with_context(generate()), headers=resp_headers)

    except Exception as e:
        return f"Streaming connection lost: {str(e)}", 500

if __name__ == '__main__':
    port = int(os.environ.get('PORT', 10000))
    app.run(host='0.0.0.0', port=port)

