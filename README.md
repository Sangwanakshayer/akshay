# tg_addon

Telegram-backed Stremio/Nuvio-compatible catalog for an authorized private Telegram channel.

## Features
- Private Telegram channel indexing via MTProto/GramJS
- Filename/caption metadata parsing
- SQLite local index
- Catalog + search
- Fresh Telegram file URL generation at playback time
- No Telegram secrets committed to Git

## Setup
1. Create a private GitHub repository.
2. Copy `.env.example` to `.env`.
3. Put `api_id`, `api_hash` and a Telethon/GramJS-compatible session string in `.env`.
4. Ensure the Telegram account used by the session is a member of the channel.
5. `npm install`
6. `npm run index`
7. `npm start`

The addon manifest is available at `/manifest.json`.

Do not upload `.env`, session files, API hashes, or other credentials to GitHub.

## Notes
This project is intended for channels/content you are authorized to access and distribute.
The stream resolver generates a fresh Telegram file URL when possible instead of storing expiring CDN URLs permanently.
