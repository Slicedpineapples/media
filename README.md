# Media Upload Service

A lightweight authenticated media hosting service for uploading images, audio, and video, then serving them through public hot-linkable URLs.

## Features

- JWT-protected login, upload, and file listing
- Public media URLs under `/media/:filename`
- Dashboard UI with a macOS-style file-explorer view, toolbar navigation, search, upload, select, delete, folders, previews, copy link, and open actions
- Local persistent storage through the `uploads` Docker volume
- Backend file filtering with extension, MIME type, and file signature checks
- Docker-based local run and GHCR-based production deploy

## Stack

- Node.js
- Express
- Multer
- JSON Web Tokens
- bcrypt
- Docker Compose
- GitHub Actions

## Environment

Create `.env` from `.env.example`:

```env
JWT_SECRET=replace_with_strong_secret
ADMIN_USER=admin
ADMIN_PASS=change_this_password
PORT=8005
MAX_UPLOAD_BYTES=104857600
```

`MAX_UPLOAD_BYTES` is optional and defaults to `100MB`.

## Local Development

Install dependencies:

```bash
npm ci
```

Run directly:

```bash
npm start
```

Run with Docker:

```bash
docker compose up --build
```

The app is available at:

```text
http://localhost:8005
```

## API

### Login

```http
POST /login
Content-Type: application/json
```

```json
{
  "username": "admin",
  "password": "change_this_password"
}
```

Response:

```json
{
  "token": "jwt_token_here"
}
```

### Upload

```http
POST /upload
Authorization: Bearer <token>
Content-Type: multipart/form-data
```

Form field:

```text
folder required
file
```

For direct multipart API calls, send `folder` before `file`, or pass it as `?folder=Uploads` / `X-Upload-Folder: Uploads`.

The root directory can contain folders only. Uploads to root are rejected; open or create a folder before uploading media.

Response:

```json
{
  "filename": "uuid.ext",
  "path": "Uploads/uuid.ext",
  "folder": "Uploads",
  "size": 24576,
  "url": "https://your-host/media/Uploads/uuid.ext"
}
```

### Create Folder

```http
POST /folders
Authorization: Bearer <token>
Content-Type: application/json
```

```json
{
  "folder": "Uploads"
}
```

Nested folders are supported with `/`, for example `Uploads/June`. Folder names are sanitized on the backend and always stay inside `uploads/`.

### List Folders

```http
GET /folders
Authorization: Bearer <token>
```

### Browse Folder

```http
GET /browse?folder=Uploads
Authorization: Bearer <token>
```

Response:

```json
{
  "folder": "Uploads",
  "parent": "",
  "folders": [
    {
      "name": "June",
      "path": "Uploads/June"
    }
  ],
  "files": [
    {
      "name": "uuid.ext",
      "path": "Uploads/uuid.ext",
      "folder": "Uploads",
      "size": 24576,
      "uploadedAt": "2026-06-01T15:00:00.000Z",
      "url": "https://your-host/media/Uploads/uuid.ext"
    }
  ]
}
```

### List Files

```http
GET /files
Authorization: Bearer <token>
```

This returns every file across all folders. Use `/browse` for the file-explorer view.

### Delete Items

```http
DELETE /items
Authorization: Bearer <token>
Content-Type: application/json
```

```json
{
  "items": [
    { "type": "file", "path": "Uploads/uuid.ext" },
    { "type": "folder", "path": "Uploads/Old" }
  ]
}
```

Response:

```json
{
  "deleted": 2
}
```

### Public Media

```http
GET /media/:path
```

## Upload Security

Uploads are rejected unless they pass all backend checks:

- Final file extension must be allowlisted
- Browser-provided MIME type must match the extension
- Stored file bytes must match a known media file signature
- Stored filenames are generated as UUIDs
- Disallowed existing files are hidden from `/files` and blocked from `/media/:path`
- Served media includes `X-Content-Type-Options: nosniff`

Allowed types:

```text
Images: apng, avif, gif, jpg, jpeg, png, webp
Audio:  aac, flac, m4a, mp3, ogg, wav
Video:  mov, mp4, webm
```

Script-capable or executable files such as `html`, `js`, `svg`, `php`, `py`, and double-extension files like `image.jpg.py` are rejected.

## Deployment

The GitHub Actions workflow builds and pushes:

```text
ghcr.io/slicedpineapples/media-upload-service:latest
```

Production uses `docker-compose.prod.yml`, which pulls the GHCR image. Local development uses `docker-compose.yml`, which builds from the local `Dockerfile`.

Required GitHub Actions secrets:

```text
SERVER_SSH_KEY
CF_ACCESS_CLIENT_ID
CF_ACCESS_CLIENT_SECRET
```

Optional:

```text
PRODUCTION_ENV
```

If `PRODUCTION_ENV` is set, the workflow writes it to `~/media/.env` on the server. If it is missing, the existing server `.env` is kept.

## Checks

Run syntax and Compose validation:

```bash
npm run check
docker compose config --quiet
docker compose -f docker-compose.prod.yml config --quiet
```
